// The sky calendar: what is coming up, from the Moon's phases to eclipses, planet events, meteor showers and the seasons.
// Every time comes from astronomy-engine's own event searches (checked against the US Naval Observatory tables in
// test/calendar.test.js). Meteor shower dates come from the IMO table in tonight.js. Pure logic, no DOM.
import * as Astro from "astronomy-engine";
import { SHOWERS } from "./tonight.js";

const DAY = 86400000;
const PLANETS_NAKED_EYE = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const OPPOSITION_BODIES = ["Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const INFERIOR = ["Mercury", "Venus"];
// OURS: two naked-eye planets closer than this are listed as a close pairing, and a planet must be this far from the Sun
// to count as visible at all.
export const PAIR_MAX_SEPARATION_DEG = 3;
export const MIN_ELONGATION_DEG = 12;
// OURS: a meteor shower earns the home screen tile only if it can reach this many an hour under a perfect sky.
export const HIGHLIGHT_MIN_ZHR = 15;

const QUARTER = [
  { title: "New Moon", detail: "The darkest skies of the month for faint objects, galaxies and the Milky Way.", tag: "MOON" },
  { title: "First quarter Moon", detail: "Half lit and high in the evening. Craters along the edge of the light show in sharp relief.", tag: "MOON" },
  { title: "Full Moon", detail: "The brightest night of the month. Faint objects wash out, but the Moon itself is at its roundest.", tag: "MOON" },
  { title: "Last quarter Moon", detail: "Half lit and high before dawn.", tag: "MOON" },
];

const iso = (d) => d.toISOString();
const pct = (x) => `${Math.round(x * 100)}%`;
const deg = (x) => `${Math.round(x)}°`;

function moonAltitude(date, obs) {
  const eq = Astro.Equator(Astro.Body.Moon, date, obs, true, true);
  return Astro.Horizon(date, obs, eq.ra, eq.dec, "normal").altitude;
}

function moonEvents(from, end) {
  const out = [];
  let mq = Astro.SearchMoonQuarter(from);
  while (mq.time.date < end) {
    const q = QUARTER[mq.quarter];
    out.push({ id: `moon-${mq.quarter}-${mq.time.date.getTime()}`, kind: "moon", tag: q.tag, title: q.title, detail: q.detail, short: q.title.replace("quarter Moon", "quarter"), time: mq.time.date, quarter: mq.quarter });
    mq = Astro.NextMoonQuarter(mq);
  }
  return out;
}

function lunarEclipses(from, end, obs) {
  const out = [];
  let e = Astro.SearchLunarEclipse(from);
  while (e.peak.date < end) {
    const alt = moonAltitude(e.peak.date, obs);
    const visible = alt > 0;
    const kind = e.kind;
    const len = kind === "total" ? `Totality lasts about ${Math.round(e.sd_total * 2)} minutes.` : kind === "partial" ? `The partial phase lasts about ${Math.round(e.sd_partial * 2)} minutes.` : "A penumbral eclipse is a faint shading that is hard to see by eye.";
    out.push({
      id: `lunar-${e.peak.date.getTime()}`, kind: "eclipse", tag: "ECLIPSE", title: `${cap(kind)} lunar eclipse`, short: "Lunar eclipse", time: e.peak.date, eclipseKind: kind, body: "moon", visible,
      detail: `${len} ${visible ? `From here the Moon is ${deg(alt)} up at the peak.` : "From here the Moon is below the horizon at the peak, so you cannot see the middle of it."}`,
    });
    e = Astro.NextLunarEclipse(e.peak);
  }
  return out;
}

function solarEclipses(from, end, obs) {
  const out = [];
  let g = Astro.SearchGlobalSolarEclipse(from);
  while (g.peak.date < end) {
    let local = null;
    try {
      const l = Astro.SearchLocalSolarEclipse(new Date(g.peak.date.getTime() - 2 * DAY), obs);
      if (Math.abs(l.peak.time.date - g.peak.date) < DAY) local = l;
    } catch { local = null; }
    const where = g.latitude !== undefined ? ` The greatest eclipse is near ${Math.abs(Math.round(g.latitude))}°${g.latitude >= 0 ? "N" : "S"}, ${Math.abs(Math.round(g.longitude))}°${g.longitude >= 0 ? "E" : "W"}.` : "";
    let detail, visible = false;
    if (local && local.peak.altitude > 0) {
      visible = true;
      detail = `Visible from here: ${pct(local.obscuration)} of the Sun is covered at the peak, with the Sun ${deg(local.peak.altitude)} up.${where} Never look at the Sun without proper eclipse glasses.`;
    } else if (local) {
      detail = `The Sun is below your horizon at the peak, so you see at most the start or the end of it, if any.${where}`;
    } else {
      detail = `Not visible from here.${where}`;
    }
    out.push({ id: `solar-${g.peak.date.getTime()}`, kind: "eclipse", tag: "ECLIPSE", title: `${cap(g.kind)} solar eclipse`, short: "Solar eclipse", time: g.peak.date, eclipseKind: g.kind, body: "sun", visible, detail });
    g = Astro.NextGlobalSolarEclipse(g.peak);
  }
  return out;
}

function planetEvents(from, end) {
  const out = [];
  for (const name of OPPOSITION_BODIES) {
    let t = Astro.SearchRelativeLongitude(name, 0, from);
    while (t.date < end) {
      const mag = Astro.Illumination(name, t).mag;
      const au = Astro.GeoVector(name, t, true).Length();
      out.push({ id: `opp-${name}-${t.date.getTime()}`, kind: "planet", tag: "PLANET", title: `${name} at opposition`, short: `${name} opposition`, time: t.date,
        detail: `${name} is opposite the Sun, so it is up all night and as bright and close as it gets this year: magnitude ${mag.toFixed(1)}, ${au.toFixed(2)} AU away.${name === "Uranus" || name === "Neptune" ? " It still needs binoculars or a telescope." : ""}` });
      t = Astro.SearchRelativeLongitude(name, 0, new Date(t.date.getTime() + DAY));
    }
  }
  for (const name of INFERIOR) {
    let e = Astro.SearchMaxElongation(name, from);
    while (e.time.date < end) {
      const evening = e.visibility === "evening";
      out.push({ id: `elong-${name}-${e.time.date.getTime()}`, kind: "planet", tag: "PLANET", title: `${name} at greatest ${evening ? "eastern" : "western"} elongation`, short: `${name} elongation`, time: e.time.date,
        detail: `${name} is ${e.elongation.toFixed(0)}° from the Sun, as far as it gets this time, and best seen in the ${evening ? "evening sky after sunset" : "morning sky before sunrise"}.` });
      e = Astro.SearchMaxElongation(name, new Date(e.time.date.getTime() + DAY));
    }
  }
  return out.concat(pairings(from, end));
}

// Close pairings of two naked-eye planets: a local minimum of their separation below the limit, with both well clear of the Sun.
function pairings(from, end) {
  const step = DAY / 4;
  const times = [];
  for (let t = from.getTime() - step; t <= end.getTime() + step; t += step) times.push(t);
  const vec = Object.fromEntries(PLANETS_NAKED_EYE.map((b) => [b, times.map((t) => Astro.GeoVector(b, new Date(t), true))]));
  const out = [];
  for (let i = 0; i < PLANETS_NAKED_EYE.length; i++) {
    for (let j = i + 1; j < PLANETS_NAKED_EYE.length; j++) {
      const a = PLANETS_NAKED_EYE[i], b = PLANETS_NAKED_EYE[j];
      const sep = times.map((_, k) => Astro.AngleBetween(vec[a][k], vec[b][k]));
      for (let k = 1; k < times.length - 1; k++) {
        if (!(sep[k] < sep[k - 1] && sep[k] <= sep[k + 1] && sep[k] < PAIR_MAX_SEPARATION_DEG)) continue;
        const best = refineMinimum((t) => Astro.AngleBetween(Astro.GeoVector(a, new Date(t), true), Astro.GeoVector(b, new Date(t), true)), times[k - 1], times[k + 1]);
        if (best.t < from.getTime() || best.t >= end.getTime()) continue;
        const date = new Date(best.t);
        const ea = Astro.Elongation(a, date), eb = Astro.Elongation(b, date);
        if (Math.min(ea.elongation, eb.elongation) < MIN_ELONGATION_DEG) continue;
        const evening = ea.visibility === "evening";
        out.push({ id: `pair-${a}-${b}-${best.t}`, kind: "planet", tag: "PLANET", title: `${a} and ${b} close together`, short: `${a} and ${b}`, time: date, separation: best.v,
          detail: `${a} and ${b} are ${best.v < 1 ? best.v.toFixed(1) : best.v.toFixed(0)}° apart, a fine sight in binoculars. They are ${Math.round(ea.elongation)}° and ${Math.round(eb.elongation)}° from the Sun, in the ${evening ? "evening" : "morning"} sky.` });
      }
    }
  }
  return out;
}

// golden-section search for the smallest f on [lo, hi]
function refineMinimum(f, lo, hi) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 40; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const t = (a + b) / 2;
  return { t, v: f(t) };
}

