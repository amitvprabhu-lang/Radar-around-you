// Summaries for the sky pages (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, sections 2, 3 and 8): tonight's sky for the
// six cities of the collector's cloud feed, the hub, and the ISS today page. Pure: no file access and no clock. Every function takes the
// time it works from as a parameter, so tests are deterministic. The astronomy is not new code: rise and set times, the Moon and the planets
// come from astronomy-engine (as the app's Tonight screen and the sky calendar use it), the viewing score and the best window from
// scoreHour and bestWindow in src/core.js (through hourSample in src/plan.js), and the ISS from SGP4 (satellite.js) with the app's pass
// finder (passesFor in src/sgp4.js, visiblePart in src/tonight.js). What each figure rests on, and what was checked against what, is in
// docs/sky-pages-sources.md.
import * as Astro from "astronomy-engine";
import { sunAltAz, bestWindow, raDecToAltAz, compassPoint, ecefToGeodetic, groundTrack } from "../src/core.js";
import { hourSample } from "../src/plan.js";
import { loadPrecise, passesFor, ecefAt } from "../src/sgp4.js";
import { visiblePart } from "../src/tonight.js";
import { moonPhaseName } from "../src/info.js";
import { freshness, isoZ, parseTime, HOUR_MS, nearestPlace, PLACE_MAX_KM } from "./hazard.mjs";
import { direction, SAME_WITHIN } from "./insight.mjs";

const DAY_MS = 24 * HOUR_MS, MIN_MS = 60e3;

// ------------------------------------------------------------------ registry facts
// The six cities of the collector's cloud feed (pipeline/config.py, clouds; names, coordinates and zones from public/cities.json).
export const SKY_CITY_IDS = ["pune", "newyork", "london", "tromso", "tokyo", "sydney"];
export const SKY_HUB_FILE = "tonights-sky/index.html";
export const skyCityFile = (id) => `tonights-sky/${id}/index.html`;
export const ISS_FILE = "iss-today/index.html";
export const ISS_ID = 25544;
// The sky family of site/livepages.mjs: the hub, one page per city and the ISS page. feeds: the first is required. daily: the page is
// also rebuilt when the UTC date changes (the night moves with the date), so build-live.mjs adds the date to its rebuild key. note: the
// fixed llms.txt line (the descriptions hold tonight's numbers).
const CITY_NAMES = { pune: "Pune", newyork: "New York", london: "London", tromso: "Tromsø", tokyo: "Tokyo", sydney: "Sydney" };
export const SKY_PAGES = [
  { key: "sky-hub", slug: "tonights-sky", feeds: ["clouds", "satellites"], name: "Tonight's sky", maxAgeHours: 6, daily: true, guide: "moon-phases/index.html",
    note: "Tonight's best viewing window, cloud, Moon and ISS passes for six cities, from MET Norway's cloud forecast and computed astronomy." },
  ...SKY_CITY_IDS.map((id) => ({ key: `sky-${id}`, city: id, slug: `tonights-sky/${id}`, feeds: ["clouds", "satellites"], name: `Tonight's sky in ${CITY_NAMES[id]}`, maxAgeHours: 6, daily: true, guide: "planets/index.html",
    note: `What is in the sky tonight in ${CITY_NAMES[id]}: the Moon, the planets, a sky chart, ISS passes and MET Norway's hourly cloud forecast with the best window.` })),
  { key: "iss", slug: "iss-today", feeds: ["satellites"], name: "ISS today", maxAgeHours: 30, daily: false, guide: "guides/satellites/index.html",
    note: "Where the International Space Station is at the satellite data time, its ground track, its orbit and its passes over six cities, computed with SGP4." },
].map((p) => ({ ...p, family: "sky", file: `${p.slug}/index.html` }));
// OURS (the design's values, section 3): the cloud forecast may be at most 6 hours old for a city page, the satellite data 30 hours for the
// ISS page (CelesTrak's rules pause it for hours), and the ISS element set at most 7 days old for any pass or position to be printed.
export const SKY_MAX_AGE_HOURS = { clouds: 6, satellites: 30 };
export const ISS_MAX_AGE_DAYS = 7;
// The app's own threshold for a best window (bestWindow in src/core.js, default 45 of 100).
export const BEST_WINDOW_THRESHOLD = 45;
// The app's rule for a planet worth a mention on the Tonight screen (src/tonight.js): at least 15 degrees up in a dark sky, magnitude 3 or brighter.
export const PLANET_MIN_ALT = 15, PLANET_MAX_MAG = 3;
// A dark sky: the Sun more than 6 degrees below the horizon, the rule findPasses and darkWindow in src/ use.
export const DARK_SUN_ALT = -6;
// OURS: stars brighter than this go on the polar chart; named stars at least this bright get a label.
export const CHART_MAG_LIMIT = 3.5, CHART_LABEL_MAG = 1.5;
// OURS: constellation figures drawn on the chart: centre at least this high, brightest star at least this bright, at most this many.
export const FIGURE_MIN_ALT = 20, FIGURE_MAX_MAG = 2.5, FIGURE_MAX = 12;
// The tests compare the Sun and Moon rise and set times of this code with the US Naval Observatory's tables (test/fixtures/usno) and
// require agreement within this many minutes. The pages quote this number, so the claim cannot drift from the test.
export const RISE_SET_CHECK_MINUTES = 1;
// The one threshold for direction words in findings (design section 8.2), shared with every live page (site/insight.mjs).
export const ABOUT_SAME = SAME_WITHIN;
export const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

export class SkyStaleError extends Error {
  constructor(message) { super(message); this.name = "StaleError"; this.stale = true; }
}
const fail = (what, msg) => { throw new Error(`sky: ${what}: ${msg}`); };
const fin = (v) => typeof v === "number" && Number.isFinite(v);

