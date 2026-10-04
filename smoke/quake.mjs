import { launch, openPage, dir } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, "dist/radar.html", { errors, label: "q", viewport: { width: 390, height: 780 } });
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(3000);
await p.evaluate(async () => { const r = window.__radar; await new Promise((res) => { const t = setInterval(() => { if (r.app.D.later) { clearInterval(t); res(); } }, 50); });
  document.getElementById("toasts").replaceChildren();
  const q = r.app.D.quakes.events.find((e) => e.id === "us6000tzer"); r.actions.replayQuake(q); r.S.cardCollapsed = true; r.panels.renderCard(); r.actions.setReplay({ speed: 10 }); });
for (const [i, ms] of [[1, 4500], [2, 6000], [3, 9000]]) {
  await p.waitForTimeout(ms);
  await p.evaluate(() => document.getElementById("toasts").replaceChildren());
  await p.screenshot({ path: dir + `shots/v2-quake-${i}.png` });
  console.log(i, await p.evaluate(() => JSON.stringify({ tau: Math.round(window.__radar.orbit.replay.tau), dist: +window.__radar.orbit.cam.dist.toFixed(2) })));
}
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
