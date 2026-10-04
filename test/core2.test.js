// Tests for the version 2 additions in src/core.js. Where possible the expected values come from
// independent libraries (satellite.js, astronomy-engine) or from published constants.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as A from "astronomy-engine";
import * as sat from "satellite.js";
import * as C from "../src/core.js";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected} ± ${tol}, got ${actual}`);
const snap = JSON.parse(fs.readFileSync(new URL("../snapshot.json", import.meta.url), "utf8"));
const issRec = sat.json2satrec(snap.satellites.find((s) => s.label === "ISS"));
const issEcef = (d) => sat.eciToEcf(sat.propagate(issRec, d).position, sat.gstime(d));

test("ECEF to geodetic matches satellite.js", () => {
  for (let m = 0; m < 600; m += 37) {
    const d = new Date(Date.parse("2026-10-04T14:00:00Z") + m * 60000);
    const p = sat.propagate(issRec, d).position;
    const gd = sat.eciToGeodetic(p, sat.gstime(d));
    const ecf = sat.eciToEcf(p, sat.gstime(d));
    const mine = C.ecefToGeodetic(ecf.x, ecf.y, ecf.z);
    near(mine.lat, (gd.latitude * 180) / Math.PI, 0.01, "latitude");
    near(C.norm180(mine.lon - (gd.longitude * 180) / Math.PI), 0, 0.01, "longitude");
    near(mine.hKm, gd.height, 0.05, "height");
  }
});

test("footprint radius is where the satellite sits exactly at the minimum elevation", () => {
  for (const h of [420, 550, 20200, 35786]) {
    for (const el of [0, 10, 25]) {
      const r = C.footprintRadiusKm(h, el);
      const look = C.lookAngle(0, 0, 0, r / 111.19492664455873, h);
      near(look.el, el, 0.05, `elevation at the footprint edge for h=${h} el=${el}`);
    }
  }
  assert.ok(C.footprintRadiusKm(420, 0) > 2200 && C.footprintRadiusKm(420, 0) < 2400, "ISS sees about 2,300 km");
  assert.ok(C.footprintRadiusKm(420, 10) < C.footprintRadiusKm(420, 0), "a higher minimum elevation shrinks the circle");
});

test("circle points lie at the requested distance", () => {
  for (const p of C.circlePoints(18.5, 73.9, 1665, 36)) near(C.haversineKm(18.5, 73.9, p.lat, p.lon), 1665, 0.5, "radius");
});

test("ground track of the ISS stays within its inclination and splits at the date line", () => {
  const segs = C.groundTrack(issEcef, new Date("2026-10-04T14:00:00Z"), 0, 190, 1);
  const incl = snap.satellites.find((s) => s.label === "ISS").INCLINATION;
  let n = 0;
  for (const s of segs) {
    for (let i = 0; i < s.length; i++) {
      n++;
      assert.ok(Math.abs(s[i].lat) <= incl + 0.6, `latitude ${s[i].lat} within inclination ${incl}`);
      if (i) assert.ok(Math.abs(s[i].lon - s[i - 1].lon) < 180, "no jump across the date line inside a segment");
    }
  }
  assert.equal(n, 191, "every minute is kept");
  assert.ok(segs.length >= 2, "two orbits cross the date line at least once");
  const h = segs[0][0].hKm;
  assert.ok(h > 380 && h < 450, `ISS height ${h}`);
});

test("alt/az and scene vectors convert both ways", () => {
  const n = C.altAzToVector(0, 0), e = C.altAzToVector(0, 90), up = C.altAzToVector(90, 0);
  near(n.z, -1, 1e-12, "north is -Z");
  near(e.x, 1, 1e-12, "east is +X");
  near(up.y, 1, 1e-12, "up is +Y");
  for (const [alt, az] of [[10, 20], [-5, 200], [80, 359], [45, 90]]) {
    const back = C.vectorToAltAz(C.altAzToVector(alt, az));
    near(back.alt, alt, 1e-9, "altitude round trip");
    near(C.norm180(back.az - az), 0, 1e-9, "azimuth round trip");
  }
});

test("galactic coordinates match the IAU reference points", () => {
  const gc = C.galacticToEquatorial(0, 0);
  near(gc.ra, 266.405, 0.01, "galactic centre RA");
  near(gc.dec, -28.936, 0.01, "galactic centre Dec");
  const ngp = C.galacticToEquatorial(0, 90);
  near(ngp.ra, 192.859, 0.01, "north galactic pole RA");
  near(ngp.dec, 27.128, 0.01, "north galactic pole Dec");
});

test("lit fraction of the Moon agrees with astronomy-engine", () => {
  for (const iso of ["2026-10-04T14:00:00Z", "2026-10-10T03:00:00Z", "2026-10-21T20:00:00Z", "2026-11-05T09:00:00Z", "2027-01-15T00:00:00Z"]) {
    const d = new Date(iso);
    const unit = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
    const sun = unit(A.GeoVector(A.Body.Sun, d, true));
    const moon = unit(A.GeoVector(A.Body.Moon, d, true));
    near(C.litFraction(sun, moon), A.Illumination(A.Body.Moon, d).phase_fraction, 0.01, `lit fraction ${iso}`);
  }
});

test("seismic wave geometry", () => {
  near(C.chordKm(0, 10), 10, 1e-9, "straight above the focus");
  near(C.chordKm(Math.PI * C.EARTH_RADIUS_KM, 10), 2 * C.EARTH_RADIUS_KM - 10, 1e-6, "antipode");
  let prev = -1;
  for (let d = 0; d <= 20000; d += 500) {
    const t = C.waveTravelSec(d, 30, C.P_WAVE_KM_S);
    assert.ok(t > prev, "travel time grows with distance");
    prev = t;
    near(C.waveSurfaceReachKm(t, 30, C.P_WAVE_KM_S), d, 0.2, "reach is the inverse of travel time");
  }
  assert.ok(C.waveTravelSec(1000, 30, C.S_WAVE_KM_S) > C.waveTravelSec(1000, 30, C.P_WAVE_KM_S), "S waves are slower than P waves");
  assert.equal(C.waveSurfaceReachKm(1, 30, C.P_WAVE_KM_S), 0, "nothing at the surface before the wave reaches it");
});

test("airline codes and route progress", () => {
  assert.equal(C.airlineCode("AIC101"), "AIC");
  assert.equal(C.airlineCode(" ual 12 "), "");
  assert.equal(C.airlineCode("UAL12"), "UAL");
  assert.equal(C.airlineCode("N123AB"), "");
  assert.equal(C.airlineCode(""), "");
  const del = { lat: 28.5562, lon: 77.1 }, bom = { lat: 19.0887, lon: 72.8679 };
  const mid = C.destinationPoint(del.lat, del.lon, C.bearingDeg(del.lat, del.lon, bom.lat, bom.lon), C.haversineKm(del.lat, del.lon, bom.lat, bom.lon) / 2);
  const p = C.routeProgress(mid, [del, bom]);
  near(p.fraction, 0.5, 0.01, "midpoint of a route");
  near(p.offTrackKm, 0, 0.5, "on the great circle");
  const jfk = { lat: 40.6413, lon: -73.7781 }, fco = { lat: 41.8, lon: 12.25 };
  const later = C.routeProgress({ lat: 40.9, lon: 12.0 }, [del, fco, jfk]);
  assert.equal(later.leg, 1, "a plane near Rome on a multi-leg route is on the second leg");
  assert.ok(C.routeProgress({ lat: 10, lon: 10 }, [del, bom]).offTrackKm > 1000, "far from the route is reported as off track");
});

test("search ranking and magnitude queries", () => {
  const items = [
    { id: 25544, name: "ISS (ZARYA)", kind: "sat", extra: C.SATELLITE_ALIASES[25544] },
    { id: 48274, name: "CSS (TIANHE)", kind: "sat", extra: C.SATELLITE_ALIASES[48274] },
    { id: 44713, name: "STARLINK-1008", kind: "sat" },
    { id: 44714, name: "STARLINK-1010", kind: "sat" },
    { id: 33591, name: "NOAA 19", kind: "sat" },
    { id: "us6000tzer", name: "M5.9 39 km WSW of Tambolaka, Indonesia", kind: "quake" },
    { id: "us6000tz62", name: "M5.8 165 km SSE of Vilyuchinsk, Russia", kind: "quake" },
  ];
  const s = C.buildSearch(items);
  assert.equal(s("iss")[0].id, 25544, "iss finds the station");
  assert.equal(s("international space station")[0].id, 25544, "full name alias");
  assert.equal(s("tiangong")[0].id, 48274, "Tiangong alias finds CSS");
  assert.equal(s("25544")[0].id, 25544, "NORAD number");
  assert.equal(s("starlink 1008")[0].id, 44713, "partial name with number");
  assert.equal(s("Starlink-1010")[0].id, 44714, "punctuation is ignored");
  assert.equal(s("noaa")[0].id, 33591);
  assert.equal(s("tambolaka")[0].id, "us6000tzer", "place name inside a quake title");
  assert.equal(s("kamchatka").length, 0, "no match gives no results");
  assert.equal(s("").length, 0);
  assert.equal(s("starlink").length, 2);
  assert.equal(C.parseMagnitudeQuery("m5.9"), 5.9);
  assert.equal(C.parseMagnitudeQuery("M 5.9"), 5.9);
  assert.equal(C.parseMagnitudeQuery("mag 6"), 6);
  assert.equal(C.parseMagnitudeQuery("5.8"), 5.8);
  assert.equal(C.parseMagnitudeQuery("iss"), null);
  assert.equal(C.parseMagnitudeQuery("25544"), null, "five digits are an object number, not a magnitude");
});

test("packed details and launch dates", () => {
  assert.equal(C.launchDayFromIso("1957-10-04"), 1, "Sputnik 1 launch day is day 1");
  assert.equal(C.launchDateFromDay(1).toISOString().slice(0, 10), "1957-10-04");
  const iss = C.launchDayFromIso("1998-11-20");
  assert.equal(C.launchDateFromDay(iss).toISOString().slice(0, 10), "1998-11-20");
  assert.ok(iss < 65535, "fits in 16 bits");
  assert.ok(C.launchDayFromIso("2026-10-04") < 65535);
  assert.equal(C.ageDays(C.launchDayFromIso("2026-10-01"), Date.parse("2026-10-04T12:00:00Z")), 3);
  assert.equal(C.launchDayFromIso("not a date"), 0);
  const buf = new Uint8Array(16);
  const v = new DataView(buf.buffer);
  v.setUint8(8, 7); v.setUint8(9, 3); v.setUint8(10, 5); v.setUint8(11, 2); v.setUint16(12, 12345, true); v.setUint8(14, 1);
  assert.deepEqual(C.unpackDetails(buf, 1), { owner: 7, site: 3, purpose: 5, type: 2, launchDay: 12345, status: 1 });
});

// ---------------------------------------------------------------- part 2
test("fast swarm position equals the reference position", () => {
  const rec = C.swarmElements({ epochMs: Date.parse("2026-10-04T12:00:00Z"), nRevDay: 15.5, ecc: 0.0004, inclDeg: 51.6, raanDeg: 120, argpDeg: 60, maDeg: 10 });
  for (const iso of ["2026-10-04T12:00:00Z", "2026-10-04T18:30:00Z", "2026-10-05T03:00:00Z"]) {
    const d = new Date(iso);
    const a = C.swarmPositionEcef(rec, d);
    const b = C.swarmPositionFast(rec, d.getTime(), C.gmstDeg(d) * C.DEG);
    near(b.x, a.x, 1e-6, "x"); near(b.y, a.y, 1e-6, "y"); near(b.z, a.z, 1e-6, "z");
  }
});

test("inertial radius equals the semi-major axis for a circular orbit", () => {
  const rec = C.swarmElements({ epochMs: 0, nRevDay: 15.5, ecc: 0, inclDeg: 53, raanDeg: 10, argpDeg: 0, maDeg: 0 });
  const p = C.swarmPositionEci(rec, 3_600_000);
  near(Math.hypot(p.x, p.y, p.z), rec.a, 1e-6, "radius");
});

test("scene unit vectors for places", () => {
  const eq0 = C.latLonToUnit(0, 0), n = C.latLonToUnit(90, 0), e90 = C.latLonToUnit(0, 90);
  near(eq0.x, 1, 1e-12, "lon 0 along +X"); near(n.y, 1, 1e-12, "north along +Y"); near(e90.z, -1, 1e-12, "90E along -Z");
  const u = C.latLonToUnit(18.52, 73.86);
  near(Math.hypot(u.x, u.y, u.z), 1, 1e-12, "unit length");
});

test("slice plane frame is orthonormal and contains both points", () => {
  const cases = [[-9.57, 118.91, 18.52, 73.86], [40, -100, 51.5, -0.1], [0, 0, 0, 180], [10, 20, 10, 20], [89.9, 0, 10, 10]];
  for (const [qa, qo, ua, uo] of cases) {
    const b = C.sliceBasis(qa, qo, ua, uo);
    const dot = (p, q) => p.x * q.x + p.y * q.y + p.z * q.z;
    near(dot(b.x, b.x), 1, 1e-9, "x unit"); near(dot(b.y, b.y), 1, 1e-9, "y unit"); near(dot(b.n, b.n), 1, 1e-9, "n unit");
    near(dot(b.x, b.y), 0, 1e-9, "x perpendicular y"); near(dot(b.n, b.x), 0, 1e-9, "n perpendicular x");
    const u = C.latLonToUnit(ua, uo);
    near(dot(u, b.n), 0, 1e-9, "viewer lies in the plane");
    assert.ok(dot(u, b.y) >= -1e-9, "viewer is on the +y side");
    near(b.theta * C.EARTH_RADIUS_KM, C.haversineKm(qa, qo, ua, uo), 1e-3, "central angle matches the great-circle distance");
  }
});

test("launch site table is sane and matches the packed site codes", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../public/meta.json", import.meta.url), "utf8"));
  for (const [code, [lat, lon]] of Object.entries(C.LAUNCH_SITES)) {
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${code} coordinates in range`);
    assert.ok(meta.siteCodes.includes(code), `${code} is a code used in the data`);
  }
  near(C.LAUNCH_SITES.TYMSC[0], 46, 1, "Baikonur latitude is about 46 N");
  near(C.LAUNCH_SITES.FRGUI[0], 5, 1, "Kourou is near 5 N");
  assert.ok(C.LAUNCH_SITES.AFETR[1] < -79 && C.LAUNCH_SITES.AFETR[1] > -82, "Cape Canaveral longitude");
});

