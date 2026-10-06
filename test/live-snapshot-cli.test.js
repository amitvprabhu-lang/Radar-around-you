// The live snapshot step as the deploy runs it: the command line (node site/live-snapshot.mjs) after a real site build, against a copy of
// the data branch served by a small web server on 127.0.0.1 inside this test. No request leaves this machine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "../site/build.mjs";
import { fetchLiveSnapshot } from "../site/live-snapshot.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "site/live-snapshot.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snapcli-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const treeHash = (d) => sha(Buffer.from(walk(d).sort().map((f) => `${path.relative(d, f)}:${sha(fs.readFileSync(f))}`).join("\n")));
const SITE_URL = "https://site.example";

// a copy of the data branch: one feed with one file, and two live pages plus the live sitemap
function dataBranch(dir) {
  const put = (rel, buf) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return buf; };
  const q = put("quakes/20261006T033016Z/quakes.json", Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [] })));
  put("manifest.json", Buffer.from(JSON.stringify({ schema: 1, generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), feeds: { quakes: { version: "20261006T033016Z", files: { "quakes.json": "quakes/20261006T033016Z/quakes.json" }, sizes: { "quakes.json": q.length } } } })));
  const files = {};
  for (const [p, text] of [["aurora-tonight/index.html", "<!doctype html><title>Aurora tonight, built on GitHub</title>"], ["right-now/index.html", "<!doctype html><title>Right now, built on GitHub</title>"], ["sitemap-live.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n']]) {
    const buf = put(`pages/${p}`, Buffer.from(text));
    files[p] = { sha256: sha(buf), size: buf.length, changed: "2026-10-06T03:39:10.057Z" };
  }
  put("pages/index.json", Buffer.from(JSON.stringify({ schema: 1, siteUrl: SITE_URL, noindex: false, built: "2026-10-06T03:39:10.057Z", files })));
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/data\//, "");
    const f = path.resolve(dir, rel);
    if (!f.startsWith(dir + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// the site as the deploy build makes it (a stand-in for the app page; the content pages are real)
const appFile = path.join(tmp, "radar.html");
fs.writeFileSync(appFile, '<title>Radar Around You</title>\n<div id="app" data-view="globe"></div>\n<script>var x=1</script>\n');
function siteBuild(name) {
  const outDir = path.join(tmp, name);
  build({ outDir, appFile, publicDir: null, noindex: false });
  return outDir;
}
const cli = (outDir, env, args = []) => run(process.execPath, [script, "--out", outDir, ...args], { env: { ...process.env, SITE_URL, SITE_NOINDEX: "0", LIVE_SNAPSHOT: "", ...env }, encoding: "utf8" });

test("the command line writes live/manifest.json and the live pages from a local copy of the data branch", async () => {
  const data = path.join(tmp, "data");
  dataBranch(data);
  const server = await serve(data);
  try {
    const outDir = siteBuild("ok");
    assert.equal(fs.existsSync(path.join(outDir, "live")), false, "the site build itself writes no live folder");
    assert.equal(fs.existsSync(path.join(outDir, "aurora-tonight/index.html")), false, "the deploy build has no aurora page (its data is not bundled)");
    const base = `http://127.0.0.1:${server.address().port}/data/`;
    const r = await cli(outDir, { LIVE_SNAPSHOT_BASE: base });
    assert.match(r.stdout, new RegExp(`^live snapshot: wrote 2 live files and 3 pages from ${base.replace(/[.]/g, "\\.")} \\(data of `, "m"));
    assert.deepEqual(fs.readFileSync(path.join(outDir, "live/manifest.json")), fs.readFileSync(path.join(data, "manifest.json")));
    assert.ok(fs.existsSync(path.join(outDir, "live/quakes/20261006T033016Z/quakes.json")));
    assert.match(fs.readFileSync(path.join(outDir, "aurora-tonight/index.html"), "utf8"), /built on GitHub/);
    assert.match(fs.readFileSync(path.join(outDir, "right-now/index.html"), "utf8"), /built on GitHub/);
    assert.deepEqual(fs.readFileSync(path.join(outDir, "sitemap-live.xml")), fs.readFileSync(path.join(data, "pages/sitemap-live.xml")));
  } finally {
    server.close();
  }
});

test("an unreachable base, LIVE_SNAPSHOT=0 and the flag: exit code 0, one line, the site exactly as the build made it", async () => {
  const outDir = siteBuild("off");
  const before = treeHash(outDir);
  // a server on a port of its own that drops every connection at once, so nothing can answer
  const probe = await bad("drop");
  const dead = probe.base;
  const cases = [
    [{ LIVE_SNAPSHOT_BASE: dead }, [], /^live snapshot: skipped \(live data: manifest\.json: .*; pages: pages\/index\.json: .*\)$/m],
    [{ LIVE_SNAPSHOT: "0", LIVE_SNAPSHOT_BASE: dead }, [], /^live snapshot: skipped \(turned off by LIVE_SNAPSHOT=0\)$/m],
    [{ LIVE_SNAPSHOT_BASE: dead }, ["--no-live-snapshot"], /^live snapshot: skipped \(turned off by --no-live-snapshot\)$/m],
  ];
  try {
    for (const [env, args, line] of cases) {
      const r = await cli(outDir, env, args);   // rejects on a non-zero exit code
      assert.match(r.stdout, line);
      assert.equal(r.stdout.trim().split("\n").length, 1);
      assert.equal(treeHash(outDir), before);
    }
  } finally {
    await probe.close();
  }
});

// Servers that misbehave, on a port of their own (listen on port 0), each closed at the end of its test:
//   stall503: answers 503 and then sends a body that never ends;  drip: answers 200 declaring 30 MB and sends one byte a second;
//   silent: accepts the connection and never answers;  drop: closes every connection at once.
function bad(kind) {
  const sockets = new Set(), timers = new Set();
  const server = http.createServer((req, res) => {
    if (kind === "stall503") { res.writeHead(503, { "content-type": "text/plain" }); res.write("busy"); }
    else if (kind === "drip") {
      res.writeHead(200, { "content-length": String(30 * 1024 * 1024) });
      const t = setInterval(() => res.write("x"), 1000);
      timers.add(t);
      res.on("close", () => { clearInterval(t); timers.delete(t); });
    }
    // silent: nothing at all
  });
  server.on("connection", (s) => {
    if (kind === "drop") { s.destroy(); return; }
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: `http://127.0.0.1:${server.address().port}/data/`,
    open: () => sockets.size,
    close: () => new Promise((r) => { for (const t of timers) clearInterval(t); for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}

// Runs the command line and measures how long the process takes to exit; execFile's own timeout is only a last resort, so a hang fails
// the test instead of holding it up.
async function timedCli(outDir, env) {
  const t0 = Date.now();
  const r = await run(process.execPath, [script, "--out", outDir], { env: { ...process.env, SITE_URL, SITE_NOINDEX: "0", LIVE_SNAPSHOT: "", ...env }, encoding: "utf8", timeout: 120000 });
  return { ...r, ms: Date.now() - t0 };
}

for (const [kind, env, what] of [
  ["stall503", {}, "a 503 whose body never ends"],
  ["drip", {}, "a 200 that declares 30 MB and sends one byte a second"],
  // with the default limits this case takes up to 40 s (10 s per request, one retry, two parts); shorter limits keep the test quick
  ["silent", { LIVE_SNAPSHOT_TIMEOUT_MS: "1000", LIVE_SNAPSHOT_BUDGET_MS: "5000" }, "a server that never answers"],
]) {
  test(`the command line exits promptly with code 0 when the base is ${what}`, { timeout: 150000 }, async () => {
    const srv = await bad(kind);
    const outDir = siteBuild(`bad-${kind}`);
    const before = treeHash(outDir);
    try {
      const r = await timedCli(outDir, { LIVE_SNAPSHOT_BASE: srv.base, ...env });   // rejects on a non-zero exit code or the last-resort kill
      assert.match(r.stdout, /^live snapshot: skipped \(live data: manifest\.json: .*; pages: pages\/index\.json: .*\)$/m);
      assert.ok(r.ms < 30000, `the process took ${r.ms} ms to exit; the server was still holding its connections open`);
      assert.equal(treeHash(outDir), before);
    } finally {
      await srv.close();
    }
  });
}

test("the connections of a failed request are closed, not left to the server (real fetch, in this process)", { timeout: 60000 }, async () => {
  for (const kind of ["stall503", "drip"]) {
    const srv = await bad(kind);
    try {
      const out = fs.mkdtempSync(path.join(tmp, "sock-"));
      const report = await fetchLiveSnapshot({ base: srv.base, outDir: out, siteUrl: SITE_URL, noindex: false, log: () => {} });
      assert.equal(report.ok, false);
      // the server sees every connection closed shortly after the step returns, while it would keep them open itself
      const t0 = Date.now();
      while (srv.open() > 0 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
      assert.equal(srv.open(), 0, `${kind}: ${srv.open()} connection(s) still open`);
    } finally {
      await srv.close();
    }
  }
});

test("package.json: build:hosting runs the snapshot after the site build, and the browser suite turns it off", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["build:hosting"], /npm run site && node site\/live-snapshot\.mjs$/);
  assert.doesNotMatch(pkg.scripts.site, /live-snapshot/, "npm run site (and so CI) stays offline");
  assert.match(pkg.scripts["e2e:site"], /^LIVE_SNAPSHOT=0 npm run build:hosting/);
});

test("site/build.mjs never downloads: build() stays pure", () => {
  const src = fs.readFileSync(path.join(root, "site/build.mjs"), "utf8");
  assert.doesNotMatch(src, /live-snapshot|fetch\(/);
});
