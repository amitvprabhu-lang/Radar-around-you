// The /satellites-near-me/ page: a normal static page of the content site (site/build.mjs writes it; site/near-refresh.mjs may rewrite it
// at deploy time from the live feed). Everything a reader or a search engine needs is in the HTML: what the page does, how it is worked
// out, how accurate it is, the expected numbers and an example worked out from the data the page was built with. The tool itself (the form
// and the answers) is added by the page's script (site/near-page.mjs). Statements are traced in docs/satellites-near-me-sources.md.
import { esc, href, table, sources } from "./layout.mjs";
import { webPageLd } from "./liveseo.mjs";
import { ORBIT_CHART_LABELS } from "./satcount.mjs";
import { COUNTRY_PAGES } from "./satcountry.mjs";
import { U_BAND_LABELS, ACCURACY, PASS_ERRORS, GEO_MAX_INCL_DEG } from "./near.mjs";
import { NEAR_FILE, RADII_KM, DEFAULT_RADIUS_KM, DEFAULT_PLACE, STALE_HOURS, TABLE_CAP, EARTH_AREA_KM2, MIN_USABLE, fmtInt, fmtKm, shortDistance, lookText, utcText, zoneText, isoUtc, dayTimeUtc, expectedText, timeErrorText } from "./near-ui.mjs";

export const NEAR_TITLE = "Satellites near me: passes over your place in 24 hours";
export const NEAR_DESCRIPTION = "Which satellites pass within 25 to 500 km of your place, now and in the next 24 hours: times, ground distances with their uncertainty, height and owner.";
export const NEAR_H1 = "Satellites passing near you, now and in the next 24 hours";
export const NEAR_CRUMB = "Satellites near me";

export const NEAR_SOURCES = [
  { title: "CelesTrak current GP element sets", url: "https://celestrak.org/NORAD/elements/", note: "The orbit data, collected by this site and published in its live data folder" },
  { title: "CelesTrak usage policy", url: "https://celestrak.org/usage-policy.php", note: "GP data is updated every 2 hours; what it says about reuse is recorded in our source notes" },
  { title: "CelesTrak SATCAT", url: "https://celestrak.org/satcat/records.php", note: "Owner, purpose, launch date and status of each satellite" },
  { title: "satellite.js", url: "https://github.com/shashwatak/satellite-js", note: "The SGP4 code (MIT licence) that turns element sets into positions, as in the 3D app" },
  { title: "Revisiting Spacetrack Report #3", url: "https://celestrak.org/publications/AIAA/2006-6753/", note: "The SGP4 model satellite.js follows" },
  { title: "GeoNames", url: "https://www.geonames.org/", note: "The place search (towns of about 15,000 people and more), CC BY 4.0" },
  { title: "Natural Earth", url: "https://www.naturalearthdata.com/about/terms-of-use/", note: "The coastlines on the map; public domain" },
];

// The page's settings for its script: the six cities, the owners that have a country page, the orbit labels. No text from outside.
export function nearConfig(cities) {
  return {
    cities: cities.map(({ id, name, lat, lon, tz }) => ({ id, name, lat, lon, tz })),
    owners: Object.fromEntries(COUNTRY_PAGES.map((p) => [p.owner, p.slug])),
    orbitLabels: ORBIT_CHART_LABELS,
  };
}

// the owner as the catalogue records it, linked to its satellites by country page where there is one
const ownerHtml = (file, owner) => {
  if (!owner) return "Not in the catalogue";
  const p = COUNTRY_PAGES.find((c) => c.owner === owner);
  return p ? `<a href="${href(file, p.file)}">${esc(owner)}</a>` : esc(owner);
};
const timeEl = (ms) => `<time datetime="${isoUtc(ms)}">${esc(dayTimeUtc(ms))}</time>`;
// a share as a percentage with two significant figures, written out in full ("0.0062%", "99%")
export const pct = (x) => `${Number((x * 100).toPrecision(2)).toLocaleString("en-GB", { maximumSignificantDigits: 2 })}%`;