test("packed public data decodes to what CelesTrak says about the ISS", () => {
  const dir = new URL("../public/", import.meta.url);
  const meta = JSON.parse(fs.readFileSync(new URL("meta.json", dir), "utf8"));
  const ids = new Uint32Array(fs.readFileSync(new URL("ids.bin", dir)).buffer.slice(0));
  const idsBuf = fs.readFileSync(new URL("ids.bin", dir));
  const idArr = new Uint32Array(idsBuf.buffer.slice(idsBuf.byteOffset, idsBuf.byteOffset + idsBuf.byteLength));
  const names = fs.readFileSync(new URL("names.txt", dir), "utf8").split("\n");
  const det = new Uint8Array(fs.readFileSync(new URL("details.bin", dir)));
  assert.equal(idArr.length, meta.count); assert.equal(names.length, meta.count); assert.equal(det.length, meta.count * 8);
  assert.equal(ids.length, meta.count);
  const i = idArr.indexOf(25544);
  assert.ok(i >= 0, "ISS is in the catalogue");
  assert.match(names[i], /ISS/);
  const d = C.unpackDetails(det, i);
  assert.equal(C.tableName(meta.ownerCodes, d.owner), "ISS", "owner is the International Space Station programme");
  assert.equal(C.tableName(meta.owners, d.owner), "International Space Station");
  assert.equal(C.tableName(meta.owners, 0), null, "zero means not known");
  assert.equal(C.tableName(meta.siteCodes, d.site), "TYMSC", "launched from Baikonur (Tyuratam)");
  assert.equal(C.launchDateFromDay(d.launchDay).toISOString().slice(0, 10), "1998-11-20");
  assert.equal(meta.purposes[d.purpose], "Space station");
});

