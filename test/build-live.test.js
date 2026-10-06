import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildLive, GENERATOR_FILES, generatorHash } from "../site/build-live.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
import { HUB_FILE, COUNTRY_FILES } from "../site/pages-country.mjs";
import { LIVE_FILES, SATELLITE_FILES, RIGHT_NOW_FILE, FAMILY_PAGES } from "../site/livepages.mjs";
import { HAZARD_PAGES } from "../site/hazard.mjs";
import { HAZARD_PAGE_FUNCTIONS } from "../site/pages-hazard.mjs";
import { COUNTRY_PAGES } from "../site/satcountry.mjs";
import { SITE, urlPath, NAV } from "../site/layout.mjs";
import { buildFixture, STANDARD, countryFixture } from "./helpers/satfixture.mjs";
import { REAL_DIR } from "./helpers/hazardfixture.mjs";
import { readIndexNowKey } from "../site/indexnow.mjs";

const bounds = { min: 5, max: 100 };  // the fixture is tiny; the real bounds are tested in satcount.test.js
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bl-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function dataDir(version, fx = buildFixture(STANDARD, { newIdx: [1] }), { names = null } = {}) {
  const dir = mk(), base = `satellites/${version}`;
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify(fx.meta));
  const files = { "details.bin": `${base}/details.bin`, "satmeta.json": `${base}/satmeta.json`, "swarm.bin": `${base}/swarm.bin` };
  if (names !== null) { fs.writeFileSync(path.join(dir, base, "names.txt"), names); files["names.txt"] = `${base}/names.txt`; }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version, files } } }));
  return dir;
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// The standard fixture's owners are Alpha, Beta and Gamma, so every country page is skipped and only the count page and the hub are built.
const ALL = COUNTRY_PAGES.map((p) => p.slug);
const slugs = (r) => (r.skipped ? { ...r, skipped: r.skipped.map((x) => x.slug) } : r);
const built = (version, skipped = ALL) => ({ changed: true, version, skipped });
const pick = (r) => ({ changed: r.changed, version: r.version, skipped: r.skipped });

test("the first build writes the page, the live sitemap and an index whose hashes match the files", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.deepEqual(slugs(pick(r)), built("V1"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.schema, 1);
  assert.equal(index.satellitesVersion, "V1");
  assert.deepEqual(Object.keys(index.files).sort(), [SATCOUNT_FILE, HUB_FILE, RIGHT_NOW_FILE, "sitemap-live.xml"].sort());
  for (const [p, info] of Object.entries(index.files)) {
    assert.equal(info.sha256, sha(path.join(out, p)), p);
    assert.equal(info.size, fs.statSync(path.join(out, p)).size, p);
    assert.equal(info.changed, "2026-10-05T09:00:00.000Z");
  }
  const html = fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8");
  assert.ok(html.includes("7 active satellites"));
  assert.ok(html.includes('<time datetime="2026-10-05T09:00:00.000Z">'));
});

test("the same satellites version builds nothing and touches nothing", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const before = fs.readFileSync(path.join(out, "index.json"), "utf8"), mtime = fs.statSync(path.join(out, SATCOUNT_FILE)).mtimeMs;
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds });
  assert.deepEqual({ changed: r.changed, version: r.version, built: r.built }, { changed: false, version: "V1", built: [] });
  assert.equal(fs.readFileSync(path.join(out, "index.json"), "utf8"), before);
  assert.equal(fs.statSync(path.join(out, SATCOUNT_FILE)).mtimeMs, mtime);
});

test("the index records a generator hash over the files that shape the page", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.match(index.generator, /^[0-9a-f]{64}$/);
});

test("the same version and the same generator skips; a different generator rebuilds", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds, generator: "G1" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).generator, "G1");
  const same = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds, generator: "G1" });
  assert.equal(same.changed, false);
  const other = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds, generator: "G2" });
  assert.deepEqual(slugs(pick(other)), built("V1"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.generator, "G2");
  assert.equal(index.files[SATCOUNT_FILE].changed, "2026-10-05T11:00:00.000Z");
});

test("an old index without a generator rebuilds", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds, generator: "G1" });
  const old = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  delete old.generator;
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(old));
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds, generator: "G1" });
  assert.deepEqual(slugs(pick(r)), built("V1"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).generator, "G1");
});

