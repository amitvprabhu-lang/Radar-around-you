// The three fleet and events pages: /starlink-tracker/, /natural-disasters-now/ and /rocket-launches/ (docs/superpowers/specs/
// 2026-10-06-more-live-pages-design.md). Pure: each page function takes a summary from site/events.mjs and returns a page object for
// renderPage, so the lead, the description, the findings, the tables, the figures and the structured data cannot disagree. The typed
// text is method, caveats and definitions, each traced in docs/events-pages-sources.md. Nothing here forecasts or advises.
import { esc, sources, href } from "./layout.mjs";
import { barChartSvg, columnChartSvg, num, dateLong, timeUtc } from "./pages-satcount.mjs";
import { worldMapSvg, coastPath, uniqueDots } from "./svgmap.mjs";
import { LIVE_FILES, SATCOUNT_FILE, RIGHT_NOW_FILE } from "./livepages.mjs";
import { EVENT_PAGES, EVENT_MAX_AGE_HOURS, LAUNCH_WINDOW_DAYS, LAUNCH_TABLE_ROWS, GDACS_TYPES, GDACS_PLURAL, GDACS_TYPE_ORDER, GDACS_RECENT_DAYS, GDACS_MAX_EVENTS,
  STARLINK_MIN, ALT_BAND_KM, MONTHS_SHOWN, STORMS_FOR_DEDUPE_MAX_HOURS, countryName, launchFindings, disasterFindings, starlinkFindings } from "./events.mjs";
import { SAME_WITHIN_TEXT, percentText, and } from "./insight.mjs";
import { webPageLd, scopedTable, figureHtml, timeTagUtc, liveScriptParts } from "./liveseo.mjs";
import { ORBIT_BOUNDS } from "./satcount.mjs";

const page = (key) => EVENT_PAGES.find((p) => p.key === key);

// ------------------------------------------------------------------ sources (addresses as recorded in docs/ and pipeline/config.py)
export const EVENT_SRC = {
  ll2: { title: "The Space Devs: Launch Library 2", url: "https://thespacedevs.com/llapi", note: "The launch list this page reads, by The Space Devs" },
  ll2faq: { title: "The Space Devs FAQ", url: "https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md", note: "Their terms of use and the free tier's limit of 15 calls an hour" },
  gdacs: { title: "GDACS, the Global Disaster Alert and Coordination System", url: "https://www.gdacs.org/About/overview.aspx", note: "A cooperation framework between the United Nations and the European Commission" },
  gdacsAlerts: { title: "GDACS alerts", url: "https://www.gdacs.org/Alerts/default.aspx", note: "GDACS's own list of current alerts" },
  gdacsTerms: { title: "GDACS terms of use", url: "https://www.gdacs.org/About/termofuse.aspx", note: "The disclaimer quoted on this page" },
  celestrak: { title: "CelesTrak current GP data (the active list)", url: "https://celestrak.org/NORAD/elements/", note: "Where the orbital element sets come from" },
  satcat: { title: "CelesTrak SATCAT format", url: "https://celestrak.org/satcat/satcat-format.php", note: "Status, type and launch date for each object" },
};

// ------------------------------------------------------------------ formatting helpers (deterministic, UTC)
const when = (iso) => `${dateLong(iso)}, ${timeUtc(iso)}`;
const timeEl = (iso) => timeTagUtc(iso, when(iso));
const dayHour = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));
const dayOnly = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const v = (n, one, many) => (n === 1 ? one : many);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const faqHtml = (faq) => `<h2 id="faq">Questions</h2>\n${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}`;
const cards = (list) => `<ul class="grid">\n${list.map(([b, s]) => `<li><div class="card"><b>${b}</b><span>${s}</span></div></li>`).join("\n")}\n</ul>`;
const findingsHtml = (list) => `<h2 id="meaning">What this means</h2>\n<ul>${list.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>`;
const liveStatus = (what) => `<p class="meta" data-live-status>${what}</p>`;
const staleNote = (s, limit) => (s.stale ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, which is older than the ${limit} hours this page allows for live data. The live copy replaces it after the next data collection.</p>\n` : "");
// "180° W" / "34.6° N" to one decimal
const latText = (lat) => `${(Math.round(Math.abs(lat) * 10) / 10).toLocaleString("en-GB")}° ${lat >= 0 ? "N" : "S"}`;
const lonText = (lon) => `${(Math.round(Math.abs(lon) * 10) / 10).toLocaleString("en-GB")}° ${lon >= 0 ? "E" : "W"}`;

// Links to the other live pages of this family and the hub that exist in this build (built: their files), so no link points at a missing
// page, with descriptive text.
const LINK_TEXT = { "starlink-tracker/index.html": "the Starlink tracker", "natural-disasters-now/index.html": "natural disasters GDACS lists now", "rocket-launches/index.html": "the next rocket launches",
  [RIGHT_NOW_FILE]: "every live number right now", [SATCOUNT_FILE]: "how many satellites are in orbit", "tropical-storms-now/index.html": "active tropical storms (NHC)", "earthquakes-today/index.html": "earthquakes in the last 24 hours", "wildfires-today/index.html": "satellite fire detections today" };
function seeAlso(file, built, extra = []) {
  const want = [...EVENT_PAGES.map((p) => p.file), ...extra, RIGHT_NOW_FILE];
  const links = LIVE_FILES.filter((f) => f !== file && want.includes(f) && built.includes(f)).map((f) => `<a href="${href(file, f)}">${esc(LINK_TEXT[f])}</a>`);
  return links.length ? `<p>More live pages: ${links.join(", ")}.</p>` : "";
}

// ------------------------------------------------------------------ graphics (pure, deterministic SVG)
// A histogram of 10 km altitude bands: one column per band from the lowest to the highest band that holds a satellite (empty bands between
// are drawn as gaps), the axis labelled every 50 km, each column with a data-tip for the shared script's tooltips.
export function altitudeHistogramSvg({ id, title, desc, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const colW = 12, plotH = 180, left = 50, w = left + rows.length * colW + 20, h = plotH + 60;
  const cols = rows.map((r, i) => {
    const x = left + i * colW;
    const bh = r.count ? Math.max(2, Math.round((r.count / max) * plotH)) : 0;
    const label = r.from % 50 === 0 ? `<text x="${x}" y="${plotH + 34}" text-anchor="middle" fill="var(--text)" font-size="11">${num(r.from)}</text><line x1="${x}" y1="${plotH + 20}" x2="${x}" y2="${plotH + 24}" stroke="var(--muted)"></line>` : "";
    return (bh ? `<rect x="${x + 1}" y="${20 + plotH - bh}" width="${colW - 2}" height="${bh}" fill="var(--ion)" data-tip="${num(r.from)} to ${num(r.to)} km: ${num(r.count)}"><title>${num(r.from)} to ${num(r.to)} km: ${num(r.count)}</title></rect>` : "") + label;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto">` +
    `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>` +
    `<line x1="${left}" y1="${plotH + 20}" x2="${left + rows.length * colW}" y2="${plotH + 20}" stroke="var(--muted)"></line>` +
    `<text x="${left - 6}" y="28" text-anchor="end" fill="var(--muted)" font-size="11">${num(max)}</text>` +
    `${cols}<text x="${left + (rows.length * colW) / 2}" y="${plotH + 54}" text-anchor="middle" fill="var(--muted)" font-size="12">Mean altitude, km</text></svg>`;
}

