// Summaries of the fleet and events feeds for three live pages (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, sections 1
// to 3): rocket launches (The Space Devs, Launch Library 2), natural disasters (GDACS) and the Starlink fleet (CelesTrak, through the
// collector's satellite files). Pure functions over the collector's files: no HTML and no file access. Each summary has a freshness check
// (the feed's own time against the page's limit) and a plausibility guard, as in site/hazard.mjs, so a stale or broken feed never
// publishes a page. The findings ("What this means", design section 8.2) are made here too, from the summaries only. What every figure
// rests on is recorded in docs/events-pages-sources.md.
import { isoZ, parseTime, freshness, HOUR_MS } from "./hazard.mjs";
import { sameStorm } from "../src/dedupe.js";
import { unpackDetails, launchDateFromDay, swarmFromRad, SWARM_EARTH_RADIUS_KM, decodeSwarm, swarmPositionEcef, ecefToGeodetic } from "../src/core.js";
import { countSatellites, assertPlausible, ACTIVE_STATUSES } from "./satcount.mjs";
import { launchWhenText, regionName } from "./live-pages-js.mjs";
import { direction, percentText, meanAndRange, and, changeSince, topWithTies, namesCapped } from "./insight.mjs";

const DAY_MS = 24 * HOUR_MS;

// OURS: the oldest a feed's own time may be for its page (the design's values, section 3). The launch list is read once an hour, GDACS
// every 15 minutes; the satellite feed is paused for hours at a time by CelesTrak's rules, so its page allows 30 hours and shows its time.
export const EVENT_MAX_AGE_HOURS = { launches: 6, events: 6, satellites: 30 };
// NHC's list is used only to leave out the GDACS copy of a storm NHC lists, and only when it is as fresh as the storm page needs (12 hours).
export const STORMS_FOR_DEDUPE_MAX_HOURS = 12;
// Whether each source's terms are recorded as verified. None is, so these pages carry no Dataset markup (design section 2c); a test reads
// the table in docs/events-pages-sources.md and checks these match it.
export const EVENT_TERMS_VERIFIED = { launches: false, events: false, satellites: false };

// The three pages, the "events" family of site/livepages.mjs. note: the fixed llms.txt note (no numbers, they change).
export const EVENT_PAGES = [
  { key: "starlink", slug: "starlink-tracker", feeds: ["satellites"], name: "Starlink tracker", guide: "guides/satellites/index.html",
    note: "How many Starlink satellites are active, in which altitude bands and inclinations, how many were launched each month, and where the fleet was at the data time, from CelesTrak's data." },
  { key: "disasters", slug: "natural-disasters-now", feeds: ["events", "storms"], name: "Natural disasters now", guide: null,
    note: "Floods, tropical cyclones, wildfires, droughts and volcanoes that GDACS lists now and in the last 7 days, with GDACS's alert levels and a map. Earthquakes are on their own page." },
  { key: "launches", slug: "rocket-launches", feeds: ["launches"], name: "Rocket launches", guide: null,
    note: "The next rocket launches from Launch Library 2 by The Space Devs, with provider, rocket, pad, status and how exact each time is, counts for the next 30 days and a map of the pads." },
].map((p) => ({ ...p, family: "events", file: `${p.slug}/index.html`, maxAgeHours: EVENT_MAX_AGE_HOURS[p.feeds[0]] }));

const fail = (feed, msg) => { throw new Error(`events: ${feed}: ${msg}`); };
// a page that has nothing honest to show is skipped (the previous copy stays), and this is not a failure of the build
const skip = (feed, msg) => { const e = new Error(`${feed}: ${msg}`); e.skip = true; throw e; };
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const inRange = (v, lo, hi) => fin(v) && v >= lo && v <= hi;
const timeOf = (feed, s, what) => { const t = parseTime(s); if (!Number.isFinite(t)) fail(feed, `${what} "${String(s).slice(0, 40)}" is not a time`); return t; };
const str = (v) => (typeof v === "string" ? v.trim() : "");
const nowMs = (now) => (now instanceof Date ? now.getTime() : now);
// counts of a list by a key, most first, then by key
const countBy = (list, key) => {
  const m = new Map();
  for (const x of list) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), "en"));
};
const num = (n) => n.toLocaleString("en-GB");
const v = (n, one, many) => (n === 1 ? one : many);
// a country name for an ISO code, from the runtime's own region names; the code itself if there is none, "Not given" for none
// (the same function the live refresh uses, so the page and the refreshed text agree)
export const countryName = regionName;
const dateLongUtc = (ms) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(ms));

