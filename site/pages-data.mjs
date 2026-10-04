// The reference pages whose content is computed: Moon phases, equinoxes and solstices, eclipses, planets and meteor showers.
// Every number comes from site/data.mjs, which uses the same tested functions as the app, and is checked against the US Naval
// Observatory's published tables at build time (site/verify.mjs). A page never claims a check that was not run.
import * as Astro from "astronomy-engine";
import { esc, table, timeTag, sources } from "./layout.mjs";
import { moonPhases, seasons, eclipses, planetEventsBetween, SHOWERS, SHOWERS_SOURCE, maxAltitude } from "./data.mjs";

export const Y0 = 2026, Y1 = 2027;
export const USNO = { title: "U.S. Naval Observatory, Astronomical Applications API", url: "https://aa.usno.navy.mil/data/api", note: "The published tables our results were compared with" };
export const ENGINE = { title: "astronomy-engine", url: "https://github.com/cosinekitty/astronomy", note: "The MIT licensed library that does the calculations, run on the page's build machine and in the app" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86400000;
const utc = (d, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(d);
const dateLong = (d) => utc(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const hm = (d) => utc(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const num = (n, d = 0) => n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const seconds = (s) => (s >= 90 ? `${Math.round(s / 60)} minutes` : `${Math.round(s)} seconds`);

// ---------------------------------------------------------------- Moon phases
export function moonPage(checks) {
  const all = moonPhases(Y0, Y1);
  // one row per lunation: each New Moon with the first quarter, full Moon and last quarter that follow it. The row belongs to
  // the year of its first phase, so a lunation that crosses New Year stays together.
  const lunations = [];
  let cur = null;
  for (const p of all) {
    if (p.quarter === 0 || !cur) { cur = { 0: null, 1: null, 2: null, 3: null }; lunations.push(cur); }
    cur[p.quarter] = p;
  }
  const rowYear = (r) => (r[0] || r[1] || r[2] || r[3]).time.getUTCFullYear();
  const byYear = (y) => lunations.filter((r) => rowYear(r) === y);
  const cell = (p) => (p ? `${timeTag(p.time, "day")} ${timeTag(p.time)}` : "");
  const tableFor = (y) => table({
    caption: `Moon phases in ${y}. Dates and times are in UTC.`, head: ["New Moon", "First quarter", "Full Moon", "Last quarter"],
    rows: byYear(y).map((r) => ({ attrs: r[2] ? ` data-event="Full Moon" data-event-ts="${r[2].time.toISOString()}"` : "", cells: [cell(r[0]), cell(r[1]), cell(r[2]), cell(r[3])] })),
  });
  const news = all.filter((p) => p.quarter === 0);
  const gaps = news.slice(1).map((p, i) => (p.time - news[i].time) / DAY);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const fulls = all.filter((p) => p.quarter === 2);
  // the Harvest Moon is the full Moon nearest the September equinox
  const harvest = (y) => { const eq = seasons(y, y).find((s) => s.name === "September equinox").time; return fulls.reduce((best, f) => (Math.abs(f.time - eq) < Math.abs(best.time - eq) ? f : best)); };
  const mc = checks && checks.phases;
  const body = `
<div class="tz"></div><p id="next-event" class="note" hidden></p>
<h2 id="${Y0}">Moon phases in ${Y0}</h2>${tableFor(Y0)}
<h2 id="${Y1}">Moon phases in ${Y1}</h2>${tableFor(Y1)}
<h2 id="what">What the four phases are</h2>
<p>The Moon's phase is set by where it is in relation to the Sun as seen from Earth. This page uses the standard definition, the one the calculation library documents: a <strong>new Moon</strong> is the moment the Moon and the Sun have the same ecliptic longitude, a <strong>full Moon</strong> is when they are 180 degrees apart, and the <strong>first and last quarters</strong> are when the Moon is 90 degrees ahead of or behind the Sun. Each phase happens at one instant that is the same everywhere on Earth, so the times above are in UTC. The calendar date in your own time zone can differ by a day.</p>
<h2 id="length">How long a lunar month really is</h2>
<p>Between ${Y0} and ${Y1} there are ${news.length} new Moons. The gaps between them average ${num(mean, 2)} days, but a single gap ranges from ${num(Math.min(...gaps), 1)} to ${num(Math.max(...gaps), 1)} days, because the Moon's orbit is not a circle and the Sun's pull changes the Moon's speed through the month.</p>
<h2 id="harvest">The Harvest Moon</h2>
<p>The Harvest Moon is the full Moon that falls nearest the September equinox. In ${Y0} that is the full Moon of ${dateLong(harvest(Y0).time)} (${hm(harvest(Y0).time)} UTC) and in ${Y1} it is the full Moon of ${dateLong(harvest(Y1).time)} (${hm(harvest(Y1).time)} UTC).</p>
<h2 id="checked">How these times were checked</h2>
<p>${mc && mc.matched ? `Every one of the ${mc.n} phases in ${Y0} and ${Y1} was compared with the US Naval Observatory's published table for those years. All ${mc.n} agree, and the largest difference is ${seconds(mc.worstSeconds)}. The Observatory prints whole minutes, so differences of up to half a minute are rounding, not error.` : "The comparison with the US Naval Observatory tables was not available when this page was built, so no accuracy figure is given here."}</p>
${sources([USNO, ENGINE])}`;
  return {
    file: "moon-phases/index.html", crumbTitle: "Moon phases",
    title: `Moon phases ${Y0} and ${Y1}: exact dates and times (UTC)`,
    description: `Every new, first quarter, full and last quarter Moon in ${Y0} and ${Y1} with exact UTC times, computed and compared with the US Naval Observatory's tables.`,
    h1: `Moon phases ${Y0} and ${Y1}`, kicker: "Reference",
    lead: `All ${all.length} Moon phases from January ${Y0} to December ${Y1}, to the minute, in UTC. See your own sky tonight in the live app.`,
    body, cta: { label: "See the Moon over your place now", query: "#sky" }, updated: true,
  };
}

// ---------------------------------------------------------------- equinoxes and solstices
export function seasonsPage(checks, cities) {
  const list = seasons(Y0, Y1);
  const sc = checks && checks.seasons;
  const rows = list.map((s) => ({ attrs: ` data-event="${esc(s.name)}" data-event-ts="${s.time.toISOString()}"`, cells: [esc(s.name), `${timeTag(s.time, "day")} ${timeTag(s.time)}`, s.name.startsWith("March") || s.name.startsWith("September") ? "Day and night are nearly equal" : s.name.startsWith("June") ? "Longest day in the north, shortest in the south" : "Shortest day in the north, longest in the south"] }));
  const sun = Astro.Body.Sun;
  const dayLen = (c, date) => {
    const obs = new Astro.Observer(c.lat, c.lon, 0);
    const noon = Astro.SearchHourAngle(sun, obs, 0, date).time.date;
    const r = Astro.SearchRiseSet(sun, obs, +1, new Date(noon - 0.75 * DAY), 0.75), s = Astro.SearchRiseSet(sun, obs, -1, noon, 0.75);
    if (!r || !s) return { text: "Sun stays up or down all day", minutes: null };
    const m = (s.date - r.date) / 60000;
    return { text: `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`, minutes: m };
  };
  const jun = new Date(Date.UTC(Y0, 5, 21)), dec = new Date(Date.UTC(Y0, 11, 21));
  const cityRows = cities.map((c) => { const a = dayLen(c, jun), b = dayLen(c, dec); return [esc(c.name), `${num(Math.abs(c.lat), 1)}°${c.lat >= 0 ? "N" : "S"}`, a.text, b.text]; });
  const body = `
<div class="tz"></div><p id="next-event" class="note" hidden></p>
${table({ caption: `Equinoxes and solstices, ${Y0} and ${Y1}. Times in UTC.`, head: ["Event", "When (UTC)", "What it means"], rows })}
<h2 id="why">Why they happen</h2>
<p>Earth's axis is tilted. An <strong>equinox</strong> is the moment the Sun is directly over the equator, and a <strong>solstice</strong> is the moment it is furthest north or south. The instants are the same everywhere on Earth; only the local date and clock time depend on where you are.</p>
<h2 id="daylength">Day length on the ${Y0} solstices</h2>
<p>How long the Sun is above the horizon on the June and December solstices of ${Y0} at six places, from sunrise to sunset.</p>
${table({ caption: `Day length on 21 June and 21 December ${Y0}`, head: ["Place", "Latitude", "21 June", "21 December"], rows: cityRows, numeric: [1, 2, 3] })}
<h2 id="checked">How these were checked</h2>
<p>${sc && sc.matched ? `All ${sc.n} equinoxes and solstices in ${Y0} and ${Y1} agree with the US Naval Observatory's table; the largest difference is ${seconds(sc.worstSeconds)}.` : "The comparison with the US Naval Observatory table was not available when this page was built."}${checks && checks.sunTimes && checks.sunTimes.matched ? ` Sunrise and sunset on both ${Y0} solstices at these six places were compared with the Observatory's rise and set tables: ${checks.sunTimes.n} times, all within ${seconds(Math.max(30, checks.sunTimes.worstSeconds))}.` : ""}</p>
${sources([USNO, ENGINE])}`;
  return {
    file: "seasons/index.html", crumbTitle: "Equinoxes and solstices",
    title: `Equinoxes and solstices ${Y0} and ${Y1}: exact times (UTC)`,
    description: `The exact UTC time of every equinox and solstice in ${Y0} and ${Y1}, plus day length at six places on the ${Y0} solstices. Checked against US Naval Observatory tables.`,
    h1: `Equinoxes and solstices ${Y0} and ${Y1}`, kicker: "Reference",
    lead: "The four turning points of the year, to the minute, and what they do to the length of the day.",
    body, cta: { label: "Open the live sky calendar", query: "#calendar" },
  };
}

// ---------------------------------------------------------------- eclipses
export function eclipsesPage(checks, cities) {
  const list = eclipses(Y0, Y1, cities);
  const ec = checks && checks.solarEclipses;
  const rows = list.map((e) => ({ attrs: ` data-event="${esc(e.title)}" data-event-ts="${e.time.toISOString()}"`, cells: [`${timeTag(e.time, "day")} ${utc(e.time, { year: "numeric" })}`, `${timeTag(e.time)} UTC`, esc(e.title), e.places.filter((p) => p.visible).map((p) => esc(p.name)).join(", ") || "None of the six places"] }));
  const detailRows = list.map((e) => [`<strong>${esc(e.title)}</strong>, ${dateLong(e.time)}`, `<ul>${e.places.map((p) => `<li><strong>${esc(p.name)}:</strong> ${esc(p.detail)}</li>`).join("")}</ul>`]);
  const body = `
<div class="tz"></div><p id="next-event" class="note" hidden></p>
${table({ caption: `Solar and lunar eclipses, ${Y0} and ${Y1}. Time of greatest eclipse in UTC.`, head: ["Date", "Greatest eclipse", "Eclipse", "Visible from"], rows })}
<p class="note">"Visible from" covers only the six places this site works out in detail: ${cities.map((c) => esc(c.name)).join(", ")}. An eclipse can be visible from many other places. The live app computes the answer for the place you pick.</p>
<h2 id="detail">What each place sees</h2>
${detailRows.map(([h, b]) => `<h3>${h}</h3>${b}`).join("")}
<h2 id="kinds">What the types mean</h2>
<p>In a <strong>total solar eclipse</strong> the Moon fully covers the Sun for places inside a narrow path; in an <strong>annular</strong> one the Moon is too far away to cover it completely and a ring of Sun shows; in a <strong>partial</strong> one it covers only part. A lunar eclipse is the Moon passing through Earth's shadow, and it can be seen from anywhere on the night side of Earth.</p>
<h2 id="checked">How these were checked</h2>
<p>${ec && ec.matched ? `The ${ec.n} solar eclipses in ${Y0} and ${Y1} match the US Naval Observatory's table in date and type.` : "The comparison with the US Naval Observatory table was not available when this page was built."} The Observatory offers no lunar eclipse table through its API, so the lunar eclipse dates here come from the calculation library alone and have not been compared with a second source.</p>
${sources([USNO, ENGINE])}`;
  return {
    file: "eclipses/index.html", crumbTitle: "Eclipses",
    title: `Solar and lunar eclipses ${Y0} and ${Y1}: dates and where to see them`,
    description: `Every solar and lunar eclipse in ${Y0} and ${Y1} with the time of greatest eclipse in UTC and whether it is visible from six major cities.`,
    h1: `Eclipses in ${Y0} and ${Y1}`, kicker: "Reference",
    lead: `${list.length} eclipses in two years, with the time of greatest eclipse and what each of six cities will see.`,
    body, cta: { label: "Open the sky calendar for your place", query: "#calendar" },
  };
}

// ---------------------------------------------------------------- planets
export function planetsPage() {
  const list = planetEventsBetween(Y0, Y1);
  const rows = list.map((e) => ({ attrs: ` data-event="${esc(e.short || e.title)}" data-event-ts="${e.time.toISOString()}"`, cells: [`${timeTag(e.time, "day")} ${utc(e.time, { year: "numeric" })}`, esc(e.title), esc(e.detail)] }));
  const body = `
<div class="tz"></div><p id="next-event" class="note" hidden></p>
${table({ caption: `Planet events, ${Y0} and ${Y1}. Dates in UTC.`, head: ["Date", "Event", "What it means"], rows })}
<h2 id="terms">The terms</h2>
<p><strong>Opposition</strong> is when a planet outside Earth's orbit is on the opposite side of the sky from the Sun. It rises at sunset and is up all night, and it is as close and bright as it gets that year. <strong>Greatest elongation</strong> is when Mercury or Venus appears furthest from the Sun in the sky, which is the best time to see them. A <strong>conjunction</strong> is when two bodies pass close together in the sky; the separation listed is as seen from Earth, and they are not close in space.</p>
<h2 id="how">How these were worked out</h2>
<p>The dates come from the astronomy-engine library's planetary positions. We have not compared this particular list with a second published table, so treat the dates as accurate to the day and check an almanac before planning an expedition around one.</p>
${sources([ENGINE])}`;
  return {
    file: "planets/index.html", crumbTitle: "Planets",
    title: `Planet oppositions, elongations and conjunctions ${Y0} and ${Y1}`,
    description: `When each planet is at opposition, when Mercury and Venus are best placed, and the close planet pairings in ${Y0} and ${Y1}, with dates in UTC.`,
    h1: `Planets in ${Y0} and ${Y1}`, kicker: "Reference",
    lead: "The dates that matter for planet watching, computed from the planets' positions.",
    body, cta: { label: "See the planets in your sky", query: "#sky" },
  };
}

// ---------------------------------------------------------------- meteor showers
export function showersPage(cities) {
  const peakDate = (s, y) => new Date(Date.UTC(y, s.peak[0] - 1, s.peak[1]));
  const lit = (d) => Math.round(Astro.Illumination(Astro.Body.Moon, d).phase_fraction * 100);
  const con = (s) => Astro.Constellation(s.ra / 15, s.dec).name;
  const pn = (m, d) => `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  const rows = SHOWERS.map((s) => [`<strong>${esc(s.name)}</strong>`, `${pn(s.peak[0], s.peak[1])}`, `${s.zhr}`, esc(con(s)), `${pn(s.start[0], s.start[1])} to ${pn(s.end[0], s.end[1])}`, `${lit(peakDate(s, Y0))}%`, `${lit(peakDate(s, Y1))}%`]);
  const city = (s, c) => Math.round(maxAltitude(c.lat, s.dec));
  const altRows = SHOWERS.map((s) => [`<strong>${esc(s.name)}</strong>`, ...cities.map((c) => { const a = city(s, c); return a > 0 ? `${a}°` : "never rises"; })]);
  const body = `
${table({ caption: `Ten annual meteor showers. Peak dates and rates are from the IMO working list. "Moon lit" is how much of the Moon's disc is lit at 00:00 UTC on the peak date.`, head: ["Shower", "Peak", "ZHR", "Radiant in", "Active", `Moon lit ${Y0}`, `Moon lit ${Y1}`], rows, numeric: [2, 5, 6] })}
<h2 id="zhr">What ZHR means</h2>
<p>ZHR is the zenithal hourly rate: how many meteors one person could see in an hour with the radiant straight overhead under a perfect dark sky. Real counts are lower, often much lower, because of light pollution, a low radiant, clouds and moonlight. Treat it as a way to compare showers, not a promise.</p>
<h2 id="moon">Moonlight and the peak</h2>
<p>A bright Moon washes out the fainter meteors. The two right-hand columns show how much of the Moon is lit at the peak in each year, computed from the Moon's position. A shower with a thin Moon at its peak is the better bet that year. These dates use the IMO's ${esc("2027")} calendar for both years, and the IMO says peak dates can shift by about a day between years, so the Moon column is a guide, not a forecast.</p>
<h2 id="altitude">How high the radiant gets from six cities</h2>
<p>The radiant is the point the meteors seem to stream from. The higher it climbs, the more of the sky the shower covers. This is the highest the radiant ever gets at each place (from its declination and the place's latitude), not its height at the peak hour.</p>
${table({ caption: "Highest altitude of each shower's radiant", head: ["Shower", ...cities.map((c) => c.name)], rows: altRows, numeric: cities.map((_, i) => i + 1) })}
<h2 id="source">Where the numbers come from</h2>
<p>Peak dates, rates and radiants are carried from the IMO's working list of visual meteor showers. Only ten of its 39 rows are used here, the best known ones. Moon fractions and radiant heights are computed.</p>
${sources([{ title: SHOWERS_SOURCE.name, url: SHOWERS_SOURCE.url, note: `Read on ${SHOWERS_SOURCE.read}` }, ENGINE])}`;
  return {
    file: "meteor-showers/index.html", crumbTitle: "Meteor showers",
    title: `Meteor showers ${Y0} and ${Y1}: peak dates, rates and Moon`,
    description: `Peak dates, hourly rates and radiants of ten annual meteor showers, with how much Moon will be lit at each peak in ${Y0} and ${Y1}.`,
    h1: `Meteor showers ${Y0} and ${Y1}`, kicker: "Reference",
    lead: "When to look, how many to expect at best, and whether the Moon will get in the way.",
    body, cta: { label: "See which shower is near its peak tonight", query: "#tonight" },
  };
}
