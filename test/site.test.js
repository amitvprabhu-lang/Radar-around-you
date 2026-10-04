// Tests for the content site generator (site/). They build the whole site into a temporary folder and check what search engines and
// readers would meet: unique titles and descriptions, working internal links, a complete sitemap, claims that match the checks that
// ran, constellation facts that agree with the app's own rules, and the house style (no em dashes, no emoji).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, wrapApp, sitemap, robots, assertChecks, loadCities } from "../site/build.mjs";
import { buildPages } from "../site/pages.mjs";
import { SITE, renderPage, href, urlPath } from "../site/layout.mjs";
import { neighbours, latitudeRanges, ordinal } from "../site/pages-places.mjs";
import { indexConstellations, visibilityFrom } from "../src/constellations.js";

const root = new URL("../", import.meta.url).pathname;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const consIdx = indexConstellations(readJson("public/constellations.json"));
const starsDoc = readJson("public/starnames.json");
const cities = loadCities();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
const appFile = path.join(tmp, "radar.html");
const APP = '<title>Radar Around You</title>\n<link rel="manifest" href="manifest.webmanifest">\n<style>body{margin:0}</style>\n\n<div id="app" data-view="globe"><canvas id="gl"></canvas></div>\n<script>var x=1</script>\n';
fs.writeFileSync(appFile, APP);
const outDir = path.join(tmp, "out");
const result = build({ outDir, appFile, publicDir: null });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const pageFiles = walk(outDir).filter((f) => f.endsWith(".html")).map((f) => path.relative(outDir, f)).sort();
const read = (f) => fs.readFileSync(path.join(outDir, f), "utf8");
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

test("the site has the expected pages and no duplicates", () => {
  // home, 5 data pages, city index and 6 cities, constellation index and 88, stars, guide index and 6 guides, methods
  assert.equal(result.pages, 1 + 5 + 1 + cities.length + 1 + 88 + 1 + 1 + 6 + 1);
  assert.equal(pageFiles.length, result.pages);
  assert.equal(cities.length, 6);
});

test("every page has one h1, a canonical link, a sensible title and description, and parseable structured data", () => {
  for (const f of pageFiles) {
    if (f === "index.html") continue;
    const h = read(f);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, `${f}: h1 count`);
    const title = h.match(/<title>([^<]*)<\/title>/)[1];
    const desc = h.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(title.length >= 15 && title.length <= 85, `${f}: title length ${title.length}`);
    assert.ok(desc.length >= 60 && desc.length <= 320, `${f}: description length ${desc.length}`);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`), `${f}: canonical`);
    assert.match(h, /<html lang="en">/);
    for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1].replace(/\\u003c/g, "<"));
  }
});

test("titles and descriptions are unique across the site", () => {
  const titles = new Map(), descs = new Map();
  for (const f of pageFiles) {
    const h = read(f);
    const t = h.match(/<title>([^<]*)<\/title>/)[1], d = h.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(!titles.has(t), `${f} repeats the title of ${titles.get(t)}`); titles.set(t, f);
    assert.ok(!descs.has(d), `${f} repeats the description of ${descs.get(d)}`); descs.set(d, f);
  }
});

test("every internal link and anchor resolves", () => {
  const ids = (h) => new Set([...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const f of pageFiles) {
    if (f === "index.html") continue;
    const h = read(f).replace(/<script[\s\S]*?<\/script>/g, "");
    for (const m of h.matchAll(/ href="([^"]*)"/g)) {
      const link = m[1];
      if (/^(https?:|mailto:)/.test(link)) continue;
      const [p, frag] = link.split("#");
      let target = p === "" ? f : path.posix.normalize(path.posix.join(path.posix.dirname(f), p));
      if (target === "." || target === "./" || target === "") target = "index.html";
      if (target.endsWith("/")) target += "index.html";
      assert.ok(pageFiles.includes(target), `${f}: link ${link} -> ${target} does not exist`);
      if (frag && target !== "index.html") assert.ok(ids(read(target)).has(frag), `${f}: anchor #${frag} missing in ${target}`);
    }
  }
});

test("href() builds relative links between page files", () => {
  assert.equal(href("index.html", "moon-phases/index.html"), "moon-phases/");
  assert.equal(href("sky/pune/index.html", "constellations/cru/index.html"), "../../constellations/cru/");
  assert.equal(href("sky/pune/index.html", "sky/london/index.html"), "../london/");
  assert.equal(href("sky/index.html", "index.html"), "../");
  assert.equal(href("index.html", "index.html"), "./");
});

