// Starlink "trains": satellites from one launch that are still bunched in one orbital plane, seen as a line of dots.
// They spread out over days to weeks as the satellites climb to their final orbit, so only recent launches qualify.
import { DEG, EARTH_RADIUS_KM, norm360, unpackDetails, launchDateFromDay, ageDays, sunAltAz, compassPoint } from "./core.js";
import { eciAt, lookFrom } from "./sgp4.js";
import { runSteps } from "./schedule.js";

const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => { const l = len(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

// Along-track spread of a set of positions that share an orbital plane: the arc (degrees) that contains all of them,
// found as 360 minus the biggest gap between neighbours. Also returns the members in order along the track. Pass the
// orbit normal (position cross velocity) and the order follows the direction of travel.
export function alongTrackSpread(positions, normal = null) {
  if (positions.length < 2) return { spanDeg: 0, order: positions.map((_, i) => i) };
  const ref = unit(positions[0]);
  let nrm = normal ? unit(normal) : { x: 0, y: 0, z: 0 };
  if (!normal) {
    // no direction of travel given: use the plane through the points (the order may then run either way)
    for (const p of positions) { const c = cross(ref, unit(p)); const s = dot(c, nrm) < 0 ? -1 : 1; nrm = { x: nrm.x + s * c.x, y: nrm.y + s * c.y, z: nrm.z + s * c.z }; }
    nrm = unit(nrm);
  }
  const ey = cross(nrm, ref);
  const u = positions.map((p, i) => ({ i, a: norm360(Math.atan2(dot(p, ey), dot(p, ref)) / DEG) }));
  u.sort((p, q) => p.a - q.a);
  let gap = 0, gapAt = 0;
  for (let k = 0; k < u.length; k++) {
    const g = (u[(k + 1) % u.length].a - u[k].a + 360) % 360 || (u.length === 1 ? 360 : 0);
    if (g > gap) { gap = g; gapAt = k; }
  }
  // rotate so the order starts just after the biggest gap
  const order = [];
  for (let k = 1; k <= u.length; k++) order.push(u[(gapAt + k) % u.length].i);
  return { spanDeg: 360 - gap, order };
}

// Angle in degrees between two orbit planes, from their normals
const planeAngle = (n1, n2) => Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(n1, n2))))) / DEG;

// precise: Map id -> sat (from sgp4.loadPrecise); idByIdx / idxById come from D.later.ids
export function findTrains(D, precise, now, opts = {}) {
  const { maxAgeDays = 25, minSize = 6, maxSpanDeg = 120, planeTolDeg = 2 } = opts;
  if (!D.later) return [];
  const idxById = new Map();
  D.later.ids.forEach((id, i) => idxById.set(id, i));
  const groups = new Map();
  for (const idx of D.meta.newIdx) {
    if (!/^STARLINK/.test(D.later.names[idx])) continue;
    const id = D.later.ids[idx];
    if (!precise.has(id)) continue;
    const d = unpackDetails(D.later.details, idx);
    if (!d.launchDay) continue;
    const age = ageDays(d.launchDay, now.getTime());
    if (age === null || age > maxAgeDays) continue;
    if (!groups.has(d.launchDay)) groups.set(d.launchDay, []);
    groups.get(d.launchDay).push({ idx, id });
  }
  const trains = [];
  for (const [launchDay, members] of groups) {
    if (members.length < minSize) continue;
    const states = members.map((m) => {
      const sat = precise.get(m.id);
      const pv = eciAt(sat, now);
      if (!pv) return null;
      // velocity from a short step: needed for the orbit plane normal
      const pv2 = eciAt(sat, new Date(now.getTime() + 5000));
      if (!pv2) return null;
      const v = { x: pv2.x - pv.x, y: pv2.y - pv.y, z: pv2.z - pv.z };
      return { ...m, pos: pv, normal: unit(cross(pv, v)) };
    }).filter(Boolean);
    if (states.length < minSize) continue;
    // keep the satellites that share the plane of the first one (a launch can contain several planes)
    const ref = states[0].normal;
    let cluster = states.filter((s) => planeAngle(s.normal, ref) < planeTolDeg);
    if (cluster.length < minSize) continue;
    const { spanDeg, order } = alongTrackSpread(cluster.map((s) => s.pos), ref);
    if (spanDeg > maxSpanDeg) continue;
    const ordered = order.map((i) => cluster[i]);
    const central = ordered[Math.floor(ordered.length / 2)];
    const meanR = cluster.reduce((s, c) => s + len(c.pos), 0) / cluster.length;
    const sat0 = precise.get(central.id);
    const date = launchDateFromDay(launchDay);
    trains.push({
      launchDay, launchDate: date, ageDays: ageDays(launchDay, now.getTime()), count: cluster.length, spanDeg, altKm: meanR - EARTH_RADIUS_KM,
      centralId: central.id, centralIdx: central.idx, firstIdx: ordered[0].idx, lastIdx: ordered[ordered.length - 1].idx,
      shape: spanDeg <= 25 ? "tight" : "stretched", memberIdxs: ordered.map((o) => o.idx), memberIds: ordered.map((o) => o.id), epochAgeHours: (now.getTime() - sat0.epochMs) / 3600000,
      periodMin: (2 * Math.PI) / precise.get(central.id).rec.no,
    });
  }
  return trains.sort((a, b) => a.ageDays - b.ageDays);
}

