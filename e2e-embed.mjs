// Browser check of the embeddable widgets (site/embed.mjs) as other sites will use them: the built site (dist/site) served by a real
// local web server, with a pretend live folder (test/embedpack.js: the repository's feed fixtures moved to "now"), and a second server
// on another port (so another origin) that serves a host page with the snippet the gallery makes.
// usage: npm run e2e:embed (it builds the site first). SHOTS=<folder> also saves screenshots of every widget, light and dark, two sizes.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./harness.mjs";
import { embedPack } from "./test/embedpack.js";
import { WIDGETS, widgetFile } from "./site/embed-widgets.mjs";
import { SITE } from "./site/layout.mjs";

const site = fileURLToPath(new URL("./dist/site/", import.meta.url));
if (!fs.existsSync(site + "embed/index.html")) { console.error("dist/site/embed/index.html is missing; run npm run build:hosting first"); process.exit(2); }
const MIME = { ".json": "application/json", ".bin": "application/octet-stream", ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail); };

// server A: the site and the live folder. state.mode: "ok", "stale" (every feed 30 hours old) or "blocked" (the live folder answers 503)
const state = { mode: "ok", pack: embedPack(Date.now()) };
const stalePack = embedPack(Date.now(), { ageMin: 30 * 60 });
// a storm list with nothing active (state.mode "calm")
const calmPack = embedPack(Date.now());
calmPack.files.set("live/storms/v1/storms.json", { ...calmPack.files.get("live/storms/v1/storms.json"), storms: [] });
// a newest quake with a very long place name (state.mode "long"); USGS places are cut at 120 characters by the widget
const longPack = embedPack(Date.now());
{ const q = longPack.files.get("live/quakes/v1/quakes.json"), e = [...q.events].sort((a, b) => b.time.localeCompare(a.time)); e[0].place = "112 km NNE of Somewhere With A Remarkably Long Place Name, Province of an Even Longer Region Name, Some Country"; }
// every request into the live folder, and the most that were open at once
const hits = [];
let open1 = 0, maxOpen = 0;
const serveA = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel.startsWith("live/")) {
    hits.push(rel); open1++; maxOpen = Math.max(maxOpen, open1); res.on("close", () => { open1--; });
    if (state.mode === "blocked") { res.writeHead(503, { "content-type": "text/plain" }); return res.end("unavailable"); }
    const files = (state.mode === "stale" ? stalePack : state.mode === "calm" ? calmPack : state.mode === "long" ? longPack : state.pack).files;
    if (!files.has(rel)) { res.writeHead(404); return res.end(); }
    const v = files.get(rel);
    res.writeHead(200, { "content-type": MIME[path.extname(rel)] || "application/octet-stream", "cache-control": "no-store" });
    return res.end(Buffer.isBuffer(v) ? v : JSON.stringify(v));
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(site, rel);
  if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html><body>Not found</body></html>"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
// server B: another origin, a host page holding whatever snippet the test puts in it
let hostBody = "";
const serveB = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host</title></head><body style="margin:20px;font:16px sans-serif"><h1>Someone else's page</h1>${hostBody}</body></html>`); });
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(s.address().port)));
const A = `http://127.0.0.1:${await listen(serveA)}`, B = `http://localhost:${await listen(serveB)}`;

