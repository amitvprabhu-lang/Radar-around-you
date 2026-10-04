// End-to-end checks for the app. Runs the built page in Chromium (software GL) on a phone-sized and a desktop-sized window.
// usage: npm run e2e (after npm run build)
import { launch, openPage, dir } from "./harness.mjs";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!ok) console.log("FAIL", name, detail); };
const browser = await launch();
const errors = [];
const metrics = {};

async function boot(label, viewport, mobile) {
  const stats = { files: {}, bytes: 0 };
  const { p } = await openPage(browser, process.env.PAGE || "dist/radar-snapshot.html", { viewport, mobile, label, errors, stats });
  const t0 = Date.now();
  await p.goto("https://radar.test/", { waitUntil: "commit" });
  await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 });
  const tReady = Date.now() - t0;
  const firstBytes = stats.bytes, firstFiles = Object.keys(stats.files).length;
  await p.waitForFunction(() => window.__radar.app.D.later, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  metrics[label] = { readyMs: tReady, firstBytes, firstFiles, allBytes: stats.bytes, allFiles: Object.keys(stats.files).length, files: stats.files };
  await p.evaluate(() => document.getElementById("toasts").replaceChildren());
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${dir}shots/e2e-${name}.png` });
const R = (p, fn, arg) => p.evaluate(fn, arg);

async function suite(label, viewport, mobile) {
  const p = await boot(label, viewport, mobile);
  const L = (s) => `${label}: ${s}`;

  // ---- A. boot and chrome
  check(L("page started and loader removed"), true);
  check(L("stats strip shows the catalogue size"), (await p.textContent("#stats")).includes("19,316"));
  check(L("place chip shows a place"), (await p.textContent("#placeChip")).length > 3);
  check(L("four tabs"), (await p.locator(".tab").count()) === 4);
  check(L("layer chips present"), (await p.locator("#layerChips .chip").count()) === 9);
  check(L("canvas has size"), await R(p, () => { const c = document.getElementById("gl"); return c.width > 100 && c.height > 100; }));
  check(L("WebGL2 context"), await R(p, () => window.__radar.app.renderer.capabilities.isWebGL2));

  // ---- B. layers and time
  await p.click("#layerChips .chip >> nth=1"); // Starlink
  check(L("Starlink toggle updates the swarm uniform"), await R(p, () => window.__radar.orbit.layers.starlink === false));
  check(L("chip reflects state"), (await p.getAttribute("#layerChips .chip >> nth=1", "aria-pressed")) === "false");
  await p.click("#layerChips .chip >> nth=1");
  const t1 = await R(p, () => window.__radar.app.clock.now().getTime());
  await p.click("#btnTime"); await p.waitForTimeout(1200);
  const t2 = await R(p, () => window.__radar.app.clock.now().getTime());
  check(L("time button speeds the clock up"), t2 - t1 > 20000, `advanced ${(t2 - t1) / 1000}s in about 1.2s`);
  for (let i = 0; i < 3; i++) await p.click("#btnTime");
  check(L("time button cycles back to live"), (await p.textContent("#clockText")).match(/LIVE|SNAPSHOT/));

  // ---- C. picking the ISS by tapping where it is
  const picked = await R(p, async () => {
    const r = window.__radar; const idx = r.app.D.later.ids.indexOf(25544); const date = r.app.clock.now();
    const g = r.orbit.satGeo(idx, date);
    r.orbit.flyTo(g.lat, g.lon, 3.0, 10);
    await new Promise((res) => setTimeout(res, 900));
    const canvas = document.getElementById("gl"); const rect = canvas.getBoundingClientRect();
    const sp = r.orbit.project(r.orbit.satScenePos(idx, r.app.clock.now()), rect.width, rect.height);
    const hit = r.orbit.pick(sp.x, sp.y, rect.width, rect.height, r.app.clock.now());
    return { idx, hit, onScreen: sp.x > 0 && sp.x < rect.width && sp.y > 0 && sp.y < rect.height };
  });
  check(L("ISS is on screen after flying to it"), picked.onScreen);
  check(L("tapping the ISS position picks the ISS"), picked.hit && picked.hit.kind === "sat" && picked.hit.idx === picked.idx, JSON.stringify(picked.hit));

  // ---- D. search
  await p.click("#btnSearch");
  await p.fill("#searchPanel input", "iss");
  await p.waitForTimeout(350);
  const first = await p.textContent("#searchPanel .result >> nth=0");
  check(L("search 'iss' puts ISS (ZARYA) first"), first.includes("ISS (ZARYA)"), first);
  await p.fill("#searchPanel input", "starlink 1008"); await p.waitForTimeout(350);
  check(L("search 'starlink 1008' finds a Starlink"), (await p.textContent("#searchPanel .results")).includes("STARLINK-1008"));
  await p.fill("#searchPanel input", "tambolaka"); await p.waitForTimeout(350);
  check(L("search finds a quake by place name"), (await p.textContent("#searchPanel .results")).includes("Tambolaka"));
  await p.fill("#searchPanel input", "zzzzqq"); await p.waitForTimeout(350);
  check(L("search says so when nothing matches"), (await p.textContent("#searchPanel .results")).includes("Nothing matches"));
  await p.fill("#searchPanel input", "hubble"); await p.waitForTimeout(350);
  check(L("search finds Hubble by name"), (await p.textContent("#searchPanel .results")).includes("HST"));
  await p.fill("#searchPanel input", "iss"); await p.waitForTimeout(350);
  await p.click("#searchPanel .result >> nth=0");
  await p.waitForTimeout(3000);
  const card1 = await p.textContent("#card");
  check(L("ISS card shows owner, site and launch date"), card1.includes("International Space Station") && card1.includes("Tyuratam") && card1.includes("20 Nov 1998"), card1.slice(0, 200));
  check(L("ISS card shows live height and speed"), /\d{3} km/.test(card1) && /7\.\d\d km\/s/.test(card1));
  check(L("search panel closed after choosing"), await p.locator("#searchPanel").isHidden());
  check(L("ISS selection draws overlays (footprint, track, orbit)"), await R(p, () => window.__radar.orbit.sel.item && window.__radar.orbit.sel.footprintKm > 2000));
  await p.click("text=Follow in 3D"); await p.waitForTimeout(3500);
  check(L("follow mode engaged"), await R(p, () => window.__radar.S.followIdx >= 0 && window.__radar.orbit.cam.mode === "follow"));
  await shot(p, `${label}-follow`);
  await p.click("text=Exit 3D follow"); await p.waitForTimeout(1500);
  check(L("follow mode exits"), await R(p, () => window.__radar.S.followIdx < 0 && window.__radar.orbit.cam.mode === "globe"));
  await p.keyboard.press("Escape");
  check(L("Escape closes the card"), await p.locator("#card").isHidden());

  // ---- E. earthquake: card, replay, Under view
  await p.click("#btnSearch"); await p.fill("#searchPanel input", "m5.9"); await p.waitForTimeout(350);
  const qres = await p.textContent("#searchPanel .results");
  check(L("magnitude search finds the M5.9"), qres.includes("Tambolaka"), qres.slice(0, 120));
  await p.click("#searchPanel .result >> nth=0"); await p.waitForTimeout(2800);
  const qcard = await p.textContent("#card");
  check(L("quake card shows PAGER and exposure"), qcard.includes("PAGER green") && qcard.includes("498,194"), qcard.slice(0, 160));
  check(L("quake card shows when waves reach you"), /P after \d+ min/.test(qcard));
  check(L("quake draws ShakeMap contours and wave rings"), await R(p, () => window.__radar.orbit.replay.active));
  await R(p, () => window.__radar.actions.setReplay({ tau: 600, paused: true }));
  await R(p, async () => { const f0 = window.__radar.S.frames; while (window.__radar.S.frames < f0 + 3) await new Promise((r) => setTimeout(r, 30)); });
  check(L("scrubbing the replay moves the P front"), await R(p, () => window.__radar.orbit.replay.rPkm > 4000), String(await R(p, () => window.__radar.orbit.replay.rPkm)));
  await p.click("text=Under my feet"); await p.waitForTimeout(2500);
  check(L("Under view active with the same quake"), await R(p, () => window.__radar.S.view === "under" && window.__radar.under.st.q.id === window.__radar.S.underQuake.id));
  const ptxt = await p.textContent("#underPanel");
  check(L("Under panel reports wave arrival"), /P wave (reaches you in|reached you)/.test(ptxt), ptxt.slice(0, 200));
  check(L("Under geometry: chord shorter than surface path"), await R(p, () => window.__radar.under.st.chordKm < window.__radar.under.st.surfaceKm));
  await shot(p, `${label}-under`);
  const chips = await p.locator("#hudTop .chip").count();
  check(L("Under offers other quakes"), chips >= 2, String(chips));
  await p.locator("#hudTop .chip >> nth=1").click(); await p.waitForTimeout(1500);
  check(L("choosing another quake updates the cutaway"), await R(p, () => window.__radar.under.st.q.id !== "us6000tzer"));

  // ---- F. sky
  await p.click('.tab[data-go="sky"]'); await p.waitForTimeout(2200);
  check(L("Sky view active"), await R(p, () => window.__radar.S.view === "sky"));
  check(L("heading readout"), /Facing [NESW]+ \d+°/.test(await p.textContent("#headText")));
  const sky = await R(p, () => { const s = window.__radar.sky; return { planes: s.planesNow.length, above: s.info.above, limit: s.info.limitMag, labels: document.querySelectorAll(".lbl").length }; });
  check(L("satellites counted above the horizon"), sky.above > 50, JSON.stringify(sky));
  check(L("compass labels drawn"), sky.labels >= 1);
  // sensor maths: upright phone facing north, east, and tilted to look up 45 degrees
  const sens = await R(p, async () => {
    const s = window.__radar.sky; const out = {};
    const read = async (a, b, g) => { s.sensor._feed(a, b, g); const f0 = window.__radar.S.frames; while (window.__radar.S.frames < f0 + 3) await new Promise((r) => setTimeout(r, 30)); return { yaw: s.view.yaw, pitch: s.view.pitch }; };
    out.north = await read(0, 90, 0); out.east = await read(270, 90, 0); out.south = await read(180, 90, 0); out.up45 = await read(0, 135, 0); out.down30 = await read(0, 60, 0);
    s.sensor.disable(); return out;
  });
  const ang = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  check(L("sensor: upright facing north looks north at the horizon"), ang(sens.north.yaw, 0) < 1.5 && Math.abs(sens.north.pitch) < 1.5, JSON.stringify(sens.north));
  check(L("sensor: alpha 270 looks east"), ang(sens.east.yaw, 90) < 1.5, JSON.stringify(sens.east));
  check(L("sensor: alpha 180 looks south"), ang(sens.south.yaw, 180) < 1.5, JSON.stringify(sens.south));
  check(L("sensor: tilting the top back looks up"), Math.abs(sens.up45.pitch - 45) < 1.5, JSON.stringify(sens.up45));
  check(L("sensor: tilting forward looks below the horizon"), sens.down30.pitch < -20, JSON.stringify(sens.down30));
  // pick an aircraft by tapping it
  const planePick = await R(p, () => {
    const s = window.__radar.sky; const canvas = document.getElementById("gl"); const rect = canvas.getBoundingClientRect();
    const rec = s.planesNow.filter((x) => x.el > 3).sort((a, b) => a.slantKm - b.slantKm)[0];
    if (!rec) return { none: true };
    s.view.yaw = rec.az; s.view.pitch = rec.el; s.view.fov = 50;
    return { hex: rec.p.hex, call: rec.p.call };
  });
  if (!planePick.none) {
    await p.waitForTimeout(500);
    const hit = await R(p, (pp) => {
      const s = window.__radar.sky; const canvas = document.getElementById("gl"); const rect = canvas.getBoundingClientRect();
      const rec = s.planesNow.find((x) => x.p.hex === pp.hex);
      const sp = s.project(rec.o.model.position, rect.width, rect.height);
      return s.pick(sp.x, sp.y, rect.width, rect.height, window.__radar.app.clock.now());
    }, planePick);
    check(L("tapping an aircraft picks it"), hit && hit.kind === "plane" && hit.hex === planePick.hex, JSON.stringify(hit && hit.kind));
    await R(p, (pp) => window.__radar.select({ kind: "plane", hex: pp.hex, rec: window.__radar.sky.planesNow.find((x) => x.p.hex === pp.hex) }), planePick);
    await p.waitForTimeout(500);
    const pc = await p.textContent("#card");
    check(L("aircraft card shows altitude and speed"), pc.includes("Altitude") && pc.includes("Speed") && pc.includes("kt"), pc.slice(0, 160));
    await shot(p, `${label}-plane-card`);
  } else check(L("an aircraft is above the horizon in the snapshot"), false, "none");
  await p.keyboard.press("Escape");

  // ---- G. guide
  await R(p, () => { const r = window.__radar; const idx = r.app.D.later.ids.indexOf(25544); r.select({ kind: "sat", idx }); r.actions.guide({ kind: "sat", idx }); });
  await p.waitForTimeout(900);
  check(L("guide panel appears"), await p.locator("#guide").isVisible());
  const gt = await p.textContent("#guide");
  check(L("guide says where the object is"), /below the horizon|Find|Found/.test(gt), gt.slice(0, 100));
  await R(p, () => window.__radar.actions.closeCard());

  // ---- H. places
  await p.click("#placeChip"); await p.waitForTimeout(300);
  await p.click("#sheet >> text=Tokyo"); await p.waitForTimeout(1200);
  check(L("switching place updates the chip and the sky"), (await p.textContent("#placeChip")).includes("Tokyo") && (await R(p, () => window.__radar.S.place.id === "tokyo")));
  check(L("Tokyo sky has aircraft"), (await R(p, () => window.__radar.sky.planesNow.length)) > 3);

  // ---- I. feed and arrivals
  await p.click('.tab[data-go="feed"]'); await p.waitForTimeout(500);
  const feed = await p.textContent("#sheet");
  check(L("feed lists quakes, launches and aircraft"), feed.includes("Earthquakes") && feed.includes("New in orbit") && feed.includes("Aircraft above"), feed.slice(0, 120));
  await shot(p, `${label}-feed`);
  await p.click("#sheet .btn >> nth=0"); await p.waitForTimeout(2800);
  check(L("Replay from the feed shows the quake on the globe with live waves"), await R(p, () => window.__radar.S.view === "globe" && window.__radar.orbit.replay.active && window.__radar.S.selected.kind === "quake"));
  await R(p, () => window.__radar.actions.closeCard());
  await p.click('.tab[data-go="feed"]'); await p.waitForTimeout(400);
  await p.locator("#sheet .btn", { hasText: "Show" }).first().click(); await p.waitForTimeout(2800);
  check(L("a new launch can be shown in orbit with its card"), await R(p, () => window.__radar.S.selected && window.__radar.S.selected.kind === "sat" && !document.getElementById("card").hidden));
  const newCard = await p.textContent("#card");
  check(L("new-launch card says it is new"), /NEW/.test(newCard), newCard.slice(0, 120));
  await shot(p, `${label}-arrival`);

  // ---- K. exact orbits, Tonight, strings and share cards
  check(L("exact orbits loaded for the stations, bright objects and new launches"), await R(p, () => window.__radar.S.precise.size > 150), String(await R(p, () => window.__radar.S.precise.size)));
  check(L("a Starlink string is found among the recent launches"), (await R(p, () => window.__radar.S.trains.length)) >= 1);
  check(L("Tonight button shows a verdict"), /Tonight: (excellent|good|fair|poor)/.test(await p.textContent("#tonightBtn")), await p.textContent("#tonightBtn"));
  await R(p, () => window.__radar.actions.closeCard());
  await p.click("#tonightBtn");
  await p.waitForSelector("#sheet .verdict", { timeout: 15000 });
  const tsheet = await p.textContent("#sheet");
  check(L("Tonight sheet has a verdict, conditions and a list of things to look for"), /Tonight in /.test(tsheet) && /Dark (now|from)/.test(tsheet) && /Moon \d+% lit/.test(tsheet) && /What to look for/.test(tsheet), tsheet.slice(0, 160));
  check(L("Tonight lists events with Show me buttons"), (await p.locator("#sheet .titem").count()) >= 1 && (await p.locator("#sheet .titem button", { hasText: "Show me" }).count()) >= 1);
  check(L("Tonight shows Remind me links to a calendar"), (await p.locator("#sheet .titem a[href^='https://calendar.google.com/']").count()) >= 0);
  await shot(p, `${label}-tonight`);
  await p.locator("#sheet .titem button", { hasText: "Show me" }).first().click();
  await p.waitForTimeout(1800);
  const sm = await R(p, () => ({ view: window.__radar.S.view, off: window.__radar.S.skyOffsetMin, rate: window.__radar.S.rateIdx }));
  check(L("Show me jumps to the sky at the time of the event"), sm.view === "sky" && sm.off >= 0 && sm.off <= 1440 && /Showing the sky at/.test(await p.textContent("#toasts")), JSON.stringify(sm));
  check(L("the sky slider reaches a full day ahead"), (await p.getAttribute("#hud input[type=range]", "max")) === "1440");
  await shot(p, `${label}-showme`);
  {
    const real = () => errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e));
    const before = real().length;
    await R(p, () => window.__radar.actions.closeCard());
    await p.click("#tonightBtn"); await p.waitForSelector("#sheet .titem", { timeout: 15000 });
    const total = await p.locator("#sheet .titem button", { hasText: "Show me" }).count();
    let okAll = total > 0;
    for (let i = 0; i < total; i++) {
      if (!(await p.locator("#sheet .titem").count())) { await p.click("#tonightBtn"); await p.waitForSelector("#sheet .titem", { timeout: 15000 }); }
      await p.locator("#sheet .titem button", { hasText: "Show me" }).nth(i).click();
      await p.waitForTimeout(700);
      if (!(await R(p, () => window.__radar.S.view === "sky"))) okAll = false;
      await R(p, () => window.__radar.actions.closeCard());
    }
    check(L(`every Show me button in Tonight works without errors (${total} items)`), okAll && real().length === before, real().slice(before).join(" | "));
  }
  await R(p, () => window.__radar.actions.closeCard());
  await p.click('.tab[data-go="globe"]'); await p.waitForTimeout(800);
  await p.locator("#stats .stat", { hasText: "Starlink string" }).click();
  await p.waitForSelector("#sheet h2", { timeout: 10000 });
  const strings = await p.textContent("#sheet");
  check(L("strings sheet explains and lists the recent string"), /Starlink strings/.test(strings) && /Launched 28 Sep/.test(strings) && /26 satellites/.test(strings), strings.slice(0, 200));
  await p.waitForTimeout(700);
  await shot(p, `${label}-strings`);
  await p.keyboard.press("Escape");
  // exact pass wording on a satellite card
  await R(p, () => { const r = window.__radar; r.actions.focusItem({ kind: "sat", idx: r.app.D.later.ids.indexOf(25544) }); });
  await p.waitForTimeout(2500);
  const issCard = await p.textContent("#card");
  check(L("ISS card shows exact orbit data age and SGP4 pass times"), /Orbit data age/.test(issCard) && /computed with SGP4/.test(issCard), issCard.slice(0, 120));
  check(L("ISS card says when it can next be seen, or that it cannot in 10 days"), /Next visible pass|No visible pass in the next 10 days|visible/.test(issCard));
  await shot(p, `${label}-iss-card`);
  await R(p, () => window.__radar.actions.closeCard());
  const trainSat = await R(p, () => { const r = window.__radar; return r.S.trains[0].centralIdx; });
  await R(p, (idx) => window.__radar.actions.focusItem({ kind: "sat", idx }), trainSat);
  await p.waitForTimeout(2200);
  check(L("a satellite in the string says so"), /Part of a Starlink string/.test(await p.textContent("#card")));
  await R(p, () => window.__radar.actions.closeCard());
  // share cards
  await p.click("#btnSearch"); await p.fill("#searchPanel input", "m5.9"); await p.waitForTimeout(350);
  await p.click("#searchPanel .result >> nth=0"); await p.waitForTimeout(2500);
  await p.locator("#card .btn", { hasText: "Share card" }).click();
  await p.waitForSelector("#sheet canvas.sharecanvas", { timeout: 10000 });
  const px = await R(p, () => {
    const c = document.querySelector("#sheet canvas.sharecanvas"); const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data; let min = 255, max = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (v < min) min = v; if (v > max) max = v; if (v > 80) lit++; }
    return { w: c.width, h: c.height, min, max, lit };
  });
  check(L("quake share card is drawn at 1080 by 1350 with real content"), px.w === 1080 && px.h === 1350 && px.max > 200 && px.lit > 500, JSON.stringify(px));
  check(L("quake share card text names the arrival time and the place"), /P waves reach/.test(await p.textContent("#sheet")) || /M5\.9 earthquake near/.test(await p.textContent("#sheet")));
  await shot(p, `${label}-share-quake`);
  await p.locator("#sheet .btn", { hasText: "Copy text" }).click(); await p.waitForTimeout(300);
  check(L("copy text gives feedback"), /Text copied|Copying is blocked/.test(await p.textContent("#sheet")));
  await p.locator("#sheet .btn", { hasText: "Save image" }).click();
  await p.waitForFunction(() => { const st = document.querySelector("#sheet [role=status]"); return st && st.textContent && !/Copying is blocked|Text copied/.test(st.textContent); }, null, { timeout: 10000 }).catch(() => {});
  const saveTxt = await p.textContent("#sheet");
  check(L("save image gives feedback"), /Image saved|Saving needs download permission|Not saved|Cancelled|Could not save/.test(saveTxt), saveTxt.slice(-220));
  await p.keyboard.press("Escape");
  await R(p, () => window.__radar.actions.closeCard());
  await p.click("#tonightBtn"); await p.waitForSelector("#sheet .verdict", { timeout: 15000 });
  await p.locator("#sheet .btn", { hasText: "Share tonight" }).click();
  await p.waitForSelector("#sheet canvas.sharecanvas", { timeout: 10000 });
  check(L("tonight share card opens"), (await p.textContent("#sheet")).includes("Tonight in "));
  await shot(p, `${label}-share-tonight`);
  await p.keyboard.press("Escape");
  await p.click(".brand"); await p.waitForTimeout(300);
  const about2 = await p.textContent("#sheet");
  check(L("about sheet reports data health"), /Data health/.test(about2) && /element sets read/.test(about2) && /median element set/.test(about2), about2.slice(0, 80));
  await p.keyboard.press("Escape");

  // ---- J. about
  await R(p, () => window.__radar.actions.closeCard());
  await p.click(".brand"); await p.waitForTimeout(300);
  check(L("about sheet lists sources and limits"), (await p.textContent("#sheet")).includes("Honest limits"));
  await p.keyboard.press("Escape");
  check(L("Escape closes the sheet"), await p.locator("#sheet").isHidden());

  await shot(p, `${label}-end`);
  await p.context().close();
}

await suite("phone", { width: 390, height: 780 }, true);
await suite("desktop", { width: 1280, height: 800 }, false);

const failed = results.filter((r) => !r.ok);
const realErrors = errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log("console errors:", realErrors.length ? realErrors.slice(0, 10) : "none");
for (const [k, m] of Object.entries(metrics)) console.log(k, `ready in ${m.readyMs} ms, first-load files ${m.firstFiles} (${(m.firstBytes / 1024).toFixed(0)} KB raw), all files ${m.allFiles} (${(m.allBytes / 1024).toFixed(0)} KB raw)`);
await browser.close();
process.exit(failed.length || realErrors.length ? 1 : 0);
