// "Will I see it tonight?": one plan for the coming night at a place. It combines how dark and clear it will be with the
// things worth going outside for: bright satellite passes, Starlink strings, aurora, planets, meteor showers and the Moon.
import * as Astro from "astronomy-engine";
import { clamp, sunAltAz, auroraFromGrid, compassPoint, bestWindow, googleCalendarUrl, raDecToAltAz, formatDuration } from "./core.js";
import { hourSample, cloudAtHour } from "./plan.js";
import { passesForSteps } from "./sgp4.js";
import { findTrains, trainEventsSteps } from "./trains.js";
import { runSteps, runStepsAsync } from "./schedule.js";

const STATIONS = [
  { id: 25544, name: "International Space Station", short: "ISS" },
  { id: 48274, name: "Chinese space station", short: "Tiangong" },
  { id: 20580, name: "Hubble Space Telescope", short: "Hubble" },
];
const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

// Copied by hand from Table 5, "Working List of Visual Meteor Showers", in the International Meteor Organization 2027
// Meteor Shower Calendar (https://www.imo.net/ShCal27s.pdf, read on 4 Oct 2026). The IMO says the maximum dates are
// accurate only for 2027, so in another year a peak can be a day or so off. Where the IMO prints a rate such as "110+"
// the number is used without the plus. Rates are zenithal hourly rates under a perfect sky, so real counts are lower.
// Only ten of the table's 39 rows are carried. [month, day] pairs; a range that ends before it starts runs over New Year.
export const SHOWERS_SOURCE = { name: "IMO Working List of Visual Meteor Showers, 2027 calendar", url: "https://www.imo.net/ShCal27s.pdf", read: "2026-10-04" };
export const SHOWERS = [
  { name: "Quadrantids", start: [12, 28], end: [1, 12], peak: [1, 4], zhr: 80, ra: 230, dec: 49 },
  { name: "Lyrids", start: [4, 14], end: [4, 30], peak: [4, 23], zhr: 18, ra: 271, dec: 34 },
  { name: "Eta Aquariids", start: [4, 19], end: [5, 28], peak: [5, 6], zhr: 50, ra: 338, dec: -1 },
  { name: "Southern Delta Aquariids", start: [7, 12], end: [8, 23], peak: [7, 31], zhr: 25, ra: 340, dec: -16 },
  { name: "Perseids", start: [7, 17], end: [8, 24], peak: [8, 13], zhr: 110, ra: 48, dec: 58 },
  { name: "Draconids", start: [10, 6], end: [10, 10], peak: [10, 9], zhr: 5, ra: 263, dec: 56 },
  { name: "Southern Taurids", start: [9, 20], end: [11, 20], peak: [11, 6], zhr: 7, ra: 52, dec: 15 },
  { name: "Orionids", start: [10, 2], end: [11, 7], peak: [10, 22], zhr: 20, ra: 95, dec: 16 },
  { name: "Leonids", start: [11, 6], end: [11, 30], peak: [11, 18], zhr: 15, ra: 152, dec: 22 },
  { name: "Geminids", start: [12, 4], end: [12, 20], peak: [12, 14], zhr: 150, ra: 112, dec: 33 },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function showersOn(date) {
  const md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  return SHOWERS.filter((s) => {
    const a = s.start[0] * 100 + s.start[1], b = s.end[0] * 100 + s.end[1];
    return a <= b ? md >= a && md <= b : md >= a || md <= b;
  });
}

// Whole days from `date` to the shower's peak, taking the nearest peak in the previous, current or next year
// (the Quadrantids peak just after New Year).
export function daysFromPeak(date, shower) {
  const y = date.getUTCFullYear();
  let best = Infinity;
  for (const yy of [y - 1, y, y + 1]) {
    const peak = Date.UTC(yy, shower.peak[0] - 1, shower.peak[1]);
    best = Math.min(best, Math.abs(Date.UTC(y, date.getUTCMonth(), date.getUTCDate()) - peak) / 86400000);
  }
  return best;
}

// Showers worth a mention: active, and close enough to their peak that the real rate is a fair share of the quoted one.
// The 3 day limit is an editorial choice, not a published threshold.
export const NEAR_PEAK_DAYS = 3;
export function showersNearPeak(date, days = NEAR_PEAK_DAYS) {
  return showersOn(date).filter((s) => daysFromPeak(date, s) <= days);
}

// The part of a pass that can be seen: the samples where the satellite is in sunlight and the sky is dark. A pass often
// starts in Earth's shadow or ends by flying into it, so the highest point of the pass may not be visible at all.
export function visiblePart(pass) {
  const lit = pass.track.filter((t) => t.lit);
  if (!lit.length) return null;
  const first = lit[0], last = lit[lit.length - 1];
  const best = lit.reduce((a, b) => (b.el > a.el ? b : a));
  const step = pass.track.length > 1 ? pass.track[1].time - pass.track[0].time : 20000;
  return { first, last, best, seconds: Math.round((last.time - first.time) / 1000 + step / 1000), fadesIn: first.time - pass.rise > 30000, fadesOut: pass.set - last.time > 30000 };
}

const fmtHm = (d, tz) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
// Built from parts so the punctuation is the same in every browser ("Mon 5 Oct", never "Mon, 5 Oct")
export const fmtDay = (d, tz) => {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).formatToParts(d)) o[p.type] = p.value;
  return `${o.weekday} ${o.day} ${o.month}`;
};
const dayKey = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
// "21:47" if the time is on the same local day as `ref`, otherwise "Thu 8 Oct 21:47"
export const whenText = (d, ref, tz) => (dayKey(d, tz) === dayKey(ref, tz) ? fmtHm(d, tz) : `${fmtDay(d, tz)} ${fmtHm(d, tz)}`);

