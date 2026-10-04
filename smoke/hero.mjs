import { launch, openPage, dir } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, "dist/radar.html", { errors, label: "hero", viewport: { width: 390, height: 780 } });
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(4500);
await p.evaluate(() => document.getElementById("toasts").replaceChildren());
await p.screenshot({ path: dir + "shots/v2-hero-1.png" });
// new launch arrival, card collapsed
await p.evaluate(async () => { const r = window.__radar; await new Promise((res) => { const t = setInterval(() => { if (r.app.D.later) { clearInterval(t); res(); } }, 50); }); r.S.cardCollapsed = true;
  const D = r.app.D; const g = (await import("data:text/javascript,")).default; });
await p.evaluate(() => { const r = window.__radar; const idx = r.app.D.meta.newIdx[r.app.D.meta.newIdx.length - 1]; r.S.cardCollapsed = true; r.actions.showArrival({ first: idx, count: 1, site: "Air Force Eastern Test Range, Florida, USA", ageDays: 2 }); r.S.cardCollapsed = true; r.panels.renderCard(); });
await p.waitForTimeout(4200);
await p.evaluate(() => document.getElementById("toasts").replaceChildren());
await p.screenshot({ path: dir + "shots/v2-hero-2-arrival.png" });
// quake replay on the globe
await p.evaluate(() => { const r = window.__radar; const q = r.app.D.quakes.events.find((e) => e.id === "us6000tzer"); r.S.cardCollapsed = true; r.actions.replayQuake(q); r.S.cardCollapsed = true; r.panels.renderCard(); r.actions.setReplay({ tau: 400, paused: true }); });
await p.waitForTimeout(4200);
await p.evaluate(() => document.getElementById("toasts").replaceChildren());
await p.screenshot({ path: dir + "shots/v2-hero-3-quake.png" });
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
