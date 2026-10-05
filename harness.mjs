// Test harness: serves a built page and the public/ data files at https://radar.test/ inside Chromium
// (the sandbox proxy intercepts localhost, so requests are fulfilled by Playwright routes instead).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// the project's own copy first; the cloud container kept one at a fixed path
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("/opt/node-tools/node_modules/playwright"); }
const { chromium } = playwright;

export const dir = fileURLToPath(new URL(".", import.meta.url));
const MIME = { ".json": "application/json", ".bin": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".html": "text/html; charset=utf-8" };

export async function launch() {
  return chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
}

// `live` is an optional in-memory live folder for tests: { files: Map("live/..." -> Buffer|object), failing: Set(paths) }.
// Tests change it while the page runs to simulate the pipeline publishing, going quiet, or the host failing.
export async function openPage(browser, htmlFile, { viewport = { width: 390, height: 780 }, mobile = true, label = "page", errors = [], stats = null, live = null } = {}) {
  const body = fs.readFileSync(dir + htmlFile, "utf8");
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${body}</body></html>`;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  // newer Chromium has DeviceOrientationEvent.requestPermission and answers "prompt" until the sensors are allowed, which the app (like iOS) reads as a refusal
  await ctx.grantPermissions(["accelerometer", "gyroscope", "magnetometer"], { origin: "https://radar.test" });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (/Service Worker registration blocked by Playwright/.test(m.text())) return; /* the tests block workers on purpose; the worker has its own unit tests */ if (m.type() === "error" || m.type() === "warning") errors.push(`[${label}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  p.on("requestfailed", (r) => errors.push(`[${label}] request failed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  await p.route("https://radar.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page });
    if (url.pathname.startsWith("/live/")) {
      let rel = decodeURIComponent(url.pathname.slice(1));
      let twin = false;
      if (rel.endsWith(".bin.txt")) { rel = rel.slice(0, -4); twin = true; }
      if (!live || live.failing.has(rel) || !live.files.has(rel)) return route.fulfill({ status: live && live.failing.has(rel) ? 500 : 404, body: "no" });
      const v = live.files.get(rel);
      let buf = Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v));
      if (twin) buf = Buffer.from(buf.toString("base64"));
      return route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || "application/octet-stream", body: buf, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
    }
    let f = path.join(dir, "public", decodeURIComponent(url.pathname));
    let asBase64 = false;
    if (f.endsWith(".bin.txt")) { f = f.slice(0, -4); asBase64 = true; } // the preview build asks for base64 twins of the binary files
    if (!f.startsWith(path.join(dir, "public")) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "not found" });
    let buf = fs.readFileSync(f);
    if (asBase64) buf = Buffer.from(buf.toString("base64"));
    if (stats) { stats.files[url.pathname] = buf.length; stats.bytes += buf.length; }
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || "application/octet-stream", body: buf, headers: { "access-control-allow-origin": "*" } });
  });
  // fonts and other external requests are not needed for tests
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  return { ctx, p };
}
