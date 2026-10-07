// Browser check of /satellites-near-me/ (site/pages-near.mjs, site/near-page.mjs, site/near-calc.mjs): the built site (dist/site) served by
// a real local web server on 127.0.0.1, with a pretend live folder made from the bundled satellite files moved to "now" (every epoch, and
// so every orbit, shifted by the same amount), so the answers are those of real orbits whatever the date of the run.
// usage: npm run e2e:near (it builds the site first). SHOTS=<folder> also saves screenshots at 360 and 1200 px.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./harness.mjs";

const site = fileURLToPath(new URL("./dist/site/", import.meta.url));
if (!fs.existsSync(site + "satellites-near-me/index.html")) { console.error("dist/site/satellites-near-me/index.html is missing; run npm run build:hosting first"); process.exit(2); }
const MIME = { ".json": "application/json", ".bin": "application/octet-stream", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(ok ? "ok  " : "FAIL", name, ok ? "" : String(detail).slice(0, 400)); };

// ------------------------------------------------------------------ the pretend live folder
const pub = (f) => fs.readFileSync(path.join(site, f));
const baseMeta = JSON.parse(pub("meta.json"));
const NOW = Date.now();
// one published version: the bundled orbits moved so that the newest element set is `ageMin` minutes before now (shift extra minutes to
// make a second version whose answers differ)
function version(name, fetchedAt, shiftMin) {
  const delta = (NOW - Date.parse(baseMeta.taken)) + shiftMin * 60000;
  const precise = JSON.parse(pub("precise.json"));
  for (const r of precise.rows) r[1] = new Date(Date.parse(r[1] + "Z") + delta).toISOString().replace("Z", "");
  const satmeta = { ref: baseMeta.ref + delta, taken: new Date(Date.parse(baseMeta.taken) + delta).toISOString().replace(/\.\d{3}Z$/, "Z"), count: baseMeta.count, kinds: baseMeta.kinds, owners: baseMeta.owners, ownerCodes: baseMeta.ownerCodes, sites: baseMeta.sites, siteCodes: baseMeta.siteCodes, purposes: baseMeta.purposes, newIdx: baseMeta.newIdx, health: baseMeta.health, preciseCount: baseMeta.preciseCount };
  const files = new Map([["swarm.bin", pub("swarm.bin")], ["ids.bin", pub("ids.bin")], ["details.bin", pub("details.bin")], ["names.txt", pub("names.txt")], ["precise.json", Buffer.from(JSON.stringify(precise))], ["satmeta.json", Buffer.from(JSON.stringify(satmeta))]]);
  const feed = { label: "Satellite orbits", source: "CelesTrak", status: "ok", refreshSec: 7200, staleAfterSec: 21600, version: name, fetchedAt, checkedAt: fetchedAt, sourceTime: fetchedAt, count: baseMeta.count,
    files: Object.fromEntries([...files.keys()].map((f) => [f, `satellites/${name}/${f}`])), sizes: Object.fromEntries([...files].map(([f, b]) => [f, b.length])) };
  return { name, feed, files };
}
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const V1 = version("20990101T000001Z", iso(NOW - 3600000), -60);
const V2 = version("20990101T000002Z", iso(NOW - 600000), -10);
const OLD = version("20990101T000003Z", iso(Date.parse(baseMeta.taken) - 86400000), -60);
// collected an hour ago (newer than the bundle), but with element sets from 62 hours earlier (many over 3 days old) or 100 (almost all)
const AGING = version("20990101T000004Z", iso(NOW - 3600000), -62 * 60);
const ANCIENT = version("20990101T000005Z", iso(NOW - 3600000), -100 * 60);
// a version the manifest names whose files are missing (a broken publish)
const BROKEN = { name: "20990101T000006Z", feed: { ...V2.feed, version: "20990101T000006Z", fetchedAt: iso(NOW), checkedAt: iso(NOW), files: Object.fromEntries(Object.keys(V2.feed.files).map((f) => [f, `satellites/20990101T000006Z/${f}`])) }, files: new Map() };
// v1, v2, older (a feed older than the bundle), missing (no live folder), aging, ancient, broken
const state = { mode: "v1" };
const VERSIONS = { v1: V1, v2: V2, older: OLD, aging: AGING, ancient: ANCIENT, broken: BROKEN };
const manifestOf = (v) => ({ schema: 1, pipeline: 1, generatedAt: v.feed.fetchedAt, pollSec: 300, feeds: { satellites: v.feed } });
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel.startsWith("live/")) {
    hits.push(rel);
    const v = VERSIONS[state.mode] || V1;
    if (state.mode === "missing") { res.writeHead(404); return res.end(); }
    if (rel === "live/manifest.json") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(manifestOf(v))); }
    for (const w of Object.values(VERSIONS)) {
      const m = /^live\/satellites\/([^/]+)\/(.+)$/.exec(rel);
      if (m && m[1] === w.name && w.files.has(m[2])) { res.writeHead(200, { "content-type": MIME[path.extname(rel)] }); return res.end(w.files.get(m[2])); }
    }
    res.writeHead(404); return res.end();
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(site, rel);
  if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html><body>Not found</body></html>"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
