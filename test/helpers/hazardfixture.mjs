// Small hand-made hazard feeds with known answers, in the shapes the collector writes (pipeline/validate.py and pipeline/hazards.py), and
// the real set saved from the data branch on 2026-10-05 (test/fixtures/hazards/live-20261005, collected about 18:40 UTC).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REAL_DIR = fileURLToPath(new URL("../fixtures/hazards/live-20261005/", import.meta.url));
export const REAL_NOW = new Date("2026-10-05T18:45:00Z");
const realManifest = () => JSON.parse(fs.readFileSync(path.join(REAL_DIR, "manifest.json"), "utf8"));
export const realFile = (feed, name) => fs.readFileSync(path.join(REAL_DIR, realManifest().feeds[feed].files[name]));
export const realJson = (feed, name) => JSON.parse(realFile(feed, name).toString("utf8"));
export const realPlaces = () => JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../public/places.json", import.meta.url)), "utf8"));
export function realFeeds() {
  return {
    quakes: realJson("quakes", "quakes.json"), kp: realJson("kp", "kp.json"), spaceweather: realJson("spaceweather", "spaceweather.json"),
    aurora: { meta: realJson("aurora", "aurora.json"), grid: realFile("aurora", "aurora.bin") }, closeapproaches: realJson("closeapproaches", "closeapproaches.json"),
    storms: realJson("storms", "storms.json"), fires: { summary: realJson("fires", "fires.json"), bin: realFile("fires", "fires.bin") },
  };
}

export const GEN = "2026-10-05T18:00:00Z";
const at = (h, m = 0) => new Date(Date.parse(GEN) - h * 3600e3 + m * 60e3).toISOString().replace(".000Z", "Z");
const quake = (id, mag, hoursBefore, place, extra = {}) => ({ id, mag, place, time: at(hoursBefore), lat: 10, lon: 20, depth: 10, status: "reviewed", felt: 0, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, ...extra });
// 8 events in the 24 hours before GEN, 2 older ones. Largest 6.4 (Fiji), two of 4.5 or more below 6, one listed at 2.45.
export const quakesDoc = (extra = {}) => ({
  generated: GEN,
  events: [
    quake("a1", 6.4, 2.5, "120 km S of Suva, Fiji", { depth: 580, lat: -19.2, lon: 178.4 }),
    quake("a2", 4.7, 5.2, "10 km N of Hilo, Hawaii", { status: "automatic" }),
    quake("a3", 4.5, 23.9, "Kermadec Islands region"),
    quake("a4", 3.1, 0.2, "5 km E of Anza, CA", { status: "automatic" }),
    quake("a5", 2.8, 0.25, "12 km W of Anza, CA"),
    quake("a6", 2.6, 12.0, "40 km SE of Akutan, Alaska"),
    quake("a7", 2.45, 1.0, "3 km N of Nome, Alaska"),
    quake("a8", 2.5, 23.0, "77 km W of Adak, Alaska"),
    quake("old1", 7.1, 30, "far away, Chile"),
    quake("old2", 3.0, 100, "older, Japan"),
  ],
  ...extra,
});

// Kp every three hours for 48 hours; the newest is 15:00 on the data day
export const kpRows = (vals = [1, 2, 3, 5, 5.33, 4.67, 6, 3.67, 2, 1, 0.67, 2.33, 3, 3.33, 4, 2.67]) =>
  vals.map((kp, i) => ({ t: new Date(Date.parse("2026-10-05T15:00:00Z") - (vals.length - 1 - i) * 3 * 3600e3).toISOString().slice(0, 19), kp }));

export const windDoc = (extra = {}) => ({
  updated: "2026-10-05T17:55:00Z", spacecraft: ["SOLAR1"], bucketMin: 5,
  points: [
    { t: "2026-10-05T12:00:00Z", speed: 400, density: 5, bt: 4, bz: 1.5 },
    { t: "2026-10-05T15:00:00Z", speed: 520.4, density: 3.2, bt: 7, bz: -6.25 },
    { t: "2026-10-05T17:55:00Z", speed: 480, density: null, bt: 5.5, bz: -2 },
  ],
  alerts: [
    { kind: "alert", headline: "ALERT: Geomagnetic K-index of 5", issued: "2026-10-05T03:52:00Z", kp: 5 },
    { kind: "warning", headline: "WARNING: Geomagnetic K-index of 4 expected", issued: "2026-10-05T09:10:00Z", kp: 4 },
  ],
  ...extra,
});

// a grid with values at chosen latitudes: north 65 has 30, north 58 has 12, south 70 has 9 (under the threshold), south 75 has 20
export function gridBytes(cells = [[65, 10, 30], [58, 200, 12], [-70, 5, 9], [-75, 300, 20]]) {
  const g = Buffer.alloc(360 * 181);
  for (const [lat, lon, v] of cells) g[(lat + 90) * 360 + lon] = v;
  return g;
}
export const gridMeta = { observation: "2026-10-05T17:50:00Z", forecast: "2026-10-05T18:40:00Z" };

