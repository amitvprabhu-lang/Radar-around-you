// The About page: what the site is and what it does, in plain visible text for people, search engines and AI tools. Every statement
// comes from README.md or a source record and is traced in docs/about-sources.md. No hidden text, no volatile numbers (counts change;
// the page points to where they are shown instead), no FAQ markup.
import { esc, table, sources, SITE, href } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";

export const ABOUT_FILE = "about/index.html";
const go = (to) => href(ABOUT_FILE, to);
const a = (to, text) => `<a href="${go(to)}">${esc(text)}</a>`;
const ext = (url, text) => `<a href="${esc(url)}" rel="noopener">${esc(text)}</a>`;

const DESCRIPTION = "Radar Around You is a free live feed, drawn in 3D, of the satellites, aircraft, sky, earthquakes, aurora, storms and fires around you. What it does, where its data comes from and what it does not do.";

export function aboutPage() {
  const body = `
<h2 id="what">What is Radar Around You?</h2>
<p>Radar Around You is a free live feed, drawn in 3D, of what is above you (satellites, the International Space Station and aircraft), what is in tonight's sky (stars, constellations, the Moon, planets and passes), what is under your feet (earthquakes, shown cut open through the Earth) and what is happening around you (storms, fires, aurora and other hazards). Everything is drawn in 3D, and every object can be tapped for details or searched for by name. It is a free project, and it works for any place on Earth.</p>
<p><a class="cta" href="${go("index.html")}">Open the live app</a></p>

<h2 id="feeds">Which live feeds does it show?</h2>
<p>The app follows these feeds and updates them while you watch. New earthquakes, storms, fires, aurora, Kp readings, cloud forecasts and aircraft appear without a reload. When new satellite orbits arrive the app shows a Reload prompt instead of swapping them in, because new orbits change the numbering of every object.</p>
<ul><li>Satellite orbits and the satellite catalogue</li><li>Earthquakes</li><li>Storms, floods, fires and volcanoes</li><li>Tropical storms with forecast track and cone</li><li>Aurora forecast, the Kp index, solar wind and geomagnetic alerts</li><li>Active fire detections</li><li>Cloud forecasts and aircraft for six cities</li><li>Upcoming rocket launches</li></ul>
<p>If live data is not available the app falls back to a bundled snapshot, and says so: the clock chip shows SNAPSHOT instead of LIVE.</p>

<h2 id="features">What can you do with it?</h2>
<h3>Above you</h3>
<ul>
<li><strong>The globe.</strong> A 3D Earth with satellites, the International Space Station, earthquakes, storms, fires and aurora drawn on it. Tap any object for details, or search for a satellite, earthquake, star or place by name.</li>
<li><strong>Satellites and the ISS.</strong> Pass times for the ISS, other bright objects and satellites launched in the last 30 days come from SGP4, the model designed for NORAD element sets; every other satellite uses a faster approximation. Read ${a("guides/satellites/index.html", "how to spot the ISS and satellites")}, or see ${a(SATCOUNT_FILE, "how many satellites are in orbit")}.</li>
<li><strong>Starlink strings.</strong> It finds satellites from one recent launch that are still travelling in a line, and says when one can be seen from your place.</li>
<li><strong>Aircraft.</strong> Aircraft above six cities (listed under limits below), drawn as 3D airliners in the sky view.</li>
</ul>
<h3>In tonight's sky</h3>
<ul>
<li><strong>The sky view.</strong> A first-person 3D sky above any place you choose, with the Moon and its phase, planets, stars, constellations and satellites. A time slider moves through tonight.</li>
<li><strong>Tonight.</strong> One verdict for your place built from cloud cover, the Moon, the dark hours and the chance of aurora, with a timeline of what to look for: satellite and ISS passes, Starlink strings, planets and meteor showers near their peak.</li>
<li><strong>Stars and constellations.</strong> Tap a named star for its official IAU name, its constellation, its brightness and colour, and when it rises, is highest and sets for your place. Constellation figures and boundaries can be drawn in the sky. Browse ${a("constellations/index.html", "the 88 constellations")} and ${a("stars/index.html", "the stars with official names")}.</li>
<li><strong>The sky calendar.</strong> The next 90 days from your place: Moon phases, eclipses, planet events, meteor showers and the seasons, calculated with the astronomy-engine library. See the reference pages for ${a("moon-phases/index.html", "Moon phases")}, ${a("eclipses/index.html", "eclipses")}, ${a("planets/index.html", "planets")}, ${a("meteor-showers/index.html", "meteor showers")} and ${a("sky/index.html", "six city sky guides")}.</li>
<li><strong>Sky Lens.</strong> In the sky view, the Camera button puts the phone's rear camera behind the sky so that stars and satellites sit over the real sky. The picture stays on the device.</li>
</ul>
<h3>Under your feet</h3>
<ul>
<li><strong>The Under view.</strong> The Earth cut open through an earthquake and you, showing the crust, mantle and core, with the P and S waves travelling to you. Read ${a("guides/earthquakes/index.html", "how to read earthquake data")}.</li>
</ul>
<h3>Around you</h3>
<ul>
<li><strong>Storms, fires, quakes and aurora near you.</strong> The storms, fires, hazards, quakes and aurora near your place, most serious first, each with its source and an "as of" time. It links things only by distance and time and never claims that one caused another. Guides: ${a("guides/aurora/index.html", "aurora")}, ${a("guides/storms/index.html", "hurricanes")}, ${a("guides/fires/index.html", "fire detections")} and ${a("guides/asteroids/index.html", "asteroid close approaches")}.</li>
<li><strong>Rocket launches.</strong> Upcoming launches from The Space Devs, worded to match how exact the planned time is: a month or a quarter is never given a clock time.</li>
</ul>
<h3>Tools</h3>
<ul>
<li><strong>Share cards.</strong> A picture and a text version of an earthquake, a satellite pass, a Starlink string or the Tonight verdict, ready to share.</li>
<li><strong>Links and night use.</strong> Any screen and place can be shared or bookmarked as a link. A red light mode leaves only red light on the screen, for use at night.</li>
</ul>

<h2 id="data">Where does the data come from?</h2>
<p>Each card in the app says where its information comes from, with a link where the source has a page. These are the main sources.</p>
${table({ caption: "Sources of the data", head: ["What", "Source"], rows: [
  ["Earthquakes", `${ext("https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", "U.S. Geological Survey (USGS)")}`],
  ["Storms, floods, fires and volcanoes", `${ext("https://www.gdacs.org/About/overview.aspx", "GDACS")}, the Global Disaster Alert and Coordination System`],
  ["Tropical storms and their forecast tracks", `${ext("https://www.nhc.noaa.gov/", "NOAA National Hurricane Center")}`],
  ["Aurora, the Kp index, solar wind and geomagnetic alerts", `${ext("https://services.swpc.noaa.gov/", "NOAA Space Weather Prediction Center")}`],
  ["Active fire detections", `${ext("https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data", "NASA FIRMS")}, from three VIIRS satellites`],
  ["Satellite orbits and the catalogue", `${ext("https://celestrak.org/", "CelesTrak")}`],
  ["Aircraft above six cities", `${ext("https://api.adsb.lol", "adsb.lol")} (data under the ODbL 1.0 licence)`],
  ["Cloud forecasts for six cities", `${ext("https://api.met.no/", "MET Norway")}`],
  ["Rocket launches", `${ext("https://thespacedevs.com/llapi", "The Space Devs")} (Launch Library 2)`],
  ["Asteroid close approaches", `${ext("https://ssd-api.jpl.nasa.gov/doc/cad.html", "NASA JPL")} Close-Approach Data`],
  ["Star names and constellations", `${ext("https://www.iau.org/public/themes/constellations/", "IAU")}, the International Astronomical Union`],
  ["Star distances and details", `The ${ext("https://codeberg.org/astronexus/hyg", "HYG")} database`],
  ["Confirmed planets around stars", "NASA Exoplanet Archive"],
  ["Towns and cities for the place search", "GeoNames"],
  ["Moon phases, eclipses, planets and the seasons", "Calculated with the astronomy-engine library"],
] })}
<p>The page ${a("methods/index.html", "How we know")} lists the checks made and the things we could not confirm. Data keeps the terms of its source; each source's page, linked above or named in the app's credits, has them.</p>

<h2 id="fresh">How fresh is the data?</h2>
<p>The app can run on a bundled snapshot or on live data. A collector asks each source no more often than its published guidance allows, where the source gives any, checks the answer, and keeps the last good copy if a source fails. The clock chip in the app says LIVE only when live data is in use; otherwise it says SNAPSHOT. The Data status screen shows when each feed was last updated and whether it is fresh, retrying, stale or paused. How often a feed changes at its source depends on the source, from every minute for earthquakes to every two hours for satellite orbits, and the app checks each feed on its own schedule.</p>

<h2 id="limits">What does it not do?</h2>
<ul>
<li>It does not make weather or hazard forecasts of its own. For storms, fires, quakes and aurora it shows what the agencies publish, with their times.</li>
<li>It is not an emergency warning service. For safety information, follow your local authorities.</li>
<li>A fire detection is a heat signal, not a confirmed wildfire.</li>
<li>Cloud forecasts and aircraft overhead exist only for six cities: Pune, New York, London, Tromso, Tokyo and Sydney. The sky, calendar and Tonight work for any place.</li>
<li>Sky Lens is new and has not yet been tested on a real phone; it has been tested in a browser with a fake camera. Its starting field of view is a guess that you adjust by pinching.</li>
</ul>

<h2 id="privacy">Does it know where I am?</h2>
<p>You can choose to use your device's position. That position is used on the device to name your place, and it never leaves the device. The Sky Lens camera picture is shown only on the device and is never recorded or sent. You can also search for any town or city of about 15,000 people or more and use that instead.</p>

<h2 id="free">Is it free?</h2>
<p>Yes. Radar Around You is free to use, and its code is open source under the MIT licence. The code and the notes on each data source are on ${ext(SITE.repo, "GitHub")}.</p>

<h2 id="method">How is it checked?</h2>
<p>Moon phases, the seasons and solar eclipses on this site are compared with the US Naval Observatory's published tables whenever the site is built, and a page only quotes a comparison that actually ran. Every factual sentence in the guides comes from a source record that says where it was read and what could not be confirmed. See ${a("methods/index.html", "How we know")}.</p>

<h2 id="faq">Frequently asked questions</h2>
<h3>What is Radar Around You?</h3>
<p>A free live feed of what is above, around and under you: satellites and the ISS, aircraft over six cities, tonight's sky, earthquakes, aurora, storms and fires, for any place on Earth.</p>
<h3>Is it free?</h3>
<p>Yes. The code is open source under the MIT licence.</p>
<h3>Where does the data come from?</h3>
<p>From named agencies and projects such as USGS, NOAA, NASA, CelesTrak, MET Norway and The Space Devs. The table above lists each source, and each card in the app names its own.</p>
<h3>Does it work for my town?</h3>
<p>The sky view, calendar and Tonight work for any town or city of about 15,000 people or more, or for your device's position. Cloud forecasts and aircraft overhead exist only for six cities.</p>
<h3>Does it know where I am?</h3>
<p>You can choose to use your device's position, and that position never leaves your device.</p>
<h3>Is it a forecast or a warning service?</h3>
<p>No. It makes no weather or hazard forecasts of its own: for storms, fires, quakes and aurora it shows what the agencies publish, with their times. It is not an emergency warning service.</p>
${sources([
  { title: "Radar Around You on GitHub", url: SITE.repo, note: "The code, the licence and the notes on each data source" },
  { title: "CelesTrak", url: "https://celestrak.org/", note: "Satellite orbital element sets and catalogue" },
  { title: "US Naval Observatory, Astronomical Applications API", url: "https://aa.usno.navy.mil/data/api", note: "The published tables our calendar results are compared with" },
])}`;

  return {
    file: ABOUT_FILE, crumbTitle: "About",
    title: "What Radar Around You is and does: a live feed of satellites, quakes and aurora",
    description: DESCRIPTION,
    h1: "What is Radar Around You?", kicker: "About",
    lead: "A free live feed of what is above, around and under you: satellites and the ISS, aircraft over six cities, tonight's sky, earthquakes, aurora, storms and fires, in 3D, for any place on Earth.",
    body,
    jsonld: [{ "@context": "https://schema.org", "@type": "AboutPage", name: "What Radar Around You is and does", description: DESCRIPTION, url: `${SITE.url}/about/`, about: { "@type": "WebApplication", name: SITE.name, url: `${SITE.url}/` } }],
  };
}
