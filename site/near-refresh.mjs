// The last step of `npm run build:hosting`, after site/live-snapshot.mjs: when the deploy build downloaded the live satellite feed and it is
// newer than the copy bundled with the site, /satellites-near-me/ is written again from it, so the page's own numbers (the expected count,
// the example) come from the newest data the deploy had. Otherwise the page keeps the numbers from the bundled copy, which it labels as
// such. Same choice as the page's script (chooseSource in site/near-ui.mjs), same renderer (site/pages-near.mjs), same scripts (their names
// are read from the page already written). It never fails the build: any problem prints one line and leaves the page as it was.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage, SITE } from "./layout.mjs";
import { nearSummary } from "./near-summary.mjs";
import { nearPage } from "./pages-near.mjs";
import { nearCities, readSatelliteFiles } from "./near-site.mjs";
import { chooseSource, NEAR_FILE } from "./near-ui.mjs";

const SAFE_PATH = /^satellites\/[0-9TZ]+\/[a-z]+\.(bin|json|txt)$/;

// outDir: the built site. Returns the line to print.
export function refreshNearPage(outDir, { now = Date.now(), noindex = SITE.noindex } = {}) {
  const pageFile = path.join(outDir, NEAR_FILE);
  if (!fs.existsSync(pageFile)) return "near page: not in this build, nothing to refresh";
  const manifestFile = path.join(outDir, "live/manifest.json");
  if (!fs.existsSync(manifestFile)) return "near page: kept the bundled numbers (no live folder in this build)";
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const baseMeta = JSON.parse(fs.readFileSync(path.join(outDir, "meta.json"), "utf8"));
  const pick = chooseSource(manifest, Date.parse(baseMeta.taken), "", now);
  if (pick.source !== "live") return `near page: kept the bundled numbers (live satellite data not used: ${pick.reason})`;
  const files = manifest.feeds.satellites.files;
  for (const f of Object.values(files)) if (!SAFE_PATH.test(f)) return `near page: kept the bundled numbers (unexpected live path ${JSON.stringify(f).slice(0, 80)})`;
  const dir = path.join(outDir, "live", path.dirname(files["swarm.bin"]));
  const html = fs.readFileSync(pageFile, "utf8");
  const calc = /data-calc="(near-calc\.[0-9a-f]{10}\.js)"/.exec(html), page = /<script src="(near-page\.[0-9a-f]{10}\.js)" defer><\/script>/.exec(html);
  if (!calc || !page) return "near page: kept the bundled numbers (the built page names no scripts)";
  const summary = nearSummary(readSatelliteFiles(dir, baseMeta), { source: "live", dataTime: pick.fetchedAt });
  const out = renderPage(nearPage(summary, { assets: { page: page[1], calc: calc[1] }, cities: nearCities() }), { noindex });
  const tmp = pageFile + ".tmp";
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, pageFile);
  return `near page: rebuilt from the live satellite data of ${pick.fetchedAt} (${summary.active} active satellites)`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = fileURLToPath(new URL("../dist/site", import.meta.url));
  let line;
  try { line = refreshNearPage(outDir); } catch (e) { line = `near page: kept the bundled numbers (${String((e && e.message) || e).slice(0, 200)})`; }
  console.log(line);
}
