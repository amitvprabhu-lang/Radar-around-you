import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://radar.example";

// Runs the real worker file in a context with fake caches, a fake network and a fake clients object.
function boot({ network = () => new Response("net", { status: 200 }) } = {}) {
  const handlers = {}, store = new Map(), calls = { fetch: [] };
  const cacheFor = (name) => store.get(name) || store.set(name, new Map()).get(name);
  const caches = {
    open: async (name) => { const m = cacheFor(name); return { match: async (req) => m.get(typeof req === "string" ? req : req.url)?.clone(), put: async (req, res) => { m.set(typeof req === "string" ? req : req.url, res); } }; },
    keys: async () => [...store.keys()], delete: async (k) => store.delete(k),
  };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() { calls.skipped = true; }, clients: { claim: async () => { calls.claimed = true; } }, location: { origin: ORIGIN } };
  const ctx = vm.createContext({ self, caches, fetch: async (r) => { calls.fetch.push(r.url); return network(r); }, Response, Request, URL, Promise, console });
  vm.runInContext(SRC, ctx);
  const fetchEvent = async (url, { mode = "no-cors", method = "GET" } = {}) => {
    let p = null;
    const req = { url, mode, method, clone() { return this; } };
    handlers.fetch({ request: req, respondWith: (x) => { p = x; } });
    return p ? { handled: true, res: await p } : { handled: false };
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
