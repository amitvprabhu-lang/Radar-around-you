// Pages that depend on a place or on a constellation: six city sky guides, 88 constellation pages and the IAU named stars.
// Everything on them is computed from the same data the app uses (IAU boundaries and star names, astronomy-engine), so a page
// and the app cannot disagree. No sentence here states a fact that is not computed or taken from a cited source.
import * as Astro from "astronomy-engine";
import { esc, table, sources, href } from "./layout.mjs";
import { sunDay, darkHours, polarSpans, eclipses, SHOWERS, maxAltitude } from "./data.mjs";
import { visibilityFrom, bestMonth, constellationAt } from "../src/constellations.js";
import { detailsFor, distanceText, lightYears, planetText } from "../src/starinfo.js";
import { Y0, Y1, ENGINE } from "./pages-data.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const IAU_CONS = { title: "IAU: The Constellations", url: "https://www.iau.org/public/themes/constellations/", note: "Names, meanings, pronunciations and boundaries" };
const HYG = { title: "HYG database v4.4 (astronexus)", url: "https://codeberg.org/astronexus/hyg", note: "Distances, spectral types and luminosities, licence CC BY-SA 4.0" };
const EXOARCHIVE = { title: "NASA Exoplanet Archive", url: "https://exoplanetarchive.ipac.caltech.edu/docs/pscp_about.html", note: "Confirmed planets by host star. This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program." };
const IAU_STARS = { title: "IAU Working Group on Star Names", url: "https://www.iau.org/public/themes/naming_stars/", note: "The official names of stars" };
const num = (n, d = 0) => n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const lat = (v) => `${num(Math.abs(v), 1)}°${v >= 0 ? "N" : "S"}`;
const latInt = (v) => `${Math.round(Math.abs(v))}°${v >= 0 ? "N" : "S"}`;
const clock = (d, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const dayText = (d, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(d);
const hrs = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`;
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const slug = (c) => c.abbr.toLowerCase();
export const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`; };
const SHORT = { never: "Never rises", circumpolar: "Never sets", partial: "Only part of it rises", full: "All of it rises" };
const eclipseCache = new Map();
const eclipseList = (cities) => { const key = cities.map((c) => c.id).join(); if (!eclipseCache.has(key)) eclipseCache.set(key, eclipses(Y0, Y1, cities)); return eclipseCache.get(key); };

// ---------------------------------------------------------------- constellation neighbours, from the boundaries
// Walk along each boundary (the vertices and three points between each pair), step a little to each side of it, and record which
// constellation is on the other side. Sampling can miss a very short shared border from one side, so the result is made mutual: if A
// meets B then B meets A, which is always true of a border.
const DEG = Math.PI / 180;
const vec = (ra, dec) => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
const unvec = (v) => { const n = Math.hypot(...v); return { ra: ((Math.atan2(v[1], v[0]) / DEG) + 360) % 360, dec: Math.asin(v[2] / n) / DEG }; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function sampledNeighbours(c) {
  const found = new Map();
  const probe = (p, t) => {
    const n = cross(p, t), nl = Math.hypot(...n);
    if (nl < 1e-9) return;
    for (const sign of [1, -1]) {
      const q = unvec(p.map((x, k) => x + (sign * 0.06 * DEG * n[k]) / nl));
      const s = constellationAt(q.ra, q.dec);
      if (s !== c.abbr) found.set(s, (found.get(s) || 0) + 1);
    }
  };
  for (const loop of c.boundary) {
    for (let i = 0; i < loop.length - 1; i++) {
      const a = vec(...loop[i]), b = vec(...loop[i + 1]);
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      if (Math.hypot(...t) < 1e-6) continue;
      for (const f of [0, 0.25, 0.5, 0.75]) {
        const p = [a[0] + f * t[0], a[1] + f * t[1], a[2] + f * t[2]], pl = Math.hypot(...p);
        probe(p.map((x) => x / pl), t);
      }
    }
  }
  return found;
}
const adjacencyCache = new WeakMap();
export function neighbourMap(consIdx) {
  if (adjacencyCache.has(consIdx)) return adjacencyCache.get(consIdx);
  const count = new Map(consIdx.list.map((c) => [c.abbr, sampledNeighbours(c)]));
  for (const [a, m] of count) for (const [b, n] of m) if (!count.get(b).has(a)) count.get(b).set(a, n);
  const out = new Map([...count].map(([a, m]) => [a, [...m.entries()].sort((x, y) => y[1] - x[1]).map(([b]) => b)]));
  adjacencyCache.set(consIdx, out);
  return out;
}
export const neighbours = (c, consIdx) => neighbourMap(consIdx).get(c.abbr);

// Latitudes (degrees, positive north) at which a constellation can be seen, from its declination range alone. Every part of it rises
// at some moment between fullS and fullN; some part of it rises between anyS and anyN; north of circN (or south of -circS) none of it sets.
// These are the same conditions visibilityFrom() in src/constellations.js applies, written as ranges; test/site.test.js checks they agree.
export function latitudeRanges(c) {
  const clampLat = (v) => Math.max(-90, Math.min(90, v));
  return {
    fullS: clampLat(c.decMax - 90), fullN: clampLat(90 + c.decMin), anyS: clampLat(c.decMin - 90), anyN: clampLat(c.decMax + 90),
    circN: c.decMin > 0 ? 90 - c.decMin : null, circS: c.decMax < 0 ? 90 + c.decMax : null,
  };
}

// ---------------------------------------------------------------- city pages
export function cityPage(city, cities, consIdx, checks) {
  const tz = city.tz, obs = new Astro.Observer(city.lat, city.lon, 0);
  const monthRows = MONTHS.map((m, i) => {
    const d = new Date(Date.UTC(Y0, i, 15));
    const s = sunDay(city, d), dk = darkHours(city, d);
    return [m, s.rise ? clock(s.rise, tz) : esc(s.note || "none"), s.set ? clock(s.set, tz) : "", hrs(s.minutes / 60), dk > 0 ? hrs(dk) : "none"];
  });
  const polar = polarSpans(city, Y0);
  const polarText = [
    polar.sunStaysUp.length ? `The Sun stays above the horizon all day from ${list(polar.sunStaysUp.map((s) => `${dayText(s.from, tz)} to ${dayText(s.to, tz)}`))}.` : "",
    polar.sunStaysDown.length ? `The Sun does not rise from ${list(polar.sunStaysDown.map((s) => `${dayText(s.from, tz)} to ${dayText(s.to, tz)}`))}.` : "",
  ].filter(Boolean).join(" ");
  const states = consIdx.list.map((c) => ({ c, v: visibilityFrom(c, city.lat) }));
  const never = states.filter((x) => x.v.state === "never").map((x) => x.c.name);
  const circum = states.filter((x) => x.v.state === "circumpolar").map((x) => x.c.name);
  const partial = states.filter((x) => x.v.state === "partial").map((x) => x.c.name);
  const link = (name) => { const c = consIdx.list.find((x) => x.name === name); return `<a href="${href(`sky/${city.id}/index.html`, `constellations/${slug(c)}/index.html`)}">${esc(name)}</a>`; };
  const ecl = eclipseList(cities).map((e) => ({ e, here: e.places.find((p) => p.id === city.id) }));
  const eclRows = ecl.map(({ e, here }) => [new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(e.time), esc(e.title), here.visible ? esc(here.detail) : "Not visible from here"]);
  const showerRows = SHOWERS.map((s) => ({ s, alt: Math.round(maxAltitude(city.lat, s.dec)) })).sort((a, b) => b.alt - a.alt).map(({ s, alt }) => [esc(s.name), alt > 0 ? `${alt}°` : "never rises", `${s.peak[1]} ${MONTHS[s.peak[0] - 1].slice(0, 3)}`, `${s.zhr}`]);
  const hemisphere = city.lat >= 0 ? "northern" : "southern";
  const darkest = monthRows.map((r, i) => ({ m: MONTHS[i], h: darkHours(city, new Date(Date.UTC(Y0, i, 15))) })).sort((a, b) => b.h - a.h)[0];
  const body = `
<h2 id="dark">Sunrise, sunset and darkness through ${Y0}</h2>
<p>${esc(city.name)} is at ${lat(city.lat)}. The table gives sunrise, sunset and day length on the 15th of each month in local time (${esc(tz)}), and the hours of full astronomical darkness, when the Sun is more than 18 degrees below the horizon and the faintest stars and the Milky Way show.${darkest.h > 0 ? ` The longest dark nights are around ${darkest.m}, with about ${hrs(darkest.h)} of darkness.` : " The Sun never gets low enough for full darkness on those dates."} ${polarText}</p>
${table({ caption: `Sun and darkness in ${city.name}, 15th of each month, ${Y0}. Local time.`, head: ["Month", "Sunrise", "Sunset", "Day length", "Full darkness"], rows: monthRows, numeric: [1, 2, 3, 4] })}
<h2 id="constellations">Constellations and your latitude</h2>
<p>How much of the sky you can see depends on latitude. From ${esc(city.name)}, in the ${hemisphere} hemisphere, ${circum.length ? `${circum.length} constellations never set: ${list(circum.map(link))}.` : "no constellation stays up all night all year."} ${never.length ? `${never.length} never rise above the horizon: ${list(never.map(link))}.` : "Every constellation clears the horizon at some time of year."}${partial.length ? ` ${partial.length} more only partly clear it: ${list(partial.map(link))}.` : ""} These come from the IAU's constellation boundaries and are geometric, so they ignore haze, hills and buildings near the horizon.</p>
<h2 id="eclipses">Eclipses from ${esc(city.name)}, ${Y0} and ${Y1}</h2>
${table({ caption: `Eclipses ${Y0} and ${Y1} and what ${city.name} sees`, head: ["Date", "Eclipse", "From " + city.name], rows: eclRows })}
<h2 id="meteors">Meteor showers: how high the radiant gets</h2>
<p>The radiant is the point a meteor shower seems to stream from; the higher it climbs, the better the shower works. This is the highest each radiant gets from ${esc(city.name)}. See the <a href="${href(`sky/${city.id}/index.html`, "meteor-showers/index.html")}">meteor shower table</a> for peak dates and the Moon.</p>
${table({ caption: `Radiant altitude from ${city.name}`, head: ["Shower", "Highest radiant", "Peak", "ZHR"], rows: showerRows, numeric: [1, 2, 3] })}
<h2 id="how">How this was worked out</h2>
<p>Sun and darkness times come from the astronomy-engine library.${checks && checks.sunTimes && checks.sunTimes.matched ? ` The sunrise and sunset times on both ${Y0} solstices at this and five other places were compared with the US Naval Observatory's tables (${checks.sunTimes.n} times) and the largest difference was ${checks.sunTimes.worstSeconds} seconds.` : ""} The other mid-month figures use the same calculation but were not compared one by one. Constellation visibility comes from the IAU boundaries.</p>
${sources([ENGINE, IAU_CONS, { title: "U.S. Naval Observatory, Astronomical Applications API", url: "https://aa.usno.navy.mil/data/api", note: "Used to check the solstice sunrise and sunset times" }])}`;
  const others = cities.filter((c) => c.id !== city.id).map((c) => `<li><a class="card" href="${href(`sky/${city.id}/index.html`, `sky/${c.id}/index.html`)}"><b>${esc(c.name)}</b><span>${lat(c.lat)}</span></a></li>`).join("");
  return {
    file: `sky/${city.id}/index.html`, crumbs: [{ name: "Sky by city", file: "sky/index.html" }], crumbTitle: city.name,
    title: `Night sky over ${city.name}: darkness, constellations and eclipses`,
    description: `${city.name} (${lat(city.lat)}) night sky guide for ${Y0}: hours of true darkness each month, constellations that never rise, eclipses and meteor shower radiants.`,
    h1: `The night sky over ${city.name}`, kicker: `Sky guide, ${lat(city.lat)}`,
    lead: `What changes through the year in the sky above ${esc(city.name)}: how dark it gets, which constellations you can and cannot see, and what the eclipses and meteor showers of ${Y0} and ${Y1} look like from here.`,
    body: body + `<h2 id="others">Other cities</h2><ul class="grid">${others}</ul>`,
    cta: { label: `Open the live sky for ${city.name}`, query: `#place=${city.id}&sky` },
  };
}

export function citiesIndex(cities) {
  return {
    file: "sky/index.html", crumbTitle: "Sky by city",
    title: "Night sky guides for six cities: darkness, constellations, eclipses",
    description: `Sky guides for ${cities.map((c) => c.name).join(", ")}: how dark the night gets each month, which constellations can be seen and what eclipses reach each city.`,
    h1: "Sky by city", kicker: "Guides", lead: "The same sky looks different from different latitudes. Pick a city.",
    body: `<ul class="grid">${cities.map((c) => `<li><a class="card" href="${href("sky/index.html", `sky/${c.id}/index.html`)}"><b>${esc(c.name)}</b><span>${esc(c.country)}, latitude ${lat(c.lat)}</span></a></li>`).join("")}</ul>
<p>For any other place, open the live app, search for the place or use your location, and every screen is worked out for it.</p>`,
    cta: { label: "Open the live app", query: "" },
  };
}

// ---------------------------------------------------------------- constellation pages
export function constellationPage(c, consIdx, starsDoc, cities, details = null) {
  const rank = [...consIdx.list].sort((a, b) => b.areaDeg2 - a.areaDeg2).findIndex((x) => x.abbr === c.abbr) + 1;
  const best = bestMonth(c.centre.ra);
  const named = starsDoc.stars.filter((s) => s.con === c.abbr).sort((a, b) => a.mag - b.mag);
  const nb = neighbours(c, consIdx).map((abbr) => consIdx.byAbbr.get(abbr)).filter(Boolean);
  const { fullS, fullN, anyS, anyN, circN, circS } = latitudeRanges(c);
  const b = c.stars.brightest;
  const bName = b ? (b.name || `star HIP ${b.hip}`) : "none";
  const cityRows = cities.map((city) => { const v = visibilityFrom(c, city.lat); return [esc(city.name), lat(city.lat), SHORT[v.state], v.state === "never" || v.maxAltCentre <= 0 ? "below the horizon" : `${Math.round(v.maxAltCentre)}°`]; });
  const ly = (s) => { const d = detailsFor(details, s.i); const v = d && lightYears(d.pc); return v == null ? "not known" : v < 100 ? num(v, 1) : num(Math.round(Number(v.toPrecision(2)))); };
  const starRows = named.map((s) => [`<strong>${esc(s.name)}</strong>`, esc([s.bayer, s.bayer ? c.genitive : null].filter(Boolean).join(" ") || s.designation || ""), num(s.mag, 2), ...(details ? [ly(s)] : [])]);
  const file = `constellations/${slug(c)}/index.html`;
  const body = `
<h2 id="glance">${esc(c.name)} at a glance</h2>
${table({ caption: `${c.name}: facts from the IAU boundaries and star catalogue`, head: ["Fact", "Value"], rows: [
    ["IAU abbreviation", esc(c.abbr)], ["Meaning", esc(c.english)], ["Pronounced", esc(c.pron || "not given")], ["Genitive, used in star names", `${esc(c.genitive)} (for example a Bayer name such as α ${esc(c.genitive)})`],
    ["Area", `${num(c.areaDeg2)} square degrees, number ${rank} of 88 by size`], ["Stars to magnitude 6 in our catalogue", num(c.stars.count)],
    ["Brightest star", b ? `${esc(bName)}, magnitude ${num(b.mag, 1)}` : "none"], ["Best seen", `Evenings in ${best.month}, when it is highest at 9 pm`],
    ["Declination range", `${num(c.decMin, 0)}° to ${num(c.decMax, 0)}°`], ["Borders", nb.length ? nb.map((n) => `<a href="${href(file, `constellations/${slug(n)}/index.html`)}">${esc(n.name)}</a>`).join(", ") : "none found"],
  ] })}
<h2 id="visible">Where on Earth you can see ${esc(c.name)}</h2>
<p>${esc(c.name)} spans declinations ${num(c.decMin, 0)}° to ${num(c.decMax, 0)}°. Every part of it rises above the horizon at some moment for observers between latitudes ${latInt(fullS)} and ${latInt(fullN)}${fullS <= -90 && fullN >= 90 ? ", which is everywhere on Earth" : ""}. Some of it can be seen from ${anyS <= -90 && anyN >= 90 ? "every latitude" : `latitudes ${latInt(anyS)} to ${latInt(anyN)}`}.${circN !== null ? ` North of ${latInt(circN)} none of it ever sets.` : ""}${circS !== null ? ` South of ${latInt(-circS)} none of it ever sets.` : ""} This is geometry only: it ignores haze, hills and buildings near the horizon.</p>
<h2 id="cities">From six cities</h2>
${table({ caption: `${c.name} from six cities. Altitude is how high its middle gets.`, head: ["City", "Latitude", "Visibility", "Middle at its highest"], rows: cityRows, numeric: [1, 3] })}
<h2 id="stars">${esc(c.name)}'s named stars</h2>
${named.length ? `<p>These stars in ${esc(c.name)} have names approved by the IAU Working Group on Star Names. Magnitude is brightness: a lower number is brighter, and the faintest stars seen with the naked eye on a dark night are about magnitude 6.</p>${table({ caption: `IAU-named stars in ${c.name}`, head: ["Star", "Designation", "Magnitude", ...(details ? ["Distance (light-years)"] : [])], rows: starRows, numeric: details ? [2, 3] : [2] })}${details ? `<p>Distances are about, from the HYG database (Hipparcos parallax), and "not known" means the catalogue has no reliable parallax for that star.</p>` : ""}` : `<p>None of the stars brighter than magnitude 6 in ${esc(c.name)} has a name approved by the IAU Working Group on Star Names.</p>`}
<h2 id="how">How these facts were found</h2>
<p>The name, meaning and boundaries are the IAU's. Area, borders and the latitude ranges are computed from those boundaries; the brightest star and the star count come from a magnitude-6 star catalogue; star names are matched to the catalogue by Hipparcos number and checked by position. The month is when ${esc(c.name)}'s middle crosses the north-south line of the sky at 9 pm local solar time. See <a href="${href(file, "methods/index.html")}">How we know</a>.</p>
${sources([IAU_CONS, IAU_STARS, ENGINE, ...(details ? [HYG] : [])])}`;
  return {
    file, crumbs: [{ name: "Constellations", file: "constellations/index.html" }], crumbTitle: c.name,
    title: `${c.name} constellation: brightest star, size and when to see it`,
    description: `${c.name} is ${c.english} in the IAU's 88 constellations: ${num(c.areaDeg2)} square degrees (number ${rank}), brightest star ${bName}, best seen in ${best.month}.`,
    h1: `${c.name}: ${c.english}`, kicker: `Constellation, ${c.abbr}`,
    lead: `${esc(c.name)} covers ${num(c.areaDeg2)} square degrees of sky, the ${ordinal(rank)} largest of the 88. ${b ? `Its brightest star is ${esc(bName)}. ` : ""}It is best placed in the evening sky in ${best.month}.`,
    body, cta: { label: `Show ${c.name} in the live sky`, query: `#sky&con=${c.abbr}` },
  };
}

export function constellationsIndex(consIdx) {
  const rows = consIdx.list.map((c) => ({ c, best: bestMonth(c.centre.ra), rank: 0 }));
  [...consIdx.list].sort((a, b) => b.areaDeg2 - a.areaDeg2).forEach((c, i) => { rows.find((r) => r.c.abbr === c.abbr).rank = i + 1; });
  return {
    file: "constellations/index.html", crumbTitle: "Constellations",
    title: "All 88 constellations: meanings, size, brightest stars, best month",
    description: "The 88 IAU constellations with their meanings, area, brightest star and the month each is best seen in the evening sky, from the IAU's own boundaries.",
    h1: "The 88 constellations", kicker: "Reference",
    lead: "Every constellation the IAU recognises, with what its name means, how big it is, its brightest star and when to look for it.",
    body: `${table({ caption: "The 88 IAU constellations", head: ["Constellation", "Meaning", "Area (sq deg)", "Size rank", "Brightest star", "Best seen"], rows: rows.map(({ c, best, rank }) => [`<a href="${href("constellations/index.html", `constellations/${slug(c)}/index.html`)}"><strong>${esc(c.name)}</strong></a>`, esc(c.english), num(c.areaDeg2), String(rank), esc(c.stars.brightest ? c.stars.brightest.name || `HIP ${c.stars.brightest.hip}` : ""), best.month]), numeric: [2, 3] })}
<h2 id="how">About these numbers</h2>
<p>The IAU\'s boundaries divide the whole sky, so every point of it belongs to exactly one constellation. Here the areas add up to the whole sphere, 41,253 square degrees. The best month is when a constellation's middle is highest at 9 pm. Brightest stars come from a catalogue of the 5,044 stars down to magnitude 6.</p>
${sources([IAU_CONS, IAU_STARS, ENGINE])}`,
    cta: { label: "Open the sky and tap any constellation", query: "#constellations" },
  };
}

export function starsIndex(starsDoc, consIdx, details = null) {
  const lyText = (s) => { const d = detailsFor(details, s.i); const v = d && lightYears(d.pc); return v == null ? "not known" : v < 100 ? num(v, 1) : num(Math.round(Number(v.toPrecision(2)))); };
  const planets = (s) => { const d = detailsFor(details, s.i); return d && d.planets ? String(d.planets.n) : "none listed"; };
  const withPlanets = details ? starsDoc.stars.filter((s) => { const d = detailsFor(details, s.i); return d && d.planets; }) : [];
  const rows = starsDoc.stars.map((s) => { const c = consIdx.byAbbr.get(s.con); return [`<strong>${esc(s.name)}</strong>`, esc([s.bayer, s.bayer && c ? c.genitive : null].filter(Boolean).join(" ") || s.designation || ""), c ? `<a href="${href("stars/index.html", `constellations/${slug(c)}/index.html`)}">${esc(c.name)}</a>` : esc(s.con || ""), num(s.mag, 2), ...(details ? [lyText(s), planets(s)] : [])]; });
  return {
    file: "stars/index.html", crumbTitle: "Named stars",
    title: `${starsDoc.stars.length} stars with official IAU names: brightness, distance and planets`,
    description: `The ${starsDoc.stars.length} naked-eye stars that have names approved by the International Astronomical Union, brightest first, with constellation, magnitude${details ? ", distance in light-years and known planets" : ""}.`,
    h1: "Stars with official names", kicker: "Reference",
    lead: `${starsDoc.stars.length} of the stars you can see without a telescope have a name approved by the IAU Working Group on Star Names. Here they are, brightest first${details ? `. ${withPlanets.length} of them have confirmed planets in the NASA Exoplanet Archive` : ""}.`,
    body: `${table({ caption: "IAU-named stars brighter than about magnitude 6", head: ["Star", "Designation", "Constellation", "Magnitude", ...(details ? ["Distance (light-years)", "Confirmed planets"] : [])], rows, numeric: details ? [3, 4, 5] : [3] })}
${details ? `<p>Distances are about, from Hipparcos parallax as collected in the HYG database; "not known" means that catalogue has no reliable parallax for the star. "None listed" means the NASA Exoplanet Archive has no confirmed planet for it, which says nothing about planets not yet found.</p>` : ""}
<h2 id="how">Where the list comes from</h2>
<p>The IAU's catalogue of star names lists ${starsDoc.counts.inFile} names. ${starsDoc.counts.inCatalogue} of them belong to stars bright enough to be in this magnitude-6 catalogue; the rest are fainter stars, such as those that host planets. Each name is matched to its star by Hipparcos number and checked against the star's position, and every one agrees. The IAU file was last updated on ${esc(starsDoc.listUpdated || "an unknown date")}, so very recent names may be missing.</p>
${details ? `<p>Distances come from the HYG database (version 4.4, licence CC BY-SA 4.0), matched to the same catalogue by Hipparcos number and checked by position. Planet counts come from the Archive's composite table, where several names for one star, such as components of a double, are counted as one star and a planet listed twice is counted once.${details.counts && details.counts.hostDistanceDiffers === 0 ? " As a check, wherever both the Archive and HYG give a distance for a planet-hosting star in the catalogue, the two agree to within 15 percent." : ""}</p>` : ""}
${sources([IAU_STARS, { title: "IAU Catalog of Star Names", url: "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt", note: "The list itself, kept by the working group" }, ...(details ? [HYG, EXOARCHIVE] : [])])}`,
    cta: { label: "Tap a star in the live sky", query: "#sky" },
  };
}
