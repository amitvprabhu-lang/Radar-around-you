import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeFires, firesNear, topFireClusters, pointInRing, stormsNear, spaceSituation, recentMean, latestOf, connections, NEAR } from "../src/connect.js";
import { haversineKm } from "../src/core.js";

// real feed output written by the pipeline on 2026-10-04 (see pipeline/tests/fixtures/README.md for the sources)
const F = (n) => new URL(`./fixtures/hazards/${n}`, import.meta.url);
const J = (n) => JSON.parse(fs.readFileSync(F(n), "utf8"));
const fb = fs.readFileSync(F("fires.bin"));
const FIRES = decodeFires(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), J("fires.json"));
const STORMS = J("storms.json"), SPACE = J("spaceweather.json"), EVENTS = J("events.json"), QUAKES = J("quakes.json").events;
const NOW = Date.parse("2026-10-04T19:46:00Z");

test("fire cells decode to the counts the pipeline wrote", () => {
  const s = J("fires.json");
  assert.equal(FIRES.n, s.cells);
  let total = 0;
  for (let i = 0; i < FIRES.n; i++) {
    total += FIRES.count[i];
    assert.ok(FIRES.lat[i] > -90 && FIRES.lat[i] < 90 && FIRES.lon[i] > -180 && FIRES.lon[i] < 180);
    assert.ok(FIRES.count[i] >= 1 && FIRES.frp[i] >= 0);
  }
  assert.equal(total, s.detections);
});

test("firesNear agrees with a plain loop and grows with the radius", () => {
  const lat = 36.0, lon = 44.0;
  const brute = (r) => { let d = 0; for (let i = 0; i < FIRES.n; i++) if (haversineKm(lat, lon, FIRES.lat[i], FIRES.lon[i]) <= r) d += FIRES.count[i]; return d; };
  for (const r of [25, 100, 400]) assert.equal(firesNear(FIRES, lat, lon, r).detections, brute(r));
  assert.ok(firesNear(FIRES, lat, lon, 400).detections >= firesNear(FIRES, lat, lon, 100).detections);
  const mid = firesNear(FIRES, -48, -120, 200);  // open South Pacific
  assert.equal(mid.detections, 0);
  assert.ok(mid.nearestKm > 200);
  assert.deepEqual(firesNear(null, 0, 0, 10), { cells: 0, detections: 0, frpMw: 0, nearestKm: null, nearest: null });
});

test("top fire clusters are far apart and strongest first", () => {
  const top = topFireClusters(FIRES, 8, 150);
  assert.equal(top.length, 8);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) assert.ok(haversineKm(top[i].lat, top[i].lon, top[j].lat, top[j].lon) >= 150);
  const maxCell = Math.max(...FIRES.frp);
  assert.ok(top[0].frpMw >= maxCell - 1e-3);
});

test("point in ring, including a ring that straddles the dateline", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInRing(5, 5, sq), true);
  assert.equal(pointInRing(15, 5, sq), false);
  assert.equal(pointInRing(5, 15, sq), false);
  const across = [[175, 0], [-175, 0], [-175, 10], [175, 10]];
  assert.equal(pointInRing(180, 5, across), true);
  assert.equal(pointInRing(-178, 5, across), true);
  assert.equal(pointInRing(170, 5, across), false);
  assert.equal(pointInRing(0, 0, []), false);
});

test("a storm's own forecast points are inside its cone and a distant city is not", () => {
  const rachel = STORMS.storms.find((s) => s.name === "Rachel");
  const first = rachel.track[0];
  const at = stormsNear(STORMS, first.lat, first.lon).find((x) => x.storm.name === "Rachel");
  assert.equal(at.inCone, true);
  const pune = stormsNear(STORMS, 18.52, 73.86);
  assert.ok(pune.every((x) => !x.inCone));
  assert.ok(pune[0].km > 9000);
});

test("the cone of a storm that crosses the dateline works on both sides", () => {
  const nolo = STORMS.storms.find((s) => s.name === "Nolo");
  assert.equal(stormsNear(STORMS, nolo.lat, nolo.lon).find((x) => x.storm.name === "Nolo").inCone, true);
  const second = nolo.track[1];  // west of the dateline
  assert.equal(stormsNear(STORMS, second.lat, second.lon).find((x) => x.storm.name === "Nolo").inCone, true);
  assert.equal(stormsNear(STORMS, 23.8, -150).find((x) => x.storm.name === "Nolo").inCone, false);
});

