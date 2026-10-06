// Browser check of the built content site (dist/site) served the way a real web host serves it: the raw files, html sent as plain
// "text/html" with no charset, and missing files answered with an html 404 page. The other browser suites wrap the app in a full
// document first, so they could not see the first Hostinger deployment stall at "Starting up".
// usage: npm run e2e:site (it builds the site first)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./harness.mjs";
import os from "node:os";
import { LIVE_FILES, HAZARD_FILES, RIGHT_NOW_FILE, EVENT_FILES } from "./site/livepages.mjs";
import { SKY_PAGES } from "./site/sky.mjs";

const site = fileURLToPath(new URL("./dist/site/", import.meta.url));
const MIME = { ".json": "application/json", ".bin": "application/octet-stream", ".webp": "image/webp", ".html": "text/html", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".js": "text/javascript" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail); };
if (!fs.existsSync(site + "index.html")) { console.error("dist/site/index.html is missing; run npm run build:hosting first"); process.exit(2); }

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, serviceWorkers: "block" });
const p = await ctx.newPage();
const problems = [], notFound = [];
p.on("console", (m) => { if (m.type() === "error" && !/Service Worker registration blocked|status of 404/.test(m.text())) problems.push("console.error: " + m.text().slice(0, 200)); });
p.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 200)));
p.on("requestfailed", (r) => problems.push(`request failed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
// home: another body for the home page (the comparison build without the text section below); missing files go to `missing`
const serve = (c, { home = null, missing = notFound } = {}) => c.route("https://radar.test/**", (route) => {
  const u = new URL(route.request().url());
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel === "" && home) return route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: home });
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(site, rel);
  if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    missing.push(u.pathname);
    return route.fulfill({ status: 404, headers: { "content-type": "text/html" }, body: "<html><body>Not found</body></html>" });
  }
  return route.fulfill({ status: 200, headers: { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, body: fs.readFileSync(f) });
});
await serve(ctx);

await p.goto("https://radar.test/", { waitUntil: "commit", timeout: 60000 });
const started = await p.waitForFunction(() => !document.getElementById("loader") && !!window.__radar, null, { timeout: 120000 }).then(() => true, () => false);
const loaderText = started ? "" : await p.evaluate(() => (document.getElementById("loader") || {}).innerText || "(no loader)").catch(() => "(unreadable)");
check("the home page starts: the loader goes away and the app is running", started, `still at: ${String(loaderText).replace(/\s+/g, " ").slice(0, 80)}; problems: ${problems.join(" | ")}`);
const doc = await p.evaluate(() => ({ compat: document.compatMode, charset: document.characterSet, lang: document.documentElement.lang, canvas: !!document.querySelector("canvas") && document.querySelector("canvas").width > 0 }));
check("standards mode, not quirks mode", doc.compat === "CSS1Compat", doc.compat);
check("read as UTF-8 although the server sent no charset", doc.charset === "UTF-8", doc.charset);
check("the page declares its language", doc.lang === "en", doc.lang);
check("the 3D view has a drawing surface", doc.canvas);
const robots = await p.evaluate(() => (document.head.querySelector('meta[name="robots"]') || {}).content);
const inHead = await p.evaluate(() => ({ title: !!document.head.querySelector("title"), description: !!document.head.querySelector('meta[name="description"]'), canonical: (document.head.querySelector('link[rel="canonical"]') || {}).href, ld: !!document.head.querySelector('script[type="application/ld+json"]'), og: !!document.head.querySelector('meta[property="og:title"]') }));
check("the search tags (title, description, canonical, social, structured data) are in head", inHead.title && inHead.description && inHead.ld && inHead.og && /^https:\/\/[^/]+\/$/.test(inHead.canonical || ""), JSON.stringify(inHead));
const want = process.env.SITE_NOINDEX === "1" ? "noindex,nofollow" : "index,follow,max-image-preview:large";
check(`the page's robots tag matches SITE_NOINDEX (${want})`, robots === want, String(robots));
check("no page errors, no failed requests and no console errors on the home page", problems.length === 0, problems.join(" | "));
check("only the not-yet-connected live folder was missing", notFound.every((u) => u.startsWith("/live/")), notFound.join(" "));

// a content page and the crawler files, fetched as a web host would serve them
const page = await ctx.newPage();
await page.goto("https://radar.test/moon-phases/", { waitUntil: "load", timeout: 60000 });
const moon = await page.evaluate(() => ({ h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode }));
check("a content page loads with a heading, in standards mode, as UTF-8", !!moon.h1 && moon.compat === "CSS1Compat" && moon.charset === "UTF-8", JSON.stringify(moon));
const txt = fs.readFileSync(site + "robots.txt", "utf8");
check("robots.txt matches SITE_NOINDEX", process.env.SITE_NOINDEX === "1" ? txt.includes("Disallow: /") && !fs.existsSync(site + "sitemap.xml") : txt.includes("Allow: /") && fs.existsSync(site + "sitemap.xml"), txt.replace(/\n/g, " "));

const sat = await ctx.newPage();
await sat.goto("https://radar.test/how-many-satellites-in-orbit/", { waitUntil: "load", timeout: 60000 });
const satInfo = await sat.evaluate(() => ({
  h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode,
  charts: document.querySelectorAll("svg[role=img]").length, robots: (document.head.querySelector('meta[name="robots"]') || {}).content,
  canonical: (document.head.querySelector('link[rel="canonical"]') || {}).href, lead: ((document.querySelector(".lead") || {}).innerText || "").slice(0, 60),
}));
check("the satellite count page loads with its heading, four charts and an answer-first lead, in standards mode, as UTF-8",
  satInfo.h1 === "How many satellites are in orbit?" && satInfo.charts >= 4 && /^As of /.test(satInfo.lead) && satInfo.compat === "CSS1Compat" && satInfo.charset === "UTF-8", JSON.stringify(satInfo));
check("its robots tag matches SITE_NOINDEX", satInfo.robots === want, String(satInfo.robots));
check("sitemap-live.xml exists exactly when the site is indexable", process.env.SITE_NOINDEX === "1" ? !fs.existsSync(site + "sitemap-live.xml") : fs.existsSync(site + "sitemap-live.xml"));

await sat.close();

// the satellites by country hub and one country page, served raw: status, canonical, robots tag, a number and (on the country page) the map
for (const [url, want1] of [["https://radar.test/satellites-by-country/", "Which countries have the most satellites?"], ["https://radar.test/satellites-by-country/japan/", "How many satellites does Japan have?"]]) {
  const cp = await ctx.newPage();
  const resp = await cp.goto(url, { waitUntil: "load", timeout: 60000 });
  const info = await cp.evaluate(() => ({
    h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode,
    robots: (document.head.querySelector('meta[name="robots"]') || {}).content, canonical: (document.head.querySelector('link[rel="canonical"]') || {}).href,
    lead: ((document.querySelector(".lead") || {}).innerText || "").slice(0, 160), map: !!document.querySelector("svg.map[role=img] title"),
  }));
  const path1 = new URL(url).pathname;
  check(`${path1} answers 200 with its heading, an answer-first lead with a number, in standards mode, as UTF-8`,
    resp && resp.status() === 200 && info.h1 === want1 && /^As of /.test(info.lead) && /\d+ active satellites/.test(info.lead) && info.compat === "CSS1Compat" && info.charset === "UTF-8", JSON.stringify({ status: resp && resp.status(), ...info }));
  check(`${path1} has its own canonical address and a robots tag that matches SITE_NOINDEX`, (info.canonical || "").endsWith(path1) && info.robots === want, JSON.stringify(info));
  if (path1 !== "/satellites-by-country/") check(`${path1} carries the map as an inline SVG image`, info.map, JSON.stringify(info));
  await cp.close();
}

// the live hazard pages and the right-now hub, fetched raw (the HTML as the host sends it, no JavaScript run): status, canonical, robots
// tag, the headline number in the lead, the data time, and on the hub a link to every live page this build wrote. A hazard page whose data
// is not bundled in public/ is not written at deploy time (it arrives with the next pull), so it is reported and not checked here.
const rawGet = (url) => p.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, text: await r.text() }; }, url);
for (const f of [...HAZARD_FILES, RIGHT_NOW_FILE]) {
  const path1 = "/" + f.replace(/index\.html$/, "");
  if (!fs.existsSync(site + f)) {
    check(`${path1} is either written or left out because its data is not bundled`, f !== RIGHT_NOW_FILE && f !== "earthquakes-today/index.html", "the hub and the earthquake page are always written");
    continue;
  }
  const r = await rawGet("https://radar.test" + path1);
  const h = r.text;
  const canonical = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || "";
  const robots = (h.match(/<meta name="robots" content="([^"]+)">/) || [])[1];
  const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || "";
  check(`${path1} answers 200 raw, with its canonical address, a robots tag matching SITE_NOINDEX, a number in the lead and the data time`,
    r.status === 200 && canonical.endsWith(path1) && robots === want && /^As of /.test(lead) && /<strong>[^<]*\d/.test(lead) && /<time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">/.test(h),
    JSON.stringify({ status: r.status, canonical, robots, lead: lead.slice(0, 120) }));
  if (f === RIGHT_NOW_FILE) {
    const unlinked = LIVE_FILES.filter((x) => x !== RIGHT_NOW_FILE && fs.existsSync(site + x) && !h.includes(`href="../${x.replace(/index\.html$/, "")}"`));
    check("the right-now hub links every live page this build wrote", unlinked.length === 0, unlinked.join(" "));
  }
}

