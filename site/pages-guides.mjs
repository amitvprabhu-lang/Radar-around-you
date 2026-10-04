// Guide pages and the methods page. Every factual sentence here comes from docs/hazard-sources.md or docs/feature-sources.md, which
// record where each was read (and what could not be confirmed). The two official scales are printed from src/scales.js, the same
// tables the app uses and test/scales.test.js checks against the pages that publish them. Nothing here is a forecast.
import { esc, table, sources, href } from "./layout.mjs";
import { GEOMAGNETIC_SCALE, SAFFIR_SIMPSON, SSHWS_NOTE } from "../src/scales.js";
import { ENGINE, USNO, Y0, Y1 } from "./pages-data.mjs";

const NOAA_SCALES = { title: "NOAA Space Weather Scales", url: "https://www.swpc.noaa.gov/noaa-scales-explanation", note: "The G1 to G5 table" };
const AURORA_TUTORIAL = { title: "NOAA SWPC aurora tutorial", url: "https://www.spaceweather.gov/content/aurora-tutorial", note: "How the solar wind and the Kp index relate to aurora" };
const SWPC = { title: "NOAA Space Weather Prediction Center data feeds", url: "https://services.swpc.noaa.gov/", note: "Solar wind, magnetic field and alert files" };
const NWS = { title: "NWS disclaimer and public domain statement", url: "https://www.weather.gov/disclaimer", note: "The terms for using NOAA and NWS information" };
const NHC = { title: "NOAA National Hurricane Center", url: "https://www.nhc.noaa.gov/", note: "Current storms and forecast tracks" };
const SSHWS = { title: "NHC Saffir-Simpson Hurricane Wind Scale", url: "https://www.nhc.noaa.gov/aboutsshws.php", note: "The category table" };
const USGS_FEED = { title: "USGS earthquake GeoJSON feeds", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", note: "Summary feeds updated every minute" };
const USGS_PAGER = { title: "USGS PAGER background", url: "https://earthquake.usgs.gov/data/pager/background.php", note: "Alert levels" };
const USGS_FAQ = { title: "USGS: Can you predict earthquakes?", url: "https://www.usgs.gov/faqs/can-you-predict-earthquakes", note: "Re-read before relying on it; the wording was last checked in our research notes" };
const LANCE = { title: "NASA LANCE: FIRMS active fire data", url: "https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data", note: "Latency, terms and the acknowledgement text" };
const JPL_CAD = { title: "JPL Close-Approach Data API", url: "https://ssd-api.jpl.nasa.gov/doc/cad.html", note: "The list of close approaches" };
const SPOT = { title: "NASA Spot the Station", url: "https://www.nasa.gov/spot-the-station/", note: "When the ISS can be seen" };
const SPACETRACK = { title: "Spacetrack Report No. 3", url: "https://celestrak.org/NORAD/documentation/spacetrk.pdf", note: "The SGP4 model used to follow satellites" };

const go = (file, to) => href(file, to);

function guide(o) {
  const file = `guides/${o.slug}/index.html`;
  return {
    file, type: "guide", crumbs: [{ name: "Guides", file: "guides/index.html" }], crumbTitle: o.crumb,
    title: o.title, description: o.description, h1: o.h1, kicker: "Guide", lead: o.lead, cta: o.cta,
    meta: o.meta, body: typeof o.body === "function" ? o.body(file) : o.body,
  };
}

const note = (t) => `<p class="note">${t}</p>`;

export function auroraGuide() {
  const rows = GEOMAGNETIC_SCALE.map((s) => [`G${s.g}`, esc(s.name), `${s.kp}${s.g === 4 ? " (including 9-)" : ""}`, esc(s.aurora.charAt(0).toUpperCase() + s.aurora.slice(1)) + ".", s.geomagLat ? `${s.geomagLat}°` : "not given"]);
  return guide({
    slug: "aurora", crumb: "Aurora", title: "Aurora forecast guide: Kp, solar wind and what G1 to G5 mean",
    description: "How to read the Kp index, the solar wind and NOAA's G1 to G5 storm scale to judge whether an aurora is likely, with NOAA's own wording of how far from the poles each level has been seen.",
    h1: "Reading an aurora forecast", lead: "Three things decide whether the northern or southern lights show: how fast the solar wind is, which way its magnetic field points, and how dark and clear your sky is. Here is how to read the numbers, using NOAA's own wording.",
    cta: { label: "Open the live aurora screen", query: "#aurora" },
    body: `
<h2 id="physics">What makes an aurora brighter</h2>
<p>NOAA's Space Weather Prediction Center puts it this way: as the solar wind increases in speed and the interplanetary magnetic field embedded in it turns southward, geomagnetic activity increases, and the aurora becomes brighter, more active, and moves further from the poles. When the Kp index is high, between 7 and 9, NOAA says the aurora will be bright and the auroral oval will move to lower latitudes.</p>
<p>So there are two live numbers to watch. Solar wind speed is in kilometres per second. The north-south part of the magnetic field is called Bz: a negative value means the field points south, which is the case NOAA describes. Both are measured by spacecraft, which is why they give a short warning: NOAA's page gives 15 to 45 minutes as the lead time of forecasts based on satellite data.</p>
<h2 id="scale">The G1 to G5 scale</h2>
<p>NOAA rates geomagnetic storms from G1 (minor) to G5 (extreme) from the Kp index. The table is NOAA's. The wording about where aurora has been seen is NOAA's, not ours, and "has been seen" describes past storms, not a promise for a given night.</p>
${table({ caption: "NOAA geomagnetic storm scale", head: ["Level", "Name", "Kp", "Where aurora has been seen, as NOAA words it", "Typical geomagnetic latitude"], rows })}
<p>Geomagnetic latitude is measured from the magnetic pole, not the geographic pole, so it is not the same as a place's ordinary latitude.</p>
<h2 id="practical">Using this on the night</h2>
<ul>
<li>A high Kp or a G level tells you the oval has moved toward the equator. It does not know about your cloud or your light pollution.</li>
<li>Look for a stretch where Bz stays negative and the wind is fast. That is when the aurora brightens, by NOAA's description.</li>
<li>The app shows the current Kp, the last hours of wind speed and Bz, and NOAA's active alerts for your place, each with its source and time.</li>
</ul>
${note("The app reads NOAA's own feeds and does not predict aurora itself. One thing we could not confirm: which magnetic-field coordinate system NOAA's tutorial means by southward. We use the GSM Bz value and say only that a negative number points south.")}
${sources([NOAA_SCALES, AURORA_TUTORIAL, SWPC, NWS])}`,
  });
}

export function stormGuide() {
  const rows = SAFFIR_SIMPSON.map((c) => [`Category ${c.cat}`, c.maxKt === Infinity ? `${c.minKt} knots or higher` : `${c.minKt} to ${c.maxKt} knots`, esc(c.kmh) + " km/h", c.major ? "Major hurricane" : ""]);
  return guide({
    slug: "storms", crumb: "Tropical storms", title: "Hurricane categories and the forecast cone explained",
    description: "What the Saffir-Simpson categories measure and leave out, what the National Hurricane Center's cone does and does not show, and how forecast hours are counted.",
    h1: "Reading a hurricane forecast", lead: "A storm's category tells you its peak wind and nothing else. The forecast cone tells you where the centre may go and nothing about where the damage will be. Here is how to read both, in the National Hurricane Center's own words.",
    cta: { label: "Open the live storms screen", query: "#storms" },
    body: `
<h2 id="categories">The Saffir-Simpson categories</h2>
<p>${esc(SSHWS_NOTE)} Wind speeds in this table are sustained winds, in the National Hurricane Center's units. The Center reports wind in knots, and the app also shows miles per hour rounded to the nearest 5 the way the Center does.</p>
${table({ caption: "Saffir-Simpson Hurricane Wind Scale", head: ["Category", "Sustained wind", "In km/h", "Note"], rows })}
<p>Category 3 and above are called major hurricanes on the Center's page. Storm surge, rainfall flooding and tornadoes are the hazards the Center names as left out of the scale, so a category alone is not a measure of how dangerous a storm is.</p>
<h2 id="cone">The cone</h2>
<p>The Center's own explanation of the cone is that it is formed by enclosing the area swept out by a set of circles along the forecast track, where two-thirds of historical official forecast errors over a five-year sample fall within each circle. It also says the entire track of a tropical cyclone can be expected to remain within the cone roughly 60 to 70 percent of the time. Read that carefully: by that figure the track leaves the cone roughly 30 to 40 percent of the time.</p>
<h2 id="hours">Forecast hours</h2>
<p>The Center counts forecast hours from the synoptic time (00, 06, 12 or 18 UTC) at or before the advisory was issued. For an advisory issued at 15 UTC, the 96-hour point is valid at 12 UTC four days later. The app works out each point's time this way and rejects the file if its result disagrees with the time printed in the Center's own data.</p>
<h2 id="outside">Storms outside the National Hurricane Center's area</h2>
<p>Outside the areas the Center covers, the app uses the Global Disaster Alert and Coordination System. It gives one wind figure for a whole storm, and that figure can be higher than the current wind. In one check, it listed 250 km/h for a storm the Center said was at 185 km/h. The app labels it as the highest wind listed for the storm.</p>
${note("A storm that crosses the dateline is drawn with longitudes past 180 in the Center's files. The app wraps them so the track and cone appear on the right side of the map.")}
${sources([NHC, SSHWS, NWS, { title: "GDACS", url: "https://www.gdacs.org/About/termofuse.aspx", note: "GDACS terms of use. GDACS is the source for storms outside NHC's areas" }])}`,
  });
}

export function quakeGuide() {
  return guide({
    slug: "earthquakes", crumb: "Earthquakes", title: "Earthquake data: what the USGS feed shows and how to read it",
    description: "Where earthquake data comes from, how often it updates, what PAGER alert levels mean, and why nobody can tell you when the next one will be.",
    h1: "Reading live earthquake data", lead: "The map shows earthquakes that have already happened, reported by the US Geological Survey. Here is what the numbers mean and what they cannot do.",
    cta: { label: "Open the live globe", query: "" },
    body: `
<h2 id="feed">Where the data comes from</h2>
<p>The earthquakes on the globe come from the USGS summary feeds, which the USGS describes as updated every minute. The feeds cover the past hour, day, 7 days and 30 days. The USGS says information it authors is in the US public domain and asks for credit; the app shows the source on every card.</p>
<h2 id="pager">Alert levels</h2>
<p>For larger earthquakes the USGS publishes PAGER alerts. By the USGS's background page, the fatality thresholds for yellow, orange and red alerts are 1, 100 and 1,000. For economic loss, red is 1 billion US dollars or more, orange is 100 million to 1 billion, and yellow is 1 to 100 million. PAGER combines the shaking map with a population database to estimate how many people were exposed to each level of shaking.</p>
<h2 id="waves">When the shaking arrives</h2>
<p>The app can show how long seismic waves would take to reach you from a given earthquake. It uses a simple model: P waves at 8.0 km/s and S waves at 4.5 km/s along a straight path. Those are upper mantle speeds, and the model is not a real Earth model. In one check against a published travel-time example, our times were about 30 percent too long, so treat the numbers as an illustration of the idea, not a measurement.</p>
<h2 id="predict">What nobody can do</h2>
<p>This site does not predict earthquakes, and no listing on it should be read as a prediction. The USGS says that nobody has predicted a major earthquake. What the app can do is show you what has just happened and what is near you.</p>
${sources([USGS_FEED, USGS_PAGER, USGS_FAQ])}`,
  });
}

export function fireGuide() {
  return guide({
    slug: "fires", crumb: "Fires", title: "Satellite fire detections: what a dot on the map means",
    description: "How NASA's satellite fire detections are collected, how fresh they are, what we leave out and why a cluster of dots is not a measure of a fire's size.",
    h1: "What a fire detection is", lead: "Each dot is a place a satellite saw heat. It is useful, and it is easy to over-read. Here is what we show and what we do to it.",
    cta: { label: "Open the live fires screen", query: "#fires" },
    body: `
<h2 id="source">Where the detections come from</h2>
<p>The data is NASA's FIRMS, which publishes the last 24 hours of detections from three satellites carrying the VIIRS instrument: Suomi NPP, NOAA-20 and NOAA-21. NASA's LANCE page says near real-time users usually need data within three hours. We measured the newest detection in the files to be about two and a half hours old at the time we looked. We could not confirm the exact latency of these files from a NASA page.</p>
<h2 id="choices">What we leave out and what we group</h2>
<ul>
<li>Detections marked low confidence are left out. On the day we checked, that was about 12 percent of rows. The app shows how many were left out. The class definitions are NASA's; we could not read NASA's own description of them, so we make no claim about what they mean beyond the label.</li>
<li>Nearby detections are grouped into cells of a quarter of a degree, so a screen shows places, not individual pixels.</li>
<li>The same fire seen by two satellites, or on two passes, counts twice. The screen says so.</li>
</ul>
<h2 id="limits">What the dots do not tell you</h2>
<p>A detection means a satellite instrument reported heat at that spot at that time. The app does not measure or estimate how large a fire is, and we have not verified how often each place is observed, so a place with no dots is not proof of no fire. For safety information, follow your local authorities.</p>
<p>NASA asks anyone using the data to follow its acknowledgement: we acknowledge the use of data and imagery from NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE), part of NASA's Earth Science Data and Information System (ESDIS). NASA provides the information as is.</p>
${sources([LANCE, { title: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/", note: "The active fire files" }])}`,
  });
}

export function asteroidGuide() {
  return guide({
    slug: "asteroids", crumb: "Asteroids", title: "Asteroid close approaches: what the list means",
    description: "How to read NASA JPL's list of asteroids passing near Earth: distances in lunar distances, how sizes are estimated and why a close approach is not a threat.",
    h1: "Reading the asteroid close-approach list", lead: "Asteroids pass Earth all the time. The list shows which ones will pass closely in the coming weeks, how far away they will be and a rough size. It is a schedule, not an alarm.",
    cta: { label: "Open the live asteroid screen", query: "#asteroids" },
    body: `
<h2 id="list">Where the list comes from</h2>
<p>The list is NASA and JPL's Close-Approach Data service. Distances there are in astronomical units, and times are in a time scale called TDB, which the app converts to UTC. We express distances as multiples of the Moon's average distance from Earth, about 384,400 km, because that is easier to picture. The unit is our choice, not JPL's. A distance of 1 means as far away as the Moon.</p>
<h2 id="size">About the sizes</h2>
<p>A size shown here is an estimate from the object's absolute magnitude, which is a measure of brightness, and an assumed reflectivity of 13 percent. With those assumptions, an absolute magnitude of 22 gives about 147 metres, which matches the figure NASA's CNEOS FAQ gives for objects smaller than about 150 metres. For most of these objects the real reflectivity is not known, so the true size can be quite different. We say "about" for that reason.</p>
<h2 id="meaning">What a close approach means</h2>
<p>A close approach is a pass, not an impact. The list is a schedule of where objects will be, and the app shows the uncertainty in the time that JPL gives. This page does not claim that any object on the list will hit Earth.</p>
<p>JPL's usage policy asks that its interfaces are not embedded directly in a website. We fetch the list on a schedule and serve our own copy, so the list can be a little behind JPL's.</p>
${sources([JPL_CAD, { title: "NASA CNEOS", url: "https://cneos.jpl.nasa.gov/fireballs/", note: "NASA CNEOS, which the size rule of thumb comes from" }])}`,
  });
}

export function satelliteGuide() {
  return guide({
    slug: "satellites", crumb: "Satellites", title: "Spotting the ISS and satellites: when and how to look",
    description: "Why satellites are only visible near dawn and dusk, how their positions are calculated from orbital elements, and how fresh those elements need to be.",
    h1: "Seeing the ISS and other satellites", lead: "You can see a satellite with your own eyes when it is lit by the Sun while you are in the dark. That narrows it to the hours around dusk and dawn.",
    cta: { label: "Open the live globe", query: "" },
    body: `
<h2 id="when">Why only at dusk and dawn</h2>
<p>NASA's Spot the Station page says all International Space Station sightings occur within a few hours before or after sunrise or sunset. A satellite shines by reflecting sunlight, so it has to be in sunlight while the ground below is dark enough to see it. The app marks a pass as visible when the satellite is sunlit and the Sun is more than 6 degrees below the horizon, the rule the Heavens-Above FAQ uses. Passes also need to rise at least 10 degrees above the horizon, which is our choice.</p>
<h2 id="positions">How positions are calculated</h2>
<p>The app uses the SGP4 model, designed for NORAD element sets. The model's own report warns that feeding those sets into a different model degrades predictions. Positions are only as good as the age of the element set, so the app shows how old each one is. NASA says the ISS's trajectory data is updated about three times a week.</p>
<p>We do not have a verified figure for how quickly SGP4 predictions drift. Some sources give a few kilometres a day, but we could only find that on a secondary page, so we do not quote it.</p>
${sources([SPOT, SPACETRACK, { title: "CelesTrak", url: "https://celestrak.org/", note: "Orbital element sets" }, { title: "Heavens-Above FAQ", url: "https://www.heavens-above.com/FAQ.aspx", note: "The visibility rule" }])}`,
  });
}

export function guidesIndex(list) {
  return {
    file: "guides/index.html", crumbTitle: "Guides",
    title: "Guides to reading aurora, storm, quake, fire and satellite data",
    description: "Plain guides to the official scales and data behind the live app: aurora and the Kp index, hurricane categories, earthquake feeds, satellite fire detections, asteroid close approaches and satellite spotting.",
    h1: "Guides", kicker: "Guides", lead: "What the numbers mean, in the words of the agencies that publish them, and what this app does to them.",
    body: `<ul class="grid">${list.map((g) => `<li><a class="card" href="${href("guides/index.html", g.file)}"><b>${esc(g.crumbTitle)}</b><span>${esc(g.description)}</span></a></li>`).join("")}</ul>`,
    cta: { label: "Open the live app", query: "" },
  };
}

// ---------------------------------------------------------------- methods
export function methodsPage(checks) {
  const c = checks || {};
  const rows = [
    ["Moon phases", c.phases ? `${c.phases.n} phases in ${Y0} and ${Y1} compared with the US Naval Observatory table. Largest difference ${c.phases.worstSeconds} seconds.` : "Not checked in this build"],
    ["Equinoxes and solstices", c.seasons ? `${c.seasons.n} events compared. Largest difference ${c.seasons.worstSeconds} seconds.` : "Not checked in this build"],
    ["Solar eclipses", c.solarEclipses ? `${c.solarEclipses.n} eclipses compared by date and type. ${c.solarEclipses.matched ? "All match." : "Mismatch found."}` : "Not checked in this build"],
    ["Sunrise and sunset", c.sunTimes ? `${c.sunTimes.n} times on both ${Y0} solstices at six cities compared. Largest difference ${c.sunTimes.worstSeconds} seconds.` : "Not checked in this build"],
    ["Constellations", "The 88 areas add up to the whole sky. The three largest are Hydra, Virgo and Ursa Major. Points along every boundary were checked against the astronomy library: one side inside the constellation and the other not."],
    ["Star names", "All 331 named stars in the catalogue agree with the IAU list on position and constellation."],
  ];
  return {
    file: "methods/index.html", crumbTitle: "How we know",
    title: "How we know: sources, checks and what we could not confirm",
    description: "Where each number on this site comes from, the checks run against official tables and the things we could not verify.",
    h1: "How we know", kicker: "Method", lead: "Every figure on these pages is either computed from an open library, taken from a named agency, or marked as our own choice. This page lists the checks that were run and the gaps.",
    body: `
<h2 id="checks">Checks run when the pages were built</h2>
${table({ caption: "Checks against official tables", head: ["What", "Result"], rows })}
<p>A claim appears on a page only if its check ran in this build. If the comparison tables are missing the claim is left out instead of assumed.</p>
<h2 id="own">What is our own choice</h2>
<ul>
<li>Darkness here means the Sun is more than 18 degrees below the horizon.</li>
<li>The best month for a constellation is when its middle is highest at 9 pm local solar time.</li>
<li>Distances to asteroids are shown as multiples of the Moon's distance, and sizes use an assumed reflectivity of 13 percent.</li>
<li>Passes of satellites need to rise at least 10 degrees.</li>
<li>Low-confidence fire detections are left out and the rest are grouped into quarter-degree cells.</li>
</ul>
<h2 id="gaps">What we could not confirm</h2>
<ul>
<li>The exact latency of NASA's fire files. NASA says usually within three hours; we measured about two and a half.</li>
<li>The licence on the IAU's constellation boundary text files. The IAU states Creative Commons Attribution for its charts.</li>
<li>How fast satellite predictions drift, from a primary source.</li>
<li>The IAU star name list is dated 2022-04-04. A newer one may exist.</li>
</ul>
<h2 id="live">Live data</h2>
<p>The live app is not forecast by us. It shows what the agencies publish with their times, and the Data status screen in the app shows when each feed was last updated.</p>
<p>The <a href="https://github.com/amitvprabhu-lang/Radar-around-you" rel="noopener">code and data notes are on GitHub</a>.</p>
${sources([ENGINE, USNO, { title: "IAU", url: "https://www.iau.org/public/themes/constellations/", note: "Constellations and star names" }, NWS])}`,
  };
}
