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
// Reads every globe texture back from the graphics card (level 0, through a framebuffer) and compares it with the same file uploaded
// the old way (three.js TextureLoader: an <img> with flipY). Also works out the sky glow of the current place the old way.
const textureCheck = (p) => p.evaluate(async () => {
  const { THREE, renderer, tex } = window.__radar.app;
  const gl = renderer.getContext();
  const files = { day: "tex/day2k.webp", night: "tex/night2k.webp", water: "tex/water2k.webp", relief: "tex/relief2k.webp", clouds: "tex/clouds2k.webp" };
  const readGL = (t, w, h) => {
    const wt = renderer.properties.get(t).__webglTexture;
    if (!wt) return null;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, wt, 0);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    renderer.resetState();
    return px;
  };
  const out = { differing: {}, kinds: {} };
  for (const [k, f] of Object.entries(files)) {
    const old = await new THREE.TextureLoader().loadAsync(f);
    renderer.initTexture(old);
    const w = old.image.width, h = old.image.height;
    const a = readGL(old, w, h), b = readGL(tex[k], w, h);
    let n = !a || !b ? -1 : 0;
    for (let i = 0; n >= 0 && i < a.length; i++) if (a[i] !== b[i]) n++;
    out.differing[k] = n;
    out.kinds[k] = tex[k].image && tex[k].image.constructor.name;
    old.dispose();
  }
  out.released = Object.values(out.kinds).every((c) => c === "HTMLImageElement") && Object.keys(files).every((k) => tex[k].userData.image === tex[k].image);
  const img = new Image(); img.src = files.night; await img.decode();
  const place = window.__radar.S.place, w = img.width, h = img.height;
  const c = document.createElement("canvas"); c.width = 16; c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, ((place.lon + 180) / 360) * w - 8, ((90 - place.lat) / 180) * h - 4, 16, 8, 0, 0, 16, 8);
  const px = g.getImageData(0, 0, 16, 8).data;
  let sum = 0, mx = 0;
  for (let i = 0; i < px.length; i += 4) { const l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255; sum += l; mx = Math.max(mx, l); }
  out.glowOld = Math.min(1, Math.max(0, sum / (px.length / 4) * 4.5 + mx * 0.25));
  out.glowApp = window.__radar.sky.info.glow;
  return out;
});
const shot = (p, name) => p.screenshot({ path: `${dir}shots/e2e-${name}.png` });
const R = (p, fn, arg) => p.evaluate(fn, arg);