test("a new satellites version rebuilds; the sitemap's last modified time is the data time, so it moves only with new data", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const r = buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds });
  assert.deepEqual(slugs(pick(r)), built("V2"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.satellitesVersion, "V2");
  assert.equal(index.files[SATCOUNT_FILE].changed, "2026-10-05T11:00:00.000Z");
  assert.deepEqual(index.pages[SATCOUNT_FILE], { feeds: { satellites: "V2" }, dataTime: "2026-10-05T08:14:54Z" });
  const xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  assert.ok(xml.includes("<lastmod>2026-10-05T08:14:54Z</lastmod>") && !xml.includes("2026-10-05T11:00"), "the feed's own time, not the build time");
});

test("a corrupt or non-object index.json counts as no previous build and is overwritten", () => {
  for (const bad of ['{"schema":1,"satellitesVersion":"V1","fil', "null"]) {
    const out = mk(), dir = dataDir("V1");
    buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
    fs.writeFileSync(path.join(out, "index.json"), bad);
    const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds });
    assert.deepEqual(slugs(pick(r)), built("V1"), bad);
    const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
    assert.equal(index.satellitesVersion, "V1");
    for (const [p, info] of Object.entries(index.files)) assert.equal(info.sha256, sha(path.join(out, p)), p);
    assert.ok(fs.existsSync(path.join(out, SATCOUNT_FILE)));
  }
});

test("noindex builds the page with a noindex tag, writes no sitemap and removes an old one; switching modes rebuilds", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.ok(fs.existsSync(path.join(out, "sitemap-live.xml")));
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:30:00Z"), noindex: true, bounds });
  assert.equal(r.changed, true, "the same data in another mode is rebuilt");
  assert.ok(!fs.existsSync(path.join(out, "sitemap-live.xml")));
  assert.ok(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.deepEqual(Object.keys(index.files), [SATCOUNT_FILE, HUB_FILE, RIGHT_NOW_FILE]);
  assert.ok(fs.readFileSync(path.join(out, HUB_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
});

test("implausible numbers write no satellite page, keep the previous ones and report a failure", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const before = fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8");
  const r = buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds: { min: 8, max: 100 } });
  assert.match(r.failed[0].reason, /implausible/);
  assert.deepEqual(r.failed[0].files, SATELLITE_FILES);
  assert.equal(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8"), before);
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.satellitesVersion, "V1");
  assert.equal(index.files[SATCOUNT_FILE].sha256, sha(path.join(out, SATCOUNT_FILE)), "the previous page stays listed");
});

test("a manifest without the satellites files is reported with a clear message", () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: {} }));
  assert.match(buildLive({ dataDir: dir, outDir: mk(), bounds }).failed[0].reason, /no satellites feed/);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version: "V1", files: { "details.bin": "x" } } } }));
  assert.match(buildLive({ dataDir: dir, outDir: mk(), bounds }).failed[0].reason, /does not name satmeta\.json/);
});

test("the real bundled snapshot passes the real plausibility bounds", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const fx = { meta: JSON.parse(fs.readFileSync(root + "meta.json", "utf8")), details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") };
  const out = mk();
  const r = buildLive({ dataDir: dataDir("VREAL", fx), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false });
  assert.equal(r.changed, true);
  assert.deepEqual(r.skipped, [], "every country page passes the guard on the real data");
  assert.ok(/<strong>[\d,]+ active satellites<\/strong>/.test(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8")));
  for (const f of SATELLITE_FILES) {
    const h = fs.readFileSync(path.join(out, f), "utf8");
    assert.ok(Buffer.byteLength(h) < 400 * 1024, `${f}: ${Buffer.byteLength(h)}`);
    assert.ok(/<strong>[\d,]+ active satellites<\/strong>/.test(h), f);
  }
});

test("the command line needs SITE_URL and says so", () => {
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const env = { ...process.env }; delete env.SITE_URL;
  const r = spawnSync(process.execPath, [script, "--data", mk(), "--out", mk()], { env, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SITE_URL is required/);
});

test("with owners that have pages, the hub and all five country pages are written, listed in the index and in the live sitemap", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1", countryFixture()), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  assert.deepEqual(slugs(pick(r)), built("V1", []));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.deepEqual(Object.keys(index.files).sort(), [...SATELLITE_FILES, RIGHT_NOW_FILE, "sitemap-live.xml"].sort());
  for (const [p, info] of Object.entries(index.files)) assert.equal(info.sha256, sha(path.join(out, p)), p);
  const xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [...SATELLITE_FILES, RIGHT_NOW_FILE].map((f) => `${SITE.url}/${urlPath(f)}`));
  assert.equal((xml.match(/<lastmod>2026-10-05T08:14:54Z<\/lastmod>/g) || []).length, 8);
  assert.ok(fs.readFileSync(path.join(out, COUNTRY_FILES[0]), "utf8").includes("130 active satellites"));
  // every link from one live page to another lands on a file that was written
  for (const f of [...SATELLITE_FILES, RIGHT_NOW_FILE]) {
    for (const m of fs.readFileSync(path.join(out, f), "utf8").matchAll(/ href="([^"#]+)"/g)) {
      if (/^https?:/.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])).replace(/\/$/, "/index.html");
      // the nav's live pages (right now, tonight's sky) are written at deploy time by site/build.mjs as well, so they exist on the site
      if (NAV.some(([n]) => n && `${n}index.html` === target && target !== RIGHT_NOW_FILE)) continue;
      if (LIVE_FILES.some((x) => x.split("/")[0] === target.split("/")[0])) assert.ok(fs.existsSync(path.join(out, target)), `${f}: ${m[1]}`);
    }
  }
});

