// A pretend live folder for the widget checks (test/embed.test.js, e2e-embed.mjs): the real feed files in test/fixtures (earthquakes,
// storms and fires of 4 October 2026, Kp of 5 October, the cloud forecast of 6 October) with every time moved by the same amount, so
// that each feed's own time is `ageMin` minutes before `now`. Relative ages and windows stay as they were. Returns { files: Map of
// "live/..." paths to objects or Buffers, manifest }.
import fs from "node:fs";

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const json = (f) => JSON.parse(fx(f));
const TIME_KEYS = new Set(["t", "updated", "issued", "valid", "generated", "newest", "time"]);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// every time-like field moved by delta; a time without a zone (NOAA's Kp tags) keeps having none
export function shiftTimes(value, delta) {
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, delta));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (!(TIME_KEYS.has(k) && typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v))) return [k, shiftTimes(v, delta)];
      const z = /(Z|[+-]\d\d:\d\d)$/.test(v), out = iso(Date.parse(z ? v : v + "Z") + delta);
      return [k, z ? out : out.slice(0, -1)];
    }));
  }
  return value;
}
export const FIXTURE_TIMES = { quakes: "2026-10-04T13:49:21Z", kp: "2026-10-05T15:00:00Z", storms: "2026-10-04T19:55:59Z", fires: "2026-10-04T17:15:00Z", clouds: "2026-10-06T01:17:49Z" };
export function embedPack(now = Date.now(), { ageMin = 20, version = "v1" } = {}) {
  // NOAA tags Kp periods on a three-hour grid, so the Kp file moves by whole periods (its newest period then starts up to three hours
  // before the others' time)
  const d = (feed) => { const x = now - ageMin * 6e4 - Date.parse(FIXTURE_TIMES[feed]); return feed === "kp" ? Math.floor(x / 108e5) * 108e5 : x; };
  const docs = {
    "quakes/quakes.json": shiftTimes(json("hazards/quakes.json"), d("quakes")),
    "kp/kp.json": shiftTimes(json("hazards/live-20261005/kp/20261005T183040Z/kp.json"), d("kp")),
    "storms/storms.json": shiftTimes(json("hazards/storms.json"), d("storms")),
    "fires/fires.json": shiftTimes(json("hazards/fires.json"), d("fires")),
    "fires/fires.bin": fx("hazards/fires.bin"),
    "clouds/clouds.json": shiftTimes(json("sky/clouds-20261006.json"), d("clouds")),
  };
  const files = new Map(), feeds = {};
  for (const [key, v] of Object.entries(docs)) {
    const [feed, file] = key.split("/");
    const rel = `${feed}/${version}/${file}`;
    files.set(`live/${rel}`, v);
    feeds[feed] = feeds[feed] || { version, status: "ok", files: {} };
    feeds[feed].files[file] = rel;
  }
  const manifest = { schema: 1, generatedAt: iso(now - ageMin * 6e4), pollSec: 300, feeds };
  files.set("live/manifest.json", manifest);
  return { files, manifest, docs };
}
