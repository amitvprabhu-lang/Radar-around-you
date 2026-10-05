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
