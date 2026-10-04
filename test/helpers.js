// Loads the packed public/ data the same way the browser does, for tests.
import fs from "node:fs";
import { decodeSwarmFile, decodeStars, decodeCoast, decodeIds, decodeNames } from "../src/data.js";
import { decodeSwarm } from "../src/core.js";

const dir = new URL("../public/", import.meta.url);
const buf = (f) => { const b = fs.readFileSync(new URL(f, dir)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));

export function loadD() {
  const meta = json("meta.json");
  const raw = decodeSwarmFile(buf("swarm.bin"), meta.count);
  const D = {
    meta, swarmRaw: raw, swarm: decodeSwarm(raw.f32, raw.u16, meta.ref), stars: decodeStars(buf("stars.bin")), lines: json("lines.json"), aurora: new Uint8Array(buf("aurora.bin")),
    quakes: json("quakes.json"), events: json("events.json"), cities: json("cities.json"), coast: decodeCoast(buf("coast.bin")),
    later: { names: decodeNames(fs.readFileSync(new URL("names.txt", dir), "utf8")), ids: decodeIds(buf("ids.bin")), details: new Uint8Array(buf("details.bin")), impact: json("impact.json"), routes: json("routes.json"), airlines: json("airlines.json") },
  };
  D.quakes.events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  return D;
}
