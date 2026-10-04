// Opens one card of every kind and prints its source line; screenshots each.
import { launch, openPage, dir } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, process.env.PAGE || "dist/radar-snapshot.html", { errors, label: "cards" });
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
await p.waitForFunction(() => !document.getElementById("loader") && window.__radar.app.D.later, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const kinds = {
  sat: () => { const r = window.__radar; r.actions.focusItem({ kind: "sat", idx: r.app.D.later.ids.indexOf(25544) }); },
  quake: () => { const r = window.__radar; const q = r.app.D.quakes.events.find((e) => e.place.includes("Parbhani")) || r.app.D.quakes.events[0]; r.actions.focusItem({ kind: "quake", q }); },
  event: () => { const r = window.__radar; r.actions.focusItem({ kind: "event", e: r.app.D.events.find((e) => e.type !== "EQ") || r.app.D.events[0] }); },
  moon: () => { window.__radar.actions.focusItem({ kind: "moon" }); },
  planet: () => { window.__radar.actions.focusItem({ kind: "planet", name: "Jupiter" }); },
  star: () => { window.__radar.actions.focusItem({ kind: "star", i: 0, name: "Sirius" }); },
};
for (const [k, fn] of Object.entries(kinds)) {
  await p.evaluate(() => window.__radar.actions.closeCard());
  await p.evaluate(fn);
  await p.waitForTimeout(1800);
  const src = await p.evaluate(() => { const e = document.querySelector("#card .srcline"); return e ? e.textContent : null; });
  console.log(k.padEnd(7), src ? "OK  " + src.slice(0, 150) : "MISSING SOURCE LINE");
  await p.screenshot({ path: `${dir}shots/card-${k}.png` });
}
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
