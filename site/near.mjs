// "Satellites near me": which satellites' ground points (the point on the Earth straight below them) come within a chosen distance of a
// place, now and in the next 24 hours. Pure functions, no DOM and no file access: the site build uses them for the build-time example and
// the expected count, the page's browser bundle (site/near-calc.mjs) runs the same code in a Web Worker, and the tests run it in node.
//
// The orbit model is the app's precise one: SGP4 from satellite.js (src/sgp4.js uses the same library). Satellites listed in the feed's
// precise.json get their full element sets (with the drag terms), as the app's pass predictions do. Every other satellite is propagated
// with SGP4 from its mean elements as the swarm file carries them (swarm.bin has no drag terms, so they are zero). The app's faster swarm
// model (src/core.js swarmPositionEcef) is not used for the answers: measured against full SGP4 it is off by 62 km at the 95th percentile
// one day after the data time, too coarse for a 100 km question (docs/satellites-near-me-sources.md, test/near-accuracy.test.js).
import { json2satrec, sgp4, gstime } from "satellite.js";
import { DEG, EARTH_RADIUS_KM, haversineKm, ecefToGeodetic, ecefLook, isSunlit, sunUnitVectorEci, unpackDetails, swarmFromRad, SWARM_EARTH_RADIUS_KM } from "../src/core.js";
import { rowToOmm } from "../src/sgp4.js";
import { runSteps } from "../src/schedule.js";
import { orbitClass, ACTIVE_STATUSES } from "./satcount.mjs";
import { DEFAULT_RADIUS_KM, WINDOW_HOURS, STALE_HOURS, TABLE_CAP } from "./near-ui.mjs";

export { NEAR_FILE, RADII_KM, DEFAULT_RADIUS_KM, WINDOW_HOURS, STALE_HOURS, TABLE_CAP, capFraction, capAreaKm2, EARTH_AREA_KM2, expectedAtOnce } from "./near-ui.mjs";
const ACTIVE = new Set(ACTIVE_STATUSES);

// ---------- Uncertainty ----------

// The 95th percentile of the ground distance between our calculation (SGP4 from the swarm's mean elements, no drag terms) and full SGP4 from
// the same CelesTrak element sets, by height band and hours since the element set's epoch. Measured on 16,689 element sets of CelesTrak's
// active list downloaded on 2026-10-07 (docs/satellites-near-me-sources.md); test/near-accuracy.test.js checks a committed sample against
// these numbers. Rounded up to whole km, at least 1 km, and never falling with time. Between the hours the value is interpolated.
export const U_HOURS = [0, 6, 12, 24, 36, 48, 72, 96];
export const U_TABLE = {
  "low-under-450": [1, 17, 66, 259, 580, 997, 2107, 3873],
  "low-450-600": [1, 1, 3, 11, 24, 42, 95, 168],
  "low-600-1000": [1, 1, 1, 2, 3, 5, 10, 18],
  "low-1000-2000": [1, 1, 1, 1, 1, 1, 2, 4],
  medium: [1, 1, 1, 1, 1, 1, 1, 1],
  geostationary: [1, 1, 1, 1, 1, 1, 1, 1],
  highElliptical: [1, 1, 1, 1, 2, 2, 2, 4],
  beyond: [1, 1, 1, 1, 1, 1, 1, 1],
};
// The measurement behind U_TABLE and the page's statements (tools/near-accuracy.mjs on the whole download): kept here so the page prints
// the same figures the sources document records, and a test checks the committed sample still agrees.
export const ACCURACY = {
  downloadedAt: "2026-10-07T04:38:29Z", sets: 16689,
  // ground distance between the model and full SGP4, km, from the data time (every set at its real age)
  fromData: {
    app: { 0: [7.85, 14.4, 1308], 6: [7.87, 18.9, 1003], 24: [9.06, 62.0, 4989] },
    page: { 0: [0.43, 7.4, 851], 6: [0.69, 15.0, 1014], 24: [2.44, 59.6, 4996] },
    pageFrom450: { 24: [1.94, 26.7, 3176] },
  },
  // the second check: the published data of 2026-10-05 08:14 UTC propagated to the epochs of the 2026-10-07 element sets, 36 to 48 hours ahead
  ahead: { taken: "2026-10-05T08:14:54Z", all: [10456, 9.5, 127], "low-450-600": [7349, 12.2, 48], "low-600-1000": [830, 0.8, 18], "low-under-450": [963, 57, 1335] },
};
export const U_BAND_LABELS = {
  "low-under-450": "below 450 km", "low-450-600": "450 to 600 km", "low-600-1000": "600 to 1,000 km", "low-1000-2000": "1,000 to 2,000 km",
  medium: "medium Earth orbit", geostationary: "geostationary belt", highElliptical: "high elliptical", beyond: "beyond the geostationary belt",
};

