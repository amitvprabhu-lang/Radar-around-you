// Satellites, rocket bodies and debris by owner, from the collector's satcat feed (the whole CelesTrak catalogue counted by
// pipeline/satcat.py) and, for the active satellites in the newer orbit data, the satellites feed. Pure functions: no HTML, so every number
// can be tested on its own. Design: docs/superpowers/specs/2026-10-07-country-objects-design.md; sources: docs/country-objects-sources.md.
import { unpackDetails, SWARM_EARTH_RADIUS_KM } from "../src/core.js";
import { ACTIVE_STATUSES, ORBIT_BOUNDS } from "./satcount.mjs";
import { COUNTRY_PAGES } from "./satcountry.mjs";
import { StaleError, parseTime, isoZ } from "./hazard.mjs";

export const RANKING_FILE = "satellites-and-debris-by-country/index.html";
// OURS: the catalogue's own refresh is "once or twice a day" (CelesTrak usage policy); three days without a new copy means the collector
// has not managed to read it, and the pages that rest on it are skipped (their previous copy stays). The feed's staleAfterSec is the same.
export const OBJECTS_MAX_AGE_HOURS = 72;
// OURS: the satellite data older than this is not used for the "in the orbit data" figures (the same limit as the Starlink page)
export const FAST_MAX_AGE_HOURS = 30;
// OURS: the owner pages were chosen on 2026-10-07 from the real catalogue: every owner with at least OWNER_SELECT_MIN objects in Earth
// orbit, leaving out "To Be Determined". A page is built while its owner has at least OWNER_PAGE_MIN (a guard against a broken feed, lower
// than the selection rule so a page does not flap in and out); below it the page is skipped and the previous copy stays.
export const OWNER_SELECT_MIN = 30;
export const OWNER_PAGE_MIN = 20;
// OURS: the plausible range of objects in Earth orbit (34,982 on 2026-10-07), the same bounds the collector uses
export const OBJECT_BOUNDS = { min: 15000, max: 100000 };
// OURS: rows shown in each static details table, before "Show all"; an owner with at most STATIC_ALL_MAX objects has every object listed
export const STATIC_ROWS = 25;
export const STATIC_ALL_MAX = 60;

// code: the catalogue's owner code (the join key with the satellites feed); slug, name (short, for titles and links) and phrase (in a
// sentence) are ours. aliases: extra words the search box matches (never shown as a name). The five owners with country pages keep them.
const COUNTRY_BY_SLUG = Object.fromEntries(COUNTRY_PAGES.map((p) => [p.slug, p]));
const fromCountry = (code, slug, aliases = "") => ({ code, slug, name: COUNTRY_BY_SLUG[slug].name, phrase: COUNTRY_BY_SLUG[slug].phrase, country: true, aliases });
export const OWNER_PAGES = [
  fromCountry("US", "united-states", "USA America"),
  fromCountry("CIS", "cis-former-ussr", "USSR Soviet Union"),
  fromCountry("PRC", "china", "China"),
  fromCountry("UK", "united-kingdom", "Britain Great Britain"),
  { code: "FR", slug: "france", name: "France", phrase: "France" },
  fromCountry("JPN", "japan"),
  { code: "IND", slug: "india", name: "India", phrase: "India" },
  { code: "ITSO", slug: "intelsat", name: "INTELSAT", phrase: "INTELSAT" },
  { code: "ESA", slug: "european-space-agency", name: "ESA", phrase: "the European Space Agency" },
  { code: "GER", slug: "germany", name: "Germany", phrase: "Germany" },
  { code: "IT", slug: "italy", name: "Italy", phrase: "Italy" },
  { code: "GLOB", slug: "globalstar", name: "Globalstar", phrase: "Globalstar" },
  { code: "CA", slug: "canada", name: "Canada", phrase: "Canada" },
  { code: "SKOR", slug: "south-korea", name: "South Korea", phrase: "South Korea", aliases: "South Korea" },
  { code: "SES", slug: "ses", name: "SES", phrase: "SES" },
  { code: "ORB", slug: "orbcomm", name: "ORBCOMM", phrase: "ORBCOMM" },
  { code: "SPN", slug: "spain", name: "Spain", phrase: "Spain" },
  { code: "EUTE", slug: "eutelsat", name: "EUTELSAT", phrase: "EUTELSAT" },
  { code: "TURK", slug: "turkiye", name: "Türkiye", phrase: "Türkiye", aliases: "Turkey Turkiye" },
  { code: "AUS", slug: "australia", name: "Australia", phrase: "Australia" },
  { code: "ROC", slug: "taiwan", name: "Taiwan", phrase: "Taiwan" },
  { code: "SEAL", slug: "sea-launch", name: "Sea Launch", phrase: "Sea Launch" },
  { code: "ARGN", slug: "argentina", name: "Argentina", phrase: "Argentina" },
  { code: "O3B", slug: "o3b-networks", name: "O3b Networks", phrase: "O3b Networks" },
].map((p) => ({ aliases: "", country: false, ...p, file: `satellites-by-country/${p.slug}/index.html` }));
// the owner pages that are new (the five country pages are built with the satellite pages); hosting/lib.php allows exactly these slugs
export const NEW_OWNER_PAGES = OWNER_PAGES.filter((p) => !p.country);
export const ownerPage = (code) => OWNER_PAGES.find((p) => p.code === code) || null;

