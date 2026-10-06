import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLive } from "../site/build-live.mjs";
import { RIGHT_NOW_FILE, LIVE_FILES } from "../site/livepages.mjs";
import { SKY_PAGES, SKY_HUB_FILE, ISS_FILE, skyCityFile, SKY_CITY_IDS } from "../site/sky.mjs";
import { urlPath } from "../site/layout.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";
import { realClouds, realPrecise, SKY_NOW, SAT_TIME } from "./helpers/skyfixture.mjs";
import { xmlProblem } from "./helpers/xml.mjs";

const bounds = { min: 5, max: 100 };
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bls-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// a collector folder with the satellites feed (the small fixture, with the real precise.json of 6 October) and the real clouds feed
function skyDir({ clouds = realClouds(), precise = realPrecise(), cloudsVersion = "C1", satVersion = "S1" } = {}) {
  const dir = mk(), fx = buildFixture(STANDARD, { newIdx: [1] });
  const sat = `satellites/${satVersion}`, cl = `clouds/${cloudsVersion}`;
  fs.mkdirSync(path.join(dir, sat), { recursive: true });
  fs.mkdirSync(path.join(dir, cl), { recursive: true });
  fs.writeFileSync(path.join(dir, sat, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, sat, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, sat, "satmeta.json"), JSON.stringify({ ...fx.meta, taken: SAT_TIME }));
  const files = { "details.bin": `${sat}/details.bin`, "satmeta.json": `${sat}/satmeta.json`, "swarm.bin": `${sat}/swarm.bin` };
  if (precise) { fs.writeFileSync(path.join(dir, sat, "precise.json"), JSON.stringify(precise)); files["precise.json"] = `${sat}/precise.json`; }
  fs.writeFileSync(path.join(dir, cl, "clouds.json"), JSON.stringify(clouds));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version: satVersion, files }, clouds: { version: cloudsVersion, files: { "clouds.json": `${cl}/clouds.json` } } } }));
  return dir;
}
const index = (out) => JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
const SKY_FILES = SKY_PAGES.map((p) => p.file);

test("the sky pages are built from the clouds feed and precise.json, each with its own data time, and the hub of all live pages links them", () => {
  const out = mk();
  const r = buildLive({ dataDir: skyDir(), outDir: out, now: SKY_NOW, noindex: false, bounds });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.stale.filter((s) => SKY_FILES.includes(s.file)), []);
  const ix = index(out);
  for (const f of SKY_FILES) assert.ok(ix.files[f] && fs.existsSync(path.join(out, f)), f);
  const clouds = realClouds();
  for (const id of SKY_CITY_IDS) {
    assert.equal(ix.pages[skyCityFile(id)].dataTime, clouds.cities[id].updated, id);
    assert.deepEqual(ix.pages[skyCityFile(id)].feeds, { clouds: "C1", satellites: "S1", utcDate: "2026-10-06" }, "the UTC date is part of the rebuild key");
  }
  assert.equal(ix.pages[SKY_HUB_FILE].dataTime, "2026-10-06T01:17:49Z", "the newest forecast time");
  assert.deepEqual(ix.pages[ISS_FILE], { feeds: { satellites: "S1" }, dataTime: SAT_TIME });
  const xml = fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8");
  for (const f of SKY_FILES) assert.ok(xml.includes(`/${urlPath(f)}</loc><lastmod>${ix.pages[f].dataTime}</lastmod>`), f);
  const hub = fs.readFileSync(path.join(out, RIGHT_NOW_FILE), "utf8");
  for (const f of SKY_FILES) assert.ok(hub.includes(`href="../${urlPath(f)}"`), `the right-now hub links ${f}`);
  assert.match(hub, /Best window 19:30 to Wed 7 Oct 06:26 local time, 8% cloud/);
  assert.match(hub, /At 49\.2° S, 31\.0° E, 435 km up/);
  assert.match(hub, /<h2 id="notable">What is notable<\/h2>[\s\S]*Tonight's best viewing window in Pune is 19:30 to 06:26 local time, with 8 percent cloud/);
  for (const f of SKY_FILES) for (const svg of fs.readFileSync(path.join(out, f), "utf8").match(/<svg[\s\S]*?<\/svg>/g) || []) assert.equal(xmlProblem(svg), null, f);
  assert.deepEqual(LIVE_FILES.filter((f) => SKY_FILES.includes(f)), SKY_FILES, "the registry lists the sky pages in order");
});

