// The one list of every live page: the pages rebuilt from the collector's feeds by site/build-live.mjs (on GitHub after each collection)
// and copied to the site by hosting/pull.php. The build, the live sitemap, llms.txt, the site build's sitemap split and the tests all read
// it, and a test checks that hosting/lib.php allows every path in it. feeds: the collector feeds each page is built from.
//
// Page families (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, section 3). A family module lists its pages as
// { key, family, slug, file, feeds, name, guide, maxAgeHours } (plus an llms.txt note where it has one); adding a family is one more
// spread in FAMILY_PAGES below and one more entry per page in site/liveregistry.mjs (how each page is read, summarised and rendered).
// Everything else (the build, the deploy-time copies, the hub, the sitemap, llms.txt) looks pages up by key from these lists.
import { HUB_FILE, COUNTRY_PAGES } from "./satcountry.mjs";
import { HAZARD_PAGES, RIGHT_NOW_FILE } from "./hazard.mjs";
import { EVENT_PAGES } from "./events.mjs";

export const SATCOUNT_FILE = "how-many-satellites-in-orbit/index.html";

export const FAMILY_PAGES = [
  ...HAZARD_PAGES,
  ...EVENT_PAGES,
];
export const familyPage = (key) => FAMILY_PAGES.find((p) => p.key === key) || null;

const familyFeeds = [...new Set(FAMILY_PAGES.flatMap((p) => p.feeds))];
// the kinds of the satellite pages, which build-live.mjs builds together from the satellites feed (all or nothing)
const SATELLITE_KINDS = ["count", "country-hub", "country"];
export const LIVE_PAGES = [
  { file: SATCOUNT_FILE, kind: "count", feeds: ["satellites"] },
  { file: HUB_FILE, kind: "country-hub", feeds: ["satellites"] },
  ...COUNTRY_PAGES.map((p) => ({ file: p.file, kind: "country", feeds: ["satellites"] })),
  ...FAMILY_PAGES.map((p) => ({ file: p.file, kind: p.family, key: p.key, feeds: p.feeds })),
  { file: RIGHT_NOW_FILE, kind: "hub", feeds: [...new Set(["satellites", ...familyFeeds])] },
];
export const LIVE_FILES = LIVE_PAGES.map((p) => p.file);
// the satellite count page, the satellites by country hub and the five country pages
export const SATELLITE_FILES = LIVE_PAGES.filter((p) => SATELLITE_KINDS.includes(p.kind)).map((p) => p.file);
export const HAZARD_FILES = HAZARD_PAGES.map((p) => p.file);
export const EVENT_FILES = EVENT_PAGES.map((p) => p.file);
export const FAMILY_FILES = FAMILY_PAGES.map((p) => p.file);
export { RIGHT_NOW_FILE };