// ------------------------------------------------------------------ rocket launches (Launch Library 2, pipeline/hazards.py, launches)
// SEC, MIN and HR are exact to the second, minute and hour (src/launches.js); anything else is a month, a quarter or another rough date.
export const EXACT_PRECISIONS = ["SEC", "MIN", "HR"];
export const LAUNCH_WINDOW_DAYS = 30;
export const LAUNCH_TABLE_ROWS = 15;
// the collector refuses a launch dated outside this range around the time it reads the list (pipeline/hazards.py, LL2_DATE_WINDOW_DAYS)
const LL2_WINDOW_DAYS = [-3, 800];

export function summariseLaunches(doc, { now, allowStale = false } = {}) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.launches)) fail("launches", "the file has no launches list");
  const gen = timeOf("launches", doc.generated, "generated");
  if (doc.launches.length === 0) fail("launches", "the list is empty (the collector refuses an empty answer, so the file is broken)");
  const list = doc.launches.map((l, i) => {
    if (!l || typeof l !== "object") fail("launches", `launch ${i} is not a record`);
    const name = str(l.name);
    if (!name) fail("launches", `launch ${i} has no name`);
    const net = timeOf("launches", l.net, `${name} time`);
    if (net < gen + LL2_WINDOW_DAYS[0] * DAY_MS || net > gen + LL2_WINDOW_DAYS[1] * DAY_MS) fail("launches", `${name} is dated ${isoZ(net)}, far from the list's own time`);
    const hasPos = l.lat !== null && l.lat !== undefined;
    if (hasPos && !(inRange(l.lat, -90, 90) && inRange(l.lon, -180, 180))) fail("launches", `${name} has an impossible pad position`);
    return {
      id: str(l.id), name, net, precision: str(l.precision), precisionName: str(l.precisionName), status: str(l.status), statusName: str(l.statusName),
      provider: str(l.provider), rocket: str(l.rocket), mission: str(l.mission), missionType: str(l.missionType), orbit: str(l.orbit), pad: str(l.pad),
      location: str(l.location), country: /^[A-Z]{2,3}$/.test(str(l.country)) ? str(l.country) : "", lat: hasPos ? l.lat : null, lon: hasPos ? l.lon : null,
    };
  }).sort((a, b) => a.net - b.net || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stale = freshness("launches", gen, now, { allowStale, maxAgeHours: EVENT_MAX_AGE_HOURS.launches });
  const exact = (l) => EXACT_PRECISIONS.includes(l.precision);
  const pub = (l) => l && { ...l, net: isoZ(l.net), exact: exact(l), when: launchWhenText({ net: isoZ(l.net), precision: l.precision, precisionName: l.precisionName }) };
  // the same rule as launchesHeadline in site/live-pages-js.mjs, so the live refresh and the page agree
  const upcoming = list.filter((l) => l.net >= gen);
  const passed = list.filter((l) => l.net < gen);
  const end = gen + LAUNCH_WINDOW_DAYS * DAY_MS;
  const in30 = upcoming.filter((l) => l.net < end);
  const sites = new Map();
  for (const l of in30) {
    if (l.lat === null) continue;
    const k = `${l.pad}|${l.location}|${l.lat}|${l.lon}`;
    if (!sites.has(k)) sites.set(k, { pad: l.pad, location: l.location, country: l.country, lat: l.lat, lon: l.lon, count: 0 });
    sites.get(k).count++;
  }
  const nextExact = upcoming.find(exact) || null;
  return {
    feed: "launches", dataTime: isoZ(gen), stale, total: Number.isInteger(doc.total) ? doc.total : null, listed: list.length,
    upcoming: upcoming.map(pub), next: pub(upcoming[0]) || null, nextExact: pub(nextExact),
    nextExactHours: nextExact ? Math.round((nextExact.net - gen) / HOUR_MS) : null,
    in30: in30.length, exact30: in30.filter(exact).length, exactUpcoming: upcoming.filter(exact).length,
    in24exact: upcoming.filter((l) => exact(l) && l.net < gen + DAY_MS).map(pub),
    byProvider: countBy(in30, (l) => l.provider || "Not given"), byCountry: countBy(in30, (l) => l.country),
    sites: [...sites.values()].sort((a, b) => b.count - a.count || a.pad.localeCompare(b.pad, "en")), noCoords: in30.filter((l) => l.lat === null).length,
    passed: passed.map(pub), windowShort: upcoming.length > 0 && upcoming[upcoming.length - 1].net < end,
    last: upcoming.length ? isoZ(upcoming[upcoming.length - 1].net) : null,
    precisions: countBy(upcoming, (l) => l.precisionName || l.precision || "Not given"), statuses: countBy(upcoming, (l) => l.statusName || l.status || "Not given"),
  };
}

