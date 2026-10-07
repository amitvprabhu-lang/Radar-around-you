// The calculation of the "satellites near me" page, bundled on its own (site/near-assets.mjs) and run in a Web Worker so the page never
// freezes. Where a worker cannot start, the page loads this same file as a plain script and runs it on the main thread in short slices.
// It downloads the satellite feed from the site itself (the live folder when the manifest offers a newer complete set, otherwise the copy
// bundled with the site, as the app does in src/data.js), keeps it for the next run, and answers each run with a summary the page draws.
import { loadManifest } from "../src/live.js";
import { launchDateFromDay } from "../src/core.js";
import { decodeFeed, prepareSatellitesSteps, searchNear, tableRows, trackAround } from "./near.mjs";
import { TABLE_CAP, chooseSource } from "./near-ui.mjs";

const SAT_FILES = ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"];
let prepared = null;       // { key, value }
let latest = 0;            // the newest run asked for; an older run stops at its next pause

async function getBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
async function getJson(url, init) { const r = await fetch(url, init); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
async function getText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); }

let baseMetaCache = null;  // { base, meta }: the bundled meta.json, read once
// Live versions that could not be downloaded or decoded: never tried again in this session. The newest one is reported to the page.
const failedVersions = new Set();
let lastFailed = null;
// The decoded data: the last good live version and the bundled copy, each kept for the next run.
let goodLive = null, bundled = null;

// base: the site's root address. Every run reads the live manifest again (it is small and asked for with no-store), so a run after the
// collector has published new data uses it; decoded data is kept while the chosen data stays the same. Reports the download through
// progress(loadedBytes, totalBytes or null).
// One load at a time: a second run that starts while a download is going waits for it and then finds the data kept.
let loading = Promise.resolve();
export function loadFeed(base, progress = () => {}, nowMs = Date.now()) {
  const next = loading.then(() => loadFeedNow(base, progress, nowMs));
  loading = next.catch(() => {});
  return next;
}
// The choice, in order: the live version the manifest names, if it is new and not known to be broken; else the last good live version this
// session loaded (still newer than the bundled copy, because the bundled copy is only used when the live feed is older or missing); else
// the bundled copy. A live version is broken when a file is missing or the files do not fit together (decodeFeed's length checks).
// The bundled files are asked for with the bundled data time in the address, and meta.json with a unique one: a service worker or browser
// cache that keeps old copies of the bundled files (public/sw.js refreshes them in the background) can then never mix the files of two
// deploys, because every deploy's files have their own addresses. A mix that still slips through is refused by decodeFeed and ends in the
// page's error state, never in wrong names.
async function loadFeedNow(base, progress, nowMs) {
  if (!baseMetaCache || baseMetaCache.base !== base) { baseMetaCache = { base, meta: await getJson(base + "meta.json?n=" + Date.now(), { cache: "no-store" }) }; goodLive = null; bundled = null; }
  const baseMeta = baseMetaCache.meta, bundledTaken = Date.parse(baseMeta.taken);
  const manifest = await loadManifest((u, i) => fetch(u, i), base + "live/", 6000);
  const pollSec = manifest && manifest.pollSec ? manifest.pollSec : null;
  const pick = chooseSource(manifest, bundledTaken, base + "live/", nowMs);
  const extra = (info) => ({ ...info, pollSec, failedVersion: lastFailed, bundledTaken: baseMeta.taken });
  let loaded = 0, total = null;
  const count = (p) => p.then((x) => { loaded += x.byteLength || x.length || 0; progress(loaded, total); return x; });
  const fetchSet = (path) => Promise.all([count(getBytes(path("swarm.bin"))), count(getBytes(path("ids.bin"))), count(getBytes(path("details.bin"))), count(getText(path("names.txt"))), count(getJson(path("precise.json")))]);
  if (pick.source === "live" && !failedVersions.has(pick.version)) {
    if (goodLive && goodLive.version === pick.version) return { feed: goodLive.feed, info: extra({ ...goodLive.info, state: pick.state }) };
    total = SAT_FILES.reduce((t, f) => t + (pick.sizes[f] || 0), 0) || null;
    try {
      const [set, satmeta] = await Promise.all([fetchSet((f) => pick.paths[f]), getJson(pick.paths["satmeta.json"])]);
      const meta = { ...baseMeta, ...satmeta };
      const [swarm, ids, details, names, precise] = set;
      const feed = decodeFeed({ meta, swarm, ids, details, names, precise });
      const info = { source: "live", version: pick.version, fetchedAt: pick.fetchedAt, state: pick.state, refreshSec: pick.refreshSec, taken: meta.taken, bytes: loaded };
      goodLive = { version: pick.version, feed, info };
      return { feed, info: extra(info) };
    } catch {
      failedVersions.add(pick.version); lastFailed = pick.version; loaded = 0;
    }
  }
  // the newest data this session has: a good live version loaded before (newer than the bundled copy by the choice above)
  if (goodLive && Date.parse(goodLive.info.fetchedAt) > bundledTaken) return { feed: goodLive.feed, info: extra({ ...goodLive.info, reason: pick.source === "live" ? "failed" : pick.reason }) };
  const reason = pick.source === "live" ? "failed" : pick.reason;
  if (bundled) return { feed: bundled.feed, info: extra({ ...bundled.info, reason }) };
  const sizes = await getJson(base + "manifest.json").catch(() => []);
  const sz = Object.fromEntries((Array.isArray(sizes) ? sizes : []).map((m) => [m.file, m.raw]));
  total = SAT_FILES.reduce((t, f) => t + (sz[f] || 0), 0) || null;
  const [swarm, ids, details, names, precise] = await fetchSet((f) => `${base}${f}?v=${encodeURIComponent(baseMeta.taken)}`);
  const feed = decodeFeed({ meta: baseMeta, swarm, ids, details, names, precise });
  const info = { source: "bundled", version: null, fetchedAt: baseMeta.taken, taken: baseMeta.taken, bytes: loaded };
  bundled = { feed, info };
  return { feed, info: extra({ ...info, reason }) };
}

