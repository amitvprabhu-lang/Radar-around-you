// Summaries of the hazard feeds for the live hazard pages (docs/superpowers/specs/2026-10-06-live-hazard-pages-design.md). Pure functions
// over the collector's files (pipeline/validate.py and pipeline/hazards.py write them): no HTML and no file access, so every number can be
// tested on its own. Each summary has a freshness check (the feed's own time against a maximum age) and a plausibility guard, like
// assertPlausible in site/satcount.mjs, so a stale or broken feed never publishes a page. What each figure rests on is recorded in
// docs/hazard-pages-sources.md.
import { haversineKm } from "../src/core.js";
import { sigmaText } from "../src/asteroids.js";
import { categoryForKnots } from "../src/scales.js";

export const HOUR_MS = 3600e3;

// OURS: the oldest a feed's own time may be for its page to be published as current. Quakes, space weather, Kp, storms and close
// approaches are the design's values (section 2); Kp is 8 hours, raised from the design's first 6 because NOAA's newest Kp time tag was
// already 3.5 hours old at a collection on 2026-10-05 (a period is tagged with one time and its value comes after it); the aurora grid shares the space weather limit, and fires (not set by the design) allow
// for FIRMS files whose newest detection was already about 2.5 to 3 hours old when downloaded (docs/hazard-sources.md) plus the hourly
// collection. GDACS events only add a list to the storm page and are left out when older than this.
export const MAX_AGE_HOURS = { quakes: 3, kp: 8, spaceweather: 6, aurora: 6, storms: 12, closeapproaches: 48, fires: 8, events: 12 };

// Whether each source's terms are recorded as verified in docs/hazard-sources.md or docs/feature-sources.md. A test reads the table in
// docs/hazard-pages-sources.md and checks these match it. Dataset markup goes only on a page whose every feed is verified.
export const TERMS_VERIFIED = { quakes: true, kp: false, spaceweather: true, aurora: false, closeapproaches: false, storms: true, fires: true, events: false };

// The five hazard pages, the "hazard" family of site/livepages.mjs. feeds: the collector feeds a page reads (the first is required; the
// others add sections when present). maxAgeHours: the limit of the first feed.
export const HAZARD_PAGES = [
  { key: "quakes", slug: "earthquakes-today", feeds: ["quakes"], name: "Earthquakes today", guide: "guides/earthquakes/index.html" },
  { key: "aurora", slug: "aurora-tonight", feeds: ["kp", "spaceweather", "aurora"], name: "Aurora tonight", guide: "guides/aurora/index.html" },
  { key: "asteroids", slug: "asteroid-close-approaches", feeds: ["closeapproaches"], name: "Asteroid close approaches", guide: "guides/asteroids/index.html" },
  { key: "storms", slug: "tropical-storms-now", feeds: ["storms", "events"], name: "Tropical storms now", guide: "guides/storms/index.html" },
  { key: "fires", slug: "wildfires-today", feeds: ["fires"], name: "Fire detections today", guide: "guides/fires/index.html" },
].map((p) => ({ ...p, family: "hazard", file: `${p.slug}/index.html`, maxAgeHours: MAX_AGE_HOURS[p.feeds[0]] }));
export const RIGHT_NOW_FILE = "right-now/index.html";
export const hazardPage = (key) => HAZARD_PAGES.find((p) => p.key === key);

// A stale feed is not an error in the data: the page is skipped with this reason and the copy already on the site stays.
export class StaleError extends Error {
  constructor(message) { super(message); this.name = "StaleError"; this.stale = true; }
}

const fail = (feed, msg) => { throw new Error(`hazard: ${feed}: ${msg}`); };
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const inRange = (v, lo, hi) => fin(v) && v >= lo && v <= hi;
// An ISO time with or without a zone; no zone means UTC (NOAA's Kp time tags have none, and the app reads them as UTC too).
export function parseTime(s) {
  if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/.test(s.trim())) return NaN;
  const t = s.trim();
  return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(t) ? t : `${t}Z`);
}
// "2026-10-05T18:40:02Z": whole seconds, always UTC, so the same data gives the same text
export const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const timeOf = (feed, s, what) => { const t = parseTime(s); if (!Number.isFinite(t)) fail(feed, `${what} "${String(s).slice(0, 40)}" is not a time`); return t; };