const ACTIVE = new Set(ACTIVE_STATUSES);
const KINDS = ["act", "inact", "rb", "deb", "unk"];
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const int = (v) => Number.isInteger(v) && v >= 0;
const fail = (msg) => { throw new Error(`objects: ${msg}`); };
const ms = (now) => (now instanceof Date ? now.getTime() : now);

// Active satellites (payload, status 1 to 5, the count page's definition) in the satellites feed, by owner code. "" is "no owner recorded".
export function fastActiveByCode({ meta, details }) {
  if (!meta || !int(meta.count) || details.length !== meta.count * 8) fail("the satellite data's details.bin does not match its meta");
  const codes = meta.ownerCodes || [];
  const out = new Map();
  let total = 0;
  for (let i = 0; i < meta.count; i++) {
    const d = unpackDetails(details, i);
    if (d.type !== 0 || !ACTIVE.has(d.status)) continue;
    const code = d.owner ? codes[d.owner - 1] || "" : "";
    out.set(code, (out.get(code) || 0) + 1);
    total++;
  }
  return { byCode: out, total };
}

// The summary the pages are built from. summary: the parsed summary.json; paths: { "<file name>": "<path in the live folder>" } from the
// manifest; fast: { meta, details } of the satellites feed or null. Throws StaleError when the catalogue is too old (unless allowStale),
// and an ordinary error when the summary fails a check. warnings: what was left out and why.
export function summariseObjects({ summary, paths = {}, fast = null }, { now, allowStale = false, bounds = OBJECT_BOUNDS } = {}) {
  if (!summary || summary.schema !== 1 || !summary.totals || !Array.isArray(summary.owners)) fail("the catalogue summary is not schema 1");
  const catMs = parseTime(summary.sourceTime);
  if (!Number.isFinite(catMs)) fail(`the catalogue time "${String(summary.sourceTime).slice(0, 40)}" is not a time`);
  if (catMs > ms(now) + 3600000) fail(`the catalogue time ${isoZ(catMs)} is in the future`);
  const stale = ms(now) - catMs > OBJECTS_MAX_AGE_HOURS * 3600000;
  if (stale && !allowStale) throw new StaleError(`satcat data from ${isoZ(catMs)} is more than ${OBJECTS_MAX_AGE_HOURS} hours old`);
  const t = summary.totals;
  for (const k of [...KINDS, "total"]) if (!int(t[k])) fail(`the total ${k} is not a count`);
  if (KINDS.reduce((s, k) => s + t[k], 0) !== t.total) fail("the kinds do not add up to the total");
  if (t.total < bounds.min || t.total > bounds.max) fail(`${t.total} objects in Earth orbit is implausible (expected ${bounds.min} to ${bounds.max})`);
  const owners = summary.owners.map((o) => {
    for (const k of [...KINDS, "total"]) if (!int(o[k])) fail(`owner ${o.code}: ${k} is not a count`);
    if (KINDS.reduce((s, k) => s + o[k], 0) !== o.total) fail(`owner ${o.code}: the kinds do not add up to its total`);
    return { ...o, away: o.away || {}, path: o.file && paths[o.file] ? paths[o.file] : null, fast: null };
  });
  if (owners.reduce((s, o) => s + o.total, 0) !== t.total) fail("the owners do not add up to the total");
  if (new Set(owners.map((o) => o.code)).size !== owners.length) fail("an owner code is listed twice");
  const warnings = [];
  let fastInfo = null;
  if (fast) {
    const satMs = parseTime(fast.meta && fast.meta.taken);
    if (!Number.isFinite(satMs)) warnings.push("the satellite data has no readable time, so its active counts are left out");
    else if (ms(now) - satMs > FAST_MAX_AGE_HOURS * 3600000 && !allowStale) warnings.push(`the satellite data from ${isoZ(satMs)} is more than ${FAST_MAX_AGE_HOURS} hours old, so its active counts are left out`);
    else {
      const f = fastActiveByCode(fast);
      fastInfo = { time: isoZ(satMs), total: f.total, notRecorded: f.byCode.get("") || 0 };
      for (const o of owners) o.fast = f.byCode.get(o.code) || 0;
      // an owner with active satellites in the orbit data but nothing in the catalogue copy (a new owner code) still gets a row
      for (const [code, n] of f.byCode) if (code && !owners.some((o) => o.code === code)) owners.push({ code, name: code, act: 0, inact: 0, rb: 0, deb: 0, unk: 0, total: 0, away: {}, decayed: 0, dec365: 0, new365: 0, noElements: 0, actNoElements: 0, file: null, path: null, fast: n });
    }
  } else warnings.push("there is no satellite data, so the active counts in the orbit data are left out");
  const catTime = isoZ(catMs);
  const dataTime = fastInfo && parseTime(fastInfo.time) > catMs ? fastInfo.time : catTime;
  // ranks by objects in Earth orbit and by debris, among owners that have any (ties share the next rank down: 1, 2, 2, 4)
  const rankBy = (key) => { const sorted = owners.filter((o) => o[key] > 0).map((o) => o[key]).sort((a, b) => b - a); return (o) => (o[key] > 0 ? sorted.indexOf(o[key]) + 1 : null); };
  const rTotal = rankBy("total"), rDeb = rankBy("deb");
  for (const o of owners) { o.rank = rTotal(o); o.debRank = rDeb(o); o.page = ownerPage(o.code); }
  owners.sort((a, b) => b.total - a.total || b.decayed - a.decayed || a.code.localeCompare(b.code, "en"));
  const withObjects = owners.filter((o) => o.total > 0);
  return {
    catTime, satTime: fastInfo ? fastInfo.time : null, dataTime, stale, warnings,
    totals: { ...t, away: t.away || 0 }, fast: fastInfo, owners, owned: withObjects.length, withDebris: owners.filter((o) => o.deb > 0).length,
    payloadStatus: summary.payloadStatus || {}, debrisCheck: summary.debrisOwnerCheck || null, rows: summary.rows,
  };
}

