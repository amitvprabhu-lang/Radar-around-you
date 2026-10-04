// Any place on Earth, from the GeoNames cities15000 index (public/places.json, built by pipeline/places.py).
// GeoNames data is CC BY 4.0: PLACES_CREDIT must be shown wherever a place found here is used.
import { haversineKm, normalizeText } from "./core.js";

export const PLACES_CREDIT = "Place names and time zones: GeoNames (geonames.org), CC BY 4.0";
const FIELDS = ["geonameid", "name", "ascii", "country", "lat", "lon", "tzIndex", "population"];

export const isValidTimeZone = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return typeof tz === "string" && tz.length > 0; } catch { return false; } };

// "IN" becomes "India" where the browser knows region names, else it stays "IN".
export function countryName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch { return code; }
}

export function decodePlaces(doc) {
  if (!doc || !Array.isArray(doc.p) || !Array.isArray(doc.tz) || FIELDS.some((f, i) => doc.fields[i] !== f)) throw new Error("places: unexpected structure");
  const out = new Array(doc.p.length);
  for (let i = 0; i < doc.p.length; i++) {
    const [id, name, ascii, cc, lat, lon, tzi, pop] = doc.p[i];
    out[i] = { id: `g${id}`, name, cc, lat, lon, tz: doc.tz[tzi], pop, key: normalizeText(`${name} ${ascii || ""}`), keyName: normalizeText(name), keyAscii: normalizeText(ascii || name) };
  }
  return { list: out, credit: doc.credit, built: doc.built };
}

// Prefix matches on the name first (largest places first, because the file is sorted by population), then places whose
// words all start with the query words. Exact matches come before both.
export function searchPlaces(index, query, limit = 6) {
  const q = normalizeText(query);
  if (q.length < 2 || !index) return [];
  const tokens = q.split(" ");
  const exact = [], prefix = [], words = [];
  for (const p of index.list) {
    if (p.keyName === q || p.keyAscii === q) exact.push(p);
    else if (p.keyName.startsWith(q) || p.keyAscii.startsWith(q)) prefix.push(p);
    else if (tokens.length > 1 && tokens.every((t) => p.key.split(" ").some((w) => w.startsWith(t)))) words.push(p);
    if (exact.length + prefix.length >= limit * 4 && words.length >= limit) break;
  }
  return [...exact, ...prefix, ...words].slice(0, limit);
}

export function nearestPlace(index, lat, lon, maxKm = Infinity) {
  if (!index) return null;
  let best = null, bestKm = Infinity;
  for (const p of index.list) {
    if (Math.abs(p.lat - lat) > 5 && bestKm < 500) continue;  // cheap reject once a reasonable match is known
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestKm) { bestKm = d; best = p; }
  }
  return best && bestKm <= maxKm ? { place: best, km: bestKm } : null;
}

// The app's own place shape, from an index record.
export const placeFromRecord = (p) => ({ id: p.id, name: p.name, country: countryName(p.cc), lat: p.lat, lon: p.lon, tz: p.tz, custom: true });

// A place from a position fix. It is named for the most populous place within nameKm (so a fix in the middle of Lima is
// "Lima", not the district it happens to be nearest to), otherwise by its coordinates. The time zone is the nearest place's
// within tzKm, or the device's when nothing is near, for example at sea.
export function placeFromPosition(index, lat, lon, deviceTz, nameKm = 25, tzKm = 300) {
  const near = nearestPlace(index, lat, lon, tzKm);
  let named = null;
  if (index && near && near.km <= nameKm) {
    for (const p of index.list) {
      if (Math.abs(p.lat - lat) > nameKm / 111 + 0.1) continue;
      if (haversineKm(lat, lon, p.lat, p.lon) <= nameKm && (!named || p.pop > named.pop)) named = p;
    }
  }
  const tz = near ? near.place.tz : isValidTimeZone(deviceTz) ? deviceTz : "UTC";
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { id: `pos_${r(lat).toFixed(2)}_${r(lon).toFixed(2)}`, name: named ? named.name : "Your location", country: named ? countryName(named.cc) : `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat: r(lat), lon: r(lon), tz, custom: true, positionFix: true };
}

// A saved place is only trusted if every field is sane, so a damaged or hand-edited value cannot break the page.
export function validCustomPlace(p) {
  return !!p && typeof p === "object" && typeof p.id === "string" && p.id.length < 40 && typeof p.name === "string" && p.name.length > 0 && p.name.length < 80
    && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && isValidTimeZone(p.tz);
}
