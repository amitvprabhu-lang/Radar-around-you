import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://radar.example";

// Runs the real worker file in a context with fake caches, a fake network and a fake clients object.
function boot({ network = () => new Response("net", { status: 200 }), failPut = false } = {}) {
  const handlers = {}, store = new Map(), calls = { fetch: [] };
  const cacheFor = (name) => store.get(name) || store.set(name, new Map()).get(name);
  const caches = {
    open: async (name) => { const m = cacheFor(name); const key = (req) => (typeof req === "string" ? req : req.url); return { match: async (req) => m.get(key(req))?.clone(), put: async (req, res) => { if (failPut) throw new DOMException("quota", "QuotaExceededError"); m.set(key(req), res); }, keys: async () => [...m.keys()].map((url) => ({ url })), delete: async (req) => m.delete(key(req)) }; },
    keys: async () => [...store.keys()], delete: async (k) => store.delete(k),
  };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() { calls.skipped = true; }, clients: { claim: async () => { calls.claimed = true; } }, location: { origin: ORIGIN } };
  const ctx = vm.createContext({ self, caches, fetch: async (r) => { calls.fetch.push(r.url); return network(r); }, Response, Request, URL, Promise, console, DOMException });
  vm.runInContext(SRC, ctx);
  const fetchEvent = async (url, { mode = "no-cors", method = "GET" } = {}) => {
    let p = null;
    const waits = [];
    const req = { url, mode, method, clone() { return this; } };
    handlers.fetch({ request: req, respondWith: (x) => { p = x; }, waitUntil: (x) => { waits.push(x); } });
    if (!p) return { handled: false };
    const res = await p;
    await Promise.all(waits); // the background storing, so a test sees the cache as the next visit would
    return { handled: true, res, waits: waits.length };
  };
  return { handlers, store, calls, fetchEvent, ctx };
}
const reqUrl = (p) => ORIGIN + p;

test("install takes over at once and activation removes old caches", async () => {
  const w = boot();
  w.handlers.install();
  assert.equal(w.calls.skipped, true);
  w.store.set("radar-v0", new Map()); w.store.set("radar-v1", new Map());
  let done; w.handlers.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual([...w.store.keys()], ["radar-v1"]);
  assert.equal(w.calls.claimed, true);
});

test("other sites and non-GET requests are not touched", async () => {
  const w = boot();
  assert.equal((await w.fetchEvent("https://fonts.googleapis.com/css2?family=x")).handled, false);
  assert.equal((await w.fetchEvent(reqUrl("/live/manifest.json"), { method: "POST" })).handled, false);
  assert.deepEqual(w.calls.fetch, []);
});

test("live data goes to the network first and the last copy is used only when the network fails", async () => {
  let online = true;
  const w = boot({ network: () => { if (!online) throw new TypeError("offline"); return new Response("fresh " + Math.random(), { status: 200 }); } });
  const first = await w.fetchEvent(reqUrl("/live/manifest.json"));
  const firstText = await first.res.clone().text();
  assert.match(firstText, /^fresh/);
  online = false;
  const off = await w.fetchEvent(reqUrl("/live/manifest.json"));
  assert.equal(await off.res.text(), firstText, "offline: the last copy of the manifest");
  await assert.rejects(() => w.fetchEvent(reqUrl("/live/other.json")).then((x) => x.res), /offline/, "a live file never fetched has no copy to fall back on");
});

test("an error answer from the network is never stored over a good copy", async () => {
  let status = 200;
  const w = boot({ network: () => new Response("body" + status, { status }) });
  await w.fetchEvent(reqUrl("/live/quakes/v1/quakes.json"));
  status = 500;
  const bad = await w.fetchEvent(reqUrl("/live/quakes/v1/quakes.json"));
  assert.equal(bad.res.status, 500);
  const cached = w.store.get("radar-v1").get(reqUrl("/live/quakes/v1/quakes.json"));
  assert.equal(await cached.text(), "body200");
});

test("the page is network first with the cached copy as the offline fallback", async () => {
  let online = true;
  const w = boot({ network: () => { if (!online) throw new TypeError("offline"); return new Response("<html>v1</html>", { status: 200 }); } });
  assert.equal(await (await w.fetchEvent(reqUrl("/"), { mode: "navigate" })).res.clone().text(), "<html>v1</html>");
  online = false;
  assert.equal(await (await w.fetchEvent(reqUrl("/"), { mode: "navigate" })).res.text(), "<html>v1</html>");
});

test("bundled data is served from the cache and refreshed in the background", async () => {
  let body = "old";
  const w = boot({ network: () => new Response(body, { status: 200 }) });
  const first = await w.fetchEvent(reqUrl("/stars.bin"));
  assert.equal(await first.res.clone().text(), "old", "first visit: from the network");
  body = "new";
  const second = await w.fetchEvent(reqUrl("/stars.bin"));
  assert.equal(await second.res.text(), "old", "return visit: the cached copy answers at once");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await w.store.get("radar-v1").get(reqUrl("/stars.bin")).text(), "new", "and the cache has been refreshed for next time");
});

