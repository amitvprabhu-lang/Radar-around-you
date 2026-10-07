// The numbers the static HTML of /satellites-near-me/ prints, worked out when the page is built: from the satellite data bundled with the
// site (site/build.mjs), or, at deploy time, from the live feed the build downloaded (site/near-refresh.mjs). Every number carries the time of
// the data it came from, and the example is worked out for the 24 hours after that time, so the page never claims more than its data shows.
import { unpackDetails, swarmFromRad, SWARM_EARTH_RADIUS_KM } from "../src/core.js";
import { runSteps } from "../src/schedule.js";
import { countSatellites, ACTIVE_STATUSES } from "./satcount.mjs";
import { decodeFeed, prepareSatellites, searchNear, tableRows } from "./near.mjs";
import { RADII_KM, DEFAULT_RADIUS_KM, DEFAULT_PLACE, capAreaKm2, capFraction, expectedAtOnce } from "./near-ui.mjs";

// OURS: how many rows of the example the page prints
export const EXAMPLE_ROWS = 10;
// OURS: the height the "straight line" sentence compares with
export const HIGH_KM = 300;

// files: { meta, swarm, ids, details, names, precise }; source: "bundled" or "live"; dataTime: ISO time of the data (meta.taken for the
// bundled copy, the feed's fetchedAt for the live one).
export function nearSummary(files, { source, dataTime, place = DEFAULT_PLACE, radiusKm = DEFAULT_RADIUS_KM }) {
  const { meta, swarm, details } = files;
  const active = countSatellites({ meta, details, swarm }).active;
  // the lowest perigee among the active satellites, and the share whose perigee is above HIGH_KM
  const feed = decodeFeed(files);
  let lowest = Infinity, high = 0, n = 0;
  for (let k = 0; k < feed.count; k++) {
    const d = unpackDetails(feed.details, k);
    if (d.type !== 0 || !ACTIVE_STATUSES.includes(d.status)) continue;
    const s = swarmFromRad(0, feed.f32[2 * k + 1], feed.u16[6 * k] / 65535, 0, 0, 0, 0);
    const perigee = s.a * (1 - s.e) - SWARM_EARTH_RADIUS_KM;
    lowest = Math.min(lowest, perigee); n++;
    if (perigee > HIGH_KM) high++;
  }
  const startMs = Date.parse(dataTime);
  if (!Number.isFinite(startMs)) throw new Error(`near: the data time "${dataTime}" is not a time`);
  const prepared = prepareSatellites(feed, startMs);
  const res = runSteps(searchNear(prepared, place, { startMs, radiusKm }));
  const within = res.passes.filter((p) => p.status === "within").length;
  const rows = tableRows(res.passes, place, { order: "time", cap: EXAMPLE_ROWS }).map((r) => ({
    name: r.sat.name, id: r.sat.id, owner: r.sat.owner, starlink: r.sat.starlink, exact: r.sat.exact, t: r.t, km: r.km, u: r.u, us: r.us, status: r.status, el: r.el, az: r.az, lit: r.lit, hKm: r.hKm, kms: r.kms,
  }));
  return {
    source, dataTime, active, lowestPerigeeKm: lowest, highShare: n ? high / n : 0,
    expected: RADII_KM.map((r) => ({ radiusKm: r, areaKm2: capAreaKm2(r), share: capFraction(r), expected: expectedAtOnce(active, r) })),
    example: { place, radiusKm, startMs: res.startMs, endMs: res.endMs, used: prepared.counts.used, exact: prepared.counts.exact, stale: prepared.counts.stale, now: res.now.length, within, borderline: res.passes.length - within, total: res.passes.length, rows },
  };
}
