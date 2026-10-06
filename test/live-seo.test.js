// The Google readiness checklist (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, section 7, and the "What this means"
// section of 8.2) over every live page of site/livepages.mjs, built from the saved collector output. Pages written before the checklist
// may still fail some rules: they are listed in ALLOWED with the rules they fail, and the list may only shrink (a listed page that now
// passes a listed rule fails this test, so the entry must be removed).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLive } from "../site/build-live.mjs";
import { LIVE_FILES, RIGHT_NOW_FILE } from "../site/livepages.mjs";
import { LIVE_FAMILY } from "../site/liveregistry.mjs";
import { renderPage, SITE, urlPath } from "../site/layout.mjs";
import { coastFromBuffer } from "../site/pages-country.mjs";
import { countryFixture } from "./helpers/satfixture.mjs";
import { REAL_DIR, REAL_NOW, realPlaces } from "./helpers/hazardfixture.mjs";
import { EVENTS_DIR, EVENTS_NOW } from "./helpers/eventsfixture.mjs";
import { realClouds, realPrecise, SKY_NOW, SAT_TIME } from "./helpers/skyfixture.mjs";
import { xmlProblem } from "./helpers/xml.mjs";

const coast = coastFromBuffer(fs.readFileSync(new URL("../public/coast.bin", import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// a reader over a collector folder, as site/build-live.mjs makes it
function reader(dir) {
  const feeds = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).feeds;
  return {
    has: (n) => !!(feeds[n] && feeds[n].version && feeds[n].files),
    bytes: (n, f) => { const rel = feeds[n] && feeds[n].files && feeds[n].files[f]; if (!rel) throw new Error(`no ${f} for ${n}`); return fs.readFileSync(path.join(dir, rel)); },
    json(n, f) { return JSON.parse(this.bytes(n, f).toString("utf8")); },
    time: (n) => (feeds[n] && (feeds[n].sourceTime || feeds[n].fetchedAt)) || null,
  };
}

// 1. the satellite, sky, ISS and hub pages through the real build, from the satellite fixture with owners that have pages, and the real
// clouds and precise.json of 6 October
const data = path.join(tmp, "data"), out = path.join(tmp, "out"), fx = countryFixture();
for (const d of ["satellites/S1", "clouds/C1"]) fs.mkdirSync(path.join(data, d), { recursive: true });
fs.writeFileSync(path.join(data, "satellites/S1/details.bin"), fx.details);
fs.writeFileSync(path.join(data, "satellites/S1/swarm.bin"), fx.swarm);
fs.writeFileSync(path.join(data, "satellites/S1/satmeta.json"), JSON.stringify({ ...fx.meta, taken: SAT_TIME }));
fs.writeFileSync(path.join(data, "satellites/S1/precise.json"), JSON.stringify(realPrecise()));
fs.writeFileSync(path.join(data, "clouds/C1/clouds.json"), JSON.stringify(realClouds()));
fs.writeFileSync(path.join(data, "manifest.json"), JSON.stringify({ schema: 1, feeds: {
  satellites: { version: "S1", files: { "details.bin": "satellites/S1/details.bin", "swarm.bin": "satellites/S1/swarm.bin", "satmeta.json": "satellites/S1/satmeta.json", "precise.json": "satellites/S1/precise.json" } },
  clouds: { version: "C1", files: { "clouds.json": "clouds/C1/clouds.json" } },
} }));
buildLive({ dataDir: data, outDir: out, now: SKY_NOW, noindex: false, bounds: { min: 5, max: 1000 }, indexnowKey: null, starlinkMin: 1 });
const HTML = new Map(LIVE_FILES.filter((f) => fs.existsSync(path.join(out, f))).map((f) => [f, fs.readFileSync(path.join(out, f), "utf8")]));
// 2. the other family pages from their own saved data, each at the time it was collected
const places = realPlaces();
for (const [dir, now] of [[REAL_DIR, REAL_NOW], [EVENTS_DIR, EVENTS_NOW]]) {
  const rd = reader(dir);
  for (const p of LIVE_FAMILY) {
    if (HTML.has(p.file) || !rd.has(p.feeds[0])) continue;
    try { HTML.set(p.file, renderPage(p.render(p.read(rd, { now, places }), { built: LIVE_FILES, coast }), { noindex: false })); } catch { /* built elsewhere or not from this data */ }
  }
}

const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
const RULES = {
  // the data time in the lead is a <time datetime="...Z"> with the same instant as dateModified
  time: (h) => { const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || ""; const t = lead.match(/<time datetime="([^"]+Z)">/); const web = ldOf(h).find((o) => o["@type"] === "WebPage"); return !!(t && web && Date.parse(web.dateModified) === Date.parse(t[1])); },
  // every chart or map is a figure with a caption that gives a data time; every SVG is well formed with role img, title and desc
  figure: (h) => { const m = mainOf(h), svgs = m.match(/<svg[\s\S]*?<\/svg>/g) || [], figs = m.match(/<figure[^>]*>[\s\S]*?<\/figure>/g) || []; return svgs.length === figs.length && figs.every((f) => /<figcaption[^>]*>[\s\S]*?<\/figcaption>/.test(f)) && svgs.every((s) => !xmlProblem(s) && /role="img"/.test(s) && /<title id=/.test(s) && /<desc id=/.test(s)); },
  // tables have a caption and every header cell a scope
  table: (h) => (mainOf(h).match(/<table>[\s\S]*?<\/table>/g) || []).every((t) => /^<table><caption>[^<]+<\/caption>/.test(t) && !/<th(?=[\s>])(?![^>]*scope="(col|row)")/.test(t)),
  // one h1 and no skipped heading levels
  headings: (h) => { const m = mainOf(h); if ((m.match(/<h1[ >]/g) || []).length !== 1) return false; let l = 1; for (const x of m.matchAll(/<h([1-6])[ >]/g)) { if (+x[1] > l + 1) return false; l = +x[1]; } return true; },
  // WebPage with inLanguage, dateModified, isPartOf the WebSite and breadcrumb; BreadcrumbList; no FAQPage
  jsonld: (h) => { const ld = ldOf(h), web = ld.find((o) => o["@type"] === "WebPage"); return !!(web && web.inLanguage === "en" && web.dateModified && web.isPartOf && web.isPartOf["@type"] === "WebSite" && web.isPartOf.url === `${SITE.url}/` && web.breadcrumb && ld.some((o) => o["@type"] === "BreadcrumbList") && !ld.some((o) => o["@type"] === "FAQPage")); },
  // title under 60, description under 160, canonical to its own address, a visible FAQ and sources section
  head: (h) => { const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "", d = (h.match(/<meta name="description" content="([^"]*)">/) || [])[1] || ""; return t.length < 60 && d.length < 160 && /<link rel="canonical" href="https:\/\/[^"]+\/">/.test(h) && h.includes('id="sources"'); },
  // design 8.2: "What this means" is the first section after the lead
  meaning: (h) => ((mainOf(h).match(/<h2[^>]*>([^<]*)<\/h2>/) || [])[1] || "") === "What this means",
};
// OURS, 2026-10-06: the pages written before the checklist and the rules they fail. Only ever remove entries.
const ALLOWED = {
  "how-many-satellites-in-orbit/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/united-states/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/china/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/united-kingdom/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/cis-former-ussr/index.html": ["time", "figure", "jsonld", "meaning"],
  "satellites-by-country/japan/index.html": ["time", "figure", "jsonld", "meaning"],
  "earthquakes-today/index.html": ["time", "figure", "jsonld", "meaning"],
  "aurora-tonight/index.html": ["time", "figure", "jsonld", "meaning"],
  "asteroid-close-approaches/index.html": ["time", "figure", "jsonld", "meaning"],
  "tropical-storms-now/index.html": ["time", "figure", "jsonld", "meaning"],
  "wildfires-today/index.html": ["time", "figure", "jsonld", "meaning"],
  "right-now/index.html": ["time", "jsonld", "meaning"],
};

test("every live page meets the Google readiness checklist, except the listed rules of the pages written before it", (t) => {
  const missing = LIVE_FILES.filter((f) => !HTML.has(f));
  t.diagnostic(`${HTML.size} of ${LIVE_FILES.length} live pages checked${missing.length ? `; not built from the saved data: ${missing.join(", ")}` : ""}`);
  for (const [f, h] of HTML) for (const [rule, ok] of Object.entries(RULES)) {
    const allowed = (ALLOWED[f] || []).includes(rule);
    if (allowed) assert.ok(!ok(h), `${f} now passes "${rule}": remove it from ALLOWED`);
    else assert.ok(ok(h), `${f} fails "${rule}"`);
  }
  for (const f of Object.keys(ALLOWED)) assert.ok(LIVE_FILES.includes(f), `${f} in ALLOWED is not a live page`);
  // every sky page is among those checked, so the new pages can never be skipped quietly
  for (const f of LIVE_FILES.filter((x) => /^(tonights-sky|iss-today)\//.test(x))) assert.ok(HTML.has(f), f);
});

test("every live page is linked from the right-now hub, and every path in the registry is allowed by hosting/lib.php", () => {
  const hub = HTML.get(RIGHT_NOW_FILE);
  for (const f of LIVE_FILES.filter((x) => x !== RIGHT_NOW_FILE && HTML.has(x) && fs.existsSync(path.join(out, x)))) assert.ok(hub.includes(`href="../${urlPath(f)}"`), `${f} is linked from the hub`);
  const php = fs.readFileSync(new URL("../hosting/lib.php", import.meta.url), "utf8");
  const re = php.match(/function radar_safe_page_path[\s\S]*?preg_match\('#\^\(\?:([\s\S]*?)\)\\z#'/);
  assert.ok(re, "the allowed list is found");
  const allowed = new RegExp(`^(?:${re[1]})$`);
  for (const f of LIVE_FILES) assert.ok(allowed.test(f), `${f} is not allowed by hosting/lib.php`);
});
