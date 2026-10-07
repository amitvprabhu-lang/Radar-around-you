// The browser script of /satellites-near-me/ (bundled by site/near-assets.mjs). Progressive enhancement: the page's HTML already explains
// everything and shows a build-time example; this script shows the form, reads the place (address, storage, the six cities, the place
// search, the device's position or typed coordinates), asks the calculation (site/near-calc.mjs, in a Web Worker, or on this thread in
// slices where a worker cannot start) and draws the answer. Text from outside (place names) is only ever written with textContent.
import { decodePlaces, searchPlaces, countryName, nearestPlace, PLACES_CREDIT } from "../src/places.js";
import { decodeCoast } from "../src/data.js";
import {
  RADII_KM, DEFAULT_RADIUS_KM, DEFAULT_PLACE, STORAGE_KEY, parseQuery, placeQuery, storedValue, restoreStored, checkTyped, cleanName, cleanTimeZone, coordName,
  fmtInt, fmtKm, shortDistance, plural, lookText, utcText, zoneText, isoUtc, dayTimeUtc, announcement, expectedText, expectedAtOnce, mapSvg,
  chooseSource, pollDelayMs, sourceText, sourceWhen, SOURCE_REASONS, capFraction, pctText, staleState, timeErrorText, MIN_USABLE,
} from "./near-ui.mjs";
import { loadManifest } from "../src/live.js";

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? "" : String(v));
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
};

