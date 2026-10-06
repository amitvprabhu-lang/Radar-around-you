// Tests for site/live-snapshot.mjs: the build-time copy of the published live data and live pages into the site output, so a redeploy does
// not leave the site without its live/ folder and its live pages until the server's next pull. Every test injects fetchImpl; nothing here
// touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  fetchLiveSnapshot, runLiveSnapshot, snapshotSettings, summaryLine, safeLivePath, safePagePath,
  DEFAULT_BASE, LIVE_PATH_RE, PAGE_PATH_RE, MAX_FILE_BYTES, MAX_RUN_BYTES, MAX_PAGE_BYTES, REQUEST_TIMEOUT_MS, BUDGET_MS, STALE_HOURS,
} from "../site/live-snapshot.mjs";
import { LIVE_FILES } from "../site/livepages.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "snap-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const BASE = "https://data.example/branch/";
const SITE_URL = "https://site.example";
const NOW = new Date("2026-10-06T04:00:00Z");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const rel = (d) => walk(d).map((f) => path.relative(d, f).split(path.sep).join("/")).sort();

// A small copy of the data branch: a manifest with two feeds (three files) and one feed without files, and a pages index with two pages
// and the live sitemap. Returned as a Map of path -> bytes, with the parsed manifest and index for tests that change them.
function branch({ generatedAt = "2026-10-06T03:39:02Z", noindex = false, siteUrl = SITE_URL } = {}) {
  const m = new Map();
  const quakes = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [{ id: "q1" }] }));
  const auroraBin = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const auroraJson = Buffer.from(JSON.stringify({ w: 360, h: 181 }));
  m.set("quakes/20261006T033016Z/quakes.json", quakes);
  m.set("aurora/20261006T033902Z/aurora.bin", auroraBin);
  m.set("aurora/20261006T033902Z/aurora.json", auroraJson);
  const manifest = {
    schema: 1, generatedAt, feeds: {
      quakes: { version: "20261006T033016Z", files: { "quakes.json": "quakes/20261006T033016Z/quakes.json" }, sizes: { "quakes.json": quakes.length } },
      aurora: { version: "20261006T033902Z", files: { "aurora.bin": "aurora/20261006T033902Z/aurora.bin", "aurora.json": "aurora/20261006T033902Z/aurora.json" }, sizes: { "aurora.bin": auroraBin.length, "aurora.json": auroraJson.length } },
      kp: { version: null, files: {}, status: "error" },
    },
  };
  const pages = {
    "aurora-tonight/index.html": Buffer.from("<!doctype html><title>Aurora tonight (live)</title>"),
    "right-now/index.html": Buffer.from("<!doctype html><title>Right now (live)</title>"),
    "sitemap-live.xml": Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'),
  };
  const index = { schema: 1, siteUrl, noindex, built: "2026-10-06T03:39:10.057Z", files: {} };
  for (const [p, buf] of Object.entries(pages)) { m.set(`pages/${p}`, buf); index.files[p] = { sha256: sha(buf), size: buf.length, changed: "2026-10-06T03:39:10.057Z" }; }
  const d = { m, manifest, index };
  d.sync = () => { m.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 1))); m.set("pages/index.json", Buffer.from(JSON.stringify(index, null, 1))); return d; };
  return d.sync();
}

// fetchImpl over a Map. over: path -> { status, body, throw, delay }. calls records every URL asked for.
function fakeFetch(m, over = {}, base = BASE) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = url.startsWith(base) ? url.slice(base.length) : null;
    const o = (r !== null && over[r]) || {};
    if (o.delay) await new Promise((res) => setTimeout(res, o.delay));
    if (o.throw) throw new Error(o.throw);
    const body = o.body !== undefined ? o.body : r !== null ? m.get(r) : undefined;
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: o.status || 200 });
  };
  f.calls = calls;
  return f;
}

// a site folder as the deploy build leaves it: a snapshot copy of the aurora page and of the live sitemap
function siteDir() {
  const d = mk();
  fs.mkdirSync(path.join(d, "aurora-tonight"), { recursive: true });
  fs.writeFileSync(path.join(d, "aurora-tonight/index.html"), "snapshot copy");
  fs.writeFileSync(path.join(d, "sitemap-live.xml"), "build sitemap");
  fs.writeFileSync(path.join(d, "index.html"), "home");
  return d;
}