// summary: site/near-summary.mjs; assets: { page, calc } file names (in the page's folder); cities: the six cities.
export function nearPage(summary, { assets, cities }) {
  const file = NEAR_FILE, s = summary, ex = s.example, ph = esc(ex.place.name);
  const sourceWords = s.source === "live" ? "the live satellite feed the site had when this page was built" : "the satellite data bundled with the site when this page was built";
  const dataTime = Date.parse(s.dataTime);
  const exp100 = s.expected.find((e) => e.radiusKm === DEFAULT_RADIUS_KM);
  const cityOpts = cities.map((c) => `<option value="${esc(c.id)}"${c.name === DEFAULT_PLACE.name ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  const radiusOpts = RADII_KM.map((r) => `<option value="${r}"${r === DEFAULT_RADIUS_KM ? " selected" : ""}>${fmtKm(r)}</option>`).join("");

  const tool = `<section id="nm-tool" data-base="${esc(href(file, "index.html"))}" data-calc="${esc(assets.calc)}" aria-labelledby="nm-tool-h">
<h2 id="nm-tool-h">Find satellites near a place</h2>
<noscript><p class="note">The calculation runs in your browser and needs JavaScript. Everything below it (how it works, what to expect and an example for ${ph}) is plain text.</p></noscript>
<form id="nm-form" class="nm-form" hidden novalidate>
<p class="nm-current">Place: <strong id="nm-place-name">${ph}</strong> <span id="nm-place-coords" class="meta"></span> <span id="nm-place-note" class="meta">(the default place; choose your own below)</span></p>
<p id="nm-query-note" class="meta"></p>
<div class="nm-cols">
<div>
<div class="nm-grid">
<p><label for="nm-city">One of the site's six cities</label><br><select id="nm-city">${cityOpts}<option value="">Another place</option></select></p>
<p><label for="nm-radius">Distance on the ground</label><br><select id="nm-radius">${radiusOpts}</select></p>
</div>
<p><label for="nm-search">Search for a place</label><br><input id="nm-search" type="search" autocomplete="off" spellcheck="false" aria-describedby="nm-search-help"><br>
<span id="nm-search-help" class="nm-sm">Towns of about 15,000 people and more. The list (about 2 MB, less compressed) loads when you first type. <span id="nm-places-credit"></span></span></p>
<p id="nm-search-status" class="nm-sm"></p>
<ul id="nm-search-list" class="nm-list"></ul>
</div>
<div>
<p><button type="button" id="nm-geo" class="nm-btn">Use my location</button><br><span id="nm-geo-status" class="nm-sm">Your browser asks you first. The position is used on this page only: it is not stored and not sent anywhere.</span></p>
<fieldset class="nm-coords"><legend>Or type coordinates in decimal degrees</legend>
<div class="nm-grid">
<p><label for="nm-lat">Latitude (south is negative)</label><br><input id="nm-lat" inputmode="decimal" autocomplete="off" aria-describedby="nm-lat-err"><br><span id="nm-lat-err" class="nm-err"></span></p>
<p><label for="nm-lon">Longitude (west is negative)</label><br><input id="nm-lon" inputmode="decimal" autocomplete="off" aria-describedby="nm-lon-err"><br><span id="nm-lon-err" class="nm-err"></span></p>
</div>
<p><button type="submit" class="nm-btn">Show this place</button></p>
</fieldset>
</div>
</div>
<p id="nm-share" hidden><a id="nm-share-link" href="./">Link to this place and distance</a> <button type="button" id="nm-copy" class="nm-btn nm-small">Copy the link</button> <span id="nm-copy-done" class="meta" role="status"></span></p>
</form>
<div id="nm-progress" class="nm-progress" hidden><progress id="nm-bar" max="1" aria-labelledby="nm-stage"></progress> <span id="nm-stage"></span></div>
<p id="nm-announce" class="nm-announce" aria-live="polite"></p>
<div id="nm-out" hidden></div>
</section>
<script type="application/json" id="nm-config">${JSON.stringify(nearConfig(cities)).replace(/</g, "\\u003c")}</script>`;

  const expRows = s.expected.map((e) => [fmtKm(e.radiusKm), `${fmtInt(e.areaKm2)} km²`, pct(e.share), esc(expectedText(e.expected))]);
  const expected = `<h2 id="expect">How many satellites to expect</h2>
<p>At any one moment, very few satellites are over any one place. A circle of ${fmtKm(DEFAULT_RADIUS_KM)} around a place covers about ${fmtInt(exp100.areaKm2)} km² of the Earth's ${fmtInt(EARTH_AREA_KM2 / 1e6)} million km², a share of ${pct(exp100.share)}. The data this page was built with (${esc(sourceWords)}, from ${timeEl(dataTime)}) lists ${fmtInt(s.active)} active satellites. If they were spread evenly over the globe, ${esc(expectedText(exp100.expected))} would be inside that circle at any moment. They are not spread evenly, so a real place sees more or fewer, but it explains why the "Right now" answer is a small number, often zero: at the start of the example below, ${ex.now === 0 ? "no satellite was" : `${fmtInt(ex.now)} ${ex.now === 1 ? "satellite was" : "satellites were"}`} within ${fmtKm(DEFAULT_RADIUS_KM)} of ${ph}. Of those ${fmtInt(s.active)} active satellites, ${fmtInt(ex.used)} had orbit data less than 3 days old at the data time and were worked out. Over a whole day it is different: each satellite sweeps a long track across the Earth, and in the example below ${fmtInt(ex.within)} passes come within ${fmtKm(DEFAULT_RADIUS_KM)} of ${ph} in 24 hours.</p>
${table({ caption: `Satellites expected inside the circle at any moment if the ${fmtInt(s.active)} active satellites of the data of ${dayTimeUtc(dataTime)} were spread evenly`, head: ["Distance on the ground", "Area of the circle", "Share of the Earth", "Expected at any moment"], rows: expRows, numeric: [1, 2, 3] })}
<p>The page's script repeats this sum with the newest data when it gives its answer.</p>`;

  const exRows = ex.rows.map((r) => [
    `<time datetime="${isoUtc(r.t)}">${esc(utcText(r.t, ex.startMs))}</time> <span class="meta">${esc(timeErrorText(r.us))}</span><br><span class="meta">${esc(zoneText(r.t, ex.place.tz))}</span>`,
    `<strong>${esc(r.name)}</strong><br>NORAD ${r.id}${r.starlink ? " (Starlink)" : ""}<br>${ownerHtml(file, r.owner)}`,
    `${esc(shortDistance(r.km, r.u))}<br>${r.status}`,
    `${esc(lookText(r.el, r.az))}<br>${r.lit ? "in sunlight" : "in Earth's shadow"}`,
    `${fmtKm(r.hKm)}, ${r.kms.toFixed(1)} km/s`,
  ]);
  const example = `<h2 id="example">An example: ${ph}, from the data this page was built with</h2>
<p>Worked out when this page was built, from ${esc(sourceWords)} (from ${timeEl(dataTime)}), for the 24 hours after that time, ${timeEl(ex.startMs)} to ${timeEl(ex.endMs)}. It shows what the tool gives; for passes from now on, use the tool above. In those 24 hours ${fmtInt(ex.within)} passes came within ${fmtKm(ex.radiusKm)} of ${ph} and ${fmtInt(ex.borderline)} more were borderline; at the start ${ex.now === 0 ? "no satellite was" : `${fmtInt(ex.now)} ${ex.now === 1 ? "satellite was" : "satellites were"}`} within ${fmtKm(ex.radiusKm)}. The first ${fmtInt(ex.rows.length)}:</p>
${table({ caption: `The first ${ex.rows.length} passes within ${ex.radiusKm} km of ${ex.place.name}, or borderline, after ${dayTimeUtc(ex.startMs)} (times in UTC, then in ${ex.place.tz})`, head: ["Closest approach", "Satellite and owner as the catalogue records it", "Closest ground distance", "Seen from the place", "Height, speed"], rows: exRows })}`;

  const PE = PASS_ERRORS, MK = ACCURACY.marks;
  const cell = (row, k) => `${row.km[k]} km, ${esc(timeErrorText(row.s[k]).replace(/^± /, "").replace(/^time uncertain by about /, ""))}`;
  const accRows = [];
  const BAND_ORDER = ["low-under-450", "low-450-600", "low-600-1000", "low-1000-2000", "medium", "geostationary", "highElliptical", "beyond"];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  for (const [kind, label] of [["mean", "compact data"], ["full", "full element sets"]]) {
    for (const band of BAND_ORDER) {
      const row = PE.tables[kind][band];
      if (!row) continue;
      accRows.push([`${esc(cap(U_BAND_LABELS[band]))}, ${label}${row.allAges ? " (all ages together: few passes)" : ""}`, cell(row, 0), cell(row, 2), cell(row, 4)]);
    }
    const o = PE.tables[kind].other;
    if (o) accRows.push([`Any other, ${label} (all heights together)`, cell(o, 0), cell(o, 2), cell(o, 4)]);
  }
  const A = ACCURACY.fromData, ah = ACCURACY.ahead;
  const method = `<h2 id="how">How it is worked out</h2>
<p>The distance is measured along the ground, between the place and the satellite's ground point, the point on the Earth straight below it. A straight line of ${fmtKm(DEFAULT_RADIUS_KM)} from you never reaches a satellite: in the data this page was built with, the lowest active satellite is about ${fmtKm(Math.floor(s.lowestPerigeeKm / 5) * 5)} up at its lowest point and ${pct(s.highShare)} of them never come below ${fmtKm(300)}.</p>
<ul>
<li><strong>Which satellites:</strong> the active satellites in the site's data: payloads whose catalogue status is operational, partly operational, backup, spare or extended mission, the same definition as the <a href="${href(file, "how-many-satellites-in-orbit/index.html")}">satellite count</a>. Rocket bodies and debris are left out.</li>
<li><strong>The orbit model:</strong> SGP4, the model made for these element sets, with the satellite.js code the 3D app uses for its pass predictions. In the data this page was built with, ${fmtInt(ex.exact)} satellites (the stations, the brightest objects and everything launched in the last 30 days) come with their full element sets. The others come from the app's compact satellite file, which has no drag terms, so their drag is taken as zero. That is why low satellites are less certain than high ones.</li>
<li><strong>The search:</strong> for each satellite, a quick test finds the times when the place can be near its orbit plane, a step search inside those times finds each closest approach, and a few fitted parabolas pin down its time. All of it runs in your browser, in a background thread, for every active satellite.</li>
<li><strong>Within, borderline, and left out:</strong> each pass carries two measured uncertainties (below): one for its closest ground distance and one for its time. A pass is "within" when the central estimate of its closest distance is inside your distance, and "borderline" when it is outside by less than the distance uncertainty. Only when that uncertainty is as large as your distance itself is a pass counted but not listed. A time uncertain by more than a few minutes is said in words. For "right now" the uncertainty is the distance uncertainty plus the ground the satellite covers in its time uncertainty, because at a fixed moment an error in time moves it along its track.</li>
<li><strong>Old data:</strong> a satellite whose element set is more than ${STALE_HOURS} hours old when you ask is left out, the rule the app uses to flag old orbit data, and the page says how many. When more than a tenth of the satellites are left out for this, the page says so at the top of its answer; when fewer than ${fmtInt(MIN_USABLE)} are left, it gives no answer and says the data is too old.</li>
<li><strong>Geostationary satellites</strong> (in the geostationary belt and inclined under ${GEO_MAX_INCL_DEG} degrees) hang over nearly the same point of the equator, so they have no passes. They are listed apart, with their offset from the place, when they are within your distance; that only happens near the equator. Inclined geosynchronous satellites, such as Japan's QZSS and some of China's BeiDou and India's NavIC satellites, swing far north and south every day and are searched for passes like the others.</li>
<li><strong>Seen from the place:</strong> the satellite's height above the horizon and its compass direction at the closest approach, and whether it is in sunlight or in the Earth's shadow. Whether you could see it also depends on a dark sky and on how bright it is, which this page does not work out. The <a href="${href(file, "iss-today/index.html")}">ISS today</a> and <a href="${href(file, "tonights-sky/index.html")}">tonight's sky</a> pages and the app's Tonight view cover visible passes.</li>
<li><strong>New data:</strong> the site collects CelesTrak's orbit data about every 2 hours, the rate CelesTrak's usage policy gives for its GP data. The page uses the site's live satellite data when it is newer than the copy bundled with the site, says which it used and how old it is, and while it stays open looks for newer data every few minutes and works the answer out again when some arrives.</li>
<li><strong>Your place:</strong> the place, the distance and a shareable link are kept in the address, and the last place you picked is remembered in your browser's own storage on this device. The position from "Use my location" is never stored and never sent anywhere: the whole calculation runs on your device.</li>
</ul>
<h2 id="accuracy">How accurate is it?</h2>
<p>We measured it. First, the model: on ${fmtInt(ACCURACY.sets)} real CelesTrak element sets downloaded on ${esc(dayTimeUtc(Date.parse(ACCURACY.downloadedAt)))}, the app's faster globe model put the ground point ${A.app[24][1]} km from full SGP4 at the 95% mark one day after the data time, too far for this question, so this page uses SGP4 (${A.page[24][1]} km at the same mark for this page's model, almost all of it along the track and caused by drag on the lowest satellites).</p>
<p>Then the passes themselves, which is what the "±" figures come from. An error along the track changes when a pass happens much more than how close it comes, so the two are measured apart. Passes predicted from this site's published data of ${esc(dayTimeUtc(Date.parse(ah.taken)))} were compared with passes worked out from newer CelesTrak element sets (${esc(dayTimeUtc(Date.parse(ACCURACY.downloadedAt)))}), 24 to 60 hours after the older data, at ${PE.measured.places} places from the poles to the equator: ${fmtInt(PE.measured.passes)} passes of ${fmtInt(PE.measured.satellites)} satellites. The table gives the 95% figures by height and by how long after the element set the pass comes.</p>
${table({ caption: "Uncertainty of a pass: 95% of the passes were closer than this in closest ground distance, and in time of closest approach, to the passes from newer element sets", head: ["Satellites", "Under 36 hours after their element set", "48 to 60 hours", "72 hours and more"], rows: accRows })}
<p>Checked the same way, 36 to 48 hours after the older data: of the passes the newer element sets put within 100 km, the page marked ${Math.round(MK[100][1] * 100)}% within and ${Math.round((MK[100][2] - MK[100][1]) * 100)}% more borderline; ${Math.round(MK[100][3] * 100)}% of its "within" rows were truly within 100 km, and ${Math.round(MK[100][4] * 100)}% of its borderline rows truly came within 100 km plus their uncertainty (${Math.round(MK[100][5] * 100)}% inside 100 km itself). At 25 km: ${Math.round(MK[25][1] * 100)}% marked within, ${Math.round(MK[25][3] * 100)}% of "within" rows true; at 500 km: ${Math.round(MK[500][1] * 100)}% and ${Math.round(MK[500][3] * 100)}%.</p>
<p>The limits of this: it is one older and one newer set of data, about two days apart, for one week of October 2026; the same comparison made the table, so the check is not independent; and the newer element sets are themselves predictions fitted to tracking, not the true positions. Satellites that fire their engines (new launches still climbing to their orbits, most of all) can be much further off; that is why satellites below 450 km and recent launches carry the widest figures. We will repeat the measurement as newer data comes in.</p>`;

  const faq = [
    ["Why do so many satellites pass near me in a day?", `Low satellites go round the Earth about 15 times a day, and the Earth turns under them, so each one draws a long track across the map. With thousands of them, hundreds or thousands of tracks cross a circle of ${fmtKm(DEFAULT_RADIUS_KM)} in a day, even though only about one is inside it at any moment.`],
    ["Can I see these satellites?", "Not all of them, and this page does not promise it. Seeing one needs a dark sky, the satellite in sunlight and bright enough. The table says whether it is in sunlight and how high it is above your horizon; for visible passes use the ISS and tonight's sky pages or the app's Tonight view."],
    ["What does borderline mean?", `The central estimate of the closest distance is a little outside your distance, by less than its measured distance uncertainty (a couple of km for most satellites, more for the lowest ones). It may have come inside, so it is shown, marked, instead of being dropped. In our check at 100 km, ${Math.round(MK[100][5] * 100)}% of the borderline rows truly came inside the distance and ${Math.round(MK[100][4] * 100)}% came within it plus their uncertainty.`],
    ["Why is the time of some passes uncertain by minutes?", "Drag slows low satellites by an amount that changes with the upper atmosphere, and the compact data most of them come from does not carry it. That shifts when a satellite arrives more than where its track lies, so the closest distance can be good to a few km while the time is uncertain by minutes. The page gives both."],
    ["Why is a satellite overhead several hundred km away?", "That is its height. The page measures along the ground, from your place to the point straight below the satellite, not the straight line from you up to it."],
    ["Does my location leave my device?", "No. The calculation runs in your browser with the site's own data files. A place you search for or type goes into the page's address and your browser's storage on this device; the device's position is never stored or sent."],
    [`Why is the list capped at ${TABLE_CAP} rows?`, `To keep the page usable. The page says how many more passes there are, and you can order the table by time or by distance to see the earliest or the nearest ${TABLE_CAP}.`],
  ];
  const faqHtml = `<h2 id="faq">Questions</h2>\n${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${esc(a)}</p>`).join("\n")}`;
  const more = `<h2 id="more">More about satellites on this site</h2>
