// Builds the live pages from a collector data folder, for the GitHub workflow that runs after each collection: the satellite count page,
// the satellites by country hub and its country pages, the five hazard pages and the /right-now/ hub (every page in site/livepages.mjs).
//   node site/build-live.mjs --data live --out live/pages
// Output (in --out): the pages, sitemap-live.xml (only when the site is indexable) and index.json, which lists each file with its hash so
// hosting/pull.php copies only what changed. Shape of index.json:
//   { schema: 1, satellitesVersion, siteUrl, indexnowKey?, noindex, generator, built, feeds: { <feed>: version },
//     pages: { "<page>": { feeds: { <feed>: version }, dataTime } }, files: { "<path>": { sha256, size, changed } } }
// satellitesVersion is the satellites version the satellite pages were built from. indexnowKey is the IndexNow key from
// site/indexnow.key; it is left out when there is no key file or the site is noindex, and then hosting/pull.php sends no IndexNow pings.
// feeds holds every feed version in the manifest; pages holds, for each live page that exists, the versions of its own feeds and its data
// time (the feed's own time, which is also its lastmod in sitemap-live.xml). Readers take only the fields they need, so a reader older
// than a field ignores it.
// generator is a sha256 over the source files that shape the pages (GENERATOR_FILES). Each group of pages is built on its own and only
// when one of its own feeds has a new version, or the site address, the noindex mode, the IndexNow key or the generator changed: the satellite pages
// (all or nothing, as before) when the satellites feed changes, each hazard page when its feeds change. The right-now hub is worked out
// every run and written only when its text changes. A file's `changed` time moves only when its bytes change, and the live sitemap gives
// each page its data time (the feed's own time) as lastmod.
// A hazard page whose feed is older than its limit (site/hazard.mjs, MAX_AGE_HOURS) or missing is skipped with a printed reason; a page
// whose feed fails its guard is skipped too, and the command then exits with an error so the workflow step turns red. Either way the
// previous copy and its index entry stay, and the other pages are unaffected. Everything is built in memory before anything is written.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE, renderPage } from "./layout.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { satelliteCountPage, sitemapLive } from "./pages-satcount.mjs";
import { countryPageSet, coastFromBuffer } from "./pages-country.mjs";
import { LIVE_PAGES, LIVE_FILES, SATCOUNT_FILE, SATELLITE_FILES, RIGHT_NOW_FILE } from "./livepages.mjs";
import { HAZARD_PAGES, summariseQuakes, summariseSpace, summariseApproaches, summariseStorms, summariseFires, isoZ, parseTime } from "./hazard.mjs";
import { HAZARD_PAGE_FUNCTIONS, hubRows, rightNowPage } from "./pages-hazard.mjs";
import { readIndexNowKey, INDEXNOW_KEY_RE } from "./indexnow.mjs";

const NEED = ["details.bin", "satmeta.json", "swarm.bin"];
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// The files whose contents decide what the pages look like and say. Paths are relative to site/, so the app modules the page code
// imports (the orbit model, the decoders, the scales and the asteroid helpers in src/), the coastlines and the place list are named with
// "../". A change to any of them rebuilds every page on the next run. Everything is read from the repository (the workflow checks it out).
export const GENERATOR_FILES = ["satcount.mjs", "pages-satcount.mjs", "layout.mjs", "build-live.mjs", "satcountry.mjs", "svgmap.mjs", "pages-country.mjs",
  "hazard.mjs", "pages-hazard.mjs", "livepages.mjs", "indexnow.mjs",
  "../src/core.js", "../src/data.js", "../src/info.js", "../src/scales.js", "../src/asteroids.js", "../public/coast.bin", "../public/places.json"];
export const COAST_FILE = fileURLToPath(new URL("../public/coast.bin", import.meta.url));
export const PLACES_FILE = fileURLToPath(new URL("../public/places.json", import.meta.url));
export function generatorHash(files = GENERATOR_FILES) {
  const h = crypto.createHash("sha256");
  for (const name of files) h.update(`${name}\n`).update(fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)))).update("\n");
  return h.digest("hex");
}

// How each hazard page reads its feeds. Every function gets read(feed, file) and returns the summary for its page function.
const HAZARD_READERS = {
  quakes: (rd, o) => summariseQuakes(rd.json("quakes", "quakes.json"), o),
  aurora: (rd, o) => summariseSpace({
    kp: rd.json("kp", "kp.json"),
    spaceweather: rd.has("spaceweather") ? rd.json("spaceweather", "spaceweather.json") : null,
    aurora: rd.has("aurora") ? { meta: rd.json("aurora", "aurora.json"), grid: rd.bytes("aurora", "aurora.bin") } : null,
  }, o),
  asteroids: (rd, o) => summariseApproaches(rd.json("closeapproaches", "closeapproaches.json"), o),
  storms: (rd, o) => summariseStorms(rd.json("storms", "storms.json"), { ...o, events: rd.has("events") ? { list: rd.json("events", "events.json"), dataTime: rd.time("events") } : null }),
  fires: (rd, o) => summariseFires({ summary: rd.json("fires", "fires.json"), bin: rd.bytes("fires", "fires.bin") }, o),
};

