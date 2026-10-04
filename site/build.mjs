// Builds the content site into dist/site: every page, the app itself as index.html with search metadata, sitemap.xml and robots.txt,
// and the app's data files next to it. Run `npm run build` first (it makes dist/radar.html), then `npm run site`.
// The build stops if a comparison against the US Naval Observatory tables fails, so a page can never print a claim that was not true.
import fs from "node:fs";
import path from "node:path";
import { allChecks } from "./verify.mjs";
import { renderPage, SITE, NAV, urlPath, esc } from "./layout.mjs";
import { buildPages } from "./pages.mjs";
import { indexConstellations } from "../src/constellations.js";

const root = new URL("../", import.meta.url).pathname;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));

export const APP_TITLE = "Radar Around You: live satellites, ISS, sky tonight, quakes and aurora";
export const APP_DESCRIPTION = "A free live 3D view of what is above, around and under you: satellites and the ISS, aircraft, tonight's sky, earthquakes, aurora, storms and fires, for any place on Earth.";

// The six places the data pages work out in detail. They come from the snapshot so the site and the app use the same coordinates.
export function loadCities() {
  return readJson("snapshot.json").cities.map(({ id, name, country, lat, lon, tz }) => ({ id, name, country, lat, lon, tz }));
}

// Wraps the built app with the tags search engines read. Nothing in the app's own code changes.
export function wrapApp(appHtml) {
  if (!appHtml.includes("<title>Radar Around You</title>")) throw new Error("site: the app page has no expected <title>; update wrapApp");
  if (!appHtml.includes('<div id="app"')) throw new Error("site: the app page has no #app element; update wrapApp");
  const canonical = `${SITE.url}/`;
  const ld = {
    "@context": "https://schema.org", "@type": "WebApplication", name: SITE.name, url: canonical, description: APP_DESCRIPTION,
    applicationCategory: "EducationalApplication", operatingSystem: "Any device with a web browser", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const head = `<title>${esc(APP_TITLE)}</title>
<meta name="description" content="${esc(APP_DESCRIPTION)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(APP_TITLE)}">
<meta property="og:description" content="${esc(APP_DESCRIPTION)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
  const nav = NAV.filter(([f]) => f !== "").map(([f, label]) => `<li><a href="${f}">${esc(label)}</a></li>`).join("");
  const noscript = `<noscript><div style="max-width:720px;margin:0 auto;padding:24px 16px;font:17px/1.6 system-ui,sans-serif;color:#eaf0ff;background:#04060c"><h1>${esc(SITE.name)}</h1><p>${esc(APP_DESCRIPTION)} It needs JavaScript. Meanwhile, these pages work without it:</p><ul>${nav}<li><a href="constellations/">The 88 constellations</a></li><li><a href="stars/">Stars with official names</a></li></ul></div></noscript>\n`;
  return appHtml.replace("<title>Radar Around You</title>", () => head).replace('<div id="app"', () => noscript + '<div id="app"');
}

export function sitemap(files) {
  const urls = files.map((f) => `  <url><loc>${esc(`${SITE.url}/${urlPath(f)}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
export const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`;

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

export function build({ outDir = path.join(root, "dist/site"), appFile = path.join(root, "dist/radar.html"), publicDir = path.join(root, "public"), allowUnchecked = false } = {}) {
  if (!fs.existsSync(appFile)) throw new Error(`site: ${appFile} not found; run npm run build first`);
  const cities = loadCities();
  const checks = allChecks(cities);
  assertChecks(checks, allowUnchecked);
  const consIdx = indexConstellations(readJson("public/constellations.json"));
  const starsDoc = readJson("public/starnames.json");
  const pages = buildPages({ cities, consIdx, starsDoc, checks });
  const seen = new Set();
  for (const p of pages) { if (seen.has(p.file)) throw new Error(`site: duplicate page ${p.file}`); seen.add(p.file); }
  fs.rmSync(outDir, { recursive: true, force: true });
  if (publicDir) copyDir(publicDir, outDir); else fs.mkdirSync(outDir, { recursive: true });
  for (const p of pages) {
    const f = path.join(outDir, p.file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, renderPage(p));
  }
  fs.writeFileSync(path.join(outDir, "index.html"), wrapApp(fs.readFileSync(appFile, "utf8")));
  const files = ["index.html", ...pages.map((p) => p.file)];
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(files));
  fs.writeFileSync(path.join(outDir, "robots.txt"), robots());
  return { outDir, pages: files.length, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const r = build({ allowUnchecked: process.env.ALLOW_UNCHECKED === "1" });
  console.log(`site: ${r.pages} pages written to ${r.outDir} (canonical base ${SITE.url})`);
}