const approach = (name, time, distLd, speedKms, h, timeSigma = "00:10") => ({ des: name, name, time, distAu: Number((distLd * 384400 / 149597870.7).toFixed(6)), distMinAu: 0, distMaxAu: 0, distKm: Math.round(distLd * 384400), distLd, speedKms, h, timeSigma });
export const approachesDoc = (extra = {}) => ({
  generated: GEN, version: "1.5", ldKm: 384400,
  approaches: [
    approach("2026 ZZ", "2026-10-04T23:59:00Z", 3.3, 6.6, 25.5),
    approach("2026 AA", "2026-10-05T03:00:00Z", 4.2, 9.1, 26.1),
    approach("2026 BB", "2026-10-07T11:20:00Z", 12.5, 5.5, 24.0, "1_02:01"),
    approach("2019 CC", "2026-10-09T08:00:00Z", 0.62, 14.8, 28.4, "< 00:01"),
    approach("2001 DD", "2026-11-20T23:59:00Z", 18.0, 21.3, 19.5),
    approach("2026 EE", "2026-10-12T00:00:00Z", 7.0, 3.2, null, null),
  ],
  ...extra,
});

export const stormsDoc = (extra = {}) => ({
  generated: GEN,
  storms: [
    { id: "al052026", name: "Alpha", basin: "Atlantic", class: "TS", classText: "Tropical storm", lat: 25.1, lon: -70.4, windKt: 50, windKmh: 93, pressureMb: 995, moveDeg: 315, moveKt: 12, advisory: "7", issued: "2026-10-05T15:00:00Z", updated: "2026-10-05T15:00:00Z", url: "https://www.nhc.noaa.gov/graphics_at5.shtml",
      track: [{ hours: 12, valid: "2026-10-06T00:00:00Z", lon: -71, lat: 26, windKt: 55 }, { hours: 24, valid: "2026-10-06T12:00:00Z", lon: -72, lat: 27.5, windKt: 65 }], cone: [], extras: [] },
    { id: "ep182026", name: "Rachel <b>", basin: "Eastern Pacific", class: "HU", classText: "Hurricane", lat: 20.4, lon: -116.2, windKt: 100, windKmh: 185, pressureMb: 960, moveDeg: 275, moveKt: 7, advisory: "034", issued: "2026-10-05T15:00:00Z", updated: "2026-10-05T15:00:00Z", url: "https://www.nhc.noaa.gov/graphics_ep3.shtml",
      track: [{ hours: 12, valid: "2026-10-06T00:00:00Z", lon: -117.3, lat: 20.5, windKt: 95 }], cone: [], extras: [] },
  ],
  ...extra,
});
export const gdacsEvents = [
  { id: "TC1", type: "TC", name: "Tropical Cyclone KOINU-26", alert: "Orange", country: "Japan", from: "2026-10-01T00:00:00", to: "2026-10-05T06:00:00", current: true, lat: 25, lon: 130, severity: "x", url: "https://www.gdacs.org/report.aspx?eventid=1&eventtype=TC" },
  { id: "EQ1", type: "EQ", name: "Earthquake", alert: "Green", from: "2026-10-01T00:00:00", to: "2026-10-01T00:00:00", lat: 1, lon: 1, url: "https://www.gdacs.org/x" },
];

// fires: cells as [latIndex, lonIndex, detections]; one cell near Pune, one in the Southern Ocean far from any place
export function fireFiles(cells = [[434, 1015, 40], [434, 1014, 7], [100, 400, 25]], extra = {}) {
  const bin = Buffer.alloc(cells.length * 12);
  cells.forEach(([li, lo, n], i) => { bin.writeUInt16LE(li, i * 12); bin.writeUInt16LE(lo, i * 12 + 2); bin.writeUInt16LE(n, i * 12 + 4); bin.writeFloatLE(10, i * 12 + 6); bin.writeUInt16LE(0, i * 12 + 10); });
  const det = cells.reduce((s, c) => s + c[2], 0);
  const summary = { newest: "2026-10-05T16:00:00Z", cells: cells.length, detections: det, lowConfidenceLeftOut: 9, rows: det + 9, bySatellite: { N: det - 30, N20: 20, N21: 10 }, cellDeg: 0.25, ...extra };
  return { summary, bin };
}
export const tinyPlaces = { fields: ["geonameid", "name", "ascii", "country", "lat", "lon", "tzIndex", "population"], p: [[1, "Pune", "", "IN", 18.5196, 73.8553, 0, 3000000], [2, "Mumbai", "", "IN", 19.0728, 72.8826, 0, 12000000]] };