export function uncertaintyBand(nRadPerMin, ecc) {
  const cls = orbitClass(nRadPerMin, ecc);
  if (cls !== "low") return cls;
  const alt = swarmFromRad(0, nRadPerMin, 0, 0, 0, 0, 0).a - SWARM_EARTH_RADIUS_KM;
  return alt < 450 ? "low-under-450" : alt < 600 ? "low-450-600" : alt < 1000 ? "low-600-1000" : "low-1000-2000";
}

export function uncertaintyKm(band, hoursSinceEpoch) {
  const row = U_TABLE[band] || U_TABLE["low-under-450"];
  const h = Math.max(0, hoursSinceEpoch);
  if (h >= U_HOURS[U_HOURS.length - 1]) return row[row.length - 1];
  let k = 0;
  while (U_HOURS[k + 1] < h) k++;
  const f = (h - U_HOURS[k]) / (U_HOURS[k + 1] - U_HOURS[k]);
  return row[k] + f * (row[k + 1] - row[k]);
}

// within: the central estimate is inside the radius. borderline: outside it by less than the uncertainty. uncertain: inside it, but the
// uncertainty is as large as the radius itself, so the answer could be anything; those are counted, not listed. null: not near.
export function classify(distKm, uKm, radiusKm) {
  if (uKm >= radiusKm) return distKm <= radiusKm ? "uncertain" : null;
  if (distKm <= radiusKm) return "within";
  return distKm <= radiusKm + uKm ? "borderline" : null;
}

// ---------- The feed ----------

const toU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const aligned = (b) => { const u = toU8(b); return u.byteOffset % 4 === 0 ? u.buffer : u.slice().buffer; };

// The feed's files as the browser downloads them: meta (meta.json merged with satmeta.json), swarm.bin, ids.bin, details.bin, names.txt
// and precise.json (null when absent). Checks the lengths the way site/satcount.mjs does.
export function decodeFeed({ meta, swarm, ids, details, names, precise = null }) {
  const count = meta.count;
  const sw = toU8(swarm), idb = toU8(ids), det = toU8(details);
  if (!(count > 0)) throw new Error("near: the feed has no objects");
  if (sw.length !== count * 20) throw new Error(`near: swarm.bin has ${sw.length} bytes, expected ${count * 20}`);
  if (idb.length !== count * 4) throw new Error(`near: ids.bin has ${idb.length} bytes, expected ${count * 4}`);
  if (det.length !== count * 8) throw new Error(`near: details.bin has ${det.length} bytes, expected ${count * 8}`);
  const nameList = names == null ? [] : Array.isArray(names) ? names : String(names).split("\n");
  if (names != null && nameList.length !== count) throw new Error(`near: names.txt has ${nameList.length} lines, expected ${count}`);
  const ab = aligned(sw);
  const pmap = new Map();
  if (precise && Array.isArray(precise.cols) && Array.isArray(precise.rows)) for (const row of precise.rows) pmap.set(row[0], row);
  return { meta, count, f32: new Float32Array(ab, 0, count * 2), u16: new Uint16Array(ab, count * 8, count * 6), ids: new Uint32Array(aligned(idb), 0, count), details: det, names: nameList, precise: pmap, preciseCols: precise ? precise.cols : null };
}

const isoNoZ = (ms) => new Date(ms).toISOString().replace("Z", "");
// The swarm's mean elements as the record json2satrec reads, with the drag terms at zero (swarm.bin does not carry them). The inverse of the
// packing in pipeline/pack.py: angles were stored as fractions of a turn (inclination of half a turn) in 16 bits.
export function swarmOmm(f32, u16, k, refMs, noradId) {
  const b = 6 * k;
  return {
    OBJECT_NAME: String(noradId), OBJECT_ID: "0000-000A", EPOCH: isoNoZ(refMs + f32[2 * k] * 60000), MEAN_MOTION: (f32[2 * k + 1] * 1440) / (2 * Math.PI),
    ECCENTRICITY: u16[b] / 65535, INCLINATION: (u16[b + 1] / 65535) * 180, RA_OF_ASC_NODE: (u16[b + 2] / 65535) * 360,
    ARG_OF_PERICENTER: (u16[b + 3] / 65535) * 360, MEAN_ANOMALY: (u16[b + 4] / 65535) * 360, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U",
    NORAD_CAT_ID: noradId, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  };
}

