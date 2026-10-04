// Loads the packed data files written by build_data.py. Everything is a static file, so a CDN can serve it.
// Files are loaded in two stages: the first stage is what the first picture needs, the second loads while the visitor looks around.
import { decodeSwarm } from "./core.js";

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

// Stage one: what the first picture needs. onProgress(fraction, label)
export async function loadCore(onProgress = () => {}) {
  const manifest = await json("manifest.json").catch(() => []);
  const sizes = Object.fromEntries(manifest.map((m) => [m.file, m.brotli || m.raw]));
  const wanted = [
    "meta.json", "swarm.bin", "stars.bin", "lines.json", "aurora.bin", "quakes.json", "events.json", "cities.json", "coast.bin",
    ...Object.values(TEXTURES),
  ];
  const total = wanted.reduce((s, f) => s + (sizes[f] || 20000), 0);
  let done = 0;
  const tick = (f, label) => { done += sizes[f] || 20000; onProgress(Math.min(0.99, done / total), label); };
  const track = (f, label, p) => p.then((r) => { tick(f, label); return r; });
  const [meta, swarmBuf, starsBuf, lines, auroraBuf, quakes, events, cities, coastBuf] = await Promise.all([
    track("meta.json", "Reading the catalogue", json("meta.json")),
    track("swarm.bin", "Placing satellites", bytes("swarm.bin")),
    track("stars.bin", "Lighting the stars", bytes("stars.bin")),
    track("lines.json", "Drawing constellations", json("lines.json")),
    track("aurora.bin", "Painting the aurora oval", bytes("aurora.bin")),
    track("quakes.json", "Finding earthquakes", json("quakes.json")),
    track("events.json", "Checking hazards", json("events.json")),
    track("cities.json", "Looking around you", json("cities.json")),
    track("coast.bin", "Tracing coastlines", bytes("coast.bin")),
  ]);
  return {
    meta,
    swarmRaw: decodeSwarmFile(swarmBuf, meta.count),
    stars: decodeStars(starsBuf),
    lines,
    aurora: new Uint8Array(auroraBuf),
    quakes, events, cities,
    coast: decodeCoast(coastBuf),
    onTexture: (f) => tick(f, "Painting the Earth"),
  };
}

// Stage two: search index, details, impact maps, routes. Loaded after the first frame.
export async function loadLater() {
  const [names, ids, details, impact, routes, airlines, precise] = await Promise.all([
    text("names.txt").then(decodeNames),
    bytes("ids.bin").then(decodeIds),
    bytes("details.bin").then((b) => new Uint8Array(b)),
    json("impact.json"),
    json("routes.json"),
    json("airlines.json"),
    json("precise.json"),
  ]);
  return { names, ids, details, impact, routes, airlines, precise };
}

export function expandSwarm(core) {
  return decodeSwarm(core.swarmRaw.f32, core.swarmRaw.u16, core.meta.ref);
}
