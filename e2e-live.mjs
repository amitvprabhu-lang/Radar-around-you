// Browser checks for live mode: the page reads the pipeline's manifest, uses live files, picks up new publishes without a
// reload, and shows stale, failing, paused and offline states honestly. A pretend live folder is served from memory by
// the harness and changed while the page runs.
// usage: npm run e2e:live
import { launch, openPage, dir } from "./harness.mjs";
import { livePack, isoNow } from "./test/livepack.js";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!ok) console.log("FAIL", name, detail); };
const browser = await launch();
const R = (p, fn, arg) => p.evaluate(fn, arg);
const shot = async (p, name) => { await p.waitForTimeout(1300); return p.screenshot({ path: `${dir}shots/live-${name}.png` }); };
const iso = (offsetMs = 0) => isoNow(Date.now() + offsetMs);

function newLive(taken = iso(-60000)) {
  const pk = livePack({ taken });
  return { files: new Map(Object.entries(pk.files)), failing: new Set() };
}
const manifestOf = (live) => structuredClone(live.files.get("live/manifest.json"));
const setManifest = (live, m) => { m.generatedAt = iso(); live.files.set("live/manifest.json", m); };
// publish a new version of one feed the way the pipeline does: new files under a new version folder, then the manifest
function publish(live, id, version, content = {}, patch = {}) {
  const m = manifestOf(live), f = m.feeds[id];
  const next = {};
  for (const [name, rel] of Object.entries(f.files)) {
    next[name] = rel.replace(/\/[^/]+\//, `/${version}/`);
    live.files.set("live/" + next[name], content[name] !== undefined ? content[name] : live.files.get("live/" + rel));
  }
  Object.assign(f, { files: next, version, checkedAt: iso(), fetchedAt: iso() }, patch);
  setManifest(live, m);
}

async function open(label, live, { viewport = { width: 390, height: 780 }, mobile = true, errors = [] } = {}) {
  const { p } = await openPage(browser, process.env.PAGE || "dist/radar.html", { viewport, mobile, label, errors, live });
  await p.goto("https://radar.test/", { waitUntil: "commit" });
  await p.waitForFunction(() => window.__radarStarted === true, null, { timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById("loader"), null, { timeout: 60000 });
  await p.waitForFunction(() => window.__radar.app.D.later && window.__radar.liveCtl(), null, { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById("toasts").replaceChildren());
  return p;
}
const poll = async (p) => { await R(p, () => window.__radar.liveCtl().pollNow()); await p.waitForTimeout(400); };
const tile = (p, label) => R(p, (l) => { const t = [...document.querySelectorAll("#stats .stat")].find((e) => e.textContent.includes(l)); return t ? t.querySelector("b").textContent : null; }, label);
const dataTile = (p) => R(p, () => { const t = [...document.querySelectorAll("#stats .stat")].find((e) => e.querySelector("span") && /feeds|bundled|source asked|retrying|out of date/.test(e.textContent)); return t ? t.textContent : ""; });
const dotClasses = (p) => R(p, () => document.querySelector("#btnTime .dot").className);
const openStatus = async (p) => { await R(p, () => window.__radar.panels.openStatus()); await p.waitForSelector("#sheet h2"); };
const closeSheet = (p) => R(p, () => window.__radar.panels.closeSheet());

// ---------------------------------------------------------------- 1. live data is used at start
{
  const live = newLive();
  const taken = live.files.get("live/manifest.json").feeds.satellites.fetchedAt;
  const p = await open("live", live);
  const st = await R(p, () => ({ used: Object.keys(window.__radar.app.D.live.used).sort(), fell: window.__radar.app.D.live.fellBack, taken: window.__radar.app.D.meta.taken, q: window.__radar.app.D.quakes.generated, kp: window.__radar.app.D.meta.kp[0].kp, simulated: window.__radar.app.clock.state.simulated }));
  check("live: every feed came from the live folder", st.used.join() === "aurora,closeapproaches,clouds,events,fires,kp,planes,quakes,satellites,spaceweather,storms" && st.fell.length === 0, JSON.stringify(st));
  check("live: the satellite group's fetch time drives the clock, which is real time", st.taken === taken && st.simulated === false, `${st.taken} ${st.simulated}`);
  check("live: quakes and Kp are the live ones", st.q === "LIVE" && st.kp === 6.33);
  check("live: the clock chip says LIVE", /^LIVE/.test(await p.textContent("#clockText")), await p.textContent("#clockText"));
  check("live: the data tile says everything is up to date", /Live.*all feeds up to date/.test(await dataTile(p)), await dataTile(p));
  const dot = await dotClasses(p);
  check("live: the clock dot is plain green", !/sim|bad/.test(dot), dot);
  check("live: the globe has one marker per live quake and storm", (await R(p, () => window.__radar.orbit.markers.geometry.getAttribute("position").count)) === 2);
  check("live: the place has the live cloud forecast", await R(p, () => window.__radar.S.place.id !== "pune" || window.__radar.S.place.clouds.hours[0].cloud === 11));
  await p.locator("#stats .stat", { hasText: /feeds up to date/ }).click();
  await p.waitForSelector("#sheet h2");
  const sheet = await p.textContent("#sheet");
  check("live: the data tile opens the status sheet", /Data status/.test(sheet) && /Every feed is up to date/.test(sheet), sheet.slice(0, 120));
  check("live: eleven feeds are listed, all fresh", (await p.locator("#sheet .feedrow").count()) === 11 && (await p.locator("#sheet .statepill.fresh").count()) === 11);
  check("live: each feed shows its source, its terms and its credit", /Test source/.test(sheet) && /Test licence/.test(sheet) && /Credits: Test credit/.test(sheet));
  check("live: reference data that is not live is listed", /Not live yet/.test(sheet) && /Fixed catalogue/.test(sheet));
  await shot(p, "status-phone");
  await closeSheet(p);

  // ---------------------------------------------------------------- 2. a new publish is picked up without a reload
  const now = iso();
  const kpT = new Date(Date.now() - 3600e3).toISOString().slice(0, 19);
  const grid = Buffer.alloc(360 * 181); grid[200] = 99;
  publish(live, "quakes", "v2", { "quakes.json": { generated: now, events: [
    { id: "new-big", mag: 7.1, place: "Test Trench", time: now, lat: -20, lon: -70, depth: 30, status: "", felt: 0, url: "" },
    { id: "x1", mag: 5.5, place: "Test place", time: now, lat: 1, lon: 2, depth: 10, status: "", felt: 0, url: "" }] } });
  publish(live, "events", "v2", { "events.json": [
    { id: "TC1", type: "TC", name: "Storm", alert: "Red", country: "", from: now, to: now, current: true, lat: 10, lon: 120, severity: "", url: "" },
    { id: "FL9", type: "FL", name: "Flood", alert: "Orange", country: "", from: now, to: now, current: true, lat: 20, lon: 80, severity: "", url: "" }] });
  publish(live, "kp", "v2", { "kp.json": [{ t: kpT, kp: 8 }] });
  publish(live, "aurora", "v2", { "aurora.bin": grid, "aurora.json": { observation: now, forecast: now } });
  publish(live, "clouds", "v2", { "clouds.json": { cities: Object.fromEntries(["pune", "newyork", "london", "tromso", "tokyo", "sydney"].map((id) => [id, { updated: now, fetchedAt: now, hours: [{ t: now, cloud: 99, temp: 1 }] }])) } });
  publish(live, "planes", "v2", { "planes.json": { cities: { london: { time: now, fetchedAt: now, aircraft: [] } } } });
  await poll(p);
  const after = await R(p, () => { const r = window.__radar, D = r.app.D; return { first: D.quakes.events[0].id, markers: r.orbit.markers.geometry.getAttribute("position").count, kp: D.meta.kp[0].kp, aur: D.aurora[200], cloud: r.S.place.clouds.hours[0].cloud, london: D.cities.find((c) => c.id === "london").planes.aircraft.length, taken: D.meta.taken, errs: r.liveCtl().state().errors }; });
  check("live update: new quakes appear without a reload", after.first === "new-big", JSON.stringify(after));
  check("live update: the globe markers are rebuilt (two quakes, two hazards)", after.markers === 4, String(after.markers));
  check("live update: Kp, aurora grid, cloud forecast and aircraft are replaced", after.kp === 8 && after.aur === 99 && after.cloud === 99 && after.london === 0, JSON.stringify(after));
  check("live update: nothing failed to apply", Object.keys(after.errs).length === 0, JSON.stringify(after.errs));
  check("live update: the quake count tile follows", (await tile(p, "quakes in 24 h")) === "2", await tile(p, "quakes in 24 h"));
  check("live update: the Kp tile follows", (await tile(p, "Kp, space weather")) === "8.0", await tile(p, "Kp, space weather"));
  check("live update: orbit data is untouched by a feed update", after.taken === taken);
  await R(p, () => window.__radar.setView("sky"));
  await p.waitForTimeout(1200);
  check("live update: the sky view keeps working after a refresh", await R(p, () => window.__radar.S.view === "sky" && window.__radar.sky.info.aurora !== null));
  await R(p, () => window.__radar.setView("globe"));
  await p.waitForTimeout(500);

  // ---------------------------------------------------------------- 3. stale, failing and paused feeds
  let m = manifestOf(live);
  m.feeds.quakes.checkedAt = iso(-3 * 3600e3);
  setManifest(live, m); await poll(p);
  check("stale: the tile and the clock dot show it", /Stale.*1 feed out of date/.test(await dataTile(p)) && /sim/.test(await dotClasses(p)), `${await dataTile(p)} | ${await dotClasses(p)}`);
  await openStatus(p);
  const stale = await R(p, () => document.querySelector('#sheet [data-feed="quakes"] .statepill').textContent);
  check("stale: the sheet marks the earthquake feed stale", stale === "Stale", stale);
  await shot(p, "status-stale");
  await closeSheet(p);

  m = manifestOf(live);
  m.feeds.quakes.checkedAt = iso(-60000);
  m.feeds.kp.status = "failing"; m.feeds.kp.error = "HTTP 503";
  setManifest(live, m); await poll(p);
  check("failing: the last good copy is kept and the tile says a feed is retrying", /Live.*1 feed retrying/.test(await dataTile(p)), await dataTile(p));
  await openStatus(p);
  const failing = await R(p, () => ({ pill: document.querySelector('#sheet [data-feed="kp"] .statepill').textContent, text: document.querySelector('#sheet [data-feed="kp"]').textContent }));
  check("failing: the sheet shows the problem", failing.pill === "Last try failed" && /HTTP 503/.test(failing.text), JSON.stringify(failing));
  await closeSheet(p);

  m = manifestOf(live);
  m.feeds.kp.status = "ok"; m.feeds.kp.error = null;
  m.feeds.satellites.halted = { since: iso(), until: iso(6 * 3600e3), reason: "HTTP 403 from celestrak.org" };
  setManifest(live, m); await poll(p);
  check("paused: a source's policy halt is shown in red", /Paused/.test(await dataTile(p)) && /bad/.test(await dotClasses(p)), `${await dataTile(p)} | ${await dotClasses(p)}`);
  m = manifestOf(live); m.feeds.satellites.halted = null; setManifest(live, m); await poll(p);
  check("paused: it clears when the pipeline clears it", /all feeds up to date/.test(await dataTile(p)));

  // ---------------------------------------------------------------- 4. the host fails, then recovers
  live.failing.add("live/manifest.json");
  await poll(p);
  const off = await R(p, () => window.__radar.liveCtl().state());
  check("offline: the page notes it could not reach the data folder and keeps what it has", off.offline === true && off.failures === 1);
  await openStatus(p);
  check("offline: the sheet says so plainly", /could not reach the data folder/.test(await p.textContent("#sheet")));
  await closeSheet(p);
  live.failing.delete("live/manifest.json");
  await poll(p);
  check("offline: recovery is picked up", (await R(p, () => window.__radar.liveCtl().state())).offline === false);

  // ---------------------------------------------------------------- 5. new orbit data is announced, not swapped in silently
  publish(live, "satellites", "v2", {}, {});
  await poll(p);
  const toastText = await p.textContent("#toasts");
  check("orbits: a newer satellite set raises one notice with a reload button", /Newer orbit data is ready/.test(toastText) && (await p.locator("#toasts button", { hasText: "Reload" }).count()) === 1, toastText);
  check("orbits: the running scene keeps its orbit set", await R(p, () => window.__radar.app.D.meta.taken === window.__radar.app.D.live.sources.satellites.fetchedAt));
  await openStatus(p);
  check("orbits: the status sheet offers the reload too", (await p.locator("#sheet button", { hasText: "Reload to use newer orbit data" }).count()) === 1);
  await closeSheet(p);
  await poll(p);
  check("orbits: the notice is not repeated on the next poll", (await p.locator("#toasts .toast").count()) <= 1);

  // ---------------------------------------------------------------- 6. a desktop window shows the sheet properly
  await p.close();
}
{
  const live = newLive();
  const p = await open("live-desktop", live, { viewport: { width: 1280, height: 800 }, mobile: false });
  await openStatus(p);
  await shot(p, "status-desktop");
  check("desktop: the sheet fits the window", await R(p, () => { const b = document.querySelector("#sheet .body").getBoundingClientRect(); return b.width <= innerWidth && b.height <= innerHeight; }));
  await p.close();
}

// ---------------------------------------------------------------- 7. a live file that fails falls back and says so
{
  const live = newLive();
  live.failing.add("live/quakes/v1/quakes.json");
  const p = await open("live-fallback", live);
  const st = await R(p, () => ({ fell: window.__radar.app.D.live.fellBack, q: window.__radar.app.D.quakes.generated }));
  check("fallback: a failing live file is replaced by the snapshot's", st.fell.join() === "quakes" && st.q !== "LIVE", JSON.stringify(st));
  await openStatus(p);
  check("fallback: the sheet says which feed fell back", /Could not load live quakes at start/.test(await p.textContent("#sheet")));
  await p.close();
}

// ---------------------------------------------------------------- 8. no live folder: an honest snapshot
{
  const errors = [];
  const p = await open("snapshot", null, { errors });
  check("snapshot: no Fires chip and no storm, fire or near-you tiles when there is no live data", !(await R(p, () => [...document.querySelectorAll("#layerChips .chip")].some((c) => c.textContent === "Fires"))) && (await tile(p, "active storm")) === null && (await tile(p, "fire detections")) === null && (await tile(p, "asteroid flybys")) === null);
  check("snapshot: the tile says it is a bundled snapshot", /Snapshot.*bundled data, not live/.test(await dataTile(p)), await dataTile(p));
  await openStatus(p);
  check("snapshot: the sheet says live feeds are not connected", /not connected here/.test(await p.textContent("#sheet")));
  await shot(p, "status-snapshot");
  const other = errors.filter((e) => !/fonts\.g|ERR_FAILED|status of 404/.test(e));
  check("snapshot: no console errors other than the missing live folder", other.length === 0, other.join(" | "));
  await p.close();
}

// ---------------------------------------------------------------- 9. storms, fire and aurora screens
for (const [label, viewport, mobile] of [["phone", { width: 390, height: 780 }, true], ["desktop", { width: 1280, height: 800 }, false]]) {
  const errors = [];
  const live = newLive();
  const p = await open(`hz-${label}`, live, { errors, viewport, mobile });
  const sheetText = () => p.textContent("#sheet");
  const noOverflow = () => R(p, () => { const b = document.querySelector("#sheet .body"); return b.scrollWidth <= b.clientWidth + 1; });
  check(`hazards ${label}: tiles for storms, fires and near you appear when the feeds are live`, (await tile(p, "active storms")) === "2" && /\d/.test(await tile(p, "fire detections")) && (await tile(p, "near")) !== null, `${await tile(p, "active storms")} ${await tile(p, "fire detections")}`);
  await R(p, () => window.__radar.panels.openWatch("aurora")); await p.waitForSelector("#sheet .kpbox");
  let t = await sheetText();
  check(`hazards ${label}: aurora shows Kp, the G level in NOAA's words and the warning in force`, /6\.3/.test(t) && /G2, Moderate: NOAA says aurora has been seen as low as New York and Idaho/.test(t) && /Warning: Kp 6 expected \(G2, Moderate\)/.test(t), t.slice(0, 300));
  check(`hazards ${label}: aurora shows the solar wind with a Bz direction and two charts`, /Speed/.test(t) && /pointing (south|north)/.test(t) && (await p.locator("#sheet .wchart svg").count()) === 2);
  check(`hazards ${label}: the NOAA scale lists G1 to G5 and names its source`, (await p.locator("#sheet .item.near .mag").allTextContents()).filter((x) => /^G[1-5]$/.test(x)).length === 5 && /Source: NOAA Space Weather Scales/.test(t));
  check(`hazards ${label}: the aurora screen does not overflow sideways`, await noOverflow());
  await shot(p, `hz-${label}-aurora`);
  await p.click('#sheet [data-tab="storms"]'); await p.waitForSelector("#sheet .stormcard");
  t = await sheetText();
  check(`hazards ${label}: storms shows both NHC storms with Saffir-Simpson categories`, /Hurricane Rachel, category 2/.test(t) && /Hurricane Nolo, category 3/.test(t), t.slice(0, 200));
  check(`hazards ${label}: each storm has a map with a cone and a forecast track`, (await p.locator("#sheet svg.stormmap").count()) === 2 && (await p.locator("#sheet svg.stormmap path.cone").count()) >= 2 && (await p.locator("#sheet svg.stormmap path.track").count()) === 2);
  check(`hazards ${label}: the cone's own caveat and the scale source are quoted`, /60 to 70 percent/.test(t) && /Source: NHC Saffir-Simpson Hurricane Wind Scale/.test(t) && /Source: NOAA National Hurricane Center/.test(t));
  check(`hazards ${label}: wind is shown in knots, km/h and mph as NHC gives them`, /90 kt, 167 km\/h, 105 mph/.test(t));
  check(`hazards ${label}: the storms screen does not overflow sideways`, await noOverflow());
  await shot(p, `hz-${label}-storms`);
  await p.click('#sheet [data-tab="fires"]'); await p.waitForSelector("#sheet .facts");
  t = await sheetText();
  const want = await R(p, () => window.__radar.app.D.hazards.fires.summary.detections);
  check(`hazards ${label}: fires shows the detection count from the feed, near-place rings and clusters`, t.includes(want.toLocaleString("en-GB")) && /within 25 km/.test(t) && (await p.locator("#sheet button.item").count()) === 10, `${want}`);
  check(`hazards ${label}: fires says a detection is not a confirmed wildfire and gives the NASA acknowledgement`, /not a confirmed wildfire/.test(t) && /We acknowledge the use of data and\/or imagery from NASA's Land, Atmosphere Near real-time Capability/.test(t));
  check(`hazards ${label}: the fires screen does not overflow sideways`, await noOverflow());
  await shot(p, `hz-${label}-fires`);
  await R(p, () => window.__radar.panels.openAsteroids()); await p.waitForSelector("#sheet .item.near");
  t = await sheetText();
  const rowsN = await p.locator("#sheet .item.near").count();
  check(`hazards ${label}: the asteroid screen lists the close approaches with distance in Moon distances, speed, H and a rough size`, rowsN >= 25 && /times the Moon's distance/.test(t) && /km\/s/.test(t) && /H \d+\.\d/.test(t) && /about [\d.,]+ m/.test(t), `${rowsN} ${t.slice(0, 200)}`);
  check(`hazards ${label}: it explains H, the assumed reflectivity, the time scale and cites NASA/JPL`, /larger number means a smaller rock/.test(t) && /13 percent/.test(t) && /69 seconds/.test(t) && /Source: NASA\/JPL CNEOS/.test(t));
  check(`hazards ${label}: the asteroid tile shows the number of flybys`, Number(await tile(p, "asteroid flybys")) >= 25, String(await tile(p, "asteroid flybys")));
  check(`hazards ${label}: the asteroid screen does not overflow sideways`, await noOverflow());
  await shot(p, `hz-${label}-asteroids`);
  await R(p, () => window.__radar.panels.openNear()); await p.waitForSelector("#sheet h2");
  t = await sheetText();
  check(`hazards ${label}: the Around you screen explains it makes no causal claims`, /Around /.test(t) && /Nothing here says one event caused another/.test(t));
  await shot(p, `hz-${label}-near`);
  await closeSheet(p);
  const g = await R(p, () => { const o = window.__radar.orbit, f = window.__radar.app.D.hazards.fires; return { vis: o.fires.visible, n: o.fires.geometry.attributes.position.count, want: f.n, storms: o.stormLines.children.length, chips: [...document.querySelectorAll("#layerChips .chip")].map((c) => c.textContent) }; });
  check(`hazards ${label}: the globe draws one point per fire cell and a cone and a track for the storms`, g.vis && g.n === g.want && g.storms === 2, JSON.stringify(g));
  check(`hazards ${label}: a Fires chip is offered because fire data is live`, g.chips.includes("Fires"), g.chips.join());
  await R(p, () => window.__radar.actions.flyTo(-3.4, 108)); await p.waitForTimeout(3200); await shot(p, `hz-${label}-globe-fires`);
  await R(p, () => window.__radar.actions.flyTo(24.5, -178)); await p.waitForTimeout(3200); await shot(p, `hz-${label}-globe-storm`);
  await p.click('#layerChips .chip:has-text("Fires")'); await p.waitForTimeout(200);
  check(`hazards ${label}: the Fires chip hides the fire points`, (await R(p, () => window.__radar.orbit.fires.visible)) === false);
  const other = errors.filter((e) => !/fonts\.g|ERR_FAILED|status of 404/.test(e));
  check(`hazards ${label}: no console errors`, other.length === 0, other.join(" | "));
  await p.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);
