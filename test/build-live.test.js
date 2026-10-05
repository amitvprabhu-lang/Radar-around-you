import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildLive } from "../site/build-live.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";

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

test("the first build writes the page, the live sitemap and an index whose hashes match the files", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.deepEqual(r, { changed: true, version: "V1" });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.schema, 1);
  assert.equal(index.satellitesVersion, "V1");
  assert.deepEqual(Object.keys(index.files).sort(), [SATCOUNT_FILE, "sitemap-live.xml"]);
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

test("a new satellites version rebuilds and moves the last modified time", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const r = buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds });
  assert.deepEqual(r, { changed: true, version: "V2" });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.satellitesVersion, "V2");
  assert.equal(index.files[SATCOUNT_FILE].changed, "2026-10-05T11:00:00.000Z");
  assert.ok(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("<lastmod>2026-10-05T11:00:00.000Z</lastmod>"));
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
  assert.deepEqual(Object.keys(index.files), [SATCOUNT_FILE]);
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
  assert.ok(/<strong>[\d,]+ active satellites<\/strong>/.test(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8")));
});

test("the command line needs SITE_URL and says so", () => {
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const env = { ...process.env }; delete env.SITE_URL;
  const r = spawnSync(process.execPath, [script, "--data", mk(), "--out", mk()], { env, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SITE_URL is required/);
});