// pageFunctions and hubPage can be replaced in tests, to show that a page that fails to render is skipped on its own.
export function buildLive({ dataDir, outDir, now = new Date(), noindex = SITE.noindex, bounds, generator = generatorHash(), coastFile = COAST_FILE, placesFile = PLACES_FILE, min, indexnowKey = readIndexNowKey(), pageFunctions = HAZARD_PAGE_FUNCTIONS, hubPage = rightNowPage } = {}) {
  if (indexnowKey != null && !INDEXNOW_KEY_RE.test(indexnowKey)) throw new Error("build-live: the IndexNow key must be 8 to 128 letters, digits and dashes");
  const key = noindex ? null : indexnowKey || null;  // a noindex site is never pinged, so its index names no key
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const feeds = (manifest && typeof manifest.feeds === "object" && manifest.feeds) || {};
  const version = (name) => (feeds[name] && feeds[name].version ? String(feeds[name].version) : null);
  const rd = {
    has: (name) => !!(feeds[name] && feeds[name].version && feeds[name].files),
    bytes: (name, file) => {
      const rel = feeds[name] && feeds[name].files && feeds[name].files[file];
      if (!rel) throw new Error(`build-live: the manifest does not name ${file} for ${name}`);
      return fs.readFileSync(path.join(dataDir, rel));
    },
    json(name, file) { return JSON.parse(this.bytes(name, file).toString("utf8")); },
    time: (name) => (feeds[name] && (feeds[name].sourceTime || feeds[name].fetchedAt)) || null,
  };

  const indexPath = path.join(outDir, "index.json");
  // Only this read is forgiving: a corrupt or truncated index.json (say, a crash while it was written) counts as no previous build, so the next run rebuilds and overwrites it.
  let prev = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") prev = parsed;
  } catch { /* missing, unreadable or invalid: no previous build */ }
  const sameShell = !!(prev && prev.noindex === noindex && prev.siteUrl === SITE.url && prev.generator === generator && (prev.indexnowKey ?? null) === key && prev.pages && typeof prev.pages === "object");
  const exists = (rel) => fs.existsSync(path.join(outDir, rel));
  const versionsOf = (names) => Object.fromEntries(names.filter((n) => version(n)).map((n) => [n, version(n)]));
  const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  // a page is kept as it is when it was built from the same versions of its feeds, in the same mode, by the same generator, and is still there
  const keepable = (file, names) => sameShell && prev.pages[file] && same(prev.pages[file].feeds, versionsOf(names)) && prev.files[file] && exists(file);

  const texts = new Map();   // file -> html, built in this run
  const pages = {};          // file -> { feeds, dataTime } for every page that exists after this run
  const kept = new Set(), skipped = [], stale = [], failed = [], warnings = [];
  const carry = (file) => { if (prev && prev.pages && prev.pages[file] && prev.files[file] && exists(file)) { pages[file] = prev.pages[file]; kept.add(file); return true; } return false; };
  // carry several files; kept: whether at least one previous copy stays, so the message can say so only when it is true
  const carryAll = (files) => files.map(carry).some(Boolean);

  // Shared inputs. A failure here stops the whole build before anything is written, as before.
  let coast = null, places = null;
  const getCoast = () => (coast = coast || coastFromBuffer(fs.readFileSync(coastFile)));
  const getPlaces = () => (places = places || JSON.parse(fs.readFileSync(placesFile, "utf8")));

  // ---- the satellite pages: all or nothing, as before
  let satSummary = null;
  const satFeed = feeds.satellites;
  const satVersion = version("satellites");
  const satKeep = keepable(SATCOUNT_FILE, ["satellites"]);
  try {
    if (!satFeed || !satVersion || !satFeed.files) throw new Error("build-live: the manifest has no satellites feed");
    for (const f of NEED) if (!satFeed.files[f]) throw new Error(`build-live: the manifest does not name ${f}`);
    const sat = { meta: rd.json("satellites", "satmeta.json"), details: rd.bytes("satellites", "details.bin"), swarm: rd.bytes("satellites", "swarm.bin"), names: satFeed.files["names.txt"] ? rd.bytes("satellites", "names.txt").toString("utf8") : null };
    const counts = countSatellites(sat);
    assertPlausible(counts, bounds);
    const taken = isoZ(parseTime(counts.taken));
    satSummary = { active: counts.active, dataTime: taken };
    if (satKeep) {
      for (const f of SATELLITE_FILES) carry(f);
    } else {
      const country = countryPageSet(sat, { coast: getCoast(), updated: now, ...(min === undefined ? {} : { min }) });
      texts.set(SATCOUNT_FILE, renderPage(satelliteCountPage(counts, { updated: now }), { noindex }));
      for (const p of country.pages) texts.set(p.file, renderPage(p, { noindex }));
      for (const f of SATELLITE_FILES) if (texts.has(f)) pages[f] = { feeds: { satellites: satVersion }, dataTime: taken };
      // a country page left out this run keeps its earlier copy, if there is one
      for (const s of country.skipped) skipped.push({ ...s, kept: carry(s.file) });
    }
  } catch (e) {
    if (/ENOENT/.test(e.message) && e.path === coastFile) throw e;
    failed.push({ step: "satellite pages", files: SATELLITE_FILES, reason: e.message, kept: carryAll(SATELLITE_FILES) });
    satSummary = null;
  }

  // ---- the hazard pages, each on its own
  const summaries = {}, missing = satSummary ? {} : { satellites: "data that failed its checks" };
  for (const hp of HAZARD_PAGES) {
    const names = hp.feeds;
    if (!rd.has(names[0])) {
      missing[hp.key] = "not in the collector's data";
      stale.push({ file: hp.file, reason: `the manifest has no ${names[0]} feed`, kept: carry(hp.file) });
      continue;
    }
    try {
      const s = HAZARD_READERS[hp.key](rd, { now, places: hp.key === "fires" ? getPlaces() : undefined });
      summaries[hp.key] = s;
      for (const w of s.warnings || []) warnings.push({ file: hp.file, reason: w });
      if (keepable(hp.file, names)) { carry(hp.file); continue; }
      pages[hp.file] = { feeds: versionsOf(names), dataTime: s.dataTime };
    } catch (e) {
      if (e && e.code === "ENOENT" && (e.path === coastFile || e.path === placesFile)) throw e;
      if (e && e.stale) { missing[hp.key] = `data older than the page's limit (${e.message})`; stale.push({ file: hp.file, reason: e.message, kept: carry(hp.file) }); }
      else { missing[hp.key] = "data that failed its checks"; failed.push({ step: `hazard page ${hp.slug}`, files: [hp.file], reason: e.message, kept: carry(hp.file) }); }
    }
  }
  // Render each hazard page on its own: a page that fails to render is skipped (its previous copy stays) and reported as a failure. The
  // pages that exist after this run (built or kept) are linked from each other, so a failure is followed by another pass without it.
  let available = [];
  for (let pass = 0; pass < HAZARD_PAGES.length + 1; pass++) {
    available = LIVE_FILES.filter((f) => f === RIGHT_NOW_FILE || pages[f]);
    let broke = false;
    for (const hp of HAZARD_PAGES) {
      if (!summaries[hp.key] || kept.has(hp.file) || !pages[hp.file]) continue;
      try {
        texts.set(hp.file, renderPage(pageFunctions[hp.key](summaries[hp.key], { built: available, coast: getCoast() }), { noindex }));
      } catch (e) {
        texts.delete(hp.file);
        delete pages[hp.file];
        delete summaries[hp.key];
        missing[hp.key] = "a page that could not be built";
        failed.push({ step: `hazard page ${hp.slug} (rendering)`, files: [hp.file], reason: e.message, kept: carry(hp.file) });
        broke = true;
      }
    }
    if (!broke) break;
  }

  // ---- the right-now hub: worked out every run from the same summaries; a page that is not live this run gets no number and no link
  const shown = (key, file) => (pages[file] && summaries[key] ? summaries[key] : null);
  const rows = hubRows({
    satellites: pages[SATCOUNT_FILE] && satSummary ? satSummary : null,
    quakes: shown("quakes", HAZARD_PAGES[0].file), space: shown("aurora", HAZARD_PAGES[1].file), approaches: shown("asteroids", HAZARD_PAGES[2].file),
    storms: shown("storms", HAZARD_PAGES[3].file), fires: shown("fires", HAZARD_PAGES[4].file), missing,
  });
  // a hazard page kept from an earlier run whose feed is now stale is still on the site, but the hub shows it as not updated
  const hubAvailable = available.filter((f) => f === RIGHT_NOW_FILE || SATELLITE_FILES.includes(f) || HAZARD_PAGES.some((p) => p.file === f && summaries[p.key]));
  let hub = null;
  try {
    hub = hubPage(rows, { available: hubAvailable });
    texts.set(RIGHT_NOW_FILE, renderPage(hub, { noindex }));
  } catch (e) {
    failed.push({ step: "right-now hub (rendering)", files: [RIGHT_NOW_FILE], reason: e.message, kept: carry(RIGHT_NOW_FILE) });
  }
  const hubFeeds = Object.fromEntries(Object.entries(versionsOf(LIVE_PAGES.find((p) => p.file === RIGHT_NOW_FILE).feeds)).sort());
  if (hub) pages[RIGHT_NOW_FILE] = { feeds: hubFeeds, dataTime: hub.dataTime || (prev && prev.pages && prev.pages[RIGHT_NOW_FILE] && prev.pages[RIGHT_NOW_FILE].dataTime) || isoZ(now.getTime()) };

  // ---- the sitemap: every live page there is, in the order of the registry, each with its own data time
  const ordered = LIVE_FILES.filter((f) => pages[f]);
  if (!noindex) texts.set("sitemap-live.xml", sitemapLive(ordered.map((f) => ({ file: f, lastmod: pages[f].dataTime }))));

  // ---- write what changed; a file whose bytes are the same keeps its entry and its changed time
  const iso = now.toISOString();
  const files = {};
  const writes = [];
  for (const f of ordered) if (kept.has(f)) files[f] = prev.files[f];
  for (const [rel, text] of texts) {
    const buf = Buffer.from(text, "utf8"), hash = sha256(buf);
    const old = prev && prev.files[rel];
    if (old && old.sha256 === hash && exists(rel)) { files[rel] = old; continue; }
    files[rel] = { sha256: hash, size: buf.length, changed: iso };
    writes.push([rel, buf]);
  }
  const sortedFiles = Object.fromEntries([...ordered, ...(noindex ? [] : ["sitemap-live.xml"])].filter((f) => files[f]).map((f) => [f, files[f]]));
  const feedVersions = Object.fromEntries(Object.keys(feeds).sort().filter((n) => version(n)).map((n) => [n, version(n)]));
  const satBuilt = pages[SATCOUNT_FILE] && pages[SATCOUNT_FILE].feeds ? pages[SATCOUNT_FILE].feeds.satellites : null;
  const index = { schema: 1, satellitesVersion: satBuilt || null, siteUrl: SITE.url, ...(key ? { indexnowKey: key } : {}), noindex, generator, built: iso, feeds: feedVersions, pages: Object.fromEntries(ordered.map((f) => [f, pages[f]])), files: sortedFiles };
  const unchanged = prev && writes.length === 0 && !(noindex && exists("sitemap-live.xml")) &&
    same({ ...prev, built: null }, { ...index, built: null });
  if (unchanged) return { changed: false, version: satVersion, skipped, stale, failed, warnings, built: [] };
  for (const [rel, buf] of writes) {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  }
  if (noindex) fs.rmSync(path.join(outDir, "sitemap-live.xml"), { force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n");
  return { changed: true, version: satVersion, skipped, stale, failed, warnings, built: writes.map(([rel]) => rel).filter((r) => r !== "sitemap-live.xml") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    if (!process.env.SITE_URL || !process.env.SITE_URL.trim()) throw new Error("build-live: SITE_URL is required (set the repository variable SITE_URL), so the page gets the right canonical address");
    if (!arg("--data") || !arg("--out")) throw new Error("build-live: usage: node site/build-live.mjs --data <collector folder> --out <pages folder>");
    const r = buildLive({ dataDir: arg("--data"), outDir: arg("--out") });
    const after = (kept, many) => (kept ? `(the previous ${many ? "copies stay" : "copy stays"})` : `(there is no previous copy in the output folder, so ${many ? "these pages are" : "this page is"} not written)`);
    for (const s of [...r.skipped, ...r.stale]) console.log(`build-live: skipped ${s.file}: ${s.reason} ${after(s.kept, false)}`);
    for (const w of r.warnings) console.log(`build-live: warning for ${w.file}: ${w.reason} (the page is built without that part)`);
    // a failure exits 1 after the other pages are written, so the workflow step turns red and GitHub sends its failure notice
    for (const f of r.failed) console.error(`build-live: FAILED step "${f.step}" (${f.files.join(", ")}): ${f.reason} ${after(f.kept, f.files.length > 1)}`);
    console.log(r.changed ? `build-live: wrote ${r.built.length} page(s)${r.built.length ? `: ${r.built.join(", ")}` : ""} (satellites version ${r.version}, canonical base ${SITE.url}${SITE.noindex ? ", noindex" : ""})` : `build-live: no feed the pages use has a new version and the page generator is unchanged, nothing to do`);
    if (r.failed.length) process.exit(1);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