function start() {
  const root = $("nm-tool"), form = $("nm-form");
  if (!root || !form) return;
  let cfg = {};
  try { cfg = JSON.parse($("nm-config").textContent); } catch { return; }
  const base = new URL(root.getAttribute("data-base") || "../", location.href).href;
  const calcUrl = new URL(root.getAttribute("data-calc"), location.href).href;
  const deviceZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } })();
  const store = {
    get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage refused: the page works without it */ } },
  };

  // ---------------------------------------------------------------- state: place and radius
  // chosen: the visitor (or a link, or this device's storage) picked the place; only then is it written to the address and to storage
  let place = null, radiusKm = DEFAULT_RADIUS_KM, placeNote = "", fromDevice = false, chosen = true, order = "time", last = null, placesIndex = null, coast = null;
  const q = parseQuery(location.search);
  if (q.place) { place = q.place; radiusKm = q.radiusKm || DEFAULT_RADIUS_KM; placeNote = "from the link"; }
  else {
    const s = restoreStored(store.get());
    if (s) { place = s.place; radiusKm = q.radiusKm || s.radiusKm; placeNote = "the last place you chose on this device"; }
    else { place = { ...DEFAULT_PLACE }; radiusKm = q.radiusKm || DEFAULT_RADIUS_KM; placeNote = "the default place; choose your own below"; chosen = false; }
  }
  if (q.problems.length) $("nm-query-note").textContent = "Some values in the address were not valid and were left out: " + q.problems.join(", ") + ".";

  form.hidden = false;
  const citySel = $("nm-city"), radiusSel = $("nm-radius");
  radiusSel.value = String(radiusKm);

  function showPlace() {
    $("nm-place-name").textContent = place.name;
    $("nm-place-coords").textContent = coordName(place.lat, place.lon);
    $("nm-place-note").textContent = placeNote ? `(${placeNote})` : "";
    const city = cfg.cities.find((c) => Math.abs(c.lat - place.lat) < 1e-4 && Math.abs(c.lon - place.lon) < 1e-4);
    citySel.value = city ? city.id : "";
    const share = $("nm-share");
    const qs = placeQuery(place, radiusKm);
    if (fromDevice) { share.hidden = true; history.replaceState(null, "", location.pathname); }
    else {
      share.hidden = false;
      $("nm-share-link").href = location.pathname + qs;
      if (chosen) { history.replaceState(null, "", location.pathname + qs); store.set(storedValue(place, radiusKm)); }
    }
  }

  function setPlace(p, note, device = false) {
    place = p; placeNote = note; fromDevice = device; chosen = true;
    showPlace();
    calculate();
  }

  citySel.addEventListener("change", () => {
    const c = cfg.cities.find((x) => x.id === citySel.value);
    if (c) setPlace({ name: c.name, lat: c.lat, lon: c.lon, tz: c.tz }, "one of the site's six cities");
  });
  radiusSel.addEventListener("change", () => {
    const r = Number(radiusSel.value);
    if (RADII_KM.includes(r)) { radiusKm = r; chosen = true; showPlace(); calculate(); }
  });

  // ---------------------------------------------------------------- place search (the app's GeoNames list, loaded on first use)
  const search = $("nm-search"), list = $("nm-search-list"), searchNote = $("nm-search-status");
  let loadingPlaces = null;
  const loadPlaces = () => loadingPlaces || (loadingPlaces = fetch(base + "places.json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((d) => (placesIndex = decodePlaces(d))));
  function showMatches() {
    const text = search.value;
    list.textContent = "";
    if (text.trim().length < 2) { searchNote.textContent = ""; return; }
    if (!placesIndex) {
      searchNote.textContent = "Loading the place list...";
      loadPlaces().then(showMatches, () => { searchNote.textContent = "The place list could not be loaded. Choose a city or type coordinates instead."; });
      return;
    }
    const found = searchPlaces(placesIndex, text, 6);
    searchNote.textContent = found.length ? `${plural(found.length, "match", "matches")}.` : "No place of that name in the list.";
    for (const p of found) {
      const label = `${p.name}, ${countryName(p.cc)}`;
      const b = el("button", { type: "button", class: "nm-pick" }, label);
      b.addEventListener("click", () => { list.textContent = ""; search.value = ""; searchNote.textContent = ""; setPlace({ name: cleanName(label) || p.name.slice(0, 60), lat: p.lat, lon: p.lon, tz: cleanTimeZone(p.tz) }, "from the place search"); });
      list.append(el("li", {}, b));
    }
  }
  let timer = 0;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(showMatches, 200); });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); showMatches(); const first = list.querySelector("button"); if (first) first.focus(); } });

  // ---------------------------------------------------------------- the device's position, only on click, never stored or sent
  const geoBtn = $("nm-geo"), geoStatus = $("nm-geo-status");
  geoBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { geoStatus.textContent = "This browser cannot give a position. Choose a city, search or type coordinates."; return; }
    geoStatus.textContent = "Asking your browser for the position...";
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = Math.round(pos.coords.latitude * 100) / 100, lon = Math.round(pos.coords.longitude * 100) / 100;
      geoStatus.textContent = "Using your device's position, rounded to about 1 km. It is not stored or sent anywhere.";
      setPlace({ name: "Your location", lat, lon, tz: cleanTimeZone(deviceZone) }, "your device's position", true);
    }, (err) => {
      geoStatus.textContent = err && err.code === 1 ? "The position was not shared, so nothing changed. Choose a city, search or type coordinates." : "The position could not be found. Choose a city, search or type coordinates.";
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });

  // ---------------------------------------------------------------- typed coordinates
  const latIn = $("nm-lat"), lonIn = $("nm-lon");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = checkTyped(latIn.value, lonIn.value);
    for (const [input, msg, errId] of [[latIn, c.latError, "nm-lat-err"], [lonIn, c.lonError, "nm-lon-err"]]) {
      $(errId).textContent = c.ok ? "" : msg;
      if (!c.ok && msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }
    if (!c.ok) { (c.lat === null ? latIn : lonIn).focus(); return; }
    // the time zone of the nearest listed place within 300 km, when the place list is already loaded; otherwise times show in UTC and yours
    const near = placesIndex ? nearestPlace(placesIndex, c.lat, c.lon, 300) : null;
    setPlace({ name: coordName(c.lat, c.lon), lat: c.lat, lon: c.lon, tz: near ? cleanTimeZone(near.place.tz) : null }, "typed coordinates");
  });

  // ---------------------------------------------------------------- the calculation
  const prog = $("nm-progress"), bar = $("nm-bar"), stage = $("nm-stage"), out = $("nm-out"), live = $("nm-announce");
  let worker = null, mainThread = null, runId = 0, gotAnswer = false, updating = false, pendingMsg = null, errored = false;
  // live versions whose files could not be downloaded: not asked for again in this visit (the worker keeps the same list)
  const failedVersions = new Set();

  // ---------------------------------------------------------------- new data: look at the manifest now and then
  // Only while the page is visible, at the manifest's pollSec (never under 300 s), longer after failures (pollDelayMs). When the live
  // satellites feed has a version the shown answer did not use, the same place and distance are worked out again.
  let pollTimer = 0, pollFails = 0, pollDue = false, pollSec = 300;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { if (document.hidden) pollDue = true; else poll(); }, pollDelayMs(pollSec, pollFails));
  }
  async function poll() {
    pollDue = false;
    const man = await loadManifest((u, i) => fetch(u, i), base + "live/", 6000);
    if (!man) pollFails++;
    else {
      pollFails = 0;
      if (man.pollSec) pollSec = man.pollSec;
      // after an error, try again with whatever the manifest offers now
      if (errored) { updating = true; calculate(); return; }
      if (last && last.info.bundledTaken) {
        const pick = chooseSource(man, Date.parse(last.info.bundledTaken), base + "live/", Date.now());
        const fresh = pick.source === "live" && !failedVersions.has(pick.version) && (last.info.source !== "live" || pick.version !== last.info.version);
        if (fresh) { updating = true; calculate(); return; }
      }
    }
    schedulePoll();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pollDue) poll(); });
  function handle(m) {
    if (!m || m.id !== runId) return;
    if (m.type === "progress") {
      gotAnswer = true;
      prog.hidden = false;
      if (m.stage === "download") {
        bar.removeAttribute("value");
        if (m.total) { bar.max = 1; bar.value = Math.min(1, m.loaded / m.total); }
        stage.textContent = m.total ? `Downloading the satellite catalogue: ${(m.loaded / 1e6).toFixed(1)} of ${(m.total / 1e6).toFixed(1)} MB (less over the wire, compressed).` : "Downloading the satellite catalogue...";
      } else {
        bar.max = 1; bar.value = m.total ? m.done / m.total : 0;
        stage.textContent = m.stage === "prepare" ? `Reading the orbit data: ${fmtInt(m.done)} of ${fmtInt(m.total)} objects.` : `Working out passes: ${fmtInt(m.done)} of ${fmtInt(m.total)} satellites.`;
      }
    } else if (m.type === "result") {
      gotAnswer = true;
      prog.hidden = true;
      const prev = last, wasUpdate = updating, wasError = errored;
      updating = false; errored = false;
      const newFailure = !!m.info.failedVersion && !failedVersions.has(m.info.failedVersion);
      if (m.info.failedVersion) failedVersions.add(m.info.failedVersion);
      const changed = !!prev && (prev.info.source !== m.info.source || prev.info.version !== m.info.version);
      // a look for new data that ended with the same data (for example a new version whose download failed): nothing to redraw or say;
      // the failure counts towards the longer wait before the next look
      if (wasUpdate && !changed && !wasError) { if (newFailure) pollFails++; schedulePoll(); return; }
      // new data from the collector: redraw in place, keeping the scroll position, and say so once
      const y = window.scrollY;
      last = m;
      draw();
      if (wasUpdate) window.scrollTo(0, y);
      const done = announcement({ placeName: m.place.name, radiusKm: m.radiusKm, now: m.now.length, within: m.within, borderline: m.borderline, usable: m.info.counts.used >= MIN_USABLE });
      live.textContent = changed && wasUpdate ? `Updated with ${sourceText(m.info)}. ${done}` : done;
      if (m.info.pollSec) pollSec = m.info.pollSec;
      schedulePoll();
    } else if (m.type === "error") {
      prog.hidden = true;
      errored = true; updating = false;
      // the old answer would no longer match the page's state: it is removed, and the page tries again at the next look for new data
      last = null; out.textContent = ""; out.hidden = true;
      live.textContent = "The satellite data could not be loaded or worked through, so there is no answer this time. The page tries again in a few minutes, or reload it.";
      pollFails++;
      schedulePoll();
    }
  }
  function useMainThread() {
    if (mainThread) return mainThread;
    mainThread = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = calcUrl; s.async = true;
      s.onload = () => (window.RadarNearCalc ? resolve(window.RadarNearCalc) : reject(new Error("no calculation")));
      s.onerror = () => reject(new Error("the calculation script did not load"));
      document.head.append(s);
    });
    return mainThread;
  }
  function calculate() {
    runId++;
    gotAnswer = false;
    if (!updating) showAll = false;  // a new place or distance starts with the short table; new data keeps what the visitor opened
    const msg = { type: "run", id: runId, base, place: { name: place.name, lat: place.lat, lon: place.lon, tz: place.tz || null }, radiusKm, startMs: Date.now() };
    pendingMsg = msg;
    prog.hidden = false; bar.removeAttribute("value"); stage.textContent = "Starting...";
    if (!mainThread && typeof Worker === "function") {
      try {
        if (!worker) {
          worker = new Worker(calcUrl);
          worker.onmessage = (e) => handle(e.data);
          // a worker that cannot start: the newest request goes to the main thread instead
          worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (!gotAnswer) { worker.terminate(); worker = null; fallback(pendingMsg); } };
        }
        worker.postMessage(msg);
        return;
      } catch { worker = null; }
    }
    fallback(msg);
  }
  function fallback(msg) {
    useMainThread().then((calc) => calc.run(msg, handle), () => handle({ type: "error", id: msg.id }));
    mainThread = mainThread || null;
  }

  // ---------------------------------------------------------------- drawing the answer
  const zone = () => (last && last.place.tz) || null;
  const zoneLabel = () => (zone() ? `Local time (${zone()})` : `Your time (${deviceZone || "UTC"})`);
  const ownerCell = (s) => {
    if (!s.owner) return "Not in the catalogue";
    const slug = cfg.owners[s.owner];
    return slug ? el("a", { href: base + "satellites-by-country/" + slug + "/" }, s.owner) : s.owner;
  };
  const chip = (text, kind) => el("span", { class: `nm-chip nm-${kind}` }, text);
  const small = (...kids) => el("span", { class: "nm-sm" }, ...kids);
  function satCell(s) {
    const td = el("td", {}, el("strong", {}, s.name));
    if (s.starlink) td.append(" ", chip("Starlink", "starlink"));
    if (s.recent) td.append(" ", chip("launched in the last 30 days", "new"));
    td.append(el("br"), small(`NORAD ${s.id}, `, ownerCell(s)));
    return td;
  }
  function row(r, startMs, nowRow = false) {
    const s = last.sats[r.k];
    const tz = zone() || deviceZone || "UTC";
    const when = el("td", { class: "nm-when" }, el("time", { datetime: isoUtc(r.t) }, nowRow ? "Now" : utcText(r.t, startMs).replace(/ UTC$/, "")));
    if (!nowRow) when.append(" ", small(timeErrorText(r.us)));
    when.append(el("br"), small(zoneText(r.t, tz)));
    const dist = el("td", { class: "nm-dist" }, shortDistance(r.km, r.u), " ", r.status === "within" ? chip("within", "within") : chip("borderline", "border"));
    if (s.exact) dist.append(el("br"), small("full orbit data"));
    const look = el("td", { class: "nm-when" }, r.el > 0 ? lookText(r.el, r.az) : `below the horizon`, el("br"), small(r.lit ? "in sunlight" : "in Earth's shadow"));
    const hs = el("td", { class: "nm-when" }, fmtKm(r.hKm), el("br"), small(`${r.kms.toFixed(1)} km/s`));
    const orbit = el("td", {}, cfg.orbitLabels[s.orbit] || s.orbit, el("br"), small(`${s.purpose || "Unspecified"}, ${s.launch ? `launched ${s.launch}` : "launch date not in the catalogue"}`));
    return el("tr", {}, when, satCell(s), dist, look, hs, orbit);
  }
  const head = (cols) => el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", { scope: "col" }, c))));
  const COLS = (now = false) => ["When (UTC)", "Satellite", now ? "Ground distance now" : "Closest ground distance", "From the place", "Height, speed", "Orbit, purpose"];
  const tableOf = (caption, rows, now = false) => el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": caption }, el("table", { class: now ? "nm-table nm-now" : "nm-table" }, el("caption", {}, caption), head(COLS(now)), el("tbody", {}, ...rows)));
  const tableNote = () => el("p", { class: "meta" }, `Times in UTC, with ${zone() ? `the place's local time (${zone()})` : `your device's time (${deviceZone || "UTC"}); the place's own time zone is not known for typed coordinates`} below. Owners as the catalogue records them. The "±" after a time and after a distance are the measured uncertainties of the time of closest approach and of the closest ground distance, explained under How accurate is it.`);
  // OURS: the table first shows this many rows; a button shows the rest of the hundred
  const FIRST_ROWS = 25;
  let showAll = false;

  function draw() {
    const m = last;
    if (!m) return;
    const c = m.info.counts, pname = m.place.name;
    out.textContent = "";
    out.hidden = false;
    const fetched = Date.parse(m.info.fetchedAt);
    const why = m.info.source === "live"
      ? (m.info.state === "stale" ? " The live feed has not been refreshed within its usual limit, so this is the newest data the site has." : "")
      : ` The live feed was not used: ${SOURCE_REASONS[m.info.reason] || "it was not available"}.`;
    const t = el("time", { datetime: isoUtc(fetched) }, sourceWhen(m.info));
    out.append(el("p", { class: "nm-source", id: "nm-source" }, ...(m.info.source === "live" ? ["Using orbit data from ", t, ", live feed"] : ["Using the bundled snapshot of ", t]),
      ` (CelesTrak element sets collected by this site). Worked out at `, el("time", { datetime: isoUtc(m.startMs) }, dayTimeUtc(m.startMs)), ` for ${fmtInt(c.used)} of the ${fmtInt(c.active)} active satellites in the data.${why} The page looks for newer data every few minutes while it is open.`));

    // old data: a loud warning when much of it is too old, and no answer at all when too little is left
    const old = staleState(c);
    if (old.level === "none") {
      out.append(el("h3", { id: "nm-old-h" }, "The orbit data is too old for an answer"),
        el("p", { class: "note warn", id: "nm-old" }, `${c.used ? `Only ${fmtInt(c.used)}` : "None"} of the ${fmtInt(c.active)} active satellites ${c.used === 1 ? "has" : "have"} orbit data from the last 3 days, so the page does not list passes or count satellites now: the answer would leave out almost everything. ${m.info.source === "live" ? "The site's live data has not been refreshed." : "The site's live data could not be used and the copy bundled with the site is old."} The page looks for newer data every few minutes; try again later.`));
      return;
    }
    if (old.level === "warn") out.append(el("p", { class: "note warn", id: "nm-old" }, `Warning: ${fmtInt(c.stale)} of the ${fmtInt(c.active)} active satellites (${Math.round(old.share * 100)}%) are left out because their orbit data is more than 3 days old, so this answer misses many passes. ${m.info.source === "live" ? "The live data has not been refreshed for a while." : "The site's live data could not be used, and the bundled copy is old."}`));

    // right now
    out.append(el("h3", { id: "nm-now-h" }, `Right now within ${fmtKm(m.radiusKm)} of ${pname}`));
    const exp = expectedAtOnce(c.used, m.radiusKm);
    if (!m.now.length) {
      out.append(el("p", { class: "nm-empty" }, `No satellite's ground point is within ${fmtKm(m.radiusKm)} of ${pname} at this moment. That is normal: if the ${fmtInt(c.used)} satellites were spread evenly over the Earth, ${expectedText(exp)} would be inside a circle this size at any moment, because the circle covers ${pctText(capFraction(m.radiusKm))} of the Earth's surface.`));
    } else {
      out.append(el("p", {}, `${plural(m.now.length, "satellite")} ${m.now.length === 1 ? "has its" : "have their"} ground point within ${fmtKm(m.radiusKm)} (or borderline). Spread evenly, ${expectedText(exp)} would be expected at any moment.`));
      out.append(tableOf(`Satellites over ${pname} now`, m.now.map((r) => row(r, m.startMs, true)), true));
    }
    if (c.uncertainNow) out.append(el("p", { class: "meta" }, `${plural(c.uncertainNow, "more satellite")} may be inside the circle now, but ${c.uncertainNow === 1 ? "its" : "their"} position is too uncertain to say (see below).`));

    // next 24 hours
    out.append(el("h3", { id: "nm-day-h" }, `Next 24 hours within ${fmtKm(m.radiusKm)} of ${pname}`));
    out.append(el("p", {}, `${plural(m.within, "pass", "passes")} whose closest approach is within ${fmtKm(m.radiusKm)}, and ${fmtInt(m.borderline)} borderline (outside it by less than the uncertainty), from `, el("time", { datetime: isoUtc(m.startMs) }, utcText(m.startMs)), " to ", el("time", { datetime: isoUtc(m.endMs) }, utcText(m.endMs, m.startMs)), "."));
    if (m.total) {
      const fs = el("fieldset", { class: "nm-order" }, el("legend", {}, "Order of the table"));
      for (const [v, label] of [["time", "Earliest first"], ["distance", "Nearest first"]]) {
        const r = el("input", { type: "radio", name: "nm-order", value: v, id: `nm-order-${v}`, checked: order === v });
        r.addEventListener("change", () => { order = v; draw(); const b = $(`nm-order-${v}`); if (b) b.focus(); });
        fs.append(el("label", { for: `nm-order-${v}` }, r, ` ${label}`));
      }
      out.append(fs);
      const all = order === "time" ? m.byTime : m.byDistance;
      const rows = showAll ? all : all.slice(0, FIRST_ROWS);
      drawMap(rows);
      out.append(tableNote());
      out.append(tableOf(`${order === "time" ? "The earliest" : "The nearest"} ${fmtInt(rows.length)} of ${fmtInt(m.total)} passes near ${pname} in the next 24 hours`, rows.map((r) => row(r, m.startMs))));
      if (all.length > rows.length) {
        const more = el("button", { type: "button", class: "nm-btn nm-small", id: "nm-more" }, `Show ${fmtInt(all.length)} rows`);
        // the button goes; focus moves to the first newly shown row, so a keyboard user carries on from where the table grew
        more.addEventListener("click", () => {
          showAll = true; const y = window.scrollY; draw(); window.scrollTo(0, y);
          const tr = out.querySelectorAll("table.nm-table:not(.nm-now) tbody tr")[FIRST_ROWS];
          if (tr) { tr.setAttribute("tabindex", "-1"); tr.focus({ preventScroll: true }); }
        });
        out.append(el("p", {}, more));
      }
      if (m.total > all.length) out.append(el("p", { class: "meta", id: "nm-more-note" }, `${fmtInt(m.total - all.length)} more ${m.total - all.length === 1 ? "pass is" : "passes are"} not in the table, which keeps the ${order === "time" ? "earliest" : "nearest"} ${fmtInt(all.length)}; switch the order to see the ${order === "time" ? "nearest" : "earliest"}.`));
    } else {
      out.append(el("p", { class: "nm-empty" }, `No pass comes within ${fmtKm(m.radiusKm)} of ${pname} in the next 24 hours among the satellites worked out. Try a larger distance.`));
    }

    // the geostationary belt
    if (m.geo.length) {
      out.append(el("h3", { id: "nm-geo-h" }, "Geostationary satellites near the place"));
      out.append(el("p", {}, "These are geostationary (inclined under 2 degrees): they hang over almost the same point of the equator all day, so they have no passes. Each is listed with how far its ground point is now and over the day. Inclined geosynchronous satellites, which swing north and south each day, are in the passes above."));
      const rows = m.geo.map((g) => {
        const s = m.sats[g.k];
        const dLat = g.lat - m.place.lat, dLon = ((g.lon - m.place.lon + 540) % 360) - 180;
        return el("tr", {}, satCell(s), el("td", {}, shortDistance(g.km, g.u), el("br"), g.allDay ? "within all day" : `from ${fmtKm(g.minKm)} to ${fmtKm(g.maxKm)} over the day`),
          el("td", {}, `${Math.abs(dLat).toFixed(1)}° ${dLat < 0 ? "south" : "north"}, ${Math.abs(dLon).toFixed(1)}° ${dLon < 0 ? "west" : "east"} of the place`), el("td", {}, g.el > 0 ? lookText(g.el, g.az) : "below the horizon"));
      });
      out.append(el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": "Geostationary satellites near the place" }, el("table", {}, el("caption", {}, "Geostationary satellites whose ground point is within the distance at some time in the 24 hours"),
        head(["Satellite, NORAD number, owner as the catalogue records it", "Ground distance now", "Ground point now", "Seen from the place"]), el("tbody", {}, ...rows))));
    }

    // what was left out
    const notes = [];
    if (c.stale) notes.push(`${plural(c.stale, "satellite")} left out because ${c.stale === 1 ? "its" : "their"} orbit data was more than 3 days old.`);
    if (c.uncertainPasses) notes.push(`${plural(c.uncertainPasses, "pass", "passes")} left out of the table: the central estimate is inside ${fmtKm(m.radiusKm)}, but the measured distance uncertainty for that kind of satellite is as large as the distance itself.`);
    if (c.refused) notes.push(`${plural(c.refused, "satellite")} left out because the orbit model could not use ${c.refused === 1 ? "its" : "their"} data.`);
    notes.push(`${plural(c.geostationary, "geostationary satellite")} ${c.geostationary === 1 ? "is" : "are"} handled apart, as above; ${m.geo.length ? `${fmtInt(m.geo.length)} ${m.geo.length === 1 ? "is" : "are"} near this place` : "none is near this place (they sit over the equator)"}.`);
    out.append(el("h3", { id: "nm-left-h" }, "What is left out"), el("ul", {}, ...notes.map((n) => el("li", {}, n))));
  }

  async function drawMap(rows) {
    const m = last, fig = el("figure", { class: "nm-map", id: "nm-map" });
    out.append(fig);
    if (!coast) {
      try { const r = await fetch(base + "coast.bin"); coast = r.ok ? decodeCoast(await r.arrayBuffer()) : []; } catch { coast = []; }
    }
    await new Promise((r) => setTimeout(r, 0));  // the map in a task of its own, after the table
    if (last !== m || !fig.isConnected) return;
    const tracks = rows.map((r) => ({ status: r.status, points: r.track || [] }));
    fig.innerHTML = mapSvg({ place: m.place, radiusKm: m.radiusKm, tracks, coast });
    const desc = fig.querySelector("desc");
    if (desc) desc.textContent = `A map ${fmtInt(Math.max(150, m.radiusKm * 2.5) * 2)} km across centred on ${m.place.name}, with the circle of ${fmtKm(m.radiusKm)} and the ground tracks of the ${fmtInt(rows.length)} passes in the table.`;
    fig.append(el("figcaption", {}, `The ground tracks of the ${fmtInt(rows.length)} passes in the table below, a few minutes either side of each closest approach (solid: within, dashed: borderline), around ${m.place.name} (the white dot); the circle is ${fmtKm(m.radiusKm)}, north is up. The table lists the same passes.`));
  }

  // copy the link
  $("nm-copy").addEventListener("click", () => {
    const url = $("nm-share-link").href, done = $("nm-copy-done");
    const ok = () => { done.textContent = "Link copied."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, () => { done.textContent = "Copy the link from the address bar."; });
    else done.textContent = "Copy the link from the address bar.";
  });
  $("nm-places-credit").textContent = PLACES_CREDIT + ".";

  showPlace();
  calculate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
