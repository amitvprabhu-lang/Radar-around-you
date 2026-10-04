// A pretend live folder for tests: the bundled public/ files re-published the way the pipeline publishes them, with a
// later "taken" time and a few changed feeds, so tests can check that the app really uses live data.
import fs from "node:fs";

const pub = new URL("../public/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, pub));
export const baseMeta = JSON.parse(read("meta.json"));
export const isoNow = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 19) + "Z";

const feed = (version, files, at, extra = {}) => ({ label: version, source: "Test source", docUrl: "https://example.org/doc", says: "Updated every minute.", licence: "Test licence", credit: "Test credit",
  version, fetchedAt: at, checkedAt: at, sourceTime: at, count: 1, status: "ok", files, sizes: {}, note: "", error: null, failures: 0, nextTryAt: null, halted: null, refreshSec: 600, staleAfterSec: 2400, ...extra });

// returns { files: { "live/...": object or Buffer }, manifest }. Everything is dated `taken`.
export function livePack({ taken = "2026-10-04T19:00:00Z", withSatellites = true, version = "v1" } = {}) {
  const grid = Buffer.from(read("aurora.bin"));
  grid[100] = 77;
  const clouds = { cities: { pune: { updated: taken, fetchedAt: taken, hours: [{ t: taken, cloud: 11, temp: 22 }] } } };
  const planes = { cities: { london: { time: taken, fetchedAt: taken, aircraft: [{ hex: "abc123", call: "BAW1", type: "A320", lat: 51.5, lon: -0.1, altFt: 30000, gsKt: 400, track: 90, age: 1 }] } } };
  const quakes = { generated: "LIVE", events: [{ id: "x1", mag: 5.5, place: "Test place", time: taken, lat: 1, lon: 2, depth: 10, status: "", felt: 0, url: "" }] };
  const kp = [{ t: "2026-10-04T15:00:00", kp: 6.33 }];
  const dir = (id) => `live/${id}/${version}/`;
  const files = {
    [dir("quakes") + "quakes.json"]: quakes,
    [dir("events") + "events.json"]: [{ id: "TC1", type: "TC", name: "Storm", alert: "Red", country: "", from: "2026-10-04T00:00:00", to: "2026-10-06T00:00:00", current: true, lat: 10, lon: 120, severity: "", url: "" }],
    [dir("aurora") + "aurora.bin"]: grid, [dir("aurora") + "aurora.json"]: { observation: taken, forecast: taken },
    [dir("kp") + "kp.json"]: kp, [dir("clouds") + "clouds.json"]: clouds, [dir("planes") + "planes.json"]: planes,
  };
  const rel = (id, ...names) => Object.fromEntries(names.map((n) => [n, `${id}/${version}/${n}`]));
  const feeds = {
    quakes: feed(version, rel("quakes", "quakes.json"), taken, { label: "Earthquakes" }), events: feed(version, rel("events", "events.json"), taken, { label: "Storms, floods, fires and volcanoes" }),
    aurora: feed(version, rel("aurora", "aurora.bin", "aurora.json"), taken, { label: "Aurora forecast" }), kp: feed(version, rel("kp", "kp.json"), taken, { label: "Geomagnetic activity (Kp)" }),
    clouds: feed(version, rel("clouds", "clouds.json"), taken, { label: "Cloud forecast" }), planes: feed(version, rel("planes", "planes.json"), taken, { label: "Aircraft" }),
  };
  if (withSatellites) {
    const names = ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"];
    for (const n of names) files[dir("satellites") + n] = read(n);
    files[dir("satellites") + "satmeta.json"] = { ...Object.fromEntries(["ref", "count", "kinds", "owners", "ownerCodes", "sites", "siteCodes", "purposes", "newIdx", "health", "preciseCount"].map((k) => [k, baseMeta[k]])), taken };
    feeds.satellites = feed(version, rel("satellites", ...names, "satmeta.json"), taken, { label: "Satellite orbits", staleAfterSec: 21600, refreshSec: 7200 });
  }
  const manifest = { schema: 1, pipeline: 1, generatedAt: taken, pollSec: 300, feeds, static: [{ id: "stars", label: "Stars", note: "Fixed catalogue." }] };
  files["live/manifest.json"] = manifest;
  return { files, manifest };
}