const A = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
const PAGE = `${A}/satellites-near-me/`;

// The state the bundled copy should give right now: the page's own preparation and rules on the built site's files.
const N = await import("./site/near.mjs");
const UI = await import("./site/near-ui.mjs");
function expectedBundledState() {
  const files = { meta: baseMeta, swarm: pub("swarm.bin"), ids: pub("ids.bin"), details: pub("details.bin"), names: pub("names.txt").toString("utf8"), precise: JSON.parse(pub("precise.json")) };
  return UI.staleState(N.prepareSatellites(N.decodeFeed(files), Date.now()).counts).level;
}

// ------------------------------------------------------------------ helpers
const browser = await launch();
async function open(query = "", { width = 1200, height = 900, js = true, init = null, clock = false, permissions = null, throttle = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: js, serviceWorkers: "block", colorScheme: "dark", ...(permissions ? { permissions } : {}) });
  const p = await ctx.newPage(), errors = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  // long tasks on the main thread, from the start
  // every change of the live region's text, from the start
  await p.addInitScript(() => { window.__said = []; document.addEventListener("DOMContentLoaded", () => { const a = document.getElementById("nm-announce"); if (a) new MutationObserver(() => window.__said.push(a.textContent)).observe(a, { childList: true, characterData: true, subtree: true }); }); });
  await p.addInitScript(() => { window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch {} });
  if (init) await p.addInitScript(init);
  if (clock) await p.clock.install();
  if (throttle) { const cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
  await p.goto(PAGE + query, { waitUntil: "load", timeout: 60000 });
  return { p, ctx, errors };
}
const done = (p, prev = "") => p.waitForFunction((x) => { const t = document.getElementById("nm-announce").textContent; return t && t !== x; }, prev, { timeout: 90000 }).then(() => true, () => false);
const announce = (p) => p.evaluate(() => document.getElementById("nm-announce").textContent);
const table = (p) => p.evaluate(() => {
  const t = document.querySelectorAll("#nm-out table.nm-table");
  const day = t[t.length - 1];
  if (!day) return [];
  return [...day.querySelectorAll("tbody tr")].map((tr) => {
    const c = tr.querySelectorAll("td"), d = /^([\d,]+) km(?: ± ([\d,]+))?/.exec(c[2].textContent);
    return { t: Date.parse(c[0].querySelector("time").getAttribute("datetime")), km: Number(d[1].replace(/,/g, "")), u: d[2] ? Number(d[2].replace(/,/g, "")) : 0, status: c[2].querySelector(".nm-chip").textContent, name: c[1].querySelector("strong").textContent };
  });
});
const source = (p) => p.evaluate(() => (document.getElementById("nm-source") || {}).textContent || "");
// screenshots for a person to look at (SHOTS=<folder>): the screen at the top, the form, the answer, the table and the explanation
async function shots(p, prefix) {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: path.join(process.env.SHOTS, `${prefix}-0-top.png`) });
  await p.evaluate(() => { const tr = [...document.querySelectorAll("#nm-out table.nm-table:not(.nm-now) tbody tr")].find((x) => /time uncertain|± [1-9]\d\d s/.test(x.textContent)); if (tr) tr.id = "nm-shot-slow"; });
  for (const [i, id] of [[1, "nm-tool"], [2, "nm-now-h"], [3, "nm-day-h"], [4, "nm-map"], [5, "expect"], [6, "accuracy"], [7, "nm-shot-slow"]]) {
    if (!(await p.evaluate((x) => { const e = document.getElementById(x); if (e) e.scrollIntoView(); return !!e; }, id))) continue;
    await p.screenshot({ path: path.join(process.env.SHOTS, `${prefix}-${i}-${id}.png`) });
  }
}

