// The five live hazard pages and the /right-now/ hub. Pure: each page function takes a summary from site/hazard.mjs and returns a page
// object for renderPage. Every number comes from the summary, so the lead, the description, the tables, the FAQ and the structured data
// cannot disagree. The only typed text is method, caveats and definitions, each traced in docs/hazard-pages-sources.md to the source
// records in docs/hazard-sources.md and docs/feature-sources.md (or to the collector's code). Nothing here forecasts or advises.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";
import { barChartSvg, columnChartSvg, num, dateLong, timeUtc } from "./pages-satcount.mjs";
import { worldMapSvg, regionMapSvg, uniqueDots } from "./svgmap.mjs";
import { HAZARD_PAGES, RIGHT_NOW_FILE, MAX_AGE_HOURS, TERMS_VERIFIED, GRID_THRESHOLD, KP_G1, CAD_MAX_AU, CAD_DAYS, PLACE_MAX_KM, hazardPage } from "./hazard.mjs";
import { LIVE_FILES, SATCOUNT_FILE } from "./livepages.mjs";
import { HUB_FILE, COUNTRY_PAGES } from "./satcountry.mjs";

// ------------------------------------------------------------------ sources (addresses as recorded in docs/ and pipeline/config.py)
export const SRC = {
  usgsFeed: { title: "USGS earthquake GeoJSON summary feeds", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", note: "The magnitude 2.5 and above, past 7 days feed this page reads" },
  usgsCredits: { title: "USGS copyrights and credits", url: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits", note: "USGS-authored data is in the US public domain; credit is requested" },
  swpcData: { title: "NOAA SWPC data access", url: "https://www.spaceweather.gov/content/data-access", note: "Where the Kp and solar wind files are listed" },
  swpcAurora: { title: "NOAA SWPC aurora 30 minute forecast", url: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast", note: "The forecast grid (OVATION)" },
  noaaScales: { title: "NOAA Space Weather Scales", url: "https://www.swpc.noaa.gov/noaa-scales-explanation", note: "The G1 to G5 table, with where aurora has been seen" },
  auroraTutorial: { title: "NOAA SWPC aurora tutorial", url: "https://www.spaceweather.gov/content/aurora-tutorial", note: "How the solar wind and the Kp index relate to aurora" },
  nws: { title: "NWS disclaimer and public domain statement", url: "https://www.weather.gov/disclaimer", note: "The terms for using NOAA and NWS information" },
  jplCad: { title: "NASA JPL Close-Approach Data API", url: "https://ssd-api.jpl.nasa.gov/doc/cad.html", note: "The list of close approaches and its default query" },
  nhc: { title: "NOAA National Hurricane Center", url: "https://www.nhc.noaa.gov/", note: "Official advisories, forecast tracks and cones" },
  nhcGis: { title: "NHC GIS data and feeds", url: "https://www.nhc.noaa.gov/gis/", note: "The list of active storms this page reads" },
  sshws: { title: "NHC Saffir-Simpson Hurricane Wind Scale", url: "https://www.nhc.noaa.gov/aboutsshws.php", note: "The category table" },
  gdacs: { title: "GDACS", url: "https://www.gdacs.org/About/termofuse.aspx", note: "GDACS terms of use, for the tropical cyclones it lists" },
  lance: { title: "NASA LANCE: FIRMS active fire data", url: "https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data", note: "Latency, terms and the acknowledgement text" },
  firms: { title: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/", note: "The 24 hour global VIIRS fire files" },
  geonames: { title: "GeoNames", url: "https://download.geonames.org/export/dump/readme.txt", note: "The place list used for the nearest place (cities15000, CC BY 4.0)" },
  celestrak: { title: "CelesTrak", url: "https://celestrak.org/NORAD/elements/", note: "The satellite data behind the satellite count" },
};
const LANCE_ACK = "We acknowledge the use of data and/or imagery from NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance), part of NASA's Earth Science Data and Information System (ESDIS).";

// ------------------------------------------------------------------ small formatting helpers (all deterministic, all UTC)
const when = (iso) => `${dateLong(iso)}, ${timeUtc(iso)}`;
const timeEl = (iso) => `<time datetime="${esc(iso)}">${esc(when(iso))}</time>`;
const dayHour = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));
const hhmm = (iso) => timeUtc(iso).replace(" UTC", "");
const dayShort = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const dec = (n, d) => n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const v = (n, one, many) => (n === 1 ? one : many);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const latText = (lat) => `${num(Math.abs(lat))}° ${lat >= 0 ? "N" : "S"}`;
const lonText = (lon) => `${num(Math.abs(lon))}° ${lon >= 0 ? "E" : "W"}`;
const pos = (lat, lon) => `${latText(lat)}, ${lonText(lon)}`;
// a country name for a GeoNames country code, from the runtime's own region names; the code itself if there is none
const regionNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const country = (cc) => { try { return (regionNames && regionNames.of(cc)) || cc; } catch { return cc; } };

const webPage = (name, description, file, dataTime) => ({ "@context": "https://schema.org", "@type": "WebPage", name, description, url: `${SITE.url}/${urlPath(file)}`, dateModified: dataTime });
// Dataset markup (design section 2c) only when every feed whose data the page prints has its terms recorded as verified. No licence and no
// download are claimed. description is the page's lead as plain text, so every number in it is visible on the page.
export function datasetLd({ feeds, name, description, file, dataTime, temporal, spatial, keywords, basedOn }) {
  if (!feeds.every((f) => TERMS_VERIFIED[f] === true)) return null;
  return {
    "@context": "https://schema.org", "@type": "Dataset", name, description, url: `${SITE.url}/${urlPath(file)}`,
    creator: { "@type": "Organization", name: SITE.name, url: `${SITE.url}/` },
    isBasedOn: { "@type": "CreativeWork", name: basedOn.title, url: basedOn.url },
    dateModified: dataTime, temporalCoverage: temporal, spatialCoverage: spatial, keywords, isAccessibleForFree: true,
  };
}

const metaLine = (dataTime, source) => `Data as of ${timeEl(dataTime)}, the time given in the data itself. Data from ${esc(source)}.`;
// The note a deploy-time copy carries when its bundled data is older than the page's live limit (site/build.mjs allows that copy only).
const staleNote = (s, feed) => (s.stale ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, which is older than the ${MAX_AGE_HOURS[feed]} hours this page allows for live data. The live copy replaces it after the next data collection.</p>\n` : "");
// Links to the matching guide and to the other live pages that exist in this build (built: their files), so no link points at a missing page.
function seeAlso(file, guide, built) {
  const names = new Map([[RIGHT_NOW_FILE, "all live numbers right now"], [SATCOUNT_FILE, "satellite count"], ...HAZARD_PAGES.map((p) => [p.file, p.name.toLowerCase()])]);
  const live = LIVE_FILES.filter((f) => f !== file && names.has(f) && built.includes(f)).map((f) => `<a href="${href(file, f)}">${esc(names.get(f))}</a>`);
  return `<p>See also: <a href="${href(file, guide)}">our guide to reading this data</a>${live.length ? `; live pages: ${live.join(", ")}` : ""}.</p>`;
}
const faqHtml = (faq) => `<h2 id="faq">Questions</h2>\n${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}`;
const cards = (list) => `<ul class="grid">\n${list.map(([b, s]) => `<li><div class="card"><b>${b}</b><span>${s}</span></div></li>`).join("\n")}\n</ul>`;

// ------------------------------------------------------------------ earthquakes
export function quakesPage(s, { built = LIVE_FILES, coast = [] } = {}) {
  const p = hazardPage("quakes"), file = p.file, date = dateLong(s.dataTime);
  const n = s.count, L = s.largest;
  const title = `Earthquakes in the last 24 hours: ${date}`;
  const leadHtml = `As of ${esc(when(s.dataTime))}, USGS's feed of earthquakes of magnitude 2.5 and above lists <strong>${num(n)} ${v(n, "earthquake", "earthquakes")}</strong> in the previous 24 hours.` +
    (L ? ` The largest was magnitude ${num(L.mag)}, ${esc(L.place || "with no place given")}, at ${esc(timeUtc(L.time))} on ${esc(dateLong(L.time))}.` : "");
  const description = (L ? `${num(n)} earthquakes in USGS's magnitude 2.5 and above feed in the 24 hours to ${date}; the largest magnitude ${num(L.mag)}. Hourly counts, map, top ten.`
    : `No earthquakes of magnitude 2.5 and above in the USGS feed in the 24 hours to ${date}. Hourly counts and method, from USGS data.`);
  const bandRows = (s.below25 ? [[`Under 2.5 (as listed in this feed; lowest ${num(s.minMag)})`, num(s.below25)]] : [])
    .concat(s.bands.map((b) => [b.to === null ? `${num(b.from)} and above` : `${num(b.from)} to under ${num(b.to)}`, num(b.count)]))
    .concat([["All in the 24 hours", num(n)]]);
  const hourRows = s.hourly.map((h) => ({ label: hhmm(h.start), value: h.count }));
  const busiest = s.hourly.reduce((a, h) => (h.count > a.count ? h : a), s.hourly[0]);
  const topLabel = s.places[0], tied = s.places.filter((x) => topLabel && x.count === topLabel.count);
  const mapDesc = `${num(uniqueDots(s.points))} dots for ${num(s.points.length)} earthquakes in the 24 hours to ${when(s.dataTime)}.`;
  const faq = [
    ["How many earthquakes of magnitude 4.5 or more were there in the last 24 hours?", `${num(s.ge45)} in the 24 hours to ${esc(when(s.dataTime))}${s.ge45 ? `, ${s.ge6 ? `${num(s.ge6)} of ${v(s.ge45, "it", "them")} magnitude 6 or more` : `none of ${v(s.ge45, "it", "them")} magnitude 6 or more`}` : ""}.`],
    ["What was the largest earthquake in the last 24 hours?", L ? `Magnitude ${num(L.mag)}, ${esc(L.place || "with no place given")}, at ${esc(when(L.time))}, at a depth of ${num(L.depth)} km.` : "There was none in the feed."],
    ["Which USGS place label came up most often?", topLabel ? `${and(tied.map((x) => esc(x.label)))}, with ${num(topLabel.count)} ${v(topLabel.count, "earthquake", "earthquakes")}${tied.length > 1 ? " each" : ""}. The label is the text after the last comma of the place USGS gives.` : "None: the feed has no earthquakes in the 24 hours."],
    ["Does this page predict earthquakes?", "No. It counts earthquakes USGS has already recorded, as its feed lists them."],
  ];
  const body = `${staleNote(s, "quakes")}
${cards([[num(n), "Earthquakes in 24 hours in USGS's magnitude 2.5 and above feed"], [num(s.ge45), "Of magnitude 4.5 or more"], [num(s.ge6), "Of magnitude 6 or more"], [L ? `Magnitude ${num(L.mag)}` : "None", "The largest"]])}
${seeAlso(file, p.guide, built)}

<h2 id="answer">Earthquakes in the last 24 hours, by magnitude</h2>
<p>The 24 hours are the 24 hours before ${esc(when(s.dataTime))}, the time USGS generated the feed. The bands at 2.5 and 4.5 are the lower edges of USGS's own summary feeds; the band at 6 is ours.</p>
${table({ caption: "Earthquakes by magnitude band", head: ["Magnitude", "Earthquakes"], numeric: [1], rows: bandRows })}

<h2 id="hours">When they happened</h2>
<p>${n ? `The busiest hour was the one from ${esc(hhmm(busiest.start))} UTC, with ${num(busiest.count)}.` : "No hour had an earthquake in the feed."} Each column is one hour, labelled with the UTC time it starts, counted back from the feed's time.</p>
${columnChartSvg({ id: "chart-hours", title: "Earthquakes per hour in the last 24 hours", desc: `Hourly counts from ${when(s.windowStart)} to ${when(s.dataTime)}, ${num(n)} in all. The table below gives the numbers.`, rows: hourRows })}
${table({ caption: "Earthquakes per hour", head: ["Hour from (UTC)", "Earthquakes"], numeric: [1], rows: s.hourly.map((h) => [esc(dayHour(h.start)), num(h.count)]) })}

<h2 id="largest">The largest earthquakes</h2>
${s.top.length ? table({ caption: "The largest earthquakes in the last 24 hours", head: ["Magnitude", "Place (as USGS gives it)", "Time (UTC)", "Depth (km)", "Status", "USGS page"], numeric: [0, 3],
    rows: s.top.map((e) => [num(e.mag), esc(e.place || "No place given"), esc(dayHour(e.time)), num(e.depth), esc(e.status || "Not given"), /^https:\/\/earthquake\.usgs\.gov\//.test(e.url) ? `<a href="${esc(e.url)}" rel="noopener">Event page</a>` : "None"]) }) : "<p>The feed has no earthquakes in the 24 hours.</p>"}
${s.deepest && s.deepest.depth > 0 ? `<p>The deepest was ${num(s.deepest.depth)} km down: magnitude ${num(s.deepest.mag)}, ${esc(s.deepest.place || "with no place given")}.</p>` : ""}

<h2 id="where">Where they were</h2>
${worldMapSvg({ coast, points: s.points, id: "map", title: `Earthquake epicentres, 24 hours to ${when(s.dataTime)}`, desc: mapDesc })}
<p>Each dot is an epicentre from the feed, rounded to 0.1 degree; earthquakes closer than that share a dot.</p>
${s.places.length ? `${barChartSvg({ id: "chart-places", title: "Most frequent USGS place labels", desc: `The ${s.places.length} most frequent of ${s.placeLabels} place labels in the 24 hours. ${topLabel.label} is first with ${topLabel.count}.`, rows: s.places.map((x) => ({ label: x.label, value: x.count })) })}
${table({ caption: "Most frequent USGS place labels", head: ["Place label", "Earthquakes"], numeric: [1], rows: s.places.map((x) => [esc(x.label), num(x.count)]) })}
<p>A place label is the text after the last comma of the place USGS gives (for "39 km WSW of Tambolaka, Indonesia" it is Indonesia), or the whole place when it has no comma. Labels are shown exactly as USGS writes them; we do not group them into countries or regions.</p>` : ""}

<h2 id="status">Automatic or reviewed</h2>
<p>The feed gives each earthquake a status: ${num(s.automatic)} ${v(s.automatic, "is", "are")} marked automatic and ${num(s.reviewed)} reviewed${n - s.automatic - s.reviewed ? `, and ${num(n - s.automatic - s.reviewed)} ${v(n - s.automatic - s.reviewed, "has", "have")} another or no status` : ""}. We show the status as the feed gives it.</p>

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: the USGS summary feed of earthquakes of magnitude 2.5 and above for the past 7 days, which USGS describes as updated every minute. Our collector reads it every 10 minutes; this page counts the ${num(n)} of the feed's ${num(s.feedEvents)} events that fall in the 24 hours before the feed's own time.</li>
<li>Counts depend on the feed's magnitude floor: smaller earthquakes are not in this feed.${s.below25 ? ` ${num(s.below25)} ${v(s.below25, "event is", "events are")} listed in it with a magnitude just under 2.5, and ${v(s.below25, "is", "are")} counted as the feed gives ${v(s.below25, "it", "them")}.` : ""}</li>
<li>The page is published only when the feed is less than ${MAX_AGE_HOURS.quakes} hours old; otherwise the previous copy stays.</li>
</ul>

${faqHtml(faq)}
${sources([SRC.usgsFeed, SRC.usgsCredits])}`;
  const lead = leadHtml;
  const dataset = datasetLd({ feeds: p.feeds, name: `Earthquakes of magnitude 2.5 and above in the 24 hours to ${when(s.dataTime)}`, description: plain(lead), file, dataTime: s.dataTime,
    temporal: `${s.windowStart}/${s.dataTime}`, spatial: "Earth", keywords: ["earthquakes", "USGS", "magnitude", "last 24 hours"], basedOn: SRC.usgsFeed });
  return {
    file, crumbTitle: p.name, title, description, h1: "How many earthquakes were there in the last 24 hours?", kicker: "Live count",
    lead, meta: metaLine(s.dataTime, "the U.S. Geological Survey"), cta: { label: "See them on the live globe", query: "" }, body,
    jsonld: [webPage(title, description, file, s.dataTime), ...(dataset ? [dataset] : [])],
  };
}

// ------------------------------------------------------------------ aurora: Kp, solar wind and the aurora grid
const KP_SOURCE = "NOAA's Space Weather Prediction Center";
export function auroraPage(s, { built = LIVE_FILES, coast = [] } = {}) {
  const p = hazardPage("aurora"), file = p.file, k = s.kp, w = s.wind, g = s.grid, date = dateLong(s.dataTime);  // date: the page's data time
  const kpText = (x) => num(x);
  const title = `Aurora tonight: Kp index and solar wind, ${date}`;
  const bz = w && w.fields.bz, speed = w && w.fields.speed;
  // one rounding for each measure everywhere on the page: speed in whole km/s, the rest to one decimal
  const wf = (key, x) => dec(x, key === "speed" ? 0 : 1);
  const spacecraft = w && w.spacecraft.length ? and(w.spacecraft.map(esc)) : "NOAA's active spacecraft";
  const lead = `As of ${esc(when(s.dataTime))}, the latest planetary Kp index in NOAA's data is <strong>Kp ${kpText(k.latest.kp)}</strong>, for the three-hour period tagged ${esc(hhmm(k.latest.t))} UTC on ${esc(dateLong(k.latest.t))}.` +
    (k.missingLatest ? ` The newest period in the data, tagged ${esc(hhmm(k.dataTime))} UTC, has no value yet.` : "") +
    (speed ? ` The solar wind measured by ${spacecraft} was ${wf("speed", speed.now)} km/s at ${esc(timeUtc(speed.at))}${bz ? `, with Bz ${wf("bz", bz.now)} nT (${bz.now < 0 ? "pointing south" : bz.now > 0 ? "pointing north" : "zero"})` : ""}.` : "");
  const spanH = Math.round((Date.parse(k.rows[k.rows.length - 1].t) - Date.parse(k.first)) / 3600e3) + 3;
  const description = `Kp ${kpText(k.latest.kp)} for the period tagged ${hhmm(k.latest.t)} UTC on ${dateLong(k.latest.t)}; highest Kp ${kpText(k.max.kp)} in ${spanH} hours.${speed ? ` Solar wind ${wf("speed", speed.now)} km/s.` : ""} NOAA data, no forecast of ours.`;
  const kpRowsChart = k.rows.map((r, i) => ({ label: hhmm(r.t), sub: i === 0 || hhmm(r.t) === "00:00" ? dayShort(r.t) : "", value: r.kp === null ? 0 : r.kp }));
  const field = (key, label, unit) => { const f = w.fields[key]; return f ? [label, `${wf(key, f.now)} ${unit}`, esc(dayHour(f.at)), `${wf(key, f.min)} to ${wf(key, f.max)} ${unit}`] : [label, "Not in the data", "", ""]; };
  const windHtml = w ? `
<p>The values are five-minute averages that our collector makes from NOAA's one-minute data, using only the rows NOAA marks as from its active spacecraft (${spacecraft}). The range is over the data our collector keeps, from ${timeEl(w.from)} to ${timeEl(w.to)}.</p>
${table({ caption: "Solar wind and magnetic field", head: ["Measure", "Latest", "At (UTC)", "Range in the data"], rows: [field("speed", "Solar wind speed", "km/s"), field("density", "Proton density", "per cm³"), field("bt", "Total field Bt", "nT"), field("bz", "North-south field Bz", "nT")] })}
<p>A negative Bz means the field points south. NOAA's aurora tutorial says that as the solar wind increases in speed and the interplanetary magnetic field turns southward, geomagnetic activity increases and the aurora becomes brighter, more active, and moves further from the poles.${bz ? ` In this data the latest Bz is ${bz.now < 0 ? "negative" : "not negative"}${bz.min < 0 ? `, and the lowest in the range is ${wf("bz", bz.min)} nT` : ", and it is not negative anywhere in the range"}.` : ""}</p>` : `<p>Not shown: the solar wind data is ${esc(s.windReason)}.</p>`;
  const hemi = (h, side) => [side, num(h.max), h.edge === null ? `No grid value of ${GRID_THRESHOLD} or more` : `${h.edge}° ${side === "Northern hemisphere" ? "N" : "S"}`];
  const gridPoints = g ? g.points : [];
  const gridHtml = g ? `
<p>NOAA's aurora forecast grid (the OVATION model, which NOAA describes as a 30 to 90 minute forecast) for ${timeEl(g.forecastTime)}, from observations at ${timeEl(g.dataTime)}. It holds a value from 0 to 100 for each degree of latitude and longitude. NOAA says an estimate of aurora viewing probability can be derived by assuming a linear relationship to this value; we show the values as NOAA gives them and do not call them a probability. The threshold of ${GRID_THRESHOLD} is our choice.</p>
${table({ caption: "Aurora forecast grid by hemisphere", head: ["Hemisphere", "Highest grid value", `Nearest the equator with a value of ${GRID_THRESHOLD} or more`], rows: [hemi(g.north, "Northern hemisphere"), hemi(g.south, "Southern hemisphere")] })}
${gridPoints.length ? `${worldMapSvg({ coast, points: gridPoints, id: "map", title: `Edge of NOAA's aurora grid at ${GRID_THRESHOLD} or more, ${when(g.forecastTime)}`, desc: `For each degree of longitude, the grid point nearest the equator with a value of ${GRID_THRESHOLD} or more: ${num(gridPoints.length)} points.` })}
<p>The map marks, for each degree of longitude in each hemisphere, the grid point nearest the equator where the value is ${GRID_THRESHOLD} or more.</p>` : ""}` : `<p>Not shown: the aurora grid is ${esc(s.gridReason)}.</p>`;
  const alerts = w ? w.alerts.slice(0, 10) : [];
  const faq = [
    ["What is the Kp index right now?", `The latest value in NOAA's data is Kp ${kpText(k.latest.kp)}, for the three-hour period tagged ${esc(hhmm(k.latest.t))} UTC on ${esc(dateLong(k.latest.t))}.`],
    [`Did Kp reach ${KP_G1} in the last ${spanH} hours?`, k.atLeastG1 ? `Yes, in ${num(k.atLeastG1)} of the ${num(k.rows.length - k.missing)} periods with a value; the highest was Kp ${kpText(k.max.kp)}, tagged ${esc(dayHour(k.max.t))} UTC. NOAA's G1 level starts at Kp ${KP_G1}.` : `No. The highest was Kp ${kpText(k.max.kp)}, tagged ${esc(dayHour(k.max.t))} UTC. NOAA's G1 level starts at Kp ${KP_G1}.`],
    bz ? ["Which way is the solar wind's magnetic field pointing?", `Its latest Bz value is ${wf("bz", bz.now)} nT, at ${esc(dayHour(bz.at))} UTC: ${bz.now < 0 ? "negative, so pointing south" : bz.now > 0 ? "positive, so pointing north" : "zero"}.`] : null,
    ["Does this page forecast aurora for my town?", "No. It shows NOAA's own numbers and NOAA's own short forecast grid, with their times, and makes no forecast of its own."],
  ].filter(Boolean);
  const body = `${staleNote(s, "kp")}
${cards([[`Kp ${kpText(k.latest.kp)}`, `Latest planetary Kp, tagged ${esc(hhmm(k.latest.t))} UTC`], [`Kp ${kpText(k.max.kp)}`, `Highest in the last ${spanH} hours`], [num(k.atLeastG1), `Three-hour periods at Kp ${KP_G1} or more`], ...(speed ? [[`${wf("speed", speed.now)} km/s`, "Solar wind speed, latest"]] : [])])}
${seeAlso(file, p.guide, built)}

<h2 id="kp">The Kp index over the last ${spanH} hours</h2>
<p>NOAA gives one planetary Kp value for each three-hour period, from 0 to 9; the chart shows the ${num(k.rows.length)} periods our collector keeps, each labelled with its time tag in UTC. NOAA's storm scale starts at G1 (minor) at Kp ${KP_G1}; ${num(k.atLeastG1)} of these periods reached it.${k.missing ? ` ${num(k.missing)} ${v(k.missing, "period has", "periods have")} no value and ${v(k.missing, "is", "are")} drawn at 0.` : ""} NOAA's full G1 to G5 table is in <a href="${href(file, p.guide)}">our aurora guide</a>.</p>
${columnChartSvg({ id: "chart-kp", title: `Planetary Kp per three hours, ${dayHour(k.first)} to ${dayHour(k.rows[k.rows.length - 1].t)} UTC`, desc: `Latest Kp ${kpText(k.latest.kp)}, highest ${kpText(k.max.kp)}. Each value is printed above its column; the table below gives the full times.`, rows: kpRowsChart })}
${table({ caption: "Planetary Kp per three-hour period", head: ["Period tagged (UTC)", "Kp"], numeric: [1], rows: k.rows.map((r) => [esc(dayHour(r.t)), r.kp === null ? "No value" : kpText(r.kp)]) })}

<h2 id="wind">Solar wind now</h2>
${windHtml}

<h2 id="grid">NOAA's aurora forecast grid</h2>
${gridHtml}
${alerts.length ? `
<h2 id="alerts">NOAA geomagnetic messages</h2>
<p>The geomagnetic alerts, warnings and watches NOAA issued in the 72 hours our collector keeps, newest first, in NOAA's own words.</p>
${table({ caption: "NOAA geomagnetic messages", head: ["Issued (UTC)", "Kind", "NOAA's headline"], rows: alerts.map((a) => [esc(dayHour(a.issued)), esc(cap(a.kind || "message")), esc(a.headline)]) })}` : ""}

<h2 id="latitude">What it means for where you are</h2>
<p>This page does not turn Kp into a latitude. NOAA's scales page lists, for each G level, where aurora has been seen, and gives typical latitudes in geomagnetic latitude, which is measured from the magnetic pole and is not the same as a place's ordinary latitude. NOAA's aurora tutorial also says that when the Kp index is high, between 7 and 9, the aurora will be bright and the auroral oval will move to lower latitudes. Your cloud cover and how dark your sky is also decide what you can see.</p>

<h2 id="how">How this page is made</h2>
<ul>
<li>Kp: NOAA's planetary K index file, read by our collector every 30 minutes. We say "tagged" because the time is the label NOAA gives the period.</li>
<li>Solar wind: NOAA's real-time solar wind and magnetic field files (Bz in the GSM system, the field NOAA's tutorial is normally read in; which system the tutorial means is not confirmed), read every 10 minutes.</li>
<li>The aurora grid: NOAA's OVATION forecast file, read every 15 minutes.</li>
<li>The page is published only when the Kp data is less than ${MAX_AGE_HOURS.kp} hours old. The solar wind is shown only when it is less than ${MAX_AGE_HOURS.spaceweather} hours old, and the grid only when it is less than ${MAX_AGE_HOURS.aurora} hours old.</li>
</ul>

${faqHtml(faq)}
${sources([SRC.swpcData, SRC.swpcAurora, SRC.noaaScales, SRC.auroraTutorial, SRC.nws])}`;
  return {
    file, crumbTitle: p.name, title, description, h1: "What are the Kp index and the solar wind doing now?", kicker: "Live space weather",
    lead, meta: metaLine(s.dataTime, KP_SOURCE), cta: { label: "Open the live aurora screen", query: "#aurora" }, body,
    jsonld: [webPage(title, description, file, s.dataTime)],
  };
}

// ------------------------------------------------------------------ asteroid close approaches
export function approachesPage(s, { built = LIVE_FILES } = {}) {
  const p = hazardPage("asteroids"), file = p.file, date = dateLong(s.dataTime), n = s.upcoming.length, nx = s.next;
  const ld = (x) => dec(x, 2), km = (x) => num(x);
  const title = `Asteroid close approaches to Earth, ${date}`;
  const win = `within ${CAD_MAX_AU} au in its ${CAD_DAYS} day window`;
  const lead = n
    ? `As of ${esc(when(s.dataTime))}, NASA JPL's close-approach list has <strong>${num(n)} close ${v(n, "approach", "approaches")}</strong> to Earth still to come, ${win}. The next is ${esc(nx.name)}, on ${esc(dateLong(nx.time))} at ${esc(timeUtc(nx.time))}, at ${ld(nx.distLd)} lunar distances (${km(nx.distKm)} km).`
    : `As of ${esc(when(s.dataTime))}, NASA JPL's close-approach list has <strong>no close approaches</strong> to Earth still to come ${win}.`;
  // the longest form that fits in 160 characters (object names vary in length)
  const description = (n
    ? [`${num(n)} asteroid close approaches to Earth listed by NASA JPL on ${date}. Next: ${nx.name} at ${ld(nx.distLd)} lunar distances. Dates, distances, speeds.`,
      `${num(n)} asteroid close approaches to Earth listed by NASA JPL on ${date}. Next: ${nx.name} at ${ld(nx.distLd)} lunar distances.`,
      `${num(n)} asteroid close approaches to Earth listed by NASA JPL on ${date}, with dates, distances in lunar distances and speeds.`]
    : [`NASA JPL's list on ${date} has no asteroid close approaches to Earth within ${CAD_MAX_AU} au in its next ${CAD_DAYS} days. How the list is made.`]).find((d) => d.length <= 160);
  const inside = s.upcoming.filter((a) => a.distLd < 1);
  const nearest10 = [...s.upcoming].sort((a, b) => a.distLd - b.distLd || a.time.localeCompare(b.time)).slice(0, 10);
  const faq = [
    ["What is the next asteroid close approach?", nx ? `${esc(nx.name)}, at ${esc(when(nx.time))}, at ${ld(nx.distLd)} lunar distances (${km(nx.distKm)} km), at ${num(nx.speedKms)} km/s relative to Earth.` : "There is none in the list read at the data time."],
    ["Does any pass closer than the Moon's average distance?", inside.length ? `Yes: ${num(inside.length)} of the ${num(n)}, ${and(inside.map((a) => `${esc(a.name)} (${ld(a.distLd)} lunar distances, ${esc(dateLong(a.time))})`))}. One lunar distance here is ${km(s.ldKm)} km, the Moon's average distance.` : `No. The nearest is ${s.nearest ? `${esc(s.nearest.name)} at ${ld(s.nearest.distLd)} lunar distances` : "not in the list"}.`],
    ["Which is the fastest?", s.fastest ? `${esc(s.fastest.name)}, at ${num(s.fastest.speedKms)} km/s relative to Earth, on ${esc(dateLong(s.fastest.time))}.` : "There is none in the list."],
    ["Does this page say whether an asteroid will hit Earth?", "No. It lists the passes JPL predicts, with JPL's distances and times, and makes no statement about impacts."],
  ];
  const body = `${staleNote(s, "closeapproaches")}
${cards([[num(n), "Close approaches still to come in the list"], [s.nearest ? `${ld(s.nearest.distLd)} lunar distances` : "None", s.nearest ? `Nearest: ${esc(s.nearest.name)}` : "Nearest"], [num(s.insideMoon), "Closer than the Moon's average distance"], [s.fastest ? `${num(s.fastest.speedKms)} km/s` : "None", s.fastest ? `Fastest: ${esc(s.fastest.name)}` : "Fastest"]])}
${seeAlso(file, p.guide, built)}

<h2 id="list">The close approaches still to come</h2>
${n ? table({ caption: "Close approaches still to come, soonest first", head: ["Date and time (UTC)", "Object", "Distance (lunar distances)", "Distance (km)", "Speed (km/s)", "H", "Time uncertainty (JPL)"], numeric: [2, 3, 4, 5],
    rows: s.upcoming.map((a) => [esc(dayHour(a.time)), esc(a.name), ld(a.distLd), km(a.distKm), num(a.speedKms), a.h === null ? "Not given" : num(a.h), esc(a.sigma || "Not given")]) }) : `<p>The list our collector read at ${timeEl(s.dataTime)} has no close approach after that time. The next collection may add some.</p>`}
${s.earlier ? `<p>${num(s.earlier)} ${v(s.earlier, "pass", "passes")} in the list ${v(s.earlier, "was", "were")} earlier than the data time and ${v(s.earlier, "is", "are")} left out.</p>` : ""}
${nearest10.length ? `
<h2 id="nearest">The nearest passes</h2>
${barChartSvg({ id: "chart-nearest", title: "Nearest close approaches, in lunar distances", desc: `The ${nearest10.length} nearest passes still to come. ${nearest10[0].name} is nearest at ${ld(nearest10[0].distLd)} lunar distances.`, rows: nearest10.map((a) => ({ label: `${a.name}, ${dayShort(a.time)}`, value: a.distLd })) })}
<p>${s.faintest ? `The highest absolute magnitude H in the list is ${num(s.faintest.h)}, for ${esc(s.faintest.name)}.` : ""} The last pass in the list is on ${esc(dateLong(s.last))}.</p>` : ""}

<h2 id="units">What the numbers mean</h2>
<ul>
<li>A lunar distance is the Moon's average distance from Earth, ${km(s.ldKm)} km here. Our collector converts JPL's distances, which are in astronomical units (au), to kilometres and to lunar distances; the unit is our choice, not JPL's. A distance under 1 means closer than the Moon's average distance.</li>
<li>Times are converted by our collector from JPL's time scale (TDB) to UTC. The time uncertainty is the one JPL gives for each pass.</li>
<li>H is the object's absolute magnitude as JPL lists it, a measure of brightness. This page does not print sizes; <a href="${href(file, p.guide)}">our asteroid guide</a> explains how a size can be estimated from H and why that estimate is uncertain.</li>
</ul>

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: NASA JPL's Close-Approach Data service. Our collector asks it every 6 hours for the query its documentation gives as the default: close approaches of near-Earth objects to Earth within ${CAD_MAX_AU} au in the next ${CAD_DAYS} days, sorted by date. JPL's usage policy asks that its interfaces are not embedded in a website, so we serve our own copy, and the list can be a little behind JPL's.</li>
<li>The data time is when our collector read the list. The page is published only when that is less than ${MAX_AGE_HOURS.closeapproaches} hours old.</li>
</ul>

${faqHtml(faq)}
${sources([SRC.jplCad])}`;
  return {
    file, crumbTitle: p.name, title, description, h1: "Which asteroids pass close to Earth next?", kicker: "Live list",
    lead, meta: metaLine(s.dataTime, "NASA JPL's Center for Near-Earth Object Studies"), cta: { label: "Open the live asteroid screen", query: "#asteroids" }, body,
    jsonld: [webPage(title, description, file, s.dataTime)],
  };
}

// ------------------------------------------------------------------ tropical storms
const NHC_BASINS = "Atlantic, Eastern Pacific and Central Pacific";
// a box around every storm and its forecast track, with a margin; the whole map when the box would cross the antimeridian
export function stormBounds(storms) {
  const pts = storms.flatMap((s) => [[s.lat, s.lon], ...s.track.map((t) => [t.lat, t.lon])]);
  if (!pts.length) return null;
  const lats = pts.map((q) => q[0]), lons = pts.map((q) => q[1]);
  let west = Math.min(...lons) - 8, east = Math.max(...lons) + 8;
  const south = Math.max(-90, Math.floor(Math.min(...lats) - 6)), north = Math.min(90, Math.ceil(Math.max(...lats) + 6));
  if (east - west > 180 || west < -180 || east > 180) return { south: -90, north: 90, west: -180, east: 180 };
  // keep the drawing at least twice as wide as it is tall, so a single storm does not fill the page
  const wantW = Math.max(east - west, (north - south) * 2);
  const mid = (west + east) / 2;
  west = Math.max(-180, Math.floor(mid - wantW / 2)); east = Math.min(180, Math.ceil(mid + wantW / 2));
  return { south, north, west, east };
}

export function stormsPage(s, { built = LIVE_FILES, coast = [] } = {}) {
  const p = hazardPage("storms"), file = p.file, date = dateLong(s.dataTime), n = s.storms.length;
  const top = s.storms[0];
  const title = `Active hurricanes and tropical storms, ${date}`;
  const named = (x) => `${esc(x.name)} (${[x.classText, x.basin].filter(Boolean).map(esc).join(", ") || "class and basin not given"}), maximum wind ${num(x.windKt)} knots (${num(x.windKmh)} km/h)`;
  const lead = n
    ? `As of ${esc(when(s.dataTime))}, the US National Hurricane Center lists <strong>${num(n)} active ${v(n, "storm", "storms")}</strong> in its ${NHC_BASINS} basins: ${s.storms.map(named).join("; ")}.`
    : `As of ${esc(when(s.dataTime))}, the US National Hurricane Center lists <strong>no active storms</strong> in its ${NHC_BASINS} basins.`;
  const description = n
    ? `${num(n)} active ${v(n, "storm", "storms")} in NHC's basins on ${date}, strongest ${top.name} at ${num(top.windKt)} knots. Wind, pressure, position and forecast track.`
    : `No active storms in the US National Hurricane Center's Atlantic and Pacific basins on ${date}. What the page reads and where to look.`;
  const showGdacs = !n && s.gdacs && s.gdacs.length > 0;
  const move = (x) => (x.moveDeg === null ? "Not given" : `${num(x.moveDeg)} degrees${x.moveKt === null ? "" : `, ${num(x.moveKt)} knots`}`);
  const bounds = stormBounds(s.storms);
  const map = bounds ? regionMapSvg({ coast, bounds, lines: s.storms.map((x) => [[x.lat, x.lon], ...x.track.map((t) => [t.lat, t.lon])]), points: s.storms.flatMap((x) => [[x.lat, x.lon], ...x.track.map((t) => [t.lat, t.lon])]),
    labels: s.storms.map((x) => ({ lat: x.lat, lon: x.lon, text: x.name })), id: "map", title: `Storm positions and NHC forecast tracks, ${when(s.dataTime)}`, desc: `${num(n)} ${v(n, "storm", "storms")}: ${s.storms.map((x) => `${x.name} at ${pos(x.lat, x.lon)}, ${x.track.length} forecast points`).join("; ")}.` }) : "";
  const hurricanes = s.storms.filter((x) => x.category > 0);
  const lowest = s.storms.filter((x) => x.pressureMb !== null).sort((a, b) => a.pressureMb - b.pressureMb)[0];
  const faq = [
    ["How many tropical storms are active now?", n ? `${num(n)} in the National Hurricane Center's ${NHC_BASINS} basins, as of ${esc(when(s.dataTime))}.` : `None in the National Hurricane Center's ${NHC_BASINS} basins, as of ${esc(when(s.dataTime))}.`],
    n ? ["Which storm is the strongest?", `${esc(top.name)}, with maximum wind of ${num(top.windKt)} knots (${num(top.windKmh)} km/h)${top.category ? `, Category ${top.category} on the Saffir-Simpson scale by that wind` : ""}.`] : null,
    hurricanes.length ? ["What do the hurricane categories measure?", "The Saffir-Simpson category comes from the maximum sustained wind alone. NHC says the scale does not take storm surge, rainfall flooding or tornadoes into account."] : null,
    ["Does this page cover typhoons in the western Pacific?", `No. It reads the National Hurricane Center's list, which covers the ${NHC_BASINS} basins. The live app shows storms elsewhere from GDACS.`],
    ["Is this a warning service?", `No. For official advisories, see the <a href="${esc(SRC.nhc.url)}" rel="noopener">National Hurricane Center</a>.`],
  ].filter(Boolean);
  const trackTables = s.storms.map((x, i) => `<h3 id="track-${i + 1}">Forecast track: ${esc(x.name)}</h3>
${x.track.length ? table({ caption: `NHC forecast track for ${x.name}`, head: ["Forecast hour", "Valid (UTC)", "Position", "Maximum wind (knots)"], numeric: [0, 3], rows: x.track.map((t) => [num(t.hours), esc(dayHour(t.valid)), esc(pos(t.lat, t.lon)), t.windKt === null ? "Not given" : num(t.windKt)]) }) : "<p>No forecast track was in the data for this storm.</p>"}`).join("\n");
  const body = `${staleNote(s, "storms")}
${cards([[num(n), `Active ${v(n, "storm", "storms")} in NHC's basins`], ...(top ? [[`${num(top.windKt)} knots`, `Strongest: ${esc(top.name)}`]] : []), ...(lowest ? [[`${num(lowest.pressureMb)} mb`, `Lowest pressure: ${esc(lowest.name)}`]] : [])])}
${seeAlso(file, p.guide, built)}
<p class="note">This page is not a warning service. For official advisories, see the <a href="${esc(SRC.nhc.url)}" rel="noopener">National Hurricane Center</a>.</p>

<h2 id="storms">${n ? "The active storms" : "No active storms"}</h2>
${n ? table({ caption: "Active storms, strongest first", head: ["Storm", "Basin", "Class (NHC)", "Maximum wind", "Saffir-Simpson category", "Pressure (mb)", "Position", "Movement (direction, speed)", "Advisory", "NHC page"], numeric: [5],
    rows: s.storms.map((x) => [esc(x.name), esc(x.basin || "Not given"), esc(x.classText || "Not given"), `${num(x.windKt)} knots (${num(x.windKmh)} km/h)`, x.category ? `Category ${x.category}` : "Below hurricane strength", x.pressureMb === null ? "Not given" : num(x.pressureMb), esc(pos(x.lat, x.lon)), esc(move(x)), `${x.advisory ? `${esc(x.advisory)}, ` : ""}${esc(dayHour(x.issued))}`, x.url ? `<a href="${esc(x.url)}" rel="noopener">Graphics</a>` : "None"]) })
    : `<p>The list our collector read at ${timeEl(s.dataTime)} had no active storm in the ${NHC_BASINS} basins.</p>`}
${n ? `<p>Wind is the storm's maximum wind in knots, as NHC gives it; our collector converts it to km/h. The category is the Saffir-Simpson category for that wind. The basin is where NHC places the storm now. Movement is NHC's direction in degrees and speed in knots.</p>
${map}
<p>The map shows each storm's position and NHC's forecast points, joined in order.</p>

<h2 id="tracks">Forecast tracks</h2>
<p>NHC counts forecast hours from the synoptic time (00, 06, 12 or 18 UTC) at or before the advisory. NHC's own file says the official forecast track in this format is an experimental product. The cone of uncertainty is on each storm's NHC page.</p>
${trackTables}` : ""}${showGdacs ? `
<h2 id="elsewhere">Tropical cyclones GDACS lists</h2>
<p>The Global Disaster Alert and Coordination System lists tropical cyclones worldwide, including outside NHC's basins. These are the most recent it listed when our collector read it at ${timeEl(s.gdacsTime)}. GDACS says its information is purely indicative and should not be used for any decision making without alternate sources.</p>
${table({ caption: "Tropical cyclones listed by GDACS", head: ["Name (GDACS)", "GDACS alert level", "From (UTC)", "To (UTC)", "GDACS page"], rows: s.gdacs.map((g) => [esc(g.name), esc(g.alert || "Not given"), esc(dayHour(g.from)), esc(dayHour(g.to)), g.url ? `<a href="${esc(g.url)}" rel="noopener">Report</a>` : "None"]) })}` : ""}

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: the National Hurricane Center's list of current storms, with each storm's forecast track, read by our collector every 15 minutes. The data time is when our collector read the list; each storm's advisory time is in the table.</li>
<li>The page is published only when the list is less than ${MAX_AGE_HOURS.storms} hours old; otherwise the previous copy stays.</li>
</ul>

${faqHtml(faq)}
${sources([SRC.nhc, SRC.nhcGis, SRC.sshws, SRC.nws, ...(showGdacs ? [SRC.gdacs] : [])])}`;
  const dataset = showGdacs ? null : datasetLd({ feeds: ["storms"], name: `Active tropical storms in NHC's basins, ${when(s.dataTime)}`, description: plain(lead), file, dataTime: s.dataTime,
    temporal: s.earliestAdvisory && s.earliestAdvisory < s.dataTime ? `${s.earliestAdvisory}/${s.dataTime}` : s.dataTime, spatial: `The ${NHC_BASINS} basins`, keywords: ["tropical storms", "hurricanes", "National Hurricane Center"], basedOn: SRC.nhcGis });
  return {
    file, crumbTitle: p.name, title, description, h1: "Which tropical storms are active now?", kicker: "Live list",
    lead, meta: metaLine(s.dataTime, "the US National Hurricane Center"), cta: { label: "Open the live storms screen", query: "#storms" }, body,
    jsonld: [webPage(title, description, file, s.dataTime), ...(dataset ? [dataset] : [])],
  };
}