const browser = await launch();
const SIZES = [[280, 200], [400, 300], [800, 600]];
// opens a widget in its own page at a size; returns the page, its errors and every request it made
async function open(url, [w, h], { scheme = "dark", motion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: motion, serviceWorkers: "block" });
  const p = await ctx.newPage(), errors = [], requests = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  p.on("request", (r) => requests.push(r.url()));
  await p.goto(url, { waitUntil: "load", timeout: 60000 });
  return { p, ctx, errors, requests };
}
const settled = (p) => p.waitForFunction(() => ["ok", "stale", "failed"].includes(document.getElementById("w").getAttribute("data-state")), null, { timeout: 30000 }).then(() => true, () => false);
const info = (p) => p.evaluate(() => {
  const a = document.getElementById("credit"), r = a.getBoundingClientRect(), cv = document.getElementById("cv");
  let painted = 0;
  if (cv.width && cv.height) { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) painted++; }
  return { state: document.getElementById("w").getAttribute("data-state"), sum: document.getElementById("sum").textContent, alt: document.getElementById("vis").getAttribute("aria-label"),
    credit: { text: a.textContent, href: a.href, visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && getComputedStyle(a).visibility === "visible" },
    footer: document.querySelector("footer").textContent, msg: document.getElementById("msg").hidden ? "" : document.getElementById("msg").textContent,
    stale: document.getElementById("stale").hidden ? "" : document.getElementById("stale").textContent, painted, bg: getComputedStyle(document.body).backgroundColor,
    overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1 };
});
const frameSig = (p) => p.evaluate(() => { const cv = document.getElementById("cv"); return cv.width ? cv.toDataURL().length + ":" + cv.toDataURL().slice(-200) : ""; });
const PAGE_OF = { "tonights-sky": "tonights-sky/pune/" };

for (const w of WIDGETS) {
  const q = w.city ? "?city=pune" : "";
  for (const size of SIZES) {
    const { p, ctx, errors, requests } = await open(`${A}/embed/${w.id}/${q}`, size);
    const ok = await settled(p);
    await p.waitForTimeout(400);
    const i = await info(p);
    const label = `${w.id} at ${size.join("x")}`;
    check(`${label}: loads its live data and shows a summary with a number`, ok && i.state === "ok" && /\d/.test(i.sum) && !i.msg, JSON.stringify(i));
    check(`${label}: the text alternative states the numbers`, /\d/.test(i.alt) && i.alt.length > 40, i.alt);
    check(`${label}: the credit and the link back are visible inside the frame`, i.credit.visible && i.credit.text === "Radar Around You" && i.credit.href === `${SITE.url}/${PAGE_OF[w.id] || w.page}` && i.footer.includes(w.credit), JSON.stringify(i.credit));
    check(`${label}: the picture is drawn and the page does not scroll`, i.painted > 50 && !i.overflow, JSON.stringify({ painted: i.painted, overflow: i.overflow }));
    const foreign = requests.filter((u) => !u.startsWith(A + "/"));
    check(`${label}: no request leaves the site, no console errors`, foreign.length === 0 && errors.length === 0, JSON.stringify({ foreign, errors }));
    await ctx.close();
  }
  // motion: frames change while animated, and stay the same with reduced motion
  {
    const { p, ctx } = await open(`${A}/embed/${w.id}/${q}`, [400, 300]);
    await settled(p); await p.waitForTimeout(2200);
    const a = await frameSig(p); await p.waitForTimeout(700); const b = await frameSig(p);
    check(`${w.id}: the view is animated`, a !== b && a !== "", "two frames 0.7 s apart were the same");
    await ctx.close();
    const r = await open(`${A}/embed/${w.id}/${q}`, [400, 300], { motion: "reduce" });
    await settled(r.p); await r.p.waitForTimeout(800);
    const c = await frameSig(r.p); await r.p.waitForTimeout(900); const d = await frameSig(r.p);
    const dot = await r.p.evaluate(() => getComputedStyle(document.querySelector(".dot")).animationName);
    check(`${w.id}: with reduced motion the picture holds still`, c === d && c !== "" && dot === "none", JSON.stringify({ same: c === d, dot }));
    await r.ctx.close();
  }
  // theme: ?theme= overrides the system setting both ways
  {
    const l = await open(`${A}/embed/${w.id}/${q ? q + "&" : "?"}theme=light`, [400, 300], { scheme: "dark" });
    await settled(l.p); const li = await info(l.p); await l.ctx.close();
    const d = await open(`${A}/embed/${w.id}/${q ? q + "&" : "?"}theme=dark`, [400, 300], { scheme: "light" });
    await settled(d.p); const di = await info(d.p); await d.ctx.close();
    const a = await open(`${A}/embed/${w.id}/${q}`, [400, 300], { scheme: "light" });
    await settled(a.p); const ai = await info(a.p); await a.ctx.close();
    const lum = (s) => { const m = s.match(/\d+/g).map(Number); return m[0] + m[1] + m[2]; };
    check(`${w.id}: ?theme=light is light on a dark system, ?theme=dark dark on a light one, and no option follows the system`, lum(li.bg) > 600 && lum(di.bg) < 100 && lum(ai.bg) > 600, JSON.stringify([li.bg, di.bg, ai.bg]));
  }
  // a query value that is not on the list is ignored and never reaches the page
  {
    const x = await open(`${A}/embed/${w.id}/?theme=%3Cimg%20src%3Dx%3E&city=%3Cb%3Eevil`, [400, 300]);
    await settled(x.p);
    const html = await x.p.content(), xi = await x.p.evaluate(() => document.documentElement.getAttribute("data-theme"));
    check(`${w.id}: unknown option values are ignored`, !html.includes("evil") && !html.includes("<img") && xi === null, JSON.stringify({ xi }));
    await x.ctx.close();
  }
  // out of date and failed states
  {
    state.mode = "stale";
    const s = await open(`${A}/embed/${w.id}/${q}`, [400, 300]);
    await settled(s.p); await s.p.waitForTimeout(300); const si = await info(s.p); await s.ctx.close();
    if (w.id === "tonights-sky") check(`${w.id}: with an old cloud forecast the chart still shows and the cloud is marked out of date`, si.state === "ok" && /out of date/.test(si.sum), JSON.stringify(si));
    else check(`${w.id}: with data older than its limit it says out of date, with the data time`, si.state === "stale" && /^Out of date: data of \d+ \w+ \d\d:\d\d UTC, \d+ hours ago\./.test(si.stale), JSON.stringify(si));
    state.mode = "blocked";
    const f = await open(`${A}/embed/${w.id}/${q}`, [400, 300]);
    await settled(f.p); await f.p.waitForTimeout(300); const fi = await info(f.p); await f.ctx.close();
    if (w.id === "tonights-sky") check(`${w.id}: with the live folder failing the computed chart still shows and says the cloud could not be loaded`, fi.state === "ok" && /\d/.test(fi.sum) && fi.credit.visible, JSON.stringify(fi));
    else check(`${w.id}: with the live folder failing it shows a plain message, no picture, and keeps the credit`, fi.state === "failed" && /could not be loaded/.test(fi.msg) && fi.painted === 0 && fi.credit.visible, JSON.stringify(fi));
    state.mode = "ok";
  }
}

