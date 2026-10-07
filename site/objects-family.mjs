// How each page of the "objects" family (OBJECT_PAGES in site/objects.mjs) is read, snapshotted, rendered and shown on the /right-now/
// hub: the entries site/liveregistry.mjs adds for it. Also objectsForCountries, which site/build-live.mjs uses to give the five country
// pages their objects section from the same data.
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { OBJECT_PAGES, NEW_OWNER_PAGES, OWNER_PAGES, OWNER_PAGE_MIN, summariseObjects, readDetail, ownerDetail } from "./objects.mjs";
import { rankingPage, ownerObjectsPage, objectsHubRow } from "./pages-objects.mjs";

// The catalogue summary bundled for the deploy-time copy of the ranking page (written by hand from a real collection, see
// docs/country-objects-sources.md); the live copy replaces it with the next pull. Owner pages have no deploy-time copy.
export const BUNDLED_SUMMARY = fileURLToPath(new URL("../public/satcat-summary.json", import.meta.url));

// A page with nothing to show is skipped, not failed (the registry's convention).
const skip = (msg) => Object.assign(new Error(msg), { skip: true });
// one summary per build (the reader object is new on every build), shared by every page of the family
const cache = new WeakMap();
function summaryOf(rd, o) {
  if (cache.has(rd)) { const c = cache.get(rd); if (c instanceof Error) throw c; return c; }
  try {
    const fast = rd.has("satellites") ? { meta: rd.json("satellites", "satmeta.json"), details: rd.bytes("satellites", "details.bin") } : null;
    const s = summariseObjects({ summary: rd.json("satcat", "summary.json"), paths: rd.files ? rd.files("satcat") : {}, fast }, { now: o.now, allowStale: o.allowStale, ...(o.objectBounds ? { bounds: o.objectBounds } : {}) });
    cache.set(rd, s);
    return s;
  } catch (e) { cache.set(rd, e); throw e; }
}

// A hash of everything a page shows except times and file paths: site/build-live.mjs keeps a page's dataTime (its dateModified, sitemap
// lastmod and the "numbers last changed" time) from the previous build while this key is the same, so the date moves only when a number
// on the page changes, not when only a data time does.
const NOT_CONTENT = new Set(["catTime", "satTime", "dataTime", "stale", "warnings", "time", "sourceTime", "path", "contentKey"]);
export const contentKeyOf = (s) => crypto.createHash("sha256").update(JSON.stringify(s, (k, v) => (NOT_CONTENT.has(k) ? undefined : v))).digest("hex").slice(0, 32);

// The summary with one owner's detail, for an owner page or a country page's section. Skips (not fails) an owner under the guard.
export function ownerSummary(rd, code, o) {
  const s = summaryOf(rd, o);
  const owner = s.owners.find((x) => x.code === code);
  const min = o.ownerMin === undefined ? OWNER_PAGE_MIN : o.ownerMin;
  if (!owner) throw skip(`${code} is not in the catalogue summary`);
  if (owner.total < min) throw skip(`${code} has ${owner.total} objects in Earth orbit, under ${min}`);
  if (!owner.file) throw skip(`${code} has no detail file`);
  const rows = readDetail(rd.json("satcat", owner.file), owner, s.catTime);
  const out = { ...s, code, detail: ownerDetail(rows, { catTime: s.catTime }) };
  // the owner page shows its own row, its neighbours in the ranking, the totals and its objects
  out.contentKey = contentKeyOf({ owner, detail: out.detail, totals: s.totals, ranks: s.owners.filter((x) => x.total > 0).map((x) => [x.code, x.total]), fast: s.fast, check: s.debrisCheck });
  return out;
}

// For site/build-live.mjs: the objects section of each country page, by code, and why a page has none. Never throws: without the satcat
// feed (a collector that has not fetched it yet) the pages are built as before and no reason is given; a stale, broken or missing file
// gives a reason, which the build prints as a warning.
// why: { <code>: reason } for each country without a section. tried: whether the feed is there at all.
export function objectsForCountries(rd, o) {
  const out = {}, reasons = [], why = {};
  if (!rd.has("satcat")) return { byCode: out, reasons, why, tried: false };
  for (const p of OWNER_PAGES.filter((x) => x.country)) {
    try { out[p.code] = ownerSummary(rd, p.code, o); } catch (e) { reasons.push(`${p.code}: ${e && e.message}`); why[p.code] = String(e && e.message); }
  }
  return { byCode: out, reasons, why, tried: true };
}

const readBundled = () => { try { return JSON.parse(fs.readFileSync(BUNDLED_SUMMARY, "utf8")); } catch { return null; } };
const RANKING_KEY = OBJECT_PAGES[0].key;
export const OBJECT_BUILDERS = Object.fromEntries(OBJECT_PAGES.map((p) => [p.key, p.key === RANKING_KEY ? {
  // a copy, so a change to its dataTime in site/build-live.mjs does not reach the owner pages built from the same summary
  read: (rd, o) => { const s = { ...summaryOf(rd, o) }; s.contentKey = contentKeyOf(s); return s; },
  // a bundled summary newer than the build's clock (a test with a pinned time) gives no deploy-time copy rather than an error
  snapshot: (h, o) => {
    const summary = readBundled();
    if (!summary || !(Date.parse(summary.sourceTime) <= (o.now instanceof Date ? o.now.getTime() : o.now) + 3600000)) return null;
    return summariseObjects({ summary, fast: h.satellites ? { meta: h.satellites.meta, details: h.satellites.details } : null }, { now: o.now, allowStale: true });
  },
  hubRow: objectsHubRow,
} : {
  read: (rd, o) => ownerSummary(rd, p.code, o),
  snapshot: () => null,
}]));
export const OBJECT_RENDER = Object.fromEntries(OBJECT_PAGES.map((p) => [p.key, p.key === RANKING_KEY
  ? (s, o = {}) => rankingPage(s, { built: o.built || [] })
  : (s, o = {}) => ownerObjectsPage(s, NEW_OWNER_PAGES.find((x) => x.code === p.code), { built: o.built || [] })]));
