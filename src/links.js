// Deep links: every screen and place can be reached from a URL hash, so a link can be shared or bookmarked.
//   #sky   #aurora   #storms   #fires   #near   #calendar   #tonight   #place=pune&sky   #place=g3413829&aurora   #place=pos_-12.05_-77.04
//   #sky&con=cru   (a constellation by its three-letter IAU abbreviation, any case; the app checks it against the 88)
// Parsing is strict: only known names are accepted and a place must match one of three exact shapes, so a pasted link can
// never inject anything but a view, a sheet and a place.
export const VIEWS = ["globe", "sky", "under"];
export const SHEETS = ["feed", "calendar", "tonight", "trains", "status", "about", "places", "near", "constellations", "asteroids", "launches"];
export const WATCH_TABS = ["aurora", "storms", "fires"];

const CITY = /^[a-z][a-z0-9-]{1,30}$/;
const GEONAMES = /^g\d{1,9}$/;
const CON = /^[A-Za-z]{3}$/;
const FIX = /^pos_(-?\d{1,2}(?:\.\d{1,4})?)_(-?\d{1,3}(?:\.\d{1,4})?)$/;

export function parsePlaceToken(token) {
  if (typeof token !== "string") return null;
  const fix = token.match(FIX);
  if (fix) {
    const lat = Number(fix[1]), lon = Number(fix[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { kind: "fix", lat, lon } : null;
  }
  if (GEONAMES.test(token)) return { kind: "geonames", id: token };
  if (CITY.test(token)) return { kind: "city", id: token };
  return null;
}

export function parseHash(hash) {
  const out = { view: null, sheet: null, watch: null, place: null, con: null };
  const text = String(hash || "").replace(/^#/, "");
  if (!text || text.length > 200) return out;
  for (const part of text.split("&")) {
    const [k, v] = part.split("=");
    if (k === "place" && v !== undefined) { const p = parsePlaceToken(decodeURIComponent_(v)); if (p) out.place = p; }
    else if (k === "con" && v !== undefined && CON.test(v)) out.con = v.toLowerCase();
    else if (v === undefined && VIEWS.includes(k)) out.view = k;
    else if (v === undefined && SHEETS.includes(k)) out.sheet = k;
    else if (v === undefined && WATCH_TABS.includes(k)) out.watch = k;
  }
  return out;
}
const decodeURIComponent_ = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };

// The hash for the current state. The default state (globe, nothing open, a built-in default place) gives an empty string.
// `defaultPlaceId` is the place the app starts on when there is no saved choice, so a link only carries a place that matters.
export function buildHash({ view = "globe", sheet = null, watchTab = null, placeId = null, defaultPlaceId = null } = {}) {
  const parts = [];
  if (placeId && placeId !== defaultPlaceId) parts.push(`place=${placeId}`);
  if (sheet === "watch" && WATCH_TABS.includes(watchTab)) parts.push(watchTab);
  else if (SHEETS.includes(sheet)) parts.push(sheet);
  else if (view !== "globe" && VIEWS.includes(view)) parts.push(view);
  return parts.length ? "#" + parts.join("&") : "";
}