// the storm widget with nothing active says so, in words and on the map
{
  state.mode = "calm";
  const { p, ctx } = await open(`${A}/embed/tropical-storms/`, [400, 300]);
  await settled(p); await p.waitForTimeout(300);
  const i = await info(p);
  check("tropical-storms with no active storm: says so and still draws the map", i.state === "ok" && /^No active storms in NHC's list/.test(i.sum) && i.painted > 50, JSON.stringify(i));
  await ctx.close();
  state.mode = "ok";
}

// the gallery: indexable page with the snippets as plain text, and the generator makes a snippet that frames and renders on another origin
{
  const { p, ctx, errors } = await open(`${A}/embed/`, [1100, 900]);
  const g = await p.evaluate(() => ({ robots: document.querySelector('meta[name="robots"]').content, h1: document.querySelector("h1").textContent, pre: [...document.querySelectorAll("pre.snip")].map((e) => e.textContent), gen: !document.getElementById("gen").hidden }));
  check("the gallery is indexable, has its heading, five plain-text snippets and an active generator", /index,follow/.test(g.robots) === (process.env.SITE_NOINDEX !== "1") && g.pre.length === 5 && g.pre.every((s) => s.startsWith(`<iframe src="${SITE.url}/embed/`)) && g.gen, JSON.stringify(g));
  await p.selectOption("#g-widget", "earthquakes");
  await p.selectOption("#g-size", "600x400");
  await p.check('input[name="g-theme"][value="light"]');
  const snip = await p.inputValue("#g-out");
  check("the generator's snippet has the chosen widget, size and theme, a title, lazy loading and a credit line", snip.includes(`src="${SITE.url}/embed/earthquakes/?theme=light"`) && snip.includes('width="600" height="400"') && /title="[^"]+"/.test(snip) && snip.includes('loading="lazy"') && /Live data by <a href="[^"]+earthquakes-today\/">Radar Around You<\/a>/.test(snip) && !/nofollow/.test(snip), snip);
  await p.selectOption("#g-widget", "tonights-sky");
  await p.selectOption("#g-city", "tokyo");
  const sky = await p.inputValue("#g-out");
  check("for the sky widget the generator adds the city, and the credit links that city's page", sky.includes("/embed/tonights-sky/?city=tokyo&amp;theme=light") && sky.includes("/tonights-sky/tokyo/\">"), sky);
  const pv = await p.frameLocator("#g-preview iframe").locator("#w").getAttribute("data-state", { timeout: 30000 }).catch(() => null);
  check("the generator's preview frame loads the widget", ["loading", "ok"].includes(pv), String(pv));
  check("no console errors on the gallery", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // the snippet in a host page on another origin (its address pointed at the local server A instead of the site's own)
  hostBody = snip.split(SITE.url).join(A);
  const h = await open(`${B}/`, [900, 700]);
  const fr = await h.p.waitForSelector("iframe", { timeout: 30000 });
  const frame = await fr.contentFrame();
  const framed = frame && (await frame.waitForFunction(() => document.getElementById("w").getAttribute("data-state") === "ok", null, { timeout: 30000 }).then(() => true, () => false));
  const inside = framed ? await frame.evaluate(() => ({ sum: document.getElementById("sum").textContent, origin: location.origin, credit: document.getElementById("credit").textContent })) : null;
  const line = await h.p.evaluate(() => { const a = document.querySelector("body > p a"); return a && { text: a.textContent, rel: a.getAttribute("rel"), visible: a.getBoundingClientRect().height > 0 }; });
  check("pasted into a page on another origin, the snippet frames the widget and it renders its data", framed && inside.origin === A && /\d/.test(inside.sum) && inside.credit === "Radar Around You", JSON.stringify(inside));
  check("the host page shows the plain credit line under the frame, without nofollow forced on it", line && line.text === "Radar Around You" && line.visible && line.rel === null, JSON.stringify(line));
  check("no console errors on the host page", h.errors.length === 0, h.errors.join(" | "));
  await h.ctx.close();
}

// small frames: at 280 by 200 and 240 by 180 (a phone narrower than the snippet's size, with max-width:100%) the credit link lies wholly
// inside the frame in every state: loading data, out of date, failed, and a very long place name
for (const size of [[280, 200], [240, 180]]) for (const [mode, ids] of [["ok", WIDGETS.map((w) => w.id)], ["stale", ["earthquakes", "aurora", "tropical-storms", "wildfires"]], ["blocked", WIDGETS.map((w) => w.id)], ["long", ["earthquakes"]]]) {
  state.mode = mode;
  for (const id of ids) {
    const { p, ctx } = await open(`${A}/embed/${id}/`, size);
    await settled(p); await p.waitForTimeout(300);
    const i = await info(p);
    const zone = await p.evaluate(() => (document.getElementById("when").textContent.match(/UTC|\d\d:\d\d/) || [""])[0] && document.getElementById("when").getBoundingClientRect().right <= innerWidth + 0.5);
    check(`${id} at ${size.join("x")}, ${mode}: the credit link lies inside the frame and nothing scrolls`, i.credit.visible && !i.overflow, JSON.stringify({ credit: i.credit, overflow: i.overflow, state: i.state }));
    if (mode !== "blocked") check(`${id} at ${size.join("x")}, ${mode}: the data time in the header is shown whole`, zone, String(zone));
    await ctx.close();
  }
}
state.mode = "ok";

// polling: one look at the manifest per period, none while the page is hidden and one when it shows again, longer waits after failures,
// never two requests at once, and an unchanged feed version not downloaded again (Playwright's fake clock moves the timers)
{
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.clock.install();
  hits.length = 0; maxOpen = 0;
  await p.goto(`${A}/embed/earthquakes/`, { waitUntil: "load" });
  await settled(p);
  const man = () => hits.filter((h) => h === "live/manifest.json").length, feed = () => hits.filter((h) => h.startsWith("live/quakes/")).length;
  const step = async (ms) => { await p.clock.fastForward(ms); await p.waitForTimeout(600); };
  const m0 = man();
  await step(290e3); const mEarly = man();
  await step(20e3); const m1 = man();
  check("polling: no look before 300 s, one after it", m0 === 1 && mEarly === 1 && m1 === 2, JSON.stringify({ m0, mEarly, m1 }));
  check("polling: the unchanged feed file is not downloaded again", feed() === 1, String(feed()));
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => true, configurable: true }); Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await step(310e3); await step(310e3); await step(310e3);
  const m2 = man();
  check("polling: nothing is fetched while the page is hidden", m2 === m1, JSON.stringify({ m1, m2 }));
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => false, configurable: true }); Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await p.waitForTimeout(800);
  const m3 = man();
  check("polling: one look when the page shows again", m3 === m2 + 1, JSON.stringify({ m2, m3 }));
  state.mode = "blocked";
  await step(310e3); const f1 = man();
  await step(310e3); const f2 = man();
  await step(300e3); const f3 = man();
  check("polling: after a failure the next look waits twice as long (600 s)", f1 === m3 + 1 && f2 === f1 && f3 === f1 + 1, JSON.stringify({ m3, f1, f2, f3 }));
  const st = await p.evaluate(() => document.getElementById("w").getAttribute("data-state"));
  check("polling: a failed look keeps the data already shown", st === "ok", st);
  check("polling: never more than one request into the live folder at a time", maxOpen === 1, String(maxOpen));
  state.mode = "ok";
  await ctx.close();
}