// ------------------------------------------------------------------ fire detections
export function firesPage(s, { built = LIVE_FILES, coast = [] } = {}) {
  const p = hazardPage("fires"), file = p.file, date = dateLong(s.dataTime), n = s.detections;
  const title = `Satellite fire detections in 24 hours, ${date}`;
  const sats = s.satellites, satNames = and(sats.map((x) => esc(x.name)));
  const lead = `As of ${esc(when(s.dataTime))} (the time of the newest detection), NASA FIRMS's 24 hour global files from ${num(sats.length)} VIIRS ${v(sats.length, "satellite", "satellites")} hold <strong>${num(n)} fire detections</strong> in ${num(s.cells)} cells of a quarter of a degree, after our collector left out ${num(s.lowLeftOut)} low-confidence detections. A detection is a place where a satellite saw heat, not a confirmed fire.`;
  const description = `${num(n)} satellite fire detections in NASA FIRMS's 24 hour files to ${date}: by satellite, densest cells, a map. Detections, not confirmed fires.`;
  const top = s.dense[0];
  const placeCell = (d) => (d.place ? `${esc(d.place.name)}, ${esc(country(d.place.country))}: ${num(Math.round(d.place.km))} km` : `None within ${PLACE_MAX_KM} km`);
  const faq = [
    ["How many fire detections were there in the last 24 hours?", `${num(n)} in NASA FIRMS's 24 hour files to ${esc(when(s.dataTime))}, not counting ${num(s.lowLeftOut)} low-confidence detections our collector leaves out.`],
    ["Which satellite made the most detections?", `${esc(sats[0].name)}, with ${num(sats[0].count)}.`],
    ["Where was the densest cell?", top ? `The cell centred at ${esc(pos(top.lat, top.lon))}, with ${num(top.detections)} detections. ${top.place ? `The nearest place in our list is ${esc(top.place.name)}, ${esc(country(top.place.country))}, ${num(Math.round(top.place.km))} km from the cell centre.` : `No place in our list is within ${PLACE_MAX_KM} km of it.`}` : "There is none."],
    ["Is every detection a wildfire?", "No. A detection means a satellite instrument reported heat at that spot at that time. This page does not say what burned or how large a fire is."],
  ];
  const body = `${staleNote(s, "fires")}
${cards([[num(n), "Fire detections in the 24 hour files"], [num(s.cells), "Quarter-degree cells with detections"], [num(s.lowLeftOut), "Low-confidence detections left out"]])}
${seeAlso(file, p.guide, built)}

<h2 id="satellites">Detections by satellite</h2>
<p>NASA FIRMS publishes 24 hour global files for ${satNames}. The same fire seen by two satellites, or on two passes, counts twice, so these are detections, not fires.</p>
${barChartSvg({ id: "chart-satellites", title: "Fire detections by satellite", desc: `${sats.map((x) => `${x.name} ${num(x.count)}`).join(", ")}.`, rows: sats.map((x) => ({ label: x.name, value: x.count })) })}
${table({ caption: "Fire detections by satellite", head: ["Satellite", "Detections"], numeric: [1], rows: sats.map((x) => [esc(x.name), num(x.count)]).concat([["All", num(n)]]) })}

<h2 id="densest">Where the detections were densest</h2>
<p>The ten quarter-degree cells with the most detections. The nearest place is the nearest of the ${num(s.places)} places in our place list (GeoNames towns and cities of about 15,000 people or more), measured from the centre of the cell, so it can be far from the detections themselves. If the nearest place is more than ${PLACE_MAX_KM} km away, we give only the coordinates.</p>
${table({ caption: "Densest cells of fire detections", head: ["Rank", "Cell centre", "Detections", "Nearest place in our list, distance from the cell centre"], numeric: [0, 2], rows: s.dense.map((d, i) => [String(i + 1), esc(pos(d.lat, d.lon)), num(d.detections), placeCell(d)]) })}

<h2 id="map">Map of the detections</h2>
${worldMapSvg({ coast, points: s.mapPoints, id: "map", title: `Fire detections in the 24 hours to ${when(s.dataTime)}`, desc: `${num(s.mapSquares)} squares of ${s.mapDeg} ${v(s.mapDeg, "degree", "degrees")} with at least one detection.` })}
<p>Each dot is a square of ${s.mapDeg} ${v(s.mapDeg, "degree", "degrees")} with at least one detection: ${num(s.mapSquares)} squares in all. ${num(s.north)} of the detections were north of the equator and ${num(s.south)} south of it.</p>

<h2 id="detection">What a detection is</h2>
<p>A detection means a satellite instrument reported heat at that spot at that time. It is not a confirmed wildfire, and this page does not measure or estimate how large a fire is. A place with no detections is not proof that there was no fire.</p>

<h2 id="how">How this page is made</h2>
<ul>
<li>Source: NASA FIRMS's 24 hour global files for the VIIRS instrument on ${satNames}, read by our collector every hour. NASA's LANCE page says near real-time users usually need data within three hours; the exact latency of these files is not confirmed from a NASA page.</li>
<li>Our choices: detections NASA marks as low confidence are left out (${num(s.lowLeftOut)} of the ${num(s.rows)} rows read), and the rest are grouped into cells of a quarter of a degree.</li>
<li>The data time is the time of the newest detection. The page is published only when that is less than ${MAX_AGE_HOURS.fires} hours old.</li>
<li>NASA asks users of the data to give its acknowledgement: ${esc(LANCE_ACK)} NASA provides the information as is.</li>
</ul>

${faqHtml(faq)}
${sources([SRC.lance, SRC.firms, SRC.geonames])}`;
  const windowStart = new Date(Date.parse(s.dataTime) - 24 * 3600e3).toISOString().replace(".000Z", "Z");
  const dataset = datasetLd({ feeds: p.feeds, name: `Satellite fire detections in the 24 hours to ${when(s.dataTime)}`, description: plain(lead), file, dataTime: s.dataTime,
    temporal: `${windowStart}/${s.dataTime}`, spatial: "Earth", keywords: ["fire detections", "NASA FIRMS", "VIIRS", "last 24 hours"], basedOn: SRC.firms });
  return {
    file, crumbTitle: p.name, title, description, h1: "How many fire detections did satellites make in the last 24 hours?", kicker: "Live count",
    lead, meta: metaLine(s.dataTime, "NASA FIRMS (LANCE)"), cta: { label: "Open the live fires screen", query: "#fires" }, body,
    jsonld: [webPage(title, description, file, s.dataTime), ...(dataset ? [dataset] : [])],
  };
}