test("an owner that trips the guard is skipped and named, the rest are written, and nothing links to the skipped page", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1", countryFixture()), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 }, min: 53 });
  assert.deepEqual(r.skipped, [{ slug: "japan", file: "satellites-by-country/japan/index.html", reason: "Japan has 52 active satellites, under 53", kept: false }]);
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.ok(!("satellites-by-country/japan/index.html" in index.files));
  assert.equal(Object.keys(index.files).length, 8);
  assert.ok(!fs.existsSync(path.join(out, "satellites-by-country/japan/index.html")));
  assert.ok(!fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("/japan/"));
  assert.ok(!fs.readFileSync(path.join(out, HUB_FILE), "utf8").includes('japan/"'));
});

test("a failure while building never leaves a partial set: the previous pages and index stay as they were", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1", countryFixture()), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  const before = Object.fromEntries([...SATELLITE_FILES, RIGHT_NOW_FILE, "index.json", "sitemap-live.xml"].map((f) => [f, fs.readFileSync(path.join(out, f), "utf8")]));
  assert.throws(() => buildLive({ dataDir: dataDir("V2", countryFixture()), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 }, coastFile: path.join(mk(), "missing.bin") }), /ENOENT/);
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), "utf8"), text, f);
});

test("the generator hash covers the new modules, the app modules they import and the coastlines, and follows its input list", () => {
  for (const f of ["satcountry.mjs", "svgmap.mjs", "pages-country.mjs", "../public/coast.bin", "../src/core.js", "../src/data.js", "../src/info.js",
    "hazard.mjs", "pages-hazard.mjs", "livepages.mjs", "../src/scales.js", "../src/asteroids.js", "../public/places.json"]) assert.ok(GENERATOR_FILES.includes(f), f);
  for (const f of GENERATOR_FILES) assert.ok(fs.existsSync(fileURLToPath(new URL(f, new URL("../site/", import.meta.url)))), `${f} exists`);
  const full = generatorHash();
  assert.equal(full, generatorHash(GENERATOR_FILES), "the default is the full list");
  assert.notEqual(generatorHash(GENERATOR_FILES.filter((f) => f !== "../src/core.js")), full, "leaving out the orbit model changes the hash");
  assert.notEqual(generatorHash([...GENERATOR_FILES].reverse()), full, "the order and names are part of the hash");
});

