// Tests for the content site generator (site/). They build the whole site into a temporary folder and check what search engines and
// readers would meet: unique titles and descriptions, working internal links, a complete sitemap, claims that match the checks that
// ran, constellation facts that agree with the app's own rules, and the house style (no em dashes, no emoji).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, wrapApp, asDocument, sitemap, robots, assertChecks, loadCities, APP_FEATURES, APP_TITLE, APP_DESCRIPTION } from "../site/build.mjs";
import { buildPages } from "../site/pages.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
import { HUB_FILE, COUNTRY_FILES } from "../site/pages-country.mjs";
import { LIVE_FILES, RIGHT_NOW_FILE } from "../site/livepages.mjs";
import { HAZARD_PAGES } from "../site/hazard.mjs";
import { realFeeds, realPlaces } from "./helpers/hazardfixture.mjs";
import { SITE, renderPage, href, urlPath, noindexFromEnv, robotsMeta, ROBOTS_CONTENT, siteUrlFromEnv, DEFAULT_SITE_URL } from "../site/layout.mjs";
import { neighbours, latitudeRanges, ordinal } from "../site/pages-places.mjs";
import { indexConstellations, visibilityFrom } from "../src/constellations.js";
import { GUIDE_LINKS } from "../src/guidelinks.js";
import { readIndexNowKey } from "../site/indexnow.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
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
  // home, 5 data pages, city index and 6 cities, constellation index and 88, stars, guide index and 6 guides, methods, satellite count, about,
  // the satellites by country hub and its 5 country pages, and from the bundled hazard data the earthquake page and the right-now hub
  assert.equal(result.pages, 1 + 5 + 1 + cities.length + 1 + 88 + 1 + 1 + 6 + 1 + 1 + 1 + 1 + 5 + 2);
  assert.deepEqual(result.liveSkipped, []);
  assert.deepEqual(result.skipped, [], "every country page passes the guard on the bundled snapshot");
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

