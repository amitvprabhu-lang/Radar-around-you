// Loads the packed data files written by build_data.py. Everything is a static file, so a CDN can serve it.
// Files are loaded in two stages: the first stage is what the first picture needs, the second loads while the visitor looks around.
import { decodeSwarm } from "./core.js";
import { LIVE_BASE, loadManifest, resolveSources, overlayCities } from "./live.js";
import { decodeFires } from "./connect.js";
import { decodePlaces } from "./places.js";
import { indexConstellations } from "./constellations.js";

const BASE = "";

// The preview build (npm run preview) ships binary files as base64 text, because the preview host only serves standard web types.
// __B64__ is replaced by the bundler; in a normal build the check below is dead code.
const B64 = typeof __B64__ !== "undefined" && __B64__;
export function decodeBase64(text) {
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function bytes(path) {
  const res = await fetch(BASE + path + (B64 ? ".txt" : ""));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return B64 ? decodeBase64(await res.text()) : res.arrayBuffer();
}
async function json(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
async function text(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

export function decodeSwarmFile(buf, count) {
  const f32 = new Float32Array(buf, 0, count * 2);
  const u16 = new Uint16Array(buf, count * 8, count * 6);
  return { f32, u16 };
}

export function decodeStars(buf) {
  const n = buf.byteLength / 6;
  const v = new DataView(buf);
  const out = { n, ra: new Float32Array(n), dec: new Float32Array(n), mag: new Float32Array(n), bv: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.ra[i] = (v.getUint16(i * 6, true) / 65535) * 360;
    out.dec[i] = (v.getUint16(i * 6 + 2, true) / 65535) * 180 - 90;
    out.mag[i] = v.getUint8(i * 6 + 4) / 25 - 1.5;
    out.bv[i] = v.getUint8(i * 6 + 5) / 100 - 0.4;
  }
  return out;
}

// Coastlines: pairs of int16 (lat*100, lon*100), a pair of 32767 ends a line.
export function decodeCoast(buf) {
  const v = new Int16Array(buf);
  const lines = [];
  let cur = [];
  for (let i = 0; i + 1 < v.length; i += 2) {
    if (v[i] === 32767) { if (cur.length > 1) lines.push(cur); cur = []; } else cur.push([v[i] / 100, v[i + 1] / 100]);
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

export function decodeIds(buf) {
  return new Uint32Array(buf);
}

// names.txt is one name per line in swarm order
export function decodeNames(txt) {
  return txt.split("\n");
}

export const TEXTURES = {
  day: "tex/day2k.webp", night: "tex/night2k.webp", water: "tex/water2k.webp", relief: "tex/relief2k.webp",
  clouds: "tex/clouds2k.webp", moon: "tex/moon512.webp",
};
export const TEXTURES_LATER = { day4k: "tex/day4k.webp", clouds1k: "tex/clouds1k.webp" };

// How long start-up waits for the live manifest before it shows the bundled snapshot instead.
const MANIFEST_WAIT_MS = 2500;

// Decode one live feed for the poller (the files are published by the pipeline, see pipeline/).
export async function loadFeedData(id, source) {
  const p = source.paths;
  if (id === "quakes") return json(p["quakes.json"]);
  if (id === "events") return json(p["events.json"]);
  if (id === "kp") return json(p["kp.json"]);
  if (id === "clouds") return json(p["clouds.json"]);
  if (id === "planes") return json(p["planes.json"]);
  if (id === "storms") return json(p["storms.json"]);
  if (id === "spaceweather") return json(p["spaceweather.json"]);
  if (id === "closeapproaches") return json(p["closeapproaches.json"]);
  if (id === "launches") return json(p["launches.json"]);
  if (id === "fires") {
    const [buf, summary] = await Promise.all([bytes(p["fires.bin"]), json(p["fires.json"])]);
    return decodeFires(buf, summary);
  }
  if (id === "aurora") {
    const [grid, meta] = await Promise.all([bytes(p["aurora.bin"]), json(p["aurora.json"])]);
    return { grid: new Uint8Array(grid), meta };
  }
  throw new Error(`no loader for feed ${id}`);
}

// The place search index (about 34,000 places, 1.9 MB, 0.9 MB compressed). Loaded only when someone searches for a place.
export async function loadPlaces() {
  return decodePlaces(await json("places.json"));
}

// Stage one: what the first picture needs. onProgress(fraction, label)
// Live files are used when the pipeline's manifest offers a complete set that is newer than the bundled snapshot;
// anything missing or failing falls back to the snapshot, and the fallbacks are reported in `live.fellBack`.
export async function loadCore(onProgress = () => {}, fetchManifest = (base, ms) => loadManifest((u, i) => fetch(u, i), base, ms)) {
  const [staticSizes, baseMeta, manifest] = await Promise.all([
    json("manifest.json").catch(() => []),
    json("meta.json"),
    fetchManifest(LIVE_BASE, MANIFEST_WAIT_MS),
  ]);
  const sizes = Object.fromEntries(staticSizes.map((m) => [m.file, m.brotli || m.raw]));
  const src = resolveSources(manifest, Date.parse(baseMeta.taken), LIVE_BASE);
  const used = {}, fellBack = [];
  const tryLive = async (id, fromLive, fromSnapshot) => {
    if (src[id]) {
      try { const r = await fromLive(src[id].paths); used[id] = src[id].version; return r; } catch { fellBack.push(id); }
    }
    return fromSnapshot();
  };
  const wanted = ["swarm.bin", "stars.bin", "lines.json", "aurora.bin", "quakes.json", "events.json", "cities.json", "coast.bin", ...Object.values(TEXTURES)];
  const total = wanted.reduce((n, f) => n + (sizes[f] || 20000), 0);
  let done = 0;
  const tick = (f, label) => { done += sizes[f] || 20000; onProgress(Math.min(0.99, done / total), label); };
  const track = (f, label, p) => p.then((r) => { tick(f, label); return r; });
  const [sat, starsBuf, lines, aur, quakes, events, baseCities, coastBuf, kpRows, clouds, planes, storms, fires, space, close, launches] = await Promise.all([
    track("swarm.bin", "Placing satellites", tryLive("satellites",
      async (p) => { const [buf, satmeta] = await Promise.all([bytes(p["swarm.bin"]), json(p["satmeta.json"])]); return { buf, satmeta }; },
      async () => ({ buf: await bytes("swarm.bin"), satmeta: null }))),
    track("stars.bin", "Lighting the stars", bytes("stars.bin")),
    track("lines.json", "Drawing constellations", json("lines.json")),
    track("aurora.bin", "Painting the aurora oval", tryLive("aurora",
      async (p) => { const [buf, meta] = await Promise.all([bytes(p["aurora.bin"]), json(p["aurora.json"])]); return { buf, meta }; },
      async () => ({ buf: await bytes("aurora.bin"), meta: null }))),
    track("quakes.json", "Finding earthquakes", tryLive("quakes", (p) => json(p["quakes.json"]), () => json("quakes.json"))),
    track("events.json", "Checking hazards", tryLive("events", (p) => json(p["events.json"]), () => json("events.json"))),
    track("cities.json", "Looking around you", json("cities.json")),
    track("coast.bin", "Tracing coastlines", bytes("coast.bin")),
    tryLive("kp", (p) => json(p["kp.json"]), async () => null),
    tryLive("clouds", (p) => json(p["clouds.json"]), async () => null),
    tryLive("planes", (p) => json(p["planes.json"]), async () => null),
    tryLive("storms", (p) => json(p["storms.json"]), async () => null),
    tryLive("fires", (p) => loadFeedData("fires", { paths: p }), async () => null),
    tryLive("spaceweather", (p) => json(p["spaceweather.json"]), async () => null),
    tryLive("closeapproaches", (p) => json(p["closeapproaches.json"]), async () => null),
    tryLive("launches", (p) => json(p["launches.json"]), async () => null),
  ]);
  const meta = { ...baseMeta, ...(sat.satmeta || {}) };
  if (kpRows) meta.kp = kpRows;
  if (aur.meta) meta.aurora = aur.meta;
  overlayCities(baseCities, clouds, planes);
  return {
    meta,
    swarmRaw: decodeSwarmFile(sat.buf, meta.count),
    stars: decodeStars(starsBuf),
    lines,
    aurora: new Uint8Array(aur.buf),
    quakes, events, cities: baseCities,
    hazards: { storms, fires, space, close, launches },
    coast: decodeCoast(coastBuf),
    live: { manifest, sources: src, used, fellBack, baselineTakenMs: Date.parse(baseMeta.taken) },
    onTexture: (f) => tick(f, "Painting the Earth"),
  };
}

// The start-up downloads in order: loadCore (the data files and the live manifest) at once, and startTextures (about 640 KB of
// maps) only when the manifest has arrived or its wait is over. Otherwise, on a slow connection, the manifest could queue behind the
// maps, miss loadCore's 2.5 s wait and the page would show the bundled snapshot. fetchFn is the manifest's fetch (for tests).
export function loadCoreThenTextures(onProgress, startTextures, fetchFn = (u, i) => fetch(u, i)) {
  let settle;
  const settled = new Promise((r) => { settle = r; });
  const fetchManifest = (base, ms) => { const p = loadManifest(fetchFn, base, ms); p.then(settle, settle); return p; };
  const core = loadCore(onProgress, fetchManifest);
  core.catch(() => settle());  // a failed start must not leave the textures waiting for ever
  const textures = settled.then(() => startTextures());
  textures.catch(() => {});  // reported through the awaited promise; this only stops an unhandled-rejection report
  return { core, textures };
}

// Stage two: search index, details, impact maps, routes. Loaded after the first frame.
// The satellite files come from the same group as the swarm (live or snapshot), so the indexes line up.
export async function loadLater(live = null) {
  const sat = live && live.used && live.used.satellites ? live.sources.satellites.paths : null;
  const P = (name) => (sat ? sat[name] : name);
  const [names, ids, details, impact, routes, airlines, precise, consDoc, starNames, starIdsBuf, starDetails] = await Promise.all([
    text(P("names.txt")).then(decodeNames),
    bytes(P("ids.bin")).then(decodeIds),
    bytes(P("details.bin")).then((b) => new Uint8Array(b)),
    json("impact.json"),
    json("routes.json"),
    json("airlines.json"),
    json(P("precise.json")),
    json("constellations.json"),
    json("starnames.json"),
    bytes("starids.bin"),
    json("stardetails.json").catch(() => null),  // distances, types and planets: the star cards still work without it
  ]);
  // constellations: the 88 IAU constellations; starInfo: IAU names by catalogue index; starIds: the Hipparcos number of every catalogue star
  return { names, ids, details, impact, routes, airlines, precise, constellations: indexConstellations(consDoc), starInfo: new Map(starNames.stars.map((x) => [x.i, x])), starNamesDoc: starNames, starDetails, starIds: new Uint32Array(starIdsBuf) };
}

export function expandSwarm(core) {
  return decodeSwarm(core.swarmRaw.f32, core.swarmRaw.u16, core.meta.ref);
}