test("swarm file layout decodes with the loader", async () => {
  const { decodeSwarmFile, decodeStars, decodeCoast } = await import("../src/data.js");
  const dir = new URL("../public/", import.meta.url);
  const meta = JSON.parse(fs.readFileSync(new URL("meta.json", dir), "utf8"));
  const b = fs.readFileSync(new URL("swarm.bin", dir));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const { f32, u16 } = decodeSwarmFile(ab, meta.count);
  const sw = C.decodeSwarm(f32, u16, meta.ref);
  assert.equal(sw.length, meta.count);
  // every object has a physically possible orbit. A few science missions (Chandra, XMM-Newton, MMS, TESS, SMILE)
  // are on very long ellipses, so the upper bound is generous.
  let bad = 0;
  for (const s of sw) if (!(s.a > 6500 && s.a < 400000 && s.e >= 0 && s.e < 1)) bad++;
  assert.equal(bad, 0, `unreasonable orbits: ${bad}`);
  assert.ok(sw.filter((s) => s.a > 55000).length < 20, "only a handful of very high orbits");
  const sb = fs.readFileSync(new URL("stars.bin", dir));
  const stars = decodeStars(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength));
  assert.equal(stars.n, meta.starCount);
  const sirius = stars.mag.indexOf(Math.min(...stars.mag));
  near(stars.mag[sirius], -1.46, 0.05, "brightest star is Sirius at about magnitude -1.46");
  near(stars.dec[sirius], -16.7, 0.2, "Sirius declination");
  const cb = fs.readFileSync(new URL("coast.bin", dir));
  const coast = decodeCoast(cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength));
  assert.ok(coast.length > 500 && coast.every((l) => l.length > 1), "coastline lines");
});