test("the sitemap lists every page once except the live pages, which have their own sitemap with an accurate last modified time", () => {
  const xml = fs.readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const listed = pageFiles.filter((f) => !LIVE_FILES.includes(f));
  assert.equal(locs.length, listed.length);
  assert.equal(new Set(locs).size, locs.length);
  for (const f of listed) assert.ok(locs.includes(`${SITE.url}/${urlPath(f)}`), f);
  assert.ok(!locs.some((l) => l.includes("how-many-satellites")), "the live page is not in the main sitemap");
  assert.ok(!locs.some((l) => l.includes("satellites-by-country")), "nor are the country pages");
  const live = fs.readFileSync(path.join(outDir, "sitemap-live.xml"), "utf8");
  assert.ok(live.includes(`<loc>${SITE.url}/how-many-satellites-in-orbit/</loc>`));
  assert.deepEqual([...live.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), LIVE_FILES.filter((f) => pageFiles.includes(f)).map((f) => `${SITE.url}/${urlPath(f)}`), "every live page this build wrote");
  assert.ok(!locs.some((l) => /earthquakes-today|right-now/.test(l)), "nor are the hazard pages and the hub");
  assert.match(live, /<lastmod>\d{4}-\d\d-\d\dT[\d:.]+Z<\/lastmod>/);
  const robotsTxt = fs.readFileSync(path.join(outDir, "robots.txt"), "utf8");
  assert.match(robotsTxt, new RegExp(`Sitemap: ${SITE.url}/sitemap.xml`));
  assert.match(robotsTxt, new RegExp(`Sitemap: ${SITE.url}/sitemap-live.xml`));
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
  assert.equal(robots({ noindex: false }), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\nSitemap: ${SITE.url}/sitemap-live.xml\n`);
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

test("every built page is a complete document that declares its encoding, so a host that sends no charset cannot garble it", () => {
  // The first deployment served index.html as a bare fragment. The browser guessed windows-1252, a regular expression in the app's
  // script was garbled into a syntax error, and the app never started. Every page, the app page included, must start like this.
  for (const f of pageFiles) {
    const h = read(f);
    assert.match(h, /^<!doctype html>/i, `${f}: starts with a doctype`);
    assert.ok(h.slice(0, 1024).includes('<meta charset="utf-8">'), `${f}: charset declared within the first 1024 bytes`);
    assert.ok(h.slice(0, 1024).includes('<meta name="viewport"'), `${f}: viewport declared near the top`);
    assert.equal(countOf(h, "<!doctype"), 1, `${f}: one doctype`);
  }
  const home = read("index.html");
  assert.equal(countOf(home, '<div id="app"'), 1, "the app is in the home page once");
  assert.ok(home.includes('<script>var x=1</script>'), "the app's own script is kept as it was");
});

test("the home page head positions the site as a live feed", () => {
  assert.equal(APP_TITLE, "Radar Around You: live feed of satellites, ISS, quakes, aurora and storms");
  assert.match(APP_DESCRIPTION, /^A free live feed of what is above, around and under you/);
  assert.equal(APP_DESCRIPTION, "A free live feed of what is above, around and under you: satellites and the ISS, aircraft over six cities, tonight's sky, earthquakes, aurora, storms and fires, in 3D, for any place on Earth.");
  const full = asDocument(wrapApp(APP, { noindex: false }));
  assert.ok(full.includes(`<title>${APP_TITLE}</title>`));
  assert.ok(full.includes(`<meta name="description" content="${APP_DESCRIPTION.replace(/'/g, "&#39;")}">`) || full.includes(`<meta name="description" content="${APP_DESCRIPTION}">`));
  assert.ok(APP_TITLE.length <= 85, String(APP_TITLE.length));
});

test("asDocument wraps the app page once, puts its lead tags in head, changes nothing else, and refuses a page that is already a document", () => {
  const d = asDocument(APP);
  assert.match(d, /^<!doctype html>\n<html lang="en">/);
  assert.ok(d.indexOf('<meta charset="utf-8">') < d.indexOf("<title>"), "charset comes before anything that could be misread");
  assert.ok(d.endsWith("</body>\n</html>\n"));
  // round trip: take the added wrapper away and the original fragment is back, byte for byte
  const unwrapped = d.replace(/^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport"[^>]*>\n/, "").replace("</head>\n<body>\n", "").replace(/<\/body>\n<\/html>\n$/, "");
  assert.equal(unwrapped, APP);
  // the app page as the site builds it: every search tag is in head, the app and its script are in body
  const full = asDocument(wrapApp(APP, { noindex: false }));
  const [head, body] = [full.slice(full.indexOf("<head>"), full.indexOf("</head>")), full.slice(full.indexOf("<body>"))];
  for (const part of ["<title>", '<meta name="description"', '<link rel="canonical"', '<meta name="robots"', 'application/ld+json', '<meta property="og:title"', '<link rel="manifest"', "<style>"]) {
    assert.ok(head.includes(part), `head has ${part}`);
    assert.ok(!body.includes(part), `body does not have ${part}`);
  }
  assert.ok(body.startsWith("<body>\n") && body.includes("<noscript>") && body.indexOf("<noscript>") < body.indexOf('<div id="app"'));
  assert.ok(body.includes('<script>var x=1</script>'));
  assert.equal(countOf(full, "<title>"), 1);
  assert.throws(() => asDocument(d), /already a complete document/);
  assert.throws(() => asDocument("<!DOCTYPE html><title>x</title>"), /already a complete document/);
  assert.throws(() => asDocument('<html lang="en"><body></body></html>'), /already a complete document/);
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
    assert.ok(!t.includes("\u2014") && !t.includes("\u2013"), `${f}: em or en dash`);
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
  const noscript = [...h.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)][0][0];
  for (const f of APP_FEATURES) assert.ok(noscript.includes(f), `noscript lists: ${f}`);
  assert.ok(noscript.includes('href="about/"'), "noscript links to the About page");
  assert.ok(noscript.length > 1400, `noscript is a real description (${noscript.length} characters)`);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  assert.deepEqual(ld.find((o) => o["@type"] === "WebApplication").featureList, APP_FEATURES);
  const site = ld.find((o) => o["@type"] === "WebSite");
  assert.ok(site && site.name === SITE.name && site.url === `${SITE.url}/`);
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
  for (const must of ["about/", "how-many-satellites-in-orbit/"]) assert.ok(GUIDE_LINKS.some((l) => l.href === must), `${must} is linked from the app's About sheet`);
});

test("a noindex build writes no sitemaps at all, as before", () => {
  const dir = path.join(tmp, "out-noindex");
  build({ outDir: dir, appFile, publicDir: null, noindex: true });
  assert.ok(!fs.existsSync(path.join(dir, "sitemap.xml")));
  assert.ok(!fs.existsSync(path.join(dir, "sitemap-live.xml")));
  assert.equal(fs.readFileSync(path.join(dir, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n");
  assert.ok(fs.readFileSync(path.join(dir, SATCOUNT_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
});

test("the About page is built, is in the main sitemap and the navigation, and carries the right robots tag", () => {
  assert.ok(pageFiles.includes("about/index.html"));
  const xml = fs.readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  assert.ok(xml.includes(`<loc>${SITE.url}/about/</loc>`));
  assert.ok(read("about/index.html").includes('<meta name="robots" content="index,follow,max-image-preview:large">'));
  assert.ok(read("moon-phases/index.html").includes('href="../about/"'), "every page's navigation links to About");
  assert.ok(read("index.html").includes('href="about/"'));
});

test("an indexable build writes llms.txt whose every link is a built page", () => {
  const txt = fs.readFileSync(path.join(outDir, "llms.txt"), "utf8");
  assert.ok(txt.startsWith("# Radar Around You\n"));
  const links = [...txt.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 15, String(links.length));
  for (const l of links) {
    if (l === `${SITE.url}/`) continue;
    assert.ok(l.startsWith(`${SITE.url}/`), l);
    // a live page counts even when this build wrote no copy of it: the live copy arrives with the next pull
    const f = l.slice(SITE.url.length + 1) + "index.html";
    assert.ok(pageFiles.includes(f) || LIVE_FILES.includes(f), `${l} is not a built page or a live page`);
  }
  assert.ok(!/[\u2013\u2014]/.test(txt));
});

test("a noindex build writes no llms.txt, like it writes no sitemap", () => {
  const dir = path.join(tmp, "out-noindex-llms");
  build({ outDir: dir, appFile, publicDir: null, noindex: true });
  assert.ok(!fs.existsSync(path.join(dir, "llms.txt")));
});

test("the deploy-time copy writes the seven live pages from the bundled snapshot, so a redeploy never answers 404 for them", () => {
  for (const f of [SATCOUNT_FILE, HUB_FILE, ...COUNTRY_FILES]) {
    assert.ok(pageFiles.includes(f), f);
    const h = read(f);
    assert.match(h, /<strong>[\d,]+ active satellites<\/strong>/, f);
    assert.ok(Buffer.byteLength(h) < 400 * 1024, `${f}: ${Buffer.byteLength(h)}`);
  }
  for (const f of COUNTRY_FILES) assert.match(read(f), /<svg [^>]*class="map" role="img"/, f);
  assert.ok(read("moon-phases/index.html").includes('<a href="../satellites-by-country/">By country</a>'), "the nav names the hub");
  assert.ok(read(SATCOUNT_FILE).includes('<a href="../satellites-by-country/">satellites by country</a>'), "the count page links to the hub");
  const llms = fs.readFileSync(path.join(outDir, "llms.txt"), "utf8");
  assert.ok(llms.includes(`- [Satellites by country](${SITE.url}/satellites-by-country/): `));
});

test("the deploy-time copy writes the earthquake page and the right-now hub from the bundled data, with their data times, a nav entry and llms.txt notes", () => {
  for (const f of ["earthquakes-today/index.html", RIGHT_NOW_FILE]) assert.ok(pageFiles.includes(f), f);
  for (const f of HAZARD_PAGES.slice(1).map((p) => p.file)) assert.ok(!pageFiles.includes(f), `${f}: its data is not bundled, so no copy is written`);
  const bundled = readJson("public/quakes.json").generated;
  const q = read("earthquakes-today/index.html");
  assert.ok(q.includes(`<time datetime="${bundled}">`), "the bundled feed's own time");
  assert.ok(textOf(q).includes("This copy was built from the data bundled with the site when it was deployed"), "the old bundled data says so");
  const hub = read(RIGHT_NOW_FILE);
  assert.ok(hub.includes('href="../earthquakes-today/"') && hub.includes('href="../how-many-satellites-in-orbit/"'));
  assert.ok(!hub.includes('href="../aurora-tonight/"'), "a page that was not written is not linked");
  assert.ok(textOf(hub).includes("This copy was built from the data bundled with the site when it was deployed"), "the hub says its bundled data is old");
  assert.ok(read("moon-phases/index.html").includes('<a href="../right-now/">Right now</a>'), "the nav names the hub");
  const live = fs.readFileSync(path.join(outDir, "sitemap-live.xml"), "utf8");
  assert.ok(live.includes(`<loc>${SITE.url}/earthquakes-today/</loc><lastmod>${bundled}</lastmod>`), "lastmod is the data time");
  const llms = fs.readFileSync(path.join(outDir, "llms.txt"), "utf8");
  assert.ok(llms.includes(`- [Right now](${SITE.url}/right-now/): The latest number from each live page`));
  assert.ok(llms.includes(`- [Earthquakes today](${SITE.url}/earthquakes-today/): Earthquakes of magnitude 2.5 and above`));
  for (const p of HAZARD_PAGES) assert.ok(llms.includes(`- [${p.name}](${SITE.url}/${p.slug}/): `), `${p.slug} is listed although only some copies are written at deploy time`);
});

test("with every hazard feed bundled, the deploy-time copy writes all five hazard pages and the hub links them all", () => {
  const r = realFeeds();
  const dir = path.join(tmp, "out-hazards");
  const res = build({ outDir: dir, appFile, publicDir: null, noindex: false, now: new Date("2026-10-05T18:45:00Z"), hazards: { ...r, places: realPlaces() } });
  assert.deepEqual(res.liveSkipped, []);
  const hub = fs.readFileSync(path.join(dir, RIGHT_NOW_FILE), "utf8");
  for (const p of HAZARD_PAGES) {
    const h = fs.readFileSync(path.join(dir, p.file), "utf8");
    assert.match(h, /<p class="lead">As of /, p.file);
    assert.ok(!h.includes("This copy was built from the data bundled"), `${p.file}: fresh data carries no note`);
    assert.ok(hub.includes(`href="../${p.slug}/"`), p.slug);
  }
  const xml = fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8");
  assert.ok(!/earthquakes-today|aurora-tonight|asteroid-close|tropical-storms|wildfires-today|right-now/.test(xml), "the main sitemap leaves out every live page");
  assert.equal([...fs.readFileSync(path.join(dir, "sitemap-live.xml"), "utf8").matchAll(/<loc>/g)].length, 13);
});

test("an indexable build writes the IndexNow key file at the site root, holding the key and nothing else", () => {
  const key = readIndexNowKey();
  assert.ok(key, "the repository has a key");
  assert.equal(fs.readFileSync(path.join(outDir, `${key}.txt`), "utf8"), key);
  const txt = fs.readdirSync(outDir).filter((f) => f.endsWith(".txt")).sort();
  assert.deepEqual(txt, [`${key}.txt`, "llms.txt", "robots.txt"].sort(), "no other text file appears at the root");
  const other = path.join(tmp, "out-other-key");
  build({ outDir: other, appFile, publicDir: null, noindex: false, indexnowKey: "Test-Key-1234" });
  assert.equal(fs.readFileSync(path.join(other, "Test-Key-1234.txt"), "utf8"), "Test-Key-1234");
  assert.ok(!fs.existsSync(path.join(other, `${key}.txt`)));
});

test("a noindex build, or a build without a key, writes no IndexNow key file", () => {
  const key = readIndexNowKey();
  const dir = path.join(tmp, "out-noindex-key");
  build({ outDir: dir, appFile, publicDir: null, noindex: true });
  assert.ok(!fs.existsSync(path.join(dir, `${key}.txt`)));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".txt")), ["robots.txt"]);
  const none = path.join(tmp, "out-no-key");
  build({ outDir: none, appFile, publicDir: null, noindex: false, indexnowKey: null });
  assert.deepEqual(fs.readdirSync(none).filter((f) => f.endsWith(".txt")).sort(), ["llms.txt", "robots.txt"]);
});

test("a malformed IndexNow key stops the build before it writes anything", () => {
  for (const bad of ["../evil", "short", "a b c d e f g h"]) {
    const dir = path.join(tmp, "out-bad-key");
    assert.throws(() => build({ outDir: dir, appFile, publicDir: null, noindex: false, indexnowKey: bad }), /indexnow/i, bad);
    assert.ok(!fs.existsSync(dir), bad);
  }
});
