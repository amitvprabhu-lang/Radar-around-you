// The "satellites near me" page's small pure parts that the page script needs without the orbit code: the options, the checks on every value
// that comes from the address, the form or the browser's storage, the expected count, time and number wording, and the mini map. No DOM,
// no satellite.js (site/near.mjs holds the orbit model), so the page script stays small and every function is tested in node.
import { EARTH_RADIUS_KM, haversineKm, bearingDeg, compassPoint } from "../src/core.js";
import { isValidTimeZone } from "../src/places.js";
import { resolveSources, feedState } from "../src/live.js";
import { wPollDelay } from "./embed-models.mjs";

// ---------- Which orbit data: the live feed or the bundled copy ----------

// The live satellites feed is used when the manifest lists every file of it and it is newer than the copy bundled with the site (the app's
// rule, resolveSources in src/live.js). Otherwise the bundled copy is used, with the reason: no manifest, no satellites feed, a feed with
// files missing, or a feed older than the bundled copy (then the bundled copy is the newer data). A live feed past its own stale limit
// (staleAfterSec in the manifest) is still newer than the bundle and is still used; `state` says so, and the page prints it.
export function chooseSource(manifest, bundledTakenMs, liveBase, nowMs) {
  const feed = manifest && manifest.feeds ? manifest.feeds.satellites : null;
  const src = resolveSources(manifest, bundledTakenMs, liveBase).satellites;
  if (src) {
    const st = feedState(feed, nowMs);
    return { source: "live", paths: src.paths, version: src.version, fetchedAt: src.fetchedAt, state: st.state, refreshSec: feed.refreshSec || null, sizes: feed.sizes || {} };
  }
  const reason = !manifest ? "no-manifest" : !feed ? "no-feed" : Date.parse(feed.fetchedAt) > bundledTakenMs ? "incomplete" : "older";
  return { source: "bundled", reason, version: null };
}
export const SOURCE_REASONS = {
  "no-manifest": "the live data folder could not be read",
  "no-feed": "the live data folder has no satellite data",
  incomplete: "the live satellite data was incomplete",
  older: "the live satellite data was older than the bundled copy",
  failed: "the live satellite files could not be downloaded",
};
// The wait before the next look at the manifest (the embed widgets' rule, site/embed-models.mjs): the manifest's pollSec, never under 300 s
// and never over an hour, doubled after each failure in a row, at most 30 minutes.
export const pollDelayMs = wPollDelay;
// "orbit data from 7 Oct 03:50 UTC, live feed" or "bundled snapshot of 4 Oct 14:19 UTC"
export function sourceWhen(info) {
  const t = Date.parse(info.fetchedAt);
  return `${fmt({ day: "numeric", month: "short" }, "UTC").format(t)} ${fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "UTC").format(t)} UTC`;
}
export const sourceText = (info) => (info.source === "live" ? `orbit data from ${sourceWhen(info)}, live feed` : `bundled snapshot of ${sourceWhen(info)}`);

export const NEAR_FILE = "satellites-near-me/index.html";
// OURS: the distances the page offers (km of ground distance between the place and the point below the satellite)
export const RADII_KM = [25, 50, 100, 250, 500];
export const DEFAULT_RADIUS_KM = 100;
export const WINDOW_HOURS = 24;
// The app's rule for old orbit data (src/panels.js tags a satellite card "ORBIT DATA N DAYS OLD" over 72 hours; pipeline/pack.py counts
// element sets over 3 days as stale). A satellite whose element set is older than this at the start of the calculation is left out.
export const STALE_HOURS = 72;
// OURS: the most passes the table shows; the rest are counted.
export const TABLE_CAP = 100;
// OURS: how long a place name from the address or storage may be
export const NAME_MAX = 60;
// The default place when nothing else is chosen: Pune, the first of the site's six cities (snapshot.json), as on the sky pages.
export const DEFAULT_PLACE = { name: "Pune", lat: 18.5204, lon: 73.8567, tz: "Asia/Kolkata" };
export const STORAGE_KEY = "radar-near-place";

// ---------- Areas and the expected count ----------

// Share of the Earth's surface inside a circle of ground radius rKm (a spherical cap on the app's sphere of EARTH_RADIUS_KM).
export const capFraction = (rKm) => (1 - Math.cos(rKm / EARTH_RADIUS_KM)) / 2;
export const EARTH_AREA_KM2 = 4 * Math.PI * EARTH_RADIUS_KM ** 2;
export const capAreaKm2 = (rKm) => EARTH_AREA_KM2 * capFraction(rKm);
// How many of `count` satellites would have their ground point inside the circle at any one moment if they were spread evenly over the
// globe. They are not, so this is an order of magnitude, not a forecast.
export const expectedAtOnce = (count, rKm) => count * capFraction(rKm);

// ---------- Values from outside: the address, the form, storage ----------