// ------------------------------------------------------------------ time formatting (pure, deterministic, cached formatters)
const fmtCache = new Map();
const fmt = (tz, opts) => {
  const k = tz + JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }));
  return fmtCache.get(k);
};
export const hm = (ms, tz) => fmt(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
// "Tue 6 Oct", built from parts so the punctuation is the same everywhere
export const dayShort = (ms, tz) => { const o = {}; for (const p of fmt(tz, { weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(ms))) o[p.type] = p.value; return `${o.weekday} ${o.day} ${o.month}`; };
export const dateLongTz = (ms, tz) => fmt(tz, { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
const dayKey = (ms, tz) => fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
// "21:47" on the same local day as ref, otherwise "Wed 7 Oct 21:47"
export const whenLocal = (ms, refMs, tz) => (dayKey(ms, tz) === dayKey(refMs, tz) ? hm(ms, tz) : `${dayShort(ms, tz)} ${hm(ms, tz)}`);
// the zone's offset from UTC at a moment, "UTC+05:30"
export function utcOffset(ms, tz) {
  const p = fmt(tz, { timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName");
  const v = p ? p.value.replace("GMT", "") : "";
  return `UTC${v || "+00:00"}`;
}
// the phase as words after "The Moon is": "a waning crescent", "full", "at first quarter"
export const moonPhrase = (name) => ({ "New Moon": "new", "Full Moon": "full", "First quarter": "at first quarter", "Last quarter": "at last quarter" })[name] || `a ${name.toLowerCase()}`;
// A local time that is shown twice when the clocks go back (the repeated hour) carries its offset, so the two can be told apart.
export function ambiguousLocal(ms, tz) {
  const t = hm(ms, tz), o = utcOffset(ms, tz);
  return [ms - HOUR_MS, ms + HOUR_MS].some((x) => hm(x, tz) === t && utcOffset(x, tz) !== o);
}
export const localText = (ms, refMs, tz) => `${whenLocal(ms, refMs, tz)}${ambiguousLocal(ms, tz) ? ` (${utcOffset(ms, tz)})` : ""}`;
// The moment the zone's offset from UTC changes between two times (a clock change), to the minute, or null.
export function clockChange(fromMs, toMs, tz) {
  const a = utcOffset(fromMs, tz), b = utcOffset(toMs, tz);
  if (a === b) return null;
  let lo = fromMs, hi = toMs;
  while (hi - lo > MIN_MS) { const mid = Math.floor((lo + hi) / 2 / MIN_MS) * MIN_MS; if (utcOffset(mid, tz) === a) lo = mid; else hi = mid; }
  return { at: hi, before: a, after: b };
}
export const durationText = (ms) => { const m = Math.round(ms / MIN_MS); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
const r1 = (x) => Math.round(x * 10) / 10;
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
// The app's 16-point compass (compassPoint in src/core.js) in words, for sentences
const WORDS = { N: "north", E: "east", S: "south", W: "west" };
export const compassWords = (az) => compassPoint(az).split("").map((ch) => WORDS[ch]).reduce((acc, w, i, all) => (all.length === 3 && i === 1 ? `${acc}-${w}` : `${acc}${w}`), "");

// ------------------------------------------------------------------ the Sun, the night window
const obsOf = (c) => new Astro.Observer(c.lat, c.lon, 0);
const riseSet = (body, obs, dir, fromMs, days) => { const r = Astro.SearchRiseSet(body, obs, dir, new Date(fromMs), days); return r ? r.date.getTime() : null; };
const altOf = (body, obs, ms) => { const d = new Date(ms); const eq = Astro.Equator(body, d, obs, true, true); const h = Astro.Horizon(d, obs, eq.ra, eq.dec, "normal"); return { alt: h.altitude, az: h.azimuth }; };

// The first local midnight in [fromMs, toMs] in the zone, on a 15 minute grid (every zone of the six cities is a whole or half hour off UTC).
export function localMidnightIn(fromMs, toMs, tz) {
  for (let t = Math.ceil(fromMs / 9e5) * 9e5; t <= toMs; t += 9e5) if (hm(t, tz) === "00:00") return t;
  return null;
}

// Tonight for a city, from a reference time (the data time): the night starts at the first sunset at or after the reference, or at the
// reference itself when the Sun is already down, and ends at the next sunrise. Sunrise and sunset are astronomy-engine's (the upper limb on
// the horizon with standard refraction, the convention the USNO tables use). Polar cases:
//   midnightSun: the Sun does not set in the 24 hours after the reference. There is no night; for the Moon, planets and cloud the page uses
//     the 12 hours around the next local midnight, flagged, and nothing in it is called dark.
//   polarNight: the Sun does not rise in the 24 hours after the night starts; the page covers those 24 hours.
export function nightWindow(city, refMs) {
  const obs = obsOf(city), sun = Astro.Body.Sun;
  const set = riseSet(sun, obs, -1, refMs, 1), rise = riseSet(sun, obs, +1, refMs, 1);
  let start, startsAtData;
  if (rise !== null && (set === null || rise < set)) { start = refMs; startsAtData = true; }
  else if (set !== null) { start = set; startsAtData = false; }
  else if (altOf(sun, obs, refMs).alt > 0) {
    const mid = localMidnightIn(refMs, refMs + 25 * HOUR_MS, city.tz) ?? refMs + 12 * HOUR_MS;
    return { kind: "midnightSun", start: mid - 6 * HOUR_MS, end: mid + 6 * HOUR_MS, sunset: null, sunrise: null, startsAtData: false, ref: refMs };
  } else { start = refMs; startsAtData = true; }
  const end = startsAtData && rise !== null ? rise : riseSet(sun, obs, +1, start, 1);
  if (end === null) return { kind: "polarNight", start, end: start + DAY_MS, sunset: startsAtData ? null : start, sunrise: null, startsAtData, ref: refMs };
  return { kind: "night", start, end, sunset: startsAtData ? null : start, sunrise: end, startsAtData, ref: refMs };
}

// The moment the polar chart shows: local midnight if it falls in the window, otherwise the middle of the window (on the 15 minute grid).
export const chartTime = (win, tz) => localMidnightIn(win.start, win.end, tz) ?? Math.round((win.start + win.end) / 2 / 9e5) * 9e5;

// Rise and set events of a body between two times, in time order.
export function riseSetBetween(body, obs, fromMs, toMs) {
  const out = [];
  for (const dir of [+1, -1]) {
    let t = fromMs;
    while (t < toMs) {
      const e = riseSet(body, obs, dir, t, (toMs - t) / DAY_MS);
      if (e === null || e > toMs) break;
      out.push({ kind: dir > 0 ? "rise" : "set", t: e });
      t = e + MIN_MS;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
// The stretches of a window in which a body is up, from its events in time order and whether it is up at the start: [{ from, to }].
export function upSpans(events, upAtStart, start, end) {
  const spans = [];
  let from = upAtStart ? start : null;
  for (const e of events) {
    if (e.kind === "rise" && from === null) from = e.t;
    else if (e.kind === "set" && from !== null) { spans.push({ from, to: e.t }); from = null; }
  }
  if (from !== null) spans.push({ from, to: end });
  return spans;
}
// Every rise and set in the window, in order, as words: "up at nightfall, sets at 18:42, rises again at 00:00".
// t: the time formatter; first: what the start of the window is called ("nightfall" or "the start").
export function eventsPhrase(events, upAtStart, t, first = "the start") {
  if (!events.length) return upAtStart ? "up all night" : "below the horizon all night";
  const parts = upAtStart ? [`up at ${first}`] : [];
  const seen = { rise: false, set: false };
  for (const e of events) {
    parts.push(`${e.kind === "rise" ? "rises" : "sets"}${seen[e.kind] || (e.kind === "rise" && upAtStart) ? " again" : ""} at ${t(e.t)}`);
    seen[e.kind] = true;
  }
  return parts.join(", ");
}

// Whether a body is above the horizon at a time, by the same rise and set convention: the next event after it is a set.
function upAt(body, obs, ms) {
  const r = riseSet(body, obs, +1, ms, 2), s = riseSet(body, obs, -1, ms, 2);
  if (r === null && s === null) return altOf(body, obs, ms).alt > 0;
  return s !== null && (r === null || s < r);
}

// ------------------------------------------------------------------ the Moon
export function moonTonight(city, win, { stepMin = 15, at = chartTime(win, city.tz) } = {}) {
  const obs = obsOf(city), moon = Astro.Body.Moon;
  const phaseDeg = Astro.MoonPhase(new Date(at));
  const illum = Astro.Illumination(moon, new Date(at)).phase_fraction;
  const track = [];
  for (let t = win.start; t <= win.end; t += stepMin * MIN_MS) track.push({ t, alt: altOf(moon, obs, t).alt });
  const peak = track.reduce((a, b) => (b.alt > a.alt ? b : a));
  return {
    at, phaseDeg, phaseName: moonPhaseName(phaseDeg), illumPct: Math.round(illum * 100), waxing: phaseDeg < 180,
    events: riseSetBetween(moon, obs, win.start, win.end).map((e) => ({ ...e, az: altOf(moon, obs, e.t).az })), upAtStart: upAt(moon, obs, win.start), upAtEnd: upAt(moon, obs, win.end),
    track, max: { t: peak.t, alt: peak.alt, az: altOf(moon, obs, peak.t).az },
  };
}

// ------------------------------------------------------------------ the five naked-eye planets
export function planetsTonight(city, win, { stepMin = 10 } = {}) {
  const obs = obsOf(city);
  const dark = win.kind !== "midnightSun";
  return PLANETS.map((name) => {
    const body = Astro.Body[name];
    let best = null, highest = null;
    for (let t = win.start; t <= win.end; t += stepMin * MIN_MS) {
      const h = altOf(body, obs, t);
      const s = { t, alt: h.alt, az: h.az };
      if (!highest || s.alt > highest.alt) highest = s;
      if (dark && sunAltAz(city.lat, city.lon, new Date(t)).alt < DARK_SUN_ALT && (!best || s.alt > best.alt)) best = s;
    }
    const at = best ? best.t : highest.t;
    let mag = null;
    try { mag = Astro.Illumination(body, new Date(at)).mag; } catch { mag = null; }
    const eq = Astro.Equator(body, new Date(at), obs, false, true);
    const wellPlaced = !!(best && best.alt >= PLANET_MIN_ALT && mag !== null && mag <= PLANET_MAX_MAG);
    return { name, mag, best: best && best.alt > 0 ? best : null, highest, wellPlaced, events: riseSetBetween(body, obs, win.start, win.end), upAtStart: upAt(body, obs, win.start), constellation: Astro.Constellation(eq.ra, eq.dec).name };
  });
}

// ------------------------------------------------------------------ the polar sky chart
// stars: decodeStars(public/stars.bin) from src/data.js; constellations: public/constellations.json (figures in degrees, J2000); starNames:
// public/starnames.json. Star and figure positions are J2000 turned to altitude and azimuth with raDecToAltAz (src/core.js, no refraction,
// no precession, as the app's sky view does); the Moon and planets come from astronomy-engine with refraction.
export function skyChartData(city, at, { stars, constellations, starNames }, { magLimit = CHART_MAG_LIMIT } = {}) {
  const obs = obsOf(city), d = new Date(at);
  const names = new Map((starNames && starNames.stars ? starNames.stars : []).map((s) => [s.i, s.name]));
  const pts = [];
  if (stars) for (let i = 0; i < stars.n; i++) {
    if (stars.mag[i] > magLimit) continue;
    const h = raDecToAltAz(stars.ra[i], stars.dec[i], city.lat, city.lon, d);
    if (h.alt <= 0) continue;
    pts.push({ i, alt: h.alt, az: h.az, mag: stars.mag[i], name: names.get(i) || null, label: stars.mag[i] <= CHART_LABEL_MAG && names.has(i) });
  }
  pts.sort((a, b) => a.mag - b.mag || a.i - b.i);
  const figures = [], up = [];
  for (const c of (constellations && constellations.constellations) || []) {
    const centre = raDecToAltAz(c.centre.ra, c.centre.dec, city.lat, city.lon, d);
    if (centre.alt > 0) up.push({ abbr: c.abbr, name: c.name, alt: centre.alt, az: centre.az });
    const bright = c.stars && c.stars.brightest ? c.stars.brightest.mag : 99;
    if (centre.alt < FIGURE_MIN_ALT || bright > FIGURE_MAX_MAG) continue;
    const segments = [];
    for (const line of c.figure || []) {
      let run = [];
      for (const [ra, dec] of line) {
        const h = raDecToAltAz(((ra % 360) + 360) % 360, dec, city.lat, city.lon, d);
        if (h.alt > 0) run.push({ alt: h.alt, az: h.az }); else { if (run.length > 1) segments.push(run); run = []; }
      }
      if (run.length > 1) segments.push(run);
    }
    if (segments.length) figures.push({ abbr: c.abbr, name: c.name, bright, centre: { alt: centre.alt, az: centre.az }, segments });
  }
  figures.sort((a, b) => a.bright - b.bright || a.abbr.localeCompare(b.abbr));
  const planets = PLANETS.map((name) => { const h = altOf(Astro.Body[name], obs, at); let mag = null; try { mag = Astro.Illumination(Astro.Body[name], d).mag; } catch { mag = null; } return { name, alt: h.alt, az: h.az, mag }; }).filter((p) => p.alt > 0);
  const m = altOf(Astro.Body.Moon, obs, at);
  const sun = altOf(Astro.Body.Sun, obs, at);
  return { at, stars: pts, named: pts.filter((s) => s.name), constellationsUp: up.sort((a, b) => b.alt - a.alt || a.abbr.localeCompare(b.abbr)), figures: figures.slice(0, FIGURE_MAX), planets, moon: m.alt > 0 ? { alt: m.alt, az: m.az, illumPct: Math.round(Astro.Illumination(Astro.Body.Moon, d).phase_fraction * 100) } : null, sunAlt: sun.alt };
}

// ------------------------------------------------------------------ the cloud forecast for the night and the best window
// clouds: the city's entry in the collector's clouds.json ({ updated, hours: [{ t, cloud, temp }] }, pipeline/validate.py).
export function checkClouds(id, c) {
  if (!c || typeof c !== "object" || !Array.isArray(c.hours)) fail(`clouds ${id}`, "the city has no forecast in the file");
  const updated = parseTime(c.updated);
  if (!Number.isFinite(updated)) fail(`clouds ${id}`, `the update time "${String(c.updated).slice(0, 40)}" is not a time`);
  if (c.hours.length < 24) fail(`clouds ${id}`, `only ${c.hours.length} forecast hours`);
  let prev = -Infinity;
  const hours = c.hours.map((h, i) => {
    const t = parseTime(h && h.t);
    if (!Number.isFinite(t)) fail(`clouds ${id}`, `hour ${i} has no time`);
    if (t <= prev) fail(`clouds ${id}`, `hour ${i} is not after the one before`);
    if (!(fin(h.cloud) && h.cloud >= 0 && h.cloud <= 100)) fail(`clouds ${id}`, `hour ${i} has cloud ${h.cloud}, outside 0 to 100`);
    prev = t;
    return { t: isoZ(t), cloud: h.cloud };
  });
  return { updated, hours };
}

// Darkness by the app's rule (the Sun more than 6 degrees below the horizon, sunAltAz in src/core.js, the function the score uses), sampled
// every minute: the first and last dark minute of the window, the Sun's lowest altitude, and whether any minute is dark at all.
export function darkness(city, win) {
  let first = null, last = null, low = Infinity;
  for (let t = win.start; t <= win.end; t += MIN_MS) {
    const a = sunAltAz(city.lat, city.lon, new Date(t)).alt;
    low = Math.min(low, a);
    if (a < DARK_SUN_ALT) { if (first === null) first = t; last = t; }
  }
  return { any: first !== null, first, last, lowestSunAlt: low };
}
const isDark = (city, t) => sunAltAz(city.lat, city.lon, new Date(t)).alt < DARK_SUN_ALT;

export function cloudNight(city, win, clouds) {
  const place = { lat: city.lat, lon: city.lon, clouds: { hours: clouds.hours } };
  const obs = obsOf(city);
  const hours = [];
  for (let t = Math.ceil(win.start / HOUR_MS) * HOUR_MS; t < win.end; t += HOUR_MS) hours.push(hourSample(place, new Date(t), 0, obs));
  const { scored, best } = bestWindow(hours, BEST_WINDOW_THRESHOLD);
  const known = scored.filter((h) => h.cloudKnown);
  const avg = (list) => (list.length ? Math.round(list.reduce((s, h) => s + h.cloud, 0) / list.length) : null);
  const inBest = best ? known.filter((h) => h.t >= best.start && h.t < best.endExclusive) : [];
  // the window is whole hours of the app's score; it ends when darkness ends (the Sun climbs past 6 degrees below the horizon) and never
  // after sunrise, so it never promises dark minutes that are twilight
  let endMs = best ? Math.min(win.end, best.endExclusive.getTime()) : null;
  if (best) for (let t = best.end.getTime(); t < endMs; t += MIN_MS) if (!isDark(city, t)) { endMs = t; break; }
  return {
    hours: scored.map((h) => ({ t: h.t.getTime(), cloud: h.cloudKnown ? Math.round(h.cloud) : null, score: h.score, sunAlt: h.sunAlt, moonAlt: h.moonAlt })),
    best: best ? { start: Math.max(win.start, best.start.getTime()), end: endMs, hours: best.n, avgScore: best.avg, cloud: avg(inBest) } : null,
    cloudAvg: avg(known), cloudMin: known.length ? Math.round(Math.min(...known.map((h) => h.cloud))) : null, cloudMax: known.length ? Math.round(Math.max(...known.map((h) => h.cloud))) : null,
    knownHours: known.length,
  };
}

// ------------------------------------------------------------------ the ISS
// precise: the collector's precise.json ({ cols, rows }). Returns the ISS record, or a reason it cannot be used.
export function issElements(precise, now) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const sat = loadPrecise(precise).get(ISS_ID);
  if (!sat) return { status: "missing", reason: "the ISS is not in this satellite data" };
  if (!Number.isFinite(sat.epochMs)) return { status: "bad", reason: "the ISS element set has no usable time" };
  const ageHours = (nowMs - sat.epochMs) / HOUR_MS;
  if (ageHours > ISS_MAX_AGE_DAYS * 24) return { status: "old", reason: `the ISS element set is from ${isoZ(sat.epochMs)}, more than ${ISS_MAX_AGE_DAYS} days old`, epoch: isoZ(sat.epochMs), ageHours };
  if (ageHours < -24) return { status: "bad", reason: "the ISS element set is dated more than a day ahead" };
  const p = ecefAt(sat, new Date(sat.epochMs));
  const g = p && ecefToGeodetic(p.x, p.y, p.z);
  if (!g || !(g.hKm > 300 && g.hKm < 500)) return { status: "bad", reason: "the ISS element set gives a height outside 300 to 500 km" };
  const row = precise.rows.find((r) => r[0] === ISS_ID);
  const col = (k) => row[precise.cols.indexOf(k)];
  return { status: "ok", sat, epoch: isoZ(sat.epochMs), ageHours, elements: { n: col("n"), e: col("e"), i: col("i") } };
}

const passOut = (p, fromMs) => {
  const v = visiblePart(p);
  return {
    // fromStart: already 10 degrees up when the window starts (the rise is earlier); truncated: still up when it ends
    fromStart: p.rise.getTime() === fromMs,
    rise: p.rise.getTime(), riseAz: p.riseAz, set: p.set.getTime(), setAz: p.setAz, max: { t: p.max.time.getTime(), el: p.max.el, az: p.max.az },
    visible: !!v, lit: v ? { from: v.first.time.getTime(), to: v.last.time.getTime(), seconds: v.seconds, maxEl: v.best.el } : null, truncated: !!p.truncated,
  };
};
// Passes at least 10 degrees up (the app's minimum) between two times, with the part that is sunlit while the sky is dark.
export function issPasses(iss, city, fromMs, hours) {
  return passesFor(iss.sat, city, new Date(fromMs), hours, { minEl: 10 }).map((p) => passOut(p, fromMs));
}

// ------------------------------------------------------------------ the direction words of the findings
// The one threshold and the one function for every live page's findings (site/insight.mjs): within 15 percent is "about the same as".
export { direction };

// ------------------------------------------------------------------ one city
// clouds: the parsed clouds.json; precise: precise.json (or null); sky: { stars, constellations, starNames }.
export function summariseCity(city, { clouds, precise = null, sky = {}, now, allowStale = false }) {
  const c = checkClouds(city.id, clouds && clouds.cities ? clouds.cities[city.id] : null);
  const stale = freshness("clouds", c.updated, now, { allowStale, maxAgeHours: SKY_MAX_AGE_HOURS.clouds });
  const win = nightWindow(city, c.updated);
  const at = chartTime(win, city.tz);
  const strip = cloudNight(city, win, c);
  const moon = moonTonight(city, win, { at });
  const planets = planetsTonight(city, win);
  const chart = skyChartData(city, at, sky);
  let iss = { status: "missing", reason: "no satellite data in this build", passes: [] };
  if (precise) {
    const e = issElements(precise, now);
    iss = e.status === "ok" ? { status: "ok", epoch: e.epoch, ageHours: e.ageHours, passes: issPasses(e, city, win.start, (win.end - win.start) / HOUR_MS) } : { ...e, passes: [] };
    delete iss.sat;
  }
  const dark = darkness(city, win);
  const s = { feed: "clouds", city, dataTime: isoZ(c.updated), stale, tz: city.tz, offset: utcOffset(win.start, city.tz), clock: clockChange(win.start, win.end, city.tz), night: win, dark,
    twilightOnly: win.kind !== "midnightSun" && !dark.any, chartAt: at, strip, moon, planets, chart, iss };
  s.summary = summarySentence(s);
  s.findings = cityFindings(s);
  return s;
}

const placeTime = (s, ms) => localText(ms, s.night.start, s.tz);
// what the start of the window is called in sentences: "nightfall" when the night starts at sunset, otherwise "the start"
// The finding for a night whose Sun never gets more than 6 degrees below the horizon (the app's darkness rule: dark means below -6). The
// depth is printed to one decimal rounded away from the horizon, so "no lower than" is true even at -5.95 (printed 6.0). null when the
// Sun does get more than 6 degrees down.
export function twilightSentence(lowestSunAlt) {
  if (!(lowestSunAlt >= DARK_SUN_ALT)) return null;
  const depth = Math.ceil(-lowestSunAlt * 10 - 1e-9) / 10;
  return `The Sun gets no lower than ${depth.toFixed(1)} degrees below the horizon tonight; the viewing score needs it more than ${-DARK_SUN_ALT} degrees below, so the sky stays in twilight, and that, not the cloud, is why there is no best window.`;
}
// How a night already under way at the forecast time is described: dark only when the Sun was more than 6 degrees down then.
export const underWayText = (s) => (sunAltAz(s.city.lat, s.city.lon, new Date(s.night.start)).alt < DARK_SUN_ALT ? "Already dark at the forecast time" : "The Sun had already set at the forecast time");
export const startWord = (s) => (s.night.kind === "night" && !s.night.startsAtData ? "nightfall" : "the start");
export function summarySentence(s) {
  const n = s.night, name = s.city.name;
  if (n.kind === "midnightSun") return `The Sun does not set in ${name} in the 24 hours after the forecast time, so the sky does not get dark tonight.`;
  if (s.twilightOnly) return `The Sun sets in ${name} tonight but never gets more than 6 degrees below the horizon, so the sky stays in twilight and no hour gets a viewing score.`;
  if (!s.strip.best) return `No stretch of tonight in ${name} reaches ${BEST_WINDOW_THRESHOLD} out of 100 on our viewing score${s.strip.cloudAvg !== null ? `; cloud averages ${s.strip.cloudAvg} percent over the night` : ""}.`;
  const b = s.strip.best;
  return `The best window tonight in ${name} is ${placeTime(s, b.start)} to ${placeTime(s, b.end)}${b.cloud !== null ? `, with ${b.cloud} percent cloud` : ""}.`;
}

// Three to six findings for a city page (design section 8.2), each a sentence from the summary only.
export function cityFindings(s) {
  const out = [], n = s.night, t = (ms) => placeTime(s, ms), m = s.moon;
  if (n.kind === "midnightSun") {
    out.push(`The Sun stays up all night here: it does not set in the 24 hours after the forecast time, so there are no dark hours tonight.`);
    const low = s.strip.hours.length ? s.strip.hours.reduce((a, h) => (h.sunAlt < a.sunAlt ? h : a)) : null;
    if (low) out.push(`Even at its lowest in these hours, at ${t(low.t)}, the Sun is ${Math.round(low.sunAlt)} degrees above the horizon.`);
    if (s.strip.cloudAvg !== null) out.push(`Cloud averages ${s.strip.cloudAvg} percent over the 12 hours around local midnight in MET Norway's forecast.`);
  } else if (n.kind === "polarNight") out.push(`The Sun does not rise here in the 24 hours from ${t(n.start)}, so this page covers those 24 hours as one long night.`);
  else out.push(`The night lasts ${durationText(n.end - n.start)}, from ${n.startsAtData ? `${t(n.start)} (the Sun was already down at the forecast time)` : `sunset at ${t(n.start)}`} to sunrise at ${t(n.end)}.`);
  if (s.twilightOnly) out.push(twilightSentence(s.dark.lowestSunAlt));
  const b = s.strip.best;
  const moonSet = m.events.find((e) => e.kind === "set");
  if (b) {
    const inside = m.events.filter((e) => e.t > b.start && e.t < b.end);
    const upAtB = s.strip.hours.find((h) => h.t >= b.start) || null;
    const moonUp = upAtB ? upAtB.moonAlt > 0 : false;
    const why = inside.length ? `the Moon ${inside.map((e) => `${e.kind === "rise" ? "rises" : "sets"} at ${t(e.t)}`).join(" and ")}, inside the window (${m.illumPct} percent lit)`
      : moonUp ? `the Moon, ${m.illumPct} percent lit, is up through the window`
      : moonSet && moonSet.t <= b.start ? `the Moon sets at ${t(moonSet.t)}, before the window starts` : "the Moon is below the horizon through the window";
    out.push(`The best window is ${t(b.start)} to ${t(b.end)}: ${why}${b.cloud !== null ? `, and the cloud forecast for it averages ${b.cloud} percent` : ""}.`);
    const d = direction(b.cloud, s.strip.cloudAvg);
    if (b.cloud !== null && s.strip.cloudAvg !== null && d) out.push(`Cloud in the best window (${b.cloud} percent) is ${d} the average for the whole night (${s.strip.cloudAvg} percent).`);
  } else if (n.kind !== "midnightSun" && !s.twilightOnly) {
    const moonBright = m.illumPct >= 50 && (m.upAtStart || m.events.some((e) => e.kind === "rise"));
    out.push(`No hour tonight reaches ${BEST_WINDOW_THRESHOLD} out of 100 on the viewing score${s.strip.cloudAvg !== null ? `: cloud averages ${s.strip.cloudAvg} percent` : ""}${moonBright ? `, and the Moon is ${m.illumPct} percent lit` : ""}.`);
  }
  const moonDoes = eventsPhrase(m.events, m.upAtStart, t, startWord(s));
  out.push(`The Moon is ${moonPhrase(m.phaseName)}, ${m.illumPct} percent lit, and ${/^(up|below)/.test(moonDoes) ? `is ${moonDoes}` : moonDoes}.`);
  const placed = s.planets.filter((p) => p.wellPlaced).sort((a, b2) => a.mag - b2.mag);
  if (placed.length) {
    const p = placed[0];
    out.push(`${p.name} is the brightest planet well placed in the dark tonight (magnitude ${r1(p.mag).toFixed(1)}), highest in the dark at ${t(p.best.t)}, ${Math.round(p.best.alt)} degrees up in the ${compassWords(p.best.az)}${placed.length > 1 ? `; ${placed.length - 1} more ${placed.length - 1 === 1 ? "planet is" : "planets are"} well placed too` : ""}.`);
  } else if (n.kind !== "midnightSun") out.push(`None of the five naked-eye planets is ${PLANET_MIN_ALT} degrees or more up in a dark sky tonight.`);
  if (s.iss.status === "ok") {
    const ps = s.iss.passes, vis = ps.filter((p) => p.visible);
    if (!ps.length) out.push("The ISS does not pass at least 10 degrees up during tonight's window.");
    else {
      const p = vis[0] || ps[0];
      out.push(vis.length ? `The first ISS pass that is sunlit while the sky is dark starts at ${t(p.lit.from)} and reaches ${Math.round(p.lit.maxEl)} degrees; ${vis.length} of tonight's ${ps.length} ${ps.length === 1 ? "pass is" : "passes are"} like that.`
        : `The ISS passes ${ps.length} ${ps.length === 1 ? "time" : "times"} tonight, first at ${t(p.rise)}, but never sunlit while the sky is dark, so it is in Earth's shadow or the sky is too bright.`);
    }
  }
  return out.slice(0, 6);
}

// The Moon at one moment, the same everywhere: phase name and lit percent (for the hub, at the newest forecast time).
export function moonAt(ms) {
  const phaseDeg = Astro.MoonPhase(new Date(ms));
  return { at: ms, phaseDeg, phaseName: moonPhaseName(phaseDeg), illumPct: Math.round(Astro.Illumination(Astro.Body.Moon, new Date(ms)).phase_fraction * 100) };
}

// ------------------------------------------------------------------ the hub
// summaries: the city summaries that exist this run, in SKY_CITY_IDS order.
export function hubFindings(summaries, { at = null } = {}) {
  const out = [];
  const withBest = summaries.filter((s) => s.strip.best && s.strip.best.cloud !== null);
  if (withBest.length) {
    const clear = [...withBest].sort((a, b) => a.strip.best.cloud - b.strip.best.cloud || a.city.name.localeCompare(b.city.name))[0];
    out.push(`${clear.city.name} has the clearest best window of the ${summaries.length} cities: ${clear.strip.best.cloud} percent cloud from ${placeTime(clear, clear.strip.best.start)} to ${placeTime(clear, clear.strip.best.end)} local time.`);
  }
  const none = summaries.filter((s) => s.night.kind !== "midnightSun" && !s.twilightOnly && !s.strip.best);
  if (none.length) out.push(`${none.length === 1 ? none[0].city.name : `${none.length} cities (${none.map((s) => s.city.name).join(", ")})`} ${none.length === 1 ? "has" : "have"} no best window tonight on the viewing score.`);
  // only whole nights, sunset to sunrise, are compared; a night already under way at the forecast time is given as what remains of it
  const full = summaries.filter((s) => s.night.kind === "night" && !s.night.startsAtData);
  const len = (s) => s.night.end - s.night.start;
  if (full.length > 1) {
    const sorted = [...full].sort((a, b) => len(b) - len(a) || a.city.name.localeCompare(b.city.name));
    out.push(`Of the ${full.length} nights measured from sunset to sunrise, the longest is in ${sorted[0].city.name} (${durationText(len(sorted[0]))}) and the shortest in ${sorted[sorted.length - 1].city.name} (${durationText(len(sorted[sorted.length - 1]))}).`);
  }
  const under = summaries.filter((s) => s.night.kind === "night" && s.night.startsAtData && !s.twilightOnly);
  if (under.length) out.push(`${under.length === 1 ? `In ${under[0].city.name} the night was` : `In ${and(under.map((s) => s.city.name))} the nights were`} already under way at the forecast time, so ${under.length === 1 ? "its page gives" : "their pages give"} the rest of the night: ${and(under.map((s) => `${durationText(len(s))} until sunrise${under.length > 1 ? ` in ${s.city.name}` : ""}`))}.`);
  for (const s of summaries.filter((x) => x.night.kind !== "night" || x.twilightOnly)) {
    out.push(s.night.kind === "midnightSun" ? `In ${s.city.name} the Sun does not set tonight, so there is no dark sky there.`
      : s.night.kind === "polarNight" ? `In ${s.city.name} the Sun does not rise in the 24 hours from the start of the night (polar night).`
      : `In ${s.city.name} the Sun sets but stays less than 6 degrees below the horizon, so the sky stays in twilight all night.`);
  }
  if (summaries.length) {
    const ref = at ?? Date.parse([...summaries.map((x) => x.dataTime)].sort().at(-1));
    const m = moonAt(ref), pcts = summaries.map((s) => s.moon.illumPct);
    const lo = Math.min(...pcts), hi = Math.max(...pcts);
    out.push(`At ${hm(ref, "UTC")} UTC on ${dateLongTz(ref, "UTC")} the Moon is ${moonPhrase(m.phaseName)}, ${m.illumPct} percent lit, as seen from anywhere; the city pages give it at each city's own chart time, ${lo === hi ? `${lo} percent` : `from ${lo} to ${hi} percent`}.`);
  }
  return out.slice(0, 6);
}

// The hub's summary: every city that can be summarised, and the reason for each that cannot. Throws a stale error when no city has a
// current forecast, and an ordinary error when none passes its checks.
export function summariseHub(cities, { clouds, precise = null, sky = {}, now, allowStale = false }) {
  const summaries = [], missing = {};
  let anyBroken = false;
  for (const c of cities) {
    try { summaries.push(summariseCity(c, { clouds, precise, sky, now, allowStale })); } catch (e) {
      if (e && e.stale) missing[c.id] = "data older than the page's limit";
      else { missing[c.id] = "data that failed its checks"; anyBroken = true; }
    }
  }
  if (!summaries.length) { if (anyBroken) fail("hub", "no city's forecast passed its checks"); throw new SkyStaleError("no city has a cloud forecast less than 6 hours old"); }
  const times = summaries.map((x) => x.dataTime).sort();
  const dataTime = times[times.length - 1];
  return { feed: "clouds", cities, summaries, missing, findings: hubFindings(summaries, { at: Date.parse(dataTime) }), dataTime, moon: moonAt(Date.parse(dataTime)), stale: summaries.some((x) => x.stale) };
}

// ------------------------------------------------------------------ ISS today
// dataTime: the satellite data time (satmeta taken, the time the satellite count page shows). cities: public/cities.json rows (the six).
// places: public/places.json, for naming the places the track passes within PLACE_MAX_KM of (or null, then coordinates only).
export function summariseIss(precise, { dataTime, now, cities, places = null, allowStale = false }) {
  const dataMs = parseTime(dataTime);
  if (!Number.isFinite(dataMs)) fail("iss", `the satellite data time "${String(dataTime).slice(0, 40)}" is not a time`);
  const stale = freshness("satellites", dataMs, now, { allowStale, maxAgeHours: SKY_MAX_AGE_HOURS.satellites });
  const e = issElements(precise, now);
  if (e.status === "old" && !allowStale) throw new SkyStaleError(e.reason);
  if (e.status !== "ok" && e.status !== "old") fail("iss", e.reason);
  const { sat } = e.status === "ok" ? e : { sat: loadPrecise(precise).get(ISS_ID) };
  const row = precise.rows.find((r) => r[0] === ISS_ID), col = (k) => row[precise.cols.indexOf(k)];
  const posAt = (ms) => { const p = ecefAt(sat, new Date(ms)); if (!p) fail("iss", "SGP4 could not place the ISS"); return ecefToGeodetic(p.x, p.y, p.z); };
  const here = posAt(dataMs);
  if (!(here.hKm > 300 && here.hKm < 500)) fail("iss", `the ISS height at the data time is ${Math.round(here.hKm)} km, outside 300 to 500`);
  const periodMin = 1440 / col("n");
  const heights = [];
  for (let t = dataMs; t < dataMs + periodMin * MIN_MS; t += 30e3) heights.push(posAt(t).hKm);
  const segments = groundTrack((d) => ecefAt(sat, d), new Date(dataMs), 45, 90, 1).map((seg) => seg.map((p) => ({ lat: p.lat, lon: p.lon, min: p.t })));
  const ahead = segments.flat().filter((p) => p.min > 0);
  let next = null;
  if (places) for (const p of ahead) { const near = nearestPlace(p.lat, p.lon, places); if (near && near.km <= PLACE_MAX_KM) { next = { min: p.min, lat: p.lat, lon: p.lon, place: near }; break; } }
  const nearNow = places ? nearestPlace(here.lat, here.lon, places) : null;
  // how far west the track has moved after one orbit, from the same propagation (the Earth turns under the orbit)
  const after = posAt(dataMs + periodMin * MIN_MS);
  const shiftDeg = ((here.lon - after.lon) % 360 + 540) % 360 - 180;
  const passes = cities.map((c) => ({ city: c, passes: issPasses({ sat }, c, dataMs, 24) }));
  const s = {
    feed: "satellites", dataTime: isoZ(dataMs), stale, epoch: isoZ(sat.epochMs), ageHours: (dataMs - sat.epochMs) / HOUR_MS,
    position: { lat: here.lat, lon: here.lon, hKm: here.hKm, near: nearNow && nearNow.km <= PLACE_MAX_KM ? nearNow : null },
    orbit: { inclination: col("i"), eccentricity: col("e"), meanMotion: col("n"), periodMin, meanHeightKm: heights.reduce((a, b) => a + b, 0) / heights.length, minHeightKm: Math.min(...heights), maxHeightKm: Math.max(...heights), orbitsPerDay: col("n") },
    track: segments, next, maxTrackLat: Math.max(...segments.flat().map((p) => Math.abs(p.lat))), shiftDeg, passes, places: places ? places.p.length : 0,
  };
  s.findings = issFindings(s);
  return s;
}

const latText = (lat) => `${Math.abs(lat).toFixed(1)} degrees ${lat >= 0 ? "north" : "south"}`;
const lonText = (lon) => `${Math.abs(lon).toFixed(1)} degrees ${lon >= 0 ? "east" : "west"}`;
const utcHm = (ms) => hm(ms, "UTC");
export function issFindings(s) {
  const out = [];
  out.push(`At the data time the ISS was at ${latText(s.position.lat)}, ${lonText(s.position.lon)}, ${Math.round(s.position.hKm)} km up${s.position.near ? `, ${Math.round(s.position.near.km)} km from ${s.position.near.name}, the nearest place in our list` : ""}.`);
  if (s.next) out.push(`On the computed track, the next place in our list it passes within ${PLACE_MAX_KM} km of is ${s.next.place.name}, ${s.next.min} minutes after the data time (${Math.round(s.next.place.km)} km from the track).`);
  else if (s.places) out.push(`In the 90 minutes after the data time the computed track passes within ${PLACE_MAX_KM} km of none of the places in our list, so it is over open sea or empty land.`);
  out.push(`It goes round the Earth in ${s.orbit.periodMin.toFixed(1)} minutes, and after one orbit the computed track is ${Math.round(Math.abs(s.shiftDeg))} degrees of longitude further ${s.shiftDeg >= 0 ? "west" : "east"}, because the Earth turns beneath it.`);
  const all = s.passes.flatMap((x) => x.passes.map((p) => ({ ...p, city: x.city })));
  const vis = all.filter((p) => p.visible).sort((a, b) => a.lit.from - b.lit.from);
  if (vis.length) {
    const p = vis[0];
    out.push(`Of ${all.length} passes over the six cities in the 24 hours after the data time, ${vis.length} ${vis.length === 1 ? "is" : "are"} sunlit while the sky is dark; the first is over ${p.city.name} at ${hm(p.lit.from, p.city.tz)} local time (${utcHm(p.lit.from)} UTC), up to ${Math.round(p.lit.maxEl)} degrees.`);
  } else if (all.length) out.push(`None of the ${all.length} passes over the six cities in the 24 hours after the data time is sunlit while the sky is dark.`);
  if (all.length) {
    const hi = [...all].sort((a, b) => b.max.el - a.max.el || a.max.t - b.max.t)[0];
    out.push(`The highest of them is over ${hi.city.name}, ${Math.round(hi.max.el)} degrees up at ${hm(hi.max.t, hi.city.tz)} local time, lasting ${durationText(hi.set - hi.rise)} above 10 degrees.`);
  }
  return out.slice(0, 6);
}