// ---------------------------------------------------------------- one owner's objects, from its detail file
export const ROW_FIELDS = ["id", "name", "intl", "type", "status", "launch", "period", "incl", "apogee", "perigee", "rcs", "data"];
export const TYPE_NAMES = { P: "Satellite", R: "Rocket body", D: "Debris", U: "Unknown" };
// CelesTrak's status codes (https://celestrak.org/satcat/status.php, recorded in docs/feature-sources.md)
export const STATUS_TEXT = { "+": "Operational", "-": "Not operational", P: "Partially operational", B: "Backup", S: "Spare", X: "Extended mission", D: "Decayed", "?": "Unknown", "": "None recorded" };
export const ORBIT_KEYS = ["low", "medium", "geostationary", "highElliptical", "beyond", "none"];

// The orbit group of site/satcount.mjs (ORBIT_BOUNDS) from perigee and apogee in km: high elliptical first (eccentricity from the two
// heights and the same Earth radius), then by mean altitude. "none" when the catalogue gives no heights.
export function orbitFromApsides(perigee, apogee) {
  if (!fin(perigee) || !fin(apogee)) return "none";
  const a = SWARM_EARTH_RADIUS_KM + (perigee + apogee) / 2;
  const ecc = a > 0 ? (apogee - perigee) / (2 * a) : 0;
  if (ecc >= ORBIT_BOUNDS.ellipticalAt) return "highElliptical";
  const alt = (perigee + apogee) / 2;
  if (alt < ORBIT_BOUNDS.lowBelow) return "low";
  if (alt < ORBIT_BOUNDS.mediumBelow) return "medium";
  if (alt <= ORBIT_BOUNDS.geoUpTo) return "geostationary";
  return "beyond";
}