const NUM_RE = /^[-+]?\d{1,3}(?:\.\d{1,6})?$/;
// A coordinate typed or read from the address: a plain decimal number (up to 6 decimals) within the range, else null.
export function parseCoord(text, max) {
  const s = String(text == null ? "" : text).trim();
  if (!NUM_RE.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null;
}
// A place name: trimmed, inner spaces collapsed, no control characters and no angle brackets, 1 to NAME_MAX characters, else null.
// (The page only ever writes it with textContent; this keeps odd input out of the address and storage too.)
export function cleanName(text) {
  if (typeof text !== "string") return null;
  const s = text.replace(/\s+/g, " ").trim();
  if (!s || [...s].length > NAME_MAX || /[\u0000-\u001f\u007f-\u009f<>]/.test(s)) return null;
  return s;
}
export const cleanTimeZone = (tz) => (typeof tz === "string" && tz.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(tz) && isValidTimeZone(tz) ? tz : null);
export const cleanRadius = (r) => { const n = Number(r); return RADII_KM.includes(n) && String(r).trim() === String(n) ? n : null; };
export const coordName = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;

// The address's query (?lat=18.52&lon=73.86&r=100&name=Pune&tz=Asia/Kolkata). A place needs both coordinates; a bad name or time zone
// is dropped on its own, a bad radius falls back to the default. Returns { place, radiusKm, problems } with place null when unusable.
export function parseQuery(search) {
  const q = new URLSearchParams(typeof search === "string" ? search : "");
  const problems = [];
  let place = null;
  if (q.has("lat") || q.has("lon")) {
    const lat = parseCoord(q.get("lat"), 90), lon = parseCoord(q.get("lon"), 180);
    if (lat === null || lon === null) problems.push("coordinates");
    else {
      const name = q.has("name") ? cleanName(q.get("name")) : null;
      if (q.has("name") && !name) problems.push("name");
      const tz = q.has("tz") ? cleanTimeZone(q.get("tz")) : null;
      if (q.has("tz") && !tz) problems.push("tz");
      place = { name: name || coordName(lat, lon), lat, lon, tz };
    }
  }
  let radiusKm = null;
  if (q.has("r")) { radiusKm = cleanRadius(q.get("r")); if (radiusKm === null) problems.push("radius"); }
  return { place, radiusKm, problems };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;
// The query for a place and radius (the shareable address); coordinates rounded to 4 decimals (about 11 m).
export function placeQuery(place, radiusKm) {
  const q = new URLSearchParams();
  q.set("lat", String(round4(place.lat)));
  q.set("lon", String(round4(place.lon)));
  q.set("r", String(radiusKm));
  if (place.name) q.set("name", place.name);
  if (place.tz) q.set("tz", place.tz);
  return "?" + q.toString();
}

// What the page keeps in localStorage: the last place chosen from the list, the search or typed coordinates, and the radius. A place from
// the device's position is never stored. restoreStored checks every field and returns null for anything else.
export const storedValue = (place, radiusKm) => JSON.stringify({ v: 1, name: place.name, lat: round4(place.lat), lon: round4(place.lon), tz: place.tz || null, r: radiusKm });
export function restoreStored(text) {
  let o = null;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== "object" || o.v !== 1) return null;
  const lat = typeof o.lat === "number" && Math.abs(o.lat) <= 90 ? o.lat : null, lon = typeof o.lon === "number" && Math.abs(o.lon) <= 180 ? o.lon : null;
  const name = cleanName(o.name);
  if (lat === null || lon === null || !name) return null;
  return { place: { name, lat, lon, tz: o.tz == null ? null : cleanTimeZone(o.tz) }, radiusKm: cleanRadius(o.r) || DEFAULT_RADIUS_KM };
}

// The typed coordinates: { lat, lon } or the messages to show next to each field.
export function checkTyped(latText, lonText) {
  const lat = parseCoord(latText, 90), lon = parseCoord(lonText, 180);
  return {
    lat, lon, ok: lat !== null && lon !== null,
    latError: lat === null ? "Enter the latitude in decimal degrees, from -90 to 90 (south is negative), for example 18.52." : "",
    lonError: lon === null ? "Enter the longitude in decimal degrees, from -180 to 180 (west is negative), for example 73.86." : "",
  };
}

// ---------- Wording ----------

const intFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
export const fmtInt = (n) => intFormat.format(Math.round(n));
export const fmtKm = (n) => `${fmtInt(n)} km`;
// "about 87 km, give or take 11 km"; full element sets have no model error to state
export const distanceText = (km, uKm) => (uKm > 0 ? `about ${fmtKm(km)}, give or take ${fmtKm(Math.max(1, Math.ceil(uKm)))}` : `about ${fmtKm(km)}`);
export const shortDistance = (km, uKm) => (uKm > 0 ? `${fmtInt(km)} km ± ${fmtInt(Math.max(1, Math.ceil(uKm)))}` : `${fmtInt(km)} km`);
export const plural = (n, one, many = one + "s") => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const lookText = (el, az) => `${Math.round(el)}° up, ${compassPoint(az)} (${Math.round(((az % 360) + 360) % 360)}°)`;
// A number of satellites expected at once, in words: "about 1", "about 0.2", "about 25"
export function expectedText(x) {
  if (x >= 10) return `about ${fmtInt(x)}`;
  if (x >= 1) return `about ${Math.round(x * 10) / 10}`.replace(/\.0$/, "");
  if (x >= 0.01) return `about ${Math.round(x * 100) / 100}`;
  return "less than 0.01";
}

// Times: "14:05:23 UTC" (with the date when it is not the start's UTC day) and the same moment in a time zone.
// Intl.DateTimeFormat objects are slow to make, and a table needs hundreds of times, so each kind is made once per time zone
const fmtCache = new Map();
const fmt = (opts, tz) => {
  const key = JSON.stringify(opts) + tz;
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }));
  return fmtCache.get(key);
};
export function utcText(ms, startMs = ms) {
  const d = new Date(ms);
  const hms = fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }, "UTC").format(d);
  const sameDay = new Date(startMs).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  return sameDay ? `${hms} UTC` : `${fmt({ weekday: "short", day: "numeric", month: "short" }, "UTC").format(d)}, ${hms} UTC`;
}
export function zoneText(ms, tz) {
  const d = new Date(ms);
  return `${fmt({ weekday: "short", day: "numeric", month: "short" }, tz).format(d)}, ${fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, tz).format(d)}`;
}
export const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const dayTimeUtc = (ms) => `${fmt({ day: "numeric", month: "long", year: "numeric" }, "UTC").format(new Date(ms))}, ${fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "UTC").format(new Date(ms))} UTC`;