const epochMsOf = (rec) => (rec.jdsatepoch - 2440587.5) * 86400000;

// The satellites the page works with: active payloads (the count page's definition), each with its SGP4 record. Element sets older than
// STALE_HOURS at `atMs`, and records SGP4 refuses, are counted and left out. Geostationary-belt satellites are kept apart (their ground
// point hardly moves, so they have no "passes"); the page lists them separately when they are near.
export function prepareSatellites(feed, atMs, opts = {}) {
  return runSteps(prepareSatellitesSteps(feed, atMs, opts));
}
// The same as a generator that pauses after every 500 objects, so the page's main-thread fallback can spread it over several tasks.
export function* prepareSatellitesSteps(feed, atMs, { staleHours = STALE_HOURS } = {}) {
  const { meta, count, f32, u16, ids, details, names, precise, preciseCols } = feed;
  const sats = [], geo = [];
  const counts = { active: 0, stale: 0, refused: 0, exact: 0, geostationary: 0, used: 0 };
  for (let k = 0; k < count; k++) {
    if (k % 500 === 499) yield { done: k, total: count };
    // the record layout of src/core.js unpackDetails, read in place: type at byte 3, status at byte 6
    if (details[8 * k + 3] !== 0 || !ACTIVE.has(details[8 * k + 6])) continue;
    const d = unpackDetails(details, k);
    counts.active++;
    const id = ids[k];
    const row = precise.get(id);
    // the swarm's epoch is checked before SGP4 is set up (precise.json rows share the element set, and so the epoch, of the swarm)
    if (!row && (atMs - (meta.ref + f32[2 * k] * 60000)) / 3600000 > staleHours) { counts.stale++; continue; }
    let rec = null;
    try { rec = json2satrec(row ? rowToOmm(preciseCols, row) : swarmOmm(f32, u16, k, meta.ref, id)); } catch { rec = null; }
    if (!rec || rec.error) { counts.refused++; continue; }
    const epochMs = epochMsOf(rec);
    if ((atMs - epochMs) / 3600000 > staleHours) { counts.stale++; continue; }
    const n = f32[2 * k + 1], e = u16[6 * k] / 65535;
    const orbit = orbitClass(n, e);
    const sat = {
      k, id, name: (names[k] || "").trim() || `NORAD ${id}`, owner: d.owner ? meta.owners[d.owner - 1] || null : null,
      purpose: meta.purposes ? meta.purposes[d.purpose] || "Unspecified" : "Unspecified", launchDay: d.launchDay,
      orbit, band: uncertaintyBand(n, e), starlink: u16[6 * k + 5] === 1, exact: !!row, rec, epochMs,
    };
    if (row) counts.exact++;
    if (orbit === "geostationary") { counts.geostationary++; geo.push(sat); } else sats.push(sat);
  }
  counts.used = sats.length + geo.length;
  return { sats, geo, counts };
}

// ---------- Positions ----------

// GMST advances at this rate (radians per millisecond); within one day a straight line from the start time matches satellite.js's gstime to
// far better than a metre at the ground. Used only inside the search; the reported values use gstime itself.
const EARTH_RATE_MS = 7.2921158553e-5 / 1000;
const MIN_PER_MS = 1 / 60000;

// Earth-fixed position and velocity (km, km/s, TEME rotated by GMST, as src/sgp4.js ecefAt does) at tMs, or null when SGP4 fails.
export function stateAt(sat, tMs, gmst = gstime(new Date(tMs))) {
  const r = sgp4(sat.rec, (tMs - sat.epochMs) * MIN_PER_MS);
  if (!r || !r.position || !Number.isFinite(r.position.x)) return null;
  const p = r.position, c = Math.cos(gmst), s = Math.sin(gmst);
  return { eci: p, vel: r.velocity, ecef: { x: p.x * c + p.y * s, y: -p.x * s + p.y * c, z: p.z } };
}

// Ground distance (km) between a place and the point below the satellite: geodetic latitude and longitude of the sub-satellite point
// (src/core.js ecefToGeodetic), then the great-circle distance on the app's sphere (haversineKm). This is the page's one distance rule.
export function groundDistanceKm(place, ecef) {
  const g = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
  return { km: haversineKm(place.lat, place.lon, g.lat, g.lon), lat: g.lat, lon: g.lon, hKm: g.hKm };
}