// ------------------------------------------------------------------ 1. the default place with a live feed newer than the bundle
{
  state.mode = "v1"; hits.length = 0;
  const { p, ctx, errors } = await open();
  check("the page loads with its h1 and the form shown", await p.evaluate(() => document.querySelector("h1").textContent.startsWith("Satellites passing near you") && !document.getElementById("nm-form").hidden));
  const t0 = Date.now();
  check("a first answer arrives (download and calculation)", await done(p), await announce(p));
  console.log(`     first answer after ${Date.now() - t0} ms (download of the satellite files included)`);
  check("the default place is Pune, labelled as the default", await p.evaluate(() => document.getElementById("nm-place-name").textContent === "Pune" && /default place/.test(document.getElementById("nm-place-note").textContent)));
  check("the default place is not written to the address or storage", await p.evaluate(() => location.search === "" && localStorage.getItem("radar-near-place") === null));
  const src = await source(p);
  check("the live feed newer than the bundle is used and named, with its time", /Using orbit data from .* UTC, live feed/.test(src) && hits.some((h) => h.includes(V1.name)), src);
  const rows = await table(p);
  check("the next 24 hours table is not empty", rows.length > 0, rows.length);
  check("rows are in time order", rows.every((r, i) => !i || r.t >= rows[i - 1].t));
  check("every row is within the radius plus its uncertainty, and its mark matches", rows.every((r) => r.km <= 100 + r.u && (r.status === "within" ? r.km <= 100 : r.km >= 100)), JSON.stringify(rows.find((r) => !(r.km <= 100 + r.u))));
  check("every row is in the next 24 hours", rows.every((r) => r.t > NOW - 120000 && r.t < NOW + 24 * 3600000 + 300000));
  check("the table has a caption and header scopes; the map is a figure with a caption", await p.evaluate(() => !!document.querySelector("#nm-out table caption") && [...document.querySelectorAll("#nm-out th")].every((th) => th.getAttribute("scope") === "col") && !!document.querySelector("#nm-map svg[role=img]") && !!document.querySelector("#nm-map figcaption")));
  check("the right-now part answers (a table, or the expected-count explanation)", await p.evaluate(() => { const h = document.getElementById("nm-now-h"); const n = h && h.nextElementSibling; return !!n && (/That is normal/.test(n.textContent) || /ground point within/.test(n.textContent)); }));
  await p.waitForTimeout(1500);
  const said1 = await p.evaluate(() => window.__said);
  check("the answer was announced once, politely (one change of the live region's text)", said1.length === 1 && /^Done: for Pune/.test(said1[0]) && await p.evaluate(() => document.getElementById("nm-announce").getAttribute("aria-live") === "polite"), JSON.stringify(said1));
  check("no NaN, undefined or Infinity in the answer", await p.evaluate(() => !/NaN|undefined|Infinity/.test(document.getElementById("nm-tool").textContent)));
  check("each row gives a time uncertainty and a distance uncertainty", await p.evaluate(() => [...document.querySelectorAll("#nm-out table.nm-table:not(.nm-now) tbody tr")].every((tr) => /± \d+ s|time uncertain by about \d+ min/.test(tr.cells[0].textContent) && /km ± \d/.test(tr.cells[2].textContent))));
  // a second, compute-only run: a new distance (the data is already downloaded)
  const before = await announce(p);
  const t1 = Date.now();
  await p.evaluate(() => { window.__long = []; });
  await p.selectOption("#nm-radius", "25");
  check("changing the distance gives a new answer", await done(p, before));
  const ms = Date.now() - t1;
  console.log(`     calculation for 25 km took ${ms} ms in the worker`);
  const rows25 = await table(p);
  check("the 25 km answer differs and every row is within 25 km plus its uncertainty", (await announce(p)) !== before && rows25.every((r) => r.km <= 25 + r.u), await announce(p));
  check("the address and storage now hold the chosen distance", await p.evaluate(() => /r=25/.test(location.search) && /"r":25/.test(localStorage.getItem("radar-near-place") || "")));
  const t2 = Date.now(), b2 = await announce(p);
  await p.selectOption("#nm-radius", "100");
  await done(p, b2);
  console.log(`     calculation for 100 km took ${Date.now() - t2} ms in the worker`);
  const longest = await p.evaluate(() => Math.max(0, ...window.__long));
  check("the main thread has no long task over 200 ms while the worker computes", longest < 200, `${longest} ms`);
  console.log(`     longest main-thread task: ${Math.round(longest)} ms`);
  // order by distance, then show all rows
  await p.check("#nm-order-distance");
  const byD = await table(p);
  check("ordering by distance sorts the table nearest first", byD.length > 0 && byD.every((r, i) => !i || r.km >= byD[i - 1].km));
  await p.click("#nm-more");
  check("after showing all rows, focus is on the first new row", await p.evaluate(() => { const rows = document.querySelectorAll("#nm-out table.nm-table:not(.nm-now) tbody tr"); return document.activeElement === rows[25]; }));
  const all = await table(p);
  check("show all lists up to 100 rows and says how many more there are", all.length > byD.length && all.length <= 100 && await p.evaluate(() => /more passes are not in the table/.test((document.getElementById("nm-more-note") || {}).textContent || "")), all.length);
  check("no console errors (live run)", errors.length === 0, errors.join(" | "));
  await shots(p, "near-1200");
  await ctx.close();
}