const run = (d, outDir, extra = {}) => {
  const lines = [];
  const fetchImpl = extra.fetchImpl || fakeFetch(d.m, extra.over || {});
  return fetchLiveSnapshot({ base: BASE, outDir, fetchImpl, now: NOW, siteUrl: SITE_URL, noindex: false, log: (l) => lines.push(l), ...extra, fetchImpl })
    .then((report) => ({ report, lines, fetchImpl }));
};

test("happy path: the live folder and the live pages are written exactly as published, hashes and sizes checked", async () => {
  const d = branch(), out = siteDir();
  const { report, lines } = await run(d, out);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(rel(path.join(out, "live")), ["aurora/20261006T033902Z/aurora.bin", "aurora/20261006T033902Z/aurora.json", "manifest.json", "quakes/20261006T033016Z/quakes.json"]);
  for (const p of ["manifest.json", "quakes/20261006T033016Z/quakes.json", "aurora/20261006T033902Z/aurora.bin"]) assert.deepEqual(fs.readFileSync(path.join(out, "live", p)), d.m.get(p), p);
  // the live pages go over the deploy-time copies at their public paths; a page the deploy did not write appears
  assert.deepEqual(fs.readFileSync(path.join(out, "aurora-tonight/index.html")), d.m.get("pages/aurora-tonight/index.html"));
  assert.deepEqual(fs.readFileSync(path.join(out, "right-now/index.html")), d.m.get("pages/right-now/index.html"));
  assert.deepEqual(fs.readFileSync(path.join(out, "sitemap-live.xml")), d.m.get("pages/sitemap-live.xml"));
  assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), "home", "nothing else of the site is touched");
  assert.equal(walk(out).filter((f) => /\.tmp/.test(f)).length, 0, "no temporary file is left");
  assert.equal(report.live.files, 4);
  assert.equal(report.live.skipped, 0);
  assert.equal(report.live.bytes, [...d.m.entries()].filter(([k]) => !k.startsWith("pages/")).reduce((n, [, b]) => n + b.length, 0));
  assert.equal(report.pages.files, 3);
  assert.equal(report.pages.skipped, 0);
  assert.equal(report.dataTime, "2026-10-06T03:39:02Z");
  assert.equal(report.reason, undefined);
  // the report is logged as one summary line
  assert.deepEqual(lines, [`live snapshot: wrote 4 live files and 3 pages from ${BASE} (data of 2026-10-06T03:39:02Z)`]);
});

test("the pages index without sitemap-live.xml keeps the build's own sitemap", async () => {
  const d = branch();
  delete d.index.files["sitemap-live.xml"];
  d.sync();
  const out = siteDir();
  const { report } = await run(d, out);
  assert.equal(report.ok, true);
  assert.equal(report.pages.files, 2);
  assert.equal(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8"), "build sitemap");
});

test("a page that does not match its hash: no page is written, the live folder still is, the reason is reported", async () => {
  const d = branch(), out = siteDir();
  const good = d.m.get("pages/right-now/index.html");
  d.m.set("pages/right-now/index.html", Buffer.from(good.toString("utf8").replace("live", "evil")));   // same size, other bytes
  const { report, lines } = await run(d, out);
  assert.equal(report.ok, false);
  assert.equal(report.pages.files, 0);
  assert.match(report.pages.reason, /right-now\/index\.html.*hash/);
  assert.match(report.reason, /pages: .*hash/);
  assert.equal(fs.readFileSync(path.join(out, "aurora-tonight/index.html"), "utf8"), "snapshot copy", "all or nothing: the good page is not written either");
  assert.equal(fs.existsSync(path.join(out, "right-now/index.html")), false);
  assert.equal(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8"), "build sitemap");
  assert.equal(report.live.files, 4);
  assert.ok(fs.existsSync(path.join(out, "live/manifest.json")));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^live snapshot: wrote 4 live files and 0 pages from .* \(data of 2026-10-06T03:39:02Z\); pages skipped \(.*hash.*\)$/);
});

test("a page whose size differs from the index is refused", async () => {
  const d = branch(), out = siteDir();
  d.index.files["right-now/index.html"].size += 1;
  d.sync();
  const { report } = await run(d, out);
  assert.equal(report.pages.files, 0);
  assert.match(report.pages.reason, /size/);
});

test("a live file whose size differs from the manifest: nothing of the live folder is written", async () => {
  const d = branch(), out = siteDir();
  d.m.set("aurora/20261006T033902Z/aurora.bin", Buffer.from([1, 2, 3]));
  const { report } = await run(d, out);
  assert.equal(report.live.files, 0);
  assert.match(report.live.reason, /aurora\.bin.*size 3 not 8/);
  assert.equal(fs.existsSync(path.join(out, "live")), false);
  assert.equal(report.pages.files, 3, "the pages are a separate part");
});

test("a live JSON file that does not parse, or an empty file, counts as a failed download", async () => {
  for (const body of [Buffer.from("{not json"), Buffer.alloc(0)]) {
    const d = branch(), out = siteDir();
    d.m.set("quakes/20261006T033016Z/quakes.json", body);
    delete d.manifest.feeds.quakes.sizes;   // so only the content check can catch it
    d.sync();
    const { report } = await run(d, out);
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, /quakes\.json/);
    assert.equal(fs.existsSync(path.join(out, "live")), false);
  }
});