const kindOf = (r) => (r.type === "P" ? (ACTIVE_CODES.has(r.status) ? "act" : "inact") : { R: "rb", D: "deb" }[r.type] || "unk");
const ACTIVE_CODES = new Set(["+", "P", "B", "S", "X"]);
// the launch of an object: the first 8 characters of its international designator ("1999-025ABC" -> "1999-025")
export const launchOfIntl = (intl) => String(intl || "").slice(0, 8);
const byLaunchDesc = (a, b) => String(b.launch).localeCompare(String(a.launch)) || b.id - a.id;
const byRcsDesc = (a, b) => (fin(b.rcs) ? b.rcs : -1) - (fin(a.rcs) ? a.rcs : -1) || a.id - b.id;

// Reads a detail file (o-<code>.json): checks its shape against the owner's counts in the summary and returns the rows as objects.
export function readDetail(doc, owner, catTime) {
  if (!doc || doc.schema !== 1 || doc.owner !== owner.code || !Array.isArray(doc.rows) || JSON.stringify(doc.fields) !== JSON.stringify(ROW_FIELDS)) fail(`the detail file for ${owner.code} is not schema 1 for that owner`);
  if (doc.sourceTime !== catTime && isoZ(parseTime(doc.sourceTime)) !== catTime) fail(`the detail file for ${owner.code} is from ${doc.sourceTime}, not the summary's ${catTime}`);
  const rows = doc.rows.map((r) => Object.fromEntries(ROW_FIELDS.map((f, i) => [f, r[i]])));
  if (rows.length !== owner.total) fail(`the detail file for ${owner.code} has ${rows.length} objects, the summary ${owner.total}`);
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const r of rows) {
    if (!int(r.id) || !TYPE_NAMES[r.type]) fail(`the detail file for ${owner.code} has a bad row`);
    counts[kindOf(r)]++;
  }
  for (const k of KINDS) if (counts[k] !== owner[k]) fail(`the detail file for ${owner.code} has ${counts[k]} ${k}, the summary ${owner[k]}`);
  return rows;
}

