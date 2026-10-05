// The connection engine: turns the live feeds (storms, fires, hazards, quakes, space weather) into plain statements about one place.
//
// Rules for this file:
// - Every statement is a measurement or a relayed official forecast, with its source and "as of" time. Nothing here
//   predicts on its own. In particular there is no earthquake forecasting: USGS says nobody has predicted a major earthquake.
// - A statement links things only when they are near each other in space and time, and says "near", never "caused by".
// - Limits below marked OURS are our own choices of what counts as near.
import { haversineKm, bearingDeg, compassPoint } from "./core.js";
import { withoutDuplicateStorms } from "./dedupe.js";

export const NEAR = {
  storm: { watchKm: 1500, alertKm: 600 },  // OURS
  fire: { radiiKm: [25, 50, 100], watchKm: 100, alertKm: 25 },  // OURS
  hazardKm: 500,  // OURS: GDACS events listed within this distance
  quakeKm: 400, quakeMinMag: 4.5, quakeHours: 48,  // OURS
};
export const CONE_NOTE = "The cone covers the probable track of the storm's centre. NHC says the whole track stays inside it roughly 60 to 70 percent of the time, and the effects of a storm reach well beyond the cone.";

const HOUR = 3600e3;
const MIN = 60e3;
const FIRE_REC_BYTES = 12;

// ------------------------------------------------------------------ fires
// fires.bin: little-endian records of uint16 latIndex, uint16 lonIndex, uint16 detections, float32 FRP (MW), uint16 minutes
// before the newest detection. The cell is cellDeg wide and the index is its south-west corner (see fires.json "record").
export function decodeFires(buf, summary) {
  const cellDeg = (summary && summary.cellDeg) || 0.25;
  const n = Math.floor(buf.byteLength / FIRE_REC_BYTES);
  const v = new DataView(buf);
  const out = { n, cellDeg, lat: new Float32Array(n), lon: new Float32Array(n), count: new Uint16Array(n), frp: new Float32Array(n), minutesOld: new Uint16Array(n), summary };
  for (let i = 0; i < n; i++) {
    const o = i * FIRE_REC_BYTES;
    out.lat[i] = -90 + v.getUint16(o, true) * cellDeg + cellDeg / 2;
    out.lon[i] = -180 + v.getUint16(o + 2, true) * cellDeg + cellDeg / 2;
    out.count[i] = v.getUint16(o + 4, true);
    out.frp[i] = v.getFloat32(o + 6, true);
    out.minutesOld[i] = v.getUint16(o + 10, true);
  }
  return out;
}

// Detections within radiusKm of a point. A cell is counted whole when its centre is inside, so the figure is approximate by
// up to half a cell (about 14 km at the equator).
export function firesNear(fires, lat, lon, radiusKm) {
  let cells = 0, detections = 0, frp = 0, nearestKm = Infinity, nearest = -1;
  if (!fires) return { cells, detections, frpMw: frp, nearestKm: null, nearest: null };
  const dLat = radiusKm / 111.2 + fires.cellDeg;
  for (let i = 0; i < fires.n; i++) {
    if (Math.abs(fires.lat[i] - lat) > dLat) continue;
    const d = haversineKm(lat, lon, fires.lat[i], fires.lon[i]);
    if (d < nearestKm) { nearestKm = d; nearest = i; }
    if (d <= radiusKm) { cells++; detections += fires.count[i]; frp += fires.frp[i]; }
  }
  return { cells, detections, frpMw: frp, nearestKm: nearest >= 0 ? nearestKm : null, nearest: nearest >= 0 ? { lat: fires.lat[nearest], lon: fires.lon[nearest], count: fires.count[nearest], frpMw: fires.frp[nearest] } : null };
}

// The strongest cells by fire radiative power, skipping any cell within spreadKm of one already listed so that one large
// fire does not fill the list with its own neighbours.
export function topFireClusters(fires, limit = 12, spreadKm = 150) {
  if (!fires) return [];
  const order = Array.from({ length: fires.n }, (_, i) => i).sort((a, b) => fires.frp[b] - fires.frp[a]);
  const out = [];
  for (const i of order) {
    if (out.length >= limit) break;
    if (out.some((o) => haversineKm(o.lat, o.lon, fires.lat[i], fires.lon[i]) < spreadKm)) continue;
    const near = firesNear(fires, fires.lat[i], fires.lon[i], spreadKm / 2);
    out.push({ lat: fires.lat[i], lon: fires.lon[i], frpMw: near.frpMw, detections: near.detections, cells: near.cells });
  }
  return out;
}