test("paths outside the whitelist or with .. are refused and never fetched, in the manifest and in the pages index", async () => {
  const d = branch(), out = siteDir();
  const bad = ["../../etc/passwd", "quakes/20261006T033016Z/../../../x.json", "Quakes/20261006T033016Z/q.json", "quakes/latest/quakes.json", "/abs/20261006T033016Z/x", "quakes/20261006T033016Z/.hidden"];
  d.manifest.feeds.evil = { version: "20261006T000000Z", files: Object.fromEntries(bad.map((p, i) => [`f${i}`, p])) };
  const badPages = ["about/index.html", "../index.html", "aurora-tonight/../index.html", "aurora-tonight/index.html/../../x", "index.html", "right-now/index.php", "aurora-tonight/index.html\n"];
  for (const p of badPages) d.index.files[p] = { sha256: "0".repeat(64), size: 1 };
  d.sync();
  const f = fakeFetch(d.m);
  const { report } = await run(d, out, { fetchImpl: f });
  assert.equal(report.ok, true, "a refused path is skipped, as the server job skips it, and the rest is written");
  assert.equal(report.live.skipped, bad.length);
  assert.equal(report.pages.skipped, badPages.length);
  assert.equal(report.live.files, 4);
  assert.equal(report.pages.files, 3);
  for (const u of f.calls) assert.ok(!/\.\.|passwd|about\/|index\.php|latest/.test(u.slice(BASE.length)), `fetched ${u}`);
  assert.deepEqual(rel(out).filter((p) => !p.startsWith("live/")), ["aurora-tonight/index.html", "index.html", "right-now/index.html", "sitemap-live.xml"]);
  assert.equal(fs.existsSync(path.join(path.dirname(out), "etc")), false);
});

test("the whitelists: live paths of the collector's shape, pages only from the registry", () => {
  assert.ok(safeLivePath("quakes/20261006T033016Z/quakes.json"));
  assert.ok(!safeLivePath("quakes/20261006T033016Z/../q.json"));
  assert.ok(!safeLivePath("quakes/20261006T033016Z/q.json\n"));
  assert.ok(!safeLivePath(42));
  for (const f of LIVE_FILES) assert.ok(safePagePath(f), f);
  assert.ok(safePagePath("sitemap-live.xml"));
  assert.ok(!safePagePath("sitemap.xml"));
  assert.ok(!safePagePath("history.json"));
  assert.ok(!safePagePath("index.json"));
});