// Everything an owner's page computes from its objects.
export function ownerDetail(rows, { catTime, staticRows = STATIC_ROWS, allMax = STATIC_ALL_MAX } = {}) {
  const orbits = Object.fromEntries(ORBIT_KEYS.map((k) => [k, { sat: 0, rb: 0, deb: 0, unk: 0 }]));
  const decades = new Map();
  let undated = 0;
  const groups = new Map();
  for (const r of rows) {
    const col = r.type === "P" ? "sat" : r.type === "R" ? "rb" : r.type === "D" ? "deb" : "unk";
    orbits[orbitFromApsides(r.perigee, r.apogee)][col]++;
    const y = /^\d{4}/.test(r.launch || "") ? Number(r.launch.slice(0, 4)) : null;
    if (y === null) undated++;
    else {
      const d = Math.floor(y / 10) * 10;
      if (!decades.has(d)) decades.set(d, { decade: d, sat: 0, other: 0 });
      decades.get(d)[r.type === "P" ? "sat" : "other"]++;
    }
    if (r.type === "D") {
      const l = launchOfIntl(r.intl);
      if (!groups.has(l)) groups.set(l, { launch: l, count: 0, names: new Map(), date: null });
      const g = groups.get(l);
      g.count++;
      g.names.set(r.name, (g.names.get(r.name) || 0) + 1);
    }
  }
  // the launch date and the payloads of each debris group's launch, from this owner's own objects
  for (const r of rows) {
    const g = groups.get(launchOfIntl(r.intl));
    if (!g) continue;
    if (!g.date && r.launch) g.date = r.launch;
    if (r.type === "P") (g.payloads = g.payloads || []).push(r.name);
  }
  const topName = (m) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))[0][0];
  const debrisGroups = [...groups.values()].sort((a, b) => b.count - a.count || a.launch.localeCompare(b.launch)).map((g) => ({ launch: g.launch, count: g.count, date: g.date, name: topName(g.names), payloads: (g.payloads || []).sort((a, b) => a.localeCompare(b, "en")) }));
  const dated = rows.filter((r) => /^\d{4}-\d\d-\d\d$/.test(r.launch || ""));
  const oldest = dated.length ? [...dated].sort((a, b) => a.launch.localeCompare(b.launch) || a.id - b.id)[0] : null;
  const newest = dated.length ? [...dated].sort(byLaunchDesc)[0] : null;
  const withRcs = rows.filter((r) => fin(r.rcs));
  const largest = withRcs.length ? [...withRcs].sort(byRcsDesc)[0] : null;
  const withApo = rows.filter((r) => fin(r.apogee));
  const highest = withApo.length ? [...withApo].sort((a, b) => b.apogee - a.apogee || a.id - b.id)[0] : null;
  const sats = rows.filter((r) => r.type === "P").sort(byLaunchDesc);
  const debris = rows.filter((r) => r.type === "D").sort(byRcsDesc);
  const bodies = rows.filter((r) => r.type === "R").sort(byRcsDesc);
  const second = debris.length ? { kind: "debris", rows: debris.slice(0, staticRows) } : bodies.length ? { kind: "rocketBodies", rows: bodies.slice(0, staticRows) } : null;
  const year = catTime ? Number(catTime.slice(0, 4)) : null;
  return {
    count: rows.length, orbits, decades: [...decades.values()].sort((a, b) => a.decade - b.decade), undated, debrisGroups,
    // the static tables hold 2 x staticRows objects in all: when there is no second table, the satellites table takes both halves
    notable: { oldest, newest, largest, highest }, recentSats: sats.slice(0, second ? staticRows : 2 * staticRows), second,
    noRcs: rows.length - withRcs.length, noHeights: orbits.none.sat + orbits.none.rb + orbits.none.deb + orbits.none.unk,
    all: rows.length <= allMax ? [...rows].sort(byLaunchDesc) : null, oldestYear: oldest ? Number(oldest.launch.slice(0, 4)) : null,
    sats: sats.length, debris: debris.length, bodies: bodies.length, thisYear: year === null ? 0 : rows.filter((r) => String(r.launch).startsWith(String(year))).length,
  };
}

// The pages of the "objects" family of site/livepages.mjs: the ranking and every new owner page (the five country pages are satellite
// pages). homeRow false: the owner pages are not repeated in the home page's row of live pages (the ranking links them all).
// note: the fixed llms.txt note (no numbers, they change).
export const OBJECT_FEEDS = ["satcat", "satellites"];
export const OBJECT_PAGES = [
  { key: "objects", slug: "satellites-and-debris-by-country", name: "Satellites and debris by country", guide: null,
    note: "Every owner in CelesTrak's whole satellite catalogue with its active and inactive satellites, rocket bodies and debris in Earth orbit, ranked and searchable, updated daily." },
  ...NEW_OWNER_PAGES.map((p) => ({ key: `objects-${p.code}`, slug: `satellites-by-country/${p.slug}`, code: p.code, name: `${p.name}: satellites and debris`, guide: null, homeRow: false,
    note: `The objects in Earth orbit that CelesTrak's catalogue records under ${p.name}: satellites, rocket bodies and debris, by orbit and launch decade, with details of each object.` })),
].map((p) => ({ ...p, family: "objects", file: `${p.slug}/index.html`, feeds: OBJECT_FEEDS, maxAgeHours: OBJECTS_MAX_AGE_HOURS }));
