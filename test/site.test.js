// Tests for the content site generator (site/). They build the whole site into a temporary folder and check what search engines and
// readers would meet: unique titles and descriptions, working internal links, a complete sitemap, claims that match the checks that
// ran, constellation facts that agree with the app's own rules, and the house style (no em dashes, no emoji).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build, wrapApp, sitemap, robots, assertChecks, loadCities } from "../site/build.mjs";
import { buildPages } from "../site/pages.mjs";
import { SITE, renderPage, href, urlPath, noindexFromEnv, robotsMeta, ROBOTS_CONTENT, siteUrlFromEnv, DEFAULT_SITE_URL } from "../site/layout.mjs";
import { neighbours, latitudeRanges, ordinal } from "../site/pages-places.mjs";
import { indexConstellations, visibilityFrom } from "../src/constellations.js";
import { GUIDE_LINKS } from "../src/guidelinks.js";

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
// explicit, so a SITE_NOINDEX left in someone's shell cannot change what the ordinary checks below look at
const result = build({ outDir, appFile, publicDir: null, noindex: false });
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

const INDEXABLE = '<meta name="robots" content="index,follow,max-image-preview:large">';
const NOINDEX = '<meta name="robots" content="noindex,nofollow">';
const countOf = (s, part) => s.split(part).length - 1;

test("the normal build still tells search engines to index every page, exactly as before the noindex switch existed", () => {
  assert.equal(result.noindex, false);
  assert.equal(ROBOTS_CONTENT.index, "index,follow,max-image-preview:large");
  assert.equal(robotsMeta(false), INDEXABLE);
  for (const f of pageFiles) {
    const h = read(f);
    assert.equal(countOf(h, INDEXABLE), 1, `${f}: one indexable robots tag`);
    assert.ok(!/noindex/i.test(h), `${f}: no noindex in a normal build`);
  }
  assert.equal(robots({ noindex: false }), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);
  assert.ok(fs.existsSync(path.join(outDir, "sitemap.xml")));
});

test("SITE_NOINDEX: only 1 turns it on, only 0 or nothing turns it off, anything else is refused", () => {
  for (const v of [undefined, null, "", "0", " 0 "]) assert.equal(noindexFromEnv(v), false, String(v));
  for (const v of ["1", " 1 "]) assert.equal(noindexFromEnv(v), true, String(v));
  for (const v of ["true", "yes", "on", "2", "false", "off", "no"]) assert.throws(() => noindexFromEnv(v), /SITE_NOINDEX must be 1 or 0/, v);
  assert.equal(SITE.noindex, noindexFromEnv(process.env.SITE_NOINDEX), "the site default follows the environment");
});

test("a bad SITE_NOINDEX stops the site build before it writes anything; 1 and 0 are accepted", () => {
  const layout = new URL("../site/layout.mjs", import.meta.url).href;
  const run = (v) => spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(layout)}).then((m) => console.log("noindex=" + m.SITE.noindex))`], { env: { ...process.env, SITE_NOINDEX: v }, encoding: "utf8" });
  const bad = run("yes");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /SITE_NOINDEX must be 1 or 0/);
  const on = run("1"), off = run("0");
  assert.equal(on.status, 0, on.stderr); assert.match(on.stdout, /noindex=true/);
  assert.equal(off.status, 0, off.stderr); assert.match(off.stdout, /noindex=false/);
});

test("SITE_URL: a plain https address is used (without a trailing slash); anything else stops the build", () => {
  for (const v of [undefined, null, "", "   "]) assert.equal(siteUrlFromEnv(v), DEFAULT_SITE_URL, String(v));
  const good = [["https://zeninnov8.com", "https://zeninnov8.com"], ["https://zeninnov8.com/", "https://zeninnov8.com"], ["  https://zeninnov8.com  ", "https://zeninnov8.com"],
    ["https://zeninnov8.com//", "https://zeninnov8.com"], ["https://example.org:8443", "https://example.org:8443"],
    ["https://amitvprabhu-lang.github.io/Radar-around-you/", "https://amitvprabhu-lang.github.io/Radar-around-you"]];
  for (const [given, want] of good) assert.equal(siteUrlFromEnv(given), want, given);
  // the first one is a real slip: a stray 1 typed in front of the address in the hosting form
  for (const bad of ["1https://zeninnov8.com", "HTTPS://ZENINNOV8.COM", "https://ZENINNOV8.COM", "zeninnov8.com", "http://zeninnov8.com", "https://", "https://exa mple.org",
    "https://example.org?x=1", "https://example.org/#top", "https://user:pw@example.org", "ftp://example.org", "https://example.org/a b"]) {
    assert.throws(() => siteUrlFromEnv(bad), /SITE_URL must be an https address/, bad);
  }
  assert.equal(SITE.url, siteUrlFromEnv(process.env.SITE_URL), "the site uses the checked address");
});

test("a bad SITE_URL stops the site build before it writes anything; a good one is accepted", () => {
  const layout = new URL("../site/layout.mjs", import.meta.url).href;
  const run = (v) => spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(layout)}).then((m) => console.log("url=" + m.SITE.url))`], { env: { ...process.env, SITE_URL: v }, encoding: "utf8" });
  const bad = run("1https://zeninnov8.com");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /SITE_URL must be an https address/);
  const good = run("https://zeninnov8.com/");
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /url=https:\/\/zeninnov8\.com\n/);
});

