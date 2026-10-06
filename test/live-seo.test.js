// The Google readiness checklist for every live page (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, section 7), enforced on
// the pages the live build produces from the fixtures. The fleet and events pages must pass every rule. The earlier live pages are held to
// the same rules, except where ALLOWED_GAPS lists a rule a page still fails; that list may only shrink: a test fails when a listed page
// now passes a listed rule, so the entry is removed in the same change that fixes it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLive } from "../site/build-live.mjs";
import { LIVE_FILES, RIGHT_NOW_FILE, EVENT_FILES, LIVE_PAGES } from "../site/livepages.mjs";
import { SITE, urlPath, robotsMeta } from "../site/layout.mjs";
import { buildLlmsTxt } from "../site/llms.mjs";
import { countryFixture } from "./helpers/satfixture.mjs";
import { REAL_DIR, REAL_NOW } from "./helpers/hazardfixture.mjs";
import { EVENTS_DIR, EVENTS_NOW } from "./helpers/eventsfixture.mjs";
import { xmlProblem } from "./helpers/xml.mjs";

const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "seo-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// a collector folder with the country fleet and the feeds of one fixture set
function dataDir(fixtureDir) {
  const dir = mk(), fx = countryFixture(), base = "satellites/S1";
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify(fx.meta));
  fs.writeFileSync(path.join(dir, base, "names.txt"), fx.names.join("\n"));
  fs.cpSync(fixtureDir, dir, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  const m = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8"));
  m.feeds.satellites = { version: "S1", files: { "details.bin": `${base}/details.bin`, "swarm.bin": `${base}/swarm.bin`, "satmeta.json": `${base}/satmeta.json`, "names.txt": `${base}/names.txt` } };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
  return dir;
}
// Two builds: the hazard feeds of 5 October and the fleet and events feeds of 6 October (their times are hours apart, so each build runs at
// its own fixture's time). Every live page is taken from the build where its data is current; the hub and the sitemap from each.
const opts = { noindex: false, bounds: { min: 5, max: 1000 }, starlinkMin: 50 };
const outA = mk(), outB = mk();
const rA = buildLive({ dataDir: dataDir(REAL_DIR), outDir: outA, now: REAL_NOW, ...opts });
const rB = buildLive({ dataDir: dataDir(EVENTS_DIR), outDir: outB, now: EVENTS_NOW, ...opts });
const where = (f) => (EVENT_FILES.includes(f) ? outB : outA);
const hubFor = (f) => fs.readFileSync(path.join(where(f), RIGHT_NOW_FILE), "utf8");
const PAGES = new Map(LIVE_FILES.filter((f) => fs.existsSync(path.join(where(f), f))).map((f) => [f, fs.readFileSync(path.join(where(f), f), "utf8")]));
const index = { ...JSON.parse(fs.readFileSync(path.join(outA, "index.json"), "utf8")).pages, ...Object.fromEntries(EVENT_FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(outB, "index.json"), "utf8")).pages[f]])) };
const sitemaps = [outA, outB].map((d) => fs.readFileSync(path.join(d, "sitemap-live.xml"), "utf8")).join("\n");
const llms = buildLlmsTxt({ pages: ["about/index.html", "methods/index.html", "moon-phases/index.html", "eclipses/index.html", "meteor-showers/index.html", "planets/index.html", "seasons/index.html", "constellations/index.html", "stars/index.html", "sky/index.html", LIVE_FILES[0], LIVE_FILES[1]].map((file) => ({ file, h1: file, description: "d" })), url: SITE.url, name: SITE.name, summary: "s" });

