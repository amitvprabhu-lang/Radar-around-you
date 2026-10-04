import { launch, openPage, dir } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, "dist/smoke.html", { errors, label: "probe", viewport: { width: 390, height: 780 } });
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radar && window.__radar.ready, null, { timeout: 120000 });
await p.evaluate(() => { window.__radar.state.view = "sky"; });
for (const h of [-2, -1.2, 0, 2, 5]) {
  await p.evaluate((h) => window.__radar.setOffset(h * 3600e3), h);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => { const s = window.__radar.sky; const D = window.__radar.app.D; let n = 0; for (let i = 0; i < D.stars.n; i++) if (D.stars.mag[i] < s.info.limitMag) n++; return { sunAlt: +s.info.sunAlt.toFixed(1), limit: +s.info.limitMag.toFixed(2), starsBelowLimit: n, magUniform: s.field.starUniforms.magLimit.value, milky: +s.field.milkyUniforms.amount.value.toFixed(2), moonAlt: +s.info.moon.alt.toFixed(1), now: window.__radar.app.clock.now().toISOString(), sim: window.__radar.app.clock.state.simulated }; });
  console.log(h, JSON.stringify(r));
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