test("the whitelists and limits are the server's own (hosting/lib.php, read as text)", () => {
  const php = fs.readFileSync(path.join(root, "hosting/lib.php"), "utf8");
  const unslash = (s) => s.replace(/\\\//g, "/");
  const live = php.match(/function radar_safe_path[\s\S]*?preg_match\('#\^([\s\S]*?)\$#'/);
  assert.ok(live, "radar_safe_path's pattern is in lib.php");
  assert.equal(unslash(LIVE_PATH_RE.source), `^${live[1]}$`);
  const page = php.match(/function radar_safe_page_path[\s\S]*?preg_match\('#\^\(\?:([\s\S]*?)\)\\z#'/);
  assert.ok(page, "radar_safe_page_path's pattern is in lib.php");
  assert.equal(unslash(PAGE_PATH_RE.source), `^(?:${page[1]})$`);
  assert.match(php, new RegExp(`RADAR_DEFAULT_BASE = '${DEFAULT_BASE.replace(/[.]/g, "\\.")}'`));
  assert.equal(MAX_FILE_BYTES, 25 * 1024 * 1024);
  assert.match(php, /RADAR_MAX_FILE_BYTES = 25 \* 1024 \* 1024;/);
  assert.equal(MAX_RUN_BYTES, 80 * 1024 * 1024);
  assert.match(php, /RADAR_MAX_RUN_BYTES = 80 \* 1024 \* 1024;/);
  assert.equal(MAX_PAGE_BYTES, 2 * 1024 * 1024);
  assert.match(php, /RADAR_MAX_PAGE_BYTES = 2 \* 1024 \* 1024;/);
  assert.equal(REQUEST_TIMEOUT_MS, 10000);
  assert.equal(BUDGET_MS, 60000);
  assert.equal(STALE_HOURS, 24);
});

test("an oversized file is refused: a live file over the file limit, a page over the page limit, a live folder over the run limit", async () => {
  {
    const d = branch(), out = siteDir();
    const { report } = await run(d, out, { limits: { maxFileBytes: 7 } });
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, /too large|limit/);
  }
  {
    const d = branch(), out = siteDir();
    const { report } = await run(d, out, { limits: { maxPageBytes: 20 } });
    assert.equal(report.pages.files, 0);
    assert.match(report.pages.reason, /too large|limit/);
    assert.equal(report.live.files, 4);
  }
  {
    const d = branch(), out = siteDir();
    const { report } = await run(d, out, { limits: { maxRunBytes: 10 } });
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, /limit/);
  }
  {
    // a declared length over the limit is refused before the body is read
    const d = branch(), out = siteDir();
    const fetchImpl = async (url) => (url.endsWith("manifest.json")
      ? new Response(d.m.get("manifest.json"), { status: 200 })
      : new Response("x", { status: 200, headers: { "content-length": String(MAX_FILE_BYTES + 1) } }));
    const { report } = await run(d, out, { fetchImpl });
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, /too large/);
  }
});

test("a network error: nothing written, the reason reported, one retry and no more", async () => {
  const d = branch(), out = siteDir();
  const f = fakeFetch(d.m, { "manifest.json": { throw: "getaddrinfo ENOTFOUND" }, "pages/index.json": { throw: "getaddrinfo ENOTFOUND" } });
  const { report, lines } = await run(d, out, { fetchImpl: f });
  assert.equal(report.ok, false);
  assert.equal(report.live.files + report.pages.files, 0);
  assert.match(report.live.reason, /manifest\.json.*ENOTFOUND/);
  assert.match(report.pages.reason, /pages\/index\.json.*ENOTFOUND/);
  assert.equal(f.calls.filter((u) => u.endsWith("/manifest.json")).length, 2);
  assert.equal(f.calls.filter((u) => u.endsWith("pages/index.json")).length, 2);
  assert.equal(fs.existsSync(path.join(out, "live")), false);
  assert.equal(fs.readFileSync(path.join(out, "aurora-tonight/index.html"), "utf8"), "snapshot copy");
  assert.deepEqual(lines, [`live snapshot: skipped (live data: ${report.live.reason}; pages: ${report.pages.reason})`]);
});

test("the reason names the cause Node's fetch keeps behind \"fetch failed\"", async () => {
  const d = branch(), out = siteDir();
  const fetchImpl = async () => { const e = new TypeError("fetch failed"); e.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }); throw e; };
  const { report } = await run(d, out, { fetchImpl });
  assert.equal(report.live.reason, "manifest.json: fetch failed (ECONNREFUSED)");
});

test("a failed file download is retried once, and a second success is accepted", async () => {
  const d = branch(), out = siteDir();
  let n = 0;
  const inner = fakeFetch(d.m);
  const fetchImpl = async (url, o) => { if (url.endsWith("quakes.json") && n++ === 0) throw new Error("socket hang up"); return inner(url, o); };
  const { report } = await run(d, out, { fetchImpl });
  assert.equal(report.ok, true);
  assert.equal(n, 2);
});

