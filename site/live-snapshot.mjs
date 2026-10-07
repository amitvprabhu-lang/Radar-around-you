// The build-time copy of the published live data, so a deploy does not leave the site without it until the server's pull job runs.
// Every deploy on Hostinger replaces the whole site folder: until the next run of hosting/pull.php (every ten minutes) there is no live/
// folder (the app falls back to its bundled snapshot) and the live pages whose data is not bundled answer 404. This step runs after the
// site build (`npm run build:hosting`), downloads what the pull job would have copied and writes it into the build output:
//   1. the live data folder <out>/live/: manifest.json and every file it names, with the rules of radar_sync in hosting/lib.php (the same
//      path pattern, sizes checked against the manifest, JSON files must parse, the same file and run size limits; manifest.json written
//      last), and only the files the current manifest names;
//   2. the live pages listed in pages/index.json, written over the deploy-time copies at their public paths, with the rules of
//      radar_sync_pages (the same path whitelist, each file checked against its sha256 in the index, the same size limit), plus
//      sitemap-live.xml when the index lists it. Skipped for a noindex site, which gets no live sitemap (as site/build-live.mjs does).
// Each part is all or nothing: every file is checked in memory first, then written through a temporary name and renamed, and a part with
// any failed file writes nothing; the parts are independent (the live folder is written even when the pages fail). A download that fails
// never fails the build: the step prints one line and exits 0, and a part that failed leaves the output as the site build made it.
// Every request, its redirects (at most 3, https only, as radar_http) and its body share one time limit, and every request is aborted
// when it ends, so no open connection can hold the process. Controls: LIVE_SNAPSHOT=0 or --no-live-snapshot turn it off;
// LIVE_SNAPSHOT_BASE replaces the base.
//   node site/live-snapshot.mjs [--out dist/site] [--no-live-snapshot]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { LIVE_FILES } from "./livepages.mjs";

// the same values as hosting/lib.php (a test reads lib.php and checks they agree)
export const DEFAULT_BASE = "https://raw.githubusercontent.com/amitvprabhu-lang/Radar-around-you/data/";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_RUN_BYTES = 80 * 1024 * 1024;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
// radar_safe_path and radar_safe_page_path, copied; JavaScript's $ (without the m flag) matches only at the very end, like PHP's \z
export const LIVE_PATH_RE = /^[a-z]{2,24}\/[0-9]{8}T[0-9]{6}Z\/[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
export const PAGE_PATH_RE = /^(?:how-many-satellites-in-orbit\/index\.html|sitemap-live\.xml|satellites-by-country\/index\.html|satellites-by-country\/(?:united-states|china|united-kingdom|cis-former-ussr|japan)\/index\.html|(?:earthquakes-today|aurora-tonight|asteroid-close-approaches|tropical-storms-now|wildfires-today|right-now|starlink-tracker|natural-disasters-now|rocket-launches|iss-today|tonights-sky)\/index\.html|tonights-sky\/(?:pune|newyork|london|tromso|tokyo|sydney)\/index\.html|satellites-and-debris-by-country\/index\.html|satellites-by-country\/(?:france|india|intelsat|european-space-agency|germany|italy|globalstar|canada|south-korea|ses|orbcomm|spain|eutelsat|turkiye|australia|taiwan|sea-launch|argentina|o3b-networks)\/index\.html)$/;
export const LIVE_SITEMAP = "sitemap-live.xml";
// OURS: how long the step may take, so a slow or silent network cannot hold up a deploy
export const REQUEST_TIMEOUT_MS = 10000;
export const BUDGET_MS = 60000;
export const CONCURRENCY = 4;
export const STALE_HOURS = 24;
const USER_AGENT = "radar-around-you-build/1";

const noDots = (p) => !p.split("/").some((s) => s === ".." || s === ".");
export const safeLivePath = (p) => typeof p === "string" && LIVE_PATH_RE.test(p) && noDots(p);
// a page must be allowed by the server's whitelist and be in the live page registry (or be the live sitemap)
export const safePagePath = (p) => typeof p === "string" && PAGE_PATH_RE.test(p) && noDots(p) && (p === LIVE_SITEMAP || LIVE_FILES.includes(p));

// https only, as radar_http; plain http only on this machine (127.0.0.1 or localhost), for local tests.
const isLoopback = (u) => u.hostname === "127.0.0.1" || u.hostname === "localhost";
// Returns the base with one trailing slash, or null.
export function checkBase(base) {
  let u;
  try { u = new URL(String(base).trim()); } catch { return null; }
  if (!(u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u))) || u.username || u.password || u.search || u.hash) return null;
  return u.href.replace(/\/*$/, "/");
}

// The controls, from the environment and the command line. LIVE_SNAPSHOT=0 turns the step off; 1 or nothing leaves it on; any other
// value turns it off with a message, so a typo cannot make a test build download. LIVE_SNAPSHOT_TIMEOUT_MS and LIVE_SNAPSHOT_BUDGET_MS
// (whole milliseconds) can only shorten the time limits, for tests; a value that is not shorter than the default is ignored.
export function snapshotSettings({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (argv.includes("--no-live-snapshot")) return { enabled: false, reason: "turned off by --no-live-snapshot" };
  const raw = env.LIVE_SNAPSHOT == null ? "" : String(env.LIVE_SNAPSHOT);
  const v = raw.trim();
  if (v === "0") return { enabled: false, reason: "turned off by LIVE_SNAPSHOT=0" };
  if (v !== "" && v !== "1") return { enabled: false, reason: `LIVE_SNAPSHOT is ${JSON.stringify(raw)}; only 0 or 1 are understood, so the download is off` };
  const base = env.LIVE_SNAPSHOT_BASE == null ? "" : String(env.LIVE_SNAPSHOT_BASE).trim();
  const shorter = (name, max) => { const t = String(env[name] ?? "").trim(); return /^[1-9][0-9]*$/.test(t) && Number(t) < max ? Number(t) : null; };
  const timeoutMs = shorter("LIVE_SNAPSHOT_TIMEOUT_MS", REQUEST_TIMEOUT_MS), budgetMs = shorter("LIVE_SNAPSHOT_BUDGET_MS", BUDGET_MS);
  return { enabled: true, base: base || DEFAULT_BASE, ...(timeoutMs ? { timeoutMs } : {}), ...(budgetMs ? { budgetMs } : {}) };
}

const msText = (ms) => (ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${Math.max(0, Math.round(ms))} ms`);
class TooLarge extends Error {}
// a failure that a second try cannot fix (a refused redirect, too many redirects)
class Final extends Error {}
export const MAX_REDIRECTS = 3;   // as CURLOPT_MAXREDIRS in radar_http
const REDIRECT = new Set([301, 302, 303, 307, 308]);

// Gives up a response body that will not be read, so its connection is not left open.
function discard(res) {
  try { const p = res && res.body && typeof res.body.cancel === "function" ? res.body.cancel() : null; if (p && typeof p.catch === "function") p.catch(() => {}); } catch { /* already closed */ }
}

