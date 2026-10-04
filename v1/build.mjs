// Builds one self-contained page (dist/radar.html) from template.html, core.js, app.js,
// snapshot.json and the two Earth images. Libraries load from the jsDelivr CDN at runtime.
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const b64 = (f) => fs.readFileSync(new URL(f, import.meta.url)).toString("base64");

const snap = JSON.parse(read("snapshot.json"));
snap.aurora.points = snap.aurora.points.filter((p) => p[2] >= 2);
const snapJson = JSON.stringify(snap).replace(/</g, "\\u003c");

const imports = [
  'import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js";',
  'import * as satellite from "https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm";',
  'import * as Astro from "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/esm/astronomy.js";',
].join("\n");
const core = read("core.js").replace(/^export /gm, "");
const app = read("app.js")
  .replace("__TEX_DAY__", "data:image/jpeg;base64," + b64("earth-day.jpg"))
  .replace("__TEX_NIGHT__", "data:image/jpeg;base64," + b64("earth-night.jpg"));

const html = read("template.html")
  .replace("__SNAPSHOT__", () => snapJson)
  .replace("__APP__", () => `${imports}\n${core}\n${app}`);

fs.mkdirSync(new URL("dist/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("dist/radar.html", import.meta.url), html);
console.log("dist/radar.html", (html.length / 1024).toFixed(0), "KB");