// The first stretch of the next 30 hours with the Sun more than 6 degrees below the horizon (civil twilight over).
export function darkWindow(place, now, { hours = 30, darkAlt = -6, stepMin = 10 } = {}) {
  let start = null, end = null;
  const stop = now.getTime() + hours * 3600000;
  for (let t = now.getTime(); t <= stop; t += stepMin * 60000) {
    const dark = sunAltAz(place.lat, place.lon, new Date(t)).alt < darkAlt;
    if (dark && start === null) start = t;
    if (!dark && start !== null) { end = t; break; }
  }
  if (start === null) return null;
  return { start: new Date(start), end: new Date(end ?? stop), startsNow: start === now.getTime(), truncated: end === null };
}

function bodyTrack(body, place, win, stepMin = 20) {
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const out = [];
  for (let t = win.start.getTime(); t <= win.end.getTime(); t += stepMin * 60000) {
    const d = new Date(t);
    const eq = Astro.Equator(body, d, obs, true, true);
    const hz = Astro.Horizon(d, obs, eq.ra, eq.dec, "normal");
    out.push({ t: d, alt: hz.altitude, az: hz.azimuth });
  }
  return out;
}
const firstCross = (track, up) => { for (let i = 1; i < track.length; i++) if ((track[i - 1].alt > 0) !== (track[i].alt > 0) && (track[i].alt > 0) === up) return track[i].t; return null; };