// Checks a feed's own time against its maximum age. Throws StaleError when it is too old (unless allowStale, for the deploy-time copy built
// from the bundled snapshot), and an ordinary error when it is more than an hour in the future. Returns whether it is stale.
export function freshness(feed, dataMs, now, { allowStale = false, maxAgeHours = MAX_AGE_HOURS[feed] } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (dataMs > nowMs + HOUR_MS) fail(feed, `the data time ${isoZ(dataMs)} is in the future`);
  const stale = nowMs - dataMs > maxAgeHours * HOUR_MS;
  if (stale && !allowStale) throw new StaleError(`${feed} data from ${isoZ(dataMs)} is more than ${maxAgeHours} hours old`);
  return stale;
}

// the start of the UTC day of a time, for data times that should change once a day at most
export const dayStart = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

// ------------------------------------------------------------------ earthquakes (USGS magnitude 2.5 and above, past 7 days)
// OURS: the magnitude bands of the page, the lower edges of USGS's own summary feeds (2.5 and 4.5) plus 6.
export const QUAKE_BANDS = [2.5, 4.5, 6];
export const QUAKE_PLACE_TOP = 10;

// The text after the last comma of a USGS place ("39 km WSW of Tambolaka, Indonesia" -> "Indonesia"); a place without a comma
// ("Kermadec Islands region") is kept whole. It is a USGS label, not a country or a region we assign.
export const placeLabel = (place) => { const s = String(place || "").trim(); const i = s.lastIndexOf(","); return (i >= 0 ? s.slice(i + 1).trim() : s) || "No place given"; };

export function summariseQuakes(doc, { now, allowStale = false } = {}) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.events)) fail("quakes", "the file has no events list");
  const gen = timeOf("quakes", doc.generated, "generated");
  if (doc.events.length === 0) fail("quakes", "the feed has no events at all (a week of magnitude 2.5 and above never has none)");
  const all = doc.events.map((e, i) => {
    if (!e || !inRange(e.mag, -2, 10)) fail("quakes", `event ${i} has magnitude ${e && e.mag}, outside -2 to 10`);
    if (!inRange(e.lat, -90, 90) || !inRange(e.lon, -180, 180)) fail("quakes", `event ${i} has an impossible position`);
    if (!inRange(e.depth, -10, 1000)) fail("quakes", `event ${i} has depth ${e.depth} km, outside -10 to 1000`);
    return { id: String(e.id || ""), mag: e.mag, place: String(e.place || ""), t: timeOf("quakes", e.time, `event ${i} time`), lat: e.lat, lon: e.lon, depth: e.depth, status: String(e.status || ""), url: String(e.url || "") };
  });
  const stale = freshness("quakes", gen, now, { allowStale });
  const start = gen - 24 * HOUR_MS;
  const day = all.filter((e) => e.t > start && e.t <= gen);
  const order = (a, b) => b.mag - a.mag || b.t - a.t || a.id.localeCompare(b.id);
  const sorted = [...day].sort(order);
  const hourly = Array.from({ length: 24 }, (_, i) => ({ start: isoZ(start + i * HOUR_MS), count: 0 }));
  for (const e of day) hourly[Math.min(23, Math.floor((e.t - start) / HOUR_MS))].count++;
  const labels = new Map();
  for (const e of day) labels.set(placeLabel(e.place), (labels.get(placeLabel(e.place)) || 0) + 1);
  const places = [...labels].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
  const pub = (e) => e && { id: e.id, mag: e.mag, place: e.place, time: isoZ(e.t), lat: e.lat, lon: e.lon, depth: e.depth, status: e.status, url: e.url };
  const band = (lo, hi = Infinity) => day.filter((e) => e.mag >= lo && e.mag < hi).length;
  return {
    feed: "quakes", dataTime: isoZ(gen), windowStart: isoZ(start), stale,
    count: day.length, below25: band(-Infinity, QUAKE_BANDS[0]),
    bands: [{ from: QUAKE_BANDS[0], to: QUAKE_BANDS[1], count: band(QUAKE_BANDS[0], QUAKE_BANDS[1]) }, { from: QUAKE_BANDS[1], to: QUAKE_BANDS[2], count: band(QUAKE_BANDS[1], QUAKE_BANDS[2]) }, { from: QUAKE_BANDS[2], to: null, count: band(QUAKE_BANDS[2]) }],
    ge45: band(4.5), ge6: band(6), minMag: day.length ? Math.min(...day.map((e) => e.mag)) : null,
    largest: pub(sorted[0]) || null, top: sorted.slice(0, 10).map(pub), hourly,
    places: places.slice(0, QUAKE_PLACE_TOP), placeLabels: places.length,
    reviewed: day.filter((e) => e.status === "reviewed").length, automatic: day.filter((e) => e.status === "automatic").length,
    deepest: day.length ? pub([...day].sort((a, b) => b.depth - a.depth || order(a, b))[0]) : null,
    points: day.map((e) => [e.lat, e.lon]), feedEvents: all.length,
  };
}