test("the command line prints a message for a skipped page and still succeeds", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const meta = JSON.parse(fs.readFileSync(root + "meta.json", "utf8"));
  meta.owners = meta.owners.map((o) => (o === "Japan" ? "Japan (renamed in this test)" : o));
  const fx = { meta, details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") };
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const out = mk();
  const r = spawnSync(process.execPath, [script, "--data", dataDir("VCLI", fx), "--out", out], { env: { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0", BUILD_LIVE_NOW: REAL_TIME.toISOString() }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped satellites-by-country\/japan\/index\.html: Japan is not in the feed/);
  assert.match(r.stdout, /wrote \d+ page\(s\): how-many-satellites-in-orbit\/index\.html[^\n]*\(satellites version VCLI/);
  assert.ok(fs.existsSync(path.join(out, HUB_FILE)) && !fs.existsSync(path.join(out, "satellites-by-country/japan/index.html")));
});

test("names.txt named in the manifest feeds the name families, and one of the wrong length stops the build before anything is written", () => {
  const fx = countryFixture(), out = mk();
  buildLive({ dataDir: dataDir("V1", fx, { names: fx.names.join("\n") }), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  const us = fs.readFileSync(path.join(out, COUNTRY_FILES[0]), "utf8");
  assert.ok(us.includes('id="names"') && us.includes(">STARLINK<"), "families from names.txt");
  const before = Object.fromEntries(SATELLITE_FILES.map((f) => [f, fs.readFileSync(path.join(out, f), "utf8")]));
  const bad = buildLive({ dataDir: dataDir("V2", fx, { names: fx.names.slice(1).join("\n") }), outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  assert.match(bad.failed[0].reason, /names\.txt has 403 lines, expected 404/);
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), "utf8"), text, `${f}: the previous set stays`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).satellitesVersion, "V1");
  const plain = mk();
  buildLive({ dataDir: dataDir("V1", fx), outDir: plain, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  assert.ok(!fs.readFileSync(path.join(plain, COUNTRY_FILES[0]), "utf8").includes('id="names"'), "without names.txt the section is left out");
});

// ------------------------------------------------------------------ the hazard pages and the right-now hub
const REAL_TIME = new Date("2026-10-05T18:45:00Z");
// the real hazard feeds of 5 October 2026 plus the small satellite fixture, in one collector folder; patch(manifest, dir) can change it
function fullDataDir(patch = null) {
  const dir = dataDir("S1");
  fs.cpSync(REAL_DIR, dir, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  const real = JSON.parse(fs.readFileSync(path.join(REAL_DIR, "manifest.json"), "utf8"));
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  m.feeds = { ...real.feeds, satellites: m.feeds.satellites };
  if (patch) patch(m, dir);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
  return dir;
}
// a new version of one feed whose file is changed by edit(text) (or left the same)
function newVersion(m, dir, feed, file, version, edit = (t) => t) {
  const rel = `${feed}/${version}/${file}`;
  fs.mkdirSync(path.join(dir, feed, version), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), edit(fs.readFileSync(path.join(dir, m.feeds[feed].files[file]), "utf8")));
  m.feeds[feed] = { ...m.feeds[feed], version, files: { ...m.feeds[feed].files, [file]: rel } };
}
// the sky pages (site/sky.mjs) need the clouds feed and precise.json, which the hazard data of 5 October does not have, so these tests
// leave them out of their lists; test/build-live-sky.test.js covers them
const SKY_FILES = new Set(FAMILY_PAGES.filter((p) => p.family === "sky").map((p) => p.file));
const noSky = (list) => list.filter((x) => !SKY_FILES.has(x.file));
const readIndex = (out) => JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));

test("with every feed present all thirteen live pages are written, each with its feed versions and its data time in the index and the sitemap", () => {
  const out = mk();
  const r = buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(noSky(r.stale), []);
  const index = readIndex(out);
  assert.equal(index.siteUrl, SITE.url);
  assert.equal(index.indexnowKey, readIndexNowKey(), "the IndexNow key sits beside the hazard fields");
  assert.deepEqual(Object.keys(index), ["schema", "satellitesVersion", "siteUrl", "indexnowKey", "noindex", "generator", "built", "feeds", "pages", "files"], "every field of both changes, in the documented order");
  const want = [SATCOUNT_FILE, HUB_FILE, RIGHT_NOW_FILE, ...HAZARD_PAGES.map((p) => p.file)];
  for (const f of want) assert.ok(index.files[f] && fs.existsSync(path.join(out, f)), f);
  assert.deepEqual(index.pages["earthquakes-today/index.html"], { feeds: { quakes: "20261005T184012Z" }, dataTime: "2026-10-05T18:40:02Z" });
  assert.deepEqual(index.pages["aurora-tonight/index.html"].feeds, { kp: "20261005T183040Z", spaceweather: "20261005T184030Z", aurora: "20261005T183040Z" });
  assert.equal(index.pages["wildfires-today/index.html"].dataTime, "2026-10-05T15:35:00Z");
  assert.equal(index.pages[RIGHT_NOW_FILE].dataTime, "2026-10-05T18:40:02Z", "the hub's newest data time");
  assert.equal(index.feeds.quakes, "20261005T184012Z");
  const xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  const entries = [...xml.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(entries.map((e) => e[0]), LIVE_FILES.filter((f) => index.pages[f]).map((f) => `${SITE.url}/${urlPath(f)}`), "in the registry's order");
  for (const [loc, lastmod] of entries) assert.equal(lastmod, index.pages[LIVE_FILES.find((f) => loc === `${SITE.url}/${urlPath(f)}`)].dataTime, loc);
  for (const [p, info] of Object.entries(index.files)) assert.equal(info.sha256, sha(path.join(out, p)), p);
  // the hub links every page that was written, and every link on it lands on a written page or a guide
  const hub = fs.readFileSync(path.join(out, RIGHT_NOW_FILE), "utf8");
  for (const f of Object.keys(index.pages).filter((f) => f !== RIGHT_NOW_FILE)) assert.ok(hub.includes(`href="../${urlPath(f)}"`), `the hub links ${f}`);
});

test("a new version of one feed rebuilds only its own page and the hub; the other pages and their changed times stay", () => {
  const out = mk();
  buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds });
  const before = readIndex(out);
  const later = new Date("2026-10-05T18:55:00Z");
  const dir = fullDataDir((m, d) => newVersion(m, d, "quakes", "quakes.json", "20261005T185012Z", (t) => t.replace('"generated":"2026-10-05T18:40:02Z"', '"generated":"2026-10-05T18:50:02Z"')));
  const r = buildLive({ dataDir: dir, outDir: out, now: later, noindex: false, bounds });
  assert.deepEqual(r.built.sort(), ["earthquakes-today/index.html", RIGHT_NOW_FILE].sort());
  const after = readIndex(out);
  assert.equal(after.pages["earthquakes-today/index.html"].dataTime, "2026-10-05T18:50:02Z");
  assert.equal(after.files["earthquakes-today/index.html"].changed, later.toISOString());
  for (const f of ["aurora-tonight/index.html", "wildfires-today/index.html", SATCOUNT_FILE]) assert.deepEqual(after.files[f], before.files[f], f);
  // a new version with the same content rebuilds the page to the same bytes, so nothing moves
  const same = fullDataDir((m, d) => newVersion(m, d, "fires", "fires.json", "20261005T191103Z"));
  const r2 = buildLive({ dataDir: same, outDir: out, now: new Date("2026-10-05T19:00:00Z"), noindex: false, bounds });
  assert.ok(!r2.built.includes("wildfires-today/index.html"));
  assert.deepEqual(readIndex(out).files["wildfires-today/index.html"], before.files["wildfires-today/index.html"]);
  assert.equal(readIndex(out).pages["wildfires-today/index.html"].feeds.fires, "20261005T191103Z", "the version is recorded");
});

test("a stale feed skips only its page with the reason; the previous copy and its entry stay, and the hub shows it without a number or a link", () => {
  const out = mk();
  buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds });
  const quakeBefore = fs.readFileSync(path.join(out, "earthquakes-today/index.html"), "utf8");
  const before = readIndex(out);
  // four hours on, with a new quakes version that is still the old data: the quake page is stale (3 hours); the Kp data (newest tag 15:00,
  // 7.75 hours before) is still within its 8 hours, and the other pages are current too
  const dir = fullDataDir((m, d) => newVersion(m, d, "quakes", "quakes.json", "20261005T224012Z"));
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T22:45:00Z"), noindex: false, bounds });
  assert.deepEqual(noSky(r.stale).map((s) => s.file), ["earthquakes-today/index.html"]);
  // an hour later the Kp data is past its 8 hours as well
  const r2 = buildLive({ dataDir: fullDataDir((m, d) => newVersion(m, d, "kp", "kp.json", "20261005T234012Z")), outDir: mk(), now: new Date("2026-10-05T23:45:00Z"), noindex: false, bounds });
  assert.ok(r2.stale.some((s) => s.file === "aurora-tonight/index.html" && /kp data from 2026-10-05T15:00:00Z is more than 8 hours old/.test(s.reason)), JSON.stringify(r2.stale));
  assert.match(noSky(r.stale)[0].reason, /quakes data from 2026-10-05T18:40:02Z is more than 3 hours old/);
  assert.deepEqual(r.failed, []);
  assert.equal(fs.readFileSync(path.join(out, "earthquakes-today/index.html"), "utf8"), quakeBefore);
  const after = readIndex(out);
  assert.deepEqual(after.files["earthquakes-today/index.html"], before.files["earthquakes-today/index.html"]);
  assert.deepEqual(after.pages["earthquakes-today/index.html"], before.pages["earthquakes-today/index.html"]);
  const hub = fs.readFileSync(path.join(out, RIGHT_NOW_FILE), "utf8");
  assert.ok(!hub.includes('href="../earthquakes-today/"'), "not linked as live");
  assert.match(hub, /Data older than the page&#39;s limit|Data older than the page's limit/);
});

test("a feed that fails its guard skips its page and is reported as a failure; the others are built", () => {
  const out = mk();
  const dir = fullDataDir((m, d) => newVersion(m, d, "storms", "storms.json", "20261005T183999Z", (t) => t.replace('"windKt":75', '"windKt":975')));
  const r = buildLive({ dataDir: dir, outDir: out, now: REAL_TIME, noindex: false, bounds });
  assert.equal(r.failed.length, 1);
  assert.deepEqual(r.failed[0].files, ["tropical-storms-now/index.html"]);
  assert.match(r.failed[0].reason, /Rachel has wind 975 kt/);
  assert.ok(!fs.existsSync(path.join(out, "tropical-storms-now/index.html")));
  assert.ok(fs.existsSync(path.join(out, "earthquakes-today/index.html")));
  assert.ok(!fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("tropical-storms-now"), "a page never built is not in the sitemap");
  // the command line exits with an error for a failure, after writing the rest
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const out2 = mk();
  const cli = spawnSync(process.execPath, [script, "--data", dir, "--out", out2], { env: { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0", BUILD_LIVE_NOW: REAL_TIME.toISOString() }, encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /FAILED step "hazard page tropical-storms-now" \(tropical-storms-now\/index\.html\): hazard: storms: Rachel has wind 975 kt, outside 0 to 250 \(there is no previous copy in the output folder, so this page is not written\)/);
  // with a previous copy in the folder the message says it stays
  const out3 = mk(), cliEnv = { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0", BUILD_LIVE_NOW: REAL_TIME.toISOString() };
  spawnSync(process.execPath, [script, "--data", fullDataDir(), "--out", out3], { env: cliEnv, encoding: "utf8" });
  assert.ok(fs.existsSync(path.join(out3, "tropical-storms-now/index.html")), "a first run wrote the storm page");
  const again = spawnSync(process.execPath, [script, "--data", dir, "--out", out3], { env: cliEnv, encoding: "utf8" });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /FAILED step "hazard page tropical-storms-now" \(tropical-storms-now\/index\.html\): [^\n]* \(the previous copy stays\)/);
  assert.ok(fs.existsSync(path.join(out2, "earthquakes-today/index.html")), "the others are still written");
});

test("a feed missing from the manifest leaves its page out with a reason, and a noindex build writes no sitemap", () => {
  const out = mk();
  const dir = fullDataDir((m) => { delete m.feeds.fires; });
  const r = buildLive({ dataDir: dir, outDir: out, now: REAL_TIME, noindex: true, bounds });
  assert.deepEqual(noSky(r.stale), [{ file: "wildfires-today/index.html", reason: "the manifest has no fires feed", kept: false }]);
  assert.ok(!fs.existsSync(path.join(out, "sitemap-live.xml")));
  assert.ok(!("sitemap-live.xml" in readIndex(out).files));
  for (const f of Object.keys(readIndex(out).files)) assert.ok(fs.readFileSync(path.join(out, f), "utf8").includes('<meta name="robots" content="noindex,nofollow">'), f);
  assert.match(fs.readFileSync(path.join(out, RIGHT_NOW_FILE), "utf8"), /Not in the collector&#39;s data; page not updated|Not in the collector's data; page not updated/);
});

test("an indexable build writes the IndexNow key into index.json next to siteUrl; noindex or no key leaves the field out", () => {
  const at = new Date("2026-10-05T09:00:00Z");
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: at, noindex: false, bounds, indexnowKey: "Test-Key-1234" });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.indexnowKey, "Test-Key-1234");
  assert.deepEqual(Object.keys(index).slice(0, 4), ["schema", "satellitesVersion", "siteUrl", "indexnowKey"]);
  const off = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: off, now: at, noindex: true, bounds, indexnowKey: "Test-Key-1234" });
  assert.ok(!("indexnowKey" in JSON.parse(fs.readFileSync(path.join(off, "index.json"), "utf8"))), "noindex: no key");
  const none = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: none, now: at, noindex: false, bounds, indexnowKey: null });
  assert.ok(!("indexnowKey" in JSON.parse(fs.readFileSync(path.join(none, "index.json"), "utf8"))), "no key file: no key");
});

