// llms.txt for the site, in the llmstxt.org layout: a name, a one line summary, then groups of links with a note each. It is built from the
// site's own page titles and descriptions, so it cannot drift from the pages. Written only when the site is indexable (see site/build.mjs).
// Nothing read says search engines or AI assistants use this file for ordinary sites; it is a small optional extra.
import { urlPath } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";
import { HUB_FILE } from "./satcountry.mjs";
import { HAZARD_PAGES, RIGHT_NOW_FILE } from "./hazard.mjs";

const clean = (s) => String(s).replace(/\s+/g, " ").trim();
// OURS: the live pages' descriptions hold today's numbers, so this file uses fixed notes instead.
const LIVE_NOTE = "A live count of active satellites in orbit, with breakdowns by owner, orbit, purpose and launch year.";
const HUB_NOTE = "Every owner in the satellite catalogue ranked by active satellites, as the catalogue records owners, with more detail for a few of them.";
// OURS: fixed notes and names for the hazard pages and the right-now hub, for the same reason. They are always listed, whether or not
// the site build wrote a copy of them (the deploy-time build writes only those whose data is bundled; the live copies arrive with the
// next pull), because they are pages of the site.
export const HAZARD_NOTES = {
  [RIGHT_NOW_FILE]: "The latest number from each live page (satellites, earthquakes, Kp, asteroid close approaches, tropical storms and fire detections), each with its data time.",
  "earthquakes-today/index.html": "Earthquakes of magnitude 2.5 and above in the last 24 hours from the USGS feed: counts by magnitude and by hour, the largest, and a map.",
  "aurora-tonight/index.html": "The latest planetary Kp index, the solar wind and NOAA's aurora forecast grid, from NOAA's Space Weather Prediction Center.",
  "asteroid-close-approaches/index.html": "Asteroid close approaches to Earth still to come in NASA JPL's list, with dates, distances in lunar distances and speeds.",
  "tropical-storms-now/index.html": "Active tropical storms and hurricanes in the US National Hurricane Center's basins, with wind, pressure and forecast tracks.",
  "wildfires-today/index.html": "Satellite fire detections in NASA FIRMS's 24 hour files, by satellite and densest place, with a map. Detections, not confirmed fires.",
};
const LIVE_HAZARD_LIST = [[RIGHT_NOW_FILE, "Right now"], ...HAZARD_PAGES.map((p) => [p.file, p.name])];
const REFERENCE = ["moon-phases/index.html", "eclipses/index.html", "meteor-showers/index.html", "planets/index.html", "seasons/index.html", "constellations/index.html", "stars/index.html", "sky/index.html"];

export function buildLlmsTxt({ pages, url, name, summary }) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const entry = (file, note) => {
    const p = byFile.get(file);
    if (!p) throw new Error(`llms: no page ${file}`);
    return `- [${clean(p.crumbTitle || p.h1)}](${url}/${urlPath(file)}): ${clean(note || p.description)}`;
  };
  const guides = pages.map((p) => p.file).filter((f) => /^guides\/[a-z0-9-]+\/index\.html$/.test(f));
  const lines = [
    `# ${name}`, "", `> ${clean(summary)}`, "",
    `${name} is a free project. The pages below are plain HTML that works without JavaScript; the live 3D app is at ${url}/.`, "",
    "## Start here",
    `- [The live app](${url}/): ${clean(summary)}`,
    entry("about/index.html"), entry("methods/index.html"), "",
    "## Sky reference", ...REFERENCE.map((f) => entry(f)), "",
    "## Guides", ...guides.map((f) => entry(f)), "",
    "## Live data", entry(SATCOUNT_FILE, LIVE_NOTE), entry(HUB_FILE, HUB_NOTE),
    ...LIVE_HAZARD_LIST.map(([f, title]) => `- [${title}](${url}/${urlPath(f)}): ${HAZARD_NOTES[f]}`), "",
  ];
  return lines.join("\n");
}
