// The same real-world thing can arrive from two sources. This is where the app decides they are one.
// Tropical cyclones: the National Hurricane Center (NHC) lists the storms in its areas with names like "Nolo", GDACS lists
// cyclones worldwide with names like "Tropical Cyclone NOLO-26" and its own position. The NHC record is the better one for a
// storm it covers (current wind, forecast track), so the GDACS copy is dropped, and only that copy: GDACS cyclones that NHC
// does not list (the western Pacific, the Indian Ocean) must stay.

const lonDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const CLASS_WORDS = /\b(SUPER|TROPICAL|SUBTROPICAL|CYCLONE|STORM|DEPRESSION|HURRICANE|TYPHOON|POST|REMNANTS|OF|SEVERE|INTENSE|VERY|CATEGORY|MAJOR)\b/g;

// "Tropical Cyclone NOLO-26" -> "NOLO"; "Nolo" -> "NOLO"; names that are only a number or a class word give null
export function stormToken(name) {
  if (typeof name !== "string") return null;
  const t = name.toUpperCase().replace(CLASS_WORDS, " ").replace(/-\d{1,2}(?=\s|$)/g, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return t && !/^\d+$/.test(t) && !/^TC( \d+)?$/.test(t) ? t : null;
}

// Is this GDACS event the NHC storm? A shared name and a position within 8 degrees, or, when a name is missing on either side,
// a position within 2.5 degrees. GDACS and NHC place a storm a little differently (1.8 degrees apart for Nolo on 2026-10-04).
export function sameStorm(nhc, event) {
  if (!nhc || !event || event.type !== "TC") return false;
  if (![nhc.lat, nhc.lon, event.lat, event.lon].every(Number.isFinite)) return false;
  const near = (deg) => Math.abs(nhc.lat - event.lat) < deg && lonDiff(nhc.lon, event.lon) < deg;
  const a = stormToken(nhc.name), b = stormToken(event.name);
  return a && b ? a === b && near(8) : near(2.5);
}

// the GDACS cyclones that NHC does not already cover
export function unmatchedCyclones(events, nhcStorms) {
  return (events || []).filter((e) => e.type === "TC" && !(nhcStorms || []).some((s) => sameStorm(s, e)));
}

// all events with the duplicate GDACS copies of NHC storms removed; every other kind of event is kept as it is
export function withoutDuplicateStorms(events, nhcStorms) {
  const list = events || [], storms = nhcStorms || [];
  if (!storms.length) return list;
  return list.filter((e) => !(e.type === "TC" && storms.some((s) => sameStorm(s, e))));
}