test("by default the committed key is used", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).indexnowKey, readIndexNowKey());
});

test("adding, changing or removing the key rewrites index.json on the next run, even for the same satellites version", () => {
  const out = mk(), dir = dataDir("V1");
  const run = (indexnowKey, hour) => buildLive({ dataDir: dir, outDir: out, now: new Date(`2026-10-05T${hour}:00:00Z`), noindex: false, bounds, generator: "G1", indexnowKey });
  const key = () => JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).indexnowKey;
  run(null, "09");
  assert.equal(key(), undefined);
  assert.equal(run(null, "10").changed, false, "no key either time: nothing to do");
  assert.equal(run("Key-AAAA-1", "11").changed, true);
  assert.equal(key(), "Key-AAAA-1");
  assert.equal(run("Key-AAAA-1", "12").changed, false, "the same key: nothing to do");
  assert.equal(run("Key-BBBB-2", "13").changed, true);
  assert.equal(key(), "Key-BBBB-2");
  assert.equal(run(null, "14").changed, true);
  assert.equal(key(), undefined);
});

test("a malformed key stops the live build before anything is written", () => {
  const out = mk();
  assert.throws(() => buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds, indexnowKey: "../x" }), /IndexNow key/);
  assert.deepEqual(fs.readdirSync(out), []);
});

