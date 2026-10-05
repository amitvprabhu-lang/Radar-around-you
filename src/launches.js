// Helpers for the launch list (The Space Devs, Launch Library 2, via pipeline/hazards.py).
// The planned launch time ("net", no earlier than) is not always a time. The source says how exact it is in `precision`:
// SEC, MIN and HR are exact to the second, minute and hour; M means "expected in the given month" and Q1 to Q4 "expected in the
// given quarter" (all three descriptions are the source's own). Anything else is treated as not exact and shown with the source's name for it.
import { haversineKm } from "./core.js";
import { whenFromNow } from "./asteroids.js";

export const EXACT = new Set(["SEC", "MIN", "HR"]);
export const isExact = (l) => EXACT.has(l.precision);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const QUARTERS = { Q1: "first", Q2: "second", Q3: "third", Q4: "fourth" };

const dayTime = (d, tz, withTime) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}), timeZone: tz }).format(d);

// When the launch is planned, worded to match how sure the source is. tz is the place's zone, used only for exact times.
export function whenText(l, tz) {
  const d = new Date(l.net);
  if (l.precision === "SEC" || l.precision === "MIN") return `${dayTime(d, tz, true)}`;
  if (l.precision === "HR") return `${dayTime(d, tz, false)}, in the hour starting ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d)}`;
  if (l.precision === "M") return `Expected in ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, day not set`;
  if (QUARTERS[l.precision]) return `Expected in the ${QUARTERS[l.precision]} quarter of ${d.getUTCFullYear()}`;
  return `${dayTime(d, "UTC", false)}, not an exact date${l.precisionName ? ` (the source calls it "${l.precisionName}")` : ""}`;
}

// "in 3 h" only for a time that is exact; a month or a quarter has no countdown.
export const countdown = (l, nowMs) => (isExact(l) ? whenFromNow(Date.parse(l.net) - nowMs) : null);

// Launches still to come, or that left within the last six hours (an exact time that passed longer ago is dropped; the source
// keeps recent launches out of its upcoming list anyway). Not exact ones stay while their date has not passed.
export function upcoming(doc, nowMs) {
  if (!doc || !Array.isArray(doc.launches)) return [];
  return doc.launches.filter((l) => Date.parse(l.net) >= nowMs - 6 * 3600e3);
}

// Two groups: the ones with a firm time and the ones planned only for a month or quarter.
export function groups(list) {
  return { firm: list.filter(isExact), loose: list.filter((l) => !isExact(l)) };
}

// distance from a place to the pad, or null if the pad has no position
export const padDistanceKm = (l, place) => (l.lat == null || l.lon == null ? null : haversineKm(place.lat, place.lon, l.lat, l.lon));
export const distanceText = (km) => (km == null ? "" : km < 100 ? `${Math.round(km)} km from you` : `about ${(Math.round(km / 10) * 10).toLocaleString("en-GB")} km from you`);

// The source names a launch "Vehicle | Mission". Returns both parts; the mission falls back to the part after the bar.
export function split(l) {
  const i = l.name.indexOf(" | ");
  const vehicle = i > 0 ? l.name.slice(0, i) : l.rocket || l.name;
  const mission = l.mission || (i > 0 ? l.name.slice(i + 3) : null);
  return { vehicle, mission };
}

// the source's status, in its own words
export const statusLine = (l) => l.statusName || l.status || "status not given";

// how many launches have an exact time within the next `days` days, for the home tile
export function soonCount(doc, nowMs, days = 7) {
  return upcoming(doc, nowMs).filter((l) => isExact(l) && Date.parse(l.net) <= nowMs + days * 86400e3).length;
}

// ---- webcasts. The collector keeps up to three https links per launch with the source's own words for what each one is.
// Everything from the feed is treated as untrusted: a link is used only if it is https, and a player is built only from an 11-character
// YouTube video id that passes a strict pattern, for an official YouTube webcast, and only after the person taps Play.
const PLATFORM = { "youtube.com": "YouTube", "youtu.be": "YouTube", "x.com": "X", "twitter.com": "X", "nasa.gov": "NASA", "vimeo.com": "Vimeo", "facebook.com": "Facebook", "twitch.tv": "Twitch" };
export const platformName = (host) => { const h = String(host || "").toLowerCase().replace(/^(www|m)\./, ""); return PLATFORM[h] || h || "web"; };
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// [{ url, label, official, live, start, embedId }], in the order the collector gave them (official first)
export function watchLinks(l) {
  const out = [];
  for (const v of (l && Array.isArray(l.videos) ? l.videos : [])) {
    if (!v || typeof v.url !== "string" || !/^https:\/\/[^\s/]+/.test(v.url)) continue;
    const type = typeof v.type === "string" && v.type ? v.type : "Webcast link";
    const where = [platformName(v.host), typeof v.publisher === "string" && v.publisher ? v.publisher : null].filter(Boolean).join(", ");
    const official = v.official === true;
    out.push({ url: v.url, label: `${type} (${where})`, official, live: v.live === true, start: v.start || null,
      embedId: official && v.youtube && YT_ID.test(v.youtube) && /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(v.url) ? v.youtube : null });
  }
  return out;
}
export const isLive = (l) => !!(l && l.liveNow === true);
export const hasEmbed = (l) => watchLinks(l).some((w) => w.embedId);

// The privacy-friendly YouTube address, built only from a valid id. Returns null for anything else.
export function embedUrl(id) {
  return typeof id === "string" && YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1` : null;
}

// The countdown for a launch with a firm time in the next 24 hours. SEC and MIN times tick to the second; an HR time is only right to the hour,
// so it is not shown with seconds. A time that has just passed says so and does not claim the launch happened.
const p2 = (n) => String(n).padStart(2, "0");
export function tMinus(l, nowMs) {
  if (!l || !isExact(l)) return null;
  const diff = Date.parse(l.net) - nowMs;
  if (!isFinite(diff)) return null;
  if (diff > 24 * 3600e3) return null;
  if (diff <= 0) {
    if (diff < -6 * 3600e3) return null;
    return { text: `The planned time passed ${Math.max(1, Math.round(-diff / 60000))} min ago. Waiting for the source to update.`, ticking: false };
  }
  if (l.precision === "HR") return { text: `About ${Math.max(1, Math.round(diff / 3600e3))} h to go (the time is only accurate to the hour)`, ticking: false };
  const s = Math.floor(diff / 1000);
  return { text: `T-minus ${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`, ticking: true };
}
