// Builds the live satellite count page from a collector data folder, for the GitHub workflow that runs after each collection.
//   node site/build-live.mjs --data live --out live/pages
// Output (in --out): how-many-satellites-in-orbit/index.html, sitemap-live.xml (only when the site is indexable) and index.json, which
// lists each file with its hash so hosting/pull.php copies only what changed. Shape of index.json:
//   { schema: 1, satellitesVersion, siteUrl, noindex, generator, built, files: { "<path>": { sha256, size, changed } } }
// generator is a sha256 over the source files that shape the page (GENERATOR_FILES). The page is rebuilt only when the satellites feed
// has a new version, or the site address, the noindex mode or the generator changed, so the last modified time in the sitemap moves
// only when the numbers or the page itself can have changed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE, renderPage } from "./layout.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { satelliteCountPage, SATCOUNT_FILE, sitemapLive } from "./pages-satcount.mjs";

const NEED = ["details.bin", "satmeta.json", "swarm.bin"];
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// The files whose contents decide what the page looks like and says. A change to any of them rebuilds the page on the next run.
export const GENERATOR_FILES = ["satcount.mjs", "pages-satcount.mjs", "layout.mjs", "build-live.mjs"];
export function generatorHash() {
  const h = crypto.createHash("sha256");
  for (const name of GENERATOR_FILES) h.update(`${name}\n`).update(fs.readFileSync(new URL(`./${name}`, import.meta.url))).update("\n");
  return h.digest("hex");
}

export function buildLive({ dataDir, outDir, now = new Date(), noindex = SITE.noindex, bounds, generator = generatorHash() } = {}) {
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

  const read = (name) => fs.readFileSync(path.join(dataDir, feed.files[name]));
  const counts = countSatellites({ meta: JSON.parse(read("satmeta.json").toString("utf8")), details: read("details.bin"), swarm: read("swarm.bin") });
  assertPlausible(counts, bounds);  // throws before anything is written, so the previous page stays

  const iso = now.toISOString();
  const files = {};
  const put = (rel, text) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const buf = Buffer.from(text, "utf8");
    fs.writeFileSync(file, buf);
    files[rel] = { sha256: sha256(buf), size: buf.length, changed: iso };
  };
  put(SATCOUNT_FILE, renderPage(satelliteCountPage(counts, { updated: now }), { noindex }));
  const sitemapPath = path.join(outDir, "sitemap-live.xml");
  if (noindex) fs.rmSync(sitemapPath, { force: true }); else put("sitemap-live.xml", sitemapLive(iso));
  fs.writeFileSync(indexPath, JSON.stringify({ schema: 1, satellitesVersion: feed.version, siteUrl: SITE.url, noindex, generator, built: iso, files }, null, 1) + "\n");
  return { changed: true, version: feed.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    if (!process.env.SITE_URL || !process.env.SITE_URL.trim()) throw new Error("build-live: SITE_URL is required (set the repository variable SITE_URL), so the page gets the right canonical address");
    if (!arg("--data") || !arg("--out")) throw new Error("build-live: usage: node site/build-live.mjs --data <collector folder> --out <pages folder>");
    const r = buildLive({ dataDir: arg("--data"), outDir: arg("--out") });
    console.log(r.changed ? `build-live: built the satellite count page for satellites version ${r.version} (canonical base ${SITE.url}${SITE.noindex ? ", noindex" : ""})` : `build-live: satellites version ${r.version} and the page generator are unchanged, nothing to do`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
