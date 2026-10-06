// Builds the content site into dist/site: every page, the app itself as index.html with search metadata, sitemap.xml (and sitemap-live.xml for the live pages) and robots.txt,
// live-pages.js (the live pages' shared script, site/live-pages-js.mjs),
// the IndexNow key file <key>.txt (only when the site is indexable and site/indexnow.key exists), and the app's data files next to it. Run `npm run build` first (it makes dist/radar.html), then `npm run site`.
// The build stops if a comparison against the US Naval Observatory tables fails, so a page can never print a claim that was not true.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allChecks } from "./verify.mjs";
import { renderPage, SITE, NAV, urlPath, esc, robotsMeta, OG_IMAGE, ogImageTags } from "./layout.mjs";
import { buildPages } from "./pages.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { sitemapLive } from "./pages-satcount.mjs";
import { countryPageSet, coastFromBuffer } from "./pages-country.mjs";
import { LIVE_FILES, SATELLITE_FILES, RIGHT_NOW_FILE } from "./livepages.mjs";
import { isoZ, parseTime } from "./hazard.mjs";
import { hubRows, rightNowPage } from "./pages-hazard.mjs";
import { LIVE_FAMILY } from "./liveregistry.mjs";
import { buildLlmsTxt } from "./llms.mjs";
import { HOME_STYLE, HOME_PRE_APP, homeBodyHtml, COUNTRY_HUB_FILE } from "./home-text.mjs";
import { readIndexNowKey, INDEXNOW_KEY_RE } from "./indexnow.mjs";
import { LIVE_SCRIPT_FILE, liveScriptSource } from "./live-pages-js.mjs";
import { indexConstellations } from "../src/constellations.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));

export const APP_TITLE = "Radar Around You: live feed of satellites, ISS, quakes, aurora and storms";
export const APP_DESCRIPTION = "A free live feed of what is above, around and under you: satellites and the ISS, aircraft over six cities, tonight's sky, earthquakes, aurora, storms and fires, in 3D, for any place on Earth.";

// OURS: the short feature list the home page's noscript text and structured data share. Each line is a statement from README.md.
export const APP_FEATURES = [
  "A 3D globe of tracked satellites, the International Space Station, earthquakes, storms, fires and aurora, with details on tap",
  "A first-person sky view for any place, with the Moon, planets, stars, constellations and satellite passes",
  "A Tonight verdict for your place from cloud, the Moon, the dark hours and aurora chance, with what to look for",
  "Earthquakes shown inside a cutaway of the Earth, with the waves travelling to you",
  "Aurora, storm, fire and launch information from named sources, each with its source and time",
  "A sky calendar for the next 90 days: Moon phases, eclipses, planets and meteor showers",
];
const APP_DETAIL = "Everything is drawn in 3D, and every object can be tapped for details or searched for by name. Each card says where its information comes from, and the data comes from agencies and projects such as USGS, NOAA, NASA and CelesTrak.";

// The six places the data pages work out in detail. They come from the snapshot so the site and the app use the same coordinates.
export function loadCities() {
  return readJson("snapshot.json").cities.map(({ id, name, country, lat, lon, tz }) => ({ id, name, country, lat, lon, tz }));
}

// The satellite snapshot bundled with the repository (public/), used for the deploy-time copy of the live pages (the satellite count page
// and the satellites by country pages) so their addresses never return 404 after a redeploy. The live copies replace them within
// minutes, built on GitHub from the collector's data.
export function loadSatellites() {
  return {
    meta: readJson("public/meta.json"),
    details: fs.readFileSync(path.join(root, "public/details.bin")),
    swarm: fs.readFileSync(path.join(root, "public/swarm.bin")),
    names: fs.readFileSync(path.join(root, "public/names.txt"), "utf8"),
  };
}

// The app's own coastlines, for the maps on the country pages.
export const loadCoast = () => coastFromBuffer(fs.readFileSync(path.join(root, "public/coast.bin")));

