// The one list of every live page: the pages rebuilt from the collector's feeds by site/build-live.mjs (on GitHub after each collection)
// and copied to the site by hosting/pull.php. The build, the live sitemap, llms.txt, the site build's sitemap split and the tests all read
// it, and a test checks that hosting/lib.php allows every path in it. feeds: the collector feeds each page is built from.
import { HUB_FILE, COUNTRY_PAGES } from "./satcountry.mjs";
import { HAZARD_PAGES, RIGHT_NOW_FILE } from "./hazard.mjs";

export const SATCOUNT_FILE = "how-many-satellites-in-orbit/index.html";

// name: the page's short name, used as the link text in the home page's row of live pages (site/home-text.mjs); a test checks every
// entry has one, so a page added here is linked from the home page with a descriptive name.
const hazardFeeds = [...new Set(HAZARD_PAGES.flatMap((p) => p.feeds))];
export const LIVE_PAGES = [
  { file: SATCOUNT_FILE, kind: "count", feeds: ["satellites"], name: "Satellite count" },
  { file: HUB_FILE, kind: "country-hub", feeds: ["satellites"], name: "Satellites by country" },
  ...COUNTRY_PAGES.map((p) => ({ file: p.file, kind: "country", feeds: ["satellites"], name: `Satellites of ${p.phrase}` })),
  ...HAZARD_PAGES.map((p) => ({ file: p.file, kind: "hazard", key: p.key, feeds: p.feeds, name: p.name })),
  { file: RIGHT_NOW_FILE, kind: "hub", feeds: ["satellites", ...hazardFeeds], name: "Right now: every live figure" },
];
export const LIVE_FILES = LIVE_PAGES.map((p) => p.file);
// the satellite count page, the satellites by country hub and the five country pages
export const SATELLITE_FILES = LIVE_PAGES.filter((p) => p.feeds.length === 1 && p.feeds[0] === "satellites").map((p) => p.file);
export const HAZARD_FILES = HAZARD_PAGES.map((p) => p.file);
export { RIGHT_NOW_FILE };
