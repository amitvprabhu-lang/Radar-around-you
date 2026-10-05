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
import { HUB_FILE, COUNTRY_FILES, LIVE_FILES } from "../site/pages-country.mjs";
import { COUNTRY_PAGES } from "../site/satcountry.mjs";
import { SITE, urlPath } from "../site/layout.mjs";
import { buildFixture, STANDARD, countryFixture } from "./helpers/satfixture.mjs";

const bounds = { min: 5, max: 100 };  // the fixture is tiny; the real bounds are tested in satcount.test.js
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bl-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function dataDir(version, fx = buildFixture(STANDARD, { newIdx: [1] })) {
  const dir = mk(), base = `satellites/${version}`;
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify(fx.meta));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version, files: { "details.bin": `${base}/details.bin`, "satmeta.json": `${base}/satmeta.json`, "swarm.bin": `${base}/swarm.bin` } } } }));
  return dir;
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// The standard fixture's owners are Alpha, Beta and Gamma, so every country page is skipped and only the count page and the hub are built.
const ALL = COUNTRY_PAGES.map((p) => p.slug);
const slugs = (r) => (r.skipped ? { ...r, skipped: r.skipped.map((x) => x.slug) } : r);
const built = (version, skipped = ALL) => ({ changed: true, version, skipped });

test("the first build writes the page, the live sitemap and an index whose hashes match the files", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.deepEqual(slugs(r), built("V1"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.schema, 1);
  assert.equal(index.satellitesVersion, "V1");
  assert.deepEqual(Object.keys(index.files).sort(), [SATCOUNT_FILE, HUB_FILE, "sitemap-live.xml"].sort());
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
  assert.deepEqual(r, { changed: false, version: "V1" });
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
  assert.deepEqual(same, { changed: false, version: "V1" });
  const other = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds, generator: "G2" });
  assert.deepEqual(slugs(other), built("V1"));
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
  assert.deepEqual(slugs(r), built("V1"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).generator, "G1");
});

test("a new satellites version rebuilds and moves the last modified time", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const r = buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds });
  assert.deepEqual(slugs(r), built("V2"));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.satellitesVersion, "V2");
  assert.equal(index.files[SATCOUNT_FILE].changed, "2026-10-05T11:00:00.000Z");
  assert.ok(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("<lastmod>2026-10-05T11:00:00.000Z</lastmod>"));
});

test("a corrupt or non-object index.json counts as no previous build and is overwritten", () => {
  for (const bad of ['{"schema":1,"satellitesVersion":"V1","fil', "null"]) {
    const out = mk(), dir = dataDir("V1");
    buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
    fs.writeFileSync(path.join(out, "index.json"), bad);
    const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds });
    assert.deepEqual(slugs(r), built("V1"), bad);
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
  assert.deepEqual(Object.keys(index.files), [SATCOUNT_FILE, HUB_FILE]);
  assert.ok(fs.readFileSync(path.join(out, HUB_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
});

test("implausible numbers write nothing and keep the previous page", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const before = fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8");
  assert.throws(() => buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds: { min: 8, max: 100 } }), /implausible/);
  assert.equal(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8"), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).satellitesVersion, "V1");
});

test("a manifest without the satellites files is refused with a clear message", () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: {} }));
  assert.throws(() => buildLive({ dataDir: dir, outDir: mk(), bounds }), /no satellites feed/);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version: "V1", files: { "details.bin": "x" } } } }));
  assert.throws(() => buildLive({ dataDir: dir, outDir: mk(), bounds }), /does not name satmeta\.json/);
});

test("the real bundled snapshot passes the real plausibility bounds", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const fx = { meta: JSON.parse(fs.readFileSync(root + "meta.json", "utf8")), details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") };
  const out = mk();
  const r = buildLive({ dataDir: dataDir("VREAL", fx), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false });
  assert.equal(r.changed, true);
  assert.deepEqual(r.skipped, [], "every country page passes the guard on the real data");
  assert.ok(/<strong>[\d,]+ active satellites<\/strong>/.test(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8")));
  for (const f of LIVE_FILES) {
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
  assert.deepEqual(slugs(r), built("V1", []));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.deepEqual(Object.keys(index.files).sort(), [...LIVE_FILES, "sitemap-live.xml"].sort());
  for (const [p, info] of Object.entries(index.files)) assert.equal(info.sha256, sha(path.join(out, p)), p);
  const xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), LIVE_FILES.map((f) => `${SITE.url}/${urlPath(f)}`));
  assert.equal((xml.match(/<lastmod>2026-10-05T09:00:00.000Z<\/lastmod>/g) || []).length, 7);
  assert.ok(fs.readFileSync(path.join(out, COUNTRY_FILES[0]), "utf8").includes("130 active satellites"));
  // every link from one live page to another lands on a file that was written
  for (const f of LIVE_FILES) {
    for (const m of fs.readFileSync(path.join(out, f), "utf8").matchAll(/ href="([^"#]+)"/g)) {
      if (/^https?:/.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])).replace(/\/$/, "/index.html");
      if (LIVE_FILES.some((x) => x.split("/")[0] === target.split("/")[0])) assert.ok(fs.existsSync(path.join(out, target)), `${f}: ${m[1]}`);
    }
  }
});

test("an owner that trips the guard is skipped and named, the rest are written, and nothing links to the skipped page", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1", countryFixture()), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 }, min: 53 });
  assert.deepEqual(r.skipped, [{ slug: "japan", file: "satellites-by-country/japan/index.html", reason: "Japan has 52 active satellites, under 53" }]);
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.ok(!("satellites-by-country/japan/index.html" in index.files));
  assert.equal(Object.keys(index.files).length, 7);
  assert.ok(!fs.existsSync(path.join(out, "satellites-by-country/japan/index.html")));
  assert.ok(!fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("/japan/"));
  assert.ok(!fs.readFileSync(path.join(out, HUB_FILE), "utf8").includes('japan/"'));
});

test("a failure while building never leaves a partial set: the previous pages and index stay as they were", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1", countryFixture()), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 } });
  const before = Object.fromEntries([...LIVE_FILES, "index.json", "sitemap-live.xml"].map((f) => [f, fs.readFileSync(path.join(out, f), "utf8")]));
  assert.throws(() => buildLive({ dataDir: dataDir("V2", countryFixture()), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds: { min: 5, max: 1000 }, coastFile: path.join(mk(), "missing.bin") }), /ENOENT/);
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), "utf8"), text, f);
});

test("the generator hash covers the new modules, the app modules they import and the coastlines, and follows its input list", () => {
  for (const f of ["satcountry.mjs", "svgmap.mjs", "pages-country.mjs", "../public/coast.bin", "../src/core.js", "../src/data.js", "../src/info.js"]) assert.ok(GENERATOR_FILES.includes(f), f);
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
  const r = spawnSync(process.execPath, [script, "--data", dataDir("VCLI", fx), "--out", out], { env: { ...process.env, SITE_URL: "https://example.org", SITE_NOINDEX: "0" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped satellites-by-country\/japan\/index\.html: Japan is not in the feed/);
  assert.match(r.stdout, /built the live pages for satellites version VCLI/);
  assert.ok(fs.existsSync(path.join(out, HUB_FILE)) && !fs.existsSync(path.join(out, "satellites-by-country/japan/index.html")));
});