// ------------------------------------------------------------------ Kp, solar wind and the aurora grid (NOAA SWPC)
// OURS: the threshold of the grid summary, "a grid value of 10 or more".
export const GRID_THRESHOLD = 10;
// NOAA's G1 begins at Kp 5 (NOAA Space Weather Scales, src/scales.js); the page counts the periods at or above it.
export const KP_G1 = 5;
export const GRID_SIZE = [360, 181];

export function summariseKp(rows, { now, allowStale = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) fail("kp", "the file has no rows");
  const list = rows.map((r, i) => {
    if (!r || typeof r !== "object") fail("kp", `row ${i} is not a record`);
    const t = timeOf("kp", r.t, `row ${i} time tag`);
    const v = r.kp;
    if (v !== null && v !== undefined && !inRange(v, 0, 9)) fail("kp", `row ${i} has Kp ${v}, outside 0 to 9`);
    return { t, kp: fin(v) ? v : null };
  }).sort((a, b) => a.t - b.t);
  const valued = list.filter((r) => r.kp !== null);
  if (!valued.length) fail("kp", "no row has a Kp value");
  const newest = list[list.length - 1].t;
  const latest = valued[valued.length - 1];
  // the age is that of the newest row with a value: a newest row without one does not make the data current
  const stale = freshness("kp", latest.t, now, { allowStale });
  const max = valued.reduce((a, b) => (b.kp > a.kp ? b : a));
  return {
    feed: "kp", dataTime: isoZ(latest.t), newestTag: isoZ(newest), stale, rows: list.map((r) => ({ t: isoZ(r.t), kp: r.kp })),
    latest: { t: isoZ(latest.t), kp: latest.kp }, missingLatest: latest.t !== newest,
    max: { t: isoZ(max.t), kp: max.kp }, atLeastG1: valued.filter((r) => r.kp >= KP_G1).length, missing: list.length - valued.length,
    first: isoZ(list[0].t),
  };
}

