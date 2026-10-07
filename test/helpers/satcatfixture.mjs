// The satcat feed as the collector publishes it for pipeline/tests/fixtures/satcat_sample.csv.gz (a trim of the real catalogue of
// 2026-10-07): test/fixtures/satcat/ holds summary.json and one o-<code>.json per owner with 10 or more objects in Earth orbit. A Python test
// (pipeline/tests/test_satcat.py) checks those files are exactly what the collector makes, so these tests read real output.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countryFixture } from "./satfixture.mjs";

export const SATCAT_DIR = fileURLToPath(new URL("../fixtures/satcat/", import.meta.url));
export const SATCAT_TIME = "2026-10-07T04:04:48Z";
// the satellite data's time used with it, and a build time an hour after the catalogue
export const SAT_TIME_OBJ = "2026-10-07T04:20:22Z";
export const OBJECTS_NOW = new Date("2026-10-07T05:10:00Z");
// the sample has about a thousand objects, far under the real lower bound of 15,000
export const TEST_OBJECT_BOUNDS = { min: 100, max: 100000 };

export const satcatFiles = () => Object.fromEntries(fs.readdirSync(SATCAT_DIR).sort().map((f) => [f, fs.readFileSync(path.join(SATCAT_DIR, f))]));
export const satcatSummary = () => JSON.parse(fs.readFileSync(path.join(SATCAT_DIR, "summary.json"), "utf8"));
export const satcatDetail = (file) => JSON.parse(fs.readFileSync(path.join(SATCAT_DIR, file), "utf8"));

// Writes the satcat feed into a collector folder under satcat/<version>/ and returns its manifest entry. edit(name, buffer) may change a file.
export function writeSatcat(dir, version = "C1", edit = null) {
  const files = {}, sizes = {};
  fs.mkdirSync(path.join(dir, "satcat", version), { recursive: true });
  for (const [name, buf] of Object.entries(satcatFiles())) {
    const body = edit ? edit(name, buf) : buf;
    fs.writeFileSync(path.join(dir, "satcat", version, name), body);
    files[name] = `satcat/${version}/${name}`;
    sizes[name] = body.length;
  }
  const s = JSON.parse(fs.readFileSync(path.join(dir, "satcat", version, "summary.json"), "utf8"));
  return { version, files, sizes, sourceTime: s.sourceTime, count: s.totals.total };
}

// A whole collector folder: the country satellite fixture (taken at SAT_TIME_OBJ unless given) and the satcat feed.
export function objectsDataDir({ satVersion = "S1", satcatVersion = "C1", taken = SAT_TIME_OBJ, edit = null, dir = fs.mkdtempSync(path.join(os.tmpdir(), "obj-")), fx = countryFixture() } = {}) {
  const base = `satellites/${satVersion}`;
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify({ ...fx.meta, taken }));
  fs.writeFileSync(path.join(dir, base, "names.txt"), fx.names.join("\n"));
  const satcat = writeSatcat(dir, satcatVersion, edit);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: {
    satellites: { version: satVersion, files: { "details.bin": `${base}/details.bin`, "swarm.bin": `${base}/swarm.bin`, "satmeta.json": `${base}/satmeta.json`, "names.txt": `${base}/names.txt` } },
    satcat,
  } }));
  return dir;
}