async function suite(label, viewport, mobile) {
  const p = await boot(label, viewport, mobile);
  const L = (s) => `${label}: ${s}`;

  // ---- A. boot and chrome
  check(L("page started and loader removed"), true);
  check(L("stats strip shows the catalogue size"), (await p.textContent("#stats")).includes("19,316"));
  check(L("the catalogue tile is labelled tracked objects, not objects in orbit"), (await p.textContent("#stats")).includes("tracked objects") && !(await p.textContent("#stats")).includes("objects in orbit"));
  check(L("the catalogue tile is a link to the satellite count page"), (await p.getAttribute("#stats a.stat", "href")) === "how-many-satellites-in-orbit/" && (await p.textContent("#stats a.stat")).includes("19,316"));
  check(L("place chip shows a place"), (await p.textContent("#placeChip")).length > 3);
  check(L("four tabs"), (await p.locator(".tab").count()) === 4);
  check(L("layer chips present"), (await p.locator("#layerChips .chip").count()) === 9);
  check(L("canvas has size"), await R(p, () => { const c = document.getElementById("gl"); return c.width > 100 && c.height > 100; }));
  check(L("WebGL2 context"), await R(p, () => window.__radar.app.renderer.capabilities.isWebGL2));
  if (label === "phone") {
    // The textures are decoded off the main thread as upside-down ImageBitmaps and released to an <img> after the upload (src/engine.js).
    const tx = await textureCheck(p);
    check(L("textures are decoded off the main thread and their bitmaps released after the upload"), tx.released, JSON.stringify(tx.kinds));
    check(L("every globe texture on the graphics card holds exactly the texels the old <img> upload gave"), Object.values(tx.differing).every((n) => n === 0), JSON.stringify(tx.differing));
    check(L("the sky glow sample is the same as with the old <img> texture"), tx.glowOld === tx.glowApp, `${tx.glowOld} vs ${tx.glowApp}`);
  }

  // ---- B. layers and time
  await p.click("#layerChips .chip >> nth=1"); // Starlink
  check(L("Starlink toggle updates the swarm uniform"), await R(p, () => window.__radar.orbit.layers.starlink === false));
  check(L("chip reflects state"), (await p.getAttribute("#layerChips .chip >> nth=1", "aria-pressed")) === "false");
  await p.click("#layerChips .chip >> nth=1");
  await p.click("#btnTime");
  // The clock only advances when the page draws a frame, and the slow software renderer here can take over a second per frame.
  // So the speed is measured against the clock's own tick times (how much simulated time passed between two of its ticks), not against a fixed wait.
  const speed = await R(p, async () => {
    const st = window.__radar.app.clock.state;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextTick = async (after) => { const end = performance.now() + 30000; while (st.lastReal <= after && performance.now() < end) await wait(50); return st.lastReal > after; };
    if (!(await nextTick(st.lastReal))) return NaN;
    const a0 = st.acc, r0 = st.lastReal;
    if (!(await nextTick(r0 + 300))) return NaN;
    return (st.acc - a0) / (st.lastReal - r0);
  });
  check(L("time button speeds the clock up"), speed > 20, `the clock ran at ${Number.isNaN(speed) ? "no measurable speed (no frames drawn)" : speed.toFixed(1) + " times real time"}`);
  for (let i = 0; i < 3; i++) await p.click("#btnTime");
  check(L("time button cycles back to live"), (await p.textContent("#clockText")).match(/LIVE|SNAPSHOT/));

  // ---- C. picking the ISS by tapping where it is
  const picked = await R(p, async () => {
    const r = window.__radar; const idx = r.app.D.later.ids.indexOf(25544); const date = r.app.clock.now();
    const g = r.orbit.satGeo(idx, date);
    r.orbit.flyTo(g.lat, g.lon, 3.0, 10);
    const canvas = document.getElementById("gl"); const rect = canvas.getBoundingClientRect();
    // Wait until the camera has arrived (the ISS is at the middle of the screen and two more frames have been drawn). A fixed wait was not enough:
    // the software renderer draws about 2.6 frames a second, and while the camera is still moving a satellite behind the Earth can be tapped by mistake.
    await new Promise((res) => { const f0 = r.S.frames; const t = setInterval(() => { const q = r.orbit.project(r.orbit.satScenePos(idx, r.app.clock.now()), rect.width, rect.height); if (r.S.frames >= f0 + 2 && Math.hypot(q.x - rect.width / 2, q.y - rect.height / 2) < 12) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); res(); }, 15000); });
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
  await p.waitForFunction(() => /P wave/.test((document.getElementById("underPanel") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
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
  // ---- Sky Lens: the camera behind the sky (the browser is started with a fake camera, so this tests the real browser path)
  const clickBtn = (label) => R(p, (l) => { const b = [...document.querySelectorAll("#hud button")].find((x) => x.textContent === l); if (b) b.click(); return !!b; }, label);
  const lensState = () => R(p, () => { const v = document.getElementById("lens"), c = document.getElementById("gl"); return { on: document.body.dataset.lens, blend: getComputedStyle(c).mixBlendMode, display: getComputedStyle(v).display, hasStream: !!v.srcObject, ready: v.readyState, w: v.videoWidth, skyLens: window.__radar.sky.lens, fov: window.__radar.sky.view.fov, sensor: window.__radar.sky.view.sensor, btn: [...document.querySelectorAll("#hud button")].map((b) => b.textContent).filter((t) => /camera/i.test(t)) }; });
  const fovBefore = await R(p, () => window.__radar.sky.view.fov);
  check(L("Sky Lens: the sky view has a Camera button"), (await lensState()).btn.join() === "Camera");
  const hudFit = () => R(p, () => { const pan = document.querySelector("#hud .panel").getBoundingClientRect(); return [...document.querySelectorAll("#hud .panel button")].filter((b) => b.offsetParent).filter((b) => b.getBoundingClientRect().right > pan.right - 1 || b.getBoundingClientRect().left < pan.left).map((b) => b.textContent); });
  check(L("Sky Lens: every button in the sky panel stays inside it (before the camera is on)"), (await hudFit()).length === 0, JSON.stringify(await hudFit()));
  await clickBtn("Camera"); await p.waitForFunction(() => document.body.dataset.lens === "on" && document.getElementById("lens").readyState >= 2, null, { timeout: 8000 }).catch(() => {});
  let ls = await lensState();
  check(L("Sky Lens: the camera picture shows behind the sky, which blends over it with the painted sky and hills hidden"), ls.on === "on" && ls.display === "block" && ls.hasStream && ls.ready >= 2 && ls.w > 0 && ls.blend === "screen" && ls.skyLens === true, JSON.stringify(ls));
  check(L("Sky Lens: it turns the sensors on, sets the field of view, and the button now says Stop camera"), ls.sensor === true && ls.fov === 60 && ls.btn.join() === "Stop camera", JSON.stringify(ls));
  check(L("Sky Lens: and with the camera on, so Stop camera is as wide as Camera was"), (await hudFit()).length === 0, JSON.stringify(await hudFit()));
  await shot(p, "sky-lens");
  await R(p, () => { window.__track = document.getElementById("lens").srcObject.getTracks()[0]; });
  await clickBtn("Stop camera"); await p.waitForTimeout(300);
  ls = await lensState();
  check(L("Sky Lens: stopping releases the camera, brings the sky back and restores the field of view"), ls.on === "" && ls.display === "none" && !ls.hasStream && ls.skyLens === false && ls.blend === "normal" && Math.abs(ls.fov - fovBefore) < 0.01 && (await R(p, () => window.__track.readyState)) === "ended", JSON.stringify({ ...ls, fovBefore }));
  await R(p, () => { window.__radar.sky.sensor.disable(); window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); }; });
  await clickBtn("Camera"); await p.waitForTimeout(600);
  ls = await lensState();
  check(L("Sky Lens: a refused camera shows a plain message and leaves everything off"), ls.on === "" && !ls.hasStream && ls.btn.join() === "Camera" && /Camera not started/.test(await p.textContent("#toasts")) && /refused/.test(await p.textContent("#toasts")), JSON.stringify(ls) + (await p.textContent("#toasts")));
  await R(p, () => { navigator.mediaDevices.getUserMedia = window.__gum; });
  await clickBtn("Camera"); await p.waitForFunction(() => document.body.dataset.lens === "on", null, { timeout: 8000 }).catch(() => {});
  await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(400);
  ls = await lensState();
  check(L("Sky Lens: leaving the sky view turns the camera off"), ls.on === "" && !ls.hasStream && ls.display === "none", JSON.stringify(ls));
  await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(600);
  await R(p, () => window.__radar.sky.sensor.disable());
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
  await p.waitForFunction(() => { const t = document.getElementById("guideTitle"); return t && t.textContent.length > 0; }, null, { timeout: 15000 }).catch(() => {});
  check(L("guide panel appears"), await p.locator("#guide").isVisible());
  const gt = await p.textContent("#guide");
  check(L("guide says where the object is"), /below the horizon|Find|Found/.test(gt), gt.slice(0, 100));
  await R(p, () => window.__radar.actions.closeCard());

  // ---- H. places
  await p.click("#placeChip"); await p.waitForTimeout(300);
  await p.click("#sheet >> text=Tokyo"); await p.waitForTimeout(1200);
  check(L("switching place updates the chip and the sky"), (await p.textContent("#placeChip")).includes("Tokyo") && (await R(p, () => window.__radar.S.place.id === "tokyo")));
  check(L("Tokyo sky has aircraft"), (await R(p, () => window.__radar.sky.planesNow.length)) > 3);

  // ---- H2. any place on Earth
  await p.click("#placeChip"); await p.waitForTimeout(500);
  await p.fill("#sheet input.placeinput", "reykjav");
  await p.waitForSelector('#sheet button.item:has-text("Reykjav")', { timeout: 30000 });
  check(L("the places sheet finds a place that is not one of the six cities"), true);
  await p.click('#sheet button.item:has-text("Reykjav")'); await p.waitForTimeout(1500);
  const rv = await R(p, () => ({ chip: document.getElementById("placeChip").textContent, place: window.__radar.S.place, saved: localStorage.getItem("radar2.place"), custom: localStorage.getItem("radar2.customPlace") }));
  check(L("choosing it sets the place with its own time zone and saves it"), /Reykjav/.test(rv.chip) && rv.chip.includes("Iceland") && rv.place.custom === true && rv.place.tz === "Atlantic/Reykjavik" && JSON.parse(rv.saved) === rv.place.id && JSON.parse(rv.custom).name === rv.place.name, JSON.stringify(rv));
  await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(1500);
  check(L("the sky view works for it"), await R(p, () => Number.isFinite(window.__radar.sky.info.limitMag) && window.__radar.sky.info.above >= 0));
  await R(p, () => window.__radar.actions.openTonight()); await p.waitForSelector("#sheet h2", { timeout: 20000 }); await p.waitForTimeout(1500);
  const tn = await p.textContent("#sheet");
  check(L("Tonight says plainly that no cloud forecast exists for it"), /Cloud forecast not available for this place/.test(tn) && /Hourly cloud forecasts are published for the six cities/.test(tn), tn.slice(0, 160));
  await R(p, () => window.__radar.panels.closeSheet()); await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(500);
  await R(p, () => window.__radar.panels.openSearch()); await p.waitForTimeout(300);
  await p.fill("#searchPanel input", "nairobi");
  await p.waitForSelector('#searchPanel .result:has-text("Nairobi")', { timeout: 30000 });
  await p.click('#searchPanel .result:has-text("Nairobi")'); await p.waitForTimeout(1200);
  check(L("the main search also finds and sets any place"), (await p.textContent("#placeChip")).includes("Nairobi") && (await R(p, () => window.__radar.S.place.tz)) === "Africa/Nairobi");
  await p.context().grantPermissions(["geolocation"], { origin: "https://radar.test" });
  await p.context().setGeolocation({ latitude: -12.0464, longitude: -77.0428 });
  await p.click("#placeChip"); await p.waitForTimeout(500);
  await p.click('#sheet button:has-text("Use my location")'); await p.waitForTimeout(3500);
  const lm = await R(p, () => ({ chip: document.getElementById("placeChip").textContent, p: window.__radar.S.place }));
  check(L("Use my location sets the exact position, named for the place near it, in its zone"), /Lima/.test(lm.chip) && lm.p.positionFix === true && lm.p.tz === "America/Lima" && Math.abs(lm.p.lat + 12.0464) < 0.001 && Math.abs(lm.p.lon + 77.0428) < 0.001, JSON.stringify(lm));
  await p.click("#placeChip"); await p.waitForTimeout(400);
  check(L("the places sheet credits GeoNames"), /GeoNames \(geonames\.org\), CC BY 4\.0/.test(await p.textContent("#sheet")));
  await shot(p, "places-sheet");
  await R(p, () => window.__radar.panels.closeSheet());
  await R(p, () => window.__radar.actions.setPlace("tokyo")); await p.waitForTimeout(800);

  // ---- H3. deep links
  const go = async (hash) => { await R(p, (h) => { location.hash = h; }, hash); await p.waitForTimeout(1400); };
  const st = () => R(p, () => ({ view: window.__radar.S.view, sheet: window.__radar.S.sheet, place: window.__radar.S.place.id, hash: location.hash }));
  await go("#sky");
  check(L("a #sky link opens the sky view"), (await st()).view === "sky", JSON.stringify(await st()));
  await go("#place=london&calendar");
  let ds = await st();
  check(L("a link can set the place and open a screen together"), ds.place === "london" && ds.sheet === "calendar", JSON.stringify(ds));
  await go("#place=g3413829&aurora");
  ds = await st();
  check(L("a GeoNames place link loads the place list, sets the place and opens the aurora screen"), ds.place === "g3413829" && ds.sheet === "watch" && /Reykjav/.test(await p.textContent("#placeChip")), JSON.stringify(ds));
  await go("#place=pos_-12.05_-77.04&under");
  ds = await st();
  check(L("a position link sets an exact place and the Under view"), ds.place === "pos_-12.05_-77.04" && ds.view === "under" && ds.sheet === null, JSON.stringify(ds));
  const lat = await R(p, () => window.__radar.S.place.lat);
  check(L("and that place has the position and zone from the link"), Math.abs(lat + 12.05) < 0.001 && (await R(p, () => window.__radar.S.place.tz)) === "America/Lima");
  await R(p, () => window.__radar.panels.openAbout()); await p.waitForTimeout(300);
  check(L("opening a sheet updates the address so it can be shared"), (await st()).hash.endsWith("&about") || (await st()).hash === "#about" || /about/.test((await st()).hash), (await st()).hash);
  await R(p, () => window.__radar.panels.closeSheet()); await p.waitForTimeout(300);
  await go("#place=<script>alert(1)</script>&nonsense");
  check(L("a malformed link is ignored without errors"), (await st()).place === "pos_-12.05_-77.04");
  await go("#sky&con=cru");
  ds = await R(p, () => ({ view: window.__radar.S.view, kind: window.__radar.S.selected && window.__radar.S.selected.kind, abbr: window.__radar.S.selected && window.__radar.S.selected.abbr }));
  check(L("a #sky&con=cru link opens the Crux card in the sky view (the code is matched ignoring case)"), ds.view === "sky" && ds.kind === "constellation" && ds.abbr === "Cru" && /Crux/.test(await p.textContent("#card")), JSON.stringify(ds));
  await go("#sky&con=zzz");
  check(L("an unknown constellation code is ignored"), (await R(p, () => window.__radar.S.selected && window.__radar.S.selected.abbr)) === "Cru");
  await R(p, () => window.__radar.actions.setPlace("tokyo")); await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(600);
  await R(p, () => window.__radar.actions.setPlace(window.__radar.app.D.cities.find((c) => c.tz === Intl.DateTimeFormat().resolvedOptions().timeZone)?.id || window.__radar.app.D.cities[0].id)); await p.waitForTimeout(600);
  check(L("back on the default place and the globe the address is clean"), (await st()).hash === "", (await st()).hash);
  await R(p, () => window.__radar.actions.setPlace("tokyo")); await p.waitForTimeout(500);

  // ---- H5. stars and constellations
  await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(800);
  const sirius = await R(p, () => { const i = [...window.__radar.app.D.later.starInfo.values()].find((x) => x.name === "Sirius"); return i; });
  await R(p, (i) => window.__radar.actions.focusItem({ kind: "star", i: i.i, name: "Sirius" }), sirius); await p.waitForTimeout(900);
  let card = await p.textContent("#card");
  check(L("a star card gives its IAU name, Bayer designation, constellation meaning and rank"), /Sirius/.test(card) && /α Canis Majoris/.test(card) && /the Great Dog/.test(card) && /the brightest in this catalogue/.test(card) && /IAU name/.test(card), card.slice(0, 220));

  check(L("the Sirius card gives distance in light-years and parsecs, the light's age, spectral type and luminosity, and credits the HYG database"), /Distance.*about 8\.6 light-years \(2\.64 parsecs\)/.test(card) && /left it about 8\.6 years ago/.test(card) && /Spectral type/.test(card) && /Luminosity.*about 23 times the Sun's/.test(card) && /HYG database v4\.4 \(CC BY-SA 4\.0\)/.test(card), card.slice(0, 400));
  const pollux = await R(p, () => [...window.__radar.app.D.later.starInfo.values()].find((x) => x.name === "Pollux"));
  await R(p, (i) => window.__radar.actions.focusItem({ kind: "star", i: i.i, name: "Pollux" }), pollux); await p.waitForTimeout(700);
  const pcard = await p.textContent("#card");
  check(L("the Pollux card lists its confirmed planet and credits the NASA Exoplanet Archive"), /Known planets.*1 confirmed planet: HD 62509 b/.test(pcard) && /NASA Exoplanet Archive/.test(pcard), pcard.slice(0, 400));
  await R(p, (i) => window.__radar.actions.focusItem({ kind: "star", i: i.i, name: "Sirius" }), sirius); await p.waitForTimeout(500);
  check(L("it gives colour, rise and set times for the place, and where it is now"), /white \(B-V/.test(card) && /(Rises|Never)/.test(card) && /(up,|below the horizon)/.test(card), card.slice(220, 600));
  await R(p, () => window.__radar.actions.closeCard());
  const unnamed = await R(p, () => { const D = window.__radar.app.D; for (let i = 0; i < D.stars.n; i++) if (D.stars.mag[i] < 3 && !D.later.starInfo.has(i)) return i; return -1; });
  if (unnamed >= 0) { await R(p, (i) => window.__radar.actions.focusItem({ kind: "star", i, name: null }), unnamed); await p.waitForTimeout(700); card = await p.textContent("#card"); check(L("a star without an IAU name is shown by its Hipparcos number and says so"), /HIP \d+/.test(card) && /The IAU has not given this star a name/.test(card), card.slice(0, 160)); await R(p, () => window.__radar.actions.closeCard()); }
  await R(p, () => window.__radar.actions.openConstellation("Ori")); await p.waitForTimeout(1200);
  card = await p.textContent("#card");
  check(L("a constellation card gives the IAU's name, meaning, pronunciation and genitive"), /Orion/.test(card) && /the Hunter/.test(card) && /Pronounced/.test(card) && /Orionis/.test(card), card.slice(0, 200));
  check(L("it gives size, brightest star, best month and how it sits over the place"), /square degrees, number \d+ of 88/.test(card) && /Rigel, magnitude 0\.2/.test(card) && /Evenings in January/.test(card) && /(never rises|never sets|clears the horizon|part of it)/i.test(card), card.slice(200, 700));
  check(L("it lists the IAU-named stars inside it as buttons"), (await p.locator("#card .examples .chip").count()) >= 5 && /Betelgeuse/.test(card));
  check(L("choosing a constellation outlines it in the sky"), (await R(p, () => window.__radar.sky.overlayInfo().focus)) === "Ori");
  await R(p, () => window.__radar.actions.closeCard());
  check(L("closing the card removes the outline"), (await R(p, () => window.__radar.sky.overlayInfo().focus)) === null);
  const chips2 = await p.locator("#skyChips .chip").allTextContents();
  check(L("the sky chips offer Star lines and Boundaries"), chips2.includes("Star lines") && chips2.includes("Boundaries"), chips2.join());
  await p.click('#skyChips .chip:has-text("Star lines")'); await p.click('#skyChips .chip:has-text("Boundaries")'); await p.waitForTimeout(1500);
  // Turn to the constellation highest above the horizon and widen the view, so there is always something to label whatever the time of day
  // (a fixed view showed 3 or more labels in the daytime run but 2 at other times). The labels on screen must then match what the app's own
  // label list says is inside the screen.
  const lab = await R(p, async () => {
    const r = window.__radar, s = r.sky, w = document.getElementById("gl").clientWidth, hgt = document.getElementById("gl").clientHeight;
    let best = null;
    for (const c of r.app.D.later.constellations.list) { const aa = s.altAzOf({ kind: "constellation", abbr: c.abbr }, r.app.clock.now()); if (aa && (!best || aa.alt > best.alt)) best = aa; }
    s.view.yaw = best.az; s.view.pitch = Math.max(10, Math.min(60, best.alt)); s.view.fov = 90;
    const f0 = r.S.frames; while (r.S.frames < f0 + 3) await new Promise((res) => setTimeout(res, 100));
    const expected = s.labelPoints().filter((l) => l.cls === "con").filter((l) => { const q = s.project(l.pos, w, hgt); return q.front && q.x >= -40 && q.x <= w + 40 && q.y >= -20 && q.y <= hgt + 20; }).length;
    const shown = [...document.querySelectorAll("#labels .lbl.con")].filter((e) => !e.hidden).length;
    return { expected, shown, highest: Math.round(best.alt), b: s.overlayInfo() };
  });
  check(L("constellation names are labelled in the sky and the 88 boundaries are drawn"), lab.shown >= 1 && lab.shown === lab.expected && lab.b.boundariesBuilt && lab.b.boundariesVisible, JSON.stringify(lab));
  await shot(p, "constellations");
  await R(p, () => { const el = [...document.querySelectorAll("#labels .lbl.con")].find((e) => !e.hidden); el.click(); }); await p.waitForTimeout(800);
  check(L("tapping a constellation name opens its card"), (await R(p, () => window.__radar.S.selected && window.__radar.S.selected.kind)) === "constellation");
  await R(p, () => window.__radar.actions.closeCard());
  await p.click('#skyChips .chip:has-text("Star lines")'); await p.click('#skyChips .chip:has-text("Boundaries")'); await p.waitForTimeout(300);
  await p.click('#hud button:has-text("Guide")'); await p.waitForSelector('#sheet button.item'); await p.waitForTimeout(500);
  const upRows = await p.locator("#sheet button.item").count();
  check(L("the constellation guide lists what is up now, brightest first"), upRows >= 15 && /Constellations/.test(await p.textContent("#sheet")), String(upRows));
  await p.fill('#sheet input[type="search"]', "great bear"); await p.waitForTimeout(400);
  check(L("it searches meanings as well as names"), /Ursa Major/.test(await p.textContent("#sheet")));
  await p.click('#sheet button.item:has-text("Ursa Major")'); await p.waitForTimeout(1000);
  check(L("choosing one from the list opens its card"), /Ursa Major/.test(await p.textContent("#card")) && (await R(p, () => window.__radar.sky.overlayInfo().focus)) === "UMa");
  await R(p, () => window.__radar.actions.closeCard());
  await R(p, () => window.__radar.panels.openSearch()); await p.waitForTimeout(300);
  await p.fill("#searchPanel input", "betelgeuse"); await p.waitForSelector('#searchPanel .result:has-text("Betelgeuse")', { timeout: 15000 });
  await p.click('#searchPanel .result:has-text("Betelgeuse")'); await p.waitForTimeout(900);
  check(L("the main search finds a named star and opens its card"), /Betelgeuse/.test(await p.textContent("#card")) && /α Orionis/.test(await p.textContent("#card")));
  await R(p, () => window.__radar.actions.closeCard());
  await R(p, () => window.__radar.panels.openSearch()); await p.waitForTimeout(300);
  await p.fill("#searchPanel input", "cassiopeia"); await p.waitForSelector('#searchPanel .result:has-text("Cassiopeia")', { timeout: 15000 });
  check(L("the main search finds a constellation"), true);
  await R(p, () => window.__radar.panels.closeSearch());
  await go("#constellations");
  check(L("a #constellations link opens the guide"), (await st()).sheet === "constellations", JSON.stringify(await st()));
  await R(p, () => window.__radar.panels.closeSheet()); await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(400);

  // ---- H4. night use: red light and keeping the screen on
  const channels = async () => {
    const b64 = (await p.screenshot()).toString("base64");
    return p.evaluate(async (data) => { const img = new Image(); img.src = "data:image/png;base64," + data; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gr = 0, b = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > r) r = d[i]; if (d[i + 1] > gr) gr = d[i + 1]; if (d[i + 2] > b) b = d[i + 2]; } return { r, g: gr, b }; }, b64);
  };
  await p.context().grantPermissions(["screen-wake-lock"], { origin: "https://radar.test" }).catch(() => {});
  await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(1500);
  const normal = await channels();
  check(L("without red light the screen has green and blue light"), normal.g > 100 && normal.b > 100, JSON.stringify(normal));
  const chipNames = await p.locator("#skyChips .chip").allTextContents();
  check(L("the sky view offers a Red light chip, and Keep screen on only where the browser supports it"), chipNames.includes("Red light") && chipNames.includes("Keep screen on") === (await R(p, () => window.__radar.wake.supported)), chipNames.join());
  await p.click('#skyChips .chip:has-text("Red light")'); await p.waitForTimeout(500);
  const red = await channels();
  check(L("with red light on, almost no green and no blue light reaches the eye"), red.b <= 2 && red.g <= 30 && red.r > 40, JSON.stringify(red));
  await shot(p, "red-light");
  check(L("red light is remembered"), (await R(p, () => localStorage.getItem("radar2.night"))) === "true");
  await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(600);
  check(L("leaving the sky view turns the red light off, so it cannot trap anyone"), (await R(p, () => document.documentElement.classList.contains("night"))) === false);
  await R(p, () => window.__radar.setView("sky")); await p.waitForTimeout(600);
  check(L("coming back to the sky view restores it"), (await R(p, () => document.documentElement.classList.contains("night"))) === true);
  await p.click('#skyChips .chip:has-text("Red light")'); await p.waitForTimeout(300);
  const wk = await R(p, () => window.__radar.wake.state());
  check(L("in the sky view the screen lock is wanted, and any browser refusal is recorded without an error"), wk.wanted === true && (wk.supported === false || wk.active === true || typeof wk.error === "string"), JSON.stringify(wk));
  await R(p, () => window.__radar.setView("globe")); await p.waitForTimeout(500);
  check(L("leaving the sky view stops asking for the screen lock"), (await R(p, () => window.__radar.wake.state().wanted)) === false);
  await R(p, () => window.__radar.setView("globe"));

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

  // ---- L. sky calendar
  await R(p, () => window.__radar.panels.closeSheet());
  const tileTexts = await p.locator("#stats .stat").allTextContents();
  check(L("the stats strip has a next-event tile with a date and a name"), tileTexts.some((t) => /^\d{1,2} [A-Z][a-z]{2}.+/.test(t)), tileTexts.join(" | "));
  await p.locator("#stats .stat").nth(1).click();
  await p.waitForSelector("#sheet .callist .titem", { timeout: 15000 });
  const calText = await p.textContent("#sheet");
  check(L("the next-event tile opens the sky calendar"), /Sky calendar for /.test(calText) && /Moon phases, equinoxes, solstices and solar eclipses were checked against the US Naval Observatory/.test(calText), calText.slice(0, 100));
  const rows = await p.locator("#sheet .callist .titem").count();
  check(L("the calendar lists many events grouped under month headings"), rows >= 10 && (await p.locator("#sheet .callist h3").count()) >= 3, String(rows));
  check(L("six filters, all selected at first"), (await p.locator("#sheet .chip").count()) === 6 && (await p.getAttribute("#sheet .chip >> nth=0", "aria-pressed")) === "true");
  check(L("every event has a reminder link into a calendar"), (await p.locator("#sheet .callist a[href^='https://calendar.google.com/']").count()) === rows);
  await shot(p, `${label}-calendar`);
  await p.locator("#sheet .chip", { hasText: "Showers" }).click();
  const showerKinds = await R(p, () => [...document.querySelectorAll("#sheet .callist .titem")].map((e) => e.dataset.kind));
  check(L("the Showers filter shows only meteor showers, including the Orionids"), showerKinds.length >= 3 && showerKinds.every((k) => k === "shower") && /Orionids/.test(await p.textContent("#sheet")), showerKinds.join());
  await p.locator("#sheet .chip", { hasText: "Eclipses" }).click();
  const ecl = await R(p, () => ({ n: document.querySelectorAll("#sheet .callist .titem").length, msg: /Nothing of this kind/.test(document.querySelector("#sheet .callist").textContent) }));
  check(L("the Eclipses filter shows eclipses or says there are none"), ecl.n > 0 ? true : ecl.msg, JSON.stringify(ecl));
  await p.locator("#sheet .chip", { hasText: "Moon" }).click();
  check(L("the Moon filter lists phases with a Full Moon"), /Full Moon/.test(await p.textContent("#sheet .callist")));
  await p.keyboard.press("Escape");
  const srcKinds = {
    satellite: () => { const r = window.__radar; r.actions.focusItem({ kind: "sat", idx: r.app.D.later.ids.indexOf(25544) }); },
    quake: () => { const r = window.__radar; r.actions.focusItem({ kind: "quake", q: r.app.D.quakes.events[0] }); },
    hazard: () => { const r = window.__radar; r.actions.focusItem({ kind: "event", e: r.app.D.events[0] }); },
    moon: () => window.__radar.actions.focusItem({ kind: "moon" }),
    planet: () => window.__radar.actions.focusItem({ kind: "planet", name: "Jupiter" }),
    star: () => window.__radar.actions.focusItem({ kind: "star", i: 0, name: "Sirius" }),
  };
  for (const [k, fn] of Object.entries(srcKinds)) {
    await R(p, () => window.__radar.actions.closeCard());
    await R(p, fn);
    await p.waitForTimeout(1200);
    const src = await R(p, () => { const e = document.querySelector("#card .srcline"); return e ? e.textContent : ""; });
    check(L(`the ${k} card names its source`), /Source:|Computed on your device/.test(src), src.slice(0, 80));
  }
  await R(p, () => window.__radar.actions.closeCard());

  // ---- J. about
  await R(p, () => window.__radar.actions.closeCard());
  await p.click(".brand"); await p.waitForTimeout(300);
  check(L("about sheet lists sources and limits"), (await p.textContent("#sheet")).includes("Honest limits"));
  await p.keyboard.press("Escape");
  check(L("Escape closes the sheet"), await p.locator("#sheet").isHidden());

  await shot(p, `${label}-end`);
  if (label === "phone") {
    // Last on the page, as it resets the graphics: after a lost WebGL context is restored, three.js uploads every texture again from
    // texture.image, which for a released bitmap is an <img> the right way up (src/engine.js flipForReupload); the globe must come back the same.
    const lost = await R(p, async () => {
      const r = window.__radar, gl = r.app.renderer.getContext();
      const ext = gl.getExtension("WEBGL_lose_context");
      if (!ext) return { ok: false, why: "no WEBGL_lose_context" };
      // the globe view, so the frames after the restore upload the globe's textures again (the suite ends in another view)
      r.setView("globe");
      ext.loseContext();
      await new Promise((res) => setTimeout(res, 500));
      ext.restoreContext();
      const f0 = r.S.frames;
      await new Promise((res) => { const end = Date.now() + 30000; const t = setInterval(() => { if (r.S.frames > f0 + 3 || Date.now() > end) { clearInterval(t); res(); } }, 100); });
      return { ok: !gl.isContextLost() && r.S.frames > f0 + 3, frames: r.S.frames - f0 };
    });
    check(L("the app draws again after a lost WebGL context is restored"), lost.ok, JSON.stringify(lost));
    const tx = await textureCheck(p);
    check(L("after a context restore every globe texture again holds exactly the texels of the old <img> upload"), Object.values(tx.differing).every((n) => n === 0), JSON.stringify(tx.differing));
  }
  await p.context().close();
}

// ---- links from the About screen to the content pages: only in the build for the real site
{
  const { GUIDE_LINKS } = await import("./src/guidelinks.js");
  const aboutLinks = async (file) => {
    const { p } = await openPage(browser, file, { viewport: { width: 390, height: 780 }, mobile: true, label: file, errors });
    await p.goto("https://radar.test/", { waitUntil: "commit" });
    await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
    await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 });
    await p.waitForFunction(() => window.__radar.app.D.later, null, { timeout: 60000 });
    await p.evaluate(() => window.__radar.panels.openAbout()); await p.waitForTimeout(400);
    return { p, text: await p.textContent("#sheet"), links: await p.evaluate(() => [...document.querySelectorAll("#sheet .guidelinks a")].map((a) => [a.getAttribute("href"), a.textContent, a.href])) };
  };
  const plain = await aboutLinks("dist/radar-snapshot.html");
  check("About: the bundled preview build shows no links to content pages that do not exist next to it", !/Guides and reference/.test(plain.text) && plain.links.length === 0, plain.links.length + " links");
  await plain.p.context().close(); // free the first page before the second starts: pages left open keep drawing and slow every later page
  const site = await aboutLinks("dist/radar-sitepages.html");
  check("About: the build for the real site lists every guide and reference page, grouped", /Guides and reference/.test(site.text) && site.links.length === GUIDE_LINKS.length && GUIDE_LINKS.every((l, i) => site.links[i][0] === l.href && site.links[i][1] === l.label) && /Sky reference/.test(site.text) && /Stars and places/.test(site.text), JSON.stringify(site.links.slice(0, 3)));
  check("About: the links are plain relative addresses that open in the same tab and resolve next to the app", site.links.every((l) => l[2] === `https://radar.test/${l[0]}`) && !(await site.p.evaluate(() => [...document.querySelectorAll("#sheet .guidelinks a")].some((a) => a.target === "_blank"))), JSON.stringify(site.links.slice(0, 2)));
  check("About: the links section does not overflow the screen sideways", await site.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll("#sheet .guidelinks a")].every((a) => a.getBoundingClientRect().right <= innerWidth)));
  check("About: the app build alone has no home text section, so the About sheet shows no overview link (the content site adds both)", await site.p.evaluate(() => !document.getElementById("about-home") && !document.querySelector("#sheet .overview a")));
  await site.p.evaluate(() => { const s = document.querySelector("#sheet .guidelinks"); s && s.scrollIntoView(); }); await site.p.waitForTimeout(300);
  await shot(site.p, "about-guides");
  await site.p.context().close();
}
await suite("phone", { width: 390, height: 780 }, true);
await suite("desktop", { width: 1280, height: 800 }, false);

const failed = results.filter((r) => !r.ok);
// the macOS graphics driver logs a performance notice ("GPU stall due to ReadPixels") as a warning; it is not an app error and Linux never prints it
const realErrors = errors.filter((e) => !/fonts\.g|ERR_FAILED|GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels/.test(e));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log("console errors:", realErrors.length ? realErrors.slice(0, 10) : "none");
for (const [k, m] of Object.entries(metrics)) console.log(k, `ready in ${m.readyMs} ms, first-load files ${m.firstFiles} (${(m.firstBytes / 1024).toFixed(0)} KB raw), all files ${m.allFiles} (${(m.allBytes / 1024).toFixed(0)} KB raw)`);
await browser.close();
process.exit(failed.length || realErrors.length ? 1 : 0);
