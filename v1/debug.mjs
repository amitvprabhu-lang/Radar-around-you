import fs from "node:fs"; import http from "node:http"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const dir = new URL(".", import.meta.url).pathname;
const body = fs.readFileSync(dir + "dist/radar.html", "utf8");
const VENDOR = { "three@0.186.1/build/three.module.min.js": "three.module.min.js", "three@0.186.1/build/three.core.js": "three.core.js", "satellite.js@7.1.0/+esm": "satellite.esm.js", "astronomy-engine@2.1.19/esm/astronomy.js": "astronomy.js" };
async function useVendor(p) {
  await p.route("https://cdn.jsdelivr.net/npm/**", (route) => {
    const key = route.request().url().replace("https://cdn.jsdelivr.net/npm/", "");
    const file = VENDOR[key];
    if (!file) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(dir + "vendor/" + file, "utf8") });
  });
}

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`;
const server = http.createServer((q, r) => { r.writeHead(200, {"content-type":"text/html"}); r.end(page); }); await new Promise(r => server.listen(8766, r));
const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }, args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const p = await ctx.newPage();
p.on("console", m => console.log("console", m.type(), m.text().slice(0,300)));
p.on("pageerror", e => console.log("pageerror", e.message.slice(0,300)));
p.on("requestfailed", r => console.log("reqfail", r.url().slice(0,120), r.failure()?.errorText));
p.on("response", r => { if (!r.url().startsWith("http://localhost")) console.log("resp", r.status(), r.url().slice(0,110)); });
await useVendor(p); await p.route("https://radar.test/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: page })); await p.goto("https://radar.test/"); await p.waitForTimeout(15000);
console.log("started:", await p.evaluate(() => window.__radarStarted));
await browser.close(); server.close();
