// The sky pages: the /tonights-sky/ hub, one page per city of the cloud feed and /iss-today/. Pure: each page function takes summaries from
// site/sky.mjs and returns a page object for renderPage, so the lead, the findings, the tables, the figures, the FAQ and the structured data
// all print the same computed numbers. The figures are pure SVG helpers, tested on their own. Typed statements (method, definitions,
// credits) are traced in docs/sky-pages-sources.md. Nothing here promises that anything will be seen: the pages give computed positions and
// times and MET Norway's cloud forecast.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";
import { dateLong, timeUtc, barChartSvg } from "./pages-satcount.mjs";
import { coastPath, MAP_UNITS_PER_DEGREE } from "./svgmap.mjs";
import { projectSky } from "../src/core.js";
import {
  SKY_HUB_FILE, skyCityFile, ISS_FILE, SKY_MAX_AGE_HOURS, ISS_MAX_AGE_DAYS, BEST_WINDOW_THRESHOLD, PLANET_MIN_ALT, PLANET_MAX_MAG,
  CHART_MAG_LIMIT, FIGURE_MAX, RISE_SET_CHECK_MINUTES, ABOUT_SAME, DARK_SUN_ALT, hm, whenLocal, dateLongTz, durationText, compassWords, moonPhrase, localText, eventsPhrase, startWord, upSpans,
} from "./sky.mjs";
import { PLACE_MAX_KM } from "./hazard.mjs";
import { liveScriptParts } from "./liveseo.mjs";

// ------------------------------------------------------------------ sources (addresses as recorded in docs/ and pipeline/config.py)
export const SKY_SRC = {
  met: { title: "MET Norway Locationforecast", url: "https://api.met.no/weatherapi/locationforecast/2.0/documentation", note: "The hourly cloud forecast (total cloud cover for all heights). Data from The Norwegian Meteorological Institute, shortened MET Norway" },
  metLicence: { title: "MET Norway licence", url: "https://api.met.no/doc/License", note: "NLOD 2.0 and CC BY 4.0, as recorded in our source notes" },
  engine: { title: "astronomy-engine", url: "https://github.com/cosinekitty/astronomy", note: "The MIT licensed library that computes the Sun, Moon and planets, and their rise and set times" },
  usno: { title: "U.S. Naval Observatory, Astronomical Applications API", url: "https://aa.usno.navy.mil/data/api", note: "The rise, set and phase tables our tests compare these calculations with" },
  celestrak: { title: "CelesTrak current GP data", url: "https://celestrak.org/NORAD/elements/", note: "The ISS element set (NORAD 25544)" },
  satjs: { title: "satellite.js", url: "https://github.com/shashwatak/satellite-js", note: "The SGP4 code that turns the element set into positions" },
  iau: { title: "IAU constellations", url: "https://www.iau.org/public/themes/constellations/", note: "The constellation names on the chart and in its tables" },
  csn: { title: "IAU Catalog of Star Names", url: "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt", note: "The star names on the chart and in its table. IAU products are released under Creative Commons Attribution (CC BY), as the file's header states" },
  figures: { title: "d3-celestial", url: "https://github.com/ofrohn/d3-celestial", note: "The constellation stick figures on the chart (one common way of joining the stars, not the IAU's). Its data licence is not stated: NOT CONFIRMED" },
  stars: { title: "ESA Hipparcos and Tycho catalogues", url: "https://www.cosmos.esa.int/web/hipparcos/catalogues", note: "The stars on the chart come from the app's Hipparcos-based catalogue, whose provenance is not recorded. ESA's page gives CC BY-NC 3.0 IGO and Credit: ESA; which licence applies to this exact file is NOT CONFIRMED" },
};
export const MET_CREDIT = "The Norwegian Meteorological Institute, shortened MET Norway";

// ------------------------------------------------------------------ small helpers
const when = (iso) => `${dateLong(iso)}, ${timeUtc(iso)}`;
const timeEl = (iso) => `<time datetime="${esc(iso)}">${esc(when(iso))}</time>`;
const isoOf = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// a local time in the city's zone, machine readable as UTC
// (a time in the hour the clocks repeat carries its offset, localText in site/sky.mjs). The shared script does not convert these times:
// the findings, the chart and its heading are worked out for the city's local night, so they stay in the city's zone.
const localEl = (ms, ref, tz) => `<time datetime="${isoOf(ms)}" data-tz="${esc(tz)}">${esc(localText(ms, ref, tz))}</time>`;
const deg = (x) => `${Math.round(x)}°`;
const v = (n, one, many) => (n === 1 ? one : many);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const latText = (lat) => `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
const lonText = (lon) => `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
const plainNum = (x, d = 1) => x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const magText = (m) => (m === null ? "Not computed" : plainNum(m, 1));
const faqHtml = (faq) => `<h2 id="faq">Questions</h2>\n${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}`;
const cards = (list) => `<ul class="grid">\n${list.map(([b, s]) => `<li><div class="card"><b>${b}</b><span>${s}</span></div></li>`).join("\n")}\n</ul>`;
export const figure = (svg, caption) => `<figure>\n${svg}\n<figcaption>${caption}</figcaption>\n</figure>`;
const findingsHtml = (list) => `<h2 id="meaning">What this means</h2>\n<ul class="findings">\n${list.map((f) => `<li>${esc(f)}</li>`).join("\n")}\n</ul>`;