// Marker shapes for the GDACS types (so colour is never the only cue) and sizes and colours for the alert levels. Sizes are in map units
// (a tenth of a degree; at the 720 pixel size 5 units are about one pixel).
export const EVENT_SHAPES = { TC: "circle", FL: "square", WF: "triangle", DR: "diamond", VO: "cross" };
export const ALERT_STYLE = { Green: { r: 16, fill: "#4cc38a" }, Orange: { r: 26, fill: "#ffa94d" }, Red: { r: 36, fill: "#ff6b7a" } };
const MAP_W = 3600, MAP_H = 1800;
const mx = (lon) => Math.round(Math.max(-180, Math.min(180, lon)) * 10) + MAP_W / 2;
const my = (lat) => MAP_H / 2 - Math.round(Math.max(-90, Math.min(90, lat)) * 10);
export function markerPath(shape, x, y, r) {
  if (shape === "circle") return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  if (shape === "square") { const s = Math.round(r * 0.9); return `M${x - s} ${y - s}h${2 * s}v${2 * s}h${-2 * s}Z`; }
  if (shape === "triangle") return `M${x} ${y - r}L${x + r} ${y + Math.round(r * 0.8)}H${x - r}Z`;
  if (shape === "diamond") return `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`;
  const t = Math.round(r / 3);  // a plus sign
  return `M${x - t} ${y - r}h${2 * t}v${r - t}h${r - t}v${2 * t}h${t - r}v${r - t}h${-2 * t}v${t - r}h${t - r}v${-2 * t}h${r - t}Z`;
}
// OURS: the maps on these pages draw the coastlines on a one degree grid (the other live pages use half a degree), which halves the
// coastline's share of the page; at the 720 pixel size a degree is two pixels.
export const COAST_STEP_EVENTS = 10;
const coastLayer = (coast) => `<path d="${coastPath(coast, COAST_STEP_EVENTS)}" transform="scale(${COAST_STEP_EVENTS})" fill="none" stroke="var(--muted)" stroke-width="0.3" stroke-linejoin="round"></path>`;