// ------------------------------------------------------------------ natural disasters (GDACS, pipeline/validate.py, gdacs)
// The app's own names for GDACS's type codes (src/panels.js). Earthquakes are left out: the earthquake page covers them from USGS.
export const GDACS_TYPES = { TC: "Tropical cyclone", FL: "Flood", WF: "Wildfire", DR: "Drought", VO: "Volcano" };
export const GDACS_PLURAL = { TC: "tropical cyclones", FL: "floods", WF: "wildfires", DR: "droughts", VO: "volcanoes" };
export const GDACS_TYPE_ORDER = ["TC", "FL", "WF", "DR", "VO"];
export const ALERTS = ["Red", "Orange", "Green"];
// the collector's window for an ended event (pipeline/config.py, GDACS_RECENT_DAYS) and its cap on the list (pipeline/validate.py)
export const GDACS_RECENT_DAYS = 7;
export const GDACS_MAX_EVENTS = 300;
const ALL_TYPES = new Set(["EQ", ...GDACS_TYPE_ORDER]);

// list: events.json; dataTime: the feed's own time (the manifest's sourceTime: when GDACS last changed any listed event); storms: NHC's
// storms.json or null.
export function summariseDisasters(list, { now, allowStale = false, dataTime, storms = null } = {}) {
  if (!Array.isArray(list)) fail("events", "the file is not a list of events");
  const t = timeOf("events", dataTime, "the data time");
  if (list.length === 0) fail("events", "the list is empty (the collector refuses an empty answer when it had events before)");
  const all = list.map((e, i) => {
    if (!e || typeof e !== "object") fail("events", `event ${i} is not a record`);
    if (!ALL_TYPES.has(e.type)) fail("events", `event ${i} has the unknown type ${String(e.type).slice(0, 10)}`);
    if (!ALERTS.includes(e.alert)) fail("events", `event ${i} has the unknown alert level ${String(e.alert).slice(0, 10)}`);
    if (!inRange(e.lat, -90, 90) || !inRange(e.lon, -180, 180)) fail("events", `event ${i} has an impossible position`);
    const name = str(e.name).replace(/[,\s]+$/, "");
    if (!name) fail("events", `event ${i} has no name`);
    return {
      id: str(e.id), type: e.type, name, alert: e.alert, country: str(e.country).replace(/[,\s]+$/, ""), from: timeOf("events", e.from, `${name} start`), to: timeOf("events", e.to, `${name} end`),
      current: e.current === true, lat: e.lat, lon: e.lon, severity: str(e.severity), url: typeof e.url === "string" && /^https:\/\/www\.gdacs\.org\//.test(e.url) ? e.url : null,
    };
  });
  const stale = freshness("events", t, now, { allowStale, maxAgeHours: EVENT_MAX_AGE_HOURS.events });
  const eq = all.filter((e) => e.type === "EQ").length;
  const rest = all.filter((e) => e.type !== "EQ");
  // NHC's storms, when its list is fresh enough: their GDACS copies are left out (the storm page shows them), with src/dedupe.js's rule
  let nhc = [], stormsNote = "NHC's storm list was not available in this build, so no cyclone was matched with it";
  if (storms && Array.isArray(storms.storms) && Number.isFinite(parseTime(storms.generated))) {
    if (allowStale || nowMs(now) - parseTime(storms.generated) <= STORMS_FOR_DEDUPE_MAX_HOURS * HOUR_MS) { nhc = storms.storms.filter((s) => s && typeof s === "object"); stormsNote = null; }
    else stormsNote = `NHC's storm list was older than ${STORMS_FOR_DEDUPE_MAX_HOURS} hours, so no cyclone was matched with it`;
  }
  const dupes = rest.filter((e) => e.type === "TC" && nhc.some((s) => sameStorm(s, e)));
  const keep = rest.filter((e) => !dupes.includes(e));
  const recentFrom = t - GDACS_RECENT_DAYS * DAY_MS;
  const current = keep.filter((e) => e.current);
  const recent = keep.filter((e) => !e.current && e.to >= recentFrom);
  const shown = [...current, ...recent];
  const tally = (l) => GDACS_TYPE_ORDER.map((type) => {
    const of = l.filter((e) => e.type === type);
    return { type, name: GDACS_TYPES[type], Red: of.filter((e) => e.alert === "Red").length, Orange: of.filter((e) => e.alert === "Orange").length, Green: of.filter((e) => e.alert === "Green").length, total: of.length };
  });
  const level = (l, a) => l.filter((e) => e.alert === a).length;
  const order = (a, b) => ALERTS.indexOf(a.alert) - ALERTS.indexOf(b.alert) || Number(b.current) - Number(a.current) || b.to - a.to || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id);
  const pub = (e) => ({ ...e, from: isoZ(e.from), to: isoZ(e.to) });
  return {
    feed: "events", dataTime: isoZ(t), stale, listed: all.length, atCap: all.length >= GDACS_MAX_EVENTS, earthquakesLeftOut: eq,
    olderLeftOut: keep.length - shown.length, stormsNote, duplicates: dupes.map((e) => ({ name: e.name, nhc: String((nhc.find((s) => sameStorm(s, e)) || {}).name || "").trim() || "an unnamed storm" })),
    current: current.length, recent: recent.length, currentByType: tally(current), recentByType: tally(recent),
    currentRed: level(current, "Red"), currentOrange: level(current, "Orange"), currentGreen: level(current, "Green"),
    recentRed: level(recent, "Red"), recentOrange: level(recent, "Orange"),
    alerted: shown.filter((e) => e.alert !== "Green").sort(order).map(pub),
    greenByType: GDACS_TYPE_ORDER.map((type) => ({ type, name: GDACS_TYPES[type], events: shown.filter((e) => e.alert === "Green" && e.type === type).sort(order).map(pub) })).filter((g) => g.events.length),
    points: shown.map((e) => ({ lat: e.lat, lon: e.lon, type: e.type, alert: e.alert, name: e.name, current: e.current })),
    // each place a current event names, counted once per event: GDACS lists several places in one field ("Papua New Guinea, Indonesia")
    countries: countBy(current.flatMap((e) => [...new Set(e.country.split(",").map((c) => c.trim()).filter(Boolean))]), (c) => c), noCountry: shown.filter((e) => !e.country).length,
  };
}

