// Radar Around You, prototype v2: the application shell. Owns state, views, input and the frame loop.
import "./engine.js";
import * as THREE from "three";
import { boot, startLater } from "./boot.js";
import { createOrbit } from "./orbit.js";
import { createSky } from "./sky.js";
import { createUnder } from "./under.js";
import { createPanels } from "./panels.js";
import * as C from "./core.js";
import * as I from "./info.js";
import { tonightPlan } from "./plan.js";
import { buildTonight } from "./tonight.js";
import { loadPrecise } from "./sgp4.js";
import { loadFeedData, loadPlaces } from "./data.js";
import { validCustomPlace, placeFromPosition } from "./places.js";
import { skyCalendar, highlight } from "./calendar.js";
import { createLive, summarize, overlayCities, LIVE_BASE } from "./live.js";
import { findTrains } from "./trains.js";
import { $, h, icon, fmtTime, fmtDateTime, num, kmText, safeStore, ageText, daysAgoText, durText } from "./dom.js";

const LAYERS = [
  { key: "sats", label: "Satellites", color: "var(--ion)" },
  { key: "starlink", label: "Starlink", color: "var(--sky)" },
  { key: "debris", label: "Debris", color: "var(--ember)" },
  { key: "quakes", label: "Earthquakes", color: "var(--ember)" },
  { key: "hazards", label: "Storms and hazards", color: "var(--violet)" },
  { key: "fires", label: "Fires", color: "var(--ember)" },
  { key: "aurora", label: "Aurora", color: "var(--aurora)" },
  { key: "clouds", label: "Clouds", color: "#dfe8ff" },
  { key: "coast", label: "Coastlines", color: "var(--sky)" },
  { key: "constellations", label: "Star lines", color: "#8fb0ff" },
];
const SKY_OPTIONS = [
  { key: "darkSky", label: "Dark sky", color: "var(--violet)" },
  { key: "constellations", label: "Star lines", color: "#8fb0ff" },
  { key: "planes", label: "Aircraft", color: "var(--sky)" },
  { key: "satellites", label: "Satellites", color: "var(--ion)" },
  { key: "showAll", label: "Unlit too", color: "var(--ember)" },
  { key: "labels", label: "Names", color: "#dfe8ff" },
];
const RATES = [1, 60, 600, 3600];