// screenshots for a person to look at (SHOTS=<folder>)
if (process.env.SHOTS) {
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  for (const w of WIDGETS) for (const scheme of ["light", "dark"]) for (const size of [[240, 180], [280, 200], [600, 400], [800, 450]]) {
    const { p, ctx } = await open(`${A}/embed/${w.id}/${w.city ? "?city=london" : ""}`, size, { scheme, motion: "reduce" });
    await settled(p); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(process.env.SHOTS, `${w.id}-${scheme}-${size.join("x")}.png`) });
    await ctx.close();
  }
  for (const [mode, id, size, q] of [["calm", "tropical-storms", [400, 300], ""], ["stale", "earthquakes", [280, 200], ""], ["stale", "earthquakes", [240, 180], ""], ["long", "earthquakes", [240, 180], ""], ["blocked", "aurora", [280, 200], ""], ["blocked", "tonights-sky", [280, 200], "?city=tromso"], ["ok", "tonights-sky", [600, 400], "?city=tromso"], ["ok", "tonights-sky", [280, 200], "?city=tromso"]]) {
    state.mode = mode;
    const s = await open(`${A}/embed/${id}/${q}`, size, { scheme: "light", motion: "reduce" });
    await settled(s.p); await s.p.waitForTimeout(500);
    await s.p.screenshot({ path: path.join(process.env.SHOTS, `${id}${q ? "-tromso" : ""}-${mode}-light-${size.join("x")}.png`) });
    await s.ctx.close();
  }
  state.mode = "ok";
  // Tromsø at midsummer, with the page's clock set to 21 June 2026 (the pretend cloud forecast is then in the future and not used)
  for (const size of [[600, 400], [280, 200]]) {
    const c = await browser.newContext({ viewport: { width: size[0], height: size[1] }, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
    const pg = await c.newPage();
    await pg.clock.install({ time: new Date("2026-06-21T21:30:00Z") });
    await pg.goto(`${A}/embed/tonights-sky/?city=tromso`); await settled(pg); await pg.waitForTimeout(500);
    await pg.screenshot({ path: path.join(process.env.SHOTS, `tonights-sky-tromso-midsummer-dark-${size.join("x")}.png`) });
    await c.close();
  }
  const { p, ctx } = await open(`${A}/embed/`, [1100, 1400], { scheme: "dark" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(process.env.SHOTS, "gallery.png"), fullPage: false });
  await ctx.close();
}

await browser.close();
serveA.close(); serveB.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} embed checks passed`);
process.exit(bad ? 1 : 0);
