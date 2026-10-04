import { launch, openPage } from "../harness.mjs";
const browser = await launch();
const errors = [];
const { p } = await openPage(browser, "dist/radar.html", { errors, label: "showme", viewport: { width: 390, height: 780 } });
p.on("pageerror", (e) => console.log("STACK:", e.stack));
await p.goto("https://radar.test/", { waitUntil: "commit" });
await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 }).catch(() => {});
await p.waitForFunction(() => window.__radar.app.D.later && window.__radar.S.precise.size > 0, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.click("#tonightBtn");
await p.waitForSelector("#sheet .titem", { timeout: 15000 }).catch((e) => console.log("no titem", e.message));
const n = await p.locator("#sheet .titem button", { hasText: "Show me" }).count();
console.log("show-me buttons:", n);
for (let i = 0; i < n; i++) {
  if (!(await p.locator("#sheet .titem").count())) { await p.click("#tonightBtn"); await p.waitForSelector("#sheet .titem", { timeout: 15000 }); }
  const label = await p.locator("#sheet .titem").nth(i).innerText().then((t) => t.split("\n").slice(0, 2).join(" | ")).catch(() => "?");
  await p.locator("#sheet .titem button", { hasText: "Show me" }).nth(i).click();
  await p.waitForTimeout(1500);
  console.log(i, label.slice(0, 70), JSON.stringify(await p.evaluate(() => ({ view: window.__radar.S.view, off: window.__radar.S.skyOffsetMin, sel: window.__radar.S.selected && window.__radar.S.selected.kind, card: document.getElementById("card").hidden ? "hidden" : document.getElementById("card").innerText.split("\n")[0] }))));
  await p.evaluate(() => window.__radar.actions.closeCard && window.__radar.actions.closeCard());
  await p.click("#tonightBtn").catch(() => {});
  await p.waitForSelector("#sheet .titem", { timeout: 15000 }).catch(() => {});
}
console.log("errors:", errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)));
await browser.close();
