// The /embed/ gallery (an ordinary, indexable content page) and the five widget pages under it (noindex, not in any sitemap), written by
// the normal site build (site/build.mjs), so a deploy carries them and nothing on the server has to change. Every statement of fact on
// the gallery is traced in docs/embed-sources.md.
import fs from "node:fs";
import path from "node:path";
import { esc, href, SITE, sources } from "./layout.mjs";
import { webPageLd } from "./liveseo.mjs";
import { wSnippet } from "./embed-models.mjs";
import { WIDGETS, WIDGET_IDS, widgetFile, widgetHtml, coastRuns, coastEncode } from "./embed-widgets.mjs";
import { MAX_AGE_HOURS } from "./hazard.mjs";
import { SKY_MAX_AGE_HOURS, SKY_CITY_IDS } from "./sky.mjs";
import { skyStatic } from "./sky-data.mjs";
import { FAMILY_PAGES } from "./livepages.mjs";
const familyPage = (slug) => FAMILY_PAGES.find((p) => p.slug === slug) || null;

export const GALLERY_FILE = "embed/index.html";
export const EMBED_THEMES = ["auto", "light", "dark"];
// OURS: the size presets of the snippet generator; any size from 280 by 200 to 800 by 600 works.
export const EMBED_SIZES = [[300, 220, "Small"], [400, 300, "Medium"], [600, 400, "Large"], [800, 450, "Wide"]];
export const DEFAULT_SIZE = [400, 300];

// the lists the snippet is checked against (the same object goes into the gallery's script)
export function embedSpec(base = SITE.url, cityIds = SKY_CITY_IDS) {
  return { base, cities: cityIds, themes: EMBED_THEMES, widgets: Object.fromEntries(WIDGETS.map((w) => [w.id, { title: w.title, page: w.page, ...(w.city ? { city: true } : {}) }])) };
}
export const defaultSnippet = (id, spec = embedSpec()) => wSnippet(spec, { widget: id, width: DEFAULT_SIZE[0], height: DEFAULT_SIZE[1] });

