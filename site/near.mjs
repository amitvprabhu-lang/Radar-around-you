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
import { PASS_ERRORS } from "./near-errors.mjs";

export { PASS_ERRORS };

export { NEAR_FILE, RADII_KM, DEFAULT_RADIUS_KM, WINDOW_HOURS, STALE_HOURS, TABLE_CAP, capFraction, capAreaKm2, EARTH_AREA_KM2, expectedAtOnce } from "./near-ui.mjs";
const ACTIVE = new Set(ACTIVE_STATUSES);

// ---------- Uncertainty ----------

// The uncertainty the page prints and classifies with is the measured error of a PASS (site/near-errors.mjs, written by
// tools/near-pass-errors.mjs): how far the closest ground distance and the time of closest approach of our passes were from those of the
// truth, for passes predicted from older published data and checked against newer element sets. An error along the track moves when a pass
// happens far more than how close it comes, so the two are given separately.
//
// POSITION_P95 below is a different measurement, kept because it explains the choice of model: the 95th percentile of the distance between
// the ground point of our model and of full SGP4 from the same element sets at the same moment (mostly along the track), by height band and
// hours since the epoch (tools/near-accuracy.mjs, test/near-accuracy.test.js). It is not used to classify passes.
export const U_HOURS = [0, 6, 12, 24, 36, 48, 72, 96];
export const POSITION_P95 = {
  "low-under-450": [1, 17, 66, 259, 580, 997, 2107, 3873],
  "low-450-600": [1, 1, 3, 11, 24, 42, 95, 168],
  "low-600-1000": [1, 1, 1, 2, 3, 5, 10, 18],
  "low-1000-2000": [1, 1, 1, 1, 1, 1, 2, 4],
  medium: [1, 1, 1, 1, 1, 1, 1, 1],
  geostationary: [1, 1, 1, 1, 1, 1, 1, 1],
  highElliptical: [1, 1, 1, 1, 2, 2, 2, 4],
  beyond: [1, 1, 1, 1, 1, 1, 1, 1],
};
// The measurement behind POSITION_P95 and the page's statements (tools/near-accuracy.mjs on the whole download): kept here so the page prints
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
  // the marks checked against the newer element sets (tools/near-pass-errors.mjs --marks, window 36 to 48 hours after the older data, 12
  // places): [truth passes, share marked within, share marked within or borderline, share of "within" rows truly within, share of
  // borderline rows truly within the distance plus their uncertainty, share of borderline rows truly within the distance]
  marks: { 25: [6780, 0.961, 0.976, 0.974, 0.902, 0.101], 100: [26165, 0.99, 0.994, 0.99, 0.904, 0.094], 500: [120388, 0.996, 0.997, 0.997, 0.893, 0.109] },
};
export const U_BAND_LABELS = {
  "low-under-450": "below 450 km", "low-450-600": "450 to 600 km", "low-600-1000": "600 to 1,000 km", "low-1000-2000": "1,000 to 2,000 km",
  medium: "medium Earth orbit", geostationary: "geosynchronous, inclined", highElliptical: "high elliptical", beyond: "beyond the geostationary belt",
};

export function uncertaintyBand(nRadPerMin, ecc) {
  const cls = orbitClass(nRadPerMin, ecc);
  if (cls !== "low") return cls;
  const alt = swarmFromRad(0, nRadPerMin, 0, 0, 0, 0, 0).a - SWARM_EARTH_RADIUS_KM;
  return alt < 450 ? "low-under-450" : alt < 600 ? "low-450-600" : alt < 1000 ? "low-600-1000" : "low-1000-2000";
}

// The position error of the model alone (POSITION_P95), interpolated between the hours; for the accuracy explanation and its test.
export function positionErrorKm(band, hoursSinceEpoch) {
  const row = POSITION_P95[band] || POSITION_P95["low-under-450"];
  const h = Math.max(0, hoursSinceEpoch);
  if (h >= U_HOURS[U_HOURS.length - 1]) return row[row.length - 1];
  let k = 0;
  while (U_HOURS[k + 1] < h) k++;
  const f = (h - U_HOURS[k]) / (U_HOURS[k + 1] - U_HOURS[k]);
  return row[k] + f * (row[k + 1] - row[k]);
}