// Reads a response body, refusing anything over max bytes (by its declared length first, then while reading).
async function readLimited(res, max) {
  const declared = Number(res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : NaN);
  if (Number.isFinite(declared) && declared > max) { discard(res); throw new TooLarge(`too large (${declared} bytes, the limit is ${max})`); }
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0, done = false;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) { done = true; break; }
        n += r.value.length;
        if (n > max) throw new TooLarge(`too large (over ${max} bytes, the limit)`);
        chunks.push(Buffer.from(r.value));
      }
    } finally {
      if (!done) reader.cancel().catch(() => {});   // not awaited: a stalled body must not hold the step up
    }
    return Buffer.concat(chunks, n);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new TooLarge(`too large (${buf.length} bytes, the limit is ${max})`);
  return buf;
}

// Where a redirect may lead: https anywhere (radar_http sets CURLOPT_REDIR_PROTOCOLS to https), or plain http on this machine when the
// base itself is on this machine (local tests only). Returns the absolute target or throws Final.
function redirectTarget(res, from, loopbackBase) {
  const loc = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
  if (!loc) throw new Final("a redirect without a location");
  let u;
  try { u = new URL(loc, from); } catch { throw new Final(`a redirect to an address that does not parse (${JSON.stringify(loc)})`); }
  const ok = u.protocol === "https:" || (loopbackBase && u.protocol === "http:" && isLoopback(u));
  if (!ok || u.username || u.password) throw new Final(`redirect to ${u.href} refused (https only)`);
  return u.href;
}

