// Exact satellite positions with SGP4 (satellite.js), for the objects listed in public/precise.json.
// The globe swarm uses a faster simplified orbit that can be off by tens of kilometres; this module is used wherever
// the answer is a time or a direction: passes, Starlink trains, "where do I look".
import { json2satrec, propagate, gstime, eciToEcf } from "satellite.js";
import { ecefLook, observerEcef, isSunlit, sunUnitVectorEci, findPassesSteps, sunAltAz } from "./core.js";
import { runSteps } from "./schedule.js";

// One compact row of precise.json to the record shape json2satrec expects.
export function rowToOmm(cols, row) {
  const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  return {
    OBJECT_NAME: String(o.id), OBJECT_ID: "0000-000A", EPOCH: o.epoch, MEAN_MOTION: o.n, ECCENTRICITY: o.e, INCLINATION: o.i,
    RA_OF_ASC_NODE: o.raan, ARG_OF_PERICENTER: o.argp, MEAN_ANOMALY: o.ma, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U",
    NORAD_CAT_ID: o.id, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0, BSTAR: o.bstar, MEAN_MOTION_DOT: o.ndot, MEAN_MOTION_DDOT: o.nddot,
  };
}

// Map of NORAD id to { id, rec, epochMs } for every row that satellite.js accepts.
export function loadPrecise(precise) {
  const out = new Map();
  if (!precise || !precise.rows) return out;
  for (const row of precise.rows) {
    try {
      const omm = rowToOmm(precise.cols, row);
      const rec = json2satrec(omm);
      if (rec && !rec.error) out.set(omm.NORAD_CAT_ID, { id: omm.NORAD_CAT_ID, rec, epochMs: Date.parse(omm.EPOCH + "Z") });
    } catch { /* a bad element set is skipped, the swarm model still covers the object */ }
  }
  return out;
}

export function eciAt(sat, date) {
  const pv = propagate(sat.rec, date);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  return pv.position;
}
export function ecefAt(sat, date) {
  const p = eciAt(sat, date);
  return p ? eciToEcf(p, gstime(date)) : null;
}

// Elevation, azimuth, range and sunlit flag of a satellite as seen from a place. null if SGP4 cannot place it.
export function lookFrom(sat, date, lat, lon) {
  const p = eciAt(sat, date);
  if (!p) return null;
  const ecf = eciToEcf(p, gstime(date));
  const l = ecefLook(lat, lon, ecf);
  const o = observerEcef(lat, lon);
  return { el: l.el, az: l.az, sunlit: isSunlit(p, sunUnitVectorEci(date)), rangeKm: Math.hypot(ecf.x - o.x, ecf.y - o.y, ecf.z - o.z) };
}

// Passes above minEl in the next `hours`. Each pass has rise, set, max, visible (lit and sky dark) and a track of samples.
export function passesFor(sat, place, start, hours, opts = {}) {
  return runSteps(passesForSteps(sat, place, start, hours, opts));
}
// passesFor as a generator that pauses now and then (see findPassesSteps), for spreading a long search over several tasks
export function passesForSteps(sat, place, start, hours, opts = {}) {
  const look = (d) => lookFrom(sat, d, place.lat, place.lon) || { el: -90, az: 0, sunlit: false };
  return findPassesSteps(look, (d) => sunAltAz(place.lat, place.lon, d).alt, start, hours, { stepSec: 20, minEl: 10, ...opts });
}

export const elementAgeHours = (sat, date) => (date.getTime() - sat.epochMs) / 3600000;