const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return null; } });
const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const resolve = (from, href) => { let t = path.posix.normalize(path.posix.join(path.posix.dirname(from), href)); if (t === "." || t.endsWith("/") || !t.endsWith(".html")) t = `${t.replace(/\/?$/, "/")}index.html`.replace(/^\.\//, ""); return t; };

// Each rule returns null when the page passes, or what is wrong.
const RULES = {
  "time-in-lead": (f, h) => {
    if (f === RIGHT_NOW_FILE) return null;
    const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || "";
    const t = (lead.match(/<time datetime="([^"]+Z)">/) || [])[1];
    const wp = ldOf(h).find((o) => o && o["@type"] === "WebPage");
    if (!t) return "no <time datetime> with a UTC time in the lead";
    return wp && Date.parse(t) === Date.parse(wp.dateModified) ? null : `the lead's time ${t} is not the WebPage dateModified ${wp && wp.dateModified}`;
  },
  "figures": (f, h) => {
    const m = mainOf(h), svgs = m.match(/<svg[\s\S]*?<\/svg>/g) || [], figs = m.match(/<figure[\s\S]*?<\/figure>/g) || [];
    for (const s of svgs) { if (xmlProblem(s)) return `SVG not well formed: ${xmlProblem(s)}`; if (!/role="img"/.test(s) || !/<title[^>]*>[^<]+<\/title>/.test(s) || !/<desc[^>]*>[^<]+<\/desc>/.test(s)) return "an SVG without role, title or desc"; }
    if (figs.length !== svgs.length) return `${svgs.length - figs.length} of ${svgs.length} charts or maps are not in a <figure>`;
    return figs.every((x) => /<figcaption[^>]*>[^<]{20,}<\/figcaption>/.test(x)) ? null : "a figure without a one-sentence figcaption";
  },
  "tables": (f, h) => {
    for (const t of mainOf(h).match(/<table>[\s\S]*?<\/table>/g) || []) {
      if (!/<caption>[^<]+<\/caption>/.test(t)) return "a table without a caption";
      if (/<th(?! scope="(col|row)")[ >]/.test(t)) return "header cells without scope";
    }
    return null;
  },
  "headings": (f, h) => {
    const lv = [...h.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    if (lv.filter((x) => x === 1).length !== 1) return "not exactly one h1";
    for (let i = 1; i < lv.length; i++) if (lv[i] > lv[i - 1] + 1) return `h${lv[i - 1]} followed by h${lv[i]}`;
    return null;
  },
  "structured-data": (f, h) => {
    const ld = ldOf(h);
    if (ld.some((o) => o === null)) return "JSON-LD that does not parse";
    if (ld.some((o) => o["@type"] === "FAQPage")) return "FAQPage markup";
    if (!ld.some((o) => o["@type"] === "BreadcrumbList")) return "no BreadcrumbList";
    const wp = ld.find((o) => o["@type"] === "WebPage");
    if (!wp) return "no WebPage";
    const miss = ["name", "description", "url", "inLanguage", "dateModified", "isPartOf", "breadcrumb"].filter((k) => !(k in wp));
    if (miss.length) return `WebPage without ${miss.join(", ")}`;
    if (wp.inLanguage !== "en" || wp.isPartOf["@type"] !== "WebSite" || wp.isPartOf.url !== `${SITE.url}/`) return "WebPage inLanguage or isPartOf is wrong";
    return wp.url === `${SITE.url}/${urlPath(f)}` ? null : "WebPage url is not the page";
  },
  "linked": (f) => {
    if (f !== RIGHT_NOW_FILE && !hubFor(f).includes(`href="../${urlPath(f)}"`)) return "not linked from the right-now hub";
    const from = [...PAGES].filter(([g, h]) => g !== f && g !== RIGHT_NOW_FILE && [...mainOf(h).matchAll(/ href="([^"#]+)"/g)].some((m) => !/^https?:/.test(m[1]) && resolve(g, m[1]) === f));
    if (from.length < 2) return `linked from ${from.length} other live pages besides the hub (at least 2)`;
    return llms.includes(`(${SITE.url}/${urlPath(f)})`) ? null : "not in llms.txt";
  },
  "link-text": (f, h) => (/>\s*(click here|here|read more|more|link)\s*</i.test(mainOf(h)) ? "a link whose text does not say where it goes" : null),
  "sitemap": (f) => (sitemaps.includes(`<loc>${SITE.url}/${urlPath(f)}</loc><lastmod>${index[f] && index[f].dataTime}</lastmod>`) ? null : "not in sitemap-live.xml with its data time as lastmod"),
  "title-description": (f, h) => {
    const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "", d = (h.match(/<meta name="description" content="([^"]*)">/) || [])[1] || "";
    if (!(t.length > 0 && t.length < 60)) return `title of ${t.length} characters`;
    if (!(d.length > 0 && d.length < 160)) return `description of ${d.length} characters`;
    for (const [g, o] of PAGES) if (g !== f && ((o.match(/<title>([^<]*)<\/title>/) || [])[1] === t || (o.match(/<meta name="description" content="([^"]*)">/) || [])[1] === d)) return `title or description shared with ${g}`;
    if (!h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`)) return "canonical is not the page's own address";
    return h.includes(robotsMeta(false)) ? null : "robots is not index,follow";
  },
  "sources": (f, h) => (/<h2 id="sources">Sources<\/h2>\s*<(ul|p)[^>]*>(<li>)?[^<]{0,40}<a href="https:\/\//.test(h) ? null : "no visible sources section with links"),
  // the headline is in the HTML the server sends: a <strong> in the lead holding a number (or the words no or none, for an empty list),
  // no number left for a script to fill in (every data-live-key span already holds text), and every table with its rows
  "html-first": (f, h) => {
    const lead = (h.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || "";
    const strong = [...lead.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    if (!strong.some((t) => /\d|\b(no|none)\b/i.test(t))) return "no headline number in a <strong> of the server HTML's lead";
    if (/data-live-key="[^"]+">\s*</.test(h)) return "a live number that is empty until a script runs";
    return /<tbody>\s*<\/tbody>/.test(mainOf(h)) ? "a table with no rows in the server HTML" : null;
  },
};
const audit = (f) => Object.entries(RULES).map(([rule, fn]) => [rule, fn(f, PAGES.get(f))]).filter(([, why]) => why);

// The earlier live pages, each rule it still fails, and why (the audit of 2026-10-06, before the later pass of section 8.3). The list may
// only shrink: a test fails when a listed page passes a listed rule, when an entry has no reason, and when a page or rule is added that
// the audit of 2026-10-06 (BASELINE_GAPS) did not record.
export const ALLOWED_GAPS = {
  "how-many-satellites-in-orbit/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "satellites-by-country/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "satellites-by-country/united-states/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
    "linked": "llms.txt lists only the country hub, not the five country pages",
  },
  "satellites-by-country/china/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
    "linked": "llms.txt lists only the country hub, not the five country pages",
  },
  "satellites-by-country/united-kingdom/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
    "linked": "llms.txt lists only the country hub, not the five country pages",
  },
  "satellites-by-country/cis-former-ussr/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
    "linked": "llms.txt lists only the country hub, not the five country pages",
  },
  "satellites-by-country/japan/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
    "linked": "llms.txt lists only the country hub, not the five country pages",
  },
  "earthquakes-today/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "aurora-tonight/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "asteroid-close-approaches/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "tropical-storms-now/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  "wildfires-today/index.html": {
    "time-in-lead": "built before the section 7 checklist; the lead prints its time as text, not in a time element",
    "figures": "built before the section 7 checklist; its charts and maps are bare SVGs without figure and figcaption",
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
  [RIGHT_NOW_FILE]: {
    "tables": "site/layout.mjs's shared table writes header cells without scope",
    "structured-data": "its WebPage markup predates section 7 (no inLanguage, isPartOf or breadcrumb)",
  },
};
// the audit of 2026-10-06, fixed: the allowlist may never hold more than this
const BASELINE_GAPS = {
  "how-many-satellites-in-orbit/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "satellites-by-country/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "satellites-by-country/united-states/index.html": ["time-in-lead", "figures", "tables", "structured-data", "linked"],
  "satellites-by-country/china/index.html": ["time-in-lead", "figures", "tables", "structured-data", "linked"],
  "satellites-by-country/united-kingdom/index.html": ["time-in-lead", "figures", "tables", "structured-data", "linked"],
  "satellites-by-country/cis-former-ussr/index.html": ["time-in-lead", "figures", "tables", "structured-data", "linked"],
  "satellites-by-country/japan/index.html": ["time-in-lead", "figures", "tables", "structured-data", "linked"],
  "earthquakes-today/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "aurora-tonight/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "asteroid-close-approaches/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "tropical-storms-now/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  "wildfires-today/index.html": ["time-in-lead", "figures", "tables", "structured-data"],
  [RIGHT_NOW_FILE]: ["tables", "structured-data"],
};

test("every live page the build can produce was built from the fixtures", () => {
  assert.deepEqual([rA.failed, rB.failed], [[], []]);
  assert.deepEqual([...PAGES.keys()], LIVE_FILES, `missing: ${LIVE_FILES.filter((f) => !PAGES.has(f)).join(", ")}`);
});

test("audit of the earlier live pages (printed for the report)", (t) => {
  for (const f of LIVE_FILES.filter((x) => !EVENT_FILES.includes(x))) t.diagnostic(`${f}: ${audit(f).map(([r, w]) => `${r} (${w})`).join("; ") || "passes"}`);
});

test("the fleet and events pages pass every rule of the checklist", () => {
  for (const f of EVENT_FILES) {
    const gaps = audit(f);
    assert.deepEqual(gaps, [], `${f} fails: ${gaps.map(([r, w]) => `${r} (${w})`).join("; ")}`);
  }
});

test("the earlier live pages fail no rule beyond the ones the allowlist names", () => {
  for (const f of LIVE_FILES.filter((x) => !EVENT_FILES.includes(x))) {
    const extra = audit(f).filter(([r]) => !(r in (ALLOWED_GAPS[f] || {})));
    assert.deepEqual(extra, [], `${f} newly fails: ${extra.map(([r, w]) => `${r} (${w})`).join("; ")}`);
  }
});

test("the allowlist only shrinks: every page and rule on it still fails, so a fixed rule must be taken off", () => {
  for (const [f, reasons] of Object.entries(ALLOWED_GAPS)) {
    const rules = Object.keys(reasons);
    assert.ok(LIVE_PAGES.some((p) => p.file === f), `${f} is not a live page any more; take it off the allowlist`);
    const failing = audit(f).map(([r]) => r);
    for (const r of rules) assert.ok(failing.includes(r), `${f} now passes "${r}": take it off ALLOWED_GAPS in test/live-seo.test.js`);
  }
  assert.ok(EVENT_FILES.every((f) => !(f in ALLOWED_GAPS)), "the fleet and events pages are never on the allowlist");
});

test("every allowlist entry has a documented reason and none goes beyond the audit of 2026-10-06", () => {
  for (const [f, reasons] of Object.entries(ALLOWED_GAPS)) {
    assert.ok(f in BASELINE_GAPS, `${f} was not on the allowlist on 2026-10-06; fix the page instead of adding it`);
    for (const [rule, why] of Object.entries(reasons)) {
      assert.ok(rule in RULES, `${f}: ${rule} is not a rule`);
      assert.ok(BASELINE_GAPS[f].includes(rule), `${f}: "${rule}" was not allowed on 2026-10-06; fix the page instead of adding it`);
      assert.ok(typeof why === "string" && why.trim().length >= 20, `${f}: "${rule}" has no documented reason`);
    }
  }
});