// Everything the table shows about one moment.
export function describeAt(sat, place, tMs) {
  const date = new Date(tMs);
  const st = stateAt(sat, tMs);
  if (!st) return null;
  const g = groundDistanceKm(place, st.ecef);
  const look = ecefLook(place.lat, place.lon, st.ecef);
  const ageH = (tMs - sat.epochMs) / 3600000;
  return {
    t: tMs, km: g.km, lat: g.lat, lon: g.lon, hKm: g.hKm, el: look.el, az: look.az, lit: isSunlit(st.eci, sunUnitVectorEci(date)),
    kms: Math.hypot(st.vel.x, st.vel.y, st.vel.z), ageH, u: sat.exact ? 0 : uncertaintyKm(sat.band, ageH),
  };
}

// ---------- The search ----------

// OURS: margins of the cheap tests, in radians of arc on the ground. The search compares geocentric directions; the reported distance uses
// geodetic latitude, which differs by at most about 0.19 degrees (SEARCH_MARGIN covers it). The orbit-plane test uses the plane's mean
// inclination and node; SGP4's short-period terms move the real plane by far less than PLANE_MARGIN.
const SEARCH_MARGIN = 0.3 * DEG;
const PLANE_MARGIN = 0.6 * DEG;

export function placeVector(place) {
  const la = place.lat * DEG, lo = place.lon * DEG;
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
}

// Upper bound of how fast (radians per millisecond) the direction to the satellite can turn relative to the rotating Earth: the fastest
// angular rate on the orbit (at perigee) plus the Earth's rotation, with 10 percent to spare for the perturbations (SGP4's short-period
// terms change the rate by a fraction of a percent).
function maxRate(rec) {
  const n = rec.no / 60000, e = Math.min(0.99, rec.ecco);
  return 1.1 * (n * (1 + e) ** 2 / (1 - e * e) ** 1.5 + EARTH_RATE_MS);
}

