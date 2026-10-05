// Counts the satellite feed by owner, for the satellites by country pages. Pure functions over the feed's binary files: no HTML, so every
// number can be tested on its own. Uses the same definitions as site/satcount.mjs (active, Starlink, orbit groups, the 30 day list), so
// the per-owner numbers add up to the count page's totals (a test checks this). "Owner" is the catalogue's word and is never renamed.
import { unpackDetails, launchDateFromDay, decodeSwarm, swarmPositionEcef, ecefToGeodetic } from "../src/core.js";
import { ACTIVE_STATUSES, ORBIT_ORDER, orbitClass } from "./satcount.mjs";

export const HUB_FILE = "satellites-by-country/index.html";
// OURS: the owners that get a page, fixed in code so the set of addresses never changes between collections. Chosen from the bundled
// snapshot of 2026-10-04: the only owners with at least 100 active satellites that are places (see the design, section 1).
// owner: exactly as the catalogue records it; name: the short name for links and tables; phrase: the name as it reads in a sentence.
export const COUNTRY_PAGES = [
  { slug: "united-states", owner: "United States", name: "United States", phrase: "the United States" },
  { slug: "china", owner: "People's Republic of China", name: "China", phrase: "China" },
  { slug: "united-kingdom", owner: "United Kingdom", name: "United Kingdom", phrase: "the United Kingdom" },
  { slug: "cis-former-ussr", owner: "Commonwealth of Independent States (former USSR)", name: "CIS (former USSR)", phrase: "the CIS (former USSR)" },
  { slug: "japan", owner: "Japan", name: "Japan", phrase: "Japan" },
].map((p) => ({ ...p, file: `satellites-by-country/${p.slug}/index.html` }));

// OURS: a guard against a broken feed, not a content rule. A page is skipped when its owner has fewer active satellites than this.
export const MIN_ACTIVE_FOR_PAGE = 50;
export const NOT_RECORDED = "Not recorded";

const ACTIVE = new Set(ACTIVE_STATUSES);

function readSwarm(buf, count) {
  if (buf.length !== count * 20) throw new Error(`satcountry: swarm.bin has ${buf.length} bytes, expected ${count * 20} for ${count} objects`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { f32: new Float32Array(ab, 0, count * 2), u16: new Uint16Array(ab, count * 8, count * 6) };
}
function checkDetails(details, count) {
  if (details.length !== count * 8) throw new Error(`satcountry: details.bin has ${details.length} bytes, expected ${count * 8} for ${count} objects`);
}
const ownerName = (meta, d) => (d.owner ? meta.owners[d.owner - 1] || NOT_RECORDED : NOT_RECORDED);
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const zeroOrbits = () => Object.fromEntries(ORBIT_ORDER.map((k) => [k, 0]));

// Every owner the feed names (including owners with no active satellite) and "Not recorded" when an active satellite has no owner, in one
// pass. Owners come back ranked by active satellites, then by name.
export function countOwners({ meta, details, swarm }) {
  const count = meta.count;
  checkDetails(details, count);
  const { f32, u16 } = readSwarm(swarm, count);
  const by = new Map();
  const get = (name) => {
    if (!by.has(name)) by.set(name, { name, active: 0, starlink: 0, last30: 0, orbits: zeroOrbits(), purposes: new Map(), years: new Map(), unknownYear: 0 });
    return by.get(name);
  };
  for (const name of meta.owners || []) get(name);
  const world = { active: 0, starlink: 0, last30: 0, orbits: zeroOrbits() };
  const ownerOf = new Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    const d = unpackDetails(details, i);
    if (d.type !== 0 || !ACTIVE.has(d.status)) continue;
    const o = get(ownerName(meta, d));
    ownerOf[i] = o;
    o.active++; world.active++;
    if (u16[i * 6 + 5] === 1) { o.starlink++; world.starlink++; }
    const orbit = orbitClass(f32[i * 2 + 1], u16[i * 6] / 65535);
    o.orbits[orbit]++; world.orbits[orbit]++;
    bump(o.purposes, meta.purposes[d.purpose] || "Unspecified");
    const date = launchDateFromDay(d.launchDay);
    if (date) bump(o.years, date.getUTCFullYear()); else o.unknownYear++;
  }
  // the same loop as countSatellites, so the 30 day numbers add up to its total
  for (const i of meta.newIdx || []) if (ownerOf[i]) { ownerOf[i].last30++; world.last30++; }
  const rows = (map) => [...map].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"));
  const owners = [...by.values()].map((o) => ({
    name: o.name, active: o.active, starlink: o.starlink, last30: o.last30, orbits: o.orbits, purposes: rows(o.purposes),
    launchYears: [...o.years].sort((a, b) => a[0] - b[0]).map(([year, n]) => ({ year, count: n })), unknownYear: o.unknownYear,
  })).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "en"));
  return { taken: meta.taken, ...world, owners };
}

// null when the page can be built, otherwise the reason it is skipped.
export function pageGuard(counts, page, { min = MIN_ACTIVE_FOR_PAGE } = {}) {
  const o = counts.owners.find((r) => r.name === page.owner);
  if (!o) return `${page.owner} is not in the feed`;
  if (o.active < min) return `${page.owner} has ${o.active} active satellites, under ${min}`;
  return null;
}

// [lat, lon] in degrees of the point below each active satellite of one owner, in feed order, for the time `at` (the data time unless
// given). Uses the swarm model the live globe uses (decodeSwarm and swarmPositionEcef), so positions are approximate.
export function ownerPositions({ meta, details, swarm }, owner, at = new Date(meta.taken)) {
  const count = meta.count;
  checkDetails(details, count);
  if (typeof meta.ref !== "number" || !Number.isFinite(meta.ref)) throw new Error("satcountry: the feed's meta has no reference time (ref), so positions cannot be worked out");
  const { f32, u16 } = readSwarm(swarm, count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = unpackDetails(details, i);
    if (d.type !== 0 || !ACTIVE.has(d.status) || ownerName(meta, d) !== owner) continue;
    const [s] = decodeSwarm(f32.subarray(i * 2, i * 2 + 2), u16.subarray(i * 6, i * 6 + 6), meta.ref);
    const p = swarmPositionEcef(s, at);
    const g = ecefToGeodetic(p.x, p.y, p.z);
    if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) out.push([Math.max(-90, Math.min(90, g.lat)), Math.max(-180, Math.min(180, g.lon))]);
  }
  return out;
}

// Six bands of 30 degrees from the South Pole up; a point on a boundary belongs to the band north of it, and the North Pole to the top band.
export function latitudeBands(points) {
  const bands = Array.from({ length: 6 }, (_, k) => ({ from: -90 + k * 30, to: -60 + k * 30, count: 0 }));
  for (const [lat] of points) bands[Math.max(0, Math.min(5, Math.floor((lat + 90) / 30)))].count++;
  return bands;
}

// The band with the most points (the southernmost on a tie) and its share of all points, or null for no points.
export function busiestBand(points) {
  if (!points.length) return null;
  const best = latitudeBands(points).reduce((a, b) => (b.count > a.count ? b : a));
  return { ...best, share: best.count / points.length };
}