const satInfo = (sat, startMs) => {
  const launch = launchDateFromDay(sat.launchDay);
  return {
    id: sat.id, name: sat.name, owner: sat.owner, purpose: sat.purpose, launch: launch ? launch.toISOString().slice(0, 10) : null,
    orbit: sat.orbit, band: sat.band, starlink: sat.starlink, exact: sat.exact, recent: !!launch && startMs - launch.getTime() <= 30 * 86400000,
  };
};

// One run: msg { id, base, place, radiusKm, startMs }. post(message) answers; pause() gives the thread a turn (and lets a newer run in).
export async function run(msg, post, pause, budgetMs) {
  latest = msg.id;
  const { id, base, place, radiusKm, startMs } = msg;
  try {
    post({ type: "progress", id, stage: "download", loaded: 0, total: null });
    const { feed, info } = await loadFeed(base, (loaded, total) => post({ type: "progress", id, stage: "download", loaded, total }), startMs);
    if (latest !== id) return;
    // runs a generator, giving the thread a turn every budgetMs; null when a newer run has taken over
    const drive = async (gen, stage) => {
      let t0 = Date.now(), r;
      for (;;) {
        r = gen.next();
        if (r.done) return r.value;
        if (Date.now() - t0 >= budgetMs) {
          post({ type: "progress", id, stage, done: r.value.done, total: r.value.total });
          await pause();
          if (latest !== id) return null;
          t0 = Date.now();
        }
      }
    };
    // the prepared satellites depend only on the start time (old element sets are left out); reused within ten minutes
    const key = Math.floor(startMs / 600000);
    if (!prepared || prepared.key !== key || prepared.feed !== feed) {
      const value = await drive(prepareSatellitesSteps(feed, startMs), "prepare");
      if (!value) return;
      prepared = { key, feed, value };
    }
    const res = await drive(searchNear(prepared.value, place, { startMs, radiusKm }), "search");
    if (!res) return;
    await pause();  // the rows and tracks below in a task of their own
    if (latest !== id) return;
    const sats = new Map();
    const row = (x) => {
      if (!sats.has(x.sat.k)) sats.set(x.sat.k, satInfo(x.sat, startMs));
      return { k: x.sat.k, t: x.t, km: x.km, u: x.u, us: x.us, status: x.status, el: x.el, az: x.az, lit: x.lit, hKm: x.hKm, kms: x.kms, lat: x.lat, lon: x.lon, ageH: x.ageH };
    };
    const withTrack = (x) => ({ ...row(x), track: trackAround(x.sat, x.t) });
    const byTime = tableRows(res.passes, place, { order: "time", cap: TABLE_CAP }).map(withTrack);
    const byDistance = tableRows(res.passes, place, { order: "distance", cap: TABLE_CAP }).map(withTrack);
    const within = res.passes.filter((p) => p.status === "within").length;
    post({
      type: "result", id, info: { ...info, counts: res.counts }, place, radiusKm, startMs: res.startMs, endMs: res.endMs,
      now: res.now.map(row), byTime, byDistance, total: res.passes.length, within, borderline: res.passes.length - within,
      geo: res.geo.map((g) => ({ ...row(g), minKm: g.minKm, maxKm: g.maxKm, allDay: g.allDay })), sats: Object.fromEntries(sats),
    });
  } catch (e) {
    if (latest === id) post({ type: "error", id, message: String((e && e.message) || e) });
  }
}

// In a worker: answer messages. As a plain script in a page: offer the same run for the page's fallback.
const scope = typeof self !== "undefined" ? self : globalThis;
if (typeof scope.importScripts === "function" && typeof scope.document === "undefined") {
  scope.onmessage = (ev) => { if (ev.data && ev.data.type === "run") run(ev.data, (m) => scope.postMessage(m), () => new Promise((r) => setTimeout(r, 0)), 50); };
} else if (typeof window !== "undefined") {
  const channel = typeof MessageChannel === "function" ? new MessageChannel() : null;
  const waiting = [];
  if (channel) channel.port1.onmessage = () => { const f = waiting.shift(); if (f) f(); };
  const pause = () => new Promise((r) => { if (channel) { waiting.push(r); channel.port2.postMessage(0); } else setTimeout(r, 0); });
  window.RadarNearCalc = { run: (msg, post) => run(msg, post, pause, 12) };
}
