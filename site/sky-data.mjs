// The repository files the sky pages read besides the collector's feeds: the six cities, the star catalogue, the constellations and the
// star names in public/, read once and kept. Used by site/liveregistry.mjs (the live build and the deploy-time copies); the summaries in
// site/sky.mjs stay pure and get these as arguments.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeStars } from "../src/data.js";
import { SKY_CITY_IDS } from "./sky.mjs";

const pub = fileURLToPath(new URL("../public/", import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(pub, f), "utf8"));
export const SKY_STATIC_FILES = ["../public/cities.json", "../public/stars.bin", "../public/constellations.json", "../public/starnames.json"];

let cache = null;
// { cities: the six of SKY_CITY_IDS in that order ({ id, name, country, lat, lon, tz }), sky: { stars, constellations, starNames } }
export function skyStatic() {
  if (cache) return cache;
  const rows = json("cities.json");
  const cities = SKY_CITY_IDS.map((id) => {
    const c = rows.find((x) => x.id === id);
    if (!c) throw new Error(`sky: public/cities.json has no city ${id}`);
    return { id: c.id, name: c.name, country: c.country, lat: Number(c.lat), lon: Number(c.lon), tz: c.tz };
  });
  const b = fs.readFileSync(path.join(pub, "stars.bin"));
  cache = { cities, sky: { stars: decodeStars(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), constellations: json("constellations.json"), starNames: json("starnames.json") } };
  return cache;
}

// The data bundled in public/ for the deploy-time copies: the snapshot's cloud forecast (cities.json carries each city's forecast as the
// collector wrote it, with its own update time) and precise.json. null when the bundle has no forecast.
export function skySnapshotInputs() {
  const rows = json("cities.json");
  const clouds = { cities: Object.fromEntries(rows.filter((c) => SKY_CITY_IDS.includes(c.id) && c.clouds && Array.isArray(c.clouds.hours)).map((c) => [c.id, c.clouds])) };
  const precise = fs.existsSync(path.join(pub, "precise.json")) ? json("precise.json") : null;
  return { clouds: Object.keys(clouds.cities).length ? clouds : null, precise };
}