// One GET with a time limit that covers the redirects, the answer and its body. Redirects are followed here, not by fetch, as radar_http
// follows them: at most 3, to https only. Never throws: { status, body } or { error, tooLarge, final }. However it ends, the request is
// aborted and any body that was not read is given up, so no connection stays open after this returns.
async function getOnce(fetchImpl, url, ms, max, loopbackBase) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: `no answer within ${msText(ms)}` }), ms); });
  const attempt = (async () => {
    let res = null;
    try {
      let at = url;
      for (let hops = 0; ; hops++) {
        res = await fetchImpl(at, { signal: ac.signal, redirect: "manual", headers: { "user-agent": USER_AGENT } });
        const status = Number(res.status);
        if (!REDIRECT.has(status)) break;
        if (hops >= MAX_REDIRECTS) throw new Final(`more than ${MAX_REDIRECTS} redirects`);
        const next = redirectTarget(res, at, loopbackBase);
        discard(res);
        res = null;
        at = next;
      }
      const status = Number(res.status);
      if (status !== 200) { discard(res); return { status }; }
      return { status, body: await readLimited(res, max) };
    } catch (e) {
      discard(res);
      // Node's fetch says only "fetch failed" and keeps the reason (such as ECONNREFUSED or ENOTFOUND) in its cause
      const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
      return { error: `${(e && e.message) || String(e)}${cause}`, tooLarge: e instanceof TooLarge, final: e instanceof Final };
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
    ac.abort();   // ends the request and its connection whatever happened (a no-op once the body was read)
  }
}

// A GET with at most one retry, after a network error, a timeout or a server error (5xx); never past the overall budget.
async function get(ctx, url, max) {
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = ctx.deadline - ctx.clock();
    if (left <= 0) return { error: `the ${msText(ctx.budgetMs)} budget for the whole step ran out` };
    r = await getOnce(ctx.fetchImpl, url, Math.min(ctx.timeoutMs, left), max, ctx.loopbackBase);
    const retry = (r.error && !r.tooLarge && !r.final) || (r.status >= 500 && r.status <= 599);
    if (!retry) break;
  }
  return r;
}
const why = (r) => (r.error ? r.error : `HTTP ${r.status}`);

// Fetches the jobs (each { key, url, max, check(buf) -> error text or null }) a few at a time and stops at the first failure.
async function fetchAll(ctx, jobs) {
  const got = new Map();
  let failure = null, next = 0;
  const worker = async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      const r = await get(ctx, job.url, job.max);
      if (failure) return;
      if (r.body === undefined) { failure = `${job.key}: ${why(r)}`; return; }
      const bad = job.check(r.body);
      if (bad) { failure = `${job.key}: ${bad}`; return; }
      got.set(job.key, r.body);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return failure ? { failure } : { got };
}