// Items for the visible events of one Starlink string. Used by the Tonight plan and by the string sheet.
export function trainItems(args) {
  return runSteps(trainItemsSteps(args));
}
export function* trainItemsSteps({ train: tr, precise, place, from, hours, now, cloudThen = () => null, cloudNote = () => "", cloudFactor = () => 1, remind = null, limit = 3 }) {
  const tz = place.tz;
  const mk = remind || ((title, start, end, details) => ({ title, start, end, details, url: googleCalendarUrl({ title, start, end, details, location: place.name }) }));
  const events = (yield* trainEventsSteps(tr, precise, place, from, hours)).filter((e) => e.end > now).sort((a, b) => b.maxCount - a.maxCount).slice(0, limit).sort((a, b) => a.start - b.start);
  return events.map((e) => ({
    id: `train-${tr.launchDay}-${e.start.getTime()}`, kind: "train", tag: "TRAIN", title: `Starlink string of ${tr.count}`, time: e.peak, start: e.start, end: e.end,
    detail: `Up to ${e.maxCount} satellites at once, seen from the ${e.riseCompass} to the ${e.setCompass}, highest ${Math.round(e.maxEl)}° in the ${e.peakCompass} around ${fmtHm(e.peak, tz)}. Launched ${fmtDay(tr.launchDate, "UTC")}${tr.shape === "stretched" ? ", already stretched into a long string" : ""}.${cloudNote(e.peak)}`,
    interest: (70 + Math.min(20, e.maxCount * 2)) * cloudFactor(e.peak), cloud: cloudThen(e.peak), track: e.track,
    target: { kind: "sat", idx: tr.centralIdx }, sky: { alt: e.maxEl, az: e.azAtPeak }, maxEl: e.maxEl, count: e.maxCount,
    remind: mk(`Look up: Starlink string over ${place.name}`, new Date(e.start.getTime() - 5 * 60000), new Date(e.end.getTime() + 60000), `Up to ${e.maxCount} Starlink satellites in a line, ${e.riseCompass} to ${e.setCompass}. Times from Radar Around You (approximate).`),
  }));
}

