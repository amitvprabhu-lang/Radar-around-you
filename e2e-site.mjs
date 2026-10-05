// Browser check of the built content site (dist/site) served the way a real web host serves it: the raw files, html sent as plain
// "text/html" with no charset, and missing files answered with an html 404 page. The other browser suites wrap the app in a full
// document first, so they could not see the first Hostinger deployment stall at "Starting up".
// usage: npm run e2e:site (it builds the site first)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./harness.mjs";

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
await ctx.route("https://radar.test/**", (route) => {
  const u = new URL(route.request().url());
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(site, rel);
  if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    notFound.push(u.pathname);
    return route.fulfill({ status: 404, headers: { "content-type": "text/html" }, body: "<html><body>Not found</body></html>" });
  }
  return route.fulfill({ status: 200, headers: { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, body: fs.readFileSync(f) });
});

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

await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} site checks passed`);
process.exit(bad ? 1 : 0);
