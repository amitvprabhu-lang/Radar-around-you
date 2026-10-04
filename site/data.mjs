// The numbers behind the content pages. Everything is computed with astronomy-engine, using the same tested functions as
// the app's sky calendar, so a page and the app can never disagree. Pure functions, no HTML here.
import * as Astro from "astronomy-engine";
import { moonEvents, lunarEclipses, solarEclipses, planetEvents, seasonEvents, showerEvents } from "../src/calendar.js";
import { SHOWERS, SHOWERS_SOURCE } from "../src/tonight.js";

export { SHOWERS, SHOWERS_SOURCE };
const DAY = 86400000;
const range = (y0, y1) => ({ from: new Date(Date.UTC(y0, 0, 1)), to: new Date(Date.UTC(y1 + 1, 0, 1)) });

export function moonPhases(y0, y1) {
  const { from, to } = range(y0, y1);
  return moonEvents(from, to).map((e) => ({ time: e.time, quarter: e.quarter, name: e.title }));
}

export function seasons(y0, y1) {
  const { from, to } = range(y0, y1);
  return seasonEvents(from, to).map((e) => ({ time: e.time, name: e.title }));
}

// Global eclipse lists and, for each place, whether it can be seen from there.
export function eclipses(y0, y1, places) {
  const { from, to } = range(y0, y1);
  const lists = {};
  for (const p of places) {
    const obs = new Astro.Observer(p.lat, p.lon, 0);
    lists[p.id] = [...lunarEclipses(from, to, obs), ...solarEclipses(from, to, obs)].sort((a, b) => a.time - b.time);
  }
  const first = lists[places[0].id];
  return first.map((e, i) => ({
    id: e.id, body: e.body, kind: e.eclipseKind, time: e.time, title: e.title,
    places: places.map((p) => ({ id: p.id, name: p.name, visible: lists[p.id][i].visible, detail: lists[p.id][i].detail })),
  }));
}

export function planetEventsBetween(y0, y1) {
  const { from, to } = range(y0, y1);
  return planetEvents(from, to).sort((a, b) => a.time - b.time);
}

export function showersBetween(y0, y1, lat = 0) {
  const { from, to } = range(y0, y1);
  return showerEvents(from, to, lat).sort((a, b) => a.time - b.time);
}

// the highest a fixed point at declination `dec` ever gets from latitude `lat`
export const maxAltitude = (lat, dec) => 90 - Math.abs(lat - dec);

// ---- places
const sun = Astro.Body.Sun;
const noonAfter = (obs, t) => Astro.SearchHourAngle(sun, obs, 0, t).time;

// Sunrise, sunset and day length for the solar day around local noon on the given UT date. Polar cases return a note instead.
export function sunDay(place, utcDate) {
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const noon = noonAfter(obs, utcDate).date;
  const rise = Astro.SearchRiseSet(sun, obs, +1, new Date(noon.getTime() - 0.75 * DAY), 0.75);
  const set = Astro.SearchRiseSet(sun, obs, -1, noon, 0.75);
  if (rise && set) return { rise: rise.date, set: set.date, minutes: (set.date - rise.date) / 60000, noon };
  const eq = Astro.Equator(sun, noon, obs, true, true);
  const alt = Astro.Horizon(noon, obs, eq.ra, eq.dec, "normal").altitude;
  return { rise: null, set: null, minutes: alt > 0 ? 1440 : 0, noon, note: alt > 0 ? "The Sun does not set." : "The Sun does not rise." };
}

// How dark the night gets around a date: the hours between the end of astronomical twilight in the evening and its start in
// the morning (the Sun more than 18 degrees below the horizon). Returns hours, or 0 if the Sun never gets that low.
export function darkHours(place, utcDate) {
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const noon = noonAfter(obs, utcDate).date;
  const eveningEnd = Astro.SearchAltitude(sun, obs, -1, noon, 1, -18);
  if (!eveningEnd) return 0;
  const morningStart = Astro.SearchAltitude(sun, obs, +1, eveningEnd, 1, -18);
  if (!morningStart) return 0;
  return (morningStart.date - eveningEnd.date) / 3600000;
}

// Days of the year on which the Sun stays above the horizon all day (the midnight sun) or never rises, by scanning each day.
export function polarSpans(place, year) {
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const days = { up: [], down: [] };
  for (let d = 0; d < 366; d++) {
    const t = new Date(Date.UTC(year, 0, 1) + d * DAY);
    if (t.getUTCFullYear() !== year) break;
    const s = sunDay(place, t);
    if (!s.rise && !s.set) (s.minutes ? days.up : days.down).push(t);
  }
  const spans = (list) => {
    const out = [];
    for (const t of list) {
      const last = out[out.length - 1];
      if (last && t - last.to <= DAY) last.to = t; else out.push({ from: t, to: t });
    }
    return out;
  };
  return { sunStaysUp: spans(days.up), sunStaysDown: spans(days.down) };
}