test("the generator hash covers the IndexNow module", () => {
  assert.ok(GENERATOR_FILES.includes("indexnow.mjs"));
  assert.notEqual(generatorHash(GENERATOR_FILES.filter((f) => f !== "indexnow.mjs")), generatorHash());
});

test("an error in the satellite data still fails the command (exit 1) with a message naming the step, after the other pages are written", () => {
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const env = { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0", BUILD_LIVE_NOW: REAL_TIME.toISOString() };
  // the satellite files named in the manifest are not there: the satellite step fails, the hazard pages are still built
  const broken = fullDataDir((m) => { m.feeds.satellites = { ...m.feeds.satellites, files: { ...m.feeds.satellites.files, "details.bin": "satellites/missing/details.bin" } }; });
  const out = mk();
  const r = spawnSync(process.execPath, [script, "--data", broken, "--out", out], { env, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /build-live: FAILED step "satellite pages" \(how-many-satellites-in-orbit\/index\.html, satellites-by-country\/index\.html, [^)]*\): ENOENT[^\n]*details\.bin/);
  for (const f of HAZARD_PAGES.map((p) => p.file)) assert.ok(fs.existsSync(path.join(out, f)), `${f} is still written`);
  assert.ok(!fs.existsSync(path.join(out, SATCOUNT_FILE)));
  // implausible satellite numbers too
  const fx = buildFixture(STANDARD.slice(0, 3));
  const r2 = spawnSync(process.execPath, [script, "--data", dataDir("VBAD", fx), "--out", mk()], { env, encoding: "utf8" });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /FAILED step "satellite pages" \([^)]*\): satcount: \d+ active satellites is implausible/);
  // stale hazard feeds are not failures: with the real bundled satellites and the hazard feeds of 5 October (stale by the time this runs,
  // or fresh if run that evening) the command exits 0
  const pub = fileURLToPath(new URL("../public/", import.meta.url));
  const ok = fullDataDir((m, d) => {
    for (const [name, src] of [["details.bin", "details.bin"], ["swarm.bin", "swarm.bin"], ["satmeta.json", "meta.json"]]) fs.copyFileSync(path.join(pub, src), path.join(d, m.feeds.satellites.files[name]));
  });
  const r3 = spawnSync(process.execPath, [script, "--data", ok, "--out", mk()], { env, encoding: "utf8" });
  assert.equal(r3.status, 0, r3.stderr);
  assert.ok(!/FAILED/.test(r3.stderr));
});