const WIND_FIELDS = { speed: [100, 3000], density: [0, 500], bt: [0, 200], bz: [-200, 200] };
export function summariseWind(doc, { now, allowStale = false } = {}) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.points)) fail("spaceweather", "the file has no points");
  const upd = timeOf("spaceweather", doc.updated, "updated");
  const pts = doc.points.map((p, i) => {
    const t = timeOf("spaceweather", p && p.t, `point ${i} time`);
    const o = { t };
    for (const [k, [lo, hi]] of Object.entries(WIND_FIELDS)) {
      const v = p[k];
      if (v !== null && v !== undefined && !inRange(v, lo, hi)) fail("spaceweather", `point ${i} has ${k} ${v}, outside ${lo} to ${hi}`);
      o[k] = fin(v) ? v : null;
    }
    return o;
  }).sort((a, b) => a.t - b.t);
  if (!pts.some((p) => p.speed !== null)) fail("spaceweather", "no point has a solar wind speed");
  const stale = freshness("spaceweather", upd, now, { allowStale });
  const fields = {};
  for (const k of Object.keys(WIND_FIELDS)) {
    const have = pts.filter((p) => p[k] !== null);
    fields[k] = have.length ? { now: have[have.length - 1][k], at: isoZ(have[have.length - 1].t), min: Math.min(...have.map((p) => p[k])), max: Math.max(...have.map((p) => p[k])), n: have.length } : null;
  }
  const allAlerts = (Array.isArray(doc.alerts) ? doc.alerts : []).filter((a) => a && typeof a.headline === "string" && Number.isFinite(parseTime(a.issued)));
  // an extended or continued warning names the serial it replaces (its "supersedes" field, pipeline/hazards.py); the replaced one is left
  // out, as the app does (docs/hazard-sources.md)
  const replaced = new Set(allAlerts.filter((a) => Number.isInteger(a.supersedes)).map((a) => a.supersedes));
  const alerts = allAlerts.filter((a) => !(Number.isInteger(a.serial) && replaced.has(a.serial)))
    .map((a) => ({ kind: String(a.kind || ""), headline: a.headline, issued: isoZ(parseTime(a.issued)), kp: fin(a.kp) ? a.kp : null }))
    .sort((a, b) => b.issued.localeCompare(a.issued) || a.headline.localeCompare(b.headline));
  return {
    feed: "spaceweather", dataTime: isoZ(upd), stale, from: isoZ(pts[0].t), to: isoZ(pts[pts.length - 1].t), points: pts.length,
    bucketMin: fin(doc.bucketMin) ? doc.bucketMin : null, spacecraft: (Array.isArray(doc.spacecraft) ? doc.spacecraft : []).map(String), fields, alerts, alertsReplaced: allAlerts.length - alerts.length,
  };
}

// grid: 360 by 181 bytes, row la = latitude + 90, column = longitude 0 to 359 (pipeline/validate.py, aurora)
export function summariseGrid(meta, grid, { now, allowStale = false } = {}) {
  const [W, H] = GRID_SIZE;
  if (!meta || typeof meta !== "object") fail("aurora", "no grid times");
  const obs = timeOf("aurora", meta.observation, "observation"), fc = timeOf("aurora", meta.forecast, "forecast");
  if (!grid || grid.length !== W * H) fail("aurora", `the grid has ${grid ? grid.length : 0} values, expected ${W * H}`);
  let peak = 0;
  for (let i = 0; i < grid.length; i++) { if (grid[i] > 100) fail("aurora", `a grid value of ${grid[i]} is over 100`); if (grid[i] > peak) peak = grid[i]; }
  const stale = freshness("aurora", obs, now, { allowStale });
  const rowMax = (lat) => { let m = 0; const la = lat + 90; for (let lo = 0; lo < W; lo++) m = Math.max(m, grid[la * W + lo]); return m; };
  const hemi = (sign) => {
    let max = 0, edge = null, pole = null;
    for (let a = 1; a <= 90; a++) {
      const m = rowMax(sign * a);
      max = Math.max(max, m);
      if (m >= GRID_THRESHOLD) { if (edge === null) edge = a; pole = a; }
    }
    return { max, edge, pole };
  };
  // for the map: in each hemisphere and for each longitude, the grid point nearest the equator with a value at or above the threshold, as
  // [lat, lon] with longitude from -180 to 180 (at most 720 points, however large the oval)
  const points = [];
  for (let lo = 0; lo < W; lo++) for (const sign of [1, -1]) {
    for (let a = 1; a <= 90; a++) if (grid[(sign * a + 90) * W + lo] >= GRID_THRESHOLD) { points.push([sign * a, lo >= 180 ? lo - 360 : lo]); break; }
  }
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { feed: "aurora", dataTime: isoZ(obs), forecastTime: isoZ(fc), stale, peak, north: hemi(1), south: hemi(-1), points };
}