// What each widget shows, for the gallery (OURS, describing site/embed-widgets.mjs; the limits come from the code).
const ABOUT = {
  earthquakes: `A world map of the earthquakes in the 24 hours up to the time of the U.S. Geological Survey's feed of magnitude 2.5 and above. Each quake is a dot sized by magnitude that sends out rings, larger and slower for larger quakes; quakes in the newest hour of the feed are red and those in its newest six hours yellow. Below the map: the newest quake with its place and how long ago it happened, the count and the largest magnitude, and at larger sizes the five newest.`,
  aurora: `The latest planetary Kp index from NOAA's Space Weather Prediction Center on a gauge from 0 to 9 with a needle that sweeps to the value, and a bar for each recent three-hour period. The stretch from Kp 5 to 9 is coloured by NOAA's geomagnetic storm levels G1 to G4, one colour each; G5 is Kp 9 itself, the end of the scale, and the filled arc and the bars take a fifth colour there. The text names the period and its storm level.`,
  "tropical-storms": `The active storms in the US National Hurricane Center's list (Atlantic, Eastern Pacific and Central Pacific), each a turning spiral at its position with NHC's forecast track, along which a dot travels. The text gives the strongest storm's wind in knots and km/h and its Saffir-Simpson category. When no storm is active it says so.`,
  wildfires: `Every quarter-degree cell with a satellite fire detection in NASA FIRMS's 24 hour files for the VIIRS instruments, brighter and yellower where there are more detections, with a soft band sweeping across the map. A detection is a place where a satellite saw heat, not a confirmed fire, and the text says so.`,
  "tonights-sky": `A sky chart for one of six cities (Pune, New York, London, Tromsø, Tokyo or Sydney): the Moon with its phase and the planets Mercury, Venus, Mars, Jupiter and Saturn, moving through tonight from sunset to sunrise, with their paths drawn faintly, and MET Norway's hourly cloud forecast for the night below it. The positions are worked out in your visitor's browser; the cloud comes from the site's live data.`,
};
const SOURCE_OF = {
  earthquakes: ["U.S. Geological Survey (USGS)", `${MAX_AGE_HOURS.quakes} hours`],
  aurora: ["NOAA Space Weather Prediction Center", `${MAX_AGE_HOURS.kp} hours`],
  "tropical-storms": ["NOAA National Hurricane Center", `${MAX_AGE_HOURS.storms} hours`],
  wildfires: ["NASA FIRMS (LANCE), VIIRS", `${MAX_AGE_HOURS.fires} hours`],
  "tonights-sky": ["Computed in the browser; cloud from MET Norway", `${SKY_MAX_AGE_HOURS.clouds} hours (the cloud forecast)`],
};
const LANCE_ACK = "We acknowledge the use of data and/or imagery from NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance), part of NASA's Earth Science Data and Information System (ESDIS).";
const SOURCES = [
  { title: "USGS earthquake feeds (GeoJSON)", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", note: "The magnitude 2.5 and above feed the earthquake widget reads" },
  { title: "NOAA Space Weather Prediction Center", url: "https://www.swpc.noaa.gov/", note: "The planetary Kp index; the G scale from its scales page" },
  { title: "NOAA National Hurricane Center", url: "https://www.nhc.noaa.gov/", note: "Active storms, advisories and forecast tracks; the Saffir-Simpson scale" },
  { title: "NASA LANCE: FIRMS active fire data", url: "https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data", note: "The 24 hour VIIRS fire files and the acknowledgement text" },
  { title: "MET Norway Locationforecast", url: "https://api.met.no/weatherapi/locationforecast/2.0/documentation", note: "The hourly cloud forecast. Data from The Norwegian Meteorological Institute, shortened MET Norway, CC BY 4.0" },
  { title: "Natural Earth", url: "https://www.naturalearthdata.com/about/terms-of-use/", note: "The coastlines on the maps, simplified; public domain" },
  { title: "Google Search Central: link spam", url: "https://developers.google.com/search/docs/essentials/spam-policies#link-spam", note: "Why the credit is one plain, visible link" },
];

export function galleryPage({ base = SITE.url, cities = SKY_CITY_IDS } = {}) {
  const file = GALLERY_FILE, spec = embedSpec(base, cities);
  const title = "Free live data widgets for your website";
  const description = "Five free live widgets for your own site: earthquakes, an aurora meter, tropical storms, wildfires and tonight's sky. One iframe and one credit line.";
  const rows = WIDGETS.map((w) => [esc(w.name), esc(SOURCE_OF[w.id][0]), esc(SOURCE_OF[w.id][1]), `<a href="${href(file, w.page + "index.html")}">${esc((familyPage(w.page.replace(/\/$/, "")) || {}).name || w.name)}</a>`]);
  const table = `<div class="tablewrap" role="region" tabindex="0" aria-label="The five widgets"><table><caption>The five widgets, their data and when each says its data is out of date</caption><thead><tr><th scope="col">Widget</th><th scope="col">Data</th><th scope="col">Out of date after</th><th scope="col">Matching live page</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const cards = WIDGETS.map((w) => `<h3 id="w-${w.id}">${esc(w.name)}</h3>
<p>${esc(ABOUT[w.id])}</p>
<p><iframe src="${href(file, widgetFile(w.id).replace(/index\.html$/, ""))}${w.city ? `?city=${cities[0]}` : ""}" width="${DEFAULT_SIZE[0]}" height="${DEFAULT_SIZE[1]}" title="${esc(w.title)}" loading="lazy" style="border:1px solid var(--line);border-radius:10px;max-width:100%;background:var(--ink2)"></iframe></p>
<p>The snippet for this widget at ${DEFAULT_SIZE[0]} by ${DEFAULT_SIZE[1]} pixels:</p>
<pre class="snip"><code>${esc(defaultSnippet(w.id, spec))}</code></pre>`).join("\n");
  const sizeOpts = EMBED_SIZES.map(([w, h, n]) => `<option value="${w}x${h}"${w === DEFAULT_SIZE[0] && h === DEFAULT_SIZE[1] ? " selected" : ""}>${n}, ${w} by ${h}</option>`).join("");
  const { cities: cityRows } = skyStatic();
  const cityName = (id) => (cityRows.find((c) => c.id === id) || { name: id }).name;
  const generator = `<form id="gen" class="gen" hidden>
<p><label for="g-widget">Widget</label><br><select id="g-widget">${WIDGETS.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select></p>
<p><label for="g-size">Size</label><br><select id="g-size">${sizeOpts}</select></p>
<fieldset><legend>Colours</legend>${EMBED_THEMES.map((t, i) => `<label><input type="radio" name="g-theme" value="${t}"${i === 0 ? " checked" : ""}> ${{ auto: "Follow the visitor's setting", light: "Light", dark: "Dark" }[t]}</label>`).join(" ")}</fieldset>
<p id="g-city-row"><label for="g-city">City (Tonight's sky only)</label><br><select id="g-city">${cities.map((c) => `<option value="${c}">${esc(cityName(c))}</option>`).join("")}</select></p>
<p><label for="g-out">Your snippet</label><br><textarea id="g-out" rows="6" readonly spellcheck="false"></textarea></p>
<p><button type="button" id="g-copy">Copy the snippet</button> <span id="g-done" role="status"></span></p>
<p>Preview:</p>
<div id="g-preview"></div>
</form>
<noscript><p>The snippet maker needs JavaScript. Every widget's snippet is printed in full above, ready to copy.</p></noscript>`;
  const body = `<style>.snip{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.gen select,.gen textarea,.gen button{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
.gen textarea{width:100%;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}.gen fieldset{border:1px solid var(--line);border-radius:10px;margin:12px 0;padding:8px 12px}
.gen fieldset label{margin-right:14px;white-space:nowrap}.gen button{cursor:pointer;border-color:var(--ion);color:var(--ion);font-weight:600}.gen [hidden]{display:none}</style>
<h2 id="widgets">The five widgets</h2>
<p>Each widget is a small page of its own on this site that draws one live view and says, in words under the picture, what it shows and when its data is from. Screen readers get the same numbers from a text description of the picture. The credit and the link back stay visible at the bottom of the widget at every size.</p>
${table}
${cards}
<h2 id="make">Make your snippet</h2>
<p>Pick a widget, a size and the colours, and for the sky widget a city; the snippet below updates, with a preview.</p>
${generator}
<h2 id="how">How to embed a widget</h2>
<ol>
<li>Copy the two lines of a snippet: the <code>iframe</code> and the credit line under it.</li>
<li>Paste them into your page's HTML where the widget should appear. Any size from 280 by 200 to 800 by 600 pixels works; the widget rearranges itself to fit, and on a narrow screen it shrinks with the page.</li>
<li>Options go in the address: <code>?theme=light</code> or <code>?theme=dark</code> fixes the colours (without it the widget follows your visitor's light or dark setting), and the sky widget takes <code>?city=</code> with one of ${cities.map((c) => `<code>${c}</code>`).join(", ")}. Anything else in the address is ignored.</li>
<li>If your site sends a content security policy, allow frames from ${esc(base)} (the <code>frame-src</code> directive).</li>
</ol>
<h2 id="credit">The credit line</h2>
<p>Each snippet ends with one plain line under the frame, "Live data by Radar Around You", linking to the live page with the same data. Please keep it visible and unchanged. It is a credit for the work of collecting, checking and drawing the data, the way a photo carries its photographer's name. We ask for nothing else: no other links, no keyword text, nothing hidden. Google's spam policies name keyword-rich, hidden or low-quality links in widgets that are spread across many sites as link spam, which is why the credit is one short, visible link with the site's name as its text. If your site's policy is to mark outside links with <code>rel="nofollow"</code>, you can add it.</p>
<h2 id="privacy">What a widget loads, and privacy</h2>
<p>A widget loads its own page and the site's live data files (the same files the live pages and the 3D app read), and nothing else: no cookies, no storage in the browser, no analytics or tracking, no fonts or scripts from other sites. Its page sets a content security policy that allows requests to this site only. Like any web page, the requests reach this site's web host. The animation stops for visitors who ask their system for reduced motion, while the widget is scrolled out of view and whenever the data is out of date. The widget looks for new data at most every five minutes, waits longer after a failed attempt, and does not look at all while its page is in a background tab or the widget is scrolled out of view; it downloads a data file again only when the file has changed.</p>
<h2 id="late">When data is late or missing</h2>
<p>Each widget compares the time of its data with the same limit the matching live page uses (the table above). Past that limit it stops moving and says in a yellow line that the data is out of date and how old it is; it does not guess or fill in. If the data cannot be loaded at all it says so in plain words and tries again later. The sky widget's chart is computed and still works without the data files; only its cloud strip then says the forecast is not available.</p>
<p>Fire data credit, as NASA asks: ${esc(LANCE_ACK)} Cloud data: The Norwegian Meteorological Institute, shortened MET Norway, licensed under CC BY 4.0. The Moon and planet positions are computed with a short set of formulas checked against the astronomy-engine library the sky pages use; the widget's maps use Natural Earth coastlines.</p>
${sources(SOURCES)}
<script>${galleryScript(spec)}</script>`;
  return {
    file, title, description, h1: "Live data widgets you can embed", kicker: "Embed", crumbTitle: "Embed live widgets",
    lead: "Put a small live view of earthquakes, aurora, tropical storms, wildfires or tonight's sky on your own page. Each widget is one <code>iframe</code> that reads the same data files as this site's live pages, names its source and data time, and comes with one visible credit line that links back here.",
    body, wide: false,
    jsonld: [webPageLd({ file, title, description, crumbTitle: "Embed live widgets" })],
  };
}

// The snippet maker: wSnippet by its source text, the lists, and a few lines that read the form (each value is checked against the lists
// by wSnippet) and set the text box and the preview frame through DOM properties.
export function galleryScript(spec) {
  return `(function(){
var S=${JSON.stringify(spec).replace(/</g, "\\u003c")};
${wSnippet.toString()}
var f=document.getElementById("gen");if(!f)return;f.hidden=false;
var $=function(i){return document.getElementById(i)},out=$("g-out"),pv=$("g-preview");
function go(){var sz=$("g-size").value.split("x"),th=(f.querySelector("input[name=g-theme]:checked")||{}).value,w=$("g-widget").value,c={widget:w,width:Number(sz[0]),height:Number(sz[1]),theme:th,city:$("g-city").value};
$("g-city-row").hidden=!S.widgets[w].city;
try{out.value=wSnippet(S,c)}catch(e){out.value="";return}
var fr=document.createElement("iframe"),q=[];if(S.widgets[w].city)q.push("city="+c.city);if(th!=="auto")q.push("theme="+th);
fr.loading="lazy";fr.src=w+"/"+(q.length?"?"+q.join("&"):"");fr.width=c.width;fr.height=c.height;fr.title=S.widgets[w].title;fr.style.border="0";fr.style.maxWidth="100%";
pv.textContent="";pv.appendChild(fr);$("g-done").textContent=""}
f.addEventListener("change",go);
$("g-copy").addEventListener("click",function(){var d=$("g-done");var ok=function(){d.textContent="Copied."};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(out.value).then(ok,function(){out.select();d.textContent="Select the text and copy it."});else{out.select();d.textContent="Select the text and copy it."}});
go();
})();`;
}

// Writes the five widget pages into the built site. coast: the app's coastlines (loadCoast in site/build.mjs).
export function writeEmbed(outDir, { coast }) {
  const enc = coastEncode(coastRuns(coast));
  const cities = Object.fromEntries(skyStatic().cities.map((c) => [c.id, { name: c.name, lat: c.lat, lon: c.lon, tz: c.tz }]));
  const files = [];
  for (const w of WIDGETS) {
    const f = path.join(outDir, widgetFile(w.id));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, widgetHtml(w, { coast: enc, cities }));
    files.push(widgetFile(w.id));
  }
  return files;
}
export { WIDGET_IDS };
