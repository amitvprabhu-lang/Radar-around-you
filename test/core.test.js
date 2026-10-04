// Unit tests for core.js. Run with: node --test
// Where possible, results are cross-checked against independent, well-tested libraries
// (astronomy-engine and satellite.js) rather than against numbers typed in by hand.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as A from "astronomy-engine";
import * as sat from "satellite.js";
import * as C from "../src/core.js";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected} ± ${tol}, got ${actual}`);
const angNear = (actual, expected, tol, msg) => near(C.norm180(actual - expected), 0, tol, msg);

const DATES = [
  new Date("2026-10-04T14:00:00Z"),
  new Date("2026-01-15T03:30:00Z"),
  new Date("2026-06-21T22:10:00Z"),
  new Date("2027-03-01T08:45:00Z"),
];
const PUNE = { lat: 18.5204, lon: 73.8567 };
const TROMSO = { lat: 69.6492, lon: 18.9553 };

test("sidereal time matches satellite.js gstime", () => {
  for (const d of DATES) {
    const lib = (sat.gstime(d) * 180) / Math.PI;
    angNear(C.gmstDeg(d), lib, 0.01, `GMST at ${d.toISOString()}`);
  }
});

test("Sun RA/Dec matches astronomy-engine within 0.05 degrees", () => {
  const obs = new A.Observer(0, 0, 0);
  for (const d of DATES) {
    const eq = A.Equator(A.Body.Sun, d, obs, true, true);
    const mine = C.sunRaDec(d);
    angNear(mine.ra, eq.ra * 15, 0.05, `Sun RA ${d.toISOString()}`);
    near(mine.dec, eq.dec, 0.05, `Sun Dec ${d.toISOString()}`);
  }
});

test("Sun altitude and azimuth match astronomy-engine for Pune and Tromso", () => {
  for (const place of [PUNE, TROMSO]) {
    const obs = new A.Observer(place.lat, place.lon, 0);
    for (const d of DATES) {
      const eq = A.Equator(A.Body.Sun, d, obs, true, true);
      const hz = A.Horizon(d, obs, eq.ra, eq.dec, null);
      const mine = C.sunAltAz(place.lat, place.lon, d);
      near(mine.alt, hz.altitude, 0.1, `Sun altitude ${d.toISOString()}`);
      if (Math.abs(hz.altitude) < 89) angNear(mine.az, hz.azimuth, 0.15, `Sun azimuth ${d.toISOString()}`);
    }
  }
});

test("star altitude and azimuth match astronomy-engine for the same RA/Dec", () => {
  const vega = { ra: 279.2347, dec: 38.7837 };
  for (const place of [PUNE, TROMSO]) {
    const obs = new A.Observer(place.lat, place.lon, 0);
    for (const d of DATES) {
      const hz = A.Horizon(d, obs, vega.ra / 15, vega.dec, null);
      const mine = C.raDecToAltAz(vega.ra, vega.dec, place.lat, place.lon, d);
      near(mine.alt, hz.altitude, 0.02, "Vega altitude");
      angNear(mine.az, hz.azimuth, 0.05, "Vega azimuth");
    }
  }
});

test("Sun is overhead at the sub-solar point", () => {
  for (const d of DATES) {
    const p = C.subsolarPoint(d);
    near(C.sunAltAz(p.lat, p.lon, d).alt, 90, 0.05, "Sun altitude at sub-solar point");
  }
});

test("Sun direction vector agrees with astronomy-engine within 0.5 degrees", () => {
  for (const d of DATES) {
    const v = A.GeoVector(A.Body.Sun, d, true);
    const len = Math.hypot(v.x, v.y, v.z);
    const u = C.sunUnitVectorEci(d);
    const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / len;
    near(Math.acos(Math.min(1, cos)) / C.DEG, 0, 0.5, "angle between Sun vectors (precession allowed)");
  }
});

test("distance, bearing and destination are consistent", () => {
  near(C.haversineKm(0, 0, 1, 0), 111.195, 0.01, "one degree of latitude");
  near(C.haversineKm(0, 0, 0, 90), (Math.PI / 2) * C.EARTH_RADIUS_KM, 0.01, "quarter of the equator");
  near(C.bearingDeg(10, 10, 20, 10), 0, 1e-9, "due north");
  near(C.bearingDeg(0, 0, 0, 10), 90, 1e-9, "due east on the equator");
  const start = { lat: 51.5074, lon: -0.1278 };
  for (const [b, km] of [[0, 50], [135, 320], [271, 900]]) {
    const p = C.destinationPoint(start.lat, start.lon, b, km);
    near(C.haversineKm(start.lat, start.lon, p.lat, p.lon), km, 0.01, `round-trip distance ${b}`);
    angNear(C.bearingDeg(start.lat, start.lon, p.lat, p.lon), b, 0.01, `round-trip bearing ${b}`);
  }
});

test("plane extrapolation moves at ground speed along the track", () => {
  const p = { lat: 10, lon: 20, gsKt: 60, track: 0 };
  const after = C.extrapolatePlane(p, 3600);
  near(C.haversineKm(10, 20, after.lat, after.lon), 111.12, 0.01, "60 knots for one hour");
  near(after.lon, 20, 1e-9, "heading north keeps longitude");
  assert.deepEqual(C.extrapolatePlane({ ...p, gsKt: 0 }, 600), { lat: 10, lon: 20 });
});

test("look angle to a plane", () => {
  near(C.lookAngle(0, 0, 0, 0, 10).el, 90, 1e-6, "directly overhead");
  const far = C.lookAngle(0, 0, 0, 100 / 111.195, 10);
  near(far.el, 5.26, 0.02, "100 km away at 10 km height");
  near(far.az, 90, 1e-6, "due east");
});

test("Earth shadow test", () => {
  const sun = { x: 1, y: 0, z: 0 };
  assert.equal(C.isSunlit({ x: 7000, y: 0, z: 0 }, sun), true, "day side");
  assert.equal(C.isSunlit({ x: -7000, y: 0, z: 0 }, sun), false, "straight behind the Earth");
  assert.equal(C.isSunlit({ x: -7000, y: 7000, z: 0 }, sun), true, "behind but outside the shadow cylinder");
  assert.equal(C.isSunlit({ x: -7000, y: 0, z: 6300 }, sun), false, "inside the shadow cylinder");
});

test("pass finder on a synthetic satellite", () => {
  const t0 = new Date("2026-10-04T00:00:00Z");
  // Rises at minute 10, peaks at 50 degrees at minute 15, sets at minute 20.
  const lookFn = (d) => {
    const m = (d - t0) / 60000;
    const el = m >= 8 && m <= 22 ? 60 * Math.sin(((m - 8) / 14) * Math.PI) - 10 : -30;
    return { el, az: 200 + m, sunlit: true };
  };
  const passes = C.findPasses(lookFn, () => -20, t0, 1, { stepSec: 10 });
  assert.equal(passes.length, 1);
  near(passes[0].max.el, 50, 0.1, "peak elevation");
  near((passes[0].max.time - t0) / 60000, 15, 0.2, "peak time");
  assert.equal(passes[0].visible, true);
  const daylight = C.findPasses(lookFn, () => 10, t0, 1, { stepSec: 10 });
  assert.equal(daylight[0].visible, false, "not visible in daylight");
});

test("pass finder on the real ISS snapshot gives physically sensible passes", () => {
  const snap = JSON.parse(fs.readFileSync(new URL("../snapshot.json", import.meta.url), "utf8"));
  const iss = snap.satellites.find((s) => s.label === "ISS");
  const rec = sat.json2satrec(iss);
  const obsGd = { latitude: PUNE.lat * C.DEG, longitude: PUNE.lon * C.DEG, height: 0.56 };
  const lookFn = (d) => {
    const pv = sat.propagate(rec, d);
    const gmst = sat.gstime(d);
    const la = sat.ecfToLookAngles(obsGd, sat.eciToEcf(pv.position, gmst));
    return { el: la.elevation / C.DEG, az: la.azimuth / C.DEG, sunlit: C.isSunlit(pv.position, C.sunUnitVectorEci(d)) };
  };
  const start = new Date("2026-10-04T14:00:00Z");
  const passes = C.findPasses(lookFn, (d) => C.sunAltAz(PUNE.lat, PUNE.lon, d).alt, start, 48, { stepSec: 20 });
  assert.ok(passes.length >= 2, `expected at least 2 ISS passes in 48 h, got ${passes.length}`);
  for (const p of passes) {
    assert.ok(p.rise <= p.max.time && p.max.time <= p.set, "rise, peak and set are in order");
    assert.ok(p.max.el >= 10 && p.max.el <= 90, "peak elevation is between 10 and 90 degrees");
    if (!p.truncated) assert.ok((p.set - p.rise) / 60000 <= 12, "an ISS pass above 10 degrees lasts under 12 minutes");
    near(lookFn(p.max.time).el, p.max.el, 1e-6, "peak elevation is reproducible");
  }
  const h = sat.eciToGeodetic(sat.propagate(rec, start).position, sat.gstime(start)).height;
  assert.ok(h > 370 && h < 460, `ISS altitude ${h} km should be about 400 km`);
});

test("sky projection puts directions in the right places", () => {
  const z = C.projectSky(90, 0, 100, 100, 50);
  assert.deepEqual([Math.round(z.x), Math.round(z.y)], [100, 100], "zenith at the centre");
  const n = C.projectSky(0, 0, 100, 100, 50);
  near(n.x, 100, 1e-9, "north x");
  near(n.y, 50, 1e-9, "north at the top");
  const e = C.projectSky(0, 90, 100, 100, 50);
  near(e.x, 50, 1e-9, "east on the left (looking up)");
  const rotated = C.projectSky(0, 90, 100, 100, 50, 90);
  near(rotated.y, 50, 1e-9, "rotating by 90 puts east at the top");
  near(C.projectSky(45, 123, 0, 0, 90).r, 45, 1e-9, "radius grows linearly with zenith distance");
});

test("Guide me panorama and instructions", () => {
  const p = C.projectPanorama(30, 120, 120, 400, 300);
  near(p.x, 200, 1e-9, "target straight ahead is centred");
  near(p.y, 200, 1e-9, "30 degrees up");
  assert.equal(C.projectPanorama(30, 300, 120, 400, 300), null, "target behind you is off screen");
  assert.match(C.guideInstruction(0, 90, 40).text, /^Turn right 90°/);
  assert.match(C.guideInstruction(10, 350, 80).text, /^Turn left 20°/);
  assert.match(C.guideInstruction(100, 104, 20).text, /^Facing it/);
  assert.equal(C.compassPoint(0), "N");
  assert.equal(C.compassPoint(359), "N");
  assert.equal(C.compassPoint(225), "SW");
});

test("aurora chance estimate", () => {
  const grid = [[19, 70, 40], [100, 70, 90]];
  assert.equal(C.auroraChance(grid, 70, 19).chance, 40, "point at the observer");
  assert.equal(C.auroraChance(grid, 18.5, 73.9).chance, 0, "far from the oval");
  const mid = C.auroraChance(grid, 66, 19);
  assert.ok(mid.chance > 0 && mid.chance < 40, "weaker a few hundred km away");
});

test("best time tonight scoring", () => {
  const base = { sunAlt: -30, moonAlt: -10, moonFrac: 0, cloud: 0, aurora: 0 };
  assert.equal(C.scoreHour(base), 100, "dark, clear, no Moon");
  assert.equal(C.scoreHour({ ...base, sunAlt: 5 }), 0, "daytime");
  assert.equal(C.scoreHour({ ...base, cloud: 100 }), 0, "overcast");
  assert.ok(C.scoreHour({ ...base, moonAlt: 30, moonFrac: 1 }) < 60, "full Moon up lowers the score");
  const t0 = new Date("2026-10-04T12:00:00Z");
  const hours = [5, -8, -20, -25, -25, -25, -20].map((s, i) => ({
    ...base,
    t: new Date(t0.getTime() + i * 3600000),
    sunAlt: s,
    cloud: i === 3 ? 90 : 10,
  }));
  const { best } = C.bestWindow(hours);
  assert.equal(best.start.toISOString(), "2026-10-04T16:00:00.000Z", "best run starts after the cloudy hour");
  assert.equal(best.n, 3);
});

test("calendar link and formatting", () => {
  const url = C.googleCalendarUrl({
    title: "ISS pass, look NW",
    start: new Date("2026-10-04T14:05:00Z"),
    end: new Date("2026-10-04T14:11:30Z"),
    details: "From Radar Around You",
  });
  assert.ok(url.startsWith("https://calendar.google.com/calendar/render?"));
  assert.ok(url.includes("dates=20261004T140500Z%2F20261004T141130Z"), url);
  assert.ok(url.includes("text=ISS+pass%2C+look+NW"), url);
  assert.equal(C.formatDuration(30000), "under a minute");
  assert.equal(C.formatDuration(5 * 60000), "5 min");
  assert.equal(C.formatDuration(125 * 60000), "2 h 5 min");
  assert.equal(C.formatAge(3 * 3600000), "3 h ago");
});

test("fast swarm orbit model stays close to SGP4 for 48 hours", () => {
  const act = JSON.parse(fs.readFileSync(new URL("./fixtures/gp-sample.json", import.meta.url), "utf8"));
  const cases = [
    [(o) => o.NORAD_CAT_ID === 25544, 60],
    [(o) => o.OBJECT_NAME.startsWith("STARLINK"), 120],
    [(o) => o.OBJECT_NAME.includes("NAVSTAR"), 100],
    [(o) => Math.abs(o.MEAN_MOTION - 1.0027) < 0.001, 100],
    [(o) => o.ECCENTRICITY > 0.6, 300],
  ];
  for (const [find, tolKm] of cases) {
    const o = act.find(find);
    assert.ok(o, "test object exists in the catalogue");
    const rec = sat.json2satrec(o);
    const ep = Date.parse(o.EPOCH + "Z");
    const s = C.swarmElements({ epochMs: ep, nRevDay: o.MEAN_MOTION, ecc: o.ECCENTRICITY, inclDeg: o.INCLINATION, raanDeg: o.RA_OF_ASC_NODE, argpDeg: o.ARG_OF_PERICENTER, maDeg: o.MEAN_ANOMALY });
    for (let hrs = 0; hrs <= 48; hrs += 4) {
      const d = new Date(ep + hrs * 3600e3);
      const ecf = sat.eciToEcf(sat.propagate(rec, d).position, sat.gstime(d));
      const m = C.swarmPositionEcef(s, d);
      const err = Math.hypot(m.x - ecf.x, m.y - ecf.y, m.z - ecf.z);
      assert.ok(err < tolKm, `${o.OBJECT_NAME} at +${hrs} h is ${err.toFixed(0)} km from SGP4 (limit ${tolKm})`);
    }
  }
});

test("swarm look angles agree with satellite.js within half a degree", () => {
  const snap = JSON.parse(fs.readFileSync(new URL("../snapshot.json", import.meta.url), "utf8"));
  const iss = snap.satellites.find((s) => s.label === "ISS");
  const rec = sat.json2satrec(iss);
  const obs = { latitude: PUNE.lat * C.DEG, longitude: PUNE.lon * C.DEG, height: 0 };
  let checked = 0;
  for (let m = 0; m < 24 * 60; m += 2) {
    const d = new Date(Date.parse("2026-10-04T14:00:00Z") + m * 60000);
    const ecf = sat.eciToEcf(sat.propagate(rec, d).position, sat.gstime(d));
    const lib = sat.ecfToLookAngles(obs, ecf);
    if (lib.elevation / C.DEG < 5) continue;
    const mine = C.ecefLook(PUNE.lat, PUNE.lon, ecf);
    // Compare the two directions on the sky (azimuth alone is unstable near the zenith).
    const e1 = mine.el * C.DEG, a1 = mine.az * C.DEG, e2 = lib.elevation, a2 = lib.azimuth;
    const cosSep = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2);
    near(Math.acos(Math.min(1, cosSep)) / C.DEG, 0, 0.5, `sky separation at ${d.toISOString()}`);
    checked++;
  }
  assert.ok(checked > 5, "the ISS was above 5 degrees at least a few times");
});

test("packed swarm decodes to positions within 5 km of the full-precision elements", () => {
  const snap = JSON.parse(fs.readFileSync(new URL("../snapshot.json", import.meta.url), "utf8"));
  const act = JSON.parse(fs.readFileSync(new URL("./fixtures/gp-sample.json", import.meta.url), "utf8"));
  const toArr = (b64, T) => { const buf = Buffer.from(b64, "base64"); return new T(buf.buffer, buf.byteOffset, buf.byteLength / T.BYTES_PER_ELEMENT); };
  const f32 = toArr(snap.swarm.f32, Float32Array);
  const u16 = toArr(snap.swarm.u16, Uint16Array);
  const all = C.decodeSwarm(f32, u16, snap.swarm.ref);
  assert.equal(all.length, snap.swarm.count);
  const iss = all.find((s) => s.type === 4);
  const src = act.find((o) => o.NORAD_CAT_ID === 25544);
  const full = C.swarmElements({ epochMs: Date.parse(src.EPOCH + "Z"), nRevDay: src.MEAN_MOTION, ecc: src.ECCENTRICITY, inclDeg: src.INCLINATION, raanDeg: src.RA_OF_ASC_NODE, argpDeg: src.ARG_OF_PERICENTER, maDeg: src.MEAN_ANOMALY });
  for (const h of [0, 6, 24]) {
    const d = new Date(snap.swarm.ref + h * 3600e3);
    const a = C.swarmPositionEcef(iss, d);
    const b = C.swarmPositionEcef(full, d);
    near(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 0, 5, `packing error at +${h} h`);
  }
  const counts = all.reduce((m, s) => ((m[s.type] = (m[s.type] || 0) + 1), m), {});
  assert.ok(counts[1] > 10000, "Starlink satellites present");
  assert.ok(counts[3] > 2000, "debris present");
});