<ul>
<li><a href="${href(file, "how-many-satellites-in-orbit/index.html")}">How many satellites are in orbit</a>, counted from the same data</li>
<li><a href="${href(file, "satellites-by-country/index.html")}">Satellites by country</a>: owners as the catalogue records them</li>
<li><a href="${href(file, "iss-today/index.html")}">The ISS today</a>: where the station is and its passes</li>
<li><a href="${href(file, "tonights-sky/index.html")}">Tonight's sky</a> for six cities</li>
<li><a href="${href(file, "index.html")}">The live 3D app</a>, with the satellites above any place</li>
</ul>`;

  const style = `<style>.nm-form select,.nm-form input,.nm-btn{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 10px;max-width:100%}
.nm-form input{width:16em}.nm-btn{cursor:pointer;border-color:var(--ion);color:var(--ion);font-weight:600}.nm-small{padding:3px 10px;font-size:14px}
.nm-form fieldset,.nm-order{border:1px solid var(--line);border-radius:10px;margin:12px 0;padding:6px 12px}.nm-grid{display:flex;flex-wrap:wrap;gap:0 24px}
.nm-list{list-style:none;padding:0;margin:4px 0;display:flex;flex-wrap:wrap;gap:6px}.nm-pick{font:inherit;font-size:15px;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer}
.nm-pick:hover,.nm-btn:hover{border-color:#fff}.nm-err{color:var(--alert);font-size:14px}.nm-form [hidden],#nm-out[hidden],.nm-progress[hidden],#nm-share[hidden]{display:none}
.nm-progress{margin:12px 0;color:var(--muted)}.nm-progress progress{width:min(320px,100%);vertical-align:middle}.nm-announce{font-weight:600;margin:12px 0}
.nm-order label{margin-right:16px;white-space:nowrap}.nm-chip{display:inline-block;font-size:12px;line-height:1.4;border-radius:999px;padding:0 8px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.nm-within{border-color:var(--ion);color:var(--ion)}.nm-border{border-color:var(--signal);color:var(--signal)}.nm-starlink{color:var(--sky)}.nm-new{color:var(--violet)}
.nm-dist,.nm-when{white-space:nowrap}.nm-map{margin:16px 0}.nm-source{color:var(--muted);font-size:15px}.nm-empty{border-left:3px solid var(--sky);padding:6px 12px;background:rgba(111,180,255,.06);border-radius:0 10px 10px 0}
.nm-sm{color:var(--muted);font-size:14px}.nm-table td{padding:7px 12px;line-height:1.45}.nm-table td .nm-sm{font-size:13px}
.nm-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 32px;align-items:start}.nm-form p{margin:.6em 0}.nm-coords .nm-grid{gap:0 16px}.nm-coords input{width:11em}
@media (max-width:760px){.nm-cols{grid-template-columns:1fr}}
@media (max-width:600px){.nm-form input,.nm-coords input{width:100%}.nm-coords .nm-grid{display:block}}</style>`;

  const body = `${style}
${tool}
${expected}
${example}
${method}
${faqHtml}
${more}
${sources(NEAR_SOURCES)}
<p class="meta">Place names and time zones in the search: GeoNames (geonames.org), CC BY 4.0. Orbits: CelesTrak. This page was built from ${esc(sourceWords)}, from ${timeEl(dataTime)}.</p>
<script src="${esc(assets.page)}" defer></script>`;
  return {
    file, title: NEAR_TITLE, description: NEAR_DESCRIPTION, h1: NEAR_H1, kicker: "Satellites", crumbTitle: NEAR_CRUMB, wide: true,
    lead: `Choose a place and a distance, and this page works out which satellites have their ground point (the point straight below them) within that distance of the place right now, and every pass that comes that close in the next 24 hours, with the time, the closest distance and how sure that distance is, the satellite's height, speed and direction from you, and who owns it. The default place is ${ph}. It runs in your browser from the site's own orbit data, newest first.`,
    body, jsonld: [webPageLd({ file, title: NEAR_TITLE, description: NEAR_DESCRIPTION, dataTime: isoUtc(dataTime), crumbTitle: NEAR_CRUMB })],
  };
}