test("with noindex on, no page can be indexed, robots.txt disallows everything and there is no sitemap", () => {
  const out2 = path.join(tmp, "out-noindex");
  const r2 = build({ outDir: out2, appFile, publicDir: null, noindex: true });
  assert.equal(r2.noindex, true);
  assert.equal(r2.pages, result.pages, "the same pages are still built, only the instructions to crawlers change");
  const files = walk(out2).filter((f) => f.endsWith(".html")).map((f) => path.relative(out2, f));
  assert.equal(files.length, r2.pages);
  for (const f of files) {
    const h = fs.readFileSync(path.join(out2, f), "utf8");
    assert.equal(countOf(h, NOINDEX), 1, `${f}: one noindex robots tag`);
    assert.ok(!h.includes('content="index,follow'), `${f}: no indexable robots tag left`);
  }
  assert.equal(fs.readFileSync(path.join(out2, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n");
  assert.ok(!fs.existsSync(path.join(out2, "sitemap.xml")), "no sitemap while noindex is on");
  // canonical links still name the address the site was built for, so nothing else about the page changes
  assert.ok(fs.readFileSync(path.join(out2, "moon-phases/index.html"), "utf8").includes(`<link rel="canonical" href="${SITE.url}/moon-phases/">`));
  // the page text is identical apart from the robots tag
  for (const f of ["moon-phases/index.html", "constellations/cru/index.html"]) {
    assert.equal(fs.readFileSync(path.join(out2, f), "utf8").replace(NOINDEX, INDEXABLE), read(f), f);
  }
  assert.equal(robots({ noindex: true }), "User-agent: *\nDisallow: /\n");
});

test("the app page gets the noindex tag too, and everything else about it is unchanged", () => {
  const on = wrapApp(APP, { noindex: true }), off = wrapApp(APP, { noindex: false });
  assert.equal(countOf(on, NOINDEX), 1);
  assert.ok(!on.includes("index,follow"));
  assert.equal(countOf(off, INDEXABLE), 1);
  assert.equal(on.replace(NOINDEX, INDEXABLE), off);
  assert.equal(wrapApp(APP), wrapApp(APP, { noindex: SITE.noindex }), "the default follows the site setting");
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
  const rows = [...t.matchAll(/<tr><td><strong>([^<]+)<\/strong><\/td><td>[^<]*<\/td><td>(?:<a [^>]*>)?[^<]*(?:<\/a>)?<\/td><td class="num">(-?[\d.]+)<\/td>(?:<td class="num">[^<]*<\/td>)*<\/tr>/g)];
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

test("the star pages carry distances and planet counts from the details file, with both credits", () => {
  const details = readJson("public/stardetails.json");
  const stars = read("stars/index.html");
  assert.match(stars, /Distance \(light-years\)/);
  assert.match(stars, /Confirmed planets/);
  assert.match(stars, /HYG database v4\.4/);
  assert.match(stars, /CC BY-SA 4\.0/);
  assert.match(stars, /operated by the California Institute of Technology/);
  const withPlanets = starsDoc.stars.filter((s) => details.planets[String(s.i)]).length;
  assert.ok(withPlanets > 20);
  assert.ok(textOf(stars).includes(`${withPlanets} of them have confirmed planets`));
  // the Sirius row: 8.6 light-years and no planets listed
  assert.match(stars, /<strong>Sirius<\/strong><\/td><td>α Canis Majoris<\/td><td><a [^>]*>Canis Major<\/a><\/td><td class="num">-1\.44<\/td><td class="num">8\.6<\/td><td class="num">none listed<\/td>/);
  // Pollux has one planet
  assert.match(stars, /<strong>Pollux<\/strong>[\s\S]*?<td class="num">1<\/td><\/tr>/);
  assert.match(read("constellations/cma/index.html"), /Distance \(light-years\)/);
  // a star with no usable distance says so instead of showing a made-up number
  assert.ok(Object.values(details.stars).some((v) => v[0] == null));
  assert.doesNotMatch(textOf(stars), /NaN|undefined|\bnull\b/);
});

test("every link the app shows to the content pages has a page, and the list has no repeats", () => {
  assert.ok(GUIDE_LINKS.length >= 12);
  assert.equal(new Set(GUIDE_LINKS.map((l) => l.href)).size, GUIDE_LINKS.length);
  for (const l of GUIDE_LINKS) {
    assert.match(l.href, /^[a-z0-9-]+(\/[a-z0-9-]+)*\/$/, `${l.href} is a relative folder address`);
    assert.ok(pageFiles.includes(l.href + "index.html"), `${l.href} has no page`);
    assert.ok(l.label.length > 3 && l.group);
  }
  // the pages the site's own navigation lists are all reachable from the app too
  for (const nav of ["moon-phases/", "eclipses/", "meteor-showers/", "planets/", "sky/", "guides/", "methods/"]) {
    assert.ok(GUIDE_LINKS.some((l) => l.href === nav) || nav === "guides/", `${nav} is linked from the app`);
  }
});