// ------------------------------------------------------------------ 2. a mid-session update: new data, one polite update, place and scroll kept
{
  state.mode = "v1";
  const { p, ctx, errors } = await open("?lat=51.5074&lon=-0.1278&r=50&name=London&tz=Europe/London", { clock: true });
  check("a link's place and distance are used", await done(p) && await p.evaluate(() => document.getElementById("nm-place-name").textContent === "London" && document.getElementById("nm-radius").value === "50"));
  const first = await announce(p), firstRows = await table(p);
  await p.evaluate(() => { document.getElementById("nm-day-h").scrollIntoView(); window.__y = window.scrollY; window.__said = []; });
  await p.clock.fastForward(301000);
  await p.waitForTimeout(3000);
  check("nothing changes while the feed is the same", (await announce(p)) === first);
  state.mode = "v2";
  await p.clock.fastForward(301000);
  check("new data: the answer is worked out again", await done(p, first));
  const said = await p.evaluate(() => window.__said);
  check("the update is announced once, saying it is an update with the new data time", said.length === 1 && /^Updated with orbit data from .* UTC, live feed\. Done: for London within 50 km/.test(said[0]), JSON.stringify(said));
  const rows2 = await table(p);
  check("the results changed with the new data", JSON.stringify(rows2.slice(0, 5)) !== JSON.stringify(firstRows.slice(0, 5)));
  check("the place, the distance and the scroll position are kept", await p.evaluate(() => document.getElementById("nm-place-name").textContent === "London" && document.getElementById("nm-radius").value === "50" && Math.abs(window.scrollY - window.__y) < 5));
  check("the source line names the new data", (await source(p)).includes("live feed") && hits.some((h) => h.includes(V2.name)));
  // a broken publish: the manifest names a version whose files are missing. One attempt, no redraw, no announcement, and no new attempt
  const v2Answer = await announce(p);
  await p.evaluate(() => { window.__said = []; });
  state.mode = "broken"; hits.length = 0;
  for (let k = 0; k < 4; k++) { await p.clock.fastForward(1900000); await p.waitForTimeout(2500); }
  const triedBroken = hits.filter((h) => h.includes(BROKEN.name)).length;
  check("a broken publish is tried once and then left alone; the answer and its announcement stay", triedBroken >= 1 && triedBroken <= 6 && (await p.evaluate(() => window.__said.length)) === 0 && (await announce(p)) === v2Answer && (await source(p)).includes("live feed"), `${triedBroken} requests, said ${JSON.stringify(await p.evaluate(() => window.__said))}`);
  check("no console errors (update)", errors.filter((e) => !/404|Failed to load resource/.test(e)).length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ 2b. old data: a warning when many element sets are too old, no answer when almost all are
for (const [mode, want] of [["aging", "warn"], ["ancient", "none"]]) {
  state.mode = mode;
  const { p, ctx, errors } = await open("?lat=18.52&lon=73.86&r=100&name=Pune");
  check(`${mode} data: an answer arrives`, await done(p));
  const r = await p.evaluate(() => ({ old: (document.getElementById("nm-old") || {}).textContent || "", text: document.getElementById("nm-tool").textContent, rows: document.querySelectorAll("#nm-out table.nm-table tbody tr").length, firstAfterSource: (document.getElementById("nm-source") || {}).nextElementSibling ? document.getElementById("nm-source").nextElementSibling.id : "" }));
  if (want === "warn") check("many old element sets: a warning at the top of the answer, and the answer still shown", /^Warning: [\d,]+ of the [\d,]+ active satellites \(\d+%\) are left out/.test(r.old) && r.firstAfterSource === "nm-old" && r.rows > 0, JSON.stringify(r).slice(0, 300));
  else check("almost all element sets old: no answer, a plain too-old message, no tables", /too old/.test(await p.evaluate(() => (document.getElementById("nm-old-h") || {}).textContent || "")) && /last 3 days/.test(r.old) && r.rows === 0 && /orbit data is too old/.test(await announce(p)), JSON.stringify(r).slice(0, 300));
  check(`${mode} data: no NaN, undefined or Infinity anywhere`, !/NaN|undefined|Infinity/.test(r.text));
  check(`${mode} data: no console errors`, errors.length === 0, errors.join(" | "));
  if (process.env.SHOTS) { await p.evaluate(() => document.getElementById("nm-source").scrollIntoView()); await p.screenshot({ path: path.join(process.env.SHOTS, `near-1200-old-${mode}.png`) }); }
  await ctx.close();
}
state.mode = "v1";

// ------------------------------------------------------------------ 2c. a station row at 25 km, and a new launch's wide uncertainty
{
  state.mode = "v1";
  // where the ISS and a new launch below 450 km will be an hour from now, in the pretend live data (V1)
  const v1 = { meta: { ...baseMeta, ...JSON.parse(V1.files.get("satmeta.json")) }, swarm: V1.files.get("swarm.bin"), ids: V1.files.get("ids.bin"), details: V1.files.get("details.bin"), names: V1.files.get("names.txt").toString("utf8"), precise: JSON.parse(V1.files.get("precise.json")) };
  const prep = N.prepareSatellites(N.decodeFeed(v1), NOW);
  const spot = (sat) => { const g = N.groundDistanceKm({ lat: 0, lon: 0 }, N.stateAt(sat, NOW + 3600000).ecef); return `?lat=${(g.lat + 0.05).toFixed(4)}&lon=${g.lon.toFixed(4)}`; };
  const iss = prep.sats.find((s) => s.id === 25544);
  const { p, ctx, errors } = await open(spot(iss) + "&r=25&name=Under%20the%20ISS");
  await done(p);
  const row = await p.evaluate(() => { const tr = [...document.querySelectorAll("#nm-out table.nm-table:not(.nm-now) tbody tr")].find((x) => /ISS \(ZARYA\)/.test(x.textContent)); if (tr) tr.id = "nm-shot-iss"; return tr ? tr.textContent : ""; });
  check("the ISS is listed at 25 km with a station's small uncertainty", /km ± 1 /.test(row) && /± 10 s/.test(row) && /within/.test(row), row);
  if (process.env.SHOTS) { await p.evaluate(() => document.getElementById("nm-shot-iss").scrollIntoView()); await p.screenshot({ path: path.join(process.env.SHOTS, "near-1200-iss-25km.png") }); }
  await ctx.close();
  const fresh = prep.sats.find((s) => s.exact && s.recent && !s.station && s.band === "low-under-450");
  const f = await open(spot(fresh) + "&r=100&name=Under%20a%20new%20launch");
  await done(f.p);
  const frow = await f.p.evaluate((name) => { const tr = [...document.querySelectorAll("#nm-out table.nm-table:not(.nm-now) tbody tr")].find((x) => x.querySelector("strong").textContent === name); if (tr) tr.id = "nm-shot-new"; return tr ? tr.textContent : ""; }, fresh.name);
  check("a new launch still raising its orbit carries the wide uncertainty of its group", /launched in the last 30 days/.test(frow) && Number((/km ± (\d+)/.exec(frow) || [0, 0])[1]) >= 20 && /± \d{3} s|time uncertain by about \d+ min/.test(frow), frow);
  if (process.env.SHOTS) { await f.p.evaluate(() => document.getElementById("nm-shot-new").scrollIntoView()); await f.p.screenshot({ path: path.join(process.env.SHOTS, "near-1200-new-launch.png") }); }
  check("no console errors (station and new launch)", errors.length === 0 && f.errors.length === 0, [...errors, ...f.errors].join(" | "));
  await f.ctx.close();
}

// ------------------------------------------------------------------ 3. the live feed older than the bundle, or missing: the bundled copy
for (const mode of ["older", "missing"]) {
  state.mode = mode;
  const { p, ctx, errors } = await open("?lat=18.52&lon=73.86&r=100&name=Pune");
  check(`${mode} live feed: an answer from the bundled copy`, await done(p));
  const src = await source(p);
  check(`${mode} live feed: the page says it used the bundled snapshot and why`, /Using the bundled snapshot of .* UTC/.test(src) && (mode === "older" ? /older than the bundled copy/.test(src) : /could not be read/.test(src)), src);
  // the bundled copy's age depends on the day of the run, so the expected state is worked out here with the page's own rules
  const want = expectedBundledState();
  const got = await p.evaluate(() => ({ text: document.getElementById("nm-out").textContent, tooOld: !!document.getElementById("nm-old-h"), warn: /^Warning:/.test((document.getElementById("nm-old") || {}).textContent || "") }));
  const state = got.tooOld ? "none" : got.warn ? "warn" : "ok";
  check(`${mode} live feed: the state the bundled copy's age calls for (${want}), and no NaN`, state === want && !/NaN|undefined|Infinity/.test(got.text), `page ${state}, expected ${want}`);
  check(`${mode} live feed: no console errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
state.mode = "v1";

// ------------------------------------------------------------------ 4. bad input
{
  const { p, ctx, errors } = await open("?lat=999&lon=abc&r=7&name=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  check("invalid address values fall back to the default place and distance", await done(p) && await p.evaluate(() => document.getElementById("nm-place-name").textContent === "Pune" && document.getElementById("nm-radius").value === "100"));
  check("the page says the address values were left out", await p.evaluate(() => /not valid/.test(document.getElementById("nm-query-note").textContent)));
  check("no element came from the address", await p.evaluate(() => !document.querySelector("#nm-tool img")));
  const name = await open("?lat=10&lon=20&name=%3Cb%3Ebold%3C%2Fb%3E");
  check("a name with markup is refused and the coordinates are used", await done(name.p) && await name.p.evaluate(() => document.getElementById("nm-place-name").textContent === "10.00° N, 20.00° E" && !document.querySelector("#nm-place-name b")));
  await name.ctx.close();
  // typed coordinates
  await p.fill("#nm-lat", "95"); await p.fill("#nm-lon", "10"); await p.click(".nm-coords button[type=submit]");
  check("bad typed coordinates show a message next to the field", await p.evaluate(() => /-90 to 90/.test(document.getElementById("nm-lat-err").textContent) && document.getElementById("nm-lat").getAttribute("aria-invalid") === "true"));
  const before = await announce(p);
  await p.fill("#nm-lat", "-33.87"); await p.fill("#nm-lon", "151.21"); await p.press("#nm-lon", "Enter");
  check("good typed coordinates give a new answer for that place", await done(p, before) && await p.evaluate(() => document.getElementById("nm-place-name").textContent === "33.87° S, 151.21° E" && document.getElementById("nm-lat-err").textContent === ""));
  check("no console errors (bad input)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ 5. location refused
{
  const { p, ctx, errors } = await open("", { permissions: [] });
  await done(p);
  const before = await announce(p);
  await p.click("#nm-geo");
  await p.waitForFunction(() => /not shared|could not be found|cannot give/.test(document.getElementById("nm-geo-status").textContent), null, { timeout: 20000 }).catch(() => {});
  check("a refused position says so and changes nothing", await p.evaluate(() => /not shared|could not be found|cannot give/.test(document.getElementById("nm-geo-status").textContent) && document.getElementById("nm-place-name").textContent === "Pune"), await p.evaluate(() => document.getElementById("nm-geo-status").textContent));
  await p.selectOption("#nm-city", "tokyo");
  check("the page stays usable after the refusal", await done(p, before) && await p.evaluate(() => document.getElementById("nm-place-name").textContent === "Tokyo"));
  check("no console errors (location refused)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
// location given: used, not stored, no link offered
{
  const ctx0 = { permissions: ["geolocation"] };
  const { p, ctx, errors } = await open("", ctx0);
  await ctx.setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
  await done(p);
  const before = await announce(p);
  await p.click("#nm-geo");
  check("the device's position is used", await done(p, before) && await p.evaluate(() => document.getElementById("nm-place-name").textContent === "Your location"));
  check("the device's position is not stored, not in the address, and no link is offered", await p.evaluate(() => location.search === "" && !/48\.8|2\.35/.test(localStorage.getItem("radar-near-place") || "") && document.getElementById("nm-share").hidden));
  check("no console errors (location given)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ 6. no worker: the same answer on the main thread, in slices
{
  const { p, ctx, errors } = await open("?lat=18.52&lon=73.86&r=100&name=Pune", { init: () => { delete window.Worker; } });
  check("without workers the page still answers", await done(p));
  const rows = await table(p);
  check("the main-thread answer has rows in time order", rows.length > 0 && rows.every((r, i) => !i || r.t >= rows[i - 1].t));
  const longest = await p.evaluate(() => Math.max(0, ...window.__long));
  console.log(`     main-thread fallback: longest task ${Math.round(longest)} ms; tasks over 50 ms: ${await p.evaluate(() => window.__long.map(Math.round).join(", "))}`);
  check("the main-thread fallback keeps tasks under 200 ms", longest < 200, `${longest} ms`);
  check("no console errors (no worker)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ 7. a phone and a slow phone
{
  const { p, ctx, errors } = await open("", { width: 360, height: 780 });
  await done(p);
  check("at 360 px the page does not scroll sideways (tables scroll in their own box)", await p.evaluate(() => document.documentElement.scrollWidth <= 361), await p.evaluate(() => document.documentElement.scrollWidth));
  check("at 360 px every form control is inside the screen", await p.evaluate(() => [...document.querySelectorAll("#nm-form input, #nm-form select, #nm-form button")].every((e) => { const r = e.getBoundingClientRect(); return r.right <= 361 && r.left >= -1; })));
  check("no console errors (360 px)", errors.length === 0, errors.join(" | "));
  await shots(p, "near-360");
  await ctx.close();
}
{
  const { p, ctx } = await open("", { throttle: 4 });
  await done(p);
  const before = await announce(p), t = Date.now();
  await p.evaluate(() => { window.__long = []; });
  await p.selectOption("#nm-radius", "50");
  await done(p, before);
  const longest = await p.evaluate(() => Math.max(0, ...window.__long));
  console.log(`     with a 4x CPU slowdown: calculation for 50 km ${Date.now() - t} ms, longest main-thread task ${Math.round(longest)} ms`);
  check("with a 4x CPU slowdown the main thread has no task over 200 ms", longest < 200, `${longest} ms`);
  await ctx.close();
}
{
  // Chrome's CPU slowdown applies to the page's main thread, not to a worker's thread, so the calculation itself is timed slowed down here:
  // the main-thread fallback (no Worker) with the 4x slowdown, a new distance after the data is loaded
  const { p, ctx } = await open("", { throttle: 4, init: () => { delete window.Worker; } });
  await done(p);
  // one new distance, timed; a second attempt only if the first one had a task over the bound (a busy machine can stall one task)
  const attempt = async (r) => {
    const before = await announce(p), t = Date.now();
    await p.evaluate(() => { window.__long = []; });
    await p.selectOption("#nm-radius", r);
    await done(p, before);
    const longest = await p.evaluate(() => Math.max(0, ...window.__long));
    console.log(`     with a 4x CPU slowdown on the main thread (no worker): calculation for ${r} km ${Date.now() - t} ms, longest task ${Math.round(longest)} ms`);
    return longest;
  };
  let longest = await attempt("50");
  if (longest >= 200) longest = await attempt("25");
  check("with a 4x CPU slowdown and no worker, the sliced calculation keeps tasks under 200 ms (one retry allowed)", longest < 200, `${longest} ms`);
  await ctx.close();
}

// ------------------------------------------------------------------ 8. without JavaScript
{
  const { p, ctx } = await open("", { js: false });
  const r = await p.evaluate(() => ({ form: document.getElementById("nm-form").hidden, noscript: !!document.querySelector("noscript"), example: document.querySelectorAll("#example ~ .tablewrap tbody tr").length, text: document.body.innerText.length, expect: /How many satellites to expect/.test(document.body.innerText) }));
  check("without JavaScript: the explanation, the expected numbers and the example are there, the form is not", r.form && r.noscript && r.example >= 5 && r.expect && r.text > 4000, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