test("an HTTP 404 is not retried and fails the part", async () => {
  const d = branch(), out = siteDir();
  d.m.delete("aurora/20261006T033902Z/aurora.json");
  const f = fakeFetch(d.m);
  const { report } = await run(d, out, { fetchImpl: f });
  assert.match(report.live.reason, /aurora\.json.*HTTP 404/);
  assert.equal(f.calls.filter((u) => u.endsWith("aurora.json")).length, 1);
  assert.equal(fs.existsSync(path.join(out, "live")), false);
});

test("a timeout: a slow answer is given up after the per-request time, and the overall budget stops the rest", { timeout: 30000 }, async () => {
  {
    const d = branch(), out = siteDir();
    const f = fakeFetch(d.m, { "manifest.json": { delay: 300 } });
    const { report } = await run(d, out, { fetchImpl: f, timeoutMs: 20 });
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, /no answer within/);
    assert.equal(report.pages.files, 3, "the pages part has its own requests");
  }
  {
    // a fetch that never settles, with a budget smaller than the request timeout
    const d = branch(), out = siteDir();
    const fetchImpl = () => new Promise(() => {});
    // without the budget this would wait 10 s per request; the test's own time limit catches a budget that does not hold
    const { report, lines } = await run(d, out, { fetchImpl, timeoutMs: 10000, budgetMs: 50 });
    assert.equal(report.ok, false);
    assert.match(report.live.reason, /no answer within|budget/);
    assert.match(report.pages.reason, /no answer within|budget/);
    assert.match(lines[0], /^live snapshot: skipped \(/);
  }
});

test("a corrupt manifest or pages index counts as nothing", async () => {
  for (const [man, why] of [["{not json", /not a valid manifest/], [JSON.stringify({ schema: 2, feeds: {} }), /not a valid manifest/], [JSON.stringify({ schema: 1 }), /not a valid manifest/], ["", /not a valid manifest|empty/]]) {
    const d = branch(), out = siteDir();
    d.m.set("manifest.json", Buffer.from(man));
    d.m.set("pages/index.json", Buffer.from(man.replace("feeds", "files")));
    const { report } = await run(d, out);
    assert.equal(report.live.files, 0);
    assert.match(report.live.reason, why);
    assert.equal(report.pages.files, 0);
    assert.match(report.pages.reason, /not a valid index|empty/);
    assert.equal(fs.existsSync(path.join(out, "live")), false);
  }
  {
    // an allowed page with a broken hash entry makes the index corrupt for this part
    const d = branch(), out = siteDir();
    d.index.files["right-now/index.html"].sha256 = "xyz";
    d.sync();
    const { report } = await run(d, out);
    assert.equal(report.pages.files, 0);
    assert.match(report.pages.reason, /right-now\/index\.html.*hash/);
  }
});

test("pages built for another address or for a noindex site are not copied", async () => {
  {
    const d = branch({ siteUrl: "https://other.example" }), out = siteDir();
    const { report } = await run(d, out);
    assert.equal(report.pages.files, 0);
    assert.match(report.pages.reason, /built for "https:\/\/other\.example"/);
    assert.equal(report.live.files, 4);
  }
  {
    const d = branch({ noindex: true }), out = siteDir();
    const { report } = await run(d, out);
    assert.equal(report.pages.files, 0);
    assert.match(report.pages.reason, /noindex/);
  }
});

test("an old manifest is still written, with a warning", async () => {
  const d = branch({ generatedAt: "2026-10-04T08:00:00Z" }), out = siteDir();
  const { report, lines } = await run(d, out);
  assert.equal(report.ok, true);
  assert.equal(report.stale, true);
  assert.ok(fs.existsSync(path.join(out, "live/manifest.json")));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^live snapshot: warning: the downloaded data is from 2026-10-04T08:00:00Z, 44 hours old/);
  assert.match(lines[1], /^live snapshot: wrote 4 live files and 3 pages/);
  // a fresh one has no warning; a manifest with no time is warned about too
  const fresh = await run(branch(), siteDir());
  assert.equal(fresh.report.stale, false);
  const d2 = branch();
  delete d2.manifest.generatedAt;
  d2.sync();
  const none = await run(d2, siteDir());
  assert.equal(none.report.ok, true);
  assert.match(none.lines[0], /warning: the downloaded manifest has no valid generatedAt/);
});

