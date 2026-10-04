// End-to-end smoke test: loads the built page in Chromium on a simulated phone, walks through
// every lens and action, records console errors and saves screenshots to shots/.
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");

const dir = new URL(".", import.meta.url).pathname;
const body = fs.readFileSync(dir + "dist/radar.html", "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${body}</body></html>`;
fs.mkdirSync(dir + "shots", { recursive: true });
const VENDOR = { "three@0.186.1/build/three.module.min.js": "three.module.min.js", "three@0.186.1/build/three.core.js": "three.core.js", "satellite.js@7.1.0/+esm": "satellite.esm.js", "astronomy-engine@2.1.19/esm/astronomy.js": "astronomy.js" };
async function useVendor(p) {
  await p.route("https://cdn.jsdelivr.net/npm/**", (route) => {
    const key = route.request().url().replace("https://cdn.jsdelivr.net/npm/", "");
    const file = VENDOR[key];
    if (!file) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(dir + "vendor/" + file, "utf8") });
  });
}


const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page); });
await new Promise((r) => server.listen(8765, r));

const browser = await chromium.launch({
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };

async function run(label, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  p.on("requestfailed", (r) => errors.push(`[${label}] request failed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  await useVendor(p); await p.route("https://radar.test/", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page }));
  await p.goto("https://radar.test/", { waitUntil: "commit" });
  await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 90000 });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${dir}shots/${label}-1-arrival.png` });
  await p.waitForFunction(() => document.body.dataset.lens === "world", null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${dir}shots/${label}-2-globe-home.png` });
  check(`${label}: arrival lands on the globe home`, (await p.getAttribute("body", "data-lens")) === "world");
  const above = Number((await p.textContent("#stAbove")).replace(/,/g, ""));
  check(`${label}: stats strip shows satellites above`, above > 0, String(above));
  check(`${label}: stats strip shows objects in orbit`, Number((await p.textContent("#stOrbit")).replace(/,/g, "")) > 19000);
  await p.getByRole("button", { name: "Starlink" }).click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${dir}shots/${label}-2a-globe-no-starlink.png` });
  await p.getByRole("button", { name: "Starlink" }).click();
  await p.getByRole("button", { name: "Dive into my sky" }).click();
  await p.waitForFunction(() => document.body.dataset.lens === "above", null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `${dir}shots/${label}-3-above.png` });
  check(`${label}: dive-in reaches the sky dome`, (await p.getAttribute("body", "data-lens")) === "above");
  const head = await p.textContent("#headline");
  check(`${label}: headline filled`, /satellites and/.test(head), head);
  check(`${label}: ISS card present`, (await p.textContent("#card")).includes("ISS"));
  const g1 = p.getByRole("button", { name: "Guide me", exact: true });
  if (await g1.count()) {
    await g1.click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${dir}shots/${label}-3b-guide.png` });
    for (let i = 0; i < 8; i++) await p.getByRole("button", { name: "Turn right" }).click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}shots/${label}-3c-guide-turned.png` });
    check(`${label}: guide gives an instruction`, /Turn|facing/i.test(await p.textContent(".guide-say")));
    await p.getByRole("button", { name: "Close" }).click();
    await p.waitForTimeout(300);
  }

  await p.click('.tab[data-lens="tonight"]');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${dir}shots/${label}-3-tonight.png` });
  await p.fill("#tonightRange", "300");
  await p.dispatchEvent("#tonightRange", "input");
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${dir}shots/${label}-4-tonight-later.png` });
  check(`${label}: tonight timeline has 13 slots`, (await p.locator(".timeline .slot").count()) === 13);

  await p.click('.tab[data-lens="under"]');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dir}shots/${label}-5-under.png` });
  const replay = p.getByRole("button", { name: "Replay the week" });
  if (await replay.count()) { await replay.click(); await p.waitForTimeout(3500); await p.screenshot({ path: `${dir}shots/${label}-6-under-replay.png` }); }

  await p.click('.tab[data-lens="world"]');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${dir}shots/${label}-7-world.png` });
  check(`${label}: globe card lists events`, /cyclone|wildfire|flood/i.test(await p.textContent("#card")));

  await p.click("#placeBtn");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}shots/${label}-8-places.png` });
  await p.getByRole("button", { name: /Tromsø/ }).click();
  await p.waitForTimeout(2200);
  await p.click('.tab[data-lens="tonight"]');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${dir}shots/${label}-9-tromso-tonight.png` });
  check(`${label}: city switched`, (await p.textContent("#placeName")) === "Tromsø");

  await p.click('.tab[data-lens="above"]');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dir}shots/${label}-10-tromso-above.png` });
  await p.click("#aboutBtn");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}shots/${label}-13-sources.png` });
  await ctx.close();
}

try {
  await run("phone", { width: 390, height: 844 }, true);
  await run("desktop", { width: 1280, height: 800 }, false);
} finally {
  await browser.close();
  server.close();
}
const fontNoise = (e) => /fonts\.g(static|oogleapis)/.test(e);
const real = errors.filter((e) => !fontNoise(e));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : " :: " + r.detail}`);
console.log(`errors: ${real.length}`);
for (const e of real.slice(0, 30)) console.log("  " + e);
if (errors.length !== real.length) console.log(`(ignored ${errors.length - real.length} font loading messages)`);