test("a hazard page that fails to render is skipped on its own and reported; the other pages and the hub are written without a link to it", () => {
  const out = mk();
  const pageFunctions = { ...HAZARD_PAGE_FUNCTIONS, quakes: () => { throw new Error("render broke"); } };
  const r = buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds, pageFunctions });
  assert.deepEqual(r.failed.map((f) => [f.step, f.files, f.reason, f.kept]), [["hazard page earthquakes-today (rendering)", ["earthquakes-today/index.html"], "render broke", false]]);
  assert.ok(!fs.existsSync(path.join(out, "earthquakes-today/index.html")));
  for (const f of ["aurora-tonight/index.html", "wildfires-today/index.html", RIGHT_NOW_FILE, SATCOUNT_FILE]) assert.ok(fs.existsSync(path.join(out, f)), f);
  for (const f of ["aurora-tonight/index.html", RIGHT_NOW_FILE]) assert.ok(!fs.readFileSync(path.join(out, f), "utf8").includes('href="../earthquakes-today/"'), `${f} does not link the missing page`);
  assert.ok(!("earthquakes-today/index.html" in readIndex(out).files));
  // with a previous copy, that copy and its entry stay, and the failure says so
  const before = readIndex(out);
  const good = buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds });
  assert.deepEqual(good.failed, []);
  const entry = readIndex(out).files["earthquakes-today/index.html"];
  const again = buildLive({ dataDir: fullDataDir((m, d) => newVersion(m, d, "quakes", "quakes.json", "20261005T184999Z")), outDir: out, now: REAL_TIME, noindex: false, bounds, pageFunctions });
  assert.equal(again.failed[0].kept, true);
  assert.deepEqual(readIndex(out).files["earthquakes-today/index.html"], entry);
  assert.ok(before);
  // the hub failing to render is reported the same way, and the pages are still written
  const out2 = mk();
  const hubFail = buildLive({ dataDir: fullDataDir(), outDir: out2, now: REAL_TIME, noindex: false, bounds, hubPage: () => { throw new Error("hub broke"); } });
  assert.deepEqual(hubFail.failed.map((f) => f.step), ["right-now hub (rendering)"]);
  assert.ok(!fs.existsSync(path.join(out2, RIGHT_NOW_FILE)) && fs.existsSync(path.join(out2, "earthquakes-today/index.html")));
});

