// Inputs for the sky page tests: the real collector output saved from the data branch on 2026-10-06 (clouds read 01:30 UTC, satellites
// 00:01 UTC; test/fixtures/sky/), the app's star, constellation and city files from public/, and small hand-made cloud feeds.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeStars } from "../../src/data.js";
import { coastFromBuffer } from "../../site/pages-country.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
export const SKY_NOW = new Date("2026-10-06T02:00:00Z");
export const SAT_TIME = "2026-10-06T00:01:36Z";
export const realClouds = () => json("test/fixtures/sky/clouds-20261006.json");
export const realPrecise = () => json("test/fixtures/sky/precise-20261006.json");
export const skyCities = () => json("public/cities.json").map(({ id, name, country, lat, lon, tz }) => ({ id, name, country, lat, lon, tz }));
export const cityOf = (id) => skyCities().find((c) => c.id === id);
let skyCache = null;
export function skyData() {
  if (skyCache) return skyCache;
  const b = fs.readFileSync(path.join(root, "public/stars.bin"));
  skyCache = { stars: decodeStars(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), constellations: json("public/constellations.json"), starNames: json("public/starnames.json") };
  return skyCache;
}
export const skyCoast = () => coastFromBuffer(fs.readFileSync(path.join(root, "public/coast.bin")));
export const skyPlaces = () => json("public/places.json");
export const usno = (f) => json(`test/fixtures/usno/${f}.json`);

// A clouds.json for one or more cities with a flat cloud cover (or a function of the hour index), 36 hours from `fromIso`.
export function cloudsDoc(ids, { updated = "2026-10-06T01:00:00Z", from = "2026-10-06T01:00:00Z", cloud = 10, hours = 36 } = {}) {
  const t0 = Date.parse(from);
  const one = () => ({ updated, fetchedAt: updated, hours: Array.from({ length: hours }, (_, i) => ({ t: new Date(t0 + i * 3600e3).toISOString().replace(".000Z", "Z"), cloud: typeof cloud === "function" ? cloud(i) : cloud, temp: 10 })) });
  return { cities: Object.fromEntries(ids.map((id) => [id, one()])) };
}
