// Builds the content site into dist/site: every page, the app itself as index.html with search metadata, sitemap.xml (and sitemap-live.xml for the one live page) and robots.txt,
// and the app's data files next to it. Run `npm run build` first (it makes dist/radar.html), then `npm run site`.
// The build stops if a comparison against the US Naval Observatory tables fails, so a page can never print a claim that was not true.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allChecks } from "./verify.mjs";
import { renderPage, SITE, NAV, urlPath, esc, robotsMeta } from "./layout.mjs";
import { buildPages } from "./pages.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { SATCOUNT_FILE, sitemapLive } from "./pages-satcount.mjs";
import { buildLlmsTxt } from "./llms.mjs";
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

// The satellite snapshot bundled with the repository (public/), used for the deploy-time copy of the satellite count page so the address
// never returns 404 after a redeploy. The live copy replaces it within minutes, built on GitHub from the collector's data.
export function loadSatellites() {
  return {
    meta: readJson("public/meta.json"),
    details: fs.readFileSync(path.join(root, "public/details.bin")),
    swarm: fs.readFileSync(path.join(root, "public/swarm.bin")),
  };
}

// Wraps the built app with the tags search engines read. Nothing in the app's own code changes.
export function wrapApp(appHtml, { noindex = SITE.noindex } = {}) {
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
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script type="application/ld+json">${JSON.stringify(ldSite).replace(/</g, "\\u003c")}</script>`;
  const nav = NAV.filter(([f]) => f !== "").map(([f, label]) => `<li><a href="${f}">${esc(label)}</a></li>`).join("");
  const features = APP_FEATURES.map((f) => `<li>${esc(f)}</li>`).join("");
  const noscript = `<noscript><div style="max-width:720px;margin:0 auto;padding:24px 16px;font:17px/1.6 system-ui,sans-serif;color:#eaf0ff;background:#04060c"><h1>${esc(SITE.name)}</h1><p>${esc(APP_DESCRIPTION)}</p><p>${esc(APP_DETAIL)}</p><ul>${features}</ul><p>The app needs JavaScript. These pages work without it:</p><ul>${nav}<li><a href="constellations/">The 88 constellations</a></li><li><a href="stars/">Stars with official names</a></li></ul></div></noscript>\n`;
  return appHtml.replace("<title>Radar Around You</title>", () => head).replace('<div id="app"', () => noscript + '<div id="app"');
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

export function build({ outDir = path.join(root, "dist/site"), appFile = path.join(root, "dist/radar.html"), publicDir = path.join(root, "public"), allowUnchecked = false, noindex = SITE.noindex, now = new Date(), satellites = loadSatellites() } = {}) {
  if (!fs.existsSync(appFile)) throw new Error(`site: ${appFile} not found; run npm run build first`);
  const cities = loadCities();
  const checks = allChecks(cities);
  assertChecks(checks, allowUnchecked);
  const consIdx = indexConstellations(readJson("public/constellations.json"));
  const starsDoc = readJson("public/starnames.json");
  const details = fs.existsSync(path.join(root, "public/stardetails.json")) ? readJson("public/stardetails.json") : null;
  const satcount = countSatellites(satellites);
  assertPlausible(satcount);
  const pages = buildPages({ cities, consIdx, starsDoc, checks, details, satcount, updated: now });
  const seen = new Set();
  for (const p of pages) { if (seen.has(p.file)) throw new Error(`site: duplicate page ${p.file}`); seen.add(p.file); }
  fs.rmSync(outDir, { recursive: true, force: true });
  if (publicDir) copyDir(publicDir, outDir); else fs.mkdirSync(outDir, { recursive: true });
  for (const p of pages) {
    const f = path.join(outDir, p.file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, renderPage(p, { noindex }));
  }
  fs.writeFileSync(path.join(outDir, "index.html"), asDocument(wrapApp(fs.readFileSync(appFile, "utf8"), { noindex })));
  const files = ["index.html", ...pages.map((p) => p.file)];
  if (!noindex) {
    fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(files.filter((f) => f !== SATCOUNT_FILE)));
    fs.writeFileSync(path.join(outDir, "sitemap-live.xml"), sitemapLive(now.toISOString()));
    fs.writeFileSync(path.join(outDir, "llms.txt"), buildLlmsTxt({ pages, url: SITE.url, name: SITE.name, summary: APP_DESCRIPTION }));
  }
  fs.writeFileSync(path.join(outDir, "robots.txt"), robots({ noindex }));
  return { outDir, pages: files.length, checks, noindex };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build({ allowUnchecked: process.env.ALLOW_UNCHECKED === "1" });
  console.log(`site: ${r.pages} pages written to ${r.outDir} (canonical base ${SITE.url})`);
  if (r.noindex) console.log("site: NOINDEX IS ON (SITE_NOINDEX=1). Every page tells search engines to stay away and robots.txt disallows everything. Remove SITE_NOINDEX before the real launch.");
}