test("the sitemap lists every page once and robots.txt points to it", () => {
  const xml = fs.readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, pageFiles.length);
  assert.equal(new Set(locs).size, locs.length);
  for (const f of pageFiles) assert.ok(locs.includes(`${SITE.url}/${urlPath(f)}`), f);
  assert.match(fs.readFileSync(path.join(outDir, "robots.txt"), "utf8"), new RegExp(`Sitemap: ${SITE.url}/sitemap.xml`));
  assert.equal(sitemap(["index.html", "a/index.html"]).includes("<loc>" + SITE.url + "/a/</loc>"), true);
  assert.ok(robots().includes("Allow: /"));
});

test("house style: no em dashes and no emoji in any page", () => {
  for (const f of pageFiles) {
    if (f === "index.html") continue;
    const t = read(f);
    assert.ok(!t.includes("—"), `${f}: em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${f}: emoji`);
  }
});

test("the app page gains search metadata and nothing else changes", () => {
  const h = wrapApp(APP);
  assert.match(h, /<link rel="canonical" href="[^"]+\/">/);
  assert.match(h, /"@type":"WebApplication"/);
  assert.ok(h.indexOf("<noscript>") < h.indexOf('<div id="app"'));
  assert.ok(h.includes('<script>var x=1</script>'));
  // removing what was added gives back the original
  const stripped = h.replace(/<title>[\s\S]*?(?=<link rel="manifest")/, "<title>Radar Around You</title>\n").replace(/<noscript>[\s\S]*?<\/noscript>\n/, "");
  assert.equal(stripped, APP);
  assert.throws(() => wrapApp("<p>no title</p>"), /no expected <title>/);
  assert.throws(() => wrapApp("<title>Radar Around You</title><p>no app</p>"), /no #app/);
  const noscriptLinks = [...h.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)][0][0].match(/href="([^"]+)"/g);
  assert.ok(noscriptLinks.length >= 8);
});

test("the build refuses to run when a comparison with the USNO tables fails or is missing", () => {
  const ok = { phases: { matched: true }, seasons: { matched: true } };
  assert.doesNotThrow(() => assertChecks(ok));
  assert.throws(() => assertChecks({ ...ok, seasons: { matched: false } }), /seasons: results disagree/);
  assert.throws(() => assertChecks({ ...ok, sunTimes: null }), /sunTimes: the comparison table is missing/);
  assert.doesNotThrow(() => assertChecks({ ...ok, sunTimes: null }, true));
  assert.throws(() => build({ outDir: path.join(tmp, "x"), appFile: path.join(tmp, "missing.html"), publicDir: null }), /run npm run build first/);
});

test("with no checks run, no page claims a comparison result", () => {
  const nulls = { phases: null, seasons: null, solarEclipses: null, sunTimes: null };
  const pages = buildPages({ cities, consIdx, starsDoc, checks: nulls });
  for (const p of pages) {
    const t = textOf(renderPage(p));
    assert.ok(!/largest difference/i.test(t), `${p.file} states a check result that did not run`);
  }
  // and with the checks the build ran, the claim appears where it should
  assert.match(textOf(read("moon-phases/index.html")), /largest difference/i);
  assert.match(textOf(read("sky/pune/index.html")), /largest difference was \d+ seconds/);
});

test("constellation areas add up to the whole sky and no page is missing", () => {
  const sum = consIdx.list.reduce((a, c) => a + c.areaDeg2, 0);
  assert.ok(Math.abs(sum - 41252.96) < 40, `areas sum to ${sum}`);
  for (const c of consIdx.list) assert.ok(pageFiles.includes(`constellations/${c.abbr.toLowerCase()}/index.html`), c.abbr);
});

test("neighbours found from the boundaries are mutual and match known borders", () => {
  const nb = new Map(consIdx.list.map((c) => [c.abbr, new Set(neighbours(c, consIdx))]));
  for (const [a, set] of nb) {
    assert.ok(set.size >= 2, `${a} has ${set.size} neighbours`);
    assert.ok(!set.has(a));
    for (const b of set) assert.ok(nb.get(b).has(a), `${a} lists ${b} but ${b} does not list ${a}`);
  }
  assert.deepEqual([...nb.get("UMi")].sort(), ["Cam", "Cep", "Dra"]);
  assert.deepEqual([...nb.get("Cru")].sort(), ["Cen", "Mus"]);
});