// ------------------------------------------------------------------ the /right-now/ hub
// rows come from the same summaries the pages use. available: the live files that exist in this build, so a stale or missing page is
// never linked as live. missing: { key: reason } for each page that was not built.
export function hubRows({ satellites = null, quakes = null, space = null, approaches = null, storms = null, fires = null, missing = {} }) {
  // value: the table's text; said: the same number as a phrase for the lead
  const row = (key, file, label, value, said, dataTime, guide, s = null) => ({ key, file, label, value, said, dataTime, guide, stale: !!(s && s.stale), reason: value === null ? missing[key] || "not available in this build" : null });
  const nx = approaches && approaches.next;
  const nq = quakes && `${num(quakes.count)} ${v(quakes.count, "earthquake", "earthquakes")} in 24 hours in USGS's magnitude 2.5 and above feed`;
  const ns = storms && `${num(storms.storms.length)} active ${v(storms.storms.length, "storm", "storms")} in NHC's basins`;
  return [
    row("satellites", SATCOUNT_FILE, "Satellite count", satellites ? `${num(satellites.active)} active satellites` : null, satellites ? `${num(satellites.active)} active satellites in orbit` : null, satellites ? satellites.dataTime : null, "guides/satellites/index.html"),
    row("quakes", hazardPage("quakes").file, "Earthquakes today", quakes ? `${nq}${quakes.largest ? `, largest magnitude ${num(quakes.largest.mag)}` : ""}` : null, nq, quakes ? quakes.dataTime : null, hazardPage("quakes").guide, quakes),
    row("aurora", hazardPage("aurora").file, "Aurora tonight", space ? `Kp ${num(space.kp.latest.kp)}, period tagged ${hhmm(space.kp.latest.t)} UTC` : null, space ? `a latest planetary Kp of ${num(space.kp.latest.kp)}` : null, space ? space.dataTime : null, hazardPage("aurora").guide, space),
    row("asteroids", hazardPage("asteroids").file, "Asteroid close approaches", approaches ? (nx ? `Next: ${nx.name}, ${dateLong(nx.time)}, at ${dec(nx.distLd, 2)} lunar distances` : "No close approach still to come in the list") : null,
      approaches ? (nx ? `the next asteroid close approach at ${dec(nx.distLd, 2)} lunar distances (${nx.name})` : "no asteroid close approach still to come in JPL's list") : null, approaches ? approaches.dataTime : null, hazardPage("asteroids").guide, approaches),
    row("storms", hazardPage("storms").file, "Tropical storms now", ns, ns, storms ? storms.dataTime : null, hazardPage("storms").guide, storms),
    row("fires", hazardPage("fires").file, "Fire detections today", fires ? `${num(fires.detections)} fire detections in 24 hours` : null, fires ? `${num(fires.detections)} satellite fire detections in 24 hours` : null, fires ? fires.dataTime : null, hazardPage("fires").guide, fires),
  ];
}