// Time windows within [t0, t1] when the place's direction is within angle `ang` of the satellite's orbit plane. The ground point can only be
// near the place then. The plane turns slowly (the node's drift, rec.nodedot) while the Earth turns under it, so the place's height above
// the plane, sin(lat) cos(i) - cos(lat) sin(i) sin(x), is a sine of x = lon + GMST - node, which grows linearly with time.
export function planeWindows(rec, P, t0, t1, ang, gmst0) {
  if (rec.method === "d") return [[t0, t1]];  // deep-space orbits: no shortcut (few objects, and their planes move with the Sun and Moon)
  const s = Math.sin(Math.min(Math.PI / 2, ang));
  const sinLat = P.z, cosLat = Math.hypot(P.x, P.y);
  const A = sinLat * Math.cos(rec.inclo), B = cosLat * Math.sin(rec.inclo);
  if (B < 1e-9) return Math.abs(A) <= s ? [[t0, t1]] : [];
  const lo = (A - s) / B, hi = (A + s) / B;
  if (lo > 1 || hi < -1) return [];
  if (lo <= -1 && hi >= 1) return [[t0, t1]];
  const arcs = [];
  if (lo > -1 && hi >= 1) arcs.push([Math.asin(lo), Math.PI - Math.asin(lo)]);
  else if (lo <= -1 && hi < 1) arcs.push([Math.PI - Math.asin(hi), 2 * Math.PI + Math.asin(hi)]);
  else { arcs.push([Math.asin(lo), Math.asin(hi)]); arcs.push([Math.PI - Math.asin(hi), Math.PI - Math.asin(lo)]); }
  const epochMs = epochMsOf(rec);
  const node0 = rec.nodeo + rec.nodedot * (t0 - epochMs) * MIN_PER_MS;
  const rate = EARTH_RATE_MS - rec.nodedot * MIN_PER_MS;
  const x0 = Math.atan2(P.y, P.x) + gmst0 - node0;
  const out = [];
  const T = 2 * Math.PI;
  for (const [xa, xb] of arcs) {
    for (let m = Math.floor((x0 - xb) / T); ; m++) {
      const ta = t0 + (xa + m * T - x0) / rate, tb = t0 + (xb + m * T - x0) / rate;
      if (ta > t1) break;
      if (tb >= t0) out.push([Math.max(t0, ta), Math.min(t1, tb)]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Golden-section search for the time of the smallest value of f in [a, b] (f unimodal there).
export function goldenMinimum(f, a, b, tolMs = 200) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let k = 0; k < 60 && b - a > tolMs; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return fc < fd ? c : d;
}

// The time of the minimum of a parabola through (t - h, fa), (t, fb), (t + h, fc), or null when the three points do not bracket one.
// Near a closest approach the squared angle between the place and the ground point is very nearly a parabola in time (exactly one for a
// straight track at constant speed), so two fits land within a fraction of a second of the minimum.
export function parabolaMinimum(t, h, fa, fb, fc) {
  const den = fa - 2 * fb + fc;
  if (!(den > 0)) return null;
  const off = (h * (fa - fc)) / (2 * den);
  return Math.abs(off) <= h ? t + off : null;
}

// The closest approaches of one satellite's ground point to the place within [t0, t1] that come within `searchKm` (central estimate).
// Returns { t, km } for each minimum, strictly inside the window (a minimum at the window's edge belongs to "right now" or to the next
// day, not to this list).
export function closestApproaches(sat, place, t0, t1, searchKm, { P = placeVector(place), gmst0 = gstime(new Date(t0)) } = {}) {
  const theta = searchKm / EARTH_RADIUS_KM + SEARCH_MARGIN;
  const cosTheta = Math.cos(theta);
  const wMax = maxRate(sat.rec);
  const periodMs = (2 * Math.PI) / (sat.rec.no / 60000);
  const stepIn = Math.max(1000, Math.min(10000, periodMs / 500, (theta / wMax) / 2));
  const angleAt = (t) => {
    const st = stateAt(sat, t, gmst0 + EARTH_RATE_MS * (t - t0));
    if (!st) return NaN;
    const p = st.ecef, r = Math.hypot(p.x, p.y, p.z);
    return Math.acos(Math.max(-1, Math.min(1, (p.x * P.x + p.y * P.y + p.z * P.z) / r)));
  };
  const sq = (t) => { const a = angleAt(t); return a * a; };
  const km2 = (t) => { const st = stateAt(sat, t); if (!st) return Infinity; const k = groundDistanceKm(place, st.ecef).km; return k * k; };
  const found = [];
  // the minimum lies within one inner step of the best sample (the step before entering the zone cannot have jumped over its start).
  // Two parabola fits on the squared angle find the geocentric minimum; the geodetic ground point sits up to about 20 km from the
  // geocentric direction, which moves the minimum of the reported distance by a few seconds, so two more fits on the squared distance itself
  // (golden-section where a fit fails) give the time the table reports.
  const fit = (f, t, halfWidths, tol) => {
    for (const h of halfWidths) {
      const tm = parabolaMinimum(t, h, f(t - h), f(t), f(t + h));
      if (tm === null) return goldenMinimum(f, t - h, t + h, tol);
      t = tm;
    }
    return t;
  };
  const finish = (bestT) => {
    let t = fit(sq, bestT, [stepIn, Math.max(500, stepIn / 10)], 200);
    t = fit(km2, t, [8000, 800], 100);
    if (t - t0 < 1000 || t1 - t < 1000) return;  // at an edge of the window
    const d2 = km2(t);
    if (d2 <= searchKm * searchKm) found.push({ t, km: Math.sqrt(d2) });
  };
  for (const [wa, wb] of planeWindows(sat.rec, P, t0, t1, theta + PLANE_MARGIN, gmst0)) {
    let t = wa, best = null;
    while (t <= wb) {
      const ang = angleAt(t);
      if (!(ang >= 0)) return found;  // SGP4 gave up (decay): nothing more for this satellite
      if (ang <= theta) {
        if (!best || ang < best.ang) best = { t, ang };
        t += stepIn;
      } else {
        if (best) { finish(best.t); best = null; }
        t += Math.max(500, (ang - theta) / wMax);
      }
    }
    if (best) finish(best.t);
  }
  // two windows can share one approach near their joint; keep the first of minima closer than a minute apart
  return found.sort((a, b) => a.t - b.t).filter((m, i, a) => i === 0 || m.t - a[i - 1].t > 60000);
}

// The search over every prepared satellite, as a generator that yields after each satellite so the caller can report progress and give
// the browser a turn (site/near-calc.mjs). Returns { now, passes, geo, counts }.
//   now: satellites whose ground point is near the place at startMs (within, borderline or uncertain), nearest first
//   passes: closest approaches in (startMs, startMs + hours) that are within or borderline, by time
//   geo: geostationary-belt satellites near the place at some time in the window
//   counts: uncertain (inside the radius but too uncertain to list), plus the counts of prepareSatellites
export function* searchNear(prepared, place, { startMs, hours = WINDOW_HOURS, radiusKm = DEFAULT_RADIUS_KM }) {
  const t0 = startMs, t1 = startMs + hours * 3600000;
  const P = placeVector(place), gmst0 = gstime(new Date(t0));
  const now = [], passes = [], geo = [];
  let uncertainPasses = 0, uncertainNow = 0;
  const total = prepared.sats.length + prepared.geo.length;
  let done = 0;
  const cosNear = Math.cos((2 * radiusKm) / EARTH_RADIUS_KM + SEARCH_MARGIN);
  for (const sat of prepared.sats) {
    // right now: a cheap direction test first, the full description only for the few that pass it
    const st0 = stateAt(sat, t0, gmst0);
    if (st0) {
      const p = st0.ecef, r = Math.hypot(p.x, p.y, p.z);
      if ((p.x * P.x + p.y * P.y + p.z * P.z) / r >= cosNear) {
        const here = describeAt(sat, place, t0);
        const st = here && classify(here.km, here.u, radiusKm);
        if (st === "uncertain") uncertainNow++;
        else if (st) now.push({ sat, ...here, status: st });
      }
    }
    // search out to the radius plus the largest uncertainty a listed pass can have (less than the radius), so borderline passes are found
    const uEnd = sat.exact ? 0 : uncertaintyKm(sat.band, (t1 - sat.epochMs) / 3600000);
    for (const m of closestApproaches(sat, place, t0, t1, radiusKm + Math.min(uEnd, radiusKm), { P, gmst0 })) {
      const u = sat.exact ? 0 : uncertaintyKm(sat.band, (m.t - sat.epochMs) / 3600000);
      const st = classify(m.km, u, radiusKm);
      if (st === "uncertain") uncertainPasses++;
      else if (st) passes.push({ sat, t: m.t, km: m.km, u, status: st });
    }
    done++;
    yield { done, total };
  }
  // the geostationary belt: sampled every 30 minutes (their ground points move a few hundred km a day at most)
  for (const sat of prepared.geo) {
    let minKm = Infinity, minT = t0, max = 0, ok = true;
    for (let t = t0; t <= t1; t += 1800000) {
      const s = stateAt(sat, t);
      if (!s) { ok = false; break; }
      const km = groundDistanceKm(place, s.ecef).km;
      if (km < minKm) { minKm = km; minT = t; }
      max = Math.max(max, km);
    }
    const u = ok ? describeAt(sat, place, minT) : null;
    const st = u && classify(minKm, u.u, radiusKm);
    if (st === "within" || st === "borderline") {
      const here = describeAt(sat, place, t0);
      if (here) geo.push({ sat, ...here, minKm, maxKm: max, allDay: max <= radiusKm, status: st });
    }
    done++;
    yield { done, total };
  }
  now.sort((a, b) => a.km - b.km);
  passes.sort((a, b) => a.t - b.t || a.km - b.km);
  geo.sort((a, b) => a.minKm - b.minKm);
  return { startMs: t0, endMs: t1, radiusKm, now, passes, geo, counts: { ...prepared.counts, uncertainNow, uncertainPasses } };
}

// The rows the table shows: the first `cap` passes in time order ("time") or nearest first ("distance"), each with the full description of
// its moment of closest approach (height, speed, direction from the place, sunlight). The passes come from searchNear, in time order.
export function tableRows(passes, place, { order = "time", cap = TABLE_CAP } = {}) {
  const list = order === "distance" ? [...passes].sort((a, b) => a.km - b.km || a.t - b.t) : passes;
  return list.slice(0, cap).map((p) => ({ ...describeAt(p.sat, place, p.t), sat: p.sat, km: p.km, u: p.u, status: p.status }));
}

// The ground track of a pass, `minutes` either side of its closest approach, as [lat, lon] points every `stepSec` seconds (for the map).
export function trackAround(sat, tMs, minutes = 4, stepSec = 20) {
  const out = [];
  for (let s = -minutes * 60; s <= minutes * 60; s += stepSec) {
    const st = stateAt(sat, tMs + s * 1000);
    if (!st) continue;
    const g = ecefToGeodetic(st.ecef.x, st.ecef.y, st.ecef.z);
    out.push([Math.round(g.lat * 1000) / 1000, Math.round(g.lon * 1000) / 1000]);
  }
  return out;
}
