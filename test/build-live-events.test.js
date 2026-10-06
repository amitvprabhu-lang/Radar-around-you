// The fleet and events pages in the live build (site/build-live.mjs): each built on its own from its own feeds, skipped with a reason
// when stale or missing, with per-page feed versions in index.json, the data time as lastmod, rows on the hub and history.json.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLive } from "../site/build-live.mjs";
import { EVENT_FILES, RIGHT_NOW_FILE, LIVE_FILES } from "../site/livepages.mjs";
import { SITE, urlPath, NAV } from "../site/layout.mjs";
import { countryFixture } from "./helpers/satfixture.mjs";
import { EVENTS_DIR, EVENTS_NOW, eventsManifest } from "./helpers/eventsfixture.mjs";

const bounds = { min: 5, max: 1000 };
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "ble-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const read = (out, f) => fs.readFileSync(path.join(out, f), "utf8");
const readIndex = (out) => JSON.parse(read(out, "index.json"));
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// the small country fleet (70 Starlink satellites) plus the real launches, GDACS and NHC feeds of 6 October; patch(manifest, dir) can change it
function dataDir(patch = null) {
  const dir = mk(), fx = countryFixture(), base = "satellites/S1";
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify(fx.meta));
  fs.cpSync(EVENTS_DIR, dir, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  const m = eventsManifest();
  m.feeds.satellites = { version: "S1", sourceTime: fx.meta.taken, files: { "details.bin": `${base}/details.bin`, "swarm.bin": `${base}/swarm.bin`, "satmeta.json": `${base}/satmeta.json` } };
  if (patch) patch(m, dir);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
  return dir;
}
// a new version of one feed, its file changed by edit(text)
function newVersion(m, dir, feed, file, version, edit = (t) => t, extra = {}) {
  const rel = `${feed}/${version}/${file}`;
  fs.mkdirSync(path.join(dir, feed, version), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), edit(fs.readFileSync(path.join(dir, m.feeds[feed].files[file]), "utf8")));
  m.feeds[feed] = { ...m.feeds[feed], version, files: { ...m.feeds[feed].files, [file]: rel }, ...extra };
}

test("the three pages are built on their own, with their feed versions and data times in the index, the sitemap and on the hub", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir(), outDir: out, now: EVENTS_NOW, noindex: false, bounds, starlinkMin: 50 });
  assert.deepEqual(r.failed, []);
  for (const f of EVENT_FILES) assert.ok(fs.existsSync(path.join(out, f)) && r.built.includes(f), f);
  const index = readIndex(out);
  assert.deepEqual(index.pages["rocket-launches/index.html"], { feeds: { launches: "20261006T013040Z" }, dataTime: "2026-10-06T01:30:38Z" });
  assert.deepEqual(index.pages["natural-disasters-now/index.html"], { feeds: { events: "20261006T014029Z", storms: "20261006T014038Z" }, dataTime: "2026-10-06T01:31:35Z" });
  assert.deepEqual(index.pages["starlink-tracker/index.html"], { feeds: { satellites: "S1" }, dataTime: "2026-10-05T08:14:54Z" });
  for (const f of EVENT_FILES) assert.ok(index.files[f] && index.files[f].size === fs.statSync(path.join(out, f)).size, f);
  const xml = read(out, "sitemap-live.xml");
  for (const f of EVENT_FILES) assert.ok(xml.includes(`<loc>${SITE.url}/${urlPath(f)}</loc><lastmod>${index.pages[f].dataTime}</lastmod>`), f);
  const order = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(order, LIVE_FILES.filter((f) => index.pages[f]).map((f) => `${SITE.url}/${urlPath(f)}`), "in the registry's order");
  const hub = read(out, RIGHT_NOW_FILE);
  for (const f of EVENT_FILES) assert.ok(hub.includes(`href="../${urlPath(f)}"`), `the hub links ${f}`);
  assert.ok(textOf(hub).includes("Next: Nuri | NeonSat-2 to 6, 7 October 2026, 03:23 UTC"));
  assert.ok(textOf(hub).includes("70 active Starlink satellites"));
  assert.ok(index.feeds.launches === "20261006T013040Z" && index.pages[RIGHT_NOW_FILE].feeds.launches === "20261006T013040Z");
  // the pages link each other and every relative link lands on a written page or outside the live folder
  for (const f of EVENT_FILES) {
    for (const m of read(out, f).matchAll(/ href="([^"#]+)"/g)) {
      if (/^https?:/.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])).replace(/\/$/, "/index.html");
      // the nav's live pages other than the hub (tonight's sky) are also written at deploy time by site/build.mjs, so they exist on the site
      if (NAV.some(([n]) => n && `${n}index.html` === target && target !== RIGHT_NOW_FILE)) continue;
      if (LIVE_FILES.includes(target)) assert.ok(fs.existsSync(path.join(out, target)), `${f}: ${m[1]}`);
    }
  }
  const linkedFrom = (f) => EVENT_FILES.concat([RIGHT_NOW_FILE]).filter((g) => g !== f && read(out, g).includes(`href="../${urlPath(f)}"`)).length;
  for (const f of EVENT_FILES) assert.ok(linkedFrom(f) >= 3, `${f} is linked from the hub and at least two other pages`);
});

