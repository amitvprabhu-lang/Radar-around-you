// Puts /satellites-near-me/ into the site build: the page from the satellite data bundled in public/ (site/build.mjs), and the same page
// again from the live feed the deploy build downloaded (site/near-refresh.mjs). Reads files; the page itself is pure (site/pages-near.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nearSummary } from "./near-summary.mjs";
import { nearPage } from "./pages-near.mjs";
import { buildNear } from "./near-assets.mjs";
import { NEAR_FILE } from "./near-ui.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// The six cities, as site/build.mjs loadCities reads them.
export const nearCities = () => JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8")).cities.map(({ id, name, lat, lon, tz }) => ({ id, name, lat, lon, tz }));

// The satellite files of a folder: the bundled public/ (meta.json) or a live satellites/<version>/ folder (satmeta.json over the bundled meta).
export function readSatelliteFiles(dir, baseMeta = null) {
  const r = (f) => fs.readFileSync(path.join(dir, f));
  const meta = baseMeta ? { ...baseMeta, ...JSON.parse(r("satmeta.json")) } : JSON.parse(r("meta.json"));
  return { meta, swarm: r("swarm.bin"), ids: r("ids.bin"), details: r("details.bin"), names: r("names.txt").toString("utf8"), precise: JSON.parse(r("precise.json")) };
}

// The page object and its two scripts, from the bundled data (or the files given).
export function nearBuild({ files = readSatelliteFiles(path.join(root, "public")), source = "bundled", dataTime = files.meta.taken } = {}) {
  const assets = buildNear();
  const summary = nearSummary(files, { source, dataTime });
  const page = nearPage(summary, { assets: { page: assets.page.file, calc: assets.calc.file }, cities: nearCities() });
  const dir = path.dirname(NEAR_FILE);
  return { page, summary, scripts: [assets.page, assets.calc].map((a) => ({ file: `${dir}/${a.file}`, code: a.code })) };
}