test("space situation: warnings in force, southward field and the latest values", () => {
  const sit = spaceSituation(SPACE, NOW);
  assert.deepEqual(sit.warnings.map((w) => w.id).sort(), ["WARK04-5425", "WARK05-2268", "WARK06-671"]);
  assert.equal(sit.maxKpExpected, 6);
  assert.equal(sit.lastAlert.id, "ALTK05-2052");
  const pts = SPACE.points.filter((p) => p.bz != null && NOW - Date.parse(p.t) <= 30 * 60e3 && NOW - Date.parse(p.t) >= -10 * 60e3);
  const mean = pts.reduce((a, p) => a + p.bz, 0) / pts.length;
  assert.ok(Math.abs(sit.bz30min - mean) < 1e-9);
  assert.equal(sit.southward, mean < 0);
  assert.equal(sit.speed.value, latestOf(SPACE.points, "speed").value);
  assert.equal(spaceSituation(SPACE, Date.parse("2026-10-06T00:00:00Z")).warnings.length, 0);  // all windows have ended
  assert.equal(spaceSituation(null, NOW), null);
});

test("recentMean ignores missing values and old points", () => {
  const pts = [{ t: "2026-10-04T19:00:00Z", bz: -10 }, { t: "2026-10-04T19:40:00Z", bz: -2 }, { t: "2026-10-04T19:45:00Z", bz: null }];
  assert.equal(recentMean(pts, "bz", 30, NOW), -2);
  assert.equal(recentMean(pts, "bz", 5, NOW), null);
});

test("connections for a place near a hurricane say how far, which way and what NHC forecasts", () => {
  const place = { name: "Cabo San Lucas", lat: 22.89, lon: -109.91 };
  const c = connections({ place, nowMs: NOW, storms: STORMS, fires: FIRES, space: SPACE, events: EVENTS, quakes: QUAKES, auroraChance: 0 });
  const storm = c.find((x) => x.kind === "storm");
  assert.ok(storm, "a storm connection");
  const rachel = STORMS.storms.find((s) => s.name === "Rachel");
  assert.ok(Math.abs(storm.km - haversineKm(place.lat, place.lon, rachel.lat, rachel.lon)) < 1e-6);
  assert.match(storm.detail, /Hurricane Rachel is [\d,]+ km SW of Cabo San Lucas/);
  assert.match(storm.detail, /90 knots \(167 km\/h\)/);
  assert.equal(storm.source, "NOAA National Hurricane Center");
  assert.equal(storm.asOf, "2026-10-04T15:00:00Z");
  assert.ok(!c.some((x) => x.kind === "aurora"), "no aurora statement where NOAA gives no chance");
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].severity >= c[i].severity);
});

test("a place inside the cone is told the cone's own caveat", () => {
  const rachel = STORMS.storms.find((s) => s.name === "Rachel");
  const p = rachel.track[1];
  const c = connections({ place: { name: "Test point", lat: p.lat, lon: p.lon }, nowMs: NOW, storms: STORMS });
  const storm = c.find((x) => x.kind === "storm");
  assert.equal(storm.severity, 3);
  assert.match(storm.detail, /inside NHC's forecast cone/);
  assert.match(storm.detail, /60 to 70 percent/);
});

test("a quiet place gets no connections and a place with an aurora chance gets the NOAA wording", () => {
  const quiet = connections({ place: { name: "Mid ocean", lat: -48, lon: -120 }, nowMs: NOW, storms: STORMS, fires: FIRES, space: SPACE, events: EVENTS, quakes: [], auroraChance: 0 });
  assert.deepEqual(quiet.map((x) => x.kind), []);
  const north = connections({ place: { name: "Tromso", lat: 69.65, lon: 18.96 }, nowMs: NOW, space: SPACE, auroraChance: 45 });
  const a = north.find((x) => x.kind === "aurora");
  assert.equal(a.severity, 3);
  assert.match(a.detail, /45% chance of aurora overhead for Tromso/);
  assert.match(a.detail, /Kp index will reach 6/);
  assert.equal(a.source, "NOAA Space Weather Prediction Center");
});

test("fire detections near a place are reported with the satellite caveat", () => {
  const top = topFireClusters(FIRES, 1)[0];
  const c = connections({ place: { name: "Fire town", lat: top.lat + 0.05, lon: top.lon + 0.05 }, nowMs: NOW, fires: FIRES });
  const f = c.find((x) => x.kind === "fire");
  assert.equal(f.severity, 3);
  assert.match(f.detail, /heat signal seen from space, not a confirmed wildfire/);
  assert.ok(f.km < 25);
  assert.equal(f.asOf, J("fires.json").newest);
});

test("recent nearby quakes are listed, older or smaller ones are not", () => {
  const q = QUAKES.filter((e) => e.mag >= NEAR.quakeMinMag)[0];
  const t = Date.parse(q.time) + 3600e3;
  const near = connections({ place: { name: "Epicentre", lat: q.lat, lon: q.lon }, nowMs: t, quakes: QUAKES });
  assert.ok(near.some((x) => x.ref === q.id));
  const later = connections({ place: { name: "Epicentre", lat: q.lat, lon: q.lon }, nowMs: Date.parse(q.time) + 72 * 3600e3, quakes: [q] });
  assert.equal(later.length, 0);
});
