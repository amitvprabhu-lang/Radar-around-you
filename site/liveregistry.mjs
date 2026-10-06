// How each family page of site/livepages.mjs is made, by key: the extension point for page families (docs/superpowers/specs/
// 2026-10-06-more-live-pages-design.md, section 3). LIVE_FAMILY is FAMILY_PAGES with, for each page:
//   read(rd, ctx)     the summary from the collector's data, for site/build-live.mjs. rd: { has(feed), json(feed, file), bytes(feed, file),
//                     time(feed), entry(feed) }; ctx: { now, places (a getter that reads the place list on first use, so a reader
//                     never spreads ctx), bounds }. Throws a StaleError for old data (the
//                     page is skipped), an error with skip: true for a page that has nothing to show (skipped, not a failure), and any
//                     other error for data that fails its guard (skipped, and the build exits with an error).
//   snapshot(h, ctx)  the summary from the data bundled in public/, for the deploy-time copy in site/build.mjs, or null when the data is
//                     not bundled. h: loadHazards() plus satellites; ctx: { now, allowStale: true }.
//   render(s, opts)   the page object for renderPage. opts: { built (the live files that exist), coast, history }.
//   hubRow(s, opts)   optional: the page's row on the /right-now/ hub (the hazard rows are made by hubRows in site/pages-hazard.mjs).
//   history(s)        optional: the headline numbers kept in history.json for the "change since the previous build" findings.
// A new family adds its pages to site/livepages.mjs and one entry per page here; a test checks that every page has read, snapshot and render.
import { FAMILY_PAGES } from "./livepages.mjs";
import { summariseQuakes, summariseSpace, summariseApproaches, summariseStorms, summariseFires } from "./hazard.mjs";
import { HAZARD_PAGE_FUNCTIONS } from "./pages-hazard.mjs";

const BUILDERS = {
  quakes: {
    read: (rd, o) => summariseQuakes(rd.json("quakes", "quakes.json"), o),
    snapshot: (h, o) => h.quakes && summariseQuakes(h.quakes, o),
  },
  aurora: {
    read: (rd, o) => summariseSpace({
      kp: rd.json("kp", "kp.json"),
      spaceweather: rd.has("spaceweather") ? rd.json("spaceweather", "spaceweather.json") : null,
      aurora: rd.has("aurora") ? { meta: rd.json("aurora", "aurora.json"), grid: rd.bytes("aurora", "aurora.bin") } : null,
    }, o),
    snapshot: (h, o) => h.kp && summariseSpace({ kp: h.kp, spaceweather: h.spaceweather, aurora: h.aurora }, o),
  },
  asteroids: {
    read: (rd, o) => summariseApproaches(rd.json("closeapproaches", "closeapproaches.json"), o),
    snapshot: (h, o) => h.closeapproaches && summariseApproaches(h.closeapproaches, o),
  },
  storms: {
    read: (rd, o) => summariseStorms(rd.json("storms", "storms.json"), { now: o.now, allowStale: o.allowStale, events: rd.has("events") ? { list: rd.json("events", "events.json"), dataTime: rd.time("events") } : null }),
    // GDACS events are not read at deploy time: the bundled list carries no data time
    snapshot: (h, o) => h.storms && summariseStorms(h.storms, o),
  },
  fires: {
    read: (rd, o) => summariseFires({ summary: rd.json("fires", "fires.json"), bin: rd.bytes("fires", "fires.bin") }, { now: o.now, allowStale: o.allowStale, places: o.places }),
    snapshot: (h, o) => h.fires && h.places && summariseFires(h.fires, { ...o, places: h.places }),
  },
};
const RENDER = { ...HAZARD_PAGE_FUNCTIONS };

export const LIVE_FAMILY = FAMILY_PAGES.map((p) => ({ ...p, ...BUILDERS[p.key], render: RENDER[p.key], hubRow: (BUILDERS[p.key] && BUILDERS[p.key].hubRow) || null, history: (BUILDERS[p.key] && BUILDERS[p.key].history) || null }));
export const liveFamily = (key) => LIVE_FAMILY.find((p) => p.key === key) || null;
export const FAMILY_RENDERERS = Object.fromEntries(LIVE_FAMILY.map((p) => [p.key, p.render]));
