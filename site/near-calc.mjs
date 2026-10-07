// The calculation of the "satellites near me" page, bundled on its own (site/near-assets.mjs) and run in a Web Worker so the page never
// freezes. Where a worker cannot start, the page loads this same file as a plain script and runs it on the main thread in short slices.
// It downloads the satellite feed from the site itself (the live folder when the manifest offers a newer complete set, otherwise the copy
// bundled with the site, as the app does in src/data.js), keeps it for the next run, and answers each run with a summary the page draws.
import { loadManifest } from "../src/live.js";
import { launchDateFromDay } from "../src/core.js";
import { decodeFeed, prepareSatellitesSteps, searchNear, tableRows, trackAround } from "./near.mjs";
import { TABLE_CAP, chooseSource } from "./near-ui.mjs";

const SAT_FILES = ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"];
let cache = null;          // { base, feed, info }
let prepared = null;       // { key, value }
let latest = 0;            // the newest run asked for; an older run stops at its next pause

async function getBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
async function getJson(url, init) { const r = await fetch(url, init); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
async function getText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); }

let baseMetaCache = null;  // { base, meta }: the bundled meta.json, read once
let failedVersion = null;  // a live version whose files failed to download: not tried again in this session

// base: the site's root address. Every run reads the live manifest again (it is small and asked for with no-store), so a run after the
// collector has published new data uses it; the decoded feed is kept while the chosen data stays the same. Reports the download through
// progress(loadedBytes, totalBytes or null).
export async function loadFeed(base, progress = () => {}, nowMs = Date.now()) {
  if (!baseMetaCache || baseMetaCache.base !== base) baseMetaCache = { base, meta: await getJson(base + "meta.json") };
  const baseMeta = baseMetaCache.meta, bundledTaken = Date.parse(baseMeta.taken);
  const manifest = await loadManifest((u, i) => fetch(u, i), base + "live/", 6000);
  let pick = chooseSource(manifest, bundledTaken, base + "live/", nowMs);
  if (pick.source === "live" && pick.version === failedVersion) pick = { source: "bundled", reason: "failed", version: null };
  const key = pick.source === "live" ? `live:${pick.version}` : "bundled";
  if (cache && cache.base === base && cache.key === key) return { ...cache, info: { ...cache.info, state: pick.state || null, reason: pick.reason || null, pollSec: manifest && manifest.pollSec ? manifest.pollSec : null } };
  let loaded = 0, total = null;
  const count = (p) => p.then((x) => { loaded += x.byteLength || x.length || 0; progress(loaded, total); return x; });
  const fetchSet = (path) => Promise.all([count(getBytes(path("swarm.bin"))), count(getBytes(path("ids.bin"))), count(getBytes(path("details.bin"))), count(getText(path("names.txt"))), count(getJson(path("precise.json")))]);
  let files = null, meta = baseMeta, info = null;
  if (pick.source === "live") {
    total = SAT_FILES.reduce((s, f) => s + (pick.sizes[f] || 0), 0) || null;
    try {
      const [set, satmeta] = await Promise.all([fetchSet((f) => pick.paths[f]), getJson(pick.paths["satmeta.json"])]);
      files = set; meta = { ...baseMeta, ...satmeta };
      info = { source: "live", version: pick.version, fetchedAt: pick.fetchedAt, state: pick.state, refreshSec: pick.refreshSec, taken: meta.taken };
    } catch {
      failedVersion = pick.version; files = null; meta = baseMeta; loaded = 0; pick = { source: "bundled", reason: "failed" };
    }
  }
  if (!files) {
    if (cache && cache.base === base && cache.key === "bundled") return { ...cache, info: { ...cache.info, reason: pick.reason } };
    const sizes = await getJson(base + "manifest.json").catch(() => []);
    const sz = Object.fromEntries((Array.isArray(sizes) ? sizes : []).map((m) => [m.file, m.raw]));
    total = SAT_FILES.reduce((s, f) => s + (sz[f] || 0), 0) || null;
    files = await fetchSet((f) => base + f);
    info = { source: "bundled", version: null, reason: pick.reason, fetchedAt: baseMeta.taken, taken: baseMeta.taken };
  }
  const [swarm, ids, details, names, precise] = files;
  const feed = decodeFeed({ meta, swarm, ids, details, names, precise });
  info.bytes = loaded;
  info.pollSec = manifest && manifest.pollSec ? manifest.pollSec : null;
  info.bundledTaken = baseMeta.taken;
  cache = { base, key: info.source === "live" ? `live:${info.version}` : "bundled", feed, info };
  return cache;
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
      return { k: x.sat.k, t: x.t, km: x.km, u: x.u, status: x.status, el: x.el, az: x.az, lit: x.lit, hKm: x.hKm, kms: x.kms, lat: x.lat, lon: x.lon, ageH: x.ageH };
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