// The aurora page needs Kp; the solar wind and the grid add sections when present and fresh, and otherwise say why they are missing.
export function summariseSpace({ kp, spaceweather = null, aurora = null }, { now, allowStale = false } = {}) {
  const k = summariseKp(kp, { now, allowStale });
  // a stale or broken solar wind or grid file leaves only its own section out, with the reason; the Kp page is still published
  const warnings = [];
  const part = (feed, fn) => {
    try { return { value: fn(), reason: null }; } catch (e) {
      if (e && e.stale) return { value: null, reason: `older than ${MAX_AGE_HOURS[feed]} hours` };
      warnings.push(e.message);
      return { value: null, reason: "not usable: it failed our checks" };
    }
  };
  const w = spaceweather ? part("spaceweather", () => summariseWind(spaceweather, { now, allowStale })) : { value: null, reason: "not available in this build" };
  const g = aurora ? part("aurora", () => summariseGrid(aurora.meta, aurora.grid, { now, allowStale })) : { value: null, reason: "not available in this build" };
  const times = [k.dataTime, w.value && w.value.dataTime, g.value && g.value.dataTime].filter(Boolean).sort();
  return { feed: "kp", kp: k, wind: w.value, windReason: w.reason, grid: g.value, gridReason: g.reason, dataTime: times[times.length - 1], warnings, stale: k.stale || !!(w.value && w.value.stale) || !!(g.value && g.value.stale) };
}

// ------------------------------------------------------------------ asteroid close approaches (NASA/JPL CNEOS)
// The query the collector sends (pipeline/config.py): close approaches within 0.05 au in the next 60 days, JPL's documented default.
export const CAD_MAX_AU = 0.05;
export const CAD_DAYS = 60;

// The collector strips brackets from the ends of JPL's full names, which leaves "524522 Zoozve (2002 VE68" with its bracket open. Only an
// opening bracket that is never closed gets a closing one at the end, as many as are open; a name with balanced brackets, nested or not,
// or with none, is left exactly as it is. A closing bracket with no opening one before it is left alone too (nothing to repair).
export const objectName = (name) => {
  const t = String(name || "").trim();
  let open = 0;
  for (const ch of t) { if (ch === "(") open++; else if (ch === ")" && open > 0) open--; }
  return open > 0 ? t + ")".repeat(open) : t;
};

export function summariseApproaches(doc, { now, allowStale = false } = {}) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.approaches)) fail("closeapproaches", "the file has no approaches list");
  const gen = timeOf("closeapproaches", doc.generated, "generated");
  if (!inRange(doc.ldKm, 300000, 500000)) fail("closeapproaches", `the lunar distance of ${doc.ldKm} km is not plausible`);
  const list = doc.approaches.map((a, i) => {
    if (!a || typeof a !== "object") fail("closeapproaches", `row ${i} is not a record`);
    const name = objectName(a.name || a.des);
    if (!name) fail("closeapproaches", `row ${i} has no name`);
    if (!(fin(a.distAu) && a.distAu > 0 && a.distAu <= CAD_MAX_AU)) fail("closeapproaches", `${name} is at ${a.distAu} au, not above 0 and up to ${CAD_MAX_AU}`);
    if (!(fin(a.distLd) && a.distLd > 0) || !(fin(a.distKm) && a.distKm > 0)) fail("closeapproaches", `${name} has no usable distance`);
    if (!(fin(a.speedKms) && a.speedKms > 0 && a.speedKms < 100)) fail("closeapproaches", `${name} has speed ${a.speedKms} km/s`);
    if (a.h !== null && a.h !== undefined && !(fin(a.h) && a.h > 0 && a.h < 40)) fail("closeapproaches", `${name} has H ${a.h}`);
    return { name, t: timeOf("closeapproaches", a.time, `${name} time`), distLd: a.distLd, distKm: a.distKm, speedKms: a.speedKms, h: fin(a.h) ? a.h : null, sigma: a.timeSigma ? sigmaText(a.timeSigma) : null };
  }).sort((a, b) => a.t - b.t || a.name.localeCompare(b.name, "en"));
  const stale = freshness("closeapproaches", gen, now, { allowStale });
  const pub = (a) => a && { name: a.name, time: isoZ(a.t), distLd: a.distLd, distKm: a.distKm, speedKms: a.speedKms, h: a.h, sigma: a.sigma };
  // OURS: the page lists the passes from the start of the UTC day the list was read, and that day is its data time. The page then
  // depends on JPL's list and the day only, not on the minute our collector read it, so it changes only when the list or the day does.
  const day = dayStart(gen);
  const up = list.filter((a) => a.t >= day);
  // a 60 day window with no close approach at all is not plausible (35 on 2026-10-05); the previous page stays instead
  if (!up.length) fail("closeapproaches", "the list has no close approach in its window");
  const pick = (cmp) => (up.length ? pub([...up].sort((a, b) => cmp(a, b) || a.t - b.t || a.name.localeCompare(b.name, "en"))[0]) : null);
  return {
    feed: "closeapproaches", dataTime: isoZ(day), readTime: isoZ(gen), stale, ldKm: doc.ldKm, version: String(doc.version || ""),
    upcoming: up.map(pub), earlier: list.length - up.length, next: pub(up[0]) || null,
    nearest: pick((a, b) => a.distLd - b.distLd), fastest: pick((a, b) => b.speedKms - a.speedKms),
    faintest: up.some((a) => a.h !== null) ? pick((a, b) => (b.h ?? -1) - (a.h ?? -1)) : null,
    insideMoon: up.filter((a) => a.distLd < 1).length, last: up.length ? isoZ(up[up.length - 1].t) : null,
  };
}