test("latitude ranges agree with the app's visibility rule at every latitude", () => {
  for (const c of consIdx.list) {
    const r = latitudeRanges(c);
    for (let lat = -90; lat <= 90; lat += 2.5) {
      const v = visibilityFrom(c, lat);
      const eps = 1e-6;
      if (lat < r.anyS - eps || lat > r.anyN + eps) assert.equal(v.state, "never", `${c.abbr} at ${lat}`);
      else if (v.state === "never") assert.ok(Math.abs(lat - r.anyS) < eps || Math.abs(lat - r.anyN) < eps, `${c.abbr} at ${lat} should be visible`);
      if (lat >= r.fullS && lat <= r.fullN && lat >= -90 + 0) assert.notEqual(v.state, "partial", `${c.abbr} at ${lat}`);
      if (r.circN !== null && lat > r.circN + eps) assert.equal(v.state, "circumpolar", `${c.abbr} at ${lat}`);
    }
  }
});

test("ordinals", () => {
  const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 56, 88, 101, 111].map(ordinal);
  assert.deepEqual(got, ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "56th", "88th", "101st", "111th"]);
  for (const f of pageFiles.filter((x) => x.startsWith("constellations/") && x !== "constellations/index.html")) {
    const m = textOf(read(f)).match(/the (\d+)(st|nd|rd|th) largest of the 88/);
    assert.ok(m, f);
    assert.equal(m[1] + m[2], ordinal(Number(m[1])), f);
  }
});

test("city pages: polar text appears only where the Sun can stay up or down all day", () => {
  const tromso = textOf(read("sky/tromso/index.html"));
  assert.match(tromso, /The Sun stays above the horizon all day from/);
  assert.match(tromso, /The Sun does not rise from/);
  assert.match(tromso, /17 constellations never set/);
  for (const id of ["pune", "london", "newyork", "tokyo", "sydney"]) {
    const t = textOf(read(`sky/${id}/index.html`));
    assert.ok(!/stays above the horizon all day/.test(t), id);
    assert.ok(!/The Sun does not rise from/.test(t), id);
  }
  // southern hemisphere wording
  assert.match(textOf(read("sky/sydney/index.html")), /in the southern hemisphere/);
});

test("the star index lists every IAU-named star in the catalogue, brightest first", () => {
  const t = read("stars/index.html");
  const rows = [...t.matchAll(/<tr><td><strong>([^<]+)<\/strong><\/td><td>[^<]*<\/td><td>(?:<a [^>]*>)?[^<]*(?:<\/a>)?<\/td><td class="num">(-?[\d.]+)<\/td><\/tr>/g)];
  assert.equal(rows.length, starsDoc.stars.length);
  assert.equal(rows.length, 331);
  const mags = rows.map((m) => Number(m[2]));
  assert.deepEqual(mags, [...mags].sort((a, b) => a - b));
});

test("guides quote the official scales from the same tables the app uses", () => {
  const aurora = textOf(read("guides/aurora/index.html"));
  for (const s of ["Minor", "Moderate", "Strong", "Severe", "Extreme"]) assert.ok(aurora.includes(s));
  assert.ok(aurora.includes("8 (including 9-)"));
  const storms = textOf(read("guides/storms/index.html"));
  assert.match(storms, /Category 1 .* 64 to 82 knots/s);
  assert.match(storms, /137 knots or higher/);
  assert.match(storms, /252 or higher km\/h/);
});

test("the build writes the data files next to the app when a public folder is given", () => {
  const out2 = path.join(tmp, "with-public");
  const pub = path.join(tmp, "pub");
  fs.mkdirSync(path.join(pub, "icons"), { recursive: true });
  fs.writeFileSync(path.join(pub, "cities.json"), "[]");
  fs.writeFileSync(path.join(pub, "icons", "a.svg"), "<svg/>");
  build({ outDir: out2, appFile, publicDir: pub });
  assert.ok(fs.existsSync(path.join(out2, "cities.json")) && fs.existsSync(path.join(out2, "icons", "a.svg")));
  assert.ok(fs.existsSync(path.join(out2, "index.html")));
});