// The sentence read out once a calculation is complete (the page's polite live region).
export function announcement({ placeName, radiusKm, now, within, borderline }) {
  const nowPart = now === 0 ? "none right now" : `${plural(now, "satellite")} right now`;
  return `Done: for ${placeName} within ${fmtKm(radiusKm)}, ${nowPart}, and ${plural(within, "pass", "passes")} in the next 24 hours, plus ${fmtInt(borderline)} borderline.`;
}

// ---------- The mini map ----------

// Azimuthal equidistant view around the place: distance and bearing from the place become radius and angle, north up. Returns SVG
// coordinates for a square of `size` units whose half-width is extentKm, or null when the point is farther than `limitKm`.
export function projectLocal(place, lat, lon, extentKm, size, limitKm = extentKm * 1.6) {
  const d = haversineKm(place.lat, place.lon, lat, lon);
  if (d > limitKm) return null;
  const b = (bearingDeg(place.lat, place.lon, lat, lon) * Math.PI) / 180, s = (size / 2) / extentKm;
  return [Math.round((size / 2 + d * s * Math.sin(b)) * 10) / 10, Math.round((size / 2 - d * s * Math.cos(b)) * 10) / 10];
}
// A polyline of [lat, lon] points as path data, broken wherever a point is out of range.
export function pathOf(points, place, extentKm, size) {
  let out = "", pen = false;
  for (const [lat, lon] of points) {
    const p = projectLocal(place, lat, lon, extentKm, size);
    if (!p) { pen = false; continue; }
    out += `${pen ? "L" : "M"}${p[0]} ${p[1]}`;
    pen = true;
  }
  return out;
}
// The map: coastlines (from the app's coast.bin, [lat, lon] lines), the circle of the chosen distance, the place, and each pass's ground
// track a few minutes either side of its closest approach (status "within" solid, "borderline" dashed). Numbers and fixed words only:
// no text from outside goes into the SVG string. extentKm: half the width shown, the radius times 2.5 (at least 150 km).
export function mapSvg({ place, radiusKm, tracks = [], coast = [], size = 400 }) {
  const extentKm = Math.max(150, radiusKm * 2.5);
  const c = size / 2, r = Math.round(((size / 2) / extentKm) * radiusKm * 10) / 10;
  const coastD = coast.map((line) => pathOf(line, place, extentKm, size)).filter(Boolean).join("");
  const tr = (status) => tracks.filter((t) => t.status === status).map((t) => pathOf(t.points, place, extentKm, size)).filter(Boolean).join("");
  const within = tr("within"), border = tr("borderline");
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-labelledby="nm-map-t nm-map-d" style="max-width:${size}px;display:block;background:#071021;border:1px solid var(--line);border-radius:12px">`
    + `<title id="nm-map-t">Ground tracks near the place</title><desc id="nm-map-d"></desc>`
    + (coastD ? `<path d="${coastD}" fill="none" stroke="#6d8fbf" stroke-width="1.6" stroke-linejoin="round"/>` : "")
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="rgba(98,230,195,.06)" stroke="#62e6c3" stroke-width="1.5"/>`
    + (border ? `<path d="${border}" fill="none" stroke="#ffd166" stroke-width="1.1" stroke-dasharray="4 3" opacity=".6"/>` : "")
    + (within ? `<path d="${within}" fill="none" stroke="#a98cff" stroke-width="1.1" opacity=".6"/>` : "")
    + `<circle cx="${c}" cy="${c}" r="4" fill="#fff"/>`
    + `<text x="8" y="${size - 8}" fill="#9aa7c7" font-size="11">North up, ${Math.round(extentKm)} km from the centre to each side</text>`
    + `</svg>`;
}
