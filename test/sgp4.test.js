import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as sat from "satellite.js";
import * as C from "../src/core.js";
import * as G from "../src/sgp4.js";
import * as T from "../src/trains.js";
import { loadD } from "./helpers.js";

const D = loadD();
const precisePacked = JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8"));
const precise = G.loadPrecise(precisePacked);
const snapMs = Date.parse(D.meta.taken);
const snap = new Date(snapMs);
const pune = { lat: 18.5204, lon: 73.8567 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} +- ${tol}, got ${a}`);
const ISS = precise.get(25544);

test("every packed element set is accepted by SGP4", () => {
  assert.equal(precise.size, precisePacked.rows.length);
  assert.equal(D.meta.preciseCount, precisePacked.rows.length);
  for (const row of precisePacked.rows) assert.ok(precise.has(row[0]));
});

test("precise set covers the stations, the brightest objects and every object launched in the last 30 days", () => {
  assert.ok(precise.has(25544) && precise.has(48274), "ISS and the Chinese station");
  assert.ok(precise.has(20580), "Hubble is in the visual group");
  for (const idx of D.meta.newIdx) assert.ok(precise.has(D.later.ids[idx]), `new object ${D.later.names[idx]}`);
});

test("SGP4 ECEF position matches satellite.js directly and the ISS is at ISS height", () => {
  for (const h of [0, 3, 12]) {
    const d = new Date(snapMs + h * 3600e3);
    const mine = G.ecefAt(ISS, d);
    const p = sat.propagate(ISS.rec, d).position;
    const ref = sat.eciToEcf(p, sat.gstime(d));
    near(Math.hypot(mine.x - ref.x, mine.y - ref.y, mine.z - ref.z), 0, 1e-9, "same as the library");
    const g = C.ecefToGeodetic(mine.x, mine.y, mine.z);
    assert.ok(g.hKm > 380 && g.hKm < 450, `ISS height ${g.hKm}`);
    assert.ok(Math.abs(g.lat) <= 51.8, "within the ISS inclination");
  }
});

test("the fast swarm model stays close to SGP4 for the same ISS element set", () => {
  const idx = D.later.ids.indexOf(25544);
  for (const [h, tol] of [[0, 40], [6, 60], [24, 90]]) {
    const d = new Date(snapMs + h * 3600e3);
    const a = G.ecefAt(ISS, d);
    const b = C.swarmPositionEcef(D.swarm[idx], d);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol, `swarm vs SGP4 at +${h} h`);
  }
});

test("look angles agree with satellite.js ecfToLookAngles", () => {
  for (let m = 0; m < 600; m += 23) {
    const d = new Date(snapMs + m * 60e3);
    const mine = G.lookFrom(ISS, d, pune.lat, pune.lon);
    const p = sat.propagate(ISS.rec, d).position;
    const look = sat.ecfToLookAngles({ latitude: pune.lat * C.DEG, longitude: pune.lon * C.DEG, height: 0 }, sat.eciToEcf(p, sat.gstime(d)));
    near(mine.el, look.elevation / C.DEG, 0.15, "elevation");
    if (mine.el > 0) near(C.norm180(mine.az - look.azimuth / C.DEG), 0, 0.15, "azimuth");
    assert.ok(mine.rangeKm > 380, "range is at least the height");
    assert.equal(mine.sunlit, C.isSunlit(p, C.sunUnitVectorEci(d)));
  }
});

test("passes are well formed and the visible flag means lit in a dark sky", () => {
  const passes = G.passesFor(ISS, pune, snap, 72);
  assert.ok(passes.length >= 4 && passes.length <= 20, `passes in 72 h: ${passes.length}`);
  let prev = 0;
  for (const p of passes) {
    assert.ok(p.rise < p.max.time && p.max.time <= p.set, "rise, peak, set in order");
    assert.ok(p.rise.getTime() >= prev, "passes are in time order");
    prev = p.set.getTime();
    assert.ok(p.max.el >= 10 && p.max.el <= 90);
    assert.ok(p.set - p.rise < 15 * 60e3, "a low-orbit pass lasts under 15 minutes");
    const lit = p.track.some((t) => t.lit);
    assert.equal(p.visible, lit, "visible exactly when some sample is lit in a dark sky");
    if (p.visible) assert.ok(p.track.some((t) => t.lit && C.sunAltAz(pune.lat, pune.lon, t.time).alt < -6));
  }
});

test("element age from the epoch matches the age byte packed by the pipeline", () => {
  const idx = D.later.ids.indexOf(25544);
  const ageByte = D.later.details[idx * 8 + 7];
  const hours = G.elementAgeHours(ISS, snap);
  near(ageByte * 4, hours, 2.01, "age byte is the age in 4 hour steps");
  assert.ok(hours >= 0 && hours < 60);
});

test("pipeline health block matches what the packed data shows", () => {
  const h = D.meta.health;
  assert.equal(h.kept, D.meta.count);
  assert.equal(h.recordsRead - h.duplicatesDropped - Object.values(h.invalidDropped).reduce((a, b) => a + b, 0), h.kept);
  const ages = Array.from({ length: D.meta.count }, (_, i) => D.later.details[i * 8 + 7] * 4);
  const stale3 = ages.filter((a) => a > 72).length;
  near(stale3, h.staleOver3d, Math.max(40, h.staleOver3d * 0.15), "objects older than 3 days (age byte has 4 h steps)");
  assert.ok(h.ageHours.median > 0 && h.ageHours.median < 48);
  assert.ok(h.ageHours.p90 >= h.ageHours.median && h.ageHours.p99 >= h.ageHours.p90 && h.ageHours.max >= h.ageHours.p99);
});

// ---------------------------------------------------------------- trains
test("along-track spread of points on one orbit", () => {
  const ring = (angles) => angles.map((a) => ({ x: 7000 * Math.cos(a * C.DEG), y: 7000 * Math.sin(a * C.DEG), z: 0 }));
  near(T.alongTrackSpread(ring([10, 20, 30, 40])).spanDeg, 30, 0.01, "30 degree arc");
  near(T.alongTrackSpread(ring([350, 355, 5, 10])).spanDeg, 20, 0.01, "arc across 0/360");
  near(T.alongTrackSpread(ring([0, 90, 180, 270])).spanDeg, 270, 0.01, "spread all round the orbit");
  assert.equal(T.alongTrackSpread(ring([42])).spanDeg, 0);
  assert.deepEqual(T.alongTrackSpread(ring([30, 10, 20]), { x: 0, y: 0, z: 1 }).order, [1, 2, 0], "counter-clockwise travel: 10, 20, 30 degrees");
  assert.deepEqual(T.alongTrackSpread(ring([30, 10, 20]), { x: 0, y: 0, z: -1 }).order, [0, 2, 1], "clockwise travel reverses the order");
  near(T.alongTrackSpread(ring([30, 10, 20]), { x: 0, y: 0, z: 5 }).spanDeg, 20, 0.01, "the normal does not need to be a unit vector");
});

test("the 28 September Starlink launch is found as a stretched string, older launches are not", () => {
  const trains = T.findTrains(D, precise, snap);
  assert.equal(trains.length, 1, JSON.stringify(trains.map((t) => [t.launchDay, t.count, t.spanDeg])));
  const t = trains[0];
  assert.equal(t.launchDate.toISOString().slice(0, 10), "2026-09-28");
  assert.equal(t.count, 26);
  assert.ok(t.spanDeg > 80 && t.spanDeg < 105, `span ${t.spanDeg}`);
  assert.equal(t.shape, "stretched");
  assert.ok(t.altKm > 250 && t.altKm < 600, `altitude ${t.altKm}`);
  assert.match(D.later.names[t.centralIdx], /^STARLINK-/);
  assert.equal(t.memberIdxs.length, 26);
  assert.ok(t.memberIdxs.includes(t.centralIdx) && t.memberIdxs.includes(t.firstIdx) && t.memberIdxs.includes(t.lastIdx));
  // a month later nothing counts as a recent launch
  assert.equal(T.findTrains(D, precise, new Date(snapMs + 40 * 86400e3)).length, 0);
});

test("train events: enough satellites up, sunlit, in a dark sky, in order", () => {
  const train = T.findTrains(D, precise, snap)[0];
  const ev = T.trainEvents(train, precise, pune, snap, 72);
  assert.ok(ev.length >= 1, "Pune sees the string within three days");
  let prevEnd = 0;
  for (const e of ev) {
    assert.ok(e.start <= e.peak && e.peak <= e.end);
    assert.ok(e.start.getTime() > prevEnd, "events do not overlap");
    prevEnd = e.end.getTime();
    assert.ok(e.maxCount >= 3 && e.maxCount <= train.count);
    assert.ok(C.sunAltAz(pune.lat, pune.lon, e.peak).alt < -6, "sky is dark at the peak");
    // recount at the peak, independently of the finder
    let n = 0;
    for (const id of train.memberIds) { const l = G.lookFrom(precise.get(id), e.peak, pune.lat, pune.lon); if (l && l.el >= 10 && l.sunlit) n++; }
    assert.equal(n, e.maxCount, "count at the peak");
    assert.match(e.riseCompass, /^[NESW]{1,3}$/);
    assert.ok(e.trainSeconds > 60 && e.trainSeconds < 3000);
  }
});