// The measured pass error for a satellite at a pass `ageH` hours after its element epoch: { km, s } (95th percentiles of the closest-distance
// error and of the time error). kind: "full" for a full element set, "mean" for the swarm's packed elements. A band the measurement has no
// row for takes the kind's "other" row (all its bands together). A full element set below 450 km, or of a satellite launched in the last 30
// days, is never given less than the packed elements' error for its band: those are the satellites that are still raising their orbits.
export function passError(band, kind, ageH, { floorMean = false, tables = PASS_ERRORS } = {}) {
  const t = tables.tables[kind] || tables.tables.mean;
  const row = t[band] || t.other;
  const found = tables.ageEdges.findIndex((e) => ageH < e);
  const idx = found < 0 ? tables.ageEdges.length : found;
  let km = row.km[idx], s = row.s[idx];
  if (kind === "full" && floorMean) { const m = passError(band, "mean", ageH, { tables }); km = Math.max(km, m.km); s = Math.max(s, m.s); }
  return { km, s };
}
export const satPassError = (sat, ageH) => passError(sat.band, sat.exact ? "full" : "mean", ageH, { floorMean: sat.exact && (sat.band === "low-under-450" || sat.recent) });

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
// OURS: the inclination under which a geostationary-belt satellite is treated as standing still over the equator
export const GEO_MAX_INCL_DEG = 2;
// OURS: "recently launched" for the floor of the uncertainty (precise.json lists everything launched in the last 30 days, pipeline/pack.py)
const RECENT_DAYS = 30;

// The satellites the page works with: active payloads (the count page's definition), each with its SGP4 record. Element sets older than
// STALE_HOURS at `atMs`, and records SGP4 refuses, are counted and left out. Geostationary satellites (in the geostationary belt and
// inclined under GEO_MAX_INCL_DEG) are kept apart: their ground point stays near one point of the equator, so they have no passes; the page
// lists them separately when they are near. Inclined geosynchronous satellites (QZSS, BeiDou IGSO, IRNSS and others) swing far north and
// south each day and go through the pass search like any other.
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
      recent: d.launchDay > 0 && atMs - (Date.UTC(1957, 9, 4) + (d.launchDay - 1) * 86400000) <= RECENT_DAYS * 86400000,
    };
    if (row) counts.exact++;
    if (orbit === "geostationary" && rec.inclo < GEO_MAX_INCL_DEG * DEG) { counts.geostationary++; geo.push(sat); } else sats.push(sat);
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

// The pass error at a moment as the rows carry it: u (km, distance) and us (s, time)
const errorsAt = (sat, ageH) => { const e = satPassError(sat, ageH); return { u: e.km, us: e.s }; };

// The uncertainty of where the ground point is at a given moment (for "right now"): the measured closest-distance error plus the ground
// distance the satellite covers in the measured time error (its speed scaled down to the ground).
export const nowUncertaintyKm = (d) => d.u + (d.us * d.kms * EARTH_RADIUS_KM) / (EARTH_RADIUS_KM + Math.max(0, d.hKm));

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
    kms: Math.hypot(st.vel.x, st.vel.y, st.vel.z), ageH, ...errorsAt(sat, ageH),
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
        // at a fixed moment an error in time moves the ground point along its track: the uncertainty of the position now is the distance
        // error plus the ground distance covered in the time error
        const u = here && nowUncertaintyKm(here);
        const st = here && classify(here.km, u, radiusKm);
        if (st === "uncertain") uncertainNow++;
        else if (st) now.push({ sat, ...here, u, status: st });
      }
    }
    // search out to the radius plus the largest uncertainty a listed pass can have (less than the radius), so borderline passes are found
    const uEnd = satPassError(sat, (t1 - sat.epochMs) / 3600000).km;
    for (const m of closestApproaches(sat, place, t0, t1, radiusKm + Math.min(uEnd, radiusKm), { P, gmst0 })) {
      const e = satPassError(sat, (m.t - sat.epochMs) / 3600000);
      const st = classify(m.km, e.km, radiusKm);
      if (st === "uncertain") uncertainPasses++;
      else if (st) passes.push({ sat, t: m.t, km: m.km, u: e.km, us: e.s, status: st });
    }
    done++;
    yield { done, total };
  }
  // geostationary satellites: sampled every 10 minutes (inclined under GEO_MAX_INCL_DEG, their ground points move at most a few km a minute)
  for (const sat of prepared.geo) {
    let minKm = Infinity, minT = t0, max = 0, ok = true;
    for (let t = t0; t <= t1; t += 600000) {
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
  return list.slice(0, cap).map((p) => ({ ...describeAt(p.sat, place, p.t), sat: p.sat, km: p.km, u: p.u, us: p.us, status: p.status }));
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
