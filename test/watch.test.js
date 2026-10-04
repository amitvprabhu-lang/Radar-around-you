import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seriesPath, niceRange, stormMapFrame, graticule, wrapLon, gratLabel, catColor, mph, plural, FIRMS_SATELLITES } from "../src/watch.js";

const STORMS = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/storms.json", import.meta.url), "utf8"));
const SPACE = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/spaceweather.json", import.meta.url), "utf8"));

test("series path scales into the box and breaks at missing values", () => {
  const pts = [{ t: "2026-10-04T10:00:00Z", v: 0 }, { t: "2026-10-04T11:00:00Z", v: 5 }, { t: "2026-10-04T12:00:00Z", v: null }, { t: "2026-10-04T13:00:00Z", v: 10 }];
  assert.equal(seriesPath(pts, "v", 300, 100, 0, 10), "M0.0 100.0L100.0 50.0M300.0 0.0");
  assert.equal(seriesPath([], "v", 300, 100, 0, 10), "");
  assert.equal(seriesPath(pts, "v", 300, 100, 5, 5), "");
  assert.equal(seriesPath([{ t: "2026-10-04T10:00:00Z", v: 99 }, { t: "2026-10-04T11:00:00Z", v: -99 }], "v", 10, 10, 0, 10), "M0.0 0.0L10.0 10.0", "values outside the range are held at its edges");
});

test("nice range always includes the requested value and never collapses", () => {
  const r = niceRange(SPACE.points, "bz", 0);
  assert.ok(r.min <= 0 && r.max >= 0);
  assert.ok(r.min <= Math.min(...SPACE.points.filter((p) => p.bz != null).map((p) => p.bz)));
  assert.ok(niceRange([{ bz: 3 }, { bz: 3 }], "bz").max > 3);
  assert.equal(niceRange([], "bz"), null);
});

test("a storm map keeps every track and cone point inside its box, also across the dateline", () => {
  for (const s of STORMS.storms) {
    const W = 320, H = 190, f = stormMapFrame(s, W, H);
    const all = [[s.lon, s.lat], ...s.track.map((p) => [p.lon, p.lat]), ...s.cone.flat()];
    for (const [lo, la] of all) {
      const [x, y] = f.project(lo, la);
      assert.ok(x >= -0.5 && x <= W + 0.5 && y >= -0.5 && y <= H + 0.5, `${s.name} point ${lo},${la} -> ${x},${y}`);
    }
  }
  const nolo = STORMS.storms.find((s) => s.name === "Nolo");
  const f = stormMapFrame(nolo, 320, 190);
  const [x0] = f.project(nolo.lon, nolo.lat), [x1] = f.project(nolo.track.at(-1).lon, nolo.track.at(-1).lat);
  assert.ok(x1 < x0 && x0 - x1 > 100, "the storm moves west across the picture, not around the world");
});

test("graticule picks a readable step and labels wrap past the dateline", () => {
  const nolo = STORMS.storms.find((s) => s.name === "Nolo");
  const f = stormMapFrame(nolo, 320, 190);
  const g = graticule(f);
  assert.ok(g.lons.length >= 2 && g.lons.length <= 9 && g.lats.length >= 1);
  assert.ok(g.lons.every((v) => v >= f.minLon && v <= f.maxLon && v % g.step === 0));
  assert.equal(wrapLon(181.5), -178.5);
  assert.equal(wrapLon(-210), 150);
  assert.equal(gratLabel(wrapLon(190), "E", "W"), "170°W");
  assert.equal(gratLabel(-20, "N", "S"), "20°S");
});

test("storm colours follow the Saffir-Simpson category and miles per hour match NHC's own conversion", () => {
  assert.equal(catColor(90, "HU"), "var(--ember)");   // category 2
  assert.equal(catColor(100, "HU"), "var(--alert)");  // category 3, a major hurricane
  assert.equal(catColor(50, "TS"), "var(--sky)");
  assert.equal(catColor(100, "TS"), "var(--sky)", "only hurricanes get a category colour");
  assert.deepEqual([90, 55, 45, 100].map(mph), [105, 65, 50, 115], "the values NHC's own KML prints for Rachel's advisory 30, plus Nolo's 100 kt");
});

test("plural and satellite names", () => {
  assert.equal(plural(1, "detection", "detections"), "1 detection");
  assert.equal(plural(21, "detection", "detections"), "21 detections");
  assert.equal(plural(191619, "detection", "detections"), "191,619 detections");
  const fires = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/fires.json", import.meta.url), "utf8"));
  for (const code of Object.keys(fires.bySatellite)) assert.ok(FIRMS_SATELLITES[code], `a name for satellite code ${code}`);
});