// WebPage with the properties of the design's section 7. trail: the breadcrumb after Home, ending with the page itself, the same as the
// one renderPage writes from the page's crumbs and crumbTitle.
export function webPageLd({ title, description, file, dataTime, trail }) {
  const list = [{ name: "Home", file: "index.html" }, ...trail];
  return {
    "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: `${SITE.url}/${urlPath(file)}`, inLanguage: "en", dateModified: dataTime,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: `${SITE.url}/` },
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: list.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE.url}/${urlPath(c.file)}` })) },
  };
}

// ------------------------------------------------------------------ figures (pure SVG helpers)
const svgOpen = (id, w, h, title, desc, cls = "chart") => `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" role="img" aria-labelledby="${esc(id)}-t ${esc(id)}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="${esc(id)}-t">${esc(title)}</title><desc id="${esc(id)}-d">${esc(desc)}</desc>`;
const f1 = (x) => String(Math.round(x * 10) / 10);

// The polar chart: the sky as seen lying on your back, zenith in the middle, horizon on the circle, north at the top and east on the LEFT
// (projectSky in src/core.js). Stars are dots, planets diamonds, the Moon a ringed disc; every planet, the Moon and the brightest named
// stars carry a text label, so colour is never the only cue.
export function polarChartSvg({ id, title, desc, chart, size = 520 }) {
  const c = size / 2, R = c - 34;
  const P = (alt, az) => projectSky(alt, az, c, c, R);
  let out = svgOpen(id, size, size, title, desc, "chart sky");
  out += `<circle cx="${c}" cy="${c}" r="${R}" fill="var(--ink2)" stroke="var(--muted)" stroke-width="1.5"></circle>`;
  for (const a of [30, 60]) out += `<circle cx="${c}" cy="${c}" r="${f1((R * (90 - a)) / 90)}" fill="none" stroke="var(--line)" stroke-dasharray="4 4"></circle>`;
  for (const [t, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) { const p = projectSky(-12, az, c, c, R); out += `<text x="${f1(p.x)}" y="${f1(p.y + 5)}" text-anchor="middle" fill="var(--text)" font-size="15" font-weight="700">${t}</text>`; }
  for (const f of chart.figures) {
    const d = f.segments.map((run) => run.map((q, i) => { const p = P(q.alt, q.az); return `${i ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`; }).join("")).join("");
    out += `<path d="${d}" fill="none" stroke="var(--violet)" stroke-opacity="0.7" stroke-width="1.2"></path>`;
    const p = P(f.centre.alt, f.centre.az);
    out += `<text x="${f1(p.x)}" y="${f1(p.y)}" text-anchor="middle" fill="var(--muted)" font-size="10" font-style="italic">${esc(f.name)}</text>`;
  }
  for (const s of chart.stars) {
    const p = P(s.alt, s.az);
    out += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(Math.max(0.8, 3.4 - 0.65 * s.mag))}" fill="var(--text)"${s.label ? ` data-tip="${esc(s.name)}, ${deg(s.alt)} up"` : ""}></circle>`;
    if (s.label) out += `<text x="${f1(p.x + 5)}" y="${f1(p.y - 4)}" fill="var(--text)" font-size="11">${esc(s.name)}</text>`;
  }
  for (const pl of chart.planets) {
    const p = P(pl.alt, pl.az);
    out += `<path d="M${f1(p.x)} ${f1(p.y - 6)}l6 6-6 6-6-6z" fill="var(--signal)" data-tip="${esc(pl.name)}, ${deg(pl.alt)} up"></path><text x="${f1(p.x + 8)}" y="${f1(p.y + 4)}" fill="var(--signal)" font-size="12" font-weight="700">${esc(pl.name)}</text>`;
  }
  if (chart.moon) {
    const p = P(chart.moon.alt, chart.moon.az);
    out += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="9" fill="var(--text)" stroke="var(--signal)" stroke-width="2" data-tip="Moon, ${deg(chart.moon.alt)} up"></circle><text x="${f1(p.x + 12)}" y="${f1(p.y + 4)}" fill="var(--text)" font-size="12" font-weight="700">Moon</text>`;
  }
  return out + "</svg>";
}

// The Moon's altitude through the night as a line above and below a horizon line, with rise and set labelled.
export function moonStripSvg({ id, title, desc, moon, start, end, tz }) {
  const w = 720, h = 170, x0 = 46, x1 = w - 14, y0 = 14, y1 = h - 34;
  const X = (t) => x0 + ((t - start) / Math.max(1, end - start)) * (x1 - x0);
  const Y = (alt) => y0 + ((90 - alt) / 180) * (y1 - y0);
  let out = svgOpen(id, w, h, title, desc);
  out += `<line x1="${x0}" y1="${f1(Y(0))}" x2="${x1}" y2="${f1(Y(0))}" stroke="var(--muted)" stroke-width="1.5"></line><text x="${x0 - 6}" y="${f1(Y(0) + 4)}" text-anchor="end" fill="var(--muted)" font-size="11">0°</text>`;
  for (const a of [45, 90]) out += `<line x1="${x0}" y1="${f1(Y(a))}" x2="${x1}" y2="${f1(Y(a))}" stroke="var(--line)" stroke-dasharray="3 4"></line><text x="${x0 - 6}" y="${f1(Y(a) + 4)}" text-anchor="end" fill="var(--muted)" font-size="11">${a}°</text>`;
  out += `<text x="${x1}" y="${f1(Y(0) - 5)}" text-anchor="end" fill="var(--muted)" font-size="11">horizon</text>`;
  out += `<path d="${moon.track.map((q, i) => `${i ? "L" : "M"}${f1(X(q.t))} ${f1(Y(q.alt))}`).join("")}" fill="none" stroke="var(--sky)" stroke-width="2.5"></path>`;
  for (const q of moon.track.filter((_, i) => i % 4 === 0)) out += `<circle cx="${f1(X(q.t))}" cy="${f1(Y(q.alt))}" r="2.5" fill="var(--sky)" data-tip="${esc(hm(q.t, tz))}: ${deg(q.alt)}"></circle>`;
  for (const e of moon.events) out += `<line x1="${f1(X(e.t))}" y1="${y0}" x2="${f1(X(e.t))}" y2="${y1}" stroke="var(--signal)" stroke-dasharray="2 3"></line><text x="${f1(X(e.t) + 4)}" y="${y0 + 10}" fill="var(--signal)" font-size="11">Moon${e.kind === "rise" ? "rise" : "set"} ${esc(hm(e.t, tz))}</text>`;
  const step = Math.max(1, Math.ceil((end - start) / 3600e3 / 12));
  for (let t = Math.ceil(start / 3600e3) * 3600e3, k = 0; t <= end; t += 3600e3, k++) if (k % step === 0) out += `<text x="${f1(X(t))}" y="${h - 12}" text-anchor="middle" fill="var(--text)" font-size="11">${esc(hm(t, tz))}</text>`;
  return out + "</svg>";
}

// Cloud cover per hour of the night as bars with the value printed on each, and the best window marked with a labelled bracket.
export function cloudStripSvg({ id, title, desc, hours, best, tz }) {
  const colW = 34, plotH = 120, w = Math.max(200, hours.length * colW + 20), h = plotH + 80;
  let out = svgOpen(id, w, h, title, desc);
  hours.forEach((q, i) => {
    const x = 10 + i * colW, base = 30 + plotH;
    if (q.cloud === null) { out += `<text x="${x + colW / 2}" y="${base - 4}" text-anchor="middle" fill="var(--muted)" font-size="10">none</text>`; }
    else {
      const bh = Math.max(2, Math.round((q.cloud / 100) * plotH));
      out += `<rect x="${x + 4}" y="${base - bh}" width="${colW - 8}" height="${bh}" rx="2" fill="var(--muted)" data-tip="${esc(hm(q.t, tz))}: ${q.cloud} percent cloud"></rect><text x="${x + colW / 2}" y="${base - bh - 4}" text-anchor="middle" fill="var(--text)" font-size="10">${q.cloud}</text>`;
    }
    out += `<text x="${x + colW / 2}" y="${base + 16}" text-anchor="middle" fill="var(--text)" font-size="11">${esc(hm(q.t, tz))}</text>`;
  });
  if (best) {
    const i0 = hours.findIndex((q) => q.t >= best.start - 1), i1 = hours.reduce((acc, q, i) => (q.t < best.end ? i : acc), i0);
    if (i0 >= 0) {
      const xa = 10 + i0 * colW + 2, xb = 10 + (i1 + 1) * colW - 2;
      out += `<path d="M${xa} ${h - 22}v6H${xb}v-6" fill="none" stroke="var(--ion)" stroke-width="2"></path><text x="${(xa + xb) / 2}" y="${h - 3}" text-anchor="middle" fill="var(--ion)" font-size="11">best window</text>`;
    }
  }
  return out + "</svg>";
}

// Splits a track of { lat, lon } wherever consecutive points are more than 180 degrees of longitude apart (it crossed the antimeridian),
// so no line runs across the whole map.
export function splitAtAntimeridian(points) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (run.length && Math.abs(p.lon - run[run.length - 1].lon) > 180) { runs.push(run); run = []; }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

// The ISS ground track on a world map (the coastlines of svgmap.mjs): the 45 minutes before the data time dashed, the 90 after solid,
// the position at the data time a ringed dot with a label, the six cities small squares with their names.
export function issMapSvg({ id, title, desc, coast, track, position, cities }) {
  const W = 360 * MAP_UNITS_PER_DEGREE, H = 180 * MAP_UNITS_PER_DEGREE;
  const X = (lon) => Math.round((lon + 180) * MAP_UNITS_PER_DEGREE), Y = (lat) => Math.round((90 - lat) * MAP_UNITS_PER_DEGREE);
  const flat = track.flat();
  const path = (pts) => splitAtAntimeridian(pts).map((r) => r.map((p, i) => `${i ? "L" : "M"}${X(p.lon)} ${Y(p.lat)}`).join("")).join("");
  const past = path(flat.filter((p) => p.min <= 0)), next = path(flat.filter((p) => p.min >= 0));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${esc(id)}-t ${esc(id)}-d" viewBox="0 0 ${W} ${H}" width="720" height="360" style="max-width:100%;height:auto"><title id="${esc(id)}-t">${esc(title)}</title><desc id="${esc(id)}-d">${esc(desc)}</desc>`;
  out += `<rect width="${W}" height="${H}" fill="var(--ink2)"></rect><path d="${coastPath(coast)}" transform="scale(5)" fill="none" stroke="var(--muted)" stroke-width="0.6" stroke-linejoin="round"></path>`;
  out += `<path d="${past}" fill="none" stroke="var(--signal)" stroke-width="10" stroke-dasharray="30 24"></path><path d="${next}" fill="none" stroke="var(--signal)" stroke-width="14"></path>`;
  for (const c of cities) out += `<rect x="${X(c.lon) - 18}" y="${Y(c.lat) - 18}" width="36" height="36" fill="var(--ion)"></rect><text x="${X(c.lon) + 30}" y="${Y(c.lat) + 20}" fill="var(--ion)" font-size="60">${esc(c.name)}</text>`;
  out += `<circle cx="${X(position.lon)}" cy="${Y(position.lat)}" r="34" fill="var(--signal)" stroke="var(--text)" stroke-width="10" data-tip="ISS at the data time"></circle><text x="${X(position.lon) + 50}" y="${Y(position.lat) - 40}" fill="var(--text)" font-size="70" font-weight="700">ISS at the data time</text>`;
  return out + "</svg>";
}

// ------------------------------------------------------------------ links between the pages
const OTHER = { "aurora-tonight/index.html": "aurora tonight", "right-now/index.html": "all live numbers right now" };
function seeAlso(file, built, cities) {
  const live = [];
  if (file !== SKY_HUB_FILE && built.includes(SKY_HUB_FILE)) live.push(`<a href="${href(file, SKY_HUB_FILE)}">all six cities</a>`);
  if (file === SKY_HUB_FILE || file === ISS_FILE) for (const c of cities) { const f = skyCityFile(c.id); if (built.includes(f)) live.push(`<a href="${href(file, f)}">tonight's sky in ${esc(c.name)}</a>`); }
  if (file !== ISS_FILE && built.includes(ISS_FILE)) live.push(`<a href="${href(file, ISS_FILE)}">the ISS today</a>`);
  for (const [f, label] of Object.entries(OTHER)) if (built.includes(f)) live.push(`<a href="${href(file, f)}">${label}</a>`);
  const guides = [["moon-phases/index.html", "Moon phases"], ["planets/index.html", "planet events"], ["meteor-showers/index.html", "meteor showers"]].map(([f, l]) => `<a href="${href(file, f)}">${l}</a>`);
  return `<p>See also: ${[...live, ...guides].join(", ")}.</p>`;
}
const staleNote = (s, what) => (s.stale ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, which is older than the ${what} this page allows for live data. The live copy replaces it after the next data collection.</p>\n` : "");
const metNote = `<p class="note">Cloud forecast: MET Norway's, not ours. Data from ${esc(MET_CREDIT)}, licensed under NLOD 2.0 and CC BY 4.0.</p>`;

// The app's phase names (moonPhaseName in src/info.js) cover bands of the Moon's cycle; said once on each city page, because the US Naval
// Observatory names a date by the phase it is in and the two can differ near a quarter.
export const PHASE_NOTE = "Each phase name covers a band of the cycle about 22.5 degrees (1.8 days) wide, so \"first quarter\" here means 40 to 60 percent lit and another almanac may name the night differently.";
// "Mars rises at 01:32", "Venus is up at nightfall, sets at 19:19": the events phrase as the rest of a sentence about a body
const bodyDoes = (phrase) => (/^(up|below)/.test(phrase) ? `is ${phrase}` : phrase);

// The cloud forecast in words from the hourly values: runs of mostly clear (under 25 percent), partly cloudy and mostly cloudy (over 75
// percent) hours, with their local times. OURS: the two thresholds.
export function cloudWords(hours, t) {
  const known = hours.filter((h) => h.cloud !== null);
  if (!known.length) return "";
  const kind = (c) => (c < 25 ? "mostly clear" : c > 75 ? "mostly cloudy" : "partly cloudy");
  const runs = [];
  for (const h of known) {
    const k = kind(h.cloud), last = runs[runs.length - 1];
    if (last && last.k === k && h.t - last.to <= HOUR) last.to = h.t; else runs.push({ k, from: h.t, to: h.t });
  }
  if (runs.length === 1) return `The forecast is ${runs[0].k} all night.`;
  return `The forecast is ${runs.map((r) => (r.from === r.to ? `${r.k} at ${t(r.from)}` : `${r.k} from ${t(r.from)} to ${t(r.to)}`)).join(", then ")}.`;
}
const HOUR = 3600e3;

// The sources of the star data a chart actually draws: the catalogue for the dots, IAU-CSN for star names, d3-celestial for the stick
// figures and the IAU for constellation names.
export function chartSources(ch) {
  return [...(ch.stars.length ? [SKY_SRC.stars] : []), ...(ch.named.length ? [SKY_SRC.csn] : []), ...(ch.figures.length ? [SKY_SRC.figures] : []), ...(ch.figures.length || ch.constellationsUp.length ? [SKY_SRC.iau] : [])];
}

// ------------------------------------------------------------------ a city page
const passCells = (p, ref, tz) => [p.fromStart ? `Already up at ${localEl(p.rise, ref, tz)}` : localEl(p.rise, ref, tz), `${localEl(p.max.t, ref, tz)}, ${deg(p.max.el)} in the ${esc(compassWords(p.max.az))}`, p.truncated ? `Still up at ${localEl(p.set, ref, tz)}` : localEl(p.set, ref, tz),
  p.lit ? `Yes, ${localEl(p.lit.from, ref, tz)} to ${localEl(p.lit.to, ref, tz)}, up to ${deg(p.lit.maxEl)}` : "No"];
const nightKindText = (s) => (s.night.kind === "midnightSun" ? "the Sun does not set" : s.night.kind === "polarNight" ? "the Sun does not rise" : null);

export function cityPage(s, { built = [], cities = [] } = {}) {
  const c = s.city, file = skyCityFile(c.id), tz = s.tz, ref = s.night.start, n = s.night;
  const L = (ms) => localEl(ms, ref, tz), T = (ms) => localText(ms, ref, tz);
  const first = startWord(s);
  const nightDate = dateLongTz(n.start, tz);
  const m = s.moon, b = s.strip.best;
  const placed = s.planets.filter((p) => p.wellPlaced);
  const vis = s.iss.status === "ok" ? s.iss.passes.filter((p) => p.visible) : [];
  const title = `Tonight's sky in ${c.name}: Moon, planets, ISS, clouds`;
  const moonWhen = `, and ${bodyDoes(eventsPhrase(m.events, m.upAtStart, L, first))}`;
  const zoneText = s.clock ? `Local times are ${esc(tz)}: ${esc(s.clock.before)} until the clocks change at ${esc(hm(s.clock.at, "UTC"))} UTC, ${esc(s.clock.after)} after; a time in the repeated or skipped hour carries its offset.` : `Local times are ${esc(tz)} (${esc(s.offset)}).`;
  const answer = n.kind === "midnightSun" ? `the Sun does not set in ${esc(c.name)} in the 24 hours after the forecast time, so the sky does not get dark tonight`
    : s.twilightOnly ? `the Sun sets in ${esc(c.name)} tonight but never gets 6° below the horizon, so the sky stays in twilight and no hour gets a viewing score`
    : b ? `the best window for looking up tonight in ${esc(c.name)} is <strong>${L(b.start)} to ${L(b.end)}</strong> local time${b.cloud !== null ? `, with ${b.cloud} percent cloud in MET Norway's forecast` : ""}`
    : `no stretch of tonight in ${esc(c.name)} reaches ${BEST_WINDOW_THRESHOLD} out of 100 on our viewing score${s.strip.cloudAvg !== null ? `, with ${s.strip.cloudAvg} percent cloud on average in MET Norway's forecast` : ""}`;
  const lead = `As of ${timeEl(s.dataTime)}, the time of MET Norway's forecast, ${answer}. The Moon is ${esc(moonPhrase(m.phaseName))}, ${m.illumPct} percent lit${moonWhen}. ${placed.length ? `${and(placed.map((p) => esc(p.name)))} ${v(placed.length, "is", "are")} well placed in the dark` : "No naked-eye planet is well placed in the dark"}${s.iss.status === "ok" ? `, and ${vis.length ? `${vis.length} ISS ${v(vis.length, "pass is", "passes are")} sunlit while the sky is dark` : "no ISS pass is sunlit while the sky is dark"}` : ""}. ${zoneText}`;
  const descOptions = [
    b ? `${nightDate} in ${c.name}: best window ${T(b.start)} to ${T(b.end)}${b.cloud !== null ? ` with ${b.cloud}% cloud` : ""}, ${m.phaseName.toLowerCase()} Moon ${m.illumPct}% lit, ${placed.length} planets placed, ISS passes.` : null,
    b ? `${nightDate} in ${c.name}: best window ${T(b.start)} to ${T(b.end)}, Moon ${m.illumPct}% lit, planets, ISS passes, MET Norway cloud.` : null,
    `${nightDate} in ${c.name}: ${nightKindText(s) || (s.twilightOnly ? "twilight all night" : "no best window")}; Moon ${m.illumPct}% lit, planets, ISS passes and MET Norway's cloud forecast.`,
    `Tonight in ${c.name}: Moon, planets, ISS passes and MET Norway's cloud forecast, computed for ${nightDate}.`,
  ].filter(Boolean);
  const description = descOptions.find((d) => d.length <= 160);
  const hoursRows = s.strip.hours.map((q) => [L(q.t), q.cloud === null ? "No forecast" : String(q.cloud), deg(q.moonAlt), String(q.score), b && q.t >= b.start - 1 && q.t < b.end ? "Yes" : ""]);
  const cloudFig = s.strip.hours.length ? figure(cloudStripSvg({ id: "chart-cloud", title: `Cloud cover per hour tonight in ${c.name}`, desc: `Percent per hour, ${T(s.strip.hours[0].t)} to ${T(s.strip.hours.at(-1).t)}.${b ? ` Best window ${T(b.start)} to ${T(b.end)}.` : " No best window."}`, hours: s.strip.hours, best: b, tz }),
    `Cloud per hour in ${esc(c.name)}, MET Norway forecast of ${timeEl(s.dataTime)}; values printed, best window bracketed.`) : "";
  const moonFig = figure(moonStripSvg({ id: "chart-moon", title: `The Moon's altitude tonight in ${c.name}`, desc: `Every 15 minutes, ${T(n.start)} to ${T(n.end)}. Highest ${deg(m.max.alt)} at ${T(m.max.t)}.`, moon: m, start: n.start, end: n.end, tz }),
    `The Moon's altitude over ${esc(c.name)} tonight (forecast time ${timeEl(s.dataTime)}).`);
  const ch = s.chart;
  // the Moon's path through this night, with the directions of its rise and set
  const moonPath = `${m.events.length ? `Tonight it ${m.upAtStart ? `is up at ${first}, then ` : ""}${and(m.events.map((e) => `${e.kind === "rise" ? "rises" : "sets"} in the ${esc(compassWords(e.az))} at ${L(e.t)}`))}.` : m.upAtStart ? "It is above the horizon all night." : "It stays below the horizon all night."}${m.max.alt > 0 ? ` It is highest at ${L(m.max.t)}, ${deg(m.max.alt)} up in the ${esc(compassWords(m.max.az))}.` : ""}`;
  // the cloud forecast in words, from the hour by hour values (OURS: under 25 percent "mostly clear", over 75 "mostly cloudy")
  const weather = cloudWords(s.strip.hours, T);
  // each ISS pass in words
  const passLines = s.iss.status === "ok" ? s.iss.passes.map((p) => `${p.fromStart ? `Already 10° up at ${L(p.rise)}` : `At ${L(p.rise)} the ISS climbs past 10° in the ${esc(compassWords(p.riseAz))}`}, reaches ${deg(p.max.el)} in the ${esc(compassWords(p.max.az))} at ${L(p.max.t)} and drops below 10° in the ${esc(compassWords(p.setAz))} at ${L(p.set)}${p.lit ? `; it is sunlit in a dark sky from ${L(p.lit.from)} to ${L(p.lit.to)}, up to ${deg(p.lit.maxEl)}` : "; it is not sunlit while the sky is dark"}.`).join(" ") : "";
  const chartFig = figure(polarChartSvg({ id: "chart-sky", title: `The sky over ${c.name} at ${T(s.chartAt)} local time`, desc: `${ch.stars.length} stars, ${ch.figures.length} figures, ${ch.planets.length} ${v(ch.planets.length, "planet", "planets")}${ch.moon ? ", the Moon" : ""}.`, chart: ch }),
    `${esc(c.name)} at ${L(s.chartAt)}, the night after the forecast of ${timeEl(s.dataTime)}: horizon at the edge, overhead in the centre, north up, east left.`);
  const chartRows = [...(ch.moon ? [["Moon", "Moon", deg(ch.moon.alt), esc(compassWords(ch.moon.az))]] : []), ...ch.planets.map((p) => [esc(p.name), "Planet", deg(p.alt), esc(compassWords(p.az))]), ...[...ch.named].sort((a, b) => b.alt - a.alt || a.i - b.i).map((x) => [esc(x.name), `Star, magnitude ${plainNum(x.mag, 1)}`, deg(x.alt), esc(compassWords(x.az))])];
  const consRows = ch.constellationsUp.map((x) => [esc(x.name), deg(x.alt), esc(compassWords(x.az))]);
  // every rise and set in the night, in order, so a planet that sets and rises again shows both (eventsPhrase in site/sky.mjs)
  const planetRows = s.planets.map((p) => [esc(p.name), magText(p.mag), cap(eventsPhrase(p.events, p.upAtStart, L, first)),
    p.best ? `${L(p.best.t)}, ${deg(p.best.alt)} in the ${esc(compassWords(p.best.az))}` : "Not up in a dark sky", p.wellPlaced ? "Yes" : "No", esc(p.constellation)]);
  // one sentence per planet with this city's own times and heights
  const planetLines = s.planets.map((p) => `${esc(p.name)} ${bodyDoes(eventsPhrase(p.events, p.upAtStart, L, first))}${p.best ? `; while up in a dark sky it is highest at ${L(p.best.t)}, ${deg(p.best.alt)} in the ${esc(compassWords(p.best.az))}` : "; it is not up while the sky is dark"}.`).join(" ");
  const issHtml = s.iss.status !== "ok" ? `<p>Not shown: ${esc(s.iss.reason)}.</p>`
    : s.iss.passes.length ? `${table({ caption: `ISS passes at least 10° up tonight over ${c.name} (local time)`, head: ["Rises above 10°", "Highest", "Drops below 10°", "Sunlit while the sky is dark"], rows: s.iss.passes.map((p) => passCells(p, ref, tz)) })}
<p>${passLines} By our calculation from the element set of ${timeEl(s.iss.epoch)}, ${vis.length ? `${vis.length} of the ${s.iss.passes.length} ${v(s.iss.passes.length, "pass is", "passes are")}` : `none of the ${s.iss.passes.length} ${v(s.iss.passes.length, "pass is", "passes is")}`} sunlit while the sky is dark.</p>`
    : `<p>The ISS does not pass at least 10° above the horizon of ${esc(c.name)} between ${L(n.start)} and ${L(n.end)} (element set of ${timeEl(s.iss.epoch)}).</p>`;
  const nightText = n.kind === "midnightSun" ? `The Sun does not set in ${esc(c.name)} in the 24 hours after the forecast time, so there is no night. The tables below cover the 12 hours around local midnight, ${L(n.start)} to ${L(n.end)}, and nothing in them is dark.`
    : n.kind === "polarNight" ? `The Sun does not rise in ${esc(c.name)} in the 24 hours from ${L(n.start)}, so this page covers those 24 hours as tonight.`
    : `Tonight runs from ${n.startsAtData ? `${L(n.start)}, the forecast time (the Sun had already set)` : `sunset at ${L(n.start)}`} to sunrise at ${L(n.end)}: ${durationText(n.end - n.start)}.`;
  const cloudText = s.strip.cloudAvg === null ? "MET Norway's forecast does not cover these hours." : s.strip.cloudMin === s.strip.cloudMax ? `The forecast gives ${s.strip.cloudAvg} percent cloud for every hour.` : `Cloud averages ${s.strip.cloudAvg} percent over these hours, from ${s.strip.cloudMin} to ${s.strip.cloudMax} percent.`;
  const figs = ch.figures.map((f) => esc(f.name)), stars = ch.named.filter((x) => x.label).map((x) => esc(x.name));
  const faq = [
    [`When is the best time to look at the stars in ${c.name} tonight?`, b ? `${L(b.start)} to ${L(b.end)} local time by our viewing score${b.cloud !== null ? `, with ${b.cloud} percent cloud forecast` : ""}; a score, not a promise.` : `No stretch of tonight reaches ${BEST_WINDOW_THRESHOLD} out of 100 on our viewing score${n.kind === "midnightSun" ? ", because the Sun does not set" : s.twilightOnly ? ", because the Sun never gets 6° below the horizon and the sky stays in twilight" : ""}.`],
    ["What phase is the Moon tonight?", `${esc(cap(m.phaseName))}, ${m.illumPct} percent lit at ${L(m.at)}.`],
    [`Which planets are up tonight from ${c.name}?`, placed.length ? `${and(placed.map((p) => `${esc(p.name)} (highest ${deg(p.best.alt)} at ${L(p.best.t)})`))}.` : `None is at least ${PLANET_MIN_ALT}° up in a dark sky tonight.`],
    [`When can I see the ISS from ${c.name} tonight?`, s.iss.status !== "ok" ? `This build cannot say: ${esc(s.iss.reason)}.` : vis.length ? `${and(vis.map((p) => `${L(p.lit.from)} to ${L(p.lit.to)}`))}, when it is sunlit in a dark sky by our calculation.` : `No pass tonight is sunlit in a dark sky by our calculation.`],
  ];
  const body = `${staleNote(s, `${SKY_MAX_AGE_HOURS.clouds} hours`)}${findingsHtml(s.findings)}
${metNote}
${seeAlso(file, built, cities)}

<h2 id="clouds">When is it dark and clear tonight in ${esc(c.name)}?</h2>
<p>${nightText} ${cloudText} ${weather} <a href="${href(file, SKY_HUB_FILE)}#how">How the viewing score works</a>.</p>
${cloudFig}
${table({ caption: `Hour by hour tonight in ${c.name} (local time)`, head: ["Hour", "Cloud (percent)", "Moon altitude", "Viewing score", "In the best window"], numeric: [1, 2, 3], rows: hoursRows })}

<h2 id="moon">Where is the Moon tonight?</h2>
<p>The Moon is ${esc(moonPhrase(m.phaseName))} and ${m.illumPct} percent lit at ${L(m.at)}. ${moonPath} ${PHASE_NOTE}</p>
${moonFig}

<h2 id="planets">Which planets are up tonight?</h2>
<p>${planetLines} Well placed means at least ${PLANET_MIN_ALT}° up in a dark sky at magnitude ${PLANET_MAX_MAG} or brighter (lower is brighter).</p>
${table({ caption: `The five naked-eye planets tonight from ${c.name} (local time)`, head: ["Planet", "Magnitude", "Rises and sets tonight", "Highest while up in a dark sky", "Well placed", "In the constellation"], rows: planetRows })}

<h2 id="chart">What does the sky look like at ${esc(hm(s.chartAt, tz))}?</h2>
<p>${figs.length ? `Figures drawn: ${and(figs)}.` : "No bright constellation is high enough to draw."} ${stars.length ? `Brightest named stars up: ${and(stars)}.` : ""}</p>
${chartFig}
${chartRows.length ? table({ caption: `The Moon, planets and named stars on the chart, at ${T(s.chartAt)} local time, highest stars first`, head: ["Object", "Kind", "Altitude", "Direction"], numeric: [2], rows: chartRows }) : "<p>No planet, Moon or bright named star is above the horizon at that moment.</p>"}
${consRows.length ? table({ caption: `Constellations whose centre is above the horizon at ${T(s.chartAt)} local time, highest first`, head: ["Constellation", "Altitude of its centre", "Direction"], numeric: [1], rows: consRows }) : ""}

<h2 id="iss">When does the ISS pass over ${esc(c.name)} tonight?</h2>
${issHtml}

<h2 id="how">How this page is made</h2>
<p>Computed, not observed: the Sun, Moon and planets with astronomy-engine, the ISS with SGP4 from CelesTrak's element set; the cloud is MET Norway's forecast. Published only while that forecast is under ${SKY_MAX_AGE_HOURS.clouds} hours old. <a href="${href(file, SKY_HUB_FILE)}#how">Method and what was checked</a>.</p>

${faqHtml(faq)}
${sources([SKY_SRC.met, SKY_SRC.engine, SKY_SRC.celestrak, ...chartSources(ch)])}`;
  const crumbs = [{ name: "Tonight's sky", file: SKY_HUB_FILE }];
  return {
    file, crumbs, crumbTitle: c.name, title, description, h1: `What is in the sky tonight in ${c.name}?`, kicker: "Tonight's sky",
    lead, meta: `Forecast time ${timeEl(s.dataTime)}.`, cta: { label: "Open the live sky for this place", query: "#sky" }, body,
    jsonld: [webPageLd({ title, description, file, dataTime: s.dataTime, trail: [...crumbs, { name: c.name, file }] })], dataTime: s.dataTime, ...liveScriptParts(file, { dataTime: s.dataTime }),
  };
}

// ------------------------------------------------------------------ the hub
// summaries: city summaries that exist this run; missing: { id: reason } for the others; cities: the six (public/cities.json order).
export function skyHubPage(summaries, findings, { built = [], cities = [], missing = {} } = {}) {
  const file = SKY_HUB_FILE;
  const times = summaries.map((s) => s.dataTime).sort();
  const newest = times.at(-1);
  const byId = new Map(summaries.map((s) => [s.city.id, s]));
  const withBest = summaries.filter((s) => s.strip.best && s.strip.best.cloud !== null).sort((a, b) => a.strip.best.cloud - b.strip.best.cloud || a.city.name.localeCompare(b.city.name));
  const title = "Tonight's sky in six cities: the best viewing windows";
  const top = withBest[0];
  const lead = top ? `As of ${timeEl(newest)}, the newest MET Norway forecast time among the six cities, the clearest best window tonight is in <strong>${esc(top.city.name)}</strong>: ${localEl(top.strip.best.start, top.night.start, top.tz)} to ${localEl(top.strip.best.end, top.night.start, top.tz)} local time, with ${top.strip.best.cloud} percent cloud. Each row below has its own forecast time.`
    : `As of ${timeEl(newest)}, the newest MET Norway forecast time among the six cities, none of them has a best window tonight on our viewing score. Each row below has its own forecast time.`;
  const description = "Tonight's best stargazing window, cloud, Moon and ISS passes for Pune, New York, London, Tromsø, Tokyo and Sydney, computed from MET Norway's forecast.";
  const rows = cities.map((c) => {
    const s = byId.get(c.id), f = skyCityFile(c.id);
    if (!s) return [esc(c.name), esc(missing[c.id] ? `${cap(missing[c.id])}; page not updated` : "Page not updated"), "", "", "", ""];
    const b = s.strip.best, ref = s.night.start;
    const vis = s.iss.status === "ok" ? String(s.iss.passes.filter((p) => p.visible).length) : "Not computed";
    return [built.includes(f) ? `<a href="${href(file, f)}">${esc(c.name)}</a>` : esc(c.name),
      s.night.kind === "midnightSun" ? "The Sun does not set" : `${s.night.startsAtData ? "Already dark at the forecast time, " : ""}${localEl(s.night.start, ref, s.tz)} to ${localEl(s.night.end, ref, s.tz)} (${durationText(s.night.end - s.night.start)}${s.night.startsAtData ? " left" : ""}${s.night.kind === "polarNight" ? ", the Sun does not rise" : ""}${s.twilightOnly ? ", twilight only" : ""})`,
      s.strip.cloudAvg === null ? "No forecast" : `${s.strip.cloudAvg}%`,
      b ? `${localEl(b.start, ref, s.tz)} to ${localEl(b.end, ref, s.tz)}, ${b.cloud === null ? "no cloud forecast" : `${b.cloud}% cloud`}` : "None",
      `${s.moon.illumPct}% lit${s.moon.upAtStart ? (s.night.kind === "night" && !s.night.startsAtData ? ", up at dusk" : ", up at the forecast time") : ""}`, vis];
  });
  const withAvg = summaries.filter((s) => s.strip.cloudAvg !== null);
  const cloudBars = withAvg.length ? figure(barChartSvg({ id: "chart-cities", title: "Average cloud cover tonight by city", desc: `MET Norway's forecast, averaged over each city's night: ${withAvg.map((s) => `${s.city.name} ${s.strip.cloudAvg} percent`).join(", ")}.`, rows: withAvg.map((s) => ({ label: s.city.name, value: s.strip.cloudAvg })) }),
    `Average cloud cover over each city's night, in percent, from MET Norway's forecasts (the newest of ${timeEl(newest)}); each bar has its value printed, and the table above gives the same numbers.`) : "";
  const faq = [
    ["Which city has the clearest sky tonight?", top ? `${esc(top.city.name)}, with ${top.strip.best.cloud} percent cloud in its best window in MET Norway's forecast. A forecast is not a promise of a clear sky.` : "None of the six has a best window on our viewing score tonight."],
    ["Why are these six cities?", "They are the places our collector fetches a cloud forecast for. The live app works out tonight's sky for any place, without the cloud forecast elsewhere."],
    ["Does the Moon look the same from every city?", "Its phase is the same everywhere at the same moment; when it rises and sets, and how high it climbs, depend on the place."],
  ];
  const body = `${summaries.some((s) => s.stale) ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, and some of it is older than the ${SKY_MAX_AGE_HOURS.clouds} hours these pages allow for live data. The live copy replaces it after the next data collection.</p>\n` : ""}${findingsHtml(findings)}
${metNote}
${seeAlso(file, built.filter((f) => !cities.some((c) => skyCityFile(c.id) === f && !byId.has(c.id))), cities)}

<h2 id="cities">Tonight in the six cities</h2>
${table({ caption: "Tonight's best window, cloud, Moon and ISS passes by city (local times)", head: ["City", "Tonight", "Cloud on average", "Best window", "Moon (lit at the city's chart time)", "ISS passes sunlit in a dark sky"], numeric: [2, 5], rows })}
${cloudBars}

<h2 id="how">How these pages are made</h2>
<ul>
<li>The night starts at the first sunset after MET Norway's forecast time for the city, or at the forecast time when the Sun has already set, and ends at the next sunrise. Sunrise and sunset are astronomy-engine's rise and set times (see the checks below). Where the Sun does not set or rise within 24 hours, the page says so.</li>
<li>Each hour of the night gets a viewing score from 0 to 100, the live app's own: zero while the Sun is less than 6° below the horizon (${DARK_SUN_ALT}°), more as the sky darkens to 18° below, less for a bright Moon that is up, and scaled by the share of sky MET Norway forecasts to be clear. The best window is the run of consecutive hours scoring ${BEST_WINDOW_THRESHOLD} or more with the highest total.</li>
<li>The Sun, Moon and planets are computed with the astronomy-engine library, whose documentation says its accuracy is always within 1 arcminute of results from NOVAS. Our tests compare this code's Sun and Moon rise and set times with the US Naval Observatory's tables for these six cities on the 2026 solstices and require agreement within ${RISE_SET_CHECK_MINUTES} ${v(RISE_SET_CHECK_MINUTES, "minute", "minutes")}, and the Moon's phase with the Observatory's phase table. The planet positions are not compared with a second source.</li>
<li>The polar chart shows stars brighter than magnitude ${CHART_MAG_LIMIT} from the app's star catalogue and the stick figures of up to ${FIGURE_MAX} bright constellations, placed from the catalogue's fixed positions without a correction for the slow drift of the sky (precession); the Moon and planets are placed for the moment shown.</li>
<li>ISS passes come from the newest element set for the ISS in CelesTrak's data with the SGP4 model, the same code as the live app. A pass is listed when the ISS is at least 10° up; it is sunlit in a dark sky when sunlight falls on it while the Sun is more than 6° below the observer's horizon. We have not measured how far pass times drift as the element set ages, so treat them as approximate. Passes are not shown when the element set is more than ${ISS_MAX_AGE_DAYS} days old.</li>
<li>Times on the city pages are each city's local time and are not converted to yours: the findings, the sky chart and its heading are worked out for that local night.</li>
<li>Findings say "about the same" when a number is within ${Math.round(ABOUT_SAME * 100)} percent of what it is compared with.</li>
<li>Everything is computed, not observed, and nothing here promises that anything will be seen: weather, haze, lights and your horizon decide that.</li>
</ul>

${faqHtml(faq)}
${sources([SKY_SRC.met, SKY_SRC.metLicence, SKY_SRC.engine, SKY_SRC.usno, SKY_SRC.celestrak, SKY_SRC.satjs])}`;
  return {
    file, crumbTitle: "Tonight's sky", title, description, h1: "Where is the sky clearest tonight?", kicker: "Tonight's sky",
    lead, meta: `Newest forecast time ${timeEl(newest)}. Each row gives its own night; cloud forecasts by MET Norway.`, cta: { label: "See tonight's sky for your place", query: "#tonight" }, body,
    jsonld: [webPageLd({ title, description, file, dataTime: newest, trail: [{ name: "Tonight's sky", file }] })], dataTime: newest, ...liveScriptParts(file, { dataTime: newest }),
  };
}

// ------------------------------------------------------------------ ISS today
export function issPage(s, { built = [], cities = [], coast = [] } = {}) {
  const file = ISS_FILE, p = s.position, o = s.orbit;
  const title = "Where is the ISS today? Position, track and passes";
  const ageH = plainNum(s.ageHours, 1);
  const lead = `As of ${timeEl(s.dataTime)}, the time of our satellite data, the International Space Station was at <strong>${latText(p.lat)}, ${lonText(p.lon)}</strong>, ${Math.round(p.hKm)} km up, computed with the SGP4 model from CelesTrak's element set of ${timeEl(s.epoch)}, which was ${ageH} hours old at the data time.`;
  const all = s.passes.flatMap((x) => x.passes.map((q) => ({ ...q, city: x.city })));
  const vis = all.filter((q) => q.visible);
  const description = `The ISS at ${latText(p.lat)}, ${lonText(p.lon)}, ${Math.round(p.hKm)} km up on ${dateLong(s.dataTime)}: ground track, orbit, ${all.length} passes over six cities in 24 hours.`;
  const trackRows = s.track.flat().filter((q) => q.min % 15 === 0).map((q) => [esc(timeUtc(isoOf(Date.parse(s.dataTime) + q.min * 60e3)).replace(" UTC", "")), q.min > 0 ? `+${q.min}` : String(q.min), esc(latText(q.lat)), esc(lonText(q.lon))]);
  const map = figure(issMapSvg({ id: "map", title: `ISS ground track around ${when(s.dataTime)}`, desc: `From 45 minutes before (dashed) to 90 minutes after (solid) the data time. At the data time: ${latText(p.lat)}, ${lonText(p.lon)}.`, coast, track: s.track, position: p, cities }),
    `The ground track of the ISS from 45 minutes before to 90 minutes after ${timeEl(s.dataTime)}, computed from the element set; the dashed part is before the data time. The table below gives the positions every 15 minutes.`);
  const passTables = s.passes.map((x) => `<h3 id="passes-${esc(x.city.id)}">${esc(x.city.name)}</h3>
${x.passes.length ? table({ caption: `ISS passes at least 10° up over ${x.city.name} in the 24 hours after the data time (local time, ${x.city.tz})`, head: ["Rises above 10°", "Highest", "Drops below 10°", "Sunlit while the sky is dark"], rows: x.passes.map((q) => passCells(q, Date.parse(s.dataTime), x.city.tz)) }) : `<p>No pass at least 10° up in the 24 hours after the data time.</p>`}`).join("\n");
  const faq = [
    ["Where is the ISS right now?", `This page gives its position at the data time, ${timeEl(s.dataTime)}: ${latText(p.lat)}, ${lonText(p.lon)}. It moves about ${Math.round(360 / o.periodMin * 10) / 10} degrees around the Earth every minute, so for where it is now, open <a href="${href(file, "index.html")}">the live globe</a>, which computes it in your browser.`],
    ["How high is the ISS?", `Between ${Math.round(o.minHeightKm)} and ${Math.round(o.maxHeightKm)} km over the orbit after the data time, ${Math.round(o.meanHeightKm)} km on average, computed from the element set.`],
    ["How long does the ISS take to go round the Earth?", `${plainNum(o.periodMin, 1)} minutes, from the element set's ${plainNum(o.meanMotion, 2)} orbits a day.`],
    ["When can I see the ISS?", `When it passes over you while it is in sunlight and your sky is dark. ${vis.length} of the ${all.length} passes over the six cities in the 24 hours after the data time are like that; the tables give the times.`],
  ];
  const body = `${s.stale ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, which is older than the ${SKY_MAX_AGE_HOURS.satellites} hours this page allows for live data${s.ageHours > ISS_MAX_AGE_DAYS * 24 ? `, and its element set is more than ${ISS_MAX_AGE_DAYS} days old` : ""}. The live copy replaces it after the next data collection.</p>\n` : ""}${findingsHtml(s.findings)}
${cards([[`${latText(p.lat)}, ${lonText(p.lon)}`, "Position at the data time"], [`${Math.round(p.hKm)} km`, "Height at the data time"], [`${plainNum(o.periodMin, 1)} min`, "Time for one orbit"], [String(vis.length), "Passes over the six cities sunlit in a dark sky, next 24 hours"]])}
${seeAlso(file, built, cities)}

<h2 id="track">Where is the ISS going?</h2>
${map}
${table({ caption: "ISS position every 15 minutes around the data time (UTC)", head: ["Time (UTC)", "Minutes from the data time", "Latitude", "Longitude"], numeric: [1], rows: trackRows })}
<p>The track reaches ${plainNum(s.maxTrackLat, 1)}° from the equator, close to the orbit's inclination of ${plainNum(o.inclination, 2)}°. ${s.next ? `The first place in our list of ${s.places.toLocaleString("en-GB")} towns and cities that it passes within ${PLACE_MAX_KM} km of is ${esc(s.next.place.name)}, ${s.next.min} minutes after the data time.` : ""}</p>

<h2 id="orbit">The ISS orbit</h2>
${table({ caption: "Orbit facts from the ISS element set", head: ["Measure", "Value"], rows: [["Inclination to the equator", `${plainNum(o.inclination, 2)}°`], ["Orbits per day", plainNum(o.meanMotion, 2)], ["Time for one orbit", `${plainNum(o.periodMin, 1)} minutes`], ["Height over the next orbit", `${Math.round(o.minHeightKm)} to ${Math.round(o.maxHeightKm)} km, ${Math.round(o.meanHeightKm)} km on average`], ["Eccentricity", o.eccentricity.toFixed(5)], ["Element set time", timeEl(s.epoch)], ["Age of the element set at the data time", `${ageH} hours`]] })}
<p>Heights are above the WGS84 ellipsoid, the Earth's standard shape, worked out every 30 seconds over the orbit after the data time.</p>

<h2 id="passes">When does the ISS pass over the six cities?</h2>
<p>Passes at least 10° above the horizon in the 24 hours after the data time, for the six cities of our cloud forecast pages. A pass can be seen only when it is sunlit while the sky is dark; the last column gives that part.</p>
${passTables}

<h2 id="how">How this page is made</h2>
<ul>
<li>Positions are computed, not observed: CelesTrak's element set for the ISS (NORAD catalogue number 25544) is run through the SGP4 model with the satellite.js library, the same code as the live app. We have not measured how far these positions drift from the real ISS as the element set ages; the age is shown above.</li>
<li>This page is a snapshot at the data time. The real-time view is <a href="${href(file, "index.html")}">the live globe</a>.</li>
<li>The live copy of this page is published only when the satellite data is less than ${SKY_MAX_AGE_HOURS.satellites} hours old and the ISS element set less than ${ISS_MAX_AGE_DAYS} days old. A copy built when the site is deployed uses the data bundled with the site, which can be older than that; it then says so at the top, and the live copy replaces it after the next data collection.</li>
</ul>

${faqHtml(faq)}
${sources([SKY_SRC.celestrak, SKY_SRC.satjs])}`;
  return {
    file, crumbTitle: "ISS today", title, description, h1: "Where is the International Space Station today?", kicker: "Live position",
    lead, meta: `Data as of ${timeEl(s.dataTime)}, the time of our satellite data. Element set from CelesTrak.`, cta: { label: "See the ISS live on the globe", query: "" }, body,
    jsonld: [webPageLd({ title, description, file, dataTime: s.dataTime, trail: [{ name: "ISS today", file }] })], dataTime: s.dataTime, ...liveScriptParts(file, { dataTime: s.dataTime }),
  };
}