// ------------------------------------------------------------------ the Starlink fleet (CelesTrak through the collector's satellite files)
// Starlink: display kind 1 in swarm.bin, which the collector gives an object whose catalogue name contains STARLINK (the rule
// site/satcount.mjs and the app use). Active: the statuses of site/satcount.mjs.
export const STARLINK_KIND = 1;
// OURS: a guard against a broken feed, not a content rule. There were 11,149 active Starlink satellites in the bundled snapshot of
// 2026-10-04; fewer than this many means the feed or its kind codes are broken, and the page is skipped (the previous copy stays).
export const STARLINK_MIN = 1000;
export const ALT_BAND_KM = 10;
export const MONTHS_SHOWN = 24;
export const TOP_DAYS = 5;
const ACTIVE = new Set(ACTIVE_STATUSES);

// The mean altitude in km of a near-circular orbit with this mean motion (radians per minute): the semi-major axis minus the equatorial
// radius the swarm decoder uses, exactly as orbitClass in site/satcount.mjs works it out.
export const meanAltitudeKm = (nRadPerMin) => swarmFromRad(0, nRadPerMin, 0, 0, 0, 0, 0).a - SWARM_EARTH_RADIUS_KM;
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);

export function summariseStarlink({ meta, details, swarm }, { now, allowStale = false, bounds, min = STARLINK_MIN } = {}) {
  if (!meta || typeof meta !== "object") fail("satellites", "the satellite meta is missing");
  const counts = countSatellites({ meta, details, swarm });
  // the same guard as the satellite count page: a broken feed never publishes
  assertPlausible(counts, bounds);
  const taken = timeOf("satellites", meta.taken, "the data time");
  if (typeof meta.ref !== "number" || !Number.isFinite(meta.ref)) fail("satellites", "the meta has no reference time (ref), so positions cannot be worked out");
  const stale = freshness("satellites", taken, now, { allowStale, maxAgeHours: EVENT_MAX_AGE_HOURS.satellites });
  const n = meta.count;
  const ab = swarm.buffer.slice(swarm.byteOffset, swarm.byteOffset + swarm.byteLength);
  const f32 = new Float32Array(ab, 0, n * 2), u16 = new Uint16Array(ab, n * 8, n * 6);
  // launched in the 30 days that end with the data day (that day included), from each satellite's launch day; the collector's newIdx
  // (used by the count page) reaches one day further back, 30 days before the reference day plus that day
  const dataDay = Date.UTC(new Date(taken).getUTCFullYear(), new Date(taken).getUTCMonth(), new Date(taken).getUTCDate());
  const last30From = dataDay - 29 * DAY_MS;
  const bands = new Map(), incl = new Map(), months = new Map(), days = new Map(), points = [];
  let count = 0, last30 = 0, noLaunch = 0;
  const at = new Date(taken);
  for (let i = 0; i < n; i++) {
    const d = unpackDetails(details, i);
    if (d.type !== 0 || !ACTIVE.has(d.status) || u16[i * 6 + 5] !== STARLINK_KIND) continue;
    count++;
    const alt = meanAltitudeKm(f32[i * 2 + 1]);
    const band = Math.floor(alt / ALT_BAND_KM) * ALT_BAND_KM;
    bands.set(band, (bands.get(band) || 0) + 1);
    const deg = Math.round((u16[i * 6 + 1] / 65535) * 180);
    incl.set(deg, (incl.get(deg) || 0) + 1);
    const day = launchDateFromDay(d.launchDay);
    if (day && day.getTime() >= last30From && day.getTime() <= dataDay) last30++;
    if (day) {
      const k = monthKey(day.getTime()); months.set(k, (months.get(k) || 0) + 1);
      const dk = day.toISOString().slice(0, 10); days.set(dk, (days.get(dk) || 0) + 1);
    } else noLaunch++;
    const [s] = decodeSwarm(f32.subarray(i * 2, i * 2 + 2), u16.subarray(i * 6, i * 6 + 6), meta.ref);
    const p = swarmPositionEcef(s, at), g = ecefToGeodetic(p.x, p.y, p.z);
    if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) points.push([Math.max(-90, Math.min(90, g.lat)), Math.max(-180, Math.min(180, g.lon))]);
  }
  if (count < min) skip("satellites", `${num(count)} active Starlink ${v(count, "satellite", "satellites")} in the data, under the page's minimum of ${num(min)} (a guard against a broken feed)`);
  if (count > counts.active) fail("satellites", "more Starlink satellites than active satellites");
  const sortedBands = [...bands.keys()].sort((a, b) => a - b);
  const bandRows = [];
  for (let b = sortedBands[0]; b <= sortedBands[sortedBands.length - 1]; b += ALT_BAND_KM) bandRows.push({ from: b, to: b + ALT_BAND_KM, count: bands.get(b) || 0 });
  // the 24 calendar months up to and including the month of the data time
  const d0 = new Date(taken), monthRows = [];
  for (let k = MONTHS_SHOWN - 1; k >= 0; k--) {
    const key = monthKey(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k, 1));
    monthRows.push({ month: key, count: months.get(key) || 0 });
  }
  // the 12 complete months before the data time's month, for the launch pace finding
  const complete = monthRows.slice(-13, -1);
  return {
    feed: "satellites", dataTime: isoZ(taken), stale, starlink: count, active: counts.active, share: counts.active ? count / counts.active : 0,
    bands: bandRows, occupiedBands: bandRows.filter((b) => b.count).length, topBands: topWithTies([...bandRows].filter((b) => b.count).sort((a, b) => b.count - a.count || a.from - b.from), 3),
    lowest: bandRows[0].from, highest: bandRows[bandRows.length - 1].to,
    inclinations: [...incl].map(([deg, c]) => ({ deg, count: c })).sort((a, b) => b.count - a.count || a.deg - b.deg),
    months: monthRows, monthsTotal: monthRows.reduce((s, m) => s + m.count, 0), completeMonths: complete, noLaunchDate: noLaunch,
    last30, last30From: isoZ(last30From), topDays: topWithTies([...days].map(([day, c]) => ({ day, count: c })).sort((a, b) => b.count - a.count || b.day.localeCompare(a.day)), TOP_DAYS),
    points,
  };
}

