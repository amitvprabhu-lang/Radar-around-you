// Detail cards, search, feed, sheets and toasts. All DOM work for the "tap for details" side of the app.
import * as C from "./core.js";
import * as I from "./info.js";
import { tonightPlan } from "./plan.js";
import { $, h, icon, fmtTime, fmtDayTime, fmtDate, fmtDateTime, fmtUtc, num, kmText, latLonText, ageText, durText, daysAgoText } from "./dom.js";

const MMI_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const ALERT_COLORS = { green: "var(--ion)", yellow: "var(--signal)", orange: "var(--ember)", red: "var(--alert)" };
const SHAKE_WORDS = { 4: "Light", 5: "Moderate", 6: "Strong", 7: "Very strong", 8: "Severe", 9: "Violent" };

export function createPanels(ctx) {
  const { D, S, actions } = ctx;
  const place = () => S.place;
  const tz = () => S.place.tz;
  const nowDate = () => ctx.clock.now();

  // ------------------------------------------------------------------ toasts and sheets
  let toastSeq = 0;
  function toast(text, { sub, action, label, plain = false, ms = 5200 } = {}) {
    const id = ++toastSeq;
    const box = h("div", { class: "toast glass" + (plain ? " plain" : ""), role: "status", "data-id": id },
      plain ? null : h("i", { class: "ping" }),
      h("div", { class: "grow" }, h("b", { text }), sub ? h("span", { text: sub }) : null),
      action ? h("button", { class: "btn small primary", onclick: () => { box.remove(); action(); } }, label || "Show") : null);
    const host = $("toasts");
    while (host.children.length >= 3) host.firstChild.remove();
    host.append(box);
    setTimeout(() => box.remove(), ms);
    return box;
  }

  function closeSheet() {
    const el = $("sheet");
    el.hidden = true; el.replaceChildren();
    S.sheet = null;
    actions.sheetClosed && actions.sheetClosed();
  }
  function openSheet(name, ...content) {
    const el = $("sheet");
    S.sheet = name;
    el.replaceChildren(h("div", { class: "body glass", onclick: (e) => e.stopPropagation() }, ...content));
    el.hidden = false;
    el.onclick = closeSheet;
    return el;
  }

  // ------------------------------------------------------------------ small builders
  const kv = (label, value, o = {}) => {
    const dd = h("dd", { class: o.mono ? "mono" : "" });
    if (value && value.nodeType) dd.append(value); else dd.textContent = value ?? "Not available";
    const row = h("div", { class: o.wide ? "wide" : "" }, h("dt", { text: label }), dd);
    if (o.live) S.live.push(() => { const v = o.live(); if (v != null) dd.textContent = v; });
    return row;
  };
  const head = (tags, title, sub, subLive) => {
    const subEl = h("p", { class: "sub", text: sub || "" });
    if (subLive) S.live.push(() => { subEl.textContent = subLive(); });
    const fold = h("button", { class: "x", "aria-label": "Show fewer details", "aria-expanded": String(!S.cardCollapsed), onclick: () => {
      S.cardCollapsed = !S.cardCollapsed;
      $("card").classList.toggle("collapsed", S.cardCollapsed);
      fold.setAttribute("aria-expanded", String(!S.cardCollapsed));
      fold.setAttribute("aria-label", S.cardCollapsed ? "Show more details" : "Show fewer details");
    } }, icon("down"));
    fold.classList.add("fold");
    return h("div", { class: "card-head" }, h("div", { class: "grow" }, h("div", { class: "kicker" }, ...tags), h("h2", { text: title }), sub || subLive ? subEl : null),
      fold, h("button", { class: "x", "aria-label": "Close details", onclick: () => actions.closeCard() }, icon("close")));
  };
  const tag = (text, cls = "") => h("span", { class: "tag " + cls, text });
  const btn = (label, ic, onclick, cls = "") => h("button", { class: "btn " + cls, onclick }, ic ? icon(ic) : null, label);
  const link = (label, href, ic, cls = "") => h("a", { class: "btn " + cls, href, target: "_blank", rel: "noopener noreferrer" }, ic ? icon(ic) : null, label);

  // ------------------------------------------------------------------ satellite card
  const passCache = new Map();
  function nextPass(idx) {
    const key = idx + ":" + place().id + ":" + Math.floor(nowDate().getTime() / 600000);
    if (passCache.has(key)) return passCache.get(key);
    const s = D.swarm[idx];
    let pass = null;
    if (s.a < 20000) {
      const now = nowDate();
      const passes = C.findPasses((d) => C.swarmLook(s, d, place().lat, place().lon), (d) => C.sunAltAz(place().lat, place().lon, d).alt, new Date(now.getTime() - 5 * 60000), 24, { stepSec: 30, minEl: 10 });
      pass = passes.find((p) => p.set.getTime() > now.getTime()) || null;
    }
    passCache.clear();
    passCache.set(key, pass);
    return pass;
  }

  function satCard(sel) {
    const idx = sel.idx;
    const get = () => I.satelliteInfo(D, idx, nowDate(), place());
    let info = get();
    const tags = [tag(info.objectType || "Satellite", "live")];
    if (info.isNew) tags.push(tag(`NEW · launched ${daysAgoText(info.ageDays)}`, "new"));
    if (info.status && info.status !== "Not known") tags.push(tag(info.status));
    const isFollowing = () => S.followIdx === idx;
    const kids = [head(tags, info.name, [info.owner, info.purpose && info.purpose !== "Unspecified" ? info.purpose : null].filter(Boolean).join(" · "))];
    const facts = h("dl", { class: "facts" },
      kv("Owner or country", info.owner || "Not in the catalogue"),
      kv("NORAD number", String(info.noradId), { mono: true }),
      kv("Launched", info.launchDate ? `${fmtDate(info.launchDate, "UTC")} (${daysAgoText(info.ageDays)})` : "Not in the catalogue"),
      kv("Launch site", info.site ? info.site.replace(/\s*\(.*\)$/, "") : "Not in the catalogue"),
      kv("Height now", `${num(info.altKm)} km`, { mono: true, live: () => `${num(get().altKm)} km` }),
      kv("Speed", `${info.speedKmS.toFixed(2)} km/s · ${num(info.speedKmS * 3600)} km/h`, { mono: true }),
      kv("Orbit", `${num(info.periodMin)} min around · ${info.inclinationDeg.toFixed(1)}° tilt`, { mono: true }),
      kv("Sees a circle on the ground of", `${num(info.footprintKm)} km radius`, { mono: true }),
      kv("Directly over", latLonText(info.lat, info.lon), { mono: true, live: () => { const g = get(); return latLonText(g.lat, g.lon); } }),
      kv(`From ${place().name}`, info.look ? (info.look.above ? `${Math.round(info.look.el)}° up, ${info.look.compass}, ${num(info.look.rangeKm)} km away` : "Below your horizon right now") : "", {
        live: () => { const g = get(); return g.look.above ? `${Math.round(g.look.el)}° up, ${g.look.compass}, ${num(g.look.rangeKm)} km away` : "Below your horizon right now"; },
      }));
    kids.push(facts);
    const pass = nextPass(idx);
    if (pass) {
      const inProgress = pass.rise.getTime() <= nowDate().getTime();
      kids.push(h("p", { class: "note", style: { color: "var(--text)" } },
        h("b", { text: inProgress ? "Passing over you now: " : "Next pass: " }),
        `${fmtDayTime(pass.rise, tz())}, peaks ${Math.round(pass.max.el)}° up in the ${C.compassPoint(pass.max.az)}, ${C.formatDuration(pass.set - pass.rise)}${pass.visible ? ", visible to the eye if the sky is clear" : ", not lit or the sky is too bright"}. Approximate.`));
    }
    if (info.purpose) kids.push(h("p", { class: "note", text: `"${info.purpose}" is the category of the CelesTrak group this object is listed in. It is not an official mission statement.` }));
    const followBtn = btn(isFollowing() ? "Exit 3D follow" : "Follow in 3D", "follow", () => { actions.toggleFollow(idx); renderLabel(); }, "primary");
    const renderLabel = () => { followBtn.replaceChildren(icon("follow"), isFollowing() ? "Exit 3D follow" : "Follow in 3D"); };
    const acts = [followBtn, btn("Find in my sky", "eye", () => actions.findInSky(sel))];
    if (pass) acts.push(link("Remind me", C.googleCalendarUrl({ title: `Look up: ${info.name} passes over ${place().name}`, start: new Date(pass.rise.getTime() - 5 * 60000), end: pass.set, details: `Rises ${C.compassPoint(pass.riseAz)}, peaks ${Math.round(pass.max.el)}° ${C.compassPoint(pass.max.az)}. Approximate times from Radar Around You.`, location: place().name }), "bell"));
    acts.push(btn("Share", "share", () => actions.share()));
    kids.push(h("div", { class: "actions" }, ...acts));
    return kids;
  }

  // ------------------------------------------------------------------ aircraft card
  function planeCard(sel) {
    const recNow = () => (S.sky().planesNow.find((r) => r.p.hex === sel.hex) || sel.rec);
    const get = () => I.planeInfo(D, recNow());
    const info = get();
    const tags = [tag("Aircraft", "live"), tag("Snapshot position, moved forward")];
    const kids = [head(tags, info.call || info.hex, [info.airline, info.typeName].filter(Boolean).join(" · "))];
    if (info.route && info.route.length >= 2) {
      const a = info.route[0], b = info.route[info.route.length - 1];
      const pr = info.progress;
      kids.push(h("div", { class: "route", "aria-label": `Route ${a.iata || a.icao} to ${b.iata || b.icao}` },
        h("div", null, h("div", { class: "code", text: a.iata || a.icao }), h("small", { text: a.city || a.name })),
        h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.round((pr ? (pr.leg + pr.fraction) / (info.route.length - 1) : 0) * 100)}%` } }),
          (() => { const s = icon("plane"); s.style.left = `${Math.round((pr ? (pr.leg + pr.fraction) / (info.route.length - 1) : 0) * 100)}%`; return s; })()),
        h("div", { style: { textAlign: "right" } }, h("div", { class: "code", text: b.iata || b.icao }), h("small", { text: b.city || b.name }))));
      if (pr && !pr.onTrack) kids.push(h("p", { class: "note", text: "The flight is well away from the straight line between these airports, so the route may be a different leg or an old record." }));
    } else {
      kids.push(h("p", { class: "note", text: "No route is on record for this callsign." }));
    }
    kids.push(h("dl", { class: "facts" },
      kv("Altitude", `${num(info.altFt)} ft · ${num(info.altM)} m`, { mono: true }),
      kv("Speed", `${Math.round(info.gsKt)} kt · ${num(info.gsKmh)} km/h`, { mono: true }),
      kv("Heading", `${Math.round(info.track)}° ${C.compassPoint(info.track)}`, { mono: true }),
      kv(`From ${place().name}`, `${kmText(info.slantKm)} away`, { mono: true, live: () => { const g = get(); return `${kmText(g.slantKm)} away, ${Math.round(g.el)}° up, ${g.compass}`; } }),
      kv("Airline country", info.airlineCountry || "Not available"),
      kv("Aircraft code", info.hex ? `${info.type || "?"} · hex ${info.hex.toUpperCase()}` : "", { mono: true })));
    kids.push(h("p", { class: "note", text: "Aircraft data is the last ADS-B report from adsb.lol, moved forward along its heading. The 3D model is a generic airliner, not the real aircraft." }));
    kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary"), btn("Share", "share", () => actions.share())));
    return kids;
  }

  // play/pause, scrubber and speed for the wave replay. liveList receives functions that refresh the controls every second.
  function replayControls(liveList) {
    const cur = () => ctx.currentReplay();
    const play = h("button", { class: "btn small", "aria-label": "Play or pause the wave replay", onclick: () => { actions.setReplay({ paused: !cur().paused }); updatePlay(); } });
    const updatePlay = () => { play.replaceChildren(icon(cur().paused ? "play" : "pause"), cur().paused ? "Play" : "Pause"); };
    updatePlay();
    const range = h("input", { type: "range", min: "0", max: "1700", step: "5", value: String(Math.round(cur() ? cur().tau : 0)), "aria-label": "Seconds since the quake", oninput: () => { actions.setReplay({ tau: Number(range.value), paused: true }); updatePlay(); } });
    const speedBtn = h("button", { class: "btn small", "aria-label": "Replay speed", onclick: () => { const r = cur(); const next = r.live ? 40 : r.speed >= 100 ? 10 : r.speed >= 40 ? 100 : 40; actions.setReplay({ live: false, speed: next }); updateSpeed(); } });
    const updateSpeed = () => { const r = cur(); speedBtn.textContent = r.live ? "Live" : `x${r.speed}`; };
    updateSpeed();
    const readout = h("p", { class: "note mono", style: { margin: "6px 0 0" } });
    liveList.push(() => {
      const r = cur();
      if (!r) return;
      if (document.activeElement !== range) range.value = String(Math.round(r.tau));
      readout.textContent = `${durText(r.tau)} after the quake · P front ${num(r.rPkm || 0)} km · S front ${num(r.rSkm || 0)} km`;
      updatePlay(); updateSpeed();
    });
    return [h("div", { class: "row", style: { marginTop: "12px" } }, play, h("div", { class: "grow" }, range), speedBtn), readout];
  }

  // ------------------------------------------------------------------ earthquake card
  function quakeCard(sel) {
    const q = sel.q;
    const get = () => I.quakeInfo(D, q, place(), nowDate().getTime());
    const info = get();
    const tags = [tag(`M${q.mag.toFixed(1)}`, "warn")];
    if (info.ageMs < 3 * 3600e3) tags.push(tag("NEW", "new"));
    if (info.tsunami) tags.push(tag("TSUNAMI FLAG", "warn"));
    if (info.alert) tags.push(h("span", { class: "tag", style: { color: ALERT_COLORS[info.alert], background: "rgba(255,255,255,.07)" }, text: `PAGER ${info.alert}` }));
    const kids = [head(tags, `Magnitude ${q.mag.toFixed(1)} earthquake`, null, () => `${q.place} · ${ageText(nowDate().getTime() - info.timeMs)} · ${Math.round(info.depthKm)} km deep (${info.layer})`)];
    const reachText = (g) => (g.pReached ? `P waves passed ${durText(g.ageMs / 1000 - g.pSec)} ago` : `P waves arrive in ${durText(g.pSec - g.ageMs / 1000)}`) + ", " + (g.sReached ? `S waves passed ${durText(g.ageMs / 1000 - g.sSec)} ago` : `S waves in ${durText(g.sSec - g.ageMs / 1000)}`);
    kids.push(h("dl", { class: "facts" },
      kv(`Distance from ${place().name}`, `${num(info.distKm)} km ${info.compass}`, { mono: true }),
      kv("Depth", `${info.depthKm.toFixed(0)} km`, { mono: true }),
      kv("Waves would reach you", `P after ${durText(info.pSec)}, S after ${durText(info.sSec)}`, { mono: true }),
      kv("Right now", reachText(info), { mono: true, live: () => reachText(get()) }),
      kv("People who reported feeling it", info.felt != null ? num(info.felt) : "Not available", { mono: true }),
      kv("Shaking map", info.hasShakeMap ? "Yes, drawn on the globe" : "Not published for this quake")));
    if (info.exposure) {
      const rows = info.exposure.mmi.map((m, i) => ({ m, pop: info.exposure.pop[i] })).filter((r) => r.m >= 3 && r.pop > 0);
      if (rows.length) {
        const max = Math.max(...rows.map((r) => r.pop));
        kids.push(h("p", { class: "note", style: { color: "var(--text)", marginBottom: "0" } }, h("b", { text: "Estimated people exposed by shaking level" }), " (USGS PAGER)"));
        kids.push(h("div", { class: "bars" }, ...rows.map((r) => h("div", { class: "bar", style: { "--c": r.m >= 7 ? "var(--alert)" : r.m >= 5 ? "var(--ember)" : "var(--signal)" } },
          h("span", { text: `${MMI_ROMAN[r.m]} ${SHAKE_WORDS[r.m] || "Weak"}` }), h("div", { class: "meter" }, h("i", { style: { width: `${Math.max(4, (r.pop / max) * 100)}%` } })), h("span", { text: num(r.pop), style: { textAlign: "right" } })))));
      }
    }
    kids.push(...replayControls(S.live));
    kids.push(h("p", { class: "note", text: "Wave rings use constant speeds (P 8.0 km/s, S 4.5 km/s) along straight lines. Real waves bend and speed up with depth, so far-away arrivals in reality come sooner." }));
    kids.push(h("div", { class: "actions" },
      btn("Under my feet", "down", () => actions.showUnder(q), "primary"),
      link("Did you feel it?", info.url, "link"),
      btn("Share", "share", () => actions.share())));
    return kids;
  }

  // ------------------------------------------------------------------ hazard event card
  function eventCard(sel) {
    const e = sel.e;
    const names = { TC: "Tropical cyclone", FL: "Flood", WF: "Wildfire", VO: "Volcano", EQ: "Earthquake", DR: "Drought" };
    const dist = C.haversineKm(place().lat, place().lon, e.lat, e.lon);
    const kids = [head([tag(names[e.type] || e.type, "warn"), tag(`Alert ${e.alert}`)], e.name, `${e.country || ""}${e.severity ? " · " + e.severity : ""}`)];
    kids.push(h("dl", { class: "facts" },
      kv("Started", e.from ? fmtDateTime(new Date(e.from + "Z"), tz()) : "Not available"),
      kv("Last update", e.to ? fmtDateTime(new Date(e.to + "Z"), tz()) : "Not available"),
      kv(`Distance from ${place().name}`, `${num(dist)} km ${C.compassPoint(C.bearingDeg(place().lat, place().lon, e.lat, e.lon))}`, { mono: true }),
      kv("Position", latLonText(e.lat, e.lon), { mono: true })));
    kids.push(h("p", { class: "note", text: "Source: GDACS (UN and European Commission). Alert colours are GDACS's own." }));
    kids.push(h("div", { class: "actions" }, link("Open the GDACS report", e.url, "link", "primary"), btn("Share", "share", () => actions.share())));
    return kids;
  }

  // ------------------------------------------------------------------ Moon, planet, star
  function bodyCard(sel) {
    const sky = S.sky();
    if (sel.kind === "moon") {
      const get = () => sky.info.moon;
      const m = get();
      const kids = [head([tag("Moon", "live")], I.moonPhaseName(m.phase), null, () => `${Math.round(get().frac * 100)}% lit · ${Math.round(get().alt)}° up · ${C.compassPoint(get().az)}`)];
      kids.push(h("dl", { class: "facts" }, kv("Phase angle", `${Math.round(m.phase)}°`, { mono: true }), kv("Brightness", `magnitude ${m.mag.toFixed(1)}`, { mono: true })));
      kids.push(h("p", { class: "note", text: `The Moon is drawn ${sky.moonEnlarge} times larger than real so its phase is easy to see. Surface map: NASA lunar imagery.` }));
      kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary"), btn("Share", "share", () => actions.share())));
      return kids;
    }
    if (sel.kind === "planet") {
      const get = () => sky.info.planets.find((p) => p.name === sel.name);
      const p = get();
      const kids = [head([tag("Planet", "live")], p.name, null, () => { const q = get(); return `${q.alt > 0 ? Math.round(q.alt) + "° up" : "below the horizon"} · ${C.compassPoint(q.az)}`; })];
      kids.push(h("dl", { class: "facts" }, kv("Brightness", p.mag != null ? `magnitude ${p.mag.toFixed(1)}` : "Not available", { mono: true }), kv("Direction", `${Math.round(p.az)}° ${C.compassPoint(p.az)}`, { mono: true })));
      kids.push(h("p", { class: "note", text: "Planet positions from the astronomy-engine library. Brighter objects have lower (or negative) magnitudes." }));
      kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary"), btn("Share", "share", () => actions.share())));
      return kids;
    }
    const kids = [head([tag("Star", "live")], sel.name, `Magnitude ${D.stars.mag[sel.i].toFixed(1)}`)];
    kids.push(h("dl", { class: "facts" }, kv("Right ascension", `${(D.stars.ra[sel.i] / 15).toFixed(2)} h`, { mono: true }), kv("Declination", `${D.stars.dec[sel.i].toFixed(1)}°`, { mono: true })));
    kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary")));
    return kids;
  }

  function renderCard() {
    const el = $("card");
    S.live = [];
    const sel = S.selected;
    if (!sel || S.view === "under") { el.hidden = true; el.replaceChildren(); document.body.dataset.card = ""; return; }
    let kids = [];
    if (sel.kind === "sat") kids = satCard(sel);
    else if (sel.kind === "quake") kids = quakeCard(sel);
    else if (sel.kind === "plane") kids = planeCard(sel);
    else if (sel.kind === "event") kids = eventCard(sel);
    else kids = bodyCard(sel);
    el.replaceChildren(...kids);
    el.classList.toggle("collapsed", !!S.cardCollapsed);
    el.hidden = false;
    el.scrollTop = 0;
    document.body.dataset.card = sel.kind;
  }
  function tickLive() { for (const f of S.live) { try { f(); } catch { /* the object may have gone away */ } } }

  // ------------------------------------------------------------------ search
  let search = null;
  function buildSearchIndex() {
    const later = D.later;
    const items = [];
    if (later) {
      for (let i = 0; i < later.names.length; i++) {
        const id = later.ids[i];
        const alias = C.SATELLITE_ALIASES[id];
        items.push({ id, name: later.names[i], kind: "sat", idx: i, extra: alias, priority: D.swarm[i].type === 4 ? 3 : D.swarm[i].type === 1 ? 0 : D.swarm[i].type === 3 ? -1 : 1 });
      }
    }
    for (const q of D.quakes.events) items.push({ id: q.id, name: `M${q.mag.toFixed(1)} ${q.place}`, kind: "quake", q, priority: q.mag });
    for (const c of D.cities) items.push({ id: c.id, name: `${c.name} ${c.country}`, kind: "place", c, priority: 2 });
    search = C.buildSearch(items);
    S.searchReady = !!later;
  }
  function runSearch(q) {
    if (!search) buildSearchIndex();
    const out = { sat: [], quake: [], place: [], plane: [] };
    const query = q.trim();
    if (!query) return out;
    const mag = C.parseMagnitudeQuery(query);
    if (mag !== null) {
      out.quake = D.quakes.events.filter((e) => Math.abs(e.mag - mag) < 0.05).slice(0, 8).map((e) => ({ kind: "quake", q: e }));
    }
    for (const r of search(query, 24)) {
      if (r.kind === "sat" && out.sat.length < 6) out.sat.push(r);
      else if (r.kind === "quake" && out.quake.length < 6 && !out.quake.find((x) => x.q.id === r.q.id)) out.quake.push(r);
      else if (r.kind === "place" && out.place.length < 3) out.place.push(r);
    }
    const nq = C.normalizeText(query);
    if (nq.length >= 2) {
      const planes = S.sky().planesNow || [];
      for (const rec of planes) {
        const al = D.later && D.later.airlines[C.airlineCode(rec.p.call)];
        const hay = C.normalizeText(`${rec.p.call} ${al ? al.n : ""} ${I.aircraftName(rec.p.type)} ${rec.p.type}`);
        if (nq.split(" ").every((t) => hay.includes(t)) && out.plane.length < 4) out.plane.push({ kind: "plane", hex: rec.p.hex, rec });
      }
    }
    return out;
  }

  function resultRow(r) {
    if (r.kind === "sat") {
      const info = D.later ? I.satelliteInfo(D, r.idx, nowDate(), null) : null;
      const sub = info ? [info.owner, info.purpose !== "Unspecified" ? info.purpose : null, info.altKm ? `${num(info.altKm)} km up` : null].filter(Boolean).join(" · ") : "";
      return h("button", { class: "result", onclick: () => actions.focusItem({ kind: "sat", idx: r.idx }) }, h("span", { class: "ico", text: "SAT" }), h("div", null, h("b", { text: r.name }), h("span", { text: sub })));
    }
    if (r.kind === "quake") {
      const q = r.q;
      return h("button", { class: "result", onclick: () => actions.focusItem({ kind: "quake", q }) }, h("span", { class: "ico q", text: "M" + q.mag.toFixed(1) }), h("div", null, h("b", { text: q.place }), h("span", { text: `${ageText(nowDate().getTime() - Date.parse(q.time))} · ${Math.round(q.depth)} km deep · ${num(C.haversineKm(place().lat, place().lon, q.lat, q.lon))} km from ${place().name}` })));
    }
    if (r.kind === "plane") {
      const info = I.planeInfo(D, r.rec);
      return h("button", { class: "result", onclick: () => actions.focusItem({ kind: "plane", hex: r.hex, rec: r.rec }) }, h("span", { class: "ico", text: "AIR" }), h("div", null, h("b", { text: `${info.call} · ${info.typeName}` }), h("span", { text: `${info.airline || "Airline not known"} · ${kmText(info.slantKm)} away` })));
    }
    return h("button", { class: "result", onclick: () => actions.setPlace(r.c.id) }, h("span", { class: "ico", text: "PIN" }), h("div", null, h("b", { text: r.c.name }), h("span", { text: `Look from ${r.c.name}, ${r.c.country}` })));
  }

  function openSearch() {
    if (!search) buildSearchIndex();
    const panel = $("searchPanel");
    const results = h("div", { class: "results", "aria-live": "polite" });
    const input = h("input", { type: "search", placeholder: "Try ISS, Starlink 1008, M5.9 or a flight number", "aria-label": "Search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search" });
    const render = () => {
      const q = input.value;
      results.replaceChildren();
      if (!q.trim()) {
        results.append(h("h4", { text: "Try one of these" }), h("div", { class: "examples" },
          ...["ISS", "Tiangong", "Hubble", "Starlink", "M5.9", "Tambolaka", "Moon"].map((t) => h("button", { class: "chip glass", onclick: () => { input.value = t; render(); input.focus(); } }, t))));
        results.append(h("p", { class: "note", style: { margin: "14px 4px" }, text: S.searchReady ? "Search 19,000 satellites and debris objects, this week's earthquakes and the aircraft above you. Pick one and the globe flies there." : "Satellite names are still loading. Earthquakes and places work already." }));
        return;
      }
      if (q.trim().toLowerCase() === "moon") { results.append(h("button", { class: "result", onclick: () => actions.focusItem({ kind: "moon" }) }, h("span", { class: "ico", text: "MOON" }), h("div", null, h("b", { text: "The Moon" }), h("span", { text: "Show it in your sky" })))); }
      const o = runSearch(q);
      const sec = (title, arr) => { if (arr.length) results.append(h("h4", { text: title }), ...arr.map(resultRow)); };
      sec("Satellites and objects", o.sat); sec("Earthquakes this week", o.quake); sec(`Aircraft near ${place().name}`, o.plane); sec("Places", o.place);
      if (!o.sat.length && !o.quake.length && !o.plane.length && !o.place.length && !(q.trim().toLowerCase() === "moon")) results.append(h("p", { class: "note", style: { margin: "14px 4px" }, text: S.searchReady ? "Nothing matches that. Try a satellite name, a NORAD number, a place name or a magnitude like M5.9." : "Satellite names are still loading, try again in a moment." }));
    };
    let timer = 0;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 70); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); if (e.key === "Enter") { const first = results.querySelector(".result"); if (first) first.click(); } });
    panel.replaceChildren(h("form", { onsubmit: (e) => e.preventDefault() }, input, h("button", { type: "button", class: "round glass", "aria-label": "Close search", onclick: closeSearch }, icon("close"))), results);
    panel.hidden = false;
    S.searchOpen = true;
    render();
    setTimeout(() => input.focus(), 50);
    S.searchInput = input;
    S.searchRender = render;
  }
  function closeSearch() { $("searchPanel").hidden = true; $("searchPanel").replaceChildren(); S.searchOpen = false; }

  // ------------------------------------------------------------------ places sheet
  function openPlaces() {
    const list = h("div", { class: "list" }, ...D.cities.map((c) => h("button", { class: "item", onclick: () => { closeSheet(); actions.setPlace(c.id); } },
      h("span", { class: "mag sat", text: c.name.slice(0, 3).toUpperCase() }), h("div", null, h("b", { text: c.name }), h("span", { class: "s", text: `${c.country} · ${c.planes.aircraft.length} aircraft in the snapshot` })),
      c.id === S.place.id ? tag("current", "live") : null)));
    openSheet("places", h("h2", { text: "Where are you looking from?" }), h("p", { text: "Six places have a full data snapshot in this prototype. In the real app any place on Earth works." }), list,
      h("div", { class: "actions" }, btn("Use my location", "pin", () => { closeSheet(); actions.useMyLocation(); })));
  }

  // ------------------------------------------------------------------ feed
  function openFeed() {
    const now = nowDate();
    const nowMs = now.getTime();
    const body = [h("h2", { text: "What is new" }), h("p", { text: "Real events from the data snapshot. Tap Replay to watch the moment again in 3D." })];

    // quakes
    const sorted = D.quakes.events.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const big = sorted.filter((q) => q.mag >= 4.5).slice(0, 4);
    const quakes = big.length >= 3 ? big : sorted.slice(0, 4);
    body.push(h("h3", { text: "Earthquakes" }), h("div", { class: "list" }, ...quakes.map((q) => h("div", { class: "item" },
      h("span", { class: "mag", text: q.mag.toFixed(1) }), h("div", { class: "grow" }, h("b", { text: q.place }), h("span", { class: "s", text: `${ageText(nowMs - Date.parse(q.time))} · ${Math.round(q.depth)} km deep · ${num(C.haversineKm(place().lat, place().lon, q.lat, q.lon))} km away` })),
      h("button", { class: "btn small primary", onclick: () => { closeSheet(); actions.replayQuake(q); } }, icon("wave"), "Replay")))));

    // launches
    const launches = I.recentLaunches(D, nowMs).slice(0, 5);
    body.push(h("h3", { text: "New in orbit, last 30 days" }));
    if (!launches.length) body.push(h("p", { text: D.later ? "No objects launched in the last 30 days in this data." : "Loading the catalogue." }));
    else body.push(h("div", { class: "list" }, ...launches.map((g) => h("div", { class: "item" },
      h("span", { class: "mag sat", text: String(g.count) }), h("div", { class: "grow" }, h("b", { text: I.listWithMore(g.names, 1) }), h("span", { class: "s", text: `${g.date ? fmtDate(g.date, "UTC") : ""} (${daysAgoText(g.ageDays)}) · ${g.owner}${g.site ? " · " + g.site.replace(/\s*\(.*\)$/, "").split(",")[0] : ""}` })),
      h("button", { class: "btn small primary", onclick: () => { closeSheet(); actions.showArrival(g); } }, icon("follow"), "Show")))));

    // aircraft
    const planes = (S.sky().planesNow || []).filter((r) => r.el > 0).slice(0, 5);
    body.push(h("h3", { text: `Aircraft above ${place().name}` }));
    if (!planes.length) body.push(h("p", { text: "No aircraft above the horizon in the snapshot for this place." }));
    else body.push(h("div", { class: "list" }, ...planes.map((r) => { const info = I.planeInfo(D, r); return h("div", { class: "item" },
      h("span", { class: "mag air", text: r.p.type || "AIR" }), h("div", { class: "grow" }, h("b", { text: `${info.call} · ${info.airline || info.typeName}` }), h("span", { class: "s", text: `${kmText(info.slantKm)} away · ${Math.round(info.el)}° up in the ${info.compass}${info.summary ? " · " + info.summary : ""}` })),
      h("button", { class: "btn small primary", onclick: () => { closeSheet(); actions.focusItem({ kind: "plane", hex: r.p.hex, rec: r }); } }, icon("eye"), "Look")); })));

    // tonight and space weather
    const aur = S.sky().info.aurora;
    const plan = tonightPlan(place(), now, aur ? aur.chance : 0);
    body.push(h("h3", { text: "Tonight and space weather" }));
    const kp = I.kpAt(D.meta.kp, nowMs);
    const lines = [];
    if (plan.best) lines.push(h("p", null, h("b", { text: `Best window: ${fmtTime(plan.best.start, tz())} to ${fmtTime(plan.best.endExclusive, tz())}` }), ` (score ${plan.best.avg} of 100)`));
    else lines.push(h("p", { text: "No good stargazing window in the next 12 hours (daylight, cloud or a bright Moon)." }));
    if (kp) lines.push(h("p", { text: `Geomagnetic activity (Kp) is ${kp.kp.toFixed(1)}. ${aur && aur.chance >= 3 ? `Aurora chance near ${place().name}: about ${aur.chance}%.` : `The aurora oval is too far from ${place().name} for a realistic chance.`}` }));
    body.push(...lines);
    if (plan.best) body.push(h("div", { class: "actions" }, link("Remind me", C.googleCalendarUrl({ title: `Stargazing window over ${place().name}`, start: plan.best.start, end: plan.best.endExclusive, details: "Best viewing window from Radar Around You.", location: place().name }), "bell", "primary")));
    openSheet("feed", ...body);
  }

  function openAbout() {
    const m = D.meta;
    openSheet("about", h("h2", { text: "About this prototype" }),
      h("p", { text: `Data snapshot: ${fmtUtc(new Date(m.taken))}. ${ctx.clock.state.simulated ? "The clock runs forward from the snapshot, because it is more than 36 hours old." : "The clock is real time, and satellite positions are computed on your device."}` }),
      h("h3", { text: "Where the data comes from" }),
      h("ul", null,
        h("li", { text: "Satellites and orbits: CelesTrak (GP data and the satellite catalogue)." }),
        h("li", { text: "Earthquakes, shaking maps, PAGER: USGS. Hazards: GDACS." }),
        h("li", { text: "Aurora and Kp: NOAA Space Weather Prediction Center. Clouds: NASA GIBS imagery from 3 Oct 2026, so the cloud layer is a day old and has visible swath seams." }),
        h("li", { text: "Aircraft and routes: adsb.lol. Airlines: OpenFlights. Cloud forecasts: MET Norway. Stars: Hipparcos-based catalogue. Earth imagery: NASA Blue Marble." })),
      h("h3", { text: "Honest limits" }),
      h("ul", null,
        h("li", { text: "Satellite positions in the swarm use a fast simplified orbit model, accurate to tens or a few hundred kilometres. Pass times are approximate." }),
        h("li", { text: "Seismic waves use constant speeds along straight lines. It is a teaching model, not a travel-time table." }),
        h("li", { text: "3D models of aircraft and satellites are generic and not to scale. The Moon is enlarged." }),
        h("li", { text: "Sky glow is estimated from NASA night-light imagery, not measured." }),
        h("li", { text: "Phone-sensor look-around has not been tested on a real phone in this preview." })));
  }

  return { replayControls, toast, openSheet, closeSheet, renderCard, tickLive, openSearch, closeSearch, openPlaces, openFeed, openAbout, buildSearchIndex, runSearch };
}