test("feeds that differ only in the collector's read time give byte-identical storm and asteroid pages and the same lastmod", () => {
  const out = mk();
  buildLive({ dataDir: fullDataDir(), outDir: out, now: REAL_TIME, noindex: false, bounds });
  const before = readIndex(out), xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  const pagesBefore = Object.fromEntries(["tropical-storms-now/index.html", "asteroid-close-approaches/index.html"].map((f) => [f, fs.readFileSync(path.join(out, f), "utf8")]));
  const dir = fullDataDir((m, d) => {
    newVersion(m, d, "storms", "storms.json", "20261005T190041Z", (t) => t.replace('"generated":"2026-10-05T18:30:40Z"', '"generated":"2026-10-05T19:00:40Z"'));
    newVersion(m, d, "closeapproaches", "closeapproaches.json", "20261005T204039Z", (t) => t.replace('"generated":"2026-10-05T14:40:39Z"', '"generated":"2026-10-05T20:40:39Z"'));
  });
  assert.notEqual(fs.readFileSync(path.join(dir, "storms/20261005T190041Z/storms.json"), "utf8"), fs.readFileSync(path.join(REAL_DIR, "storms/20261005T183041Z/storms.json"), "utf8"), "the read time did change");
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T21:00:00Z"), noindex: false, bounds });
  assert.ok(!r.built.includes("tropical-storms-now/index.html") && !r.built.includes("asteroid-close-approaches/index.html"), r.built.join(" "));
  const after = readIndex(out);
  for (const [f, text] of Object.entries(pagesBefore)) {
    assert.equal(fs.readFileSync(path.join(out, f), "utf8"), text, `${f}: the same bytes`);
    assert.deepEqual(after.files[f], before.files[f], `${f}: the same entry and changed time`);
    assert.equal(after.pages[f].dataTime, before.pages[f].dataTime, `${f}: the same data time`);
  }
  assert.equal(after.pages["tropical-storms-now/index.html"].dataTime, "2026-10-05T15:00:00Z", "the newest advisory");
  assert.equal(after.pages["asteroid-close-approaches/index.html"].dataTime, "2026-10-05T00:00:00Z", "the day the list was read");
  const lastmod = (x, slug) => x.match(new RegExp(`/${slug}/</loc><lastmod>([^<]+)<`))[1];
  for (const slug of ["tropical-storms-now", "asteroid-close-approaches"]) assert.equal(lastmod(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8"), slug), lastmod(xml, slug), slug);
});

test("a broken solar wind file leaves a Kp-only aurora page with a warning, not a failure", () => {
  const out = mk();
  const r = buildLive({ dataDir: fullDataDir((m, d) => newVersion(m, d, "spaceweather", "spaceweather.json", "20261005T184031Z", (t) => t.replace(/"speed":[\d.]+/, '"speed":99999'))), outDir: out, now: REAL_TIME, noindex: false, bounds });
  assert.ok(!r.failed.some((f) => f.files.includes("aurora-tonight/index.html")));
  assert.match(r.warnings[0].reason, /hazard: spaceweather: point \d+ has speed 99999/);
  const h = fs.readFileSync(path.join(out, "aurora-tonight/index.html"), "utf8");
  assert.ok(h.includes("Not shown: the solar wind data is not usable: it failed our checks."));
});

test("BUILD_LIVE_NOW pins the clock of the command line, and a bad value is refused", () => {
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const env = { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0" };
  const bad = spawnSync(process.execPath, [script, "--data", fullDataDir(), "--out", mk()], { env: { ...env, BUILD_LIVE_NOW: "not a time" }, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /BUILD_LIVE_NOW is not a valid ISO time/);
  const out = mk();
  const ok = spawnSync(process.execPath, [script, "--data", fullDataDir(), "--out", out], { env: { ...env, BUILD_LIVE_NOW: REAL_TIME.toISOString() }, encoding: "utf8" });
  // the fixture has only a few satellites, which the plausibility guard refuses (exit 1); the hazard pages are the point here
  assert.match(ok.stdout, /wrote 6 page\(s\): earthquakes-today\/index\.html/, ok.stdout + ok.stderr);
  assert.ok(fs.existsSync(path.join(out, "earthquakes-today/index.html")), "feeds from the fixture time are fresh at the pinned time");
});