function seasonEvents(from, end) {
  const out = [];
  const names = [["mar_equinox", "March equinox", "Day and night are about equal everywhere."], ["jun_solstice", "June solstice", "The longest day in the north and the shortest in the south."],
    ["sep_equinox", "September equinox", "Day and night are about equal everywhere."], ["dec_solstice", "December solstice", "The shortest day in the north and the longest in the south."]];
  for (let y = from.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    const s = Astro.Seasons(y);
    for (const [key, title, detail] of names) {
      const d = s[key].date;
      if (d >= from && d < end) out.push({ id: `season-${key}-${y}`, kind: "season", tag: "SEASON", title, short: title, detail, time: d });
    }
  }
  return out;
}

// Meteor showers: the IMO peak date for each year in range. The date has no time of day, so it is shown as a date only.
function showerEvents(from, end, lat) {
  const out = [];
  for (let y = from.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    for (const s of SHOWERS) {
      const t = new Date(Date.UTC(y, s.peak[0] - 1, s.peak[1], 12));
      if (t < from || t >= end) continue;
      const moon = Astro.Illumination(Astro.Body.Moon, new Date(Date.UTC(y, s.peak[0] - 1, s.peak[1], 0))).phase_fraction;
      const highest = 90 - Math.abs(lat - s.dec);  // the highest a fixed point in the sky ever gets from this latitude
      const radiant = highest < 10 ? "From here the radiant never gets above the horizon by much, so few will be seen."
        : highest < 30 ? `From here the radiant only reaches ${deg(highest)}, so expect fewer.` : `From here the radiant reaches ${deg(highest)}.`;
      out.push({ id: `shower-${s.name}-${y}`, kind: "shower", tag: "SHOWER", title: `${s.name} meteor shower peaks`, short: s.name, time: t, allDay: true, zhr: s.zhr, moonFraction: moon, radiantMax: highest,
        detail: `Up to about ${s.zhr} an hour under a perfect sky, fewer in practice. The Moon is ${pct(moon)} lit${moon > 0.6 ? ", which hides the fainter meteors" : moon < 0.25 ? ", which is good for meteors" : ""}. ${radiant} Date from the IMO table; it can be a day off in other years.` });
    }
  }
  return out;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export const KINDS = ["moon", "eclipse", "planet", "shower", "season"];

// from: Date, days: how far ahead. Returns events sorted by time.
export function skyCalendar({ lat, lon, from, days = 90 }) {
  const start = new Date(from), end = new Date(start.getTime() + days * DAY);
  const obs = new Astro.Observer(lat, lon, 0);
  const events = [
    ...moonEvents(start, end), ...lunarEclipses(start, end, obs), ...solarEclipses(start, end, obs),
    ...planetEvents(start, end), ...seasonEvents(start, end), ...showerEvents(start, end, lat),
  ];
  events.sort((a, b) => a.time - b.time);
  return { from: start, to: end, events };
}

// The one event worth a tile on the home screen: the next eclipse, planet event or meteor shower within 45 days, else the next Full Moon.
export function highlight(events, now) {
  const t = now.getTime();
  const future = events.filter((e) => e.time.getTime() >= t - (e.allDay ? 12 * 3600000 : 0));
  const near = future.find((e) => (e.kind === "eclipse" || e.kind === "planet" || e.kind === "shower") && e.time.getTime() - t < 45 * DAY && (e.kind !== "eclipse" || e.visible || e.body === "sun") && (e.kind !== "shower" || e.zhr >= HIGHLIGHT_MIN_ZHR));
  return near || future.find((e) => e.kind === "moon" && e.quarter === 2) || future[0] || null;
}
