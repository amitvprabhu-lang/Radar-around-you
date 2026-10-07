// The satcat feed as the collector publishes it for pipeline/tests/fixtures/satcat_sample.csv.gz (a trim of the real catalogue of
// 2026-10-07): test/fixtures/satcat/ holds summary.json and one o-<code>.json per owner with 10 or more objects in Earth orbit. A Python test
// (pipeline/tests/test_satcat.py) checks those files are exactly what the collector makes, so these tests read real output.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countryFixture } from "./satfixture.mjs";
import { ROW_FIELDS } from "../../site/objects.mjs";

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

// A synthetic detail file as large as the largest real one (the United States had 18,356 objects in Earth orbit on 2026-10-07), with every
// kind, missing heights and radar cross-sections, and accented names, for the speed checks of the full table (unit and browser).
export function bigDetail(n = 18000, owner = "US", sourceTime = SATCAT_TIME) {
  const types = ["P", "P", "D", "D", "D", "R", "U"], words = ["STARLINK", "COSMOS", "FENGYUN 1C DEB", "SL-8 R/B", "IRIDIUM", "NOAA", "Türksat"];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = types[i % types.length], y = 1958 + (i * 7) % 68, alt = 200 + (i * 37) % 36000;
    rows.push([100000 - i, `${words[(i * 13) % words.length]} ${i}`, `${y}-${String(1 + (i % 300)).padStart(3, "0")}${"ABCDEFGH"[i % 8]}`, t, t === "P" ? "+-PBSX?"[i % 7] : "", `${y}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      95 + (i % 50), (i * 3) % 180, i % 11 ? alt + (i % 500) : null, i % 11 ? alt : null, i % 3 ? ((i * 7919) % 10000) / 1000 : null, ""]);
  }
  return { schema: 1, owner, name: "Big owner", sourceTime, count: n, fields: ROW_FIELDS, rows };
}