// ------------------------------------------------------------------ findings ("What this means", design section 8.2)
// Each returns up to six { text, numbers, quoted } items: plain sentences from the summary (and the previous build's history entry, when
// there is one). numbers lists every number the sentence prints, each taken from the summary or worked out from it (never read back from
// the sentence), and quoted the names from the feed (which can hold digits), so a test can check that the sentence prints nothing else.
// A top entry is never picked alone when others tie with it: they are named together ("joint most"), three at most and then a count.
// previous: { dataTime, values } from history.json, or null.
const at = (iso) => `${dateLongUtc(Date.parse(iso))}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;
// the numbers `at` prints, from the time itself: day, year, hours, minutes
const atNums = (iso) => { const d = new Date(iso); return [d.getUTCDate(), d.getUTCFullYear(), d.getUTCHours(), d.getUTCMinutes()]; };
// the numbers launchWhenText prints for a launch, from its planned time and precision
const whenNums = (l) => { const d = new Date(l.net); return ["SEC", "MIN"].includes(l.precision) ? atNums(l.net) : l.precision === "HR" ? [d.getUTCDate(), d.getUTCFullYear(), d.getUTCHours(), 0] : l.precision === "D" || /^day$/i.test(l.precisionName || "") ? [d.getUTCDate(), d.getUTCFullYear()] : [d.getUTCFullYear(), ...(/[12]/.test(l.precisionName || "") ? [1, 2] : [])]; };
const changeText = (what, nowV, prev, key) => {
  const c = prev && prev.values ? changeSince(nowV, prev.values[key]) : null;
  if (!c) return null;
  return { text: `${what}: ${num(c.now)}, against ${num(c.before)} in the previous build of this page (data as of ${at(prev.dataTime)}), ${c.word === "about the same as" ? "about the same" : c.word === "above" ? "more" : "fewer"}.`, numbers: [c.now, c.before, ...atNums(prev.dataTime)] };
};
// "X has the most ..." or "X and Y have the joint most ..., N each"; tied: the rows that share the top count (topWithTies), label: a name
const most = (tied, label, more) => ({ names: namesCapped(tied.map(label), 3, more), one: tied.length === 1, extra: tied.length > 3 ? [tied.length - 3] : [] });

export function launchFindings(s, previous = null) {
  const out = [];
  if (!s.in30) out.push({ text: `No launch in the list is planned in the ${LAUNCH_WINDOW_DAYS} days after the data time.`, numbers: [LAUNCH_WINDOW_DAYS] });
  else {
    const tied = topWithTies(s.byProvider, 1), top = tied[0], m = most(tied, (x) => x.name, "more providers"), pct = percentText(top.count, s.in30);
    const quoted = tied.slice(0, 3).map((x) => x.name);
    if (s.byProvider.length === 1) out.push({ quoted, text: `All ${num(s.in30)} ${v(s.in30, "launch", "launches")} planned in the ${LAUNCH_WINDOW_DAYS} days after the data time ${v(s.in30, "comes", "come")} from ${top.name}.`, numbers: [s.in30, LAUNCH_WINDOW_DAYS] });
    else {
      const first = m.one ? `${top.name} has the most launches planned in the ${LAUNCH_WINDOW_DAYS} days after the data time: ${num(top.count)} of ${num(s.in30)} (${pct} percent).`
        : `${m.names} have the joint most launches planned in the ${LAUNCH_WINDOW_DAYS} days after the data time: ${num(top.count)} each of ${num(s.in30)} (${pct} percent each).`;
      const numbers = [LAUNCH_WINDOW_DAYS, top.count, s.in30, pct, ...m.extra];
      let second = "";
      // the share of the top three, only when there are more than three providers and the top tie does not already name three
      if (s.byProvider.length > 3 && tied.length < 3) {
        const t3 = topWithTies(s.byProvider, 3), sum = t3.reduce((a, x) => a + x.count, 0);
        second = t3.length === 3 ? ` The top three providers together have ${num(sum)} (${percentText(sum, s.in30)} percent).`
          : ` The ${num(t3.length)} providers with the most, counting a tie for third place, together have ${num(sum)} (${percentText(sum, s.in30)} percent).`;
        numbers.push(sum, percentText(sum, s.in30), t3.length);
      }
      out.push({ quoted, text: first + second, numbers });
    }
    const ct = topWithTies(s.byCountry, 1), c = ct[0], cm = most(ct, (x) => countryName(x.name), "more countries"), cp = percentText(c.count, s.in30);
    out.push(s.byCountry.length === 1
      ? { text: `By the country of the pad, all of them are planned from ${countryName(c.name)}.`, numbers: [] }
      : { text: `By the country of the pad, they are planned from ${num(s.byCountry.length)} ${v(s.byCountry.length, "country", "countries")}; ${cm.one ? `the country with the most is ${countryName(c.name)}, with ${num(c.count)} (${cp} percent)` : `the countries with the most are ${cm.names}, with ${num(c.count)} each (${cp} percent each)`}.`, numbers: [s.byCountry.length, c.count, cp, ...cm.extra] });
    const rough = s.in30 - s.exact30;
    out.push({ text: `${num(s.exact30)} of these ${num(s.in30)} ${v(s.exact30, "has", "have")} a time to the hour or better; ${rough ? `the other ${num(rough)} ${v(rough, "has", "have")} only a month, a quarter or another rough date, so ${v(rough, "its day is", "their days are")} not set and ${v(rough, "it", "they")} can fall later` : "none has only a month or a quarter"}.`, numbers: [s.exact30, s.in30, ...(rough ? [rough] : [])] });
  }
  if (s.nextExact) out.push({ text: `The next launch with a time to the hour or better is ${s.nextExact.name}, ${s.nextExact.when}, about ${num(s.nextExactHours)} ${v(s.nextExactHours, "hour", "hours")} after the data time.`, numbers: [s.nextExactHours, ...whenNums(s.nextExact)], quoted: [s.nextExact.name] });
  const ch = changeText(`Launches planned in the ${LAUNCH_WINDOW_DAYS} days after the data time`, s.in30, previous, "in30");
  if (ch) { ch.numbers.push(LAUNCH_WINDOW_DAYS); out.push(ch); }
  if (s.windowShort) out.push({ text: `The list our collector keeps ends at ${at(s.last)}, inside the ${LAUNCH_WINDOW_DAYS} days, so the ${LAUNCH_WINDOW_DAYS} day counts can be low.`, numbers: [LAUNCH_WINDOW_DAYS, ...atNums(s.last)] });
  return out.slice(0, 6);
}

export function disasterFindings(s, previous = null) {
  const out = [];
  const or = s.alerted.filter((e) => e.current);
  if (or.length) out.push({ text: `${num(or.length)} current ${v(or.length, "event has", "events have")} an Orange or Red alert from GDACS: ${and(or.slice(0, 3).map((e) => `${e.name} (${e.alert})`))}${or.length > 3 ? ` and ${num(or.length - 3)} more` : ""}.`, numbers: [or.length, ...(or.length > 3 ? [or.length - 3] : [])], quoted: or.slice(0, 3).map((e) => e.name) });
  else if (s.current) out.push({ text: `No current event on this page has an Orange or Red alert; all ${num(s.current)} current ${v(s.current, "event is", "events are")} Green.`, numbers: [s.current] });
  else out.push({ text: "GDACS lists no current event on this page (earthquakes are left out).", numbers: [] });
  if (s.recentRed + s.recentOrange) out.push({ text: `${num(s.recentRed + s.recentOrange)} more ${v(s.recentRed + s.recentOrange, "event", "events")} with an Orange or Red alert ${v(s.recentRed + s.recentOrange, "is", "are")} no longer current, with an end date in the ${GDACS_RECENT_DAYS} days before the data time.`, numbers: [s.recentRed + s.recentOrange, GDACS_RECENT_DAYS] });
  const types = [...s.currentByType].filter((t) => t.total).sort((a, b) => b.total - a.total || GDACS_TYPE_ORDER.indexOf(a.type) - GDACS_TYPE_ORDER.indexOf(b.type));
  if (types.length && s.current) {
    const t = types[0], tied = types.filter((x) => x.total === t.total);
    out.push(tied.length > 1
      ? { text: `${and(tied.map((x) => GDACS_PLURAL[x.type]))} are listed most among current events, with ${num(t.total)} each of ${num(s.current)}.`, numbers: [t.total, s.current] }
      : { text: `${GDACS_PLURAL[t.type].charAt(0).toUpperCase()}${GDACS_PLURAL[t.type].slice(1)} are the most listed type among current events: ${num(t.total)} of ${num(s.current)} (${percentText(t.total, s.current)} percent).`, numbers: [t.total, s.current, percentText(t.total, s.current)] });
  }
  const pt = topWithTies(s.countries, 1), c = pt[0];
  if (c && c.count >= 2) {
    const m = most(pt, (x) => x.name, "more places");
    out.push(m.one ? { text: `The place GDACS names most often among current events is ${c.name}, in ${num(c.count)} events (the names are as GDACS writes them).`, numbers: [c.count], quoted: [c.name] }
      : { text: `The places GDACS names most often among current events are ${m.names}, in ${num(c.count)} events each (the names are as GDACS writes them).`, numbers: [c.count, ...m.extra], quoted: pt.slice(0, 3).map((x) => x.name) });
  }
  out.push({ text: `${num(s.current)} ${v(s.current, "event is", "events are")} current, and ${num(s.recent)} more ${v(s.recent, "is", "are")} no longer current, with an end date in the ${GDACS_RECENT_DAYS} days before the data time.`, numbers: [s.current, s.recent, GDACS_RECENT_DAYS] });
  const ch = changeText("Current events on this page", s.current, previous, "current");
  if (ch) out.push(ch);
  return out.slice(0, 6);
}

const dayText = (day) => dateLongUtc(Date.parse(`${day}T00:00:00Z`));
const dayNums = (day) => { const [y, , d] = day.split("-").map(Number); return [d, y]; };
export function starlinkFindings(s, previous = null) {
  const out = [];
  out.push({ text: `Starlink is ${percentText(s.starlink, s.active)} percent of the active satellites in our count: ${num(s.starlink)} of ${num(s.active)}.`, numbers: [percentText(s.starlink, s.active), s.starlink, s.active] });
  const tb = s.topBands, held = tb.reduce((a, b) => a + b.count, 0);
  if (tb.length) {
    const band = (b) => `${num(b.from)} to ${num(b.to)} km (${num(b.count)})`;
    const shown = tb.slice(0, 3), named = tb.length > 3 ? `${shown.map(band).join(", ")} and ${num(tb.length - 3)} more ${v(tb.length - 3, "band", "bands")} with ${num(tb[tb.length - 1].count)} each` : and(shown.map(band));
    out.push({ text: `The ${num(tb.length)} busiest ${ALT_BAND_KM} km altitude ${v(tb.length, "band", "bands")}${tb.length > 3 ? ", counting a tie for third place," : ""} ${v(tb.length, "holds", "hold")} ${percentText(held, s.starlink)} percent of them: ${named}.`,
      numbers: [tb.length, ALT_BAND_KM, percentText(held, s.starlink), ...shown.flatMap((b) => [b.from, b.to, b.count]), ...(tb.length > 3 ? [tb.length - 3, tb[tb.length - 1].count] : [])] });
  }
  const it = topWithTies(s.inclinations, 1), i0 = it[0];
  if (i0) {
    const m = most(it, (x) => num(x.deg), "more groups"), p = percentText(i0.count, s.starlink);
    out.push(m.one ? { text: `The largest inclination group is ${num(i0.deg)} degrees, with ${num(i0.count)} satellites (${p} percent), of ${num(s.inclinations.length)} groups.`, numbers: [i0.deg, i0.count, p, s.inclinations.length] }
      : { text: `The largest inclination groups are ${m.names} degrees, with ${num(i0.count)} satellites each (${p} percent each), of ${num(s.inclinations.length)} groups.`, numbers: [...it.slice(0, 3).map((x) => x.deg), i0.count, p, s.inclinations.length, ...m.extra] });
  }
  const avg = meanAndRange(s.completeMonths.map((m) => m.count));
  if (avg && avg.n === 12) {
    const mean = Math.round(avg.mean), word = direction(s.last30, avg.mean);
    out.push({ text: `${num(s.last30)} of the active Starlink satellites were launched in the 30 days to the data day (${dayText(s.dataTime.slice(0, 10))}, included); in the 12 complete months before, an average of ${num(mean)} a month are still active (from ${num(avg.min)} to ${num(avg.max)}), so those 30 days are ${word} that average.`, numbers: [s.last30, 30, ...dayNums(s.dataTime.slice(0, 10)), 12, mean, avg.min, avg.max] });
  }
  const ch = changeText("Active Starlink satellites", s.starlink, previous, "starlink");
  if (ch) out.push(ch);
  const dt = topWithTies(s.topDays, 1), d = dt[0];
  if (d) out.push(dt.length === 1 ? { text: `The launch day with the most active Starlink satellites is ${dayText(d.day)}, with ${num(d.count)}.`, numbers: [d.count, ...dayNums(d.day)] }
    : { text: `The launch days with the most active Starlink satellites are ${namesCapped(dt.map((x) => dayText(x.day)), 3, "more days")}, with ${num(d.count)} each.`, numbers: [d.count, ...dt.slice(0, 3).flatMap((x) => dayNums(x.day)), ...(dt.length > 3 ? [dt.length - 3] : [])] });
  return out.slice(0, 6);
}

// The numbers each page keeps in history.json, for the change findings of later builds.
export const EVENT_HISTORY = {
  launches: (s) => ({ in30: s.in30, upcoming: s.upcoming.length }),
  disasters: (s) => ({ current: s.current, alerted: s.currentOrange + s.currentRed }),
  starlink: (s) => ({ starlink: s.starlink, last30: s.last30 }),
};