test("partial failure: the live folder is written when the pages fail", async () => {
  const d = branch(), out = siteDir();
  const { report, lines } = await run(d, out, { over: { "pages/index.json": { status: 500, body: "oops" } } });
  assert.equal(report.ok, false);
  assert.equal(report.live.files, 4);
  assert.ok(fs.existsSync(path.join(out, "live/manifest.json")));
  assert.equal(report.pages.files, 0);
  assert.match(report.pages.reason, /HTTP 500/);
  assert.match(lines[0], /; pages skipped \(pages\/index\.json: HTTP 500\)$/);
});

test("the live manifest is written last, after every file it names", async () => {
  const d = branch(), out = siteDir();
  const order = [];
  const realRename = fs.renameSync;
  fs.renameSync = (a, b) => { order.push(path.relative(out, b).split(path.sep).join("/")); return realRename(a, b); };
  try { await run(d, out); } finally { fs.renameSync = realRename; }
  const live = order.filter((p) => p.startsWith("live/"));
  assert.equal(live.length, 4);
  assert.equal(live[live.length - 1], "live/manifest.json");
});

test("a write that fails leaves nothing behind for that part", async () => {
  const d = branch(), out = siteDir();
  // a file where the live folder should go makes every live write fail
  fs.writeFileSync(path.join(out, "live"), "in the way");
  const { report } = await run(d, out);
  assert.equal(report.live.files, 0);
  assert.match(report.live.reason, /could not write/);
  assert.equal(fs.readFileSync(path.join(out, "live"), "utf8"), "in the way");
  assert.equal(report.pages.files, 3);
  assert.equal(walk(out).filter((f) => /\.tmp/.test(f)).length, 0);
});

test("a write that fails part way removes the temporary files already written, for both parts", async () => {
  const d = branch(), out = siteDir();
  // the first live file (quakes) and the first page (aurora-tonight) are staged; the next one cannot be, because a file blocks its folder
  fs.mkdirSync(path.join(out, "live"));
  fs.writeFileSync(path.join(out, "live/aurora"), "in the way");
  fs.writeFileSync(path.join(out, "right-now"), "in the way");
  const { report } = await run(d, out);
  assert.equal(report.live.files, 0);
  assert.match(report.live.reason, /could not write/);
  assert.equal(report.pages.files, 0);
  assert.match(report.pages.reason, /could not write/);
  assert.deepEqual(walk(out).filter((f) => /\.tmp/.test(f)), [], "no temporary file is left");
  assert.deepEqual(rel(path.join(out, "live")), ["aurora"]);
  assert.equal(fs.readFileSync(path.join(out, "aurora-tonight/index.html"), "utf8"), "snapshot copy");
});

