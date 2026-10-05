// Counts what is in the satellite feed. Pure functions over the feed's binary files: no HTML, so every number can be tested on its own.
// The feed is CelesTrak's "active" list plus a few debris clouds (see docs/satcount-sources.md), so "active satellites" is the number
// it can honestly give. File layouts are documented in test/helpers/satfixture.mjs and pipeline/pack.py.
import { unpackDetails, launchDateFromDay, swarmFromRad, SWARM_EARTH_RADIUS_KM } from "../src/core.js";
import { STATUS_NAMES } from "../src/info.js";

// status codes 1 to 5: operational, partially operational, backup or standby, spare, extended mission. OURS: the definition of "active".
export const ACTIVE_STATUSES = [1, 2, 3, 4, 5];
const ACTIVE = new Set(ACTIVE_STATUSES);
const TYPE_KEYS = ["payload", "rocketBody", "debris", "unknown"];

export const ORBIT_ORDER = ["low", "medium", "geostationary", "highElliptical", "beyond"];
// The one place the orbit boundaries live. orbitClass, the labels below and the page's prose all read from here.
export const ORBIT_BOUNDS = { ellipticalAt: 0.25, lowBelow: 2000, mediumBelow: 35586, geoUpTo: 35986 };
const km = (n) => n.toLocaleString("en-GB");
export const ORBIT_LABELS = {
  low: `Low Earth orbit (below ${km(ORBIT_BOUNDS.lowBelow)} km)`,
  medium: `Medium Earth orbit (${km(ORBIT_BOUNDS.lowBelow)} to ${km(ORBIT_BOUNDS.mediumBelow - 1)} km)`,
  geostationary: `Geostationary belt (${km(ORBIT_BOUNDS.mediumBelow)} to ${km(ORBIT_BOUNDS.geoUpTo)} km)`,
  highElliptical: `High elliptical (eccentricity ${ORBIT_BOUNDS.ellipticalAt} or more)`,
  beyond: "Beyond the geostationary belt",
};

// OURS: working definitions, not a cited standard. High elliptical is checked first; the mean altitude is the semi-major axis minus the
// equatorial radius the swarm decoder uses.
export function orbitClass(nRadPerMin, ecc) {
  if (ecc >= ORBIT_BOUNDS.ellipticalAt) return "highElliptical";
  const alt = swarmFromRad(0, nRadPerMin, 0, 0, 0, 0, 0).a - SWARM_EARTH_RADIUS_KM;
  if (alt < ORBIT_BOUNDS.lowBelow) return "low";
  if (alt < ORBIT_BOUNDS.mediumBelow) return "medium";
  if (alt <= ORBIT_BOUNDS.geoUpTo) return "geostationary";
  return "beyond";
}

function readSwarm(buf, count) {
  if (buf.length !== count * 20) throw new Error(`satcount: swarm.bin has ${buf.length} bytes, expected ${count * 20} for ${count} objects`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { f32: new Float32Array(ab, 0, count * 2), u16: new Uint16Array(ab, count * 8, count * 6) };
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

export function countSatellites({ meta, details, swarm }, { topOwners = 10 } = {}) {
  const count = meta.count;
  if (details.length !== count * 8) throw new Error(`satcount: details.bin has ${details.length} bytes, expected ${count * 8} for ${count} objects`);
  const { f32, u16 } = readSwarm(swarm, count);
  const types = { payload: 0, rocketBody: 0, debris: 0, unknown: 0 };
  const statusCounts = new Array(STATUS_NAMES.length).fill(0);
  const owners = new Map(), purposes = new Map(), years = new Map();
  const orbitCounts = Object.fromEntries(ORBIT_ORDER.map((k) => [k, 0]));
  const isActive = new Array(count).fill(false);
  let active = 0, starlink = 0, unknownYear = 0;
  for (let i = 0; i < count; i++) {
    const d = unpackDetails(details, i);
    types[TYPE_KEYS[d.type] || "unknown"]++;
    if (d.type !== 0) continue;
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    if (!ACTIVE.has(d.status)) continue;
    isActive[i] = true;
    active++;
    if (u16[i * 6 + 5] === 1) starlink++;
    orbitCounts[orbitClass(f32[i * 2 + 1], u16[i * 6] / 65535)]++;
    bump(owners, d.owner ? meta.owners[d.owner - 1] || "Not recorded" : "Not recorded");
    bump(purposes, meta.purposes[d.purpose] || "Unspecified");
    const date = launchDateFromDay(d.launchDay);
    if (date) bump(years, date.getUTCFullYear()); else unknownYear++;
  }
  let last30 = 0;
  for (const i of meta.newIdx || []) if (isActive[i]) last30++;
  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, "en");
  const rows = (map) => [...map].map(([name, n]) => ({ name, count: n })).sort(byCount);
  const ownerRows = rows(owners);
  return {
    taken: meta.taken, objects: count, types, active, starlink, starlinkShare: active ? starlink / active : 0, last30,
    statusRows: STATUS_NAMES.map((name, i) => ({ name, count: statusCounts[i] || 0 })).filter((r) => r.count > 0),
    owners: ownerRows.slice(0, topOwners), ownersOther: ownerRows.slice(topOwners).reduce((s, r) => s + r.count, 0),
    purposes: rows(purposes),
    orbits: ORBIT_ORDER.map((key) => ({ key, label: ORBIT_LABELS[key], count: orbitCounts[key] })),
    launchYears: [...years].sort((a, b) => a[0] - b[0]).map(([year, n]) => ({ year, count: n })), unknownYear,
  };
}

// Refuses numbers that cannot be right, so a broken feed never publishes a nonsense page.
export function assertPlausible(c, { min = 5000, max = 60000 } = {}) {
  const sum = c.types.payload + c.types.rocketBody + c.types.debris + c.types.unknown;
  if (sum !== c.objects) throw new Error(`satcount: the object types add up to ${sum} but the feed has ${c.objects} objects`);
  if (c.active < min || c.active > max) throw new Error(`satcount: ${c.active} active satellites is implausible (expected ${min} to ${max})`);
}