// The production site's app script, app.<10 hex digits of its sha256>.js (build.mjs --external-script), is named after its content.
const JS = { "content-type": "application/x-javascript" }; // what Hostinger sent for .js files on 2026-10-06
test("the app script is cache first: fetched once, then served from the cache with no request at all", async () => {
  let n = 0;
  const w = boot({ network: () => new Response("app v1 " + ++n, { status: 200, headers: JS }) });
  const url = reqUrl("/app.0123456789.js");
  const first = await w.fetchEvent(url);
  assert.equal(await first.res.clone().text(), "app v1 1");
  assert.equal(first.waits, 1, "stored in the background (waitUntil), after the answer went to the page");
  assert.equal(await (await w.fetchEvent(url)).res.text(), "app v1 1", "the stored copy");
  assert.deepEqual(w.calls.fetch, [url], "one download only (stale-while-revalidate would have fetched it again on every visit)");
});

test("a new app script replaces the older one in the cache; other files stay", async () => {
  const w = boot({ network: (r) => new Response("body of " + r.url, { status: 200, headers: JS }) });
  await w.fetchEvent(reqUrl("/app.0123456789.js"));
  await w.fetchEvent(reqUrl("/stars.bin"));
  await w.fetchEvent(reqUrl("/sub/app.aaaaaaaaaa.js"));
  await w.fetchEvent(reqUrl("/app.abcdef0123.js"));
  assert.deepEqual([...w.store.get("radar-v1").keys()].sort(), [reqUrl("/app.abcdef0123.js"), reqUrl("/stars.bin")].sort());
});

test("a failed app script download is passed on (so the page's guard acts) and nothing is stored", async () => {
  let mode = "offline";
  const w = boot({ network: () => { if (mode === "offline") throw new TypeError("offline"); return new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } }); } });
  const url = reqUrl("/app.0123456789.js");
  await assert.rejects(() => w.fetchEvent(url).then((x) => x.res), /offline/, "a network error stays an error");
  mode = "404";
  assert.equal((await w.fetchEvent(url)).res.status, 404, "an old page naming a script a later deploy removed gets the 404");
  assert.equal(w.store.get("radar-v1").size, 0);
});

test("only a JavaScript answer of the full length is stored: an html 200 or a truncated body is passed through and not kept", async () => {
  let answer;
  const w = boot({ network: () => answer() });
  const url = reqUrl("/app.0123456789.js");
  answer = () => new Response("<html>a host's error page</html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal((await w.fetchEvent(url)).res.status, 200);
  assert.equal(w.store.get("radar-v1").size, 0, "html is not stored");
  answer = () => new Response("var a=1;", { status: 200, headers: { ...JS, "content-length": "500" } });
  const short = await w.fetchEvent(url);
  assert.equal(await short.res.text(), "var a=1;", "the page still gets the answer");
  assert.equal(w.store.get("radar-v1").size, 0, "a body shorter than its content-length is not stored");
  answer = () => new Response("var a=1;", { status: 200, headers: { ...JS, "content-length": "500", "content-encoding": "br" } });
  await w.fetchEvent(url);
  assert.equal(w.store.get("radar-v1").size, 1, "a compressed answer's length counts the compressed bytes, so it is not compared");
  w.store.get("radar-v1").clear();
  answer = () => new Response("var a=1;", { status: 200, headers: { ...JS, "content-length": "8" } });
  await w.fetchEvent(url);
  assert.equal(w.store.get("radar-v1").size, 1, "the full body is stored");
});

test("a cache that refuses to store (full, evicted) never breaks loading", async () => {
  const w = boot({ network: () => new Response("var a=1;", { status: 200, headers: JS }), failPut: true });
  const r = await w.fetchEvent(reqUrl("/app.0123456789.js"));
  assert.equal(await r.res.text(), "var a=1;");
  assert.equal(r.waits, 1, "the failed store ran in the background and was swallowed (the waited promise resolved)");
});

test("only an exact app.<10 hex>.js name is cache first; with a query (the guard's retry) the worker leaves it alone", async () => {
  const w = boot();
  const s = (p, mode = "no-cors") => w.ctx.strategyFor(reqUrl(p), mode, "GET", ORIGIN);
  assert.equal(s("/app.0123456789.js"), "cache-first");
  assert.equal(s("/radar/app.0123456789.js"), "cache-first", "the site may live in a folder");
  assert.equal(s("/app.0123456789.js?r=1791311737169"), "ignore");
  for (const p of ["/app.js", "/app.012345678.js", "/app.0123456789a.js", "/app.ABCDEF0123.js", "/live-pages.js", "/live/app.0123456789.js"]) assert.notEqual(s(p), "cache-first", p);
  assert.equal(s("/live/app.0123456789.js"), "network-first");
  assert.equal(s("/"), "stale-while-revalidate");
  assert.equal(s("/", "navigate"), "network-first");
  assert.equal((await w.fetchEvent(reqUrl("/app.0123456789.js?r=1"))).handled, false);
});

test("the manifest is valid and lists icons that exist", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  for (const k of ["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"]) assert.ok(m[k], k);
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512") && m.icons.some((i) => i.purpose === "maskable"));
  for (const i of m.icons) {
    const f = fs.readFileSync(new URL("../public/" + i.src, import.meta.url));
    assert.equal(f.subarray(1, 4).toString(), "PNG", i.src);
    const [w, h] = i.sizes.split("x").map(Number);
    assert.equal(f.readUInt32BE(16), w, i.src + " width");
    assert.equal(f.readUInt32BE(20), h, i.src + " height");
  }
  assert.ok(m.start_url.startsWith("./") && m.scope === "./", "relative paths, so the app works from any folder or repository page");
});