// A world map of many points (the Starlink fleet) in a compact path: points rounded to 0.1 degree and deduplicated as on the other maps,
// sorted by row, each dot written as a relative move from the one before ("m12 0h0"), so ten thousand dots stay small.
export function fleetMapSvg({ coast, points, id, title, desc }) {
  const seen = new Set(), dots = [];
  for (const [lat, lon] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const x = mx(lon), y = my(lat), k = `${x} ${y}`;
    if (seen.has(k)) continue;
    seen.add(k); dots.push([x, y]);
  }
  dots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const d = dots.map(([x, y], i) => (i === 0 ? `M${x} ${y}h0` : `m${x - dots[i - 1][0]} ${y - dots[i - 1][1]}h0`)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${MAP_W} ${MAP_H}" width="720" height="360" style="max-width:100%;height:auto">` +
    `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc><rect width="${MAP_W}" height="${MAP_H}" fill="var(--ink2)"></rect>` +
    `<path d="${d}" fill="none" stroke="var(--ion)" stroke-opacity="0.85" stroke-width="${dots.length > 4000 ? 8 : dots.length > 800 ? 12 : 18}" stroke-linecap="round"></path>${coastLayer(coast)}</svg>`;
}

// events: [{ lat, lon, type, alert, name }]. Green first, then Orange, then Red, so the higher alerts are drawn on top; a legend names the
// shapes and the alert levels in text.
export function eventMapSvg({ coast, events, id, title, desc }) {
  const order = { Green: 0, Orange: 1, Red: 2 };
  const list = [...events].sort((a, b) => order[a.alert] - order[b.alert] || a.lat - b.lat || a.lon - b.lon || a.name.localeCompare(b.name, "en"));
  const marks = ["Green", "Orange", "Red"].map((a) => { const of = list.filter((e) => e.alert === a); return of.length ? `<g fill="${ALERT_STYLE[a].fill}" stroke="#04060c" stroke-width="4">${of.map((e) => `<path d="${markerPath(EVENT_SHAPES[e.type], mx(e.lon), my(e.lat), ALERT_STYLE[a].r)}" data-tip="${esc(`${e.name}: ${GDACS_TYPES[e.type]}, ${a} alert`)}"></path>`).join("")}</g>` : ""; }).join("");
  const types = GDACS_TYPE_ORDER.map((t, i) => `<path d="${markerPath(EVENT_SHAPES[t], 90 + i * 560, 1730, 26)}" fill="var(--muted)"></path><text x="${130 + i * 560}" y="1745" fill="var(--text)" font-size="44">${esc(GDACS_TYPES[t])}</text>`).join("");
  const alerts = ["Green", "Orange", "Red"].map((a, i) => `<path d="${markerPath("circle", 90 + i * 420, 1650, ALERT_STYLE[a].r)}" fill="${ALERT_STYLE[a].fill}"></path><text x="${140 + i * 420}" y="1665" fill="var(--text)" font-size="44">${a} alert</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${MAP_W} ${MAP_H}" width="720" height="360" style="max-width:100%;height:auto">` +
    `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc><rect width="${MAP_W}" height="${MAP_H}" fill="var(--ink2)"></rect>` +
    `${coastLayer(coast)}${marks}<rect x="30" y="1590" width="3540" height="190" fill="var(--ink)" fill-opacity="0.8"></rect>${alerts}${types}</svg>`;
}

// ------------------------------------------------------------------ rocket launches
// The planned time in a time element whose datetime is only as exact as the source: a full time for SEC, MIN and HR, the month for M,
// the year for a quarter, the day otherwise. Tables sort by it (site/live-pages-js.mjs).
export function launchTimeEl(l) {
  const iso = l.net;
  const dt = ["SEC", "MIN", "HR"].includes(l.precision) ? iso : l.precision === "M" ? iso.slice(0, 7) : /^Q[1-4]$/.test(l.precision) ? iso.slice(0, 4) : iso.slice(0, 10);
  return `<time datetime="${esc(dt)}">${esc(l.when)}</time>`;
}
const PRECISION_WORDS = { SEC: "to the second", MIN: "to the minute", HR: "to the hour", M: "only to the month", Q1: "only to the quarter", Q2: "only to the quarter", Q3: "only to the quarter", Q4: "only to the quarter" };
const precisionText = (l) => PRECISION_WORDS[l.precision] || (l.precisionName ? `only as "${l.precisionName}" (the source's word)` : "not given");

export function launchesPage(s, { built = LIVE_FILES, coast = [], previous = null } = {}) {
  const p = page("launches"), file = p.file, date = dateLong(s.dataTime), nx = s.next;
  const title = `Rocket launches: the next launches, ${date}`;
  const lead = `As of ${timeEl(s.dataTime)}, when our collector read Launch Library 2, the next launch in its list is ` +
    (nx ? `<strong><span data-live-key="next-name">${esc(nx.name)}</span></strong>, planned for <span data-live-key="next-when">${esc(nx.when)}</span>${nx.provider ? ` by ${esc(nx.provider)}` : ""}, status "${esc(nx.statusName || nx.status || "not given")}".`
      : `<strong><span data-live-key="next-name">none in the list</span></strong>: no launch is planned at or after that time.`) +
    ` <strong><span data-live-key="launches-30">${num(s.in30)}</span> ${v(s.in30, "launch is", "launches are")}</strong> planned in the ${LAUNCH_WINDOW_DAYS} days after it.`;
  const description = (nx ? [
    `Next launch: ${nx.name}, ${nx.when}. ${num(s.in30)} launches planned in the 30 days to come, by provider, country and pad. Data as of ${date}.`,
    `Next launch: ${nx.name}. ${num(s.in30)} launches planned in the next 30 days, by provider, country and pad, as of ${date}.`,
    `${num(s.in30)} rocket launches planned in the 30 days after ${date}, with the next one, providers, countries, pads and how exact each time is.`,
  ] : [`No rocket launch is planned after ${date} in the Launch Library 2 list. Counts by provider and country, the pads, and how exact each time is.`]).find((d) => d.length <= 160);
  const findings = launchFindings(s, previous);
  const next15 = s.upcoming.slice(0, LAUNCH_TABLE_ROWS);
  const providers = s.byProvider.slice(0, 12), countries = s.byCountry.slice(0, 12);
  const siteDots = s.sites.map((x) => [x.lat, x.lon]);
  const nextHtml = nx ? `
<h2 id="next">The next launch</h2>
${nx.exact && (nx.precision === "SEC" || nx.precision === "MIN") ? `<p data-countdown="${esc(nx.net)}" data-precision="${esc(nx.precision)}" data-status="${esc(nx.statusName || nx.status || "not given")}">Planned for <time datetime="${esc(nx.net)}">${esc(nx.when)}</time>, a time the source gives ${esc(precisionText(nx))}.</p>`
    : `<p>Planned for ${esc(nx.when)}; the source gives this time ${esc(precisionText(nx))}.</p>`}
${scopedTable({ caption: "The next launch in the list", head: ["Detail", "As Launch Library 2 gives it"], rows: [
    ["Name", esc(nx.name)], ["Provider", esc(nx.provider || "Not given")], ["Rocket", esc(nx.rocket || "Not given")], ["Mission", esc(nx.mission || "Not given")], ["Mission type", esc(nx.missionType || "Not given")],
    ["Orbit", esc(nx.orbit || "Not given")], ["Pad", esc(nx.pad || "Not given")], ["Location", esc(nx.location || "Not given")], ["Country of the pad", esc(countryName(nx.country))],
    ["Planned time (NET, no earlier than)", esc(nx.when)], ["How exact", esc(cap(precisionText(nx)))], ["Status", esc(nx.statusName || nx.status || "Not given")]] })}` : `
<h2 id="next">The next launch</h2>
<p>The list our collector read at ${timeEl(s.dataTime)} has no launch planned at or after that time.</p>`;
  const faq = [
    ["When is the next rocket launch?", nx ? `In the list as our collector read it at ${esc(when(s.dataTime))}: ${esc(nx.name)}, ${esc(nx.when)}. Launch times often change; check the provider for the latest.` : "The list has no launch planned after its own time."],
    [`How many launches are planned in the next ${LAUNCH_WINDOW_DAYS} days?`, `${num(s.in30)} in the ${LAUNCH_WINDOW_DAYS} days after ${esc(when(s.dataTime))}, by their planned times in the list${s.windowShort ? "; the list ends inside that window, so the count can be low" : ""}.`],
    ["Why do some launches have only a month or a quarter?", "Launch Library 2 says how exact each planned time is. A month or a quarter means the day is not set yet, so this page prints the month or the quarter and not a day."],
    ["Does this page count down to the launch?", "The page itself prints the planned time in UTC. With JavaScript on, it also shows a countdown for a time given to the minute or second, marked if the time holds, and after the planned time it shows the status the page was built with. It never says that a launch happened."],
  ];
  const body = `${staleNote(s, EVENT_MAX_AGE_HOURS.launches)}<p class="note">Data: <a href="${esc(EVENT_SRC.ll2.url)}" rel="noopener">The Space Devs, Launch Library 2</a>. Launch times change often; check the provider for the latest. We add the counts, the map and the comparisons; the list is theirs.</p>
${findingsHtml(findings)}
${liveStatus("With JavaScript on, this page checks the live data every 5 minutes and updates the next launch and the 30 day count in place.")}
${cards([[nx ? esc(nx.when) : "None", "Next planned launch time in the list"], [num(s.in30), `Launches planned in the ${LAUNCH_WINDOW_DAYS} days after the data time`], [num(s.exactUpcoming), "Launches still to come with a time to the hour or better"]])}
${seeAlso(file, built)}
${nextHtml}

<h2 id="list">The next ${num(Math.min(LAUNCH_TABLE_ROWS, s.upcoming.length))} launches</h2>
${next15.length ? scopedTable({ caption: `The next ${next15.length} launches in the list, soonest first`, head: ["Planned time (UTC)", "How exact", "Launch", "Provider", "Pad and location", "Status"],
    rows: next15.map((l) => [launchTimeEl(l), esc(cap(precisionText(l))), esc(l.name), esc(l.provider || "Not given"), esc([l.pad, l.location].filter(Boolean).join(", ") || "Not given"), esc(l.statusName || l.status || "Not given")]) }) : "<p>The list has no launch still to come.</p>"}
<p>Times are printed in UTC with the precision the source gives. A planned time is "no earlier than": the launch can move later.</p>

<h2 id="by-provider">Launches in the next ${LAUNCH_WINDOW_DAYS} days by provider and by country</h2>
${s.in30 ? `${figureHtml(barChartSvg({ id: "chart-providers", title: `Launches in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}, by provider`, desc: `${providers.map((x) => `${x.name} ${num(x.count)}`).join(", ")}.`, rows: providers.map((x) => ({ label: x.name, value: x.count })) }), `Launches planned in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}, by provider, ${num(s.in30)} in all; the table below gives the numbers.`)}
${scopedTable({ caption: `Launches in the ${LAUNCH_WINDOW_DAYS} days after the data time, by provider`, head: ["Provider", "Launches", "Share (percent)"], numeric: [1, 2], rows: s.byProvider.map((x) => [esc(x.name), num(x.count), percentText(x.count, s.in30)]) })}
${figureHtml(barChartSvg({ id: "chart-countries", title: `Launches in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}, by country of the pad`, desc: `${countries.map((x) => `${countryName(x.name)} ${num(x.count)}`).join(", ")}.`, rows: countries.map((x) => ({ label: countryName(x.name), value: x.count })) }), `Launches planned in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}, by the country of the pad; the table below gives the numbers.`)}
${scopedTable({ caption: `Launches in the ${LAUNCH_WINDOW_DAYS} days after the data time, by country of the pad`, head: ["Country of the pad", "Launches", "Share (percent)"], numeric: [1, 2], rows: s.byCountry.map((x) => [esc(countryName(x.name)), num(x.count), percentText(x.count, s.in30)]) })}` : `<p>No launch in the list is planned in the ${LAUNCH_WINDOW_DAYS} days after the data time.</p>`}
<p>The country is the country of the pad as Launch Library 2 records it, not the country of the provider.${s.windowShort ? ` Our collector keeps the next ${num(s.listed)} launches of the ${s.total === null ? "upcoming list" : `${num(s.total)} upcoming launches Launch Library 2 counted`}, and the last of them is on ${esc(dayOnly(s.last))}, inside the ${LAUNCH_WINDOW_DAYS} days, so these counts can be low.` : ""}</p>

<h2 id="pads">Where they launch from</h2>
${s.sites.length ? `${figureHtml(fleetMapSvg({ coast, points: siteDots, id: "map", title: `Launch pads with a launch planned in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}`, desc: `${num(s.sites.length)} ${v(s.sites.length, "pad", "pads")} with pad coordinates in the list, ${num(uniqueDots(siteDots))} dots on the map.` }), `The pads of the launches planned in the ${LAUNCH_WINDOW_DAYS} days after ${when(s.dataTime)}, one dot each; the table below names them.`)}
${scopedTable({ caption: `Pads with a launch in the ${LAUNCH_WINDOW_DAYS} days after the data time`, head: ["Pad", "Location", "Position", "Launches"], numeric: [3], rows: s.sites.map((x) => [esc(x.pad || "Not given"), esc(x.location || "Not given"), esc(`${latText(x.lat)}, ${lonText(x.lon)}`), num(x.count)]) })}` : `<p>No launch in the ${LAUNCH_WINDOW_DAYS} days has pad coordinates in the list, so there is no map.</p>`}
${s.noCoords ? `<p>${num(s.noCoords)} ${v(s.noCoords, "launch has", "launches have")} no usable pad coordinates in the list and ${v(s.noCoords, "is", "are")} not on the map.</p>` : ""}

<h2 id="precision">How exact the times are</h2>
${scopedTable({ caption: "Launches still to come, by how exact the source says the time is", head: ["Precision (the source's name)", "Launches"], numeric: [1], rows: s.precisions.map((x) => [esc(x.name), num(x.count)]) })}
${scopedTable({ caption: "Launches still to come, by status", head: ["Status (the source's words)", "Launches"], numeric: [1], rows: s.statuses.map((x) => [esc(x.name), num(x.count)]) })}

<h2 id="passed">Launches whose planned time has passed</h2>
${s.passed.length ? `<p>These are in the list with a planned time before the data time. The list does not say whether they launched; the status is the source's.</p>
${scopedTable({ caption: "Launches in the list planned before the data time", head: ["Planned time (UTC)", "Launch", "Status"], rows: s.passed.map((l) => [launchTimeEl(l), esc(l.name), esc(l.statusName || l.status || "Not given")]) })}` : "<p>None. Our collector asks Launch Library 2 for its upcoming list with recent launches hidden, so this page has no history of past launches.</p>"}

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: Launch Library 2 by The Space Devs, its list of upcoming launches, read by our collector once an hour (the free tier allows 15 calls an hour). The data time is when our collector read the list. Our collector keeps the next ${num(s.listed)} launches${s.total === null ? "" : `; Launch Library 2 counted ${num(s.total)} upcoming launches in all`}.</li>
<li>Times are in UTC. Launch Library 2 gives each planned time with its precision; we print a month or a quarter when that is all it gives, and the time to the minute only when it gives a time to the minute or the second.</li>
<li>The ${LAUNCH_WINDOW_DAYS} day counts use the planned times in the list. The page is published only when the list was read less than ${EVENT_MAX_AGE_HOURS.launches} hours ago; otherwise the previous copy stays.</li>
<li>In "What this means", ${SAME_WITHIN_TEXT}. A finding that needs the previous build's numbers is left out when there are none.</li>
<li>The Space Devs' FAQ says the data can be used in any way and asks users not to forward it without adding value; this page adds the counts, the map and the comparisons. Whether that FAQ is a licence is not confirmed.</li>
</ul>

${faqHtml(faq)}
${sources([EVENT_SRC.ll2, EVENT_SRC.ll2faq])}`;
  return {
    file, crumbTitle: p.name, title, description, h1: "When is the next rocket launch?", kicker: "Live list",
    lead, meta: `Data as of ${timeEl(s.dataTime)}, when our collector read the list. Data from The Space Devs, Launch Library 2.`, cta: { label: "Open the live launches screen", query: "#launches" }, body,
    jsonld: [webPageLd({ file, title, description, dataTime: s.dataTime, crumbTitle: p.name })], dataTime: s.dataTime,
    ...liveScriptParts(file, { page: "launches", dataTime: s.dataTime }),
  };
}

// ------------------------------------------------------------------ natural disasters
const typeOf = (t) => GDACS_TYPES[t] || t;
const eventRows = (list) => list.map((e) => ({
  cells: [esc(typeOf(e.type)), esc(e.name), esc(e.alert), esc(e.country || "Not given"), esc(dayOnly(e.from)), esc(dayOnly(e.to)), e.current ? "Current" : "No longer current", esc(e.severity || "Not given"), e.url ? `<a href="${esc(e.url)}" rel="noopener">GDACS report</a>` : "None"],
}));
const EVENT_HEAD = ["Type", "Name (GDACS)", "Alert", "Country (GDACS)", "From", "To", "Now", "Severity (GDACS's words)", "GDACS page"];

export function disastersPage(s, { built = LIVE_FILES, coast = [], previous = null } = {}) {
  const p = page("disasters"), file = p.file, date = dateLong(s.dataTime);
  const title = `Natural disasters now: GDACS alerts, ${date}`;
  const lead = `As of ${timeEl(s.dataTime)}, the time of GDACS's newest update, the Global Disaster Alert and Coordination System lists <strong><span data-live-key="current">${num(s.current)}</span> current ${v(s.current, "event", "events")}</strong> that are not earthquakes: <span data-live-key="orange">${num(s.currentOrange)}</span> with an Orange alert, <span data-live-key="red">${num(s.currentRed)}</span> with a Red alert and the rest Green. ${num(s.recent)} more are no longer current, with an end date in the ${GDACS_RECENT_DAYS} days before.`;
  const description = `${num(s.current)} current floods, cyclones, wildfires, droughts and volcanoes in GDACS on ${date}: ${num(s.currentOrange)} Orange and ${num(s.currentRed)} Red alerts. Table and map.`;
  const findings = disasterFindings(s, previous);
  const tallyRows = (rows) => rows.map((r) => [esc(r.name), num(r.Red), num(r.Orange), num(r.Green), num(r.total)]);
  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  const tallyTable = (caption, rows) => scopedTable({ caption, head: ["Type", "Red", "Orange", "Green", "All"], numeric: [1, 2, 3, 4], rows: tallyRows(rows).concat([["All types", num(sum(rows, "Red")), num(sum(rows, "Orange")), num(sum(rows, "Green")), num(sum(rows, "total"))]]) });
  const shownN = s.points.length;
  const byTypeText = GDACS_TYPE_ORDER.map((t) => [t, s.points.filter((e) => e.type === t).length]).filter(([, n]) => n).map(([t, n]) => `${num(n)} ${n === 1 ? GDACS_TYPES[t].toLowerCase() : GDACS_PLURAL[t]}`);
  const map = shownN ? figureHtml(eventMapSvg({ coast, events: s.points, id: "map", title: `GDACS events, current or with an end date in the last ${GDACS_RECENT_DAYS} days, ${when(s.dataTime)}`,
    desc: `${num(shownN)} events: ${and(byTypeText)}. Shape shows the type and size and colour the alert level: ${num(s.currentRed + s.recentRed)} Red, ${num(s.currentOrange + s.recentOrange)} Orange.` }),
  `Every event on this page at its GDACS position, as of ${when(s.dataTime)}: the shape shows the type, the size and colour the alert level (Red largest); the tables give the same events.`) : "";
  const faq = [
    ["Which natural disasters have an Orange or Red alert now?", s.alerted.filter((e) => e.current).length ? `${and(s.alerted.filter((e) => e.current).map((e) => `${esc(e.name)} (${esc(e.alert)})`))}, among the current events GDACS lists as of ${esc(when(s.dataTime))}.` : `None of the current events GDACS lists as of ${esc(when(s.dataTime))}, earthquakes left out.`],
    ["Why are earthquakes not on this page?", `Earthquakes have their own page from the USGS feed. GDACS's ${num(s.earthquakesLeftOut)} earthquake ${v(s.earthquakesLeftOut, "event is", "events are")} left out here.`],
    ["What do Green, Orange and Red mean?", `They are GDACS's own alert levels, worked out by GDACS's models for each kind of event. Our records do not hold GDACS's definitions for floods, cyclones, wildfires, droughts and volcanoes, so this page shows the level as GDACS gives it; see <a href="${esc(EVENT_SRC.gdacsAlerts.url)}" rel="noopener">GDACS alerts</a>.`],
    ["Is this a warning service?", "No. GDACS says its information is purely indicative and should not be used for any decision making without alternate sources. For official warnings, follow the authorities where the event is."],
  ];
  const dupNote = s.duplicates.length ? `<p>${num(s.duplicates.length)} tropical ${v(s.duplicates.length, "cyclone", "cyclones")} GDACS lists ${v(s.duplicates.length, "is", "are")} also in the US National Hurricane Center's list (${and(s.duplicates.map((d) => `${esc(d.name)}, NHC's ${esc(d.nhc)}`))}) and ${v(s.duplicates.length, "is", "are")} left out here, so no storm is shown twice${built.includes("tropical-storms-now/index.html") ? `; see <a href="${href(file, "tropical-storms-now/index.html")}">active tropical storms (NHC)</a>` : ""}.</p>` : "";
  const body = `${staleNote(s, EVENT_MAX_AGE_HOURS.events)}<p class="note">Data: <a href="${esc(EVENT_SRC.gdacs.url)}" rel="noopener">GDACS, the Global Disaster Alert and Coordination System</a> of the United Nations and the European Commission. GDACS says its information is purely indicative and should not be used for any decision making without alternate sources.</p>
${findingsHtml(findings)}
${liveStatus("With JavaScript on, this page checks the live data every 5 minutes and updates the current and Orange and Red counts in place.")}
${cards([[num(s.current), "Current events, earthquakes left out"], [num(s.currentOrange), "Current events with an Orange alert"], [num(s.currentRed), "Current events with a Red alert"], [num(s.recent), `No longer current, end date in the last ${GDACS_RECENT_DAYS} days`]])}
${seeAlso(file, built, ["tropical-storms-now/index.html", "earthquakes-today/index.html", "wildfires-today/index.html"])}

<h2 id="counts">Events by type and alert level</h2>
${tallyTable("Current events by type and GDACS alert level", s.currentByType)}
${tallyTable(`Events no longer current, with an end date in the ${GDACS_RECENT_DAYS} days before the data time, by type and alert level`, s.recentByType)}

<h2 id="alerts">Events with an Orange or Red alert</h2>
${s.alerted.length ? scopedTable({ caption: "Events with an Orange or Red alert, Red first, current first", head: EVENT_HEAD, rows: eventRows(s.alerted) }) : `<p>None of the events on this page has an Orange or Red alert as of ${timeEl(s.dataTime)}.</p>`}
${dupNote}

<h2 id="map">Map of the events</h2>
${map || "<p>There is no event to map.</p>"}

<h2 id="green">Events with a Green alert, by type</h2>
${s.greenByType.length ? s.greenByType.map((g) => `<h3 id="green-${g.type.toLowerCase()}">${esc(cap(GDACS_PLURAL[g.type]))}: ${num(g.events.length)}</h3>\n${scopedTable({ caption: `${GDACS_TYPES[g.type]} events with a Green alert`, head: EVENT_HEAD, rows: eventRows(g.events) })}`).join("\n") : "<p>No event on this page has a Green alert.</p>"}
${s.noCountry ? `<p>GDACS gives no country for ${num(s.noCountry)} of these ${v(s.noCountry, "event", "events")} (for example a storm at sea); the table says Not given.</p>` : ""}

<h2 id="levels">What the alert levels mean</h2>
<p>Green, Orange and Red are GDACS's alert levels, which GDACS works out with its own models for each kind of event. Our records hold GDACS's definition only for earthquakes, which are not on this page, so we show each level as GDACS gives it and do not explain it further. GDACS's own pages explain them: <a href="${esc(EVENT_SRC.gdacsAlerts.url)}" rel="noopener">GDACS alerts</a>. For a tropical cyclone, GDACS gives one wind figure for the whole storm, so its strength now can be lower.</p>

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: GDACS's event list (floods, tropical cyclones, wildfires, droughts, volcanoes and earthquakes), read by our collector every 15 minutes. The data time is the time of GDACS's newest change to any event in the list.</li>
<li>Our collector keeps events that GDACS marks current, or whose end date is in the last ${GDACS_RECENT_DAYS} days, Red and Orange first, up to ${num(GDACS_MAX_EVENTS)} events. This list has ${num(s.listed)}${s.atCap ? `, the most it keeps, so some older Green events can be missing` : ""}. Earthquakes (${num(s.earthquakesLeftOut)}) are left out here.${s.olderLeftOut ? ` ${num(s.olderLeftOut)} ${v(s.olderLeftOut, "event", "events")} no longer current with an end date more than ${GDACS_RECENT_DAYS} days before the data time ${v(s.olderLeftOut, "is", "are")} left out too.` : ""}</li>
<li>A tropical cyclone that the US National Hurricane Center also lists is left out, matched by name and position with the rule the live app uses${s.stormsNote ? ` (${esc(s.stormsNote)})` : ` (NHC's list is used when it is less than ${STORMS_FOR_DEDUPE_MAX_HOURS} hours old)`}.</li>
<li>Names, countries and severity texts are GDACS's own words. The page is published only when the data time is less than ${EVENT_MAX_AGE_HOURS.events} hours old; otherwise the previous copy stays.</li>
<li>In "What this means", ${SAME_WITHIN_TEXT}. A finding that needs the previous build's numbers is left out when there are none.</li>
<li>GDACS's licence, attribution and rate limits are not stated on the pages we read, so they are not confirmed; we credit and link GDACS.</li>
</ul>

${faqHtml(faq)}
${sources([EVENT_SRC.gdacs, EVENT_SRC.gdacsAlerts, EVENT_SRC.gdacsTerms])}`;
  return {
    file, crumbTitle: p.name, title, description, h1: "Which natural disasters are happening now?", kicker: "Live list",
    lead, meta: `Data as of ${timeEl(s.dataTime)}, the time of GDACS's newest update. Data from GDACS.`, cta: { label: "See them on the live globe", query: "" }, body,
    jsonld: [webPageLd({ file, title, description, dataTime: s.dataTime, crumbTitle: p.name })], dataTime: s.dataTime,
    ...liveScriptParts(file, { page: "disasters", dataTime: s.dataTime }),
  };
}

// ------------------------------------------------------------------ the Starlink tracker
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key) => { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

export function starlinkPage(s, { built = LIVE_FILES, coast = [], previous = null } = {}) {
  const p = page("starlink"), file = p.file, date = dateLong(s.dataTime);
  const title = `Starlink tracker: active satellites, ${date}`;
  const share = percentText(s.starlink, s.active);
  const lead = `As of ${timeEl(s.dataTime)}, the time of the satellite data, CelesTrak's active list holds <strong>${num(s.starlink)} active Starlink satellites</strong>, ${share} percent of the ${num(s.active)} active satellites in our count. A Starlink satellite here is one whose catalogue name contains STARLINK.`;
  const description = `${num(s.starlink)} active Starlink satellites on ${date}, ${share} percent of all active. By altitude band, inclination and launch month, with a map.`;
  const findings = starlinkFindings(s, previous);
  const occupied = s.bands.filter((b) => b.count);
  const monthRows = s.months.map((m, i) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], sub: i === 0 || m.month.endsWith("-01") ? m.month.slice(0, 4) : "", value: m.count }));
  const incl = s.inclinations;
  const dots = uniqueDots(s.points);
  const faq = [
    ["How many Starlink satellites are in orbit?", `${num(s.starlink)} active ones as of ${esc(when(s.dataTime))}, on CelesTrak's active list and our definition of active, which is ${share} percent of all active satellites in our count.`],
    ["How high do Starlink satellites fly?", `The busiest ${ALT_BAND_KM} km band of mean altitude is ${num(s.topBands[0].from)} to ${num(s.topBands[0].to)} km, with ${num(s.topBands[0].count)} satellites. The fleet spans ${num(s.lowest)} to ${num(s.highest)} km, counting satellites still being raised or lowered.`],
    ["How many Starlink satellites were launched recently?", `${num(s.last30)} of the active ones were launched in the 30 days before the data time.`],
    ["Does this page track a single satellite?", "No. It counts the fleet. The live globe shows each satellite's position and its pass times over your place."],
  ];
  const body = `${staleNote(s, EVENT_MAX_AGE_HOURS.satellites)}<p class="note">Data: <a href="${esc(EVENT_SRC.celestrak.url)}" rel="noopener">CelesTrak</a>, its active list and satellite catalogue, read by our collector. The counts, bands, groups and the map are ours.</p>
${findingsHtml(findings)}
${cards([[num(s.starlink), "Active Starlink satellites"], [`${share} percent`, "Share of all active satellites in our count"], [num(s.last30), "Launched in the 30 days before the data time and still active"]])}
${seeAlso(file, built, [SATCOUNT_FILE])}

<h2 id="altitude">How high are the Starlink satellites?</h2>
<p>Each satellite's mean altitude is worked out from its mean motion: the size of the orbit, less the Earth's equatorial radius. The chart groups them into bands of ${ALT_BAND_KM} km, from ${num(s.lowest)} to ${num(s.highest)} km; ${num(s.occupiedBands)} bands hold at least one satellite.</p>
${figureHtml(altitudeHistogramSvg({ id: "chart-altitude", title: `Active Starlink satellites by ${ALT_BAND_KM} km band of mean altitude, ${when(s.dataTime)}`, desc: `${num(s.starlink)} satellites from ${num(s.lowest)} to ${num(s.highest)} km. Busiest: ${s.topBands.map((b) => `${b.from} to ${b.to} km, ${b.count}`).join("; ")}.`, rows: s.bands }),
  `Active Starlink satellites by ${ALT_BAND_KM} km band of mean altitude, as of ${when(s.dataTime)}; the table below gives every band that holds a satellite.`)}
${scopedTable({ caption: `Active Starlink satellites by ${ALT_BAND_KM} km band of mean altitude`, head: ["Mean altitude (km)", "Satellites", "Share (percent)"], numeric: [1, 2], rows: occupied.map((b) => ({ cells: [`${num(b.from)} to ${num(b.to)}`, num(b.count), percentText(b.count, s.starlink)] })) })}

<h2 id="inclination">At which inclinations?</h2>
<p>The inclination is the tilt of the orbit to the equator, from the satellite's own orbital elements, rounded to the nearest whole degree.</p>
${figureHtml(barChartSvg({ id: "chart-inclination", title: `Active Starlink satellites by inclination, ${when(s.dataTime)}`, desc: `${incl.map((x) => `${x.deg} degrees ${x.count}`).join(", ")}.`, rows: incl.map((x) => ({ label: `${x.deg} degrees`, value: x.count })) }), `Active Starlink satellites by orbit inclination, rounded to whole degrees, as of ${when(s.dataTime)}; the table below gives the numbers.`)}
${scopedTable({ caption: "Active Starlink satellites by inclination", head: ["Inclination (degrees, rounded)", "Satellites", "Share (percent)"], numeric: [0, 1, 2], rows: incl.map((x) => [num(x.deg), num(x.count), percentText(x.count, s.starlink)]) })}

<h2 id="launches">When were they launched?</h2>
<p>The chart counts today's active Starlink satellites by the month they were launched, for the ${MONTHS_SHOWN} months to the data time. It is not a count of all Starlink satellites launched in each month, because those since retired are not in it. The last month is not over.${s.noLaunchDate ? ` ${num(s.noLaunchDate)} ${v(s.noLaunchDate, "satellite has", "satellites have")} no launch date in the catalogue.` : ""}</p>
${figureHtml(columnChartSvg({ id: "chart-months", title: `Active Starlink satellites by launch month, ${monthLabel(s.months[0].month)} to ${monthLabel(s.months.at(-1).month)}`, desc: `${num(s.monthsTotal)} of the ${num(s.starlink)} active Starlink satellites were launched in these ${MONTHS_SHOWN} months. Each value is printed above its column.`, rows: monthRows }),
  `Active Starlink satellites by launch month, ${monthLabel(s.months[0].month)} to ${monthLabel(s.months.at(-1).month)}, as of ${when(s.dataTime)}; the table below gives the numbers.`)}
${scopedTable({ caption: "Active Starlink satellites by launch month", head: ["Launch month", "Satellites still active"], numeric: [1], rows: s.months.map((m) => ({ cells: [esc(monthLabel(m.month)), num(m.count)] })) })}
${scopedTable({ caption: "The launch days with the most active Starlink satellites", head: ["Launch day", "Satellites still active"], numeric: [1], rows: s.topDays.map((d) => [esc(dateLong(`${d.day}T00:00:00Z`)), num(d.count)]) })}
<p>A launch day can hold more than one launch. Ties are listed newest first.</p>

<h2 id="where">Where is the fleet?</h2>
${figureHtml(fleetMapSvg({ coast, points: s.points, id: "map", title: `Active Starlink satellites over the Earth, ${when(s.dataTime)}`, desc: `${num(dots)} dots for ${num(s.points.length)} satellites at the data time.` }),
  `The point on the ground below each active Starlink satellite at ${when(s.dataTime)}, rounded to 0.1 degree (${num(dots)} dots for ${num(s.points.length)} satellites).`)}
<p>The positions are worked out from each satellite's orbital elements with the simple orbit model the live globe uses for its swarm (two-body motion with the main J2 drift), not with SGP4, so they are approximate. The map does not move after the page is built; <a href="${href(file, "index.html")}">the live globe</a> shows the fleet moving.</p>

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: CelesTrak's current orbital element sets for its active list, with each object's type, status and launch date from CelesTrak's satellite catalogue, read by our collector (CelesTrak's data is updated about every 2 hours, and our collector pauses as its usage policy asks). The data time is the time of that satellite data.</li>
<li>A Starlink satellite is one whose catalogue name contains STARLINK. An active satellite is a catalogue satellite with a status of Operational, Partially operational, Backup or standby, Spare or Extended mission; the count is the same as on the satellite count page.</li>
<li>Mean altitude: from the mean motion, as for the satellite count page's orbit groups (low Earth orbit is below ${num(ORBIT_BOUNDS.lowBelow)} km there). Bands of ${ALT_BAND_KM} km and inclinations rounded to whole degrees are our choices; we do not say which shells SpaceX plans.</li>
<li>The page is published only when the satellite data is less than ${EVENT_MAX_AGE_HOURS.satellites} hours old, and only with at least ${num(STARLINK_MIN)} active Starlink satellites (a guard against a broken feed); otherwise the previous copy stays.</li>
<li>In "What this means", ${SAME_WITHIN_TEXT}. The launch pace compares a 30 day period with calendar months, counting only satellites still active. A finding that needs the previous build's numbers is left out when there are none.</li>
<li>CelesTrak's usage policy covers how often data may be requested; it says nothing about publishing counts made from it, so that is not confirmed.</li>
</ul>

${faqHtml(faq)}
${sources([EVENT_SRC.celestrak, EVENT_SRC.satcat])}`;
  return {
    file, crumbTitle: p.name, title, description, h1: "How many Starlink satellites are in orbit?", kicker: "Live count",
    lead, meta: `Data as of ${timeEl(s.dataTime)}, the time of the satellite data. Satellite data from CelesTrak.`, cta: { label: "See them on the live globe", query: "" }, body,
    jsonld: [webPageLd({ file, title, description, dataTime: s.dataTime, crumbTitle: p.name })], dataTime: s.dataTime,
    ...liveScriptParts(file, { page: null, dataTime: s.dataTime }),
  };
}