// When the satellites of a train can be seen from a place. The sky is sampled every minute; a moment counts when the Sun is
// at least 6 degrees below the horizon and at least minVisible members are above 10 degrees and in sunlight. Consecutive
// moments make one event. A stretched string passes over in a stream, so each event reports how many are up at its busiest.
export function trainEvents(train, precise, place, start, hours, opts = {}) {
  return runSteps(trainEventsSteps(train, precise, place, start, hours, opts));
}
// trainEvents as a generator that pauses every 30 sampled minutes, for spreading the work over several tasks
export function* trainEventsSteps(train, precise, place, start, hours, opts = {}) {
  const { minVisible = 3, minEl = 10, stepSec = 60 } = opts;
  const sats = train.memberIds.map((id) => precise.get(id)).filter(Boolean);
  const events = [];
  let cur = null;
  const end = start.getTime() + hours * 3600000;
  let n = 0;
  for (let t = start.getTime(); t <= end; t += stepSec * 1000) {
    if (++n % 30 === 0) yield;
    const d = new Date(t);
    let count = 0, best = null;
    if (sunAltAz(place.lat, place.lon, d).alt < -6) {
      for (const sat of sats) {
        const l = lookFrom(sat, d, place.lat, place.lon);
        if (l && l.el >= minEl && l.sunlit) { count++; if (!best || l.el > best.el) best = l; }
      }
    }
    if (count >= minVisible) {
      if (!cur) cur = { start: d, end: d, peak: d, maxCount: count, maxEl: best.el, azAtPeak: best.az, riseAz: best.az, setAz: best.az, track: [] };
      cur.end = d; cur.setAz = best.az;
      cur.track.push({ time: d, el: best.el, az: best.az, count });
      if (count > cur.maxCount || (count === cur.maxCount && best.el > cur.maxEl)) { cur.maxCount = count; cur.maxEl = best.el; cur.azAtPeak = best.az; cur.peak = d; }
    } else if (cur) { events.push(cur); cur = null; }
  }
  if (cur) events.push(cur);
  const sat0 = precise.get(train.centralId);
  const periodSec = sat0 ? (2 * Math.PI / sat0.rec.no) * 60 : 5600;
  return events.map((e) => ({
    ...e, durationSec: Math.round((e.end - e.start) / 1000) + stepSec, trainSeconds: Math.round((train.spanDeg / 360) * periodSec), count: train.count,
    centralIdx: train.centralIdx, launchDay: train.launchDay, shape: train.shape, riseCompass: compassPoint(e.riseAz), setCompass: compassPoint(e.setAz), peakCompass: compassPoint(e.azAtPeak),
  }));
}
