// Visits every screen of the app at phone and desktop widths, records any console error, and saves a screenshot of each.
// usage: node smoke/screens.mjs [phone|desktop]   (PAGE=dist/radar-snapshot.html by default)
import { launch, openPage, dir } from "../harness.mjs";
const only = process.argv[2];
const browser = await launch();
const errors = [];
const sizes = [["phone", { width: 390, height: 780 }, true], ["desktop", { width: 1280, height: 800 }, false]].filter(([n]) => !only || n === only);
const R = (p, fn, a) => p.evaluate(fn, a);
for (const [label, viewport, mobile] of sizes) {
  const { p } = await openPage(browser, process.env.PAGE || "dist/radar-snapshot.html", { errors, label, viewport, mobile });
  await p.goto("https://radar.test/", { waitUntil: "commit" });
  await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById("loader") && window.__radar.app.D.later, null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  const shot = async (name) => { await p.waitForTimeout(900); await p.screenshot({ path: `${dir}shots/screen-${label}-${name}.png` }); console.log(label, name); };
  const clear = async () => { await R(p, () => { const r = window.__radar; r.panels.closeSheet(); r.panels.closeSearch(); r.actions.closeCard(); document.getElementById("toasts").replaceChildren(); }); };
  await clear(); await shot("01-globe");
  await R(p, () => window.__radar.panels.openSearch()); await p.fill("#searchPanel input", "starlink"); await p.waitForTimeout(500); await shot("02-search");
  await clear(); await R(p, () => window.__radar.panels.openPlaces()); await shot("03-places");
  await clear(); await R(p, () => window.__radar.panels.openFeed()); await shot("04-feed");
  await clear(); await R(p, () => window.__radar.panels.openTonight()); await p.waitForSelector("#sheet .verdict", { timeout: 20000 }); await shot("05-tonight");
  await clear(); await R(p, () => window.__radar.panels.openTrains()); await shot("06-strings");
  await clear(); await R(p, () => window.__radar.panels.openCalendar()); await shot("07-calendar");
  await clear(); await R(p, () => window.__radar.panels.openStatus()); await shot("08-status");
  await clear(); await R(p, () => window.__radar.panels.openAbout()); await shot("09-about");
  await clear();
  const card = async (name, fn) => { await clear(); await R(p, fn); await p.waitForTimeout(1600); await R(p, () => document.getElementById("toasts").replaceChildren()); await shot(name); };
  await card("10-card-iss", () => { const r = window.__radar; r.actions.focusItem({ kind: "sat", idx: r.app.D.later.ids.indexOf(25544) }); });
  await card("11-card-quake", () => { const r = window.__radar; r.actions.focusItem({ kind: "quake", q: r.app.D.quakes.events.find((e) => e.mag >= 5) || r.app.D.quakes.events[0] }); });
  await card("12-card-hazard", () => { const r = window.__radar; r.actions.focusItem({ kind: "event", e: r.app.D.events.find((e) => e.type !== "EQ") || r.app.D.events[0] }); });
  await clear(); await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(2500); await shot("13-sky");
  await R(p, () => window.__radar.actions.focusItem({ kind: "moon" })); await p.waitForTimeout(1500); await shot("14-sky-moon-card");
  await R(p, () => window.__radar.actions.focusItem({ kind: "planet", name: "Jupiter" })); await p.waitForTimeout(1500); await shot("15-sky-planet-card");
  await R(p, () => window.__radar.actions.focusItem({ kind: "star", i: 0, name: "Sirius" })); await p.waitForTimeout(1500); await shot("16-sky-star-card");
  await clear(); await R(p, () => window.__radar.setView("under")); await p.waitForTimeout(2500); await shot("17-under");
  await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(1200);
  await clear(); await R(p, () => { const r = window.__radar; r.actions.openShare && r.actions.openShare(window.__radar.panels && null); }).catch(() => {});
  await p.close();
}
console.log("console errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