async function main() {
  const canvas = $("gl");
  const loadBar = $("loadBar"), loadText = $("loadText");
  let app;
  try {
    app = await boot({ canvas, quality: safeStore.get("radar2.quality", "auto"), onProgress: (f, label) => { loadBar.style.width = `${Math.round(f * 100)}%`; loadText.textContent = label; } });
  } catch (e) {
    $("loader").replaceChildren(h("div", { id: "nogl" }, h("h1", { text: "3D graphics could not start" }), h("p", { text: "This page needs WebGL 2, which this browser did not provide. Try a recent Chrome, Safari or Firefox." }), h("p", { class: "mono", text: String(e && e.message || e) })));
    return;
  }
  loadText.textContent = "Building the 3D scenes";
  await new Promise((r) => setTimeout(r, 30));
  const { D, renderer, clock } = app;
  const orbit = createOrbit(app);
  const sky = createSky({ ...app, swarmGeo: orbit.swarmGeo });
  const under = createUnder(app);

  // ------------------------------------------------------------------ state
  const tzGuess = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const savedPlace = safeStore.get("radar2.place", null);
  const cityById = (id) => D.cities.find((c) => c.id === id);
  // a place found by search or by the device's position is saved whole, and trusted only if every field is sane
  const savedCustom = safeStore.get("radar2.customPlace", null);
  const startCity = cityById(savedPlace) || (validCustomPlace(savedCustom) && savedCustom.id === savedPlace ? savedCustom : null) || D.cities.find((c) => c.tz === tzGuess) || D.cities[0];
  const asPlace = (c) => ({ ...c, lat: Number(c.lat), lon: Number(c.lon) });
  const S = {
    view: "globe", place: asPlace(startCity), selected: null, live: [], layers: { sats: true, starlink: true, debris: true, quakes: true, hazards: true, fires: true, aurora: true, clouds: true, coast: true, constellations: false },
    skyOffsetMin: 0, guide: null, followIdx: -1, sheet: null, searchOpen: false, searchReady: false, downloads: null, underQuake: null, rateIdx: 0, sky: () => sky, orbit: () => orbit, under: () => under,
    arrivals: [], feedCount: 0, precise: new Map(), trains: [], _tonight: null, tonightKey: "",
  };
  const nowDate = () => clock.now();
  const skyDate = () => new Date(nowDate().getTime() + S.skyOffsetMin * 60000);

  // ------------------------------------------------------------------ actions used by the panels
  const actions = {};
  const panels = createPanels({
    D, S, clock, actions,
    currentReplay: () => (S.view === "under" ? under.replay : orbit.replay),
    tonight: (force) => tonightModel(force),
    calendar: () => calendarModel(),
    auroraChance: () => { const a = sky.info.aurora; return a ? a.chance : null; },
  });
  const { toast } = panels;
  // the sky calendar for the place: 90 days from the start of today, recomputed when the place or the day changes
  let calCache = { key: "", value: null };
  function calendarModel() {
    const day = Math.floor(nowDate().getTime() / 86400000);
    const key = `${S.place.id}:${day}`;
    if (calCache.key !== key) calCache = { key, value: skyCalendar({ lat: S.place.lat, lon: S.place.lon, from: new Date(day * 86400000), days: 90 }) };
    return calCache.value;
  }
  // live feed state, declared early because the first draw of the stats strip already asks for it (see "live feeds" below)
  let liveCtl = null, sumCache = { at: 0, value: null };

  function render() {
    // the three scenes share one renderer and one canvas
    if (S.view === "sky") renderer.render(sky.scene, sky.camera);
    else if (S.view === "under") renderer.render(under.scene, under.camera);
    else renderer.render(orbit.scene, orbit.camera);
  }
  const activeScene = () => (S.view === "sky" ? sky : S.view === "under" ? under : orbit);

  actions.closeCard = () => {
    S.selected = null;
    S.guide = null; renderGuide();
    if (S.followIdx >= 0) { S.followIdx = -1; orbit.unfollow(); }
    orbit.clearSelection(); sky.select(null, nowDate());
    panels.renderCard(); updateChrome();
  };
  actions.sheetClosed = () => { syncTabs(); };
  actions.setReplay = (o) => { (S.view === "under" ? under : orbit).setReplay(o); };
  actions.share = () => shareImage();

  actions.toggleFollow = (idx) => {
    if (S.followIdx === idx) { S.followIdx = -1; S.cardCollapsed = false; orbit.unfollow(); panels.renderCard(); return; }
    if (S.view !== "globe") setView("globe");
    S.followIdx = idx;
    S.cardCollapsed = true;
    orbit.follow(idx);
    panels.renderCard();
  };
  actions.findInSky = (item) => {
    setView("sky");
    const aa = sky.altAzOf(item, skyDate());
    if (aa && aa.alt > 0) { sky.lookAt(aa.alt, aa.az); actions.guide(item); }
    else toast("Below your horizon right now", { sub: "Try the Tonight slider, or open it in the globe view.", plain: true });
  };
  actions.guide = (item) => { S.guide = item; if (S.view !== "sky") setView("sky"); renderGuide(); };
  actions.showUnder = (q) => { S.underQuake = q; setView("under"); };
  // the place search index loads once, on demand
  let placesLoad = null;
  actions.ensurePlaces = () => {
    if (!placesLoad) placesLoad = loadPlaces().then((idx) => { S.placesIndex = idx; return idx; }).catch((e) => { placesLoad = null; throw e; });
    return placesLoad;
  };
  actions.setPlace = (arg) => {
    const c = typeof arg === "string" ? cityById(arg) : validCustomPlace(arg) ? arg : null;
    if (!c) return;
    S.place = asPlace(c);
    safeStore.set("radar2.place", c.id);
    if (c.custom) safeStore.set("radar2.customPlace", c);
    sky.setPlace(S.place); orbit.setObserver(S.place);
    panels.closeSearch(); panels.closeSheet();
    S.guide = null; renderGuide();
    renderPlaceChip(); renderStats(true); S._tonight = null; setTimeout(updateTonightBtn, 30);
    if (S.view === "globe") orbit.flyTo(S.place.lat, S.place.lon, orbit.heroDist(), 2200);
    if (S.view === "under") enterUnder();
    panels.renderCard();
    toast(`Looking from ${c.name}`, { plain: true, ms: 2200 });
  };
  // the device's position becomes the place itself. It is named for a nearby place when there is one and stays on this device.
  actions.useMyLocation = () => {
    if (!navigator.geolocation) { toast("Location is not available in this browser", { plain: true }); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      let idx = null;
      try { idx = await actions.ensurePlaces(); } catch { /* the name and zone then come from the device */ }
      const p = placeFromPosition(idx, pos.coords.latitude, pos.coords.longitude, tzGuess);
      actions.setPlace(p);
      toast(`Looking from ${p.name}`, { sub: "Your exact position. It is saved only on this device.", plain: true, ms: 5200 });
    }, () => toast("Location was not shared", { sub: "Pick a place from the list or search for one instead.", plain: true }), { timeout: 10000 });
  };

  actions.openShare = (spec) => panels.openShare(spec);
  actions.saveCard = async (canvas, spec) => {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (S.downloads) {
      try { await S.downloads.save({ filename: spec.filename, data: blob }); return true; }
      catch (e) {
        if (e && e.code === "declined") return "Not saved.";
        if (e && (e.code === "unavailable" || e.code === "not_granted")) S.downloads = null; else return "Could not save the image.";
      }
    }
    try {
      const file = new File([blob], spec.filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: spec.text }); return true; }
    } catch (e) { if (e && e.name === "AbortError") return "Cancelled."; }
    return "Saving needs download permission, which this window does not have. On a phone, press and hold the picture.";
  };
  // "Show me": jump the sky to the time of an event, select the thing and turn to it
  actions.showItem = (it) => {
    const now = nowDate();
    const when = it.atTime || it.time || now;
    S.skyOffsetMin = C.clamp(Math.round((when - now) / 60000), 0, 1440);
    if (S.view !== "sky") setView("sky"); else renderSkyHud();
    if (it.target) select({ ...it.target });
    if (it.sky) sky.lookAt(Math.max(5, it.sky.alt), it.sky.az, 900);
    toast(`Showing the sky at ${fmtTime(skyDate(), S.place.tz)}`, { sub: "Use the Tonight slider at the bottom to move through time.", plain: true, ms: 5200 });
  };
  actions.openTonight = () => panels.openTonight();
  actions.openCalendar = () => panels.openCalendar();
  actions.flyTo = (lat, lon) => { if (S.view !== "globe") setView("globe"); orbit.flyTo(lat, lon, orbit.heroDist(), 2200); };

  const flyDistFor = (altKm) => (altKm < 3000 ? 2.5 : altKm < 20000 ? 4 : 7);
  actions.focusItem = (item) => {
    panels.closeSearch(); panels.closeSheet();
    if (item.kind === "plane" || item.kind === "moon" || item.kind === "planet" || item.kind === "star") {
      setView("sky");
      select(item);
      const aa = sky.altAzOf(item, skyDate());
      if (aa && aa.alt > -1) sky.lookAt(Math.max(5, aa.alt), aa.az);
      return;
    }
    if (S.view !== "globe") setView("globe");
    select(item);
    if (item.kind === "sat") {
      const g = orbit.satGeo(item.idx, nowDate());
      orbit.flyTo(g.lat, g.lon, flyDistFor(g.hKm), 2300);
    } else if (item.kind === "quake") {
      orbit.flyTo(item.q.lat, item.q.lon, 1.9, 2200);
    } else if (item.kind === "event") {
      orbit.flyTo(item.e.lat, item.e.lon, 2.2, 2000);
    }
  };
  actions.replayQuake = (q) => {
    if (S.view !== "globe") setView("globe");
    select({ kind: "quake", q });
    orbit.flyTo(q.lat, q.lon, 1.9, 2200);
    orbit.startQuake(q, { forceReplay: true, speed: 40 });
    panels.renderCard();
  };
  actions.showArrival = (g) => {
    if (S.view !== "globe") setView("globe");
    const idx = g.first;
    select({ kind: "sat", idx });
    const geo = orbit.satGeo(idx, nowDate());
    orbit.flyTo(geo.lat, geo.lon, 2.6, 2400);
    const info = I.satelliteInfo(D, idx, nowDate(), S.place);
    const site = C.LAUNCH_SITES[info.siteCode];
    if (site) toast(`${g.count} new ${g.count === 1 ? "object" : "objects"} from ${g.site ? g.site.replace(/\s*\(.*\)$/, "").split(",")[0] : "a launch site"}`, { sub: `Launched ${daysAgoText(g.ageDays)}. The gold pulses are everything launched in the last 30 days.`, plain: true, ms: 6500 });
  };

  function select(item) {
    S.selected = item;
    S.cardCollapsed = S.view === "sky" || (item && item.kind === "sat" && S.followIdx === item.idx);
    S.guide = null; renderGuide();
    if (item && item.kind !== "sat" && S.followIdx >= 0) { S.followIdx = -1; orbit.unfollow(); }
    if (S.view === "globe") { sky.select(null, nowDate()); orbit.select(item && (item.kind === "sat" || item.kind === "quake" || item.kind === "event") ? item : null); }
    else if (S.view === "sky") { orbit.clearSelection(); sky.select(item, skyDate()); }
    else if (S.view === "under" && item && item.kind === "quake") { S.underQuake = item.q; enterUnder(); }
    panels.renderCard();
    updateChrome();
  }

  // ------------------------------------------------------------------ the Tonight plan
  function tonightModel(force = false) {
    if (!D.later || !S.precise.size) return { verdict: { level: "fair", score: 0, headline: "Working it out", sentence: "Orbit data is still loading." }, items: [], conditions: [], highlights: [], trains: [] };
    const key = S.place.id + ":" + Math.floor(nowDate().getTime() / 600000);
    if (!force && S.tonightKey === key && S._tonight) return S._tonight;
    S._tonight = buildTonight({ D, precise: S.precise, place: S.place, now: nowDate(), kp: I.kpAt(D.meta.kp, nowDate().getTime()) });
    S.tonightKey = key;
    return S._tonight;
  }
  function updateTonightBtn() {
    const b = $("tonightBtn");
    if (!b || !S.precise.size) return;
    const t = tonightModel();
    b.dataset.level = t.verdict.level;
    b.replaceChildren(icon("eye"), "Tonight: " + t.verdict.level);
  }

  // ------------------------------------------------------------------ chrome: stats, chips, hud
  function renderPlaceChip() {
    const c = S.place;
    $("placeChip").replaceChildren(icon("pin"), c.name, h("small", { text: c.country }));
  }
  // the Data tile: is the picture live, and are the feeds behind it up to date
  function dataTile() {
    const sum = liveSummary();
    const open = () => panels.openStatus();
    if (!sum) return ["data", "Snapshot", "bundled data, not live", open];
    const bad = sum.counts.failing + sum.counts.stale + sum.counts.none + sum.counts.halted;
    if (sum.overall === "fresh") return ["data", "Live", "all feeds up to date", open];
    if (sum.overall === "failing") return ["data", "Live", `${sum.counts.failing} feed${sum.counts.failing === 1 ? "" : "s"} retrying`, open];
    if (sum.overall === "halted") return ["data", "Paused", "a source asked us to wait", open];
    return ["data", "Stale", `${bad} feed${bad === 1 ? "" : "s"} out of date`, open];
  }
  // storms, fires and "near you" exist only when the live feeds are connected, so these tiles appear only then
  function hazardTiles() {
    const hz = D.hazards || {};
    const out = [];
    if (hz.storms || hz.fires || hz.space) { const n = panels.connectionList(hz).length; out.push(["near", String(n), `near ${S.place.name}`, () => panels.openNear()]); }
    if (hz.storms) out.push(["storms", String(hz.storms.storms.length), hz.storms.storms.length === 1 ? "active storm" : "active storms", () => panels.openWatch("storms")]);
    if (hz.fires) { const d = hz.fires.summary.detections; out.push(["fires", d >= 10000 ? `${Math.round(d / 1000)}k` : num(d), "fire detections, 24 h", () => panels.openWatch("fires")]); }
    return out;
  }
  function renderStats(force = false) {
    const el = $("stats");
    if (S.view !== "globe") { el.hidden = true; return; }
    el.hidden = false;
    const kp = I.kpAt(D.meta.kp, nowDate().getTime());
    const above = sky.info.above || 0;
    const recent = D.quakes.events.filter((q) => nowDate().getTime() - Date.parse(q.time) < 24 * 3600e3).length;
    const nextEvent = highlight(calendarModel().events, nowDate());
    const stats = [
      dataTile(),
      ...(nextEvent ? [["next", new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: nextEvent.allDay ? "UTC" : S.place.tz }).format(nextEvent.time), nextEvent.short || nextEvent.title, () => panels.openCalendar()]] : []),
      ["inorbit", num(D.meta.count), "objects in orbit", () => panels.openSearch()],
      ["above", num(above), `above ${S.place.name} now`, () => setView("sky")],
      ["quakes", num(recent), "quakes in 24 h", () => panels.openFeed()],
      ["new", num(D.meta.newIdx.length), "launched in 30 days", () => panels.openFeed()],
      ["strings", num(S.trains.length), S.trains.length === 1 ? "Starlink string" : "Starlink strings", () => panels.openTrains()],
      ["kp", kp ? kp.kp.toFixed(1) : "n/a", "Kp, space weather", () => panels.openWatch("aurora")],
      ...hazardTiles(),
    ];
    const key = stats.map((s) => s[1]).join("|");
    if (!force && S.statsKey === key) return;
    S.statsKey = key;
    el.replaceChildren(...stats.map(([id, v, label, fn]) => h("button", { class: "stat glass", role: "listitem", onclick: fn }, h("b", { text: v }), h("span", { text: label }))));
  }
  const chipButtons = (defs, state) => defs.map((d) => h("button", { class: "chip glass", style: { "--c": d.color }, "aria-pressed": String(!!state[d.key]), onclick: () => toggleLayer(d.key) }, h("i", { class: "sw" }), d.label));
  function renderLayerChips() {
    $("layerChips").replaceChildren(...chipButtons(LAYERS.filter((l) => l.key !== "fires" || (D.hazards && D.hazards.fires)), S.layers));
    renderSkyChips();
  }
  function renderSkyChips() {
    const wrap = $("skyChips");
    if (wrap) wrap.replaceChildren(...chipButtons(SKY_OPTIONS, sky.opts));
  }
  function toggleLayer(key) {
    if (S.view === "sky") {
      sky.opts[key] = !sky.opts[key];
      if (key === "constellations") S.layers.constellations = sky.opts[key];
    } else {
      S.layers[key] = !S.layers[key];
      orbit.setLayers(S.layers);
      sky.setLayers(S.layers);
    }
    renderLayerChips();
  }
  function updateChrome() {
    const card = !!S.selected;
    $("layers").hidden = card || S.view !== "globe";
    document.body.dataset.view = S.view;
    $("app").dataset.view = S.view;
  }
  function syncTabs() {
    const cur = S.sheet === "feed" ? "feed" : S.view;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.go === cur)));
  }

  // ---- sky HUD
  const skyHud = { heading: null, panel: null };
  function renderSkyHud() {
    const top = $("hudTop"), hud = $("hud");
    top.replaceChildren();
    hud.replaceChildren();
    if (S.view === "sky") {
      top.append(h("div", { class: "scroller", id: "skyChips", style: { margin: 0, padding: 0 } }));
      renderSkyChips();
      const headEl = h("span", { class: "mono", id: "headText", style: { fontSize: "12.5px" }, text: "" });
      const sensorBtn = h("button", { class: "btn small", onclick: async () => {
        if (sky.view.sensor) { sky.sensor.disable(); sensorBtn.textContent = "Sensors"; return; }
        const ok = await sky.sensor.enable();
        if (ok) sensorBtn.textContent = "Stop sensors"; else toast("Sensors are not available here", { sub: "On a phone, allow motion access. The preview window may block it. Drag to look instead.", plain: true });
      } }, "Sensors");
      const slider = h("input", { type: "range", min: "0", max: "1440", step: "10", value: String(S.skyOffsetMin), "aria-label": "Show the sky at a later time, up to a day ahead" });
      const sliderOut = h("output", { class: "mono", text: S.skyOffsetMin === 0 ? "Now" : `+${durText(S.skyOffsetMin * 60)}` });
      const plan = h("p", { id: "planText" });
      const updateSlider = () => {
        S.skyOffsetMin = Number(slider.value);
        sliderOut.textContent = S.skyOffsetMin === 0 ? "Now" : `+${durText(S.skyOffsetMin * 60)}`;
        if (S.selected) sky.select(S.selected, skyDate());
      };
      slider.addEventListener("input", updateSlider);
      const info = h("p", { id: "skyInfo", class: "mono", style: { fontSize: "12px" } });
      const more = h("div", { id: "skyMore", hidden: !S.skyMore }, h("div", { class: "row", style: { margin: "6px 0" } }, h("button", { class: "btn small", onclick: () => sky.faceDefault() }, "Reset view")), info, plan);
      const moreBtn = h("button", { class: "btn small", "aria-expanded": String(!!S.skyMore), onclick: () => { S.skyMore = !S.skyMore; more.hidden = !S.skyMore; moreBtn.setAttribute("aria-expanded", String(S.skyMore)); moreBtn.textContent = S.skyMore ? "Less" : "More"; } }, S.skyMore ? "Less" : "More");
      hud.append(h("div", { class: "panel glass", style: { padding: "10px 12px" } },
        h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "nowrap" } }, h("div", { class: "grow", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, headEl), h("div", { class: "row", style: { flex: "none", gap: "6px" } }, sensorBtn, moreBtn)),
        h("div", { class: "row", style: { marginTop: "2px" } }, h("span", { class: "mono", style: { fontSize: "12px", color: "var(--muted)" }, text: "Tonight" }), h("div", { class: "grow" }, slider), sliderOut),
        more));
      skyHud.heading = headEl; skyHud.info = info; skyHud.plan = plan;
      updatePlanText();
    } else if (S.view === "under") {
      const q = S.underQuake;
      const qs = underCandidates();
      top.append(h("div", { class: "scroller", style: { margin: 0, padding: 0 } }, ...qs.map((x) => h("button", { class: "chip glass", style: { "--c": "var(--ember)" }, "aria-pressed": String(x.id === (q && q.id)), onclick: () => { S.underQuake = x; select({ kind: "quake", q: x }); } }, `M${x.mag.toFixed(1)} ${x.place.replace(/^.*? of /, "").slice(0, 22)}`))));
      const panel = h("div", { class: "panel glass", id: "underPanel" });
      S.liveHud = [];
      if (q) {
        const title = h("h3", { text: `M${q.mag.toFixed(1)} ${q.place}` });
        const where = h("p", { id: "underWhere" });
        const waves = h("p", { id: "underWaves", class: "mono", style: { marginTop: "6px" } });
        panel.append(title, where, waves, ...panels.replayControls(S.liveHud),
          h("div", { class: "actions", style: { marginTop: "10px" } }, h("button", { class: "btn small", onclick: () => actions.focusItem({ kind: "quake", q }) }, icon("follow"), "See on the globe"), h("a", { class: "btn small", href: q.url, target: "_blank", rel: "noopener noreferrer" }, icon("link"), "Did you feel it?")));
      }
      hud.append(panel);
      skyHud.underPanel = panel;
    }
  }
  function updatePlanText() {
    if (!skyHud.plan) return;
    const aur = sky.info.aurora;
    const plan = tonightPlan(S.place, nowDate(), aur ? aur.chance : 0);
    skyHud.plan.replaceChildren();
    if (plan.best) skyHud.plan.append(h("b", { text: `Best time tonight: ${fmtTime(plan.best.start, S.place.tz)} to ${fmtTime(plan.best.endExclusive, S.place.tz)}` }), ` (${plan.best.avg}/100). `,
      h("a", { class: "btn small", style: { marginLeft: "6px" }, href: C.googleCalendarUrl({ title: `Stargazing window over ${S.place.name}`, start: plan.best.start, end: plan.best.endExclusive, details: "Best viewing window from Radar Around You.", location: S.place.name }), target: "_blank", rel: "noopener noreferrer" }, icon("bell"), "Remind me"));
    else skyHud.plan.append("No good stargazing window in the next 12 hours: daylight, cloud or a bright Moon.");
    skyHud.plan.style.margin = "6px 0 0";
    skyHud.plan.style.fontSize = "13px";
  }
  function underCandidates() {
    const now = nowDate().getTime();
    const list = D.quakes.events.filter((q) => q.mag >= 4.5).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const biggest = D.quakes.events.filter((q) => now - Date.parse(q.time) < 48 * 3600e3).sort((a, b) => b.mag - a.mag)[0];
    const out = [];
    for (const q of [S.underQuake, biggest, ...list]) if (q && !out.find((o) => o.id === q.id)) out.push(q);
    return out.slice(0, 7);
  }
  function enterUnder() {
    if (!S.underQuake || !D.quakes.events.find((q) => q.id === S.underQuake.id)) S.underQuake = underCandidates()[0];
    under.setQuake(S.underQuake, S.place, nowDate());
    S.selected = { kind: "quake", q: S.underQuake };
    renderSkyHud();
    panels.renderCard();
    updateChrome();
  }
  function updateUnderPanel() {
    const el = skyHud.underPanel;
    if (!el || !under.st.q) return;
    for (const f of S.liveHud || []) { try { f(); } catch { /* control may be detached */ } }
    const st = under.st, r = under.replay;
    const tau = r.tau;
    const reach = (sec) => (tau >= sec ? `reached you ${durText(tau - sec)} ago` : `reaches you in ${durText(sec - tau)}`);
    const where = $("underWhere"), waves = $("underWaves");
    if (where) where.textContent = `Focus ${Math.round(st.depth)} km down in the ${st.depth < 35 ? "crust" : "upper mantle"}. ${num(st.surfaceKm)} km along the surface from ${S.place.name}, ${num(st.chordKm)} km straight through the Earth.`;
    if (waves) waves.textContent = `P wave ${reach(st.tP)} · S wave ${reach(st.tS)}`;
  }

  // ------------------------------------------------------------------ views
  function setView(v) {
    if (v === "feed") { panels.openFeed(); syncTabs(); return; }
    panels.closeSheet();
    if (v === S.view) { syncTabs(); return; }
    const prev = S.view;
    S.view = v;
    $("toasts").replaceChildren();
    S.guide = null; renderGuide();
    if (v === "under") enterUnder();
    else {
      if (prev === "under") { S.selected = null; orbit.clearSelection(); }
      if (v === "sky") { if (S.selected && S.selected.kind === "sat" || (S.selected && ["plane", "moon", "planet", "star"].includes(S.selected.kind))) sky.select(S.selected, skyDate()); else if (S.selected) { S.selected = null; } }
      if (v === "globe" && S.selected && ["plane", "moon", "planet", "star"].includes(S.selected.kind)) { S.selected = null; sky.select(null, nowDate()); }
      if (v === "globe" && S.selected) orbit.select(S.selected.kind === "sat" || S.selected.kind === "quake" || S.selected.kind === "event" ? S.selected : null);
      renderSkyHud();
    }
    renderLayerChips(); renderStats(true); panels.renderCard(); updateChrome(); syncTabs();
    labelEls.forEach((el) => el.remove()); labelEls.clear();
    resize();
  }

  // ------------------------------------------------------------------ guide
  function renderGuide() {
    const el = $("guide");
    if (!S.guide || S.view !== "sky") { el.hidden = true; el.replaceChildren(); return; }
    el.hidden = false;
    el.className = "glass";
    el.replaceChildren(h("div", { class: "arrow" }, (() => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = '<path d="M12 2l7 11h-4.500v9h-5v-9H5z"/>'; return s; })()),
      h("div", { class: "grow" }, h("b", { id: "guideTitle", text: "" }), h("span", { id: "guideText", text: "" })),
      h("button", { class: "x", "aria-label": "Stop guiding", onclick: () => { S.guide = null; renderGuide(); } }, icon("close")));
  }
  function updateGuide() {
    if (!S.guide || S.view !== "sky") return;
    const aa = sky.altAzOf(S.guide, skyDate());
    const title = $("guideTitle"), text = $("guideText");
    if (!title) return;
    const name = S.guide.kind === "sat" ? D.later.names[S.guide.idx] : S.guide.kind === "plane" ? (S.guide.rec && S.guide.rec.p.call) || "aircraft" : S.guide.kind === "moon" ? "the Moon" : S.guide.name || "target";
    if (!aa || aa.alt < 0) { title.textContent = `${name} is below the horizon`; text.textContent = "Try the Tonight slider to see when it rises."; return; }
    const g = C.guideInstruction(sky.view.yaw, aa.az, aa.alt);
    const dAlt = aa.alt - sky.view.pitch;
    const found = Math.abs(g.turn) < 6 && Math.abs(dAlt) < 8;
    $("guide").classList.toggle("found", found);
    title.textContent = found ? `Found ${name}` : `Find ${name}`;
    text.textContent = found ? "It is in the middle of your view." : g.text;
    const svg = $("guide").querySelector(".arrow svg");
    svg.style.transform = `rotate(${Math.atan2(g.turn, dAlt) * 180 / Math.PI}deg)`;
  }

  // ------------------------------------------------------------------ labels
  const labelEls = new Map();
  function labelText(L) {
    if (L.text) return L.text;
    const it = L.item;
    if (!it) return "";
    if (it.kind === "sat") return D.later ? D.later.names[it.idx] : "";
    if (it.kind === "quake") return `M${it.q.mag.toFixed(1)}`;
    if (it.kind === "event") return it.e.name;
    return "";
  }
  function updateLabels(w, hgt) {
    const date = nowDate();
    const scene = activeScene();
    const list = S.view === "sky" ? sky.labelPoints() : S.view === "under" ? under.labelPoints() : orbit.labelPoints(date);
    const used = new Set();
    let n = 0;
    for (const L of list) {
      if (n > 60) break;
      if (L.cls === "star" && !sky.opts.labels) continue;
      const p = scene.project(L.pos, w, hgt);
      if (!p.front || p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > hgt + 20) continue;
      if (S.view === "globe" && orbit.hiddenByEarth(L.pos)) continue;
      const text = labelText(L);
      if (!text) continue;
      let el = labelEls.get(L.id);
      if (!el) {
        el = h("div", { class: "lbl " + (L.cls || "") });
        $("labels").append(el);
        labelEls.set(L.id, el);
        if (L.item && ["plane", "body", "star"].includes(L.cls)) { el.style.pointerEvents = "auto"; el.style.cursor = "pointer"; el.addEventListener("click", () => { if (el._item) select(el._item); }); }
      }
      el._item = L.item;
      if (el.textContent !== text) el.textContent = text;
      const centreY = L.cls === "layer" ? "-50%" : "-100%";
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, ${centreY})`;
      el.hidden = false;
      used.add(L.id); n++;
    }
    for (const [id, el] of labelEls) if (!used.has(id)) el.hidden = true;
  }

  // ------------------------------------------------------------------ input
  const pointers = new Map();
  let tap = null;
  function onPointerDown(e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 } : null;
    if (pointers.size === 2) pinch.d = pinchDist();
  }
  const pinch = { d: 0 };
  const pinchDist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const now = performance.now();
    const dt = Math.max(0.001, (now - p.t) / 1000);
    p.x = e.clientX; p.y = e.clientY; p.t = now;
    if (pointers.size === 1) {
      if (tap) tap.moved += Math.abs(dx) + Math.abs(dy);
      activeScene().drag(dx, dy, dt);
    } else if (pointers.size === 2) {
      const d = pinchDist();
      if (pinch.d > 0 && d > 0) activeScene().zoom(pinch.d / d);
      pinch.d = d;
    }
  }
  function onPointerUp(e) {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    if (tap && pointers.size === 0 && tap.moved < 8 && performance.now() - tap.t < 500) onTap(e.clientX, e.clientY);
    if (pointers.size === 0 && activeScene().dragEnd) activeScene().dragEnd();
    tap = null;
    pinch.d = 0;
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); activeScene().zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function onTap(x, y) {
    const rect = canvas.getBoundingClientRect();
    const px = x - rect.left, py = y - rect.top;
    let hit = null;
    if (S.view === "globe") hit = orbit.pick(px, py, rect.width, rect.height, nowDate());
    else if (S.view === "sky") hit = sky.pick(px, py, rect.width, rect.height, skyDate());
    if (hit) { select(hit); }
    else if (S.selected && S.view !== "under") actions.closeCard();
  }

  // ------------------------------------------------------------------ sizing
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, hh = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { high: 2, medium: 1.5, low: 1 }[app.tier]));
    renderer.setSize(w, hh, false);
    orbit.resize(w, hh); sky.resize(w, hh); under.resize(w, hh);
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------------ share image
  async function shareImage() {
    if (!S.downloads) {
      // outside the preview there is no downloads helper: open the image in a new tab instead
      toast("Saving needs the preview's download permission", { plain: true });
      return;
    }
    const src = canvas;
    const out = document.createElement("canvas");
    out.width = 1080; out.height = 1350;
    const g = out.getContext("2d");
    g.fillStyle = "#04060c"; g.fillRect(0, 0, 1080, 1350);
    const scale = Math.max(1080 / src.width, 1100 / src.height);
    g.drawImage(src, (1080 - src.width * scale) / 2, 140 + (1100 - src.height * scale) / 2, src.width * scale, src.height * scale);
    g.fillStyle = "#eaf0ff"; g.font = "700 58px sans-serif";
    const title = S.view === "sky" ? `Above ${S.place.name}` : S.view === "under" ? `Under ${S.place.name}` : "Around the world";
    g.fillText(title, 56, 96);
    g.font = "400 28px monospace"; g.fillStyle = "#9aa7c7";
    g.fillText(`${fmtDateTime(nowDate(), S.place.tz)} · Radar Around You prototype`, 56, 140);
    g.fillStyle = "rgba(4,6,12,.75)"; g.fillRect(0, 1270, 1080, 80);
    g.fillStyle = "#9aa7c7"; g.font = "400 22px monospace";
    g.fillText("Data: CelesTrak, USGS, NOAA, GDACS, adsb.lol, MET Norway, NASA", 56, 1318);
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    try { await S.downloads.save({ filename: `radar-${S.view}-${S.place.id}.png`, data: blob }); toast("Image saved", { plain: true, ms: 2200 }); }
    catch (e) { toast(e && e.code === "declined" ? "Not saved" : "Could not save the image", { plain: true }); }
  }
  if (window.claude && typeof window.claude.use === "function") window.claude.use("downloads").then((d) => { S.downloads = d; }).catch(() => {});

  // ------------------------------------------------------------------ chrome wiring
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.go)));
  $("btnSearch").addEventListener("click", () => panels.openSearch());
  $("tonightBtn").addEventListener("click", () => panels.openTonight());
  $("placeChip").addEventListener("click", () => panels.openPlaces());
  $("btnTime").addEventListener("click", () => {
    S.rateIdx = (S.rateIdx + 1) % RATES.length;
    clock.setRate(RATES[S.rateIdx]);
    if (S.rateIdx === 0) clock.reset();
    updateClockText();
  });
  document.querySelector(".brand").addEventListener("click", () => panels.openAbout());
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (S.searchOpen) panels.closeSearch(); else if (S.sheet) panels.closeSheet(); else if (S.selected) actions.closeCard();
  });
  function updateClockText() {
    const d = S.view === "sky" ? skyDate() : nowDate();
    const t = fmtTime(d, S.place.tz);
    const rate = RATES[S.rateIdx];
    const el = $("clockText");
    // "LIVE" means live data is in use, not just a real-time clock: a page showing the bundled snapshot says so
    const liveData = !!(D.live && Object.keys(D.live.used).length);
    const txt = rate === 1 ? (clock.state.simulated || !liveData ? `SNAPSHOT ${t}` : `LIVE ${t}`) : `x${rate} ${t}`;
    if (el.textContent !== txt) el.textContent = txt;
    const sum = liveSummary();
    const dot = el.previousElementSibling;
    dot.classList.toggle("sim", rate !== 1 || clock.state.simulated || !liveData || (!!sum && (sum.overall === "stale" || sum.overall === "failing")));
    dot.classList.toggle("bad", !!sum && sum.overall === "halted");
  }

  // ------------------------------------------------------------------ frame loop
  let last = performance.now(), t0 = last, lastSlow = 0, lastLive = 0, frames = 0, readyShown = false, shift = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock.tick();
    const date = nowDate();
    const tSec = (now - t0) / 1000;
    const rect = canvas.getBoundingClientRect();
    // keep the thing you are looking at clear of the card or panel that covers the lower part of the screen
    {
      const cardUp = !$("card").hidden;
      const cover = cardUp ? $("card") : S.view === "under" || S.view === "sky" ? $("hud").firstElementChild : null;
      let target = 0;
      if (cover) {
        const top = cover.getBoundingClientRect().top;
        const freeTop = S.view === "under" ? 200 : 170, freeBottom = Math.max(freeTop + 120, top - 8);
        target = Math.max(0, rect.height / 2 - (freeTop + freeBottom) / 2);
        if (rect.width > 899) target = 0;
      }
      shift += (target - shift) * Math.min(1, dt * 7);
      const sc = activeScene();
      if (sc.setViewShift) sc.setViewShift(shift, rect.width, rect.height);
    }
    if (S.view === "sky") {
      sky.tickAnim(now);
      sky.update(skyDate(), tSec, dt);
      sky.updateSelection();
    } else if (S.view === "under") {
      under.update(date, tSec, dt);
    } else {
      orbit.update(date, tSec, dt);
      sky.scanOnly(date);
    }
    render();
    updateLabels(rect.width, rect.height);
    if (now - lastLive > 1000) {
      lastLive = now;
      panels.tickLive();
      updateClockText();
      if (S.view === "under") updateUnderPanel();
      if (S.view === "globe") renderStats();
      if (S.precise.size && S.tonightKey !== S.place.id + ":" + Math.floor(nowDate().getTime() / 600000)) updateTonightBtn();
    }
    if (S.view === "sky") {
      updateGuide();
      if (skyHud.heading) {
        const v = sky.view;
        skyHud.heading.textContent = `Facing ${C.compassPoint(v.yaw)} ${Math.round(v.yaw)}° · ${Math.round(v.pitch)}° up`;
        if (now - lastSlow > 1000) {
          lastSlow = now;
          const i = sky.info;
          const mm = i.moon;
          skyHud.info.textContent = `Sun ${Math.round(i.sunAlt)}° · Moon ${Math.round(mm.frac * 100)}% lit${mm.alt > 0 ? `, ${Math.round(mm.alt)}° up` : ", below horizon"} · stars to mag ${i.limitMag.toFixed(1)} · ${i.above} satellites above 10°${i.cloud != null ? ` · cloud ${Math.round(i.cloud)}%` : ""}${sky.opts.darkSky ? " · dark-sky mode" : ""}`;
        }
      }
    }
    if (S.view === "globe" && orbit.cam.dist < 2.4 && !hiTex) maybeLoadHighRes();
    frames++;
    S.frames = frames;
    if (frames === 3 && !readyShown) { readyShown = true; $("loader").classList.add("done"); setTimeout(() => $("loader").remove(), 900); onFirstFrames(); }
    requestAnimationFrame(frame);
  }

  // The 4k Earth map (about 480 KB) is only fetched when it will be seen: on a fast device, or once someone zooms in.
  let hiTex = null;
  async function maybeLoadHighRes() {
    if (hiTex || app.tier === "low" || (navigator.connection && navigator.connection.saveData)) return;
    hiTex = "loading";
    try {
      const { loadTexture } = await import("./engine.js");
      const { TEXTURES_LATER } = await import("./data.js");
      const t = await loadTexture(TEXTURES_LATER.day4k, { anisotropy: app.aniso, wrapS: THREE.RepeatWrapping });
      orbit.setHighTexture(t);
      hiTex = t;
    } catch { hiTex = null; }
  }

  // ------------------------------------------------------------------ first run
  function onFirstFrames() {
    orbit.flyTo(S.place.lat, S.place.lon, orbit.heroDist(), 3200);
  }
  sky.onArrival = (rec) => {
    if (S.view !== "sky") return;
    const info = I.planeInfo(D, rec);
    toast(`New aircraft in view: ${info.call}`, { sub: `${info.typeName}${info.airline ? " · " + info.airline : ""} rose above your horizon in the ${info.compass}`, action: () => select({ kind: "plane", hex: rec.p.hex, rec }), label: "Details", ms: 6500 });
  };

  sky.setPlace(S.place);
  orbit.setObserver(S.place);
  orbit.setLayers(S.layers);
  sky.setLayers(S.layers);
  renderPlaceChip(); renderLayerChips(); renderStats(true); renderSkyHud(); updateChrome(); syncTabs();
  resize();
  orbit.cam.lat = S.place.lat - 10; orbit.cam.lon = S.place.lon - 80; orbit.cam.dist = 9;
  requestAnimationFrame(frame);

  startLater(app).then(() => {
    loadText.textContent = "Ready";
    S.precise = loadPrecise(D.later.precise);
    sky.precise = S.precise;
    S.trains = findTrains(D, S.precise, nowDate());
    panels.buildSearchIndex();
    S.searchReady = true;
    setTimeout(updateTonightBtn, 60);
    if (S.searchOpen && S.searchRender) S.searchRender();
    announceArrivals();
    renderStats(true);
    startLive();
  });

  // ------------------------------------------------------------------ live feeds
  // The pipeline (pipeline/) publishes a manifest and versioned files. The app polls the manifest and puts new quakes,
  // hazards, aurora, Kp, cloud forecasts and aircraft into the scene without a reload. New satellite orbits change the
  // indexes of every object, so those are announced and applied on a reload.
  function liveSummary() {
    const m = liveCtl ? liveCtl.state().manifest : D.live && D.live.manifest;
    if (!m) return null;
    const t = Date.now();
    if (t - sumCache.at > 5000) sumCache = { at: t, value: summarize(m, t) };
    return sumCache.value;
  }
  actions.liveStatus = () => ({ manifest: liveCtl ? liveCtl.state().manifest : D.live && D.live.manifest, summary: liveSummary(), state: liveCtl ? liveCtl.state() : null, used: D.live ? D.live.used : {}, fellBack: D.live ? D.live.fellBack : [] });
  actions.reloadForOrbits = () => location.reload();

  const byTimeDesc = (a, b) => Date.parse(b.time) - Date.parse(a.time);
  function refreshDerived() {
    sumCache.at = 0;
    S._tonight = null; S.statsKey = "";
    renderStats(true);
    if (S.precise.size) updateTonightBtn();
  }
  function applyCities(clouds, planes) {
    const changed = overlayCities(D.cities, clouds, planes);
    if (changed.has(S.place.id)) {
      S.place = asPlace(cityById(S.place.id));
      sky.refreshPlace(S.place);
    }
    refreshDerived();
  }
  const applyFeed = {
    quakes(data) { D.quakes = data; D.quakes.events.sort(byTimeDesc); orbit.refreshMarkers(); refreshDerived(); },
    events(data) { D.events = data; orbit.refreshMarkers(); refreshDerived(); },
    kp(rows) { D.meta.kp = rows; refreshDerived(); },
    aurora({ grid, meta }) { D.aurora.set(grid); D.meta.aurora = meta; orbit.refreshAurora(); sky.refreshAurora(); refreshDerived(); },
    clouds(data) { applyCities(data, null); },
    planes(data) { applyCities(null, data); },
    storms(data) { D.hazards.storms = data; orbit.refreshStorms(); refreshDerived(); },
    fires(data) { D.hazards.fires = data; orbit.refreshFires(); renderLayerChips(); refreshDerived(); },
    spaceweather(data) { D.hazards.space = data; refreshDerived(); },
  };
  function startLive() {
    liveCtl = createLive({
      base: LIVE_BASE, fetchFn: (u, i) => fetch(u, i), baselineTakenMs: D.live.baselineTakenMs, manifest: D.live.manifest, loaded: D.live.used,
      loadFeed: loadFeedData, apply: (id, data) => applyFeed[id](data),
      onState: () => { sumCache.at = 0; renderStats(); updateClockText(); if (S.sheet === "status") panels.openStatus(); },
      onSatellites: () => toast("Newer orbit data is ready", { sub: "Reload to use it. Your place is remembered.", action: actions.reloadForOrbits, label: "Reload", ms: 14000, plain: true }),
    });
    liveCtl.start();
    document.addEventListener("visibilitychange", () => {
      const st = liveCtl.state();
      if (!document.hidden && (!st.lastPollAt || Date.now() - st.lastPollAt > 60000)) liveCtl.pollNow();
    });
    // a visitor who arrives after the pipeline has been quiet should see what is current without waiting for the first interval
    if (!D.live.manifest || Date.now() - Date.parse(D.live.manifest.generatedAt) > 120000) setTimeout(() => liveCtl.pollNow(), 4000);
  }

  // The "something just happened" moments: the newest notable quake and the newest launch
  function announceArrivals() {
    const nowMs = nowDate().getTime();
    const quake = D.quakes.events.filter((q) => q.mag >= 4.5 && nowMs - Date.parse(q.time) < 8 * 3600e3).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    const launch = I.recentLaunches(D, nowMs)[0];
    const feedN = (quake ? 1 : 0) + (launch ? 1 : 0);
    if (feedN) { const b = $("feedBadge"); b.textContent = String(feedN); b.hidden = false; }
    setTimeout(() => {
      if (quake) toast(`New earthquake: M${quake.mag.toFixed(1)}`, { sub: `${quake.place}, ${ageText(nowMs - Date.parse(quake.time))}`, action: () => actions.replayQuake(quake), label: "Replay", ms: 9000 });
    }, 2800);
    setTimeout(() => {
      if (launch) toast(`New in orbit: ${I.listWithMore(launch.names, 1)}`, { sub: `Launched ${daysAgoText(launch.ageDays)} · ${launch.owner}`, action: () => actions.showArrival(launch), label: "Show", ms: 9000 });
    }, 4200);
  }

  // hooks for tests and debugging
  window.__radar = { S, app, orbit, sky, under, panels, actions, setView, select, tonightPlan, tonightModel, resize, liveCtl: () => liveCtl, liveSummary };
  window.__radarStarted = true;
}

main();
