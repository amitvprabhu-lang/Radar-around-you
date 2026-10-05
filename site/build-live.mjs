// Builds the live pages from a collector data folder, for the GitHub workflow that runs after each collection: the satellite count page,
// the satellites by country hub and the country pages.
//   node site/build-live.mjs --data live --out live/pages
// Output (in --out): how-many-satellites-in-orbit/index.html, satellites-by-country/index.html and satellites-by-country/<slug>/index.html,
// sitemap-live.xml (only when the site is indexable) and index.json, which lists each file with its hash so hosting/pull.php copies only
// what changed. Shape of index.json:
//   { schema: 1, satellitesVersion, siteUrl, noindex, generator, built, files: { "<path>": { sha256, size, changed } } }
// generator is a sha256 over the source files that shape the pages (GENERATOR_FILES). The pages are rebuilt only when the satellites feed
// has a new version, or the site address, the noindex mode or the generator changed, so the last modified time in the sitemap moves
// only when the numbers or the pages themselves can have changed.
// Every page is built in memory first and written only when all of them are ready, so a failure never leaves a partial set. A country
// page whose owner trips the guard (missing, or under 50 active satellites) is left out with a message; the copy on the site stays.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE, renderPage } from "./layout.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { satelliteCountPage, SATCOUNT_FILE, sitemapLive } from "./pages-satcount.mjs";
import { countryPageSet, coastFromBuffer } from "./pages-country.mjs";

const NEED = ["details.bin", "satmeta.json", "swarm.bin"];
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// The files whose contents decide what the pages look like and say. Paths are relative to site/, so the app modules the page code
// imports (the orbit model and the decoders in src/) and the coastlines are named with "../". A change to any of them rebuilds the
// pages on the next run. Everything is read from the repository (the workflow checks the repository out).
export const GENERATOR_FILES = ["satcount.mjs", "pages-satcount.mjs", "layout.mjs", "build-live.mjs", "satcountry.mjs", "svgmap.mjs", "pages-country.mjs",
  "../src/core.js", "../src/data.js", "../src/info.js", "../public/coast.bin"];
export const COAST_FILE = fileURLToPath(new URL("../public/coast.bin", import.meta.url));
export function generatorHash(files = GENERATOR_FILES) {
  const h = crypto.createHash("sha256");
  for (const name of files) h.update(`${name}\n`).update(fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)))).update("\n");
  return h.digest("hex");
}

export function buildLive({ dataDir, outDir, now = new Date(), noindex = SITE.noindex, bounds, generator = generatorHash(), coastFile = COAST_FILE, min } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const feed = manifest.feeds && manifest.feeds.satellites;
  if (!feed || !feed.version || !feed.files) throw new Error("build-live: the manifest has no satellites feed");
  for (const f of NEED) if (!feed.files[f]) throw new Error(`build-live: the manifest does not name ${f}`);

  const indexPath = path.join(outDir, "index.json");
  // Only this read is forgiving: a corrupt or truncated index.json (say, a crash while it was written) counts as no previous build, so the next run rebuilds and overwrites it.
  let prev = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.satellitesVersion === "string") prev = parsed;
  } catch { /* missing, unreadable or invalid: no previous build */ }
  const pagePath = path.join(outDir, SATCOUNT_FILE);
  if (prev && prev.satellitesVersion === feed.version && prev.noindex === noindex && prev.siteUrl === SITE.url && prev.generator === generator && fs.existsSync(pagePath)) {
    return { changed: false, version: feed.version };
  }

  // Everything below is built in memory; nothing is written until every page is ready, so a failure keeps the previous set whole.
  const read = (name) => fs.readFileSync(path.join(dataDir, feed.files[name]));
  // names.txt is optional: without it the country pages leave out the name families
  const satellites = { meta: JSON.parse(read("satmeta.json").toString("utf8")), details: read("details.bin"), swarm: read("swarm.bin"), names: feed.files["names.txt"] ? read("names.txt").toString("utf8") : null };
  const counts = countSatellites(satellites);
  assertPlausible(counts, bounds);  // throws before anything is written, so the previous pages stay
  const coast = coastFromBuffer(fs.readFileSync(coastFile));
  const country = countryPageSet(satellites, { coast, updated: now, ...(min === undefined ? {} : { min }) });

  const iso = now.toISOString();
  const texts = new Map([[SATCOUNT_FILE, renderPage(satelliteCountPage(counts, { updated: now }), { noindex })]]);
  for (const p of country.pages) texts.set(p.file, renderPage(p, { noindex }));
  const pageFiles = [...texts.keys()];
  if (!noindex) texts.set("sitemap-live.xml", sitemapLive(iso, pageFiles));

  const files = {};
  for (const [rel, text] of texts) {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const buf = Buffer.from(text, "utf8");
    fs.writeFileSync(file, buf);
    files[rel] = { sha256: sha256(buf), size: buf.length, changed: iso };
  }
  if (noindex) fs.rmSync(path.join(outDir, "sitemap-live.xml"), { force: true });
  fs.writeFileSync(indexPath, JSON.stringify({ schema: 1, satellitesVersion: feed.version, siteUrl: SITE.url, noindex, generator, built: iso, files }, null, 1) + "\n");
  return { changed: true, version: feed.version, skipped: country.skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    if (!process.env.SITE_URL || !process.env.SITE_URL.trim()) throw new Error("build-live: SITE_URL is required (set the repository variable SITE_URL), so the page gets the right canonical address");
    if (!arg("--data") || !arg("--out")) throw new Error("build-live: usage: node site/build-live.mjs --data <collector folder> --out <pages folder>");
    const r = buildLive({ dataDir: arg("--data"), outDir: arg("--out") });
    for (const s of r.skipped || []) console.log(`build-live: skipped ${s.file}: ${s.reason} (the copy already on the site stays)`);
    console.log(r.changed ? `build-live: built the live pages for satellites version ${r.version} (canonical base ${SITE.url}${SITE.noindex ? ", noindex" : ""})` : `build-live: satellites version ${r.version} and the page generator are unchanged, nothing to do`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