// ------------------------------------------------------------------ tropical storms (NOAA NHC) and GDACS tropical cyclones
export function summariseStorms(doc, { now, allowStale = false, events = null } = {}) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.storms)) fail("storms", "the file has no storms list");
  const gen = timeOf("storms", doc.generated, "generated");
  const storms = doc.storms.map((s, i) => {
    if (!s || typeof s !== "object" || typeof s.name !== "string" || !s.name.trim()) fail("storms", `storm ${i} has no name`);
    if (!inRange(s.windKt, 0, 250)) fail("storms", `${s.name} has wind ${s.windKt} kt, outside 0 to 250`);
    if (!inRange(s.lat, -90, 90) || !inRange(s.lon, -180, 180)) fail("storms", `${s.name} has an impossible position`);
    if (s.pressureMb !== null && s.pressureMb !== undefined && !inRange(s.pressureMb, 800, 1050)) fail("storms", `${s.name} has pressure ${s.pressureMb} mb`);
    const track = (Array.isArray(s.track) ? s.track : []).map((p, j) => {
      if (!p || !inRange(p.lat, -90, 90) || !inRange(p.lon, -180, 180) || !fin(p.hours)) fail("storms", `${s.name} forecast point ${j} is not usable`);
      if (p.windKt !== null && p.windKt !== undefined && !inRange(p.windKt, 0, 250)) fail("storms", `${s.name} forecast point ${j} has wind ${p.windKt} kt`);
      return { hours: p.hours, valid: isoZ(timeOf("storms", p.valid, `${s.name} forecast point ${j} time`)), lat: p.lat, lon: p.lon, windKt: fin(p.windKt) ? p.windKt : null };
    }).sort((a, b) => a.hours - b.hours);
    return {
      id: String(s.id || ""), name: s.name.trim(), basin: String(s.basin || ""), classText: String(s.classText || s.class || ""), windKt: s.windKt,
      windKmh: fin(s.windKmh) ? s.windKmh : Math.round(s.windKt * 1.852), category: categoryForKnots(s.windKt), pressureMb: fin(s.pressureMb) ? s.pressureMb : null,
      lat: s.lat, lon: s.lon, moveDeg: fin(s.moveDeg) ? s.moveDeg : null, moveKt: fin(s.moveKt) ? s.moveKt : null, advisory: s.advisory ? String(s.advisory) : null,
      issued: isoZ(timeOf("storms", s.issued, `${s.name} advisory time`)), url: typeof s.url === "string" && /^https:\/\//.test(s.url) ? s.url : null, track,
    };
  }).sort((a, b) => b.windKt - a.windKt || a.name.localeCompare(b.name, "en"));
  const stale = freshness("storms", gen, now, { allowStale });
  let gdacs = null, gdacsReason = null;
  if (events && Array.isArray(events.list)) {
    const evMs = parseTime(events.dataTime || "");
    if (!Number.isFinite(evMs)) gdacsReason = "no data time";
    else if (!allowStale && (now instanceof Date ? now.getTime() : now) - evMs > MAX_AGE_HOURS.events * HOUR_MS) gdacsReason = `older than ${MAX_AGE_HOURS.events} hours`;
    else {
      gdacs = events.list.filter((e) => e && e.type === "TC" && typeof e.name === "string" && Number.isFinite(parseTime(e.from)) && Number.isFinite(parseTime(e.to)))
        .map((e) => ({ name: e.name, alert: String(e.alert || ""), from: isoZ(parseTime(e.from)), to: isoZ(parseTime(e.to)), current: e.current === true, url: typeof e.url === "string" && /^https:\/\/www\.gdacs\.org\//.test(e.url) ? e.url : null }))
        .sort((a, b) => b.to.localeCompare(a.to) || a.name.localeCompare(b.name, "en")).slice(0, 5);
    }
  }
  const issued = storms.map((s) => s.issued).sort();
  // the data time is the newest advisory among the active storms (its issue or update time), so the page changes only when NHC publishes
  // something new; with no active storm it is the start of the UTC day the list was read, so an empty page changes once a day at most.
  // Whether the list is current is still judged by when it was read (above).
  const advisory = doc.storms.flatMap((s) => [s.issued, s.updated]).map(parseTime).filter(Number.isFinite);
  const dataMs = storms.length && advisory.length ? Math.max(...advisory) : dayStart(gen);
  return { feed: "storms", dataTime: isoZ(dataMs), dataKind: storms.length ? "advisory" : "day", readTime: isoZ(gen), stale, storms, earliestAdvisory: issued[0] || null, gdacs, gdacsReason };
}

// ------------------------------------------------------------------ fire detections (NASA FIRMS, VIIRS)
// OURS: the nearest place is printed only when it is this close to the cell centre; beyond it the page gives the coordinates only.
export const PLACE_MAX_KM = 300;
// OURS: the density map merges the collector's quarter degree cells into one degree squares, so the map stays small.
export const FIRE_MAP_DEG = 1;
// OURS: above this many one degree squares the map uses two degree squares, so the page stays under its size limit in a busy season
export const FIRE_MAP_MAX = 8000;
// The satellite codes in the FIRMS files and the names the app gives them (docs/hazard-sources.md).
export const FIRE_SATELLITES = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21" };
// The three files the collector reads (pipeline/config.py, FIRES_FILES), one per satellite, whatever a given run managed to load.
export const FIRMS_SATELLITES = ["Suomi NPP", "NOAA-20", "NOAA-21"];
const FIRE_REC = 12;

// fires.bin: little-endian records of uint16 latIndex, uint16 lonIndex, uint16 detections, float32 FRP, uint16 minutes (pipeline/hazards.py)
export function decodeFireCells(buf, cellDeg) {
  if (!buf || buf.length % FIRE_REC !== 0) fail("fires", `fires.bin has ${buf ? buf.length : 0} bytes, not a whole number of ${FIRE_REC}-byte records`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  const latN = Math.round(180 / cellDeg), lonN = Math.round(360 / cellDeg);
  for (let o = 0; o < buf.length; o += FIRE_REC) {
    const li = dv.getUint16(o, true), lo = dv.getUint16(o + 2, true), n = dv.getUint16(o + 4, true);
    if (li >= latN || lo >= lonN) fail("fires", `a cell index (${li}, ${lo}) is outside the grid`);
    if (n === 0) fail("fires", "a cell has no detections");
    out.push({ li, lo, n, lat: -90 + (li + 0.5) * cellDeg, lon: -180 + (lo + 0.5) * cellDeg });
  }
  return out;
}

// places: public/places.json ({ fields, p: rows }). Returns { name, country, km } of the nearest place, by great circle distance.
export function nearestPlace(lat, lon, places) {
  const f = places.fields, iN = f.indexOf("name"), iC = f.indexOf("country"), iLat = f.indexOf("lat"), iLon = f.indexOf("lon");
  let best = null;
  for (const r of places.p) {
    const km = haversineKm(lat, lon, r[iLat], r[iLon]);
    if (!best || km < best.km || (km === best.km && r[iN] < best.name)) best = { name: r[iN], country: r[iC], km };
  }
  return best;
}

export function summariseFires({ summary, bin }, { now, allowStale = false, places }) {
  if (!summary || typeof summary !== "object") fail("fires", "fires.json is missing");
  const newest = timeOf("fires", summary.newest, "newest");
  if (summary.cellDeg !== 0.25) fail("fires", `the cell size is ${summary.cellDeg}, expected 0.25 degrees`);
  for (const k of ["cells", "detections", "lowConfidenceLeftOut", "rows"]) if (!(Number.isInteger(summary[k]) && summary[k] >= 0)) fail("fires", `${k} is not a count`);
  const cells = decodeFireCells(bin, summary.cellDeg);
  if (cells.length === 0) fail("fires", "the file has no detection cells");
  if (cells.length !== summary.cells) fail("fires", `fires.bin has ${cells.length} cells but fires.json says ${summary.cells}`);
  const sum = cells.reduce((s, c) => s + c.n, 0), clamped = cells.some((c) => c.n === 65535);
  if (clamped ? sum > summary.detections : sum !== summary.detections) fail("fires", `the cells hold ${sum} detections but fires.json says ${summary.detections}`);
  const sats = Object.entries(summary.bySatellite || {}).map(([code, n]) => { if (!(Number.isInteger(n) && n >= 0)) fail("fires", `satellite ${code} has count ${n}`); return { code, name: FIRE_SATELLITES[code] || code, count: n }; })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  if (sats.reduce((s, x) => s + x.count, 0) !== summary.detections) fail("fires", "the counts by satellite do not add up to the detections");
  if (summary.detections + summary.lowConfidenceLeftOut > summary.rows) fail("fires", "more detections than rows read");
  const stale = freshness("fires", newest, now, { allowStale });
  const dense = [...cells].sort((a, b) => b.n - a.n || a.li - b.li || a.lo - b.lo).slice(0, 10).map((c) => {
    const near = places ? nearestPlace(c.lat, c.lon, places) : null;
    return { lat: c.lat, lon: c.lon, detections: c.n, place: near && near.km <= PLACE_MAX_KM ? { name: near.name, country: near.country, km: near.km } : null, nearestKm: near ? near.km : null };
  });
  const squares = (deg) => { const m = new Set(); for (const c of cells) m.add(`${Math.floor(c.lat / deg)},${Math.floor(c.lon / deg)}`); return m; };
  let mapDeg = FIRE_MAP_DEG, sq = squares(mapDeg);
  if (sq.size > FIRE_MAP_MAX) { mapDeg = FIRE_MAP_DEG * 2; sq = squares(mapDeg); }
  const mapPoints = [...sq].map((k) => { const [a, b] = k.split(",").map(Number); return [(a + 0.5) * mapDeg, (b + 0.5) * mapDeg]; });
  const hemiN = cells.filter((c) => c.lat > 0).reduce((s, c) => s + c.n, 0);
  return {
    feed: "fires", dataTime: isoZ(newest), stale, detections: summary.detections, cells: cells.length, lowLeftOut: summary.lowConfidenceLeftOut, rows: summary.rows,
    satellites: sats, dense, mapPoints, mapSquares: sq.size, mapDeg, north: hemiN, south: sum - hemiN, cellDeg: summary.cellDeg,
    places: places ? places.p.length : 0,
  };
}
