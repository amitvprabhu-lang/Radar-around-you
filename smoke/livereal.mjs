// Loads a real pipeline output folder (LIVE_DIR) into the app through the harness and takes screenshots.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, dir } from "../harness.mjs";
const root = process.env.LIVE_DIR;
const files = new Map();
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "_state") walk(p); } else files.set("live/" + path.relative(root, p).split(path.sep).join("/"), fs.readFileSync(p)); } })(root);
const browser = await launch();
const errors = [];
const live = { files, failing: new Set() };
for (const [label, viewport, mobile] of [["real-phone", { width: 390, height: 780 }, true], ["real-desktop", { width: 1280, height: 800 }, false]]) {
  const { p } = await openPage(browser, "dist/radar.html", { errors, label, live, viewport, mobile });
  await p.goto("https://radar.test/", { waitUntil: "commit" });
  await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 });
  await p.waitForFunction(() => window.__radar.app.D.later && window.__radar.liveCtl(), null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => document.getElementById("toasts").replaceChildren());
  const info = await p.evaluate(() => { const D = window.__radar.app.D; return { used: Object.keys(D.live.used), fell: D.live.fellBack, taken: D.meta.taken, count: D.meta.count, quakes: D.quakes.events.length, events: D.events.length, red: D.events.filter((e) => e.alert === "Red").length, orange: D.events.filter((e) => e.alert === "Orange").length, simulated: window.__radar.app.clock.state.simulated, clock: document.getElementById("clockText").textContent }; });
  console.log(label, JSON.stringify(info));
  await p.screenshot({ path: `${dir}shots/${label}-home.png` });
  await p.evaluate(() => window.__radar.panels.openStatus());
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dir}shots/${label}-status.png` });
  if (mobile) { await p.evaluate(() => { document.querySelector("#sheet .body").scrollTop = 1500; }); await p.waitForTimeout(300); await p.screenshot({ path: `${dir}shots/${label}-status2.png` }); }
  await p.close();
}
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