// ------------------------------------------------------------------ hub rows for /right-now/ (the shape of hubRows in site/pages-hazard.mjs)
const row = (key, label, s, value, said, timeText, extra) => {
  const p = page(key);
  return { key, file: p.file, label, value: s ? value : null, said: s ? said : null, dataTime: s ? s.dataTime : null, guide: p.guide, stale: !!(s && s.stale), reason: null, timeText: s ? timeText : "", ...extra };
};
export const EVENT_HUB_ROWS = {
  starlink: (s, { missing = {} } = {}) => ({ ...row("starlink", "Starlink tracker", s, s && `${num(s.starlink)} active Starlink satellites`, s && `${num(s.starlink)} active Starlink satellites`, s && `${dayHour(s.dataTime)} (satellite data)`,
    { limit: `satellite data for the Starlink page ${EVENT_MAX_AGE_HOURS.satellites} hours`, timeNote: "", source: EVENT_SRC.celestrak, notableRule: null, notable: null }), reason: s ? null : missing.starlink || "not available in this build" }),
  disasters: (s, { missing = {} } = {}) => ({ ...row("disasters", "Natural disasters now", s, s && `${num(s.currentOrange)} Orange and ${num(s.currentRed)} Red alerts among ${num(s.current)} current GDACS events`, s && `${num(s.currentOrange + s.currentRed)} current GDACS ${v(s.currentOrange + s.currentRed, "event", "events")} with an Orange or Red alert`,
    s && `${dayHour(s.dataTime)} (GDACS's newest update)`,
    { limit: `GDACS events ${EVENT_MAX_AGE_HOURS.events} hours`, timeNote: "For GDACS events it is the time of GDACS's newest update.", source: EVENT_SRC.gdacs, notableRule: "a current GDACS event with an Orange or Red alert",
      notable: s && s.currentOrange + s.currentRed ? `GDACS lists ${num(s.currentOrange + s.currentRed)} current ${v(s.currentOrange + s.currentRed, "event", "events")} with an Orange or Red alert (earthquakes left out): ${and(s.alerted.filter((e) => e.current).slice(0, 3).map((e) => `${e.name}, ${e.alert}`))}.` : null }), reason: s ? null : missing.disasters || "not available in this build" }),
  launches: (s, { missing = {} } = {}) => ({ ...row("launches", "Rocket launches", s, s && (s.next ? `Next: ${s.next.name}, ${s.next.when}` : "No launch after the list's time"), s && (s.next ? `a next rocket launch planned for ${s.next.when} (${s.next.name})` : "no rocket launch planned after the list's time"),
    s && `${dayHour(s.dataTime)} (when our collector read the list)`,
    { limit: `rocket launches ${EVENT_MAX_AGE_HOURS.launches} hours`, timeNote: "For rocket launches it is when our collector read the list.", source: EVENT_SRC.ll2, notableRule: "a launch planned to the minute or second in the 24 hours after the launch list's time",
      notable: s && s.in24exact.filter((l) => l.precision === "SEC" || l.precision === "MIN").length ? `A launch is planned in the 24 hours after the launch list's time: ${s.in24exact.filter((l) => l.precision === "SEC" || l.precision === "MIN")[0].name}, ${s.in24exact.filter((l) => l.precision === "SEC" || l.precision === "MIN")[0].when}.` : null }), reason: s ? null : missing.launches || "not available in this build" }),
};

export const EVENT_PAGE_FUNCTIONS = { starlink: starlinkPage, disasters: disastersPage, launches: launchesPage };