// the sky pages (tonight's sky hub, six cities, ISS today), fetched raw: written at deploy time from the forecast and precise.json bundled
// in public/, each answers 200 with its canonical address, a robots tag matching SITE_NOINDEX, the data time in the lead, the "What this
// means" findings first, its figures as inline SVG, MET Norway's credit where the cloud forecast is shown, and the shared script
for (const f of SKY_PAGES.map((x) => x.file)) {
  const path1 = "/" + f.replace(/index\.html$/, "");
  const r = await rawGet("https://radar.test" + path1);
  const h = r.text;
  const canonical = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || "";
  const robots = (h.match(/<meta name="robots" content="([^"]+)">/) || [])[1];
  const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || "";
  const firstH2 = (h.match(/<main[\s\S]*?<h2[^>]*>([^<]*)<\/h2>/) || [])[1];
  check(`${path1} answers 200 raw, with its canonical address, a robots tag matching SITE_NOINDEX, the data time in the lead and the findings first`,
    r.status === 200 && canonical.endsWith(path1) && robots === want && /^As of <time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">/.test(lead) && firstH2 === "What this means",
    JSON.stringify({ status: r.status, canonical, robots, lead: lead.slice(0, 120), firstH2 }));
  check(`${path1} carries its figures as inline SVG with captions and loads only the site's own live-pages.js`,
    /<figure>\s*<svg[^>]+role="img"/.test(h) && /<figcaption>/.test(h) && /<script src="(\.\.\/)+live-pages\.js" defer><\/script>/.test(h) && /<body data-live-v="1"/.test(h), path1);
  if (f !== "iss-today/index.html") check(`${path1} credits MET Norway visibly`, h.includes("The Norwegian Meteorological Institute, shortened MET Norway"), path1);
}
const js = await rawGet("https://radar.test/live-pages.js");
check("the shared live-pages.js is served", js.status === 200 && js.text.includes("function liveZones(d)"), String(js.status));
// ---- the fleet and events pages (site/pages-events.mjs). The Starlink tracker is written at deploy time from the bundled satellites;
// the launch and GDACS pages need data that public/ does not carry with a data time, so they are built here from the saved feeds of
// 6 October (test/fixtures/events) with the live build itself and served beside dist/site, as hosting/pull.php would copy them in.
const { buildLive } = await import("./site/build-live.mjs");
const { countryFixture } = await import("./test/helpers/satfixture.mjs");
const { EVENTS_DIR, EVENTS_NOW } = await import("./test/helpers/eventsfixture.mjs");
const overlay = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-events-"));
{
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-events-data-")), fx = countryFixture(), base = "satellites/S1";
  fs.mkdirSync(path.join(data, base), { recursive: true });
  for (const [n, b] of [["details.bin", fx.details], ["swarm.bin", fx.swarm], ["satmeta.json", JSON.stringify(fx.meta)]]) fs.writeFileSync(path.join(data, base, n), b);
  fs.cpSync(EVENTS_DIR, data, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  const m = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, "manifest.json"), "utf8"));
  m.feeds.satellites = { version: "S1", files: { "details.bin": `${base}/details.bin`, "swarm.bin": `${base}/swarm.bin`, "satmeta.json": `${base}/satmeta.json` } };
  fs.writeFileSync(path.join(data, "manifest.json"), JSON.stringify(m));
  const r = buildLive({ dataDir: data, outDir: overlay, now: EVENTS_NOW, noindex: process.env.SITE_NOINDEX === "1", bounds: { min: 5, max: 1000 }, starlinkMin: 50 });
  check("the launch and GDACS pages build from the saved feeds", r.failed.length === 0 && ["rocket-launches/index.html", "natural-disasters-now/index.html"].every((f) => fs.existsSync(path.join(overlay, f))), JSON.stringify(r.failed));
  fs.rmSync(data, { recursive: true, force: true });
}
// live: an optional mocked live folder { "manifest.json": object, "<path>": object }, served at /live/
const serveEvents = (c, live = null) => c.route("https://radar.test/**", (route) => {
  const u = new URL(route.request().url());
  const rel = decodeURIComponent(u.pathname.slice(1)).replace(/(^|\/)$/, "$1index.html");
  if (live && rel.startsWith("live/")) {
    const body = live[rel.slice(5)];
    return body ? route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : route.fulfill({ status: 404, body: "" });
  }
  const f = ["rocket-launches/index.html", "natural-disasters-now/index.html"].includes(rel) ? path.join(overlay, rel) : path.join(site, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, headers: { "content-type": "text/html" }, body: "<html><body>Not found</body></html>" });
  return route.fulfill({ status: 200, headers: { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, body: fs.readFileSync(f) });
});
check("the site carries the live pages' shared script, under 20 KB", fs.existsSync(site + "live-pages.js") && fs.statSync(site + "live-pages.js").size < 20 * 1024);
{
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await serveEvents(c);
  const pg = await c.newPage();
  for (const f of EVENT_FILES) {
    const path1 = "/" + f.replace(/index\.html$/, "");
    const r = await pg.evaluate(async (u) => { const x = await fetch(u); return { status: x.status, text: await x.text() }; }, "https://radar.test" + path1);
    const h = r.text;
    const canonical = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || "";
    const robots = (h.match(/<meta name="robots" content="([^"]+)">/) || [])[1];
    const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || "";
    check(`${path1} answers 200 raw, with its canonical address, a robots tag matching SITE_NOINDEX, a number in the lead and the data time`,
      r.status === 200 && canonical.endsWith(path1) && robots === want && /^As of <time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">/.test(lead) && /<strong>[^<]*(<span[^>]*>)?[\d,]+/.test(lead) && /<figure/.test(h),
      JSON.stringify({ status: r.status, canonical, robots, lead: lead.slice(0, 160) }));
  }
  await pg.close();
  await c.close();
}
// with JavaScript: no console errors, sorting, local times and the in-place refresh from a mocked live folder; without it: the same content
{
  const errs = [];
  const nowIso = new Date(Date.now() - 60e3).toISOString().replace(/\.\d{3}Z$/, "Z");
  const launches = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, "manifest.json"), "utf8")).feeds.launches.files["launches.json"]), "utf8"));
  launches.generated = nowIso;
  launches.launches = [{ ...launches.launches[0], name: "Test Rocket | Mocked refresh", net: new Date(Date.now() + 5 * 86400e3).toISOString().replace(/\.\d{3}Z$/, "Z"), precision: "MIN" }];
  const live = { "manifest.json": { feeds: { launches: { version: "MOCK", sourceTime: nowIso, files: { "launches.json": "launches/MOCK/launches.json" } } } }, "launches/MOCK/launches.json": launches };
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, serviceWorkers: "block", timezoneId: "Asia/Kolkata" });
  await serveEvents(c, live);
  const pg = await c.newPage();
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  pg.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  await pg.goto("https://radar.test/rocket-launches/", { waitUntil: "load", timeout: 60000 });
  const refreshed = await pg.waitForFunction(() => { const e = document.querySelector('[data-live-key="next-name"]'); return e && e.textContent === "Test Rocket | Mocked refresh" && e.classList.contains("live-new"); }, null, { timeout: 20000 }).then(() => true, () => false);
  const st = await pg.evaluate(() => ({ status: (document.querySelector("[data-live-status]") || {}).textContent, n30: (document.querySelector('[data-live-key="launches-30"]') || {}).textContent, local: document.querySelectorAll("main .lt").length }));
  check("rocket launches: the live refresh reads the mocked live folder and updates the next launch and the 30 day count in place, marked", refreshed && st.n30 === "1" && /Updated in place/.test(st.status || ""), JSON.stringify(st));
  check("rocket launches: times outside tables are also shown in the reader's time zone", st.local > 0, JSON.stringify(st));
  const sorted = await pg.evaluate(() => {
    const t = [...document.querySelectorAll("main .tablewrap table")].find((x) => x.tBodies[0].rows.length > 8);
    if (!t) return null;
    const firstCol = () => [...t.tBodies[0].rows].map((r) => r.cells[2].textContent);
    const before = firstCol();
    t.tHead.rows[0].cells[2].querySelector("button").click();
    const asc = firstCol();
    t.tHead.rows[0].cells[2].querySelector("button").click();
    return { before, asc, desc: firstCol(), aria: t.tHead.rows[0].cells[2].getAttribute("aria-sort"), filter: !!t.parentNode.previousElementSibling && t.parentNode.previousElementSibling.type === "search" };
  });
  const sortedOk = sorted && JSON.stringify(sorted.asc) === JSON.stringify([...sorted.before].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0))) && JSON.stringify(sorted.desc) === JSON.stringify([...sorted.asc].reverse()) && sorted.aria === "descending" && sorted.filter;
  check("rocket launches: a table of more than 8 rows sorts both ways by a header button, sets aria-sort and has a filter box", !!sortedOk, JSON.stringify(sorted).slice(0, 300));
  await pg.goto("https://radar.test/natural-disasters-now/", { waitUntil: "load", timeout: 60000 });
  await pg.waitForTimeout(500);
  await pg.goto("https://radar.test/starlink-tracker/", { waitUntil: "load", timeout: 60000 });
  await pg.waitForTimeout(500);
  check("the three pages run the shared script with no console errors", errs.length === 0, errs.join(" | "));
  await c.close();
  // JavaScript off: the same numbers, tables and figures are there
  const off = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await serveEvents(off);
  const p2 = await off.newPage();
  for (const f of EVENT_FILES) {
    await p2.goto("https://radar.test/" + f.replace(/index\.html$/, ""), { waitUntil: "load", timeout: 60000 });
    const raw = fs.readFileSync(f === "starlink-tracker/index.html" ? site + f : path.join(overlay, f), "utf8");
    const seen = await p2.evaluate(() => ({ rows: document.querySelectorAll("main tbody tr").length, figures: document.querySelectorAll("main figure svg").length, lead: document.querySelector(".lead").innerText }));
    check(`${f}: with JavaScript off the page shows every table row, figure and the lead's numbers`, seen.rows === (raw.match(/<tbody>[\s\S]*?<\/tbody>/g) || []).reduce((n, b) => n + (b.match(/<tr/g) || []).length, 0) && seen.figures === (raw.match(/<figure/g) || []).length && /\d/.test(seen.lead), JSON.stringify(seen).slice(0, 200));
  }
  await off.close();
}
fs.rmSync(overlay, { recursive: true, force: true });