// The hazard feed files bundled in public/, for the deploy-time copies of the hazard pages. Each is read only if it is there (on
// 2026-10-06 only quakes.json was), so a page whose data is not bundled is simply not written at deploy time; the live copy comes with the
// next pull. GDACS events are not read: the bundled list carries no data time.
export function loadHazards(dir = path.join(root, "public")) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const json = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const bytes = (f) => fs.readFileSync(path.join(dir, f));
  return {
    quakes: has("quakes.json") ? json("quakes.json") : null,
    kp: has("kp.json") ? json("kp.json") : null,
    spaceweather: has("spaceweather.json") ? json("spaceweather.json") : null,
    aurora: has("aurora.json") && has("aurora.bin") ? { meta: json("aurora.json"), grid: bytes("aurora.bin") } : null,
    closeapproaches: has("closeapproaches.json") ? json("closeapproaches.json") : null,
    storms: has("storms.json") ? json("storms.json") : null,
    fires: has("fires.json") && has("fires.bin") ? { summary: json("fires.json"), bin: bytes("fires.bin") } : null,
    places: has("places.json") ? json("places.json") : null,
  };
}

// The deploy-time copies of the family pages (site/livepages.mjs) and the right-now hub, from the bundled data. Old data is allowed here
// (the page then says it is the copy bundled at deploy time); a feed that fails its guard, or a page with nothing to show, is left out
// with a message. h: loadHazards() plus `satellites` (loadSatellites()); satellites: { active, dataTime } for the hub's count row.
export function hazardSnapshotPages(h, { now, coast, satellites, satelliteFiles = SATELLITE_FILES }) {
  const o = { now, allowStale: true };
  const summaries = {}, skipped = [];
  for (const p of LIVE_FAMILY) {
    try { const s = p.snapshot(h, o); if (s) summaries[p.key] = s; } catch (e) { skipped.push({ file: p.file, reason: e.message }); }
  }
  const made = LIVE_FAMILY.filter((p) => summaries[p.key]);
  const built = [...satelliteFiles, ...made.map((p) => p.file), RIGHT_NOW_FILE];
  const pages = made.map((p) => ({ ...p.render(summaries[p.key], { built, coast }), dataTime: summaries[p.key].dataTime }));
  const hub = rightNowPage(hubRows({ satellites, quakes: summaries.quakes, space: summaries.aurora, approaches: summaries.asteroids, storms: summaries.storms, fires: summaries.fires,
    more: LIVE_FAMILY.filter((p) => p.hubRow).map((p) => p.hubRow(summaries[p.key] || null, { missing: {} })) }), { available: built });
  return { pages: [...pages, hub], skipped };
}
export const liveSnapshotPages = hazardSnapshotPages;

// Wraps the built app with the tags search engines read. Nothing in the app's own code changes.
// The noscript block names the site in a paragraph, not an h1: the page's h1 is the text section's (site/home-text.mjs), which is in the
// HTML with or without JavaScript, and the loader's h1 belongs to the template.
// homeText adds the text section below the first screen (site/home-text.mjs): its style block goes just before the noscript block, so
// asDocument moves it into <head> after the template's own styles; the top focus target and the read-more link go between the noscript
// block and the app, first in the tab order; the section and its script go at the end of the page. countryHub says
// whether the build has the satellites by country hub, so the section links it only when the page exists.
export function wrapApp(appHtml, { noindex = SITE.noindex, homeText = true, countryHub = false } = {}) {
  if (!appHtml.includes("<title>Radar Around You</title>")) throw new Error("site: the app page has no expected <title>; update wrapApp");
  if (!appHtml.includes('<div id="app"')) throw new Error("site: the app page has no #app element; update wrapApp");
  const canonical = `${SITE.url}/`;
  const ld = {
    "@context": "https://schema.org", "@type": "WebApplication", name: SITE.name, url: canonical, description: APP_DESCRIPTION,
    applicationCategory: "EducationalApplication", operatingSystem: "Any device with a web browser", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, featureList: APP_FEATURES, inLanguage: "en",
  };
  const ldSite = { "@context": "https://schema.org", "@type": "WebSite", name: SITE.name, url: canonical, description: APP_DESCRIPTION, inLanguage: "en" };
  const head = `<title>${esc(APP_TITLE)}</title>
<meta name="description" content="${esc(APP_DESCRIPTION)}">
<link rel="canonical" href="${esc(canonical)}">
${robotsMeta(noindex)}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(APP_TITLE)}">
<meta property="og:description" content="${esc(APP_DESCRIPTION)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImageTags()}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script type="application/ld+json">${JSON.stringify(ldSite).replace(/</g, "\\u003c")}</script>`;
  const nav = NAV.filter(([f]) => f !== "").map(([f, label]) => `<li><a href="${f}">${esc(label)}</a></li>`).join("");
  const features = APP_FEATURES.map((f) => `<li>${esc(f)}</li>`).join("");
  const noscript = `<noscript><div style="max-width:720px;margin:0 auto;padding:24px 16px;font:17px/1.6 system-ui,sans-serif;color:#eaf0ff;background:#04060c"><p style="margin:0 0 12px;font-size:28px;font-weight:700;line-height:1.2">${esc(SITE.name)}</p><p>${esc(APP_DESCRIPTION)}</p><p>${esc(APP_DETAIL)}</p><ul>${features}</ul><p>The app needs JavaScript. These pages work without it:</p><ul>${nav}<li><a href="constellations/">The 88 constellations</a></li><li><a href="stars/">Stars with official names</a></li></ul></div></noscript>\n`;
  const wrapped = appHtml.replace("<title>Radar Around You</title>", () => head).replace('<div id="app"', () => (homeText ? HOME_STYLE : "") + noscript + (homeText ? HOME_PRE_APP : "") + '<div id="app"');
  return homeText ? wrapped + homeBodyHtml({ countryHub }) : wrapped;
}