test("redirects are followed as radar_http follows them: at most 3, https only", async () => {
  const d = branch();
  // fetchImpl that answers the manifest with a chain of redirects ending at `last`; everything else from the branch
  const chain = (hops, last) => {
    const inner = fakeFetch(d.m);
    const f = async (url, o) => {
      f.calls.push(url);
      f.modes.push(o && o.redirect);
      if (url === BASE + "manifest.json" || /^https:\/\/hop\d\.example\//.test(url)) {
        const n = url === BASE + "manifest.json" ? 0 : Number(url.match(/hop(\d)/)[1]);
        const to = n + 1 < hops ? `https://hop${n + 1}.example/m.json` : last;
        return new Response(null, { status: 302, headers: { location: to } });
      }
      if (url === "https://mirror.example/manifest.json") return new Response(d.m.get("manifest.json"), { status: 200 });
      return inner(url, o);
    };
    f.calls = []; f.modes = [];
    return f;
  };
  {
    // another https host, after three hops: allowed, as curl with CURLOPT_REDIR_PROTOCOLS https and CURLOPT_MAXREDIRS 3 allows it
    const f = chain(3, "https://mirror.example/manifest.json"), out = siteDir();
    const { report } = await run(d, out, { fetchImpl: f });
    assert.equal(report.live.ok, true, JSON.stringify(report.live));
    assert.ok(f.calls.includes("https://mirror.example/manifest.json"));
    assert.ok(f.modes.every((m) => m === "manual"), "redirects are never left to fetch");
  }
  for (const [hops, last, why] of [
    [4, "https://mirror.example/manifest.json", /more than 3 redirects/],
    [1, "http://mirror.example/manifest.json", /redirect to http:\/\/mirror\.example\/manifest\.json refused/],
    [1, "file:///etc/passwd", /redirect to file:\/\/\/etc\/passwd refused/],
    [1, "http://127.0.0.1:9/manifest.json", /redirect to http:\/\/127\.0\.0\.1:9\/manifest\.json refused/],
  ]) {
    const f = chain(hops, last), out = siteDir();
    const { report } = await run(d, out, { fetchImpl: f });
    assert.equal(report.live.files, 0, last);
    assert.match(report.live.reason, why);
    assert.ok(!f.calls.includes("https://mirror.example/manifest.json") || hops <= 3, "the fourth hop is never fetched");
    assert.ok(!f.calls.some((u) => u.startsWith("http://") || u.startsWith("file:")), "a refused target is never fetched");
    assert.equal(f.calls.filter((u) => u === BASE + "manifest.json").length, 1, "a refused redirect is not retried");
    assert.equal(fs.existsSync(path.join(out, "live")), false);
  }
  {
    // a redirect without a Location header is a failed request
    const out = siteDir();
    const fetchImpl = async () => new Response(null, { status: 301 });
    const { report } = await run(d, out, { fetchImpl });
    assert.match(report.live.reason, /redirect without a location/);
  }
  {
    // with a loopback base (local tests only), a redirect may stay on plain http on this machine
    const lb = "http://127.0.0.1:9/data/";
    const inner = fakeFetch(d.m, {}, lb);
    const fetchImpl = async (url, o) => (url === lb + "manifest.json" ? new Response(null, { status: 307, headers: { location: "/data/manifest2.json" } }) : url === lb + "manifest2.json" ? new Response(d.m.get("manifest.json"), { status: 200 }) : inner(url, o));
    const { report } = await run(d, siteDir(), { base: lb, fetchImpl });
    assert.equal(report.live.ok, true, JSON.stringify(report.live));
  }
});

test("noindex: the data folder is copied, the pages and the sitemap are not, and the index is not even fetched", async () => {
  const d = branch({ noindex: true }), out = siteDir();
  const f = fakeFetch(d.m);
  const { report, lines } = await run(d, out, { fetchImpl: f, noindex: true });
  assert.equal(report.ok, true);
  assert.equal(report.live.files, 4);
  assert.equal(report.pages.files, 0);
  assert.equal(report.pages.reason, "the site is noindex");
  assert.ok(!f.calls.some((u) => u.includes("pages/")));
  assert.equal(fs.readFileSync(path.join(out, "aurora-tonight/index.html"), "utf8"), "snapshot copy");
  assert.equal(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8"), "build sitemap");
  assert.match(lines[0], /^live snapshot: wrote 4 live files and 0 pages from .*; pages skipped \(the site is noindex\)$/);
});

test("a missing site folder, a bad base, or a broken fetch never throws", async () => {
  const d = branch();
  const missing = await run(d, path.join(mk(), "nope"));
  assert.equal(missing.report.ok, false);
  assert.match(missing.report.reason, /does not exist/);
  assert.match(missing.lines[0], /^live snapshot: skipped \(/);
  for (const base of ["http://data.example/", "ftp://x/", "not a url", "file:///etc/", "http://[::1]:9/", "http://10.0.0.1/"]) {
    const r = await run(d, siteDir(), { base });
    assert.equal(r.report.ok, false, base);
    assert.match(r.report.reason, /https/);
    assert.equal(r.fetchImpl.calls.length, 0);
  }
  const garbage = await run(d, siteDir(), { fetchImpl: async () => null });
  assert.equal(garbage.report.ok, false);
  const throwsSync = await run(d, siteDir(), { fetchImpl: () => { throw new TypeError("boom"); } });
  assert.equal(throwsSync.report.ok, false);
  assert.match(throwsSync.report.live.reason, /boom/);
});

test("a loopback http base is accepted (for local tests) and the base gets its trailing slash", async () => {
  const d = branch(), out = siteDir();
  const f = fakeFetch(d.m, {}, "http://127.0.0.1:9/data/");
  const { report } = await run(d, out, { base: "http://127.0.0.1:9/data", fetchImpl: f });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(f.calls[0], "http://127.0.0.1:9/data/manifest.json");
});

test("settings: on by default with the server's base; LIVE_SNAPSHOT=0, the flag, and an unknown value turn it off; LIVE_SNAPSHOT_BASE overrides", () => {
  assert.deepEqual(snapshotSettings({ env: {}, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT: "1" }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT_BASE: " http://127.0.0.1:8/x/ " }, argv: [] }), { enabled: true, base: "http://127.0.0.1:8/x/" });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT: "0" }, argv: [] }), { enabled: false, reason: "turned off by LIVE_SNAPSHOT=0" });
  assert.deepEqual(snapshotSettings({ env: {}, argv: ["--no-live-snapshot"] }), { enabled: false, reason: "turned off by --no-live-snapshot" });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT: " 1 " }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  // the time limits can be shortened (for tests), never lengthened; anything else is ignored
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT_TIMEOUT_MS: "1000", LIVE_SNAPSHOT_BUDGET_MS: "5000" }, argv: [] }), { enabled: true, base: DEFAULT_BASE, timeoutMs: 1000, budgetMs: 5000 });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT_TIMEOUT_MS: "20000", LIVE_SNAPSHOT_BUDGET_MS: "600000" }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT_TIMEOUT_MS: "0", LIVE_SNAPSHOT_BUDGET_MS: "abc" }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT_TIMEOUT_MS: "1.5" }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  assert.deepEqual(snapshotSettings({ env: { LIVE_SNAPSHOT: "" }, argv: [] }), { enabled: true, base: DEFAULT_BASE });
  // only 0, 1 or nothing: any other value, even one that reads as yes, turns the download off with a message
  for (const v of ["nope", "true", "on", "yes", "false", "off", "no", "01", "O"]) {
    const odd = snapshotSettings({ env: { LIVE_SNAPSHOT: v }, argv: [] });
    assert.equal(odd.enabled, false, v);
    assert.equal(odd.reason, `LIVE_SNAPSHOT is ${JSON.stringify(v)}; only 0 or 1 are understood, so the download is off`);
  }
});