// ---------------------------------------------------------------- sky frame
test("star sphere basis maps stars to the same alt/az as the reference formula", () => {
  const places = [[18.52, 73.86], [51.5, -0.12], [-33.9, 151.2], [69.65, 18.96], [0, 0]];
  const dates = ["2026-10-04T14:00:00Z", "2026-12-21T03:30:00Z", "2027-03-02T22:10:00Z"];
  const stars = [[101.287, -16.716], [213.915, 19.182], [37.95, 89.26], [279.234, 38.784], [10, -80], [350, 0.5]];
  for (const [lat, lon] of places) for (const iso of dates) {
    const d = new Date(iso);
    const b = C.equatorialToHorizonBasis(lat, lon, d);
    const dot = (p, q) => p.x * q.x + p.y * q.y + p.z * q.z;
    near(dot(b.x, b.y), 0, 1e-9, "orthogonal"); near(dot(b.x, b.z), 0, 1e-9, "orthogonal"); near(dot(b.y, b.z), 0, 1e-9, "orthogonal");
    const cross = { x: b.x.y * b.y.z - b.x.z * b.y.y, y: b.x.z * b.y.x - b.x.x * b.y.z, z: b.x.x * b.y.y - b.x.y * b.y.x };
    near(dot(cross, b.z), 1, 1e-9, "right handed (a proper rotation)");
    for (const [ra, dec] of stars) {
      const v = C.applyBasis(b, ra, dec);
      const ref = C.altAzToVector(...Object.values(C.raDecToAltAz(ra, dec, lat, lon, d)).slice(0, 2));
      near(dot(v, ref), 1, 1e-9, `star ${ra},${dec} at ${lat},${lon} ${iso}`);
    }
  }
});