test("history.json keeps each page's headline numbers, and the next build compares with the build before", () => {
  const out = mk();
  buildLive({ dataDir: dataDir(), outDir: out, now: EVENTS_NOW, noindex: false, bounds, starlinkMin: 50 });
  const h1 = JSON.parse(read(out, "history.json"));
  assert.deepEqual(Object.keys(h1.pages).sort(), ["disasters", "launches", "starlink"]);
  assert.equal(h1.pages.launches.length, 1);
  assert.ok(!("history.json" in readIndex(out).files), "not listed in index.json, so never copied to the site");
  assert.ok(!/in the previous build of this page/.test(read(out, "rocket-launches/index.html")), "no history yet, no change finding");
  // an hour later the launch list is read again with one launch fewer in the 30 days
  const later = new Date("2026-10-06T02:40:00Z");
  const dir = dataDir((m, d) => newVersion(m, d, "launches", "launches.json", "20261006T023040Z", (t) => {
    const doc = JSON.parse(t); doc.generated = "2026-10-06T02:30:38Z"; doc.launches = doc.launches.filter((l) => l.name !== "Long March 12 | Unknown Payload"); return JSON.stringify(doc);
  }, { sourceTime: "2026-10-06T02:30:38Z" }));
  const r = buildLive({ dataDir: dir, outDir: out, now: later, noindex: false, bounds, starlinkMin: 50 });
  assert.ok(r.built.includes("rocket-launches/index.html") && !r.built.includes("starlink-tracker/index.html"), JSON.stringify(r.built));
  const t = textOf(read(out, "rocket-launches/index.html"));
  assert.match(t, /Launches planned in the 30 days after the data time: 12, against 13 in the previous build of this page \(data as of 6 October 2026, 01:30 UTC\), about the same\./);
  const h2 = JSON.parse(read(out, "history.json"));
  assert.equal(h2.pages.launches.length, 2);
  assert.equal(h2.pages.starlink.length, 1, "a page that was kept adds nothing");
  // the same data again changes nothing, history included
  const before = read(out, "history.json");
  const again = buildLive({ dataDir: dir, outDir: out, now: later, noindex: false, bounds, starlinkMin: 50 });
  assert.equal(again.changed, false);
  assert.equal(read(out, "history.json"), before);
});

test("a stale, missing or broken feed skips only its page with the reason, and the hub shows it without a number or a link", () => {
  const out = mk();
  buildLive({ dataDir: dataDir(), outDir: out, now: EVENTS_NOW, noindex: false, bounds, starlinkMin: 50 });
  const launchesBefore = read(out, "rocket-launches/index.html");
  // seven hours on: the launch list (6 hours) and GDACS (6 hours) are stale, the satellites (30 hours) are not
  const r = buildLive({ dataDir: dataDir(), outDir: out, now: new Date("2026-10-06T08:45:00Z"), noindex: false, bounds, starlinkMin: 50 });
  assert.deepEqual(r.stale.map((s) => s.file).filter((f) => EVENT_FILES.includes(f)).sort(), ["natural-disasters-now/index.html", "rocket-launches/index.html"]);
  assert.match(r.stale.find((s) => s.file === "rocket-launches/index.html").reason, /launches data from 2026-10-06T01:30:38Z is more than 6 hours old/);
  assert.ok(r.stale.filter((s) => EVENT_FILES.includes(s.file)).every((s) => s.kept));
  assert.deepEqual(r.failed, []);
  assert.equal(read(out, "rocket-launches/index.html"), launchesBefore, "the previous copy stays");
  const hub = read(out, RIGHT_NOW_FILE);
  assert.ok(!hub.includes('href="../rocket-launches/"') && textOf(hub).includes("Rocket launches Data older than the page's limit"));
  // the satellites feed beyond 30 hours
  const r2 = buildLive({ dataDir: dataDir(), outDir: mk(), now: new Date("2026-10-06T14:30:00Z"), noindex: false, bounds, starlinkMin: 50 });
  assert.match(r2.stale.find((s) => s.file === "starlink-tracker/index.html").reason, /satellites data from 2026-10-05T08:14:54Z is more than 30 hours old/);
  // under the real Starlink minimum: skipped with the reason, not a failure
  const r3 = buildLive({ dataDir: dataDir(), outDir: mk(), now: EVENTS_NOW, noindex: false, bounds });
  assert.match(r3.stale.find((s) => s.file === "starlink-tracker/index.html").reason, /70 active Starlink satellites in the data, under the page's minimum of 1,000/);
  assert.deepEqual(r3.failed, []);
  // a broken GDACS file fails only its page
  const bad = dataDir((m, d) => newVersion(m, d, "events", "events.json", "20261006T020000Z", (t) => t.replace('"alert":"Green"', '"alert":"Purple"')));
  const r4 = buildLive({ dataDir: bad, outDir: mk(), now: EVENTS_NOW, noindex: false, bounds, starlinkMin: 50 });
  assert.deepEqual(r4.failed.map((f) => [f.step, f.files]), [["events page natural-disasters-now", ["natural-disasters-now/index.html"]]]);
  assert.match(r4.failed[0].reason, /unknown alert level Purple/);
  // no storms feed: the disasters page is still built, without the match
  const noStorms = dataDir((m) => { delete m.feeds.storms; });
  const out5 = mk();
  const r5 = buildLive({ dataDir: noStorms, outDir: out5, now: EVENTS_NOW, noindex: false, bounds, starlinkMin: 50 });
  assert.ok(r5.built.includes("natural-disasters-now/index.html"));
  assert.ok(textOf(read(out5, "natural-disasters-now/index.html")).includes("NHC's storm list was not available in this build, so no cyclone was matched with it"));
});