// Writes [absolute path, bytes] in order: every file to a temporary name first, then each renamed into place (so the last one, the
// live manifest, appears only after everything it names). A failure while writing the temporary files removes them and changes nothing.
function commit(writes) {
  const staged = [];
  try {
    for (const [file, buf] of writes) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp${process.pid}`;
      fs.writeFileSync(tmp, buf);
      staged.push([tmp, file]);
    }
    for (const [tmp, file] of staged) fs.renameSync(tmp, file);
    return null;
  } catch (e) {
    for (const [tmp] of staged) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } }
    return `could not write (${e.message})`;
  }
}

const inside = (dir, rel) => {
  const f = path.resolve(dir, ...rel.split("/"));
  return f.startsWith(path.resolve(dir) + path.sep) ? f : null;
};
const isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const parseJson = (buf) => { try { return JSON.parse(buf.toString("utf8")); } catch { return undefined; } };

// ---- part 1: the live data folder, as radar_sync
async function livePart(ctx) {
  const out = { ok: false, files: 0, skipped: 0, bytes: 0 };
  const r = await get(ctx, ctx.base + "manifest.json", ctx.limits.maxFileBytes);
  if (r.body === undefined) return { ...out, reason: `manifest.json: ${why(r)}` };
  const manifest = r.body.length ? parseJson(r.body) : undefined;
  if (!isObject(manifest) || manifest.schema !== 1 || !isObject(manifest.feeds)) return { ...out, reason: "manifest.json is not a valid manifest" };
  out.generatedAt = typeof manifest.generatedAt === "string" ? manifest.generatedAt : null;
  // radar_wanted: every (path, size) of the feeds that have files and a version; a path of the wrong shape is never fetched
  const wanted = new Map();
  for (const f of Object.values(manifest.feeds)) {
    if (!isObject(f) || !isObject(f.files) || !Object.keys(f.files).length || !f.version) continue;
    for (const [name, p] of Object.entries(f.files)) {
      if (!safeLivePath(p)) { out.skipped++; continue; }
      const size = isObject(f.sizes) && Number.isInteger(f.sizes[name]) ? f.sizes[name] : null;
      wanted.set(p, size);
    }
  }
  let total = 0;
  const jobs = [...wanted].map(([p, size]) => ({
    key: p, url: ctx.base + p, max: ctx.limits.maxFileBytes,
    check(buf) {
      if (!buf.length) return "empty";
      if (size !== null && buf.length !== size) return `size ${buf.length} not ${size}`;
      if (p.endsWith(".json") && parseJson(buf) === undefined) return "not valid JSON";
      total += buf.length;
      if (total > ctx.limits.maxRunBytes) return `over the ${ctx.limits.maxRunBytes} byte limit for the whole folder`;
      return null;
    },
  }));
  const res = await fetchAll(ctx, jobs);
  if (res.failure) return { ...out, reason: res.failure };
  const dir = path.join(ctx.outDir, "live");
  const writes = [];
  for (const p of wanted.keys()) {
    const f = inside(dir, p);
    if (!f) return { ...out, reason: `${p}: outside the live folder` };
    writes.push([f, res.got.get(p)]);
  }
  writes.push([path.join(dir, "manifest.json"), r.body]);   // last, as radar_sync does
  const failed = commit(writes);
  if (failed) return { ...out, reason: `live folder: ${failed}` };
  return { ...out, ok: true, files: writes.length, bytes: writes.reduce((n, [, b]) => n + b.length, 0) };
}

// ---- part 2: the live pages, as radar_sync_pages
async function pagesPart(ctx) {
  const out = { ok: false, files: 0, skipped: 0 };
  if (ctx.noindex) return { ...out, ok: true, reason: "the site is noindex" };
  const r = await get(ctx, ctx.base + "pages/index.json", ctx.limits.maxFileBytes);
  if (r.body === undefined) return { ...out, reason: `pages/index.json: ${why(r)}` };
  const index = r.body.length ? parseJson(r.body) : undefined;
  if (!isObject(index) || index.schema !== 1 || !isObject(index.files)) return { ...out, reason: "pages/index.json is not a valid index" };
  out.built = typeof index.built === "string" ? index.built : null;
  // pages built for another address or for a noindex site would carry the wrong canonical links or robots tags
  if (index.siteUrl !== ctx.siteUrl) return { ...out, reason: `the pages were built for ${JSON.stringify(index.siteUrl)}, this site is ${ctx.siteUrl}` };
  if (index.noindex !== false) return { ...out, reason: "the pages were built for a noindex site" };
  const jobs = [];
  for (const [p, info] of Object.entries(index.files)) {
    if (!safePagePath(p)) { out.skipped++; continue; }
    if (!isObject(info) || typeof info.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(info.sha256)) return { ...out, reason: `${p}: the index has no valid hash for it` };
    const size = Number.isInteger(info.size) ? info.size : null;
    jobs.push({
      key: p, url: `${ctx.base}pages/${p}`, max: ctx.limits.maxPageBytes,
      check(buf) {
        if (!buf.length) return "empty";
        if (size !== null && buf.length !== size) return `size ${buf.length} not ${size}`;
        if (crypto.createHash("sha256").update(buf).digest("hex") !== info.sha256) return "the download does not match the hash in the index";
        return null;
      },
    });
  }
  const res = await fetchAll(ctx, jobs);
  if (res.failure) return { ...out, reason: res.failure };
  const writes = [];
  for (const { key } of jobs) {
    const f = inside(ctx.outDir, key);
    if (!f) return { ...out, reason: `${key}: outside the site folder` };
    writes.push([f, res.got.get(key)]);
  }
  const failed = commit(writes);
  if (failed) return { ...out, reason: `pages: ${failed}` };
  return { ...out, ok: true, files: writes.length };
}

// The one line the build log shows.
export function summaryLine(report) {
  if (report.off || ((report.live?.files || 0) === 0 && (report.pages?.files || 0) === 0 && !report.live?.ok)) return `live snapshot: skipped (${report.reason})`;
  const notes = [];
  if (!report.live.ok) notes.push(`; live data skipped (${report.live.reason})`);
  if (report.pages.reason) notes.push(`; pages skipped (${report.pages.reason})`);
  return `live snapshot: wrote ${report.live.files} live files and ${report.pages.files} pages from ${report.base} (data of ${report.dataTime || "unknown time"})${notes.join("")}`;
}

// Downloads the published live data and pages into outDir. Never throws; returns
//   { ok, base, dataTime, stale, live: { ok, files, skipped, bytes, reason? }, pages: { ok, files, skipped, reason? }, reason? }
// files: files written (the live count includes manifest.json); skipped: entries refused for their path, never fetched.
// ok is true when both parts were written (or the pages were left out on purpose because the site is noindex).
// now: the current time for the age check (a Date or milliseconds); clock: milliseconds for the time budget; limits: for tests.
export async function fetchLiveSnapshot({ base = DEFAULT_BASE, outDir, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, budgetMs = BUDGET_MS, now = new Date(), clock = Date.now, log = console.log, siteUrl, noindex = false, limits = {} } = {}) {
  const report = { ok: false, base, live: { ok: false, files: 0, skipped: 0, bytes: 0 }, pages: { ok: false, files: 0, skipped: 0 } };
  const finish = (reason) => {
    if (reason) report.reason = reason;
    try { log(summaryLine(report)); } catch { /* a broken logger must not fail the build */ }
    return report;
  };
  try {
    const checked = checkBase(base);
    if (!checked) return finish(`the base address must be https (plain http only on 127.0.0.1 or localhost): ${JSON.stringify(String(base))}`);
    report.base = checked;
    if (typeof fetchImpl !== "function") return finish("this Node.js has no fetch");
    if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) return finish(`the site folder ${outDir} does not exist; run the site build first`);
    const ctx = {
      base: checked, loopbackBase: isLoopback(new URL(checked)), outDir, fetchImpl, timeoutMs, budgetMs, clock, deadline: clock() + budgetMs, siteUrl, noindex,
      limits: { maxFileBytes: MAX_FILE_BYTES, maxRunBytes: MAX_RUN_BYTES, maxPageBytes: MAX_PAGE_BYTES, ...limits },
    };
    const live = await livePart(ctx);
    const pages = await pagesPart(ctx);
    const generatedAt = live.generatedAt || null;
    report.dataTime = generatedAt || pages.built || null;
    delete live.generatedAt; delete pages.built;
    report.live = live; report.pages = pages;
    report.ok = live.ok && pages.ok;
    report.stale = false;
    if (live.ok) {
      const t = Date.parse(generatedAt || "");
      const nowMs = now instanceof Date ? now.getTime() : Number(now);
      if (!Number.isFinite(t) || !/^\d{4}-\d\d-\d\dT/.test(generatedAt || "")) {
        report.stale = true;
        log("live snapshot: warning: the downloaded manifest has no valid generatedAt; written anyway, the app shows its own data status");
      } else if (nowMs - t > STALE_HOURS * 3600e3) {
        report.stale = true;
        log(`live snapshot: warning: the downloaded data is from ${report.dataTime}, ${Math.floor((nowMs - t) / 3600e3)} hours old (over ${STALE_HOURS}); written anyway, the app shows its own data status`);
      }
    }
    const reasons = [];
    if (!live.ok) reasons.push(`live data: ${live.reason}`);
    if (!pages.ok || (!live.ok && pages.reason)) reasons.push(`pages: ${pages.reason}`);
    return finish(reasons.length ? reasons.join("; ") : undefined);
  } catch (e) {
    report.ok = false;
    return finish(`unexpected error: ${(e && e.message) || e}`);
  }
}

// What the command line runs: the controls first, then the download. Never throws.
export async function runLiveSnapshot({ env = process.env, argv = process.argv.slice(2), outDir, fetchImpl, log = console.log, now, siteUrl, noindex } = {}) {
  const s = snapshotSettings({ env, argv });
  if (!s.enabled) {
    const report = { ok: false, off: true, reason: s.reason, live: { ok: false, files: 0, skipped: 0, bytes: 0 }, pages: { ok: false, files: 0, skipped: 0 } };
    log(summaryLine(report));
    return report;
  }
  return fetchLiveSnapshot({ base: s.base, outDir, ...(fetchImpl ? { fetchImpl } : {}), log, ...(now ? { now } : {}), ...(s.timeoutMs ? { timeoutMs: s.timeoutMs } : {}), ...(s.budgetMs ? { budgetMs: s.budgetMs } : {}), siteUrl, noindex });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const outDir = i > -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : fileURLToPath(new URL("../dist/site", import.meta.url));
  try {
    // read here, not at the top: the site address and noindex mode come from the same settings the site build used
    const { SITE } = await import("./layout.mjs");
    await runLiveSnapshot({ argv, outDir, siteUrl: SITE.url, noindex: SITE.noindex });
  } catch (e) {
    console.log(`live snapshot: skipped (unexpected error: ${(e && e.message) || e})`);
  }
  // Exit now, once the line is written out (stdout to a pipe is asynchronous on macOS): something still pending, such as a name lookup
  // that outlived its request, must not hold the deploy up.
  process.stdout.write("", () => process.exit(0));
}