const about = await ctx.newPage();
await about.goto("https://radar.test/about/", { waitUntil: "load", timeout: 60000 });
const aboutInfo = await about.evaluate(() => ({
  h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode,
  words: (document.body.innerText.match(/\b[\w'-]+\b/g) || []).length, robots: (document.head.querySelector('meta[name="robots"]') || {}).content,
  faq: (() => { let n = 0; for (let e = document.getElementById("faq"); e && (e = e.nextElementSibling) && e.tagName !== "H2";) if (e.tagName === "H3") n++; return n; })(),
}));
check("the About page loads with its heading, real text and a visible FAQ, in standards mode, as UTF-8",
  aboutInfo.h1 === "What is Radar Around You?" && aboutInfo.words >= 700 && aboutInfo.faq === 6 && aboutInfo.compat === "CSS1Compat" && aboutInfo.charset === "UTF-8", JSON.stringify(aboutInfo));
check("its robots tag matches SITE_NOINDEX", aboutInfo.robots === want, String(aboutInfo.robots));
check("llms.txt exists exactly when the site is indexable", process.env.SITE_NOINDEX === "1" ? !fs.existsSync(site + "llms.txt") : fs.existsSync(site + "llms.txt"));

for (const pg of [page, sat, about]) if (!pg.isClosed()) await pg.close();
await ctx.close(); // pages left open keep drawing and slow every later page

// ---- the text section on the home page (site/home-text.mjs): below the first screen, over the fixed app, which stays as it was.
// The comparison page is the same built app wrapped without the section, so the first screen can be compared box by box.
const { wrapApp, asDocument } = await import("./site/build.mjs");
const plainHome = asDocument(wrapApp(fs.readFileSync(fileURLToPath(new URL("./dist/radar.html", import.meta.url)), "utf8"), { homeText: false }));
const openHome = async (viewport, mobile, home = null) => {
  const c = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  const errs = [];
  await serve(c, { home, missing: [] });
  const pg = await c.newPage();
  pg.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 200)));
  await pg.goto("https://radar.test/", { waitUntil: "commit", timeout: 60000 });
  const up = await pg.waitForFunction(() => !document.getElementById("loader") && !!window.__radar, null, { timeout: 120000 }).then(() => true, () => false);
  await pg.waitForTimeout(800);
  return { c, pg, up, errs };
};
const firstScreen = (pg) => pg.evaluate(() => {
  const box = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10); };
  const cv = document.querySelector("canvas#gl");
  return { stats: box("#stats"), tabs: box(".tabs"), canvas: box("canvas#gl"), buffer: [cv.width, cv.height], top: box(".top"), layers: box("#layers"), width: document.documentElement.clientWidth, inner: innerWidth };
});
const textState = (pg) => pg.evaluate(() => {
  const s = document.getElementById("about-home"), r = s ? s.getBoundingClientRect() : null;
  return { y: Math.round(scrollY), vh: innerHeight, top: r ? Math.round(r.top) : null, sheet: !document.getElementById("sheet").hidden, dist: window.__radar.orbit.cam.dist };
});
const settle = (pg) => pg.waitForFunction(() => new Promise((ok) => { const y = scrollY; setTimeout(() => ok(scrollY === y), 250); }), null, { timeout: 10000 }).catch(() => {});
// a wheel turn with the pointer at the middle of an element; returns the page's scroll position after it has settled
const wheelOver = async (pg, sel, dy) => {
  const at = await pg.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
  await pg.mouse.move(at[0], at[1]); await pg.mouse.wheel(0, dy); await pg.waitForTimeout(1500); await settle(pg);
  return pg.evaluate(() => Math.round(scrollY));
};
const overlaps = (a, b) => a && b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
for (const [label, viewport, mobile] of [["phone", { width: 390, height: 780 }, true], ["desktop", { width: 1280, height: 800 }, false]]) {
  const plain = await openHome(viewport, mobile, plainHome);
  const before = plain.up ? await firstScreen(plain.pg) : null;
  await plain.c.close();
  const { c, pg, up, errs } = await openHome(viewport, mobile);
  check(`${label}: the home page with the text section starts`, up && plain.up, errs.join(" | "));
  if (!up) { await c.close(); continue; }
  const after = await firstScreen(pg);
  check(`${label}: the first screen is laid out exactly as without the text section (stats strip, tab bar, canvas, top bar, layer chips, no scrollbar)`, JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} against ${JSON.stringify(after)}`);
  const s0 = await textState(pg);
  check(`${label}: the section is in the page below the first screen and not in view at load`, s0.top !== null && s0.y === 0 && s0.top >= s0.vh, JSON.stringify(s0));
  if (!mobile) {
    // the keyboard: Tab from the start of the page reaches the read-more link first, Enter brings the text into view, and Shift+Tab out
    // of the text moves focus into the app and brings the first screen back, so focus is never hidden under the text
    const active = () => pg.evaluate(() => { const e = document.activeElement; return { cls: e && e.className, inApp: !!(e && e.closest && e.closest("#app")), id: e && e.id }; });
    await pg.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await pg.keyboard.press("Tab");
    const first = await active();
    check(`${label}: Tab from the start of the page reaches "What is this? Read more" first`, first.cls === "home-more", JSON.stringify(first));
    await pg.keyboard.press("Enter"); await settle(pg);
    const k1 = await textState(pg);
    check(`${label}: Enter on the read-more link brings the section into view`, k1.y > 0 && k1.top >= 0 && k1.top < k1.vh, JSON.stringify(k1));
    await pg.focus(".home-back a"); await pg.keyboard.press("Shift+Tab"); await settle(pg);
    const k2 = await textState(pg), back = await active();
    check(`${label}: Shift+Tab from the section's first link moves focus into the app and brings the first screen back`, k2.y === 0 && back.inApp, JSON.stringify({ k2, back }));
    // Ctrl with the wheel is the browser's own zoom: the page's wheel guard leaves it alone, and still cancels a plain wheel there
    const ctrl = await pg.evaluate(() => { const t = document.querySelector(".tabs"); const go = (ctrlKey) => t.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey, bubbles: true, cancelable: true })); return { plain: go(false), ctrl: go(true) }; });
    check(`${label}: a wheel with Ctrl over the app is not cancelled (browser zoom), a plain one is`, ctrl.plain === false && ctrl.ctrl === true, JSON.stringify(ctrl));
  }
  // the wheel on the globe still zooms, and the page does not scroll
  await pg.mouse.move(viewport.width / 2, viewport.height / 2);
  await pg.mouse.wheel(0, 400); await pg.waitForTimeout(700); await settle(pg);
  const s1 = await textState(pg);
  check(`${label}: a wheel on the canvas still changes the zoom and leaves the page at the top`, s1.y === 0 && Math.abs(s1.dist - s0.dist) > 1e-6, JSON.stringify({ before: s0, after: s1 }));
  const more = await pg.evaluate(() => { const m = document.querySelector(".home-more"); const b = m.getBoundingClientRect(); return { shown: getComputedStyle(m).display !== "none" && getComputedStyle(m).visibility === "visible" && b.width > 0, box: [b.left, b.top, b.width, b.height] }; });
  if (!mobile) {
    // the wheel over the app's controls stays in the app: it does not scroll the page towards the text
    const overTabs = await wheelOver(pg, ".tabs", 400), overTop = await wheelOver(pg, ".brand", 400), overStats = await wheelOver(pg, "#stats", 400);
    check(`${label}: a wheel over the tab bar, the top bar and the stats strip leaves the page at the top`, overTabs === 0 && overTop === 0 && overStats === 0, JSON.stringify({ overTabs, overTop, overStats }));
    // the read-more link sits clear of the tab bar and the layer chips, here and on a wider screen
    const clear = async () => pg.evaluate(() => { const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }; return { more: r(".home-more"), tabs: r(".tabs"), chips: r("#layerChips"), w: innerWidth, h: innerHeight }; });
    const at1280 = await clear();
    await pg.setViewportSize({ width: 1440, height: 900 }); await pg.waitForTimeout(600);
    const at1440 = await clear();
    await pg.setViewportSize(viewport); await pg.waitForTimeout(600);
    check(`${label}: "What is this? Read more" is shown at the bottom left, clear of the tab bar and the layer chips (1280x800 and 1440x900)`,
      more.shown && [at1280, at1440].every((m) => m.more[0] <= 20 && m.more[1] + m.more[3] > m.h - 80 && !overlaps(m.more, m.tabs) && !overlaps(m.more, m.chips)), JSON.stringify({ at1280, at1440 }));
    await pg.click(".home-more"); await settle(pg);
    const s2 = await textState(pg);
    check(`${label}: the read-more link scrolls the section into view`, s2.y > 0 && s2.top >= 0 && s2.top < s2.vh, JSON.stringify(s2));
    await wheelOver(pg, "#about-home .home-lead", -300);
    // under load the smooth scroll can start seconds after the wheel (seen in a trace), so wait for it rather than a fixed time
    const backUp = await pg.waitForFunction((y) => scrollY < y, s2.y, { timeout: 10000 }).then(() => pg.evaluate(() => Math.round(scrollY)), () => s2.y);
    check(`${label}: a wheel up over the section scrolls the page back towards the globe`, backUp < s2.y, JSON.stringify({ before: s2.y, after: backUp }));
    await pg.click(".home-back a"); await settle(pg);
    const s3 = await textState(pg);
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === "top", null, { timeout: 5000 }).catch(() => {});
    const focusTop = await pg.evaluate(() => document.activeElement && document.activeElement.id);
    check(`${label}: "Back to the globe" returns the page to the top and focus to the top of the page`, s3.y === 0 && focusTop === "top", JSON.stringify({ s3, focusTop }));
  } else {
    check(`${label}: the read-more link is not shown on a phone (the About sheet carries the way in)`, !more.shown, JSON.stringify(more));
  }
  // the About sheet's link: it closes the sheet and the page scrolls to the section
  await pg.click(".brand"); await pg.waitForTimeout(400);
  if (!mobile) {
    // a sheet with more content than fits still scrolls with the wheel, and the page behind it does not move
    const body = () => pg.evaluate(() => { const b = document.querySelector("#sheet .body"); return { top: Math.round(b.scrollTop), room: b.scrollHeight - b.clientHeight }; });
    const b0 = await body(), y = await wheelOver(pg, "#sheet .body", 300);
    // the software renderer draws a few frames a second, so the sheet's smooth scroll can take seconds to start moving
    await pg.waitForFunction(() => document.querySelector("#sheet .body").scrollTop > 0, null, { timeout: 10000 }).catch(() => {});
    const b1 = await body();
    check(`${label}: a wheel over the About sheet scrolls the sheet and leaves the page at the top`, b0.room > 0 && b1.top > b0.top && y === 0, JSON.stringify({ b0, b1, y }));
    await pg.evaluate(() => { document.querySelector("#sheet .body").scrollTop = 0; });
  }
  const link = await pg.evaluate(() => { const a = document.querySelector("#sheet .overview a"); return a ? [a.textContent, a.getAttribute("href")] : null; });
  check(`${label}: the About sheet links to the overview`, !!link && link[0] === "What is this site? Read the overview" && link[1] === "#about-home", JSON.stringify(link));
  if (link) {
    await pg.click("#sheet .overview a"); await settle(pg);
    const s4 = await textState(pg);
    check(`${label}: the About sheet's link closes the sheet and scrolls the section into view`, !s4.sheet && s4.y > 0 && s4.top >= 0 && s4.top < s4.vh, JSON.stringify(s4));
    if (mobile) {
      await pg.click(".home-back a"); await settle(pg);
      const s5 = await textState(pg);
      check(`${label}: "Back to the globe" returns the page to the top`, s5.y === 0, JSON.stringify(s5));
    }
  }
  const words = await pg.evaluate(() => (document.getElementById("about-home").innerText.match(/\b[\w'-]+\b/g) || []).length);
  check(`${label}: the section shows its text (500 to 700 words) with no page errors`, words >= 500 && words <= 700 && errs.length === 0, `${words} words; ${errs.join(" | ")}`);
  await c.close();
}

// with JavaScript off the app cannot start: the read-more link shows (on a phone too) and leads to the text
{
  const c = await browser.newContext({ viewport: { width: 390, height: 780 }, javaScriptEnabled: false, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await serve(c, { missing: [] });
  const pg = await c.newPage();
  await pg.goto("https://radar.test/", { waitUntil: "load", timeout: 60000 });
  const shown = await pg.evaluate(() => { const m = document.querySelector(".home-more"), b = m.getBoundingClientRect(); return getComputedStyle(m).display !== "none" && getComputedStyle(m).visibility === "visible" && b.width > 0 && b.bottom <= innerHeight; });
  await pg.click(".home-more"); await pg.waitForTimeout(500);
  const st = await pg.evaluate(() => ({ y: Math.round(scrollY), top: Math.round(document.getElementById("about-home").getBoundingClientRect().top), vh: innerHeight }));
  check("with JavaScript off, the read-more link is shown on a phone and brings the text into view", shown && st.y > 0 && st.top >= 0 && st.top < st.vh, JSON.stringify({ shown, st }));
  await c.close();
}

await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} site checks passed`);
process.exit(bad ? 1 : 0);