// ------------------------------------------------------------------ storms
// Ray casting in longitude and latitude. Longitudes are shifted to sit within 180 degrees of the point first, so a cone
// that straddles the dateline is handled.
export function pointInRing(lon, lat, ring) {
  if (!ring || ring.length < 3) return false;
  const shift = (x) => { let d = x - lon; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = shift(ring[i][0]), yi = ring[i][1], xj = shift(ring[j][0]), yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && 0 < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function stormsNear(storms, lat, lon) {
  if (!storms || !Array.isArray(storms.storms)) return [];
  return storms.storms.map((s) => {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    const inCone = (s.cone || []).some((ring) => pointInRing(lon, lat, ring));
    let closest = null;  // the forecast point nearest the place; NHC's points are 12 to 24 hours apart and are not interpolated
    for (const p of s.track || []) {
      const d = haversineKm(lat, lon, p.lat, p.lon);
      if (!closest || d < closest.km) closest = { km: d, hours: p.hours, valid: p.valid, windKt: p.windKt };
    }
    return { storm: s, km, bearing: bearingDeg(lat, lon, s.lat, s.lon), inCone, closest };
  }).sort((a, b) => a.km - b.km);
}

// ------------------------------------------------------------------ space weather
export function latestOf(points, field) {
  for (let i = (points || []).length - 1; i >= 0; i--) if (points[i][field] != null) return { value: points[i][field], t: points[i].t };
  return null;
}

// Mean of a field over the last `minutes` of points, or null when there are none.
export function recentMean(points, field, minutes, nowMs) {
  const xs = (points || []).filter((p) => p[field] != null && nowMs - Date.parse(p.t) <= minutes * MIN && nowMs - Date.parse(p.t) >= -10 * MIN).map((p) => p[field]);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// What is in force now, in NOAA's own terms. A warning is in force while now is between its start and end; a message that
// cancels a warning is not itself in force. An alert is a threshold that was reached (it has no end), kept for 24 hours.
export function spaceSituation(space, nowMs) {
  if (!space) return null;
  const alerts = space.alerts || [];
  // an extended warning replaces the earlier serial it names (same message code), so the earlier one is not listed as well
  const replaced = new Set(alerts.filter((a) => a.supersedes != null).map((a) => `${a.code}:${a.supersedes}`));
  const warnings = alerts.filter((a) => a.kind === "warning" && !a.cancel && !replaced.has(`${a.code}:${a.serial}`) && a.from && a.until && Date.parse(a.from) <= nowMs && nowMs <= Date.parse(a.until));
  const reached = alerts.filter((a) => a.kind === "alert" && !a.cancel && a.reached && nowMs - Date.parse(a.reached) <= 24 * HOUR).sort((a, b) => b.reached.localeCompare(a.reached));
  const maxKpExpected = warnings.reduce((m, w) => Math.max(m, w.kp || 0), 0) || null;
  const bz30 = recentMean(space.points, "bz", 30, nowMs);
  return {
    updated: space.updated, spacecraft: space.spacecraft,
    speed: latestOf(space.points, "speed"), density: latestOf(space.points, "density"), bz: latestOf(space.points, "bz"), bt: latestOf(space.points, "bt"), bz30min: bz30,
    // NOAA's aurora tutorial: when the field in the solar wind "turns southward" geomagnetic activity increases, and the aurora
    // becomes brighter and moves further from the poles. Southward means a negative Bz.
    southward: bz30 == null ? null : bz30 < 0,
    warnings, maxKpExpected, lastAlert: reached[0] || null,
  };
}

// ------------------------------------------------------------------ connections
const SEV = { info: 1, watch: 2, alert: 3 };
const dir = (lat, lon, lat2, lon2) => compassPoint(bearingDeg(lat, lon, lat2, lon2));
const kmText = (km) => `${Math.round(km).toLocaleString("en-US")} km`;
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function connections({ place, nowMs, storms = null, fires = null, space = null, events = [], quakes = [], auroraChance = null }) {
  const out = [];
  const { lat, lon } = place;

  // storms
  for (const s of stormsNear(storms, lat, lon)) {
    const st = s.storm;
    if (!(s.km <= NEAR.storm.watchKm || s.inCone)) continue;
    const sev = s.inCone || s.km <= NEAR.storm.alertKm ? SEV.alert : SEV.watch;
    const parts = [`${st.classText} ${st.name} is ${kmText(s.km)} ${compassPoint(s.bearing)} of ${place.name}, with winds of ${st.windKt} knots (${st.windKmh} km/h) at its centre.`];
    if (s.inCone) parts.push(`${place.name} is inside NHC's forecast cone. ${CONE_NOTE}`);
    else if (s.closest && s.closest.km < s.km) parts.push(`NHC's forecast comes within ${kmText(s.closest.km)} of ${place.name} at the ${s.closest.hours} hour point.`);
    out.push({ id: `storm:${st.id}`, kind: "storm", severity: sev, title: `${st.classText} ${st.name}`, detail: parts.join(" "), km: s.km, asOf: st.issued, source: "NOAA National Hurricane Center", url: st.url, ref: st.id });
  }

  // fires
  if (fires) {
    const rings = NEAR.fire.radiiKm.map((r) => ({ r, ...firesNear(fires, lat, lon, r) }));
    const within = rings.find((x) => x.detections > 0);
    if (within) {
      const widest = rings[rings.length - 1];
      out.push({ id: "fires:near", kind: "fire", severity: within.r <= NEAR.fire.alertKm ? SEV.alert : SEV.watch, title: `Fire detections within ${within.r} km`,
        detail: `Satellites saw ${plural(within.detections, "heat detection", "heat detections")} within ${within.r} km of ${place.name} in the last 24 hours; the nearest is about ${kmText(widest.nearestKm)} ${dir(lat, lon, widest.nearest.lat, widest.nearest.lon)} away. A detection is a heat signal seen from space, not a confirmed wildfire.`,
        km: widest.nearestKm, asOf: fires.summary && fires.summary.newest, source: "NASA FIRMS (VIIRS 375 m)", ref: "fires" });
    }
  }

  // GDACS events (quakes have their own rule below, and NHC replaces the GDACS copy of each storm it lists; other GDACS cyclones stay)
  for (const e of withoutDuplicateStorms(events, storms && storms.storms)) {
    if (e.type === "EQ") continue;
    const km = haversineKm(lat, lon, e.lat, e.lon);
    if (km > NEAR.hazardKm) continue;
    out.push({ id: `event:${e.url || e.name}`, kind: "hazard", severity: e.alert === "Red" ? SEV.alert : e.alert === "Orange" ? SEV.watch : SEV.info, title: e.name,
      detail: `${e.name} is ${kmText(km)} ${dir(lat, lon, e.lat, e.lon)} of ${place.name}. GDACS alert level: ${e.alert}.`, km, asOf: e.to ? `${e.to}Z` : null, source: "GDACS", url: e.url, ref: e.url });
  }

  // recent quakes
  for (const q of quakes || []) {
    if (q.mag < NEAR.quakeMinMag || nowMs - Date.parse(q.time) > NEAR.quakeHours * HOUR) continue;
    const km = haversineKm(lat, lon, q.lat, q.lon);
    if (km > NEAR.quakeKm) continue;
    out.push({ id: `quake:${q.id}`, kind: "quake", severity: q.mag >= 6 ? SEV.alert : SEV.watch, title: `M${q.mag.toFixed(1)} earthquake`,
      detail: `${q.place}, ${kmText(km)} ${dir(lat, lon, q.lat, q.lon)} of ${place.name}, ${Math.round((nowMs - Date.parse(q.time)) / HOUR * 10) / 10} hours ago, ${Math.round(q.depth)} km deep.`, km, asOf: q.time, source: "U.S. Geological Survey", url: q.url, ref: q.id });
  }

  // space weather and aurora: shown when NOAA's own aurora forecast gives this place a chance. When that forecast is not
  // loaded, an active geomagnetic warning is shown on its own, without a claim about this place.
  const sit = spaceSituation(space, nowMs);
  if (sit && (auroraChance != null ? auroraChance >= 1 : sit.warnings.length > 0)) {
    const bits = [];
    if (auroraChance != null) bits.push(`NOAA's aurora forecast gives a ${Math.round(auroraChance)}% chance of aurora overhead for ${place.name}.`);
    if (sit.maxKpExpected) bits.push(`NOAA has a warning in force that the Kp index will reach ${sit.maxKpExpected}.`);
    if (sit.southward === true) bits.push("The solar wind's magnetic field has been pointing south for the last 30 minutes, which NOAA says increases geomagnetic activity.");
    out.push({ id: "aurora", kind: "aurora", severity: auroraChance >= 20 ? SEV.alert : SEV.watch, title: "Aurora and geomagnetic activity", detail: bits.join(" "), km: null, asOf: sit.updated, source: "NOAA Space Weather Prediction Center", ref: "aurora" });
  }

  return out.sort((a, b) => b.severity - a.severity || (a.km ?? Infinity) - (b.km ?? Infinity));
}
