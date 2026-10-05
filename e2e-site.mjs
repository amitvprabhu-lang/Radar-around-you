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

for (const pg of [page, sat, about]) await pg.close();
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