test("celestial pole sits at an altitude equal to the latitude", () => {
  for (const lat of [18.5, 51.5, -33.9, 69.6]) {
    const b = C.equatorialToHorizonBasis(lat, 10, new Date("2026-10-04T14:00:00Z"));
    near(C.vectorToAltAz(b.y).alt, lat, 0.05, `pole altitude at ${lat}`);
  }
});

test("sky colours go from day to night as the Sun sets", () => {
  const day = C.skyColors(40), dusk = C.skyColors(-6), night = C.skyColors(-30);
  assert.ok(day.zenith[2] > 0.6 && day.zenith[0] < 0.3, "day zenith is blue");
  assert.ok(night.zenith.every((v) => v < 0.03), "night zenith is nearly black");
  assert.ok(dusk.horizon[0] > dusk.horizon[2] - 0.05, "dusk horizon is warm");
  for (let a = -30; a < 40; a += 0.5) { const c = C.skyColors(a); assert.ok(c.zenith.every((v) => v >= 0 && v <= 1)); }
  const a = C.skyColors(-20), b = C.skyColors(-18);
  assert.deepEqual(a.zenith, b.zenith, "darkest keyframe is held below -18 degrees");
});

test("limiting magnitude falls with twilight and light pollution", () => {
  assert.ok(C.limitingMagnitude(30) < 1.5, "bright day shows almost nothing");
  near(C.limitingMagnitude(-25, 0, 0), 6.5, 0.01, "dark country sky shows 6.5");
  assert.ok(C.limitingMagnitude(-25, 1, 0) < C.limitingMagnitude(-25, 0, 0), "city lights remove stars");
  assert.ok(C.limitingMagnitude(-25, 0, 1) < C.limitingMagnitude(-25, 0, 0), "bright Moon removes stars");
  assert.ok(C.limitingMagnitude(-10) < C.limitingMagnitude(-18), "stars come out through twilight");
  assert.ok(C.limitingMagnitude(-25, 1, 1) >= 0);
});

