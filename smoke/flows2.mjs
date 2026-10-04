import { launch, openPage, dir } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, "dist/radar.html", { errors, label: "flows2", viewport: { width: 390, height: 780 } });
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(3000);
const shot = async (n) => { await p.screenshot({ path: dir + `shots/v2-flow-${n}.png` }); };
await p.evaluate(() => document.getElementById("toasts").replaceChildren());
await p.click('.tab[data-go="sky"]'); await p.waitForTimeout(2500);
await shot("10-sky");
// tap the plane label if any
const info = await p.evaluate(() => { const r = window.__radar; return { planes: r.sky.planesNow.length, above: r.sky.info.above, near: r.sky.planesNow.slice(0, 3).map((x) => [x.p.call, Math.round(x.el), Math.round(x.az)]) }; });
console.log(JSON.stringify(info));
// choose the ISS, ask the sky to guide
await p.evaluate(() => { const r = window.__radar; const idx = r.app.D.later.ids.indexOf(25544); r.select({ kind: "sat", idx }); r.actions.guide({ kind: "sat", idx }); });
await p.waitForTimeout(1200);
await shot("11-sky-guide-iss");
// tonight slider forward 4 hours
await p.evaluate(() => { const s = document.querySelector("#hud input[type=range]"); s.value = "240"; s.dispatchEvent(new Event("input")); });
await p.waitForTimeout(1500);
await shot("12-sky-later");
await p.click('.tab[data-go="feed"]'); await p.waitForTimeout(600);
await shot("13-feed");
await p.keyboard.press("Escape");
await p.click("#placeChip"); await p.waitForTimeout(500);
await shot("14-places");
await p.click("text=Tromsø"); await p.waitForTimeout(1500);
await p.click('.tab[data-go="sky"]'); await p.waitForTimeout(2500);
await shot("15-tromso-sky");
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