export function rightNowPage(rows, { available = LIVE_FILES } = {}) {
  const file = RIGHT_NOW_FILE;
  const live = rows.filter((r) => r.value !== null && available.includes(r.file));
  const times = live.map((r) => r.dataTime).sort();
  const newest = times[times.length - 1] || null;
  const title = "Right now: live satellite, quake, aurora and fire numbers";
  const lead = newest
    ? `As of ${esc(when(newest))}, the newest data time among the live pages, they show ${and(live.map((r, i) => (i === 0 ? `<strong>${esc(r.said)}</strong>` : esc(r.said))))}. Each row below gives the time of its own data.`
    : "None of the live pages has current data in this build.";
  const description = `The latest number from each live page of ${SITE.name}: satellites in orbit, earthquakes, Kp, asteroid passes, storms and fire detections, with data times.`;
  const cell = (r) => (r.value !== null && available.includes(r.file) ? `<a href="${href(file, r.file)}">${esc(r.label)}</a>` : esc(r.label));
  const valueCell = (r) => (r.value !== null && available.includes(r.file) ? esc(r.value) : esc(r.reason ? `${cap(r.reason)}; page not updated` : "Page not updated"));
  const countries = available.includes(HUB_FILE) ? [`<a href="${href(file, HUB_FILE)}">all owners ranked</a>`, ...COUNTRY_PAGES.filter((p) => available.includes(p.file)).map((p) => `<a href="${href(file, p.file)}">${esc(p.name)}</a>`)] : [];
  const snapshot = live.some((r) => r.stale);
  const body = `${snapshot ? `<p class="note warn">This copy was built from the data bundled with the site when it was deployed, and some of that data is older than the limits below. The live copy replaces it after the next data collection.</p>\n` : ""}
<h2 id="now">The live numbers</h2>
${table({ caption: "The latest number from each live page", head: ["Live page", "Latest number", "Data time (UTC)"], rows: rows.map((r) => [cell(r), valueCell(r), r.value !== null && available.includes(r.file) ? esc(dayHour(r.dataTime)) : ""]) })}
${countries.length ? `<p>Satellites by country, from the same satellite data: ${countries.join(", ")}.</p>` : ""}

<h2 id="how">How these numbers are made</h2>
<ul>
<li>Each number is worked out by the same code as its page, from the same feed, and the time beside it is the time given in that feed (or, where a feed gives none, when our collector read it), not the time this page was built.</li>
<li>Each page has a limit on how old its data may be: earthquakes ${MAX_AGE_HOURS.quakes} hours, Kp ${MAX_AGE_HOURS.kp} hours, storms ${MAX_AGE_HOURS.storms} hours, fire detections ${MAX_AGE_HOURS.fires} hours and asteroid close approaches ${MAX_AGE_HOURS.closeapproaches} hours. A page whose data is older is not updated and is not linked from here${snapshot ? ", except in a copy built at deploy time, like this one, which shows the bundled data with its own time" : ""}.</li>
<li>Nothing here is a forecast of ours or a warning. Each page names its source agency and links to it.</li>
</ul>

<h2 id="guides">Guides to the data</h2>
<ul>${rows.map((r) => `<li><a href="${href(file, r.guide)}">${esc(r.label)}: how to read the data</a></li>`).join("")}</ul>

${faqHtml([
    ["How fresh are these numbers?", newest ? `Each has its own data time in the table. The newest is ${esc(when(newest))}${times.length > 1 ? ` and the oldest ${esc(when(times[0]))}` : ""}.` : "None of the live pages has current data in this build."],
    ["Why does a page show no number?", "Its data was older than the page's limit, or was not available when this page was built, so the page was not updated. Its last copy may still be on the site, with its own data time."],
  ])}
${sources([SRC.celestrak, SRC.usgsFeed, SRC.swpcData, SRC.jplCad, SRC.nhc, SRC.firms])}`;
  return {
    file, crumbTitle: "Right now", title, description, h1: "What do the live feeds say right now?", kicker: "Live hub",
    lead, meta: newest ? `Newest data time ${timeEl(newest)}. Each row gives its own data time.` : "", cta: { label: "Open the live globe", query: "" }, body,
    jsonld: [webPage(title, description, file, newest || "1970-01-01T00:00:00Z")], dataTime: newest,
  };
}

export const HAZARD_PAGE_FUNCTIONS = { quakes: quakesPage, aurora: auroraPage, asteroids: approachesPage, storms: stormsPage, fires: firesPage };