// The built app is a fragment: no doctype, charset or viewport, because the places it was first published (the artifact viewer, the
// test harness) wrap it themselves. Served raw by a web host it is read in quirks mode with a guessed encoding (windows-1252 when
// the server sends no charset), and the guessed encoding garbled a regular expression in the script, so the script did not run and
// the loader never went away. The site's index.html is therefore a complete document.
// The fragment starts with its title, meta, link and style elements (and wrapApp adds the search tags there). Those lead elements go
// into <head>, where search engines look for them; everything from the first other element on stays in <body>, byte for byte.
const HEAD_PART = /^\s*(?:<title>[\s\S]*?<\/title>|<meta\b[^>]*>|<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>|<script type="application\/ld\+json">[\s\S]*?<\/script>)/i;
export function asDocument(fragment) {
  if (/^\s*<!doctype|<html[\s>]/i.test(fragment)) throw new Error("site: the app page is already a complete document; asDocument would wrap it twice");
  let head = "", rest = fragment;
  for (let m; (m = HEAD_PART.exec(rest)); ) { head += m[0]; rest = rest.slice(m[0].length); }
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${head}</head>\n<body>\n${rest}</body>\n</html>\n`;
}

export function sitemap(files) {
  const urls = files.map((f) => `  <url><loc>${esc(`${SITE.url}/${urlPath(f)}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
// While the site is on a temporary address (noindex), robots.txt asks every crawler to stay out and there is no sitemap,
// because a sitemap lists pages for search engines and would contradict the page tags.
export const robots = ({ noindex = SITE.noindex } = {}) => (noindex ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\nSitemap: ${SITE.url}/sitemap-live.xml\n`);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

// Fails unless every comparison with the USNO tables ran and passed. ALLOW_UNCHECKED=1 lets a build proceed without them;
// the pages then leave the claims out.
export function assertChecks(checks, allowUnchecked = false) {
  const problems = [];
  for (const [name, r] of Object.entries(checks)) {
    if (!r) { if (!allowUnchecked) problems.push(`${name}: the comparison table is missing`); }
    else if (!r.matched) problems.push(`${name}: results disagree with the USNO table`);
  }
  if (problems.length) throw new Error("site: " + problems.join("; "));
}

// The committed share image (drawn by tools/make-og-image.mjs, run by hand; the build only copies it).
export const OG_IMAGE_SOURCE = path.join(root, "site/assets/og-image.png");

export function build({ outDir = path.join(root, "dist/site"), appFile = path.join(root, "dist/radar.html"), publicDir = path.join(root, "public"), allowUnchecked = false, noindex = SITE.noindex, now = new Date(), satellites = loadSatellites(), coast = loadCoast(), hazards = loadHazards(), indexnowKey = readIndexNowKey() } = {}) {
  if (indexnowKey != null && !INDEXNOW_KEY_RE.test(indexnowKey)) throw new Error("site: the IndexNow key must be 8 to 128 letters, digits and dashes");
  if (!fs.existsSync(appFile)) throw new Error(`site: ${appFile} not found; run npm run build first`);
  if (!fs.existsSync(OG_IMAGE_SOURCE)) throw new Error(`site: ${OG_IMAGE_SOURCE} not found; run node tools/make-og-image.mjs`);
  const cities = loadCities();
  const checks = allChecks(cities);
  assertChecks(checks, allowUnchecked);
  const consIdx = indexConstellations(readJson("public/constellations.json"));
  const starsDoc = readJson("public/starnames.json");
  const details = fs.existsSync(path.join(root, "public/stardetails.json")) ? readJson("public/stardetails.json") : null;
  const satcount = countSatellites(satellites);
  assertPlausible(satcount);
  const country = countryPageSet(satellites, { coast, updated: now });
  for (const sk of country.skipped) console.log(`site: skipped ${sk.file}: ${sk.reason}`);
  const taken = isoZ(parseTime(satcount.taken));
  const live = hazardSnapshotPages({ ...hazards, satellites }, { now, coast, satellites: { active: satcount.active, dataTime: taken }, satelliteFiles: SATELLITE_FILES.filter((f) => f === SATELLITE_FILES[0] || country.pages.some((p) => p.file === f)) });
  for (const sk of live.skipped) console.log(`site: skipped ${sk.file}: ${sk.reason}`);
  const pages = buildPages({ cities, consIdx, starsDoc, checks, details, satcount, updated: now, countryPages: country.pages, livePages: live.pages });
  const seen = new Set();
  for (const p of pages) { if (seen.has(p.file)) throw new Error(`site: duplicate page ${p.file}`); seen.add(p.file); }
  fs.rmSync(outDir, { recursive: true, force: true });
  if (publicDir) copyDir(publicDir, outDir); else fs.mkdirSync(outDir, { recursive: true });
  for (const p of pages) {
    const f = path.join(outDir, p.file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, renderPage(p, { noindex }));
  }
  const countryHub = pages.some((p) => p.file === COUNTRY_HUB_FILE);
  fs.writeFileSync(path.join(outDir, "index.html"), asDocument(wrapApp(fs.readFileSync(appFile, "utf8"), { noindex, countryHub })));
  // the shared script of the live pages (site/live-pages-js.mjs): written by every deploy, so the live pages copied in by hosting/pull.php
  // find it, and cached like any other file
  fs.writeFileSync(path.join(outDir, LIVE_SCRIPT_FILE), liveScriptSource());
  const files = ["index.html", ...pages.map((p) => p.file)];
  if (!noindex) {
    // the live pages have their own sitemap with an accurate last modified time, so the main one leaves them out
    fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(files.filter((f) => !LIVE_FILES.includes(f))));
    // each live page with its data time: the satellite pages the snapshot's time, the hazard pages and the hub their feeds' own times
    const dataTime = new Map(pages.filter((p) => p.dataTime).map((p) => [p.file, p.dataTime]));
    fs.writeFileSync(path.join(outDir, "sitemap-live.xml"), sitemapLive(LIVE_FILES.filter((f) => files.includes(f)).map((f) => ({ file: f, lastmod: dataTime.get(f) || taken }))));
    fs.writeFileSync(path.join(outDir, "llms.txt"), buildLlmsTxt({ pages, url: SITE.url, name: SITE.name, summary: APP_DESCRIPTION }));
    // IndexNow ownership proof: the key and nothing else, UTF-8, at the site root. hosting/pull.php sends pings only while this file holds
    // the key that pages/index.json names, and a redeploy writes it again. Never written for a noindex site, which must not be pinged.
    if (indexnowKey) fs.writeFileSync(path.join(outDir, `${indexnowKey}.txt`), indexnowKey, "utf8");
  }
  fs.writeFileSync(path.join(outDir, "robots.txt"), robots({ noindex }));
  // the share image every page names in og:image (written for a noindex build too: harmless, and the tags stay the same)
  fs.copyFileSync(OG_IMAGE_SOURCE, path.join(outDir, OG_IMAGE.file));
  return { outDir, pages: files.length, checks, noindex, skipped: country.skipped, liveSkipped: live.skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build({ allowUnchecked: process.env.ALLOW_UNCHECKED === "1" });
  console.log(`site: ${r.pages} pages written to ${r.outDir} (canonical base ${SITE.url})`);
  if (r.noindex) console.log("site: NOINDEX IS ON (SITE_NOINDEX=1). Every page tells search engines to stay away, robots.txt disallows everything, and no sitemap, llms.txt or IndexNow key file is written. This setting is for a temporary address.");
}