test("the same data later the same day builds no sky page; the next UTC day rebuilds them with the new date in the key", () => {
  const evening = (c) => ({ cities: Object.fromEntries(Object.entries(c.cities).map(([k, v]) => [k, { ...v, updated: "2026-10-06T21:00:00Z" }])) });
  const out = mk(), dir = skyDir({ clouds: evening(realClouds()) });
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-06T22:00:00Z"), noindex: false, bounds });
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-06T23:30:00Z"), noindex: false, bounds });
  assert.deepEqual(r.built.filter((f) => SKY_FILES.includes(f)), []);
  assert.equal(index(out).pages[skyCityFile("pune")].feeds.utcDate, "2026-10-06");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-07T00:30:00Z"), noindex: false, bounds });
  for (const p of SKY_PAGES.filter((x) => x.daily)) assert.equal(index(out).pages[p.file].feeds.utcDate, "2026-10-07", p.file);
  assert.ok(!("utcDate" in index(out).pages[ISS_FILE].feeds), "the ISS page changes only with its data");
});

test("a stale city skips only its page, the previous copy stays and the sky hub shows it as not updated; no precise.json skips the ISS page", () => {
  const out = mk();
  buildLive({ dataDir: skyDir(), outDir: out, now: SKY_NOW, noindex: false, bounds });
  const tokyoBefore = fs.readFileSync(path.join(out, skyCityFile("tokyo")), "utf8");
  const clouds = realClouds();
  clouds.cities.tokyo.updated = "2026-10-05T18:00:00Z";
  const r = buildLive({ dataDir: skyDir({ clouds, cloudsVersion: "C2" }), outDir: out, now: SKY_NOW, noindex: false, bounds });
  const st = r.stale.find((s) => s.file === skyCityFile("tokyo"));
  assert.ok(st && /clouds data from 2026-10-05T18:00:00Z is more than 6 hours old/.test(st.reason) && st.kept === true, JSON.stringify(r.stale));
  assert.equal(fs.readFileSync(path.join(out, skyCityFile("tokyo")), "utf8"), tokyoBefore);
  const hub = fs.readFileSync(path.join(out, SKY_HUB_FILE), "utf8");
  assert.match(hub, /Tokyo<\/td><td>Data older than the page's limit; page not updated/);
  assert.ok(!hub.includes('href="tokyo/"'));
  assert.deepEqual(r.failed, []);
  const noIss = mk();
  const r2 = buildLive({ dataDir: skyDir({ precise: null }), outDir: noIss, now: SKY_NOW, noindex: false, bounds });
  assert.deepEqual(r2.stale.filter((s) => s.file === ISS_FILE).map((s) => s.reason), ["the satellite data has no precise.json"]);
  assert.deepEqual(r2.failed, []);
  assert.ok(fs.readFileSync(path.join(noIss, skyCityFile("sydney")), "utf8").includes("Not shown: no satellite data in this build."));
});

test("a broken forecast fails only its pages, and the build reports it", () => {
  const clouds = realClouds();
  clouds.cities.london.hours[3].cloud = 140;
  const out = mk();
  const r = buildLive({ dataDir: skyDir({ clouds }), outDir: out, now: SKY_NOW, noindex: false, bounds });
  assert.deepEqual(r.failed.map((f) => f.files[0]), [skyCityFile("london")]);
  assert.match(r.failed[0].reason, /hour 3 has cloud 140, outside 0 to 100/);
  assert.ok(fs.existsSync(path.join(out, skyCityFile("pune"))) && fs.existsSync(path.join(out, SKY_HUB_FILE)));
  assert.match(fs.readFileSync(path.join(out, SKY_HUB_FILE), "utf8"), /London<\/td><td>Data that failed its checks; page not updated/);
});