test("runLiveSnapshot: turned off by LIVE_SNAPSHOT=0 or the flag, nothing is fetched and one line says so", async () => {
  const d = branch();
  for (const [env, argv, why] of [[{ LIVE_SNAPSHOT: "0" }, [], "turned off by LIVE_SNAPSHOT=0"], [{}, ["--no-live-snapshot"], "turned off by --no-live-snapshot"]]) {
    const out = siteDir(), lines = [], f = fakeFetch(d.m);
    const report = await runLiveSnapshot({ env, argv, outDir: out, fetchImpl: f, log: (l) => lines.push(l), now: NOW, siteUrl: SITE_URL, noindex: false });
    assert.equal(f.calls.length, 0);
    assert.equal(report.ok, false);
    assert.equal(report.off, true);
    assert.deepEqual(lines, [`live snapshot: skipped (${why})`]);
    assert.equal(fs.existsSync(path.join(out, "live")), false);
  }
  // on, with the base from LIVE_SNAPSHOT_BASE
  const out = siteDir(), lines = [], f = fakeFetch(d.m);
  const report = await runLiveSnapshot({ env: { LIVE_SNAPSHOT_BASE: BASE }, argv: [], outDir: out, fetchImpl: f, log: (l) => lines.push(l), now: NOW, siteUrl: SITE_URL, noindex: false });
  assert.equal(report.ok, true);
  assert.ok(f.calls.every((u) => u.startsWith(BASE)));
  assert.match(lines[0], /^live snapshot: wrote 4 live files and 3 pages/);
});

test("summaryLine words every case", () => {
  const base = { base: BASE, dataTime: "T", live: { ok: true, files: 2, skipped: 0, bytes: 9 }, pages: { ok: true, files: 1, skipped: 0 } };
  assert.equal(summaryLine({ ...base, ok: true }), `live snapshot: wrote 2 live files and 1 pages from ${BASE} (data of T)`);
  assert.equal(summaryLine({ ok: false, off: true, reason: "turned off by LIVE_SNAPSHOT=0" }), "live snapshot: skipped (turned off by LIVE_SNAPSHOT=0)");
  assert.equal(summaryLine({ ...base, ok: false, live: { ok: false, files: 0, reason: "x" }, pages: { ok: true, files: 1 } }), `live snapshot: wrote 0 live files and 1 pages from ${BASE} (data of T); live data skipped (x)`);
});