export function buildTonight(args) {
  return runSteps(buildTonightSteps(args));
}
// The same plan worked out in slices: the result is identical, but the work (about a second on a slow phone, mostly satellite
// passes) is spread over tasks that each stop after budgetMs, so the page stays responsive. opts go to runStepsAsync.
export function buildTonightAsync(args, opts) {
  return runStepsAsync(buildTonightSteps(args), opts);
}
// buildTonight as a generator: it pauses between its parts and inside the long pass searches
export function* buildTonightSteps({ D, precise, place, now, kp = null }) {
  const tz = place.tz;
  const win = darkWindow(place, now);
  const aur = auroraFromGrid(D.aurora, place.lat, place.lon, 1100);
  const out = { place, now, window: win, items: [], conditions: [], aurora: aur };
  if (!win) {
    out.verdict = { level: "none", score: 0, headline: "No real darkness in the next 30 hours", sentence: "The Sun stays within 6 degrees of the horizon here, so stars, satellites and aurora are hard to see." };
    out.highlights = [];
    return out;
  }
  const winHours = (win.end - win.start) / 3600000;
  const cloudThen = (d) => { const c = cloudAtHour(place.clouds, d); return c == null ? null : Math.round(c); };
  const cloudNote = (d) => { const c = cloudThen(d); return c != null && c >= 60 ? ` Cloud then about ${c}%.` : ""; };
  const cloudFactor = (d) => { const c = cloudThen(d); return c != null && c >= 60 ? 0.6 : 1; };
  const remind = (title, start, end, details) => ({ title, start, end, details, url: googleCalendarUrl({ title, start, end, details, location: place.name }) });

  // ---- hourly scores, cloud and Moon over the window
  const first = new Date(Math.ceil(win.start.getTime() / 3600000) * 3600000);
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const hours = [];
  for (let t = first.getTime(); t < win.end.getTime(); t += 3600000) { hours.push(hourSample(place, new Date(t), aur.chance, obs)); yield; }
  const { scored, best } = bestWindow(hours);
  out.hours = hours; out.scored = scored; out.best = best;
  const known = hours.filter((h) => h.cloudKnown);
  const inBest = best ? hours.filter((h) => h.cloudKnown && h.t >= best.start && h.t < best.endExclusive) : [];
  const bestCloud = inBest.length ? Math.round(inBest.reduce((s, h) => s + h.cloud, 0) / inBest.length) : null;
  const cloudAvg = known.length ? Math.round(known.reduce((s, h) => s + h.cloud, 0) / known.length) : null;
  out.cloud = { known: known.length > 0, avg: cloudAvg, bestWindowAvg: bestCloud, min: known.length ? Math.round(Math.min(...known.map((h) => h.cloud))) : null, max: known.length ? Math.round(Math.max(...known.map((h) => h.cloud))) : null };
  const moonTrack = bodyTrack(Astro.Body.Moon, place, win, 20);
  yield;
  const moonFrac = hours.length ? hours[0].moonFrac : Astro.Illumination(Astro.Body.Moon, win.start).phase_fraction;
  const moonUpAtStart = moonTrack[0].alt > 0;
  const moonSet = firstCross(moonTrack, false), moonRise = firstCross(moonTrack, true);
  out.moon = { frac: moonFrac, upAtStart: moonUpAtStart, set: moonSet, rise: moonRise };

  // ---- conditions (no particular time)
  out.conditions.push({
    id: "dark", kind: "dark", title: win.startsNow ? `Dark now, until ${whenText(win.end, now, tz)}` : `Dark from ${whenText(win.start, now, tz)} to ${whenText(win.end, now, tz)}`,
    detail: `${formatDuration(win.end - win.start)} with the Sun more than 6 degrees below the horizon${win.truncated ? " (or the rest of the next 30 hours)" : ""}.`,
  });
  out.conditions.push({
    id: "cloud", kind: "weather", title: out.cloud.known ? (out.cloud.min === out.cloud.max ? `Cloud: ${out.cloud.min}% all night` : `Cloud: ${out.cloud.min}% to ${out.cloud.max}% overnight`) : "Cloud forecast not available for this place",
    detail: out.cloud.known ? `About ${cloudAvg}% on average. Forecast from MET Norway, hourly.` : "Hourly cloud forecasts are published for the six cities with a full data set only, so none is shown for this place.",
  });
  const moonLine = moonUpAtStart ? (moonSet ? `Up until ${whenText(moonSet, now, tz)}, then it is moon-free` : "Up all night") : moonRise ? `Rises at ${whenText(moonRise, now, tz)}, so it is moon-free before that` : "Not up tonight";
  out.conditions.push({ id: "moon", kind: "moon", title: `Moon ${Math.round(moonFrac * 100)}% lit`, detail: moonLine + "." });

  // ---- bright satellite passes
  const idxById = new Map();
  D.later.ids.forEach((id, i) => idxById.set(id, i));
  for (const st of STATIONS) {
    const sat = precise.get(st.id);
    if (!sat) continue;
    const idx = idxById.get(st.id);
    const passes = (yield* passesForSteps(sat, place, win.start, winHours, { minEl: 10 }))
      .map((p) => ({ p, v: visiblePart(p) })).filter((x) => x.v && x.v.best.el >= 15 && x.p.set > now);
    passes.sort((a, b) => b.v.best.el - a.v.best.el);
    const chosen = passes.slice(0, 3).sort((a, b) => a.v.first.time - b.v.first.time);
    for (const { p, v } of chosen) {
      const from = `${compassPoint(v.first.az)} at ${fmtHm(v.first.time, tz)}`;
      const to = `${compassPoint(v.last.az)} at ${fmtHm(v.last.time, tz)}`;
      out.items.push({
        id: `pass-${st.id}-${p.rise.getTime()}`, kind: "pass", tag: "PASS", title: `${st.short} passes over`, time: v.best.time, start: v.first.time, end: v.last.time,
        detail: `Visible ${fmtHm(v.first.time, tz)} to ${fmtHm(v.last.time, tz)} (${formatDuration(v.seconds * 1000)}): ${v.fadesIn ? "appears out of Earth's shadow" : "rises"} in the ${compassPoint(v.first.az)}, highest ${Math.round(v.best.el)}° in the ${compassPoint(v.best.az)}, ${v.fadesOut ? "fades into Earth's shadow" : "sets"} in the ${compassPoint(v.last.az)}.${cloudNote(v.best.time)}`,
        interest: ((st.id === 25544 ? 60 : 40) + v.best.el * 0.35) * cloudFactor(v.best.time), cloud: cloudThen(v.best.time),
        target: { kind: "sat", idx }, sky: { alt: v.best.el, az: v.best.az }, maxEl: v.best.el, name: st.name, visibleSeconds: v.seconds, passRise: p.rise, passSet: p.set, track: p.track.map((t) => ({ time: t.time, el: t.el, az: t.az, lit: t.lit })),
        remind: remind(`Look up: ${st.short} over ${place.name}`, new Date(v.first.time.getTime() - 5 * 60000), new Date(v.last.time.getTime() + 60000), `${st.name}: visible from the ${from} to the ${to}, highest ${Math.round(v.best.el)}° in the ${compassPoint(v.best.az)}. Times from Radar Around You (approximate to a minute).`),
      });
    }
    if (!chosen.length && st.id === 25544) {
      const later = (yield* passesForSteps(sat, place, now, 24 * 10, { minEl: 10 })).map((p) => ({ p, v: visiblePart(p) })).filter((x) => x.v && x.v.best.el >= 15);
      const nx = later[0] ? { max: { time: later[0].v.best.time, el: later[0].v.best.el, az: later[0].v.best.az }, rise: later[0].v.first.time } : null;
      out.conditions.push({
        id: "iss-next", kind: "note", title: "No visible ISS pass tonight",
        detail: nx ? `Next one you can see: ${whenText(nx.max.time, now, tz)}, ${Math.round(nx.max.el)}° up in the ${compassPoint(nx.max.az)}.` : "None in the next 10 days from here.",
        target: nx ? { kind: "sat", idx } : null, sky: nx ? { alt: nx.max.el, az: nx.max.az } : null, atTime: nx ? nx.max.time : null,
      });
    }
  }

  // ---- Starlink strings
  const trains = findTrains(D, precise, now);
  out.trains = trains;
  yield;
  for (const tr of trains) out.items.push(...(yield* trainItemsSteps({ train: tr, precise, place, from: win.start, hours: winHours, now, cloudThen, cloudNote, cloudFactor, remind, limit: 2 })));

  // ---- aurora
  const kpList = (D.meta.kp || []).filter((k) => { const t = Date.parse(k.t + "Z"); return t >= win.start.getTime() - 3 * 3600000 && t <= win.end.getTime(); });
  const kpPeak = kpList.length ? kpList.reduce((a, b) => (b.kp > a.kp ? b : a)) : null;
  out.kpPeak = kpPeak;
  if (aur.chance >= 5 || (kpPeak && kpPeak.kp >= 5 && Math.abs(place.lat) >= 40)) {
    const distText = aur.at ? `${Math.round(aur.at.distKm)} km` : "far";
    out.items.push({
      id: "aurora", kind: "aurora", tag: "AURORA", title: aur.chance >= 5 ? `Aurora chance about ${aur.chance}%` : "Aurora unlikely from here", time: kpPeak ? new Date(Date.parse(kpPeak.t + "Z")) : win.start,
      detail: `${aur.chance >= 5 ? `The aurora oval is about ${distText} away.` : "The oval is too far away for a realistic chance."}${kpPeak ? ` Geomagnetic activity (Kp) is forecast to reach ${kpPeak.kp.toFixed(1)} around ${fmtHm(new Date(Date.parse(kpPeak.t + "Z")), tz)}.` : ""} Look north${place.lat < 0 ? " (south from the southern hemisphere)" : ""}, away from city lights.`,
      interest: aur.chance >= 20 ? 50 + aur.chance : 20 + aur.chance, sky: { alt: 20, az: place.lat >= 0 ? 0 : 180 }, timeless: false,
    });
  }

  // ---- planets
  for (const name of PLANETS) {
    yield;
    const body = Astro.Body[name];
    const tr = bodyTrack(body, place, win, 20);
    const peak = tr.reduce((a, b) => (b.alt > a.alt ? b : a));
    let mag = null;
    try { mag = Astro.Illumination(body, peak.t).mag; } catch { mag = null; }
    if (peak.alt < 15 || (mag !== null && mag > 3)) continue;
    const upFrom = tr.find((s) => s.alt > 5), upTo = [...tr].reverse().find((s) => s.alt > 5);
    out.items.push({
      id: `planet-${name}`, kind: "planet", tag: "PLANET", title: name, time: peak.t,
      detail: `${mag !== null ? `Magnitude ${mag.toFixed(1)}. ` : ""}Above 5° from ${fmtHm(upFrom.t, tz)} to ${fmtHm(upTo.t, tz)}, highest ${Math.round(peak.alt)}° in the ${compassPoint(peak.az)} at ${fmtHm(peak.t, tz)}.`,
      interest: mag !== null && mag < -1.5 ? 45 : mag !== null && mag < 0.5 ? 32 : 22, target: { kind: "planet", name }, sky: { alt: peak.alt, az: peak.az },
    });
  }

  // ---- meteor showers
  for (const sh of showersNearPeak(win.start)) {
    let bestAlt = -90, bestT = null;
    for (let t = win.start.getTime(); t <= win.end.getTime(); t += 30 * 60000) {
      const a = raDecToAltAz(sh.ra, sh.dec, place.lat, place.lon, new Date(t));
      if (a.alt > bestAlt) { bestAlt = a.alt; bestT = new Date(t); }
    }
    if (bestAlt < 20) continue;
    const moonNote = moonFrac > 0.6 ? ` The Moon is ${Math.round(moonFrac * 100)}% lit, which hides the fainter meteors.` : "";
    out.items.push({
      id: `shower-${sh.name}`, kind: "shower", tag: "SHOWER", title: `${sh.name} meteor shower`, time: bestT,
      detail: `Peaks around ${sh.peak[1]} ${MONTHS[sh.peak[0] - 1]}, up to about ${sh.zhr} an hour under a perfect sky (fewer in practice). The radiant is highest at ${fmtHm(bestT, tz)}, ${Math.round(bestAlt)}° up.${moonNote} Source: ${SHOWERS_SOURCE.name}; peak dates can shift by a day between years.`,
      interest: 35 + sh.zhr / 5 - (moonFrac > 0.6 ? 10 : 0), sky: { alt: bestAlt, az: raDecToAltAz(sh.ra, sh.dec, place.lat, place.lon, bestT).az },
    });
  }

  // ---- verdict
  out.items.sort((a, b) => (a.time || 0) - (b.time || 0));
  out.highlights = out.items.filter((i) => i.kind !== "note").sort((a, b) => b.interest - a.interest).slice(0, 3);
  const avgScore = best ? best.avg : 0;
  const hl = out.highlights.map((h) => (h.kind === "pass" ? `${h.name} at ${fmtHm(h.time, tz)}` : h.kind === "train" ? `a Starlink string at ${fmtHm(h.time, tz)}` : h.kind === "aurora" ? `a ${aur.chance}% aurora chance` : h.kind === "planet" ? h.title : h.title));
  let level, headline, sentence;
  if (!best) {
    level = "poor";
    if (cloudAvg !== null && cloudAvg >= 70) { headline = "Cloudy tonight"; sentence = `Cloud covers about ${cloudAvg}% of the sky, so most things will be hidden.`; }
    else if (moonFrac > 0.6) { headline = "A bright Moon washes out the sky"; sentence = `The Moon is ${Math.round(moonFrac * 100)}% lit. Satellites and planets still show.`; }
    else { headline = "Not a good night for stargazing"; sentence = "Clouds, a bright Moon or too little darkness leave no good window."; }
    if (hl.length) sentence += ` Still worth a look: ${hl.join(", ")}.`;
  } else {
    level = avgScore >= 75 ? "excellent" : avgScore >= 55 ? "good" : "fair";
    headline = level === "excellent" ? "Excellent night to look up" : level === "good" ? "Good night to look up" : "Fair night, with some gaps";
    sentence = `Best window ${whenText(best.start, now, tz)} to ${fmtHm(best.endExclusive, tz)}${bestCloud !== null ? `, cloud about ${bestCloud}%` : ""}.${hl.length ? ` Highlights: ${hl.join(", ")}.` : ""}`;
  }
  out.verdict = { level, score: avgScore, headline, sentence };
  return out;
}