// ---------------------------------------------------------------- swarm look and aurora grid
test("swarm look angle reports sunlit consistently with the shadow test", () => {
  const s = C.swarmElements({ epochMs: Date.parse("2026-10-04T12:00:00Z"), nRevDay: 15.5, ecc: 0.0004, inclDeg: 51.6, raanDeg: 120, argpDeg: 60, maDeg: 10 });
  let lit = 0, dark = 0;
  for (let m = 0; m < 24 * 60; m += 7) {
    const d = new Date(Date.parse("2026-10-04T12:00:00Z") + m * 60000);
    const look = C.swarmLook(s, d, 18.52, 73.86);
    assert.equal(look.sunlit, C.isSunlit(C.swarmPositionEci(s, d.getTime()), C.sunUnitVectorEci(d)));
    assert.ok(look.el >= -90 && look.el <= 90 && look.az >= 0 && look.az < 360);
    assert.ok(look.rangeKm > 300 && look.rangeKm < 14000, `range ${look.rangeKm}`);
    look.sunlit ? lit++ : dark++;
  }
  assert.ok(lit > 0 && dark > 0, "an ISS-like orbit spends time both in sunlight and in shadow");
});

test("aurora grid lookup", () => {
  const grid = new Uint8Array(360 * 181);
  const put = (lat, lon, p) => { grid[(lat + 90) * 360 + ((lon % 360) + 360) % 360] = p; };
  put(67, 20, 80);       // an oval point near Tromso
  put(40, -100, 10);
  const here = C.auroraFromGrid(grid, 67, 20, 900);
  assert.equal(here.chance, Math.round(80 * (1 - 0 / 1125)));
  assert.equal(here.here, 80);
  const near500 = C.auroraFromGrid(grid, 62.5, 20, 900);
  assert.ok(near500.chance > 0 && near500.chance < 80, `reduced with distance: ${near500.chance}`);
  assert.equal(near500.at.lat, 67);
  assert.equal(C.auroraFromGrid(grid, 18.5, 73.9, 900).chance, 0, "nothing near Pune");
  assert.equal(C.auroraFromGrid(grid, 18.5, 73.9, 900).at, null);
  const wrap = new Uint8Array(360 * 181); wrap[(70 + 90) * 360 + 359] = 60;
  assert.ok(C.auroraFromGrid(wrap, 70, 1, 900).chance > 0, "wraps around longitude 0/359");
  assert.ok(C.auroraFromGrid(wrap, 70, -179, 900).chance === 0, "far side finds nothing");
});

test("base64 loader reproduces the binary files exactly", async () => {
  const { decodeBase64 } = await import("../src/data.js");
  for (const f of ["swarm.bin", "details.bin", "ids.bin", "stars.bin", "aurora.bin", "coast.bin"]) {
    const raw = fs.readFileSync(new URL(`../public/${f}`, import.meta.url));
    const back = new Uint8Array(decodeBase64(raw.toString("base64") + "\n"));
    assert.equal(back.length, raw.length, f);
    assert.ok(Buffer.from(back).equals(raw), `${f} survives a base64 round trip`);
  }
});
