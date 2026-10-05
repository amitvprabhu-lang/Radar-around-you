// Detail cards, search, feed, sheets and toasts. All DOM work for the "tap for details" side of the app.
import * as C from "./core.js";
import * as I from "./info.js";
import * as SG from "./sgp4.js";
import { trainItems, visiblePart, whenText } from "./tonight.js";
import { drawCard, quakeSpec, passSpec, itemSpec, tonightSpec, CARD_W, CARD_H } from "./share.js";
import { agoText, STATE_LABEL } from "./live.js";
import { createWatch } from "./watch.js";
import { searchPlaces, placeFromRecord, countryName, PLACES_CREDIT } from "./places.js";
import { constellationAt, visibilityFrom, VISIBILITY_TEXT, bestMonth, wanderersIn } from "./constellations.js";
import { colourName, magnitudeRank, starDay, bayerName, detailsFor, distanceText, lightAgeText, luminosityText, planetText } from "./starinfo.js";
import { sizeText, sigmaText, lunarText, kmCompact, whenFromNow, ASSUMED_ALBEDO } from "./asteroids.js";
import * as L from "./launches.js";
import { GUIDE_LINKS } from "./guidelinks.js";
// true only in the build for the real site (build.mjs --site-pages), where the content pages exist next to the app
const SITE_PAGES = typeof __SITE_PAGES__ !== "undefined" && __SITE_PAGES__;
import { fmtDay } from "./tonight.js";
import { $, h, icon, fmtTime, fmtDayTime, fmtDate, fmtDateTime, fmtUtc, num, kmText, latLonText, ageText, durText, daysAgoText } from "./dom.js";

const MMI_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const ALERT_COLORS = { green: "var(--ion)", yellow: "var(--signal)", orange: "var(--ember)", red: "var(--alert)" };
const SHAKE_WORDS = { 4: "Light", 5: "Moderate", 6: "Strong", 7: "Very strong", 8: "Severe", 9: "Violent" };

export function createPanels(ctx) {
  const { D, S, actions } = ctx;
  const place = () => S.place;
  const tz = () => S.place.tz;
  const nowDate = () => ctx.clock.now();
  const skyNow = () => (ctx.skyDate ? ctx.skyDate() : nowDate());

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
    $("toasts").replaceChildren();
    S.sheet = name;
    el.replaceChildren(h("div", { class: "body glass", onclick: (e) => e.stopPropagation() }, ...content));
    el.hidden = false;
    el.onclick = closeSheet;
    actions.sheetOpened && actions.sheetOpened(name);
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
  // Next pass over the place, plus the next pass that can actually be seen. Exact (SGP4) when precise elements exist.
  function nextPasses(idx) {
    const key = idx + ":" + place().id + ":" + Math.floor(nowDate().getTime() / 600000);
    if (passCache.has(key)) return passCache.get(key);
    const s = D.swarm[idx];
    const now = nowDate();
    const ps = S.precise && S.precise.get(D.later.ids[idx]);
    let next = null, nextVisible = null;
    if (ps) {
      const start = new Date(now.getTime() - 5 * 60000);
      const day = SG.passesFor(ps, place(), start, 24, { minEl: 10 });
      next = day.find((p) => p.set.getTime() > now.getTime()) || null;
      nextVisible = day.find((p) => p.set.getTime() > now.getTime() && visiblePart(p)) || null;
      if (!nextVisible && next) nextVisible = SG.passesFor(ps, place(), start, 24 * 10, { minEl: 10 }).find((p) => p.set.getTime() > now.getTime() && visiblePart(p)) || null;
    } else if (s.a < 20000) {
      const passes = C.findPasses((d) => C.swarmLook(s, d, place().lat, place().lon), (d) => C.sunAltAz(place().lat, place().lon, d).alt, new Date(now.getTime() - 5 * 60000), 24, { stepSec: 30, minEl: 10 });
      next = passes.find((p) => p.set.getTime() > now.getTime()) || null;
    }
    const res = { next, nextVisible, exact: !!ps };
    passCache.clear();
    passCache.set(key, res);
    return res;
  }

  function satCard(sel) {
    const idx = sel.idx;
    const get = () => I.satelliteInfo(D, idx, nowDate(), place());
    let info = get();
    const tags = [tag(info.objectType || "Satellite", "live")];
    if (info.isNew) tags.push(tag(`NEW · launched ${daysAgoText(info.ageDays)}`, "new"));
    if (info.status && info.status !== "Not known") tags.push(tag(info.status));
    const psat = S.precise && S.precise.get(D.later.ids[idx]);
    const ageH = psat ? SG.elementAgeHours(psat, nowDate()) : D.later.details[idx * 8 + 7] * 4;
    if (ageH > 72) tags.push(tag(`ORBIT DATA ${Math.round(ageH / 24)} DAYS OLD`, "warn"));
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
      kv("Orbit data age", `${ageH < 48 ? Math.round(ageH) + " hours" : Math.round(ageH / 24) + " days"}${psat ? "" : " (approximate)"}`, { mono: true }),
      kv("Sees a circle on the ground of", `${num(info.footprintKm)} km radius`, { mono: true }),
      kv("Directly over", latLonText(info.lat, info.lon), { mono: true, live: () => { const g = get(); return latLonText(g.lat, g.lon); } }),
      kv(`From ${place().name}`, info.look ? (info.look.above ? `${Math.round(info.look.el)}° up, ${info.look.compass}, ${num(info.look.rangeKm)} km away` : "Below your horizon right now") : "", {
        live: () => { const g = get(); return g.look.above ? `${Math.round(g.look.el)}° up, ${g.look.compass}, ${num(g.look.rangeKm)} km away` : "Below your horizon right now"; },
      }));
    kids.push(facts);
    const { next: pass, nextVisible, exact } = nextPasses(idx);
    const passLine = (p, label) => {
      const v = visiblePart(p);
      const inProgress = p.rise.getTime() <= nowDate().getTime();
      const text = v
        ? `visible ${whenText(v.first.time, nowDate(), tz())} to ${fmtTime(v.last.time, tz())}, highest ${Math.round(v.best.el)}° in the ${C.compassPoint(v.best.az)}${v.fadesOut ? ", then it fades into Earth's shadow" : ""}`
        : `${whenText(p.rise, nowDate(), tz())}, peaks ${Math.round(p.max.el)}° up in the ${C.compassPoint(p.max.az)}, ${C.formatDuration(p.set - p.rise)}, not visible to the eye (not lit or the sky is too bright)`;
      return h("p", { class: "note", style: { color: "var(--text)" } }, h("b", { text: inProgress && !v ? "Passing over you now: " : label + ": " }), text + ".");
    };
    if (pass) {
      kids.push(passLine(pass, "Next pass"));
      if (nextVisible && nextVisible !== pass) kids.push(passLine(nextVisible, "Next visible pass"));
      else if (!nextVisible && exact) kids.push(h("p", { class: "note", text: "No visible pass in the next 10 days from here." }));
      kids.push(h("p", { class: "note", text: exact ? `Pass times are computed with SGP4 from an element set about ${Math.round(ageH)} hours old, so they are good to about a minute.` : "Pass times use a simplified orbit model, so treat them as approximate." }));
    }
    const train = (S.trains || []).find((t) => t.memberIdxs.includes(idx));
    if (train) {
      kids.push(h("p", { class: "note", style: { color: "var(--text)" } }, h("b", { text: "Part of a Starlink string: " }), `${train.count} satellites launched ${fmtDate(train.launchDate, "UTC")}, now spread over about ${Math.round(train.spanDeg)}° of their orbit.`));
    }
    if (info.purpose) kids.push(h("p", { class: "note", text: `"${info.purpose}" is the category of the CelesTrak group this object is listed in. It is not an official mission statement.` }));
    const followBtn = btn(isFollowing() ? "Exit 3D follow" : "Follow in 3D", "follow", () => { actions.toggleFollow(idx); renderLabel(); }, "primary");
    const renderLabel = () => { followBtn.replaceChildren(icon("follow"), isFollowing() ? "Exit 3D follow" : "Follow in 3D"); };
    const acts = [followBtn, btn("Find in my sky", "eye", () => actions.findInSky(sel))];
    if (pass) acts.push(link("Remind me", C.googleCalendarUrl({ title: `Look up: ${info.name} passes over ${place().name}`, start: new Date(pass.rise.getTime() - 5 * 60000), end: pass.set, details: `Rises ${C.compassPoint(pass.riseAz)}, peaks ${Math.round(pass.max.el)}° ${C.compassPoint(pass.max.az)}. Approximate times from Radar Around You.`, location: place().name }), "bell"));
    acts.push(btn(pass ? "Share this pass" : "Share", "share", () => (pass ? actions.openShare(passSpec({ name: info.name, short: info.name.split(" ")[0], place: place(), tz: tz(), pass })) : actions.share())));
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
      btn("Share card", "share", () => actions.openShare(quakeSpec(get(), place(), nowDate().getTime())))));
    return kids;
  }

  // ------------------------------------------------------------------ hazard event card
  function eventCard(sel) {
    const e = sel.e;
    const names = { TC: "Tropical cyclone", FL: "Flood", WF: "Wildfire", VO: "Volcano", EQ: "Earthquake", DR: "Drought" };
    const dist = C.haversineKm(place().lat, place().lon, e.lat, e.lon);
    const sev = I.hazardSeverity(e);
    const kids = [head([tag(names[e.type] || e.type, "warn"), tag(`Alert ${e.alert}`)], e.name, e.country || "")];
    kids.push(h("dl", { class: "facts" },
      sev ? kv(sev.label, sev.value, { mono: true }) : null,
      kv("Started", e.from ? fmtDateTime(new Date(e.from + "Z"), tz()) : "Not available"),
      kv("Last update", e.to ? fmtDateTime(new Date(e.to + "Z"), tz()) : "Not available"),
      kv(`Distance from ${place().name}`, `${num(dist)} km ${C.compassPoint(C.bearingDeg(place().lat, place().lon, e.lat, e.lon))}`, { mono: true }),
      kv("Position", latLonText(e.lat, e.lon), { mono: true })));
    kids.push(h("p", { class: "note", text: `${sev && sev.note ? sev.note + " " : ""}Source: GDACS (UN and European Commission). Alert colours are GDACS's own.` }));
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
    return starCard(sel);
  }

  // A constellation: what the IAU says it is called, how big it is, what is in it, when it is best placed, and how it sits over this place.
  let areaRank = null;
  function constellationCard(sel) {
    const L = D.later, cons = L.constellations, c = cons.byAbbr.get(sel.abbr), sky = S.sky();
    if (!areaRank) { areaRank = new Map(); [...cons.list].sort((a, b) => b.areaDeg2 - a.areaDeg2).forEach((x, k) => areaRank.set(x.abbr, k + 1)); }
    const vis = visibilityFrom(c, place().lat), best = bestMonth(c.centre.ra), inIt = wanderersIn(c.abbr, nowDate());
    const b = c.stars.brightest;
    const midText = () => { const a = sky.altAzOf(sel, skyNow()); return a ? (a.alt > 0 ? `${Math.round(a.alt)}° up, ${C.compassPoint(a.az)}` : "below the horizon") : "n/a"; };
    const named = [...L.starInfo.values()].filter((x) => x.con === c.abbr).sort((x, y) => x.mag - y.mag);
    const kids = [head([tag("Constellation", "live")], c.name, `${c.english} · ${c.abbr} · best seen in ${best.month}`)];
    kids.push(h("dl", { class: "facts" },
      kv("Pronounced", c.pron || "Not given", { mono: true, wide: true }),
      kv("Genitive, used in star names", c.genitive, { mono: true }),
      kv("Size", `${num(c.areaDeg2)} square degrees, number ${areaRank.get(c.abbr)} of 88`, { mono: true }),
      kv("Brightest star", b ? h("button", { class: "linkbtn", onclick: () => actions.focusItem({ kind: "star", i: b.i, name: b.name }) }, `${b.name || "HIP " + b.hip}, magnitude ${b.mag.toFixed(1)}`) : "Not available"),
      kv("Stars to magnitude 6", num(c.stars.count), { mono: true }),
      kv("Best seen", `Evenings in ${best.month} (highest at 9 pm)`, { wide: true }),
      kv(`From ${place().name}`, `${VISIBILITY_TEXT[vis.state]}${vis.state !== "never" ? ` Its middle gets as high as ${Math.round(Math.max(0, vis.maxAltCentre))}°.` : ""}`, { wide: true }),
      kv("Its middle now", midText(), { mono: true, live: midText }),
      kv("In it now", inIt.length ? inIt.join(", ") : "No planet or the Moon", { wide: true })));
    if (named.length) kids.push(h("div", null, h("p", { class: "note", text: "Stars here with IAU names:" }), h("div", { class: "examples" }, ...named.map((x) => h("button", { class: "chip glass", onclick: () => actions.focusItem({ kind: "star", i: x.i, name: x.name }) }, x.name)))));
    kids.push(h("p", { class: "note", text: "The boundaries are the IAU's. The blue stick figure is one common way of joining the stars and is not an official one." }));
    kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary"), btn("All constellations", "link", () => actions.openConstellations(), "small")));
    return kids;
  }

  // asteroids passing Earth in the next 60 days (NASA/JPL), soonest first
  function openAsteroids() {
    const close = D.hazards && D.hazards.close;
    if (!close) { openSheet("asteroids", h("h2", { text: "Asteroids passing close" }), h("p", { class: "note warn", text: "Close-approach data comes from a live feed (NASA/JPL), and this copy of the app has no live connection, so there is nothing to show yet." })); return; }
    const now = nowDate().getTime();
    const list = close.approaches.filter((a) => Date.parse(a.time) >= now - 6 * 3600e3);
    const closest = [...list].sort((a, b) => a.distAu - b.distAu)[0];
    const kids = [h("h2", { text: "Asteroids passing close" })];
    kids.push(h("p", { text: list.length ? `NASA/JPL lists ${list.length} asteroid${list.length === 1 ? "" : "s"} passing Earth within about 19 times the Moon's distance in the next 60 days.${closest ? ` The closest is ${closest.name}, at ${lunarText(closest.distLd)}.` : ""}` : "NASA/JPL lists no asteroid passing within about 19 times the Moon's distance in the next 60 days." }));
    kids.push(h("p", { class: "note", text: `These are close passes, not impacts: each is a prediction that the object will miss. The brightness number H is the object's brightness if it were at a standard distance, and a larger number means a smaller rock. Sizes shown are rough, from H with an assumed reflectivity of ${Math.round(ASSUMED_ALBEDO * 100)} percent; the real reflectivity is not known for most of these.` }));
    kids.push(h("div", { class: "list" }, ...list.map((a) => {
      const t = new Date(a.time), when = fmtDateTime(t, tz()), sig = sigmaText(a.timeSigma);
      return h("div", { class: "item near " + (a.distLd < 1 ? "alert" : a.distLd < 5 ? "watch" : "info") },
        h("div", { class: "grow" }, h("b", { text: a.name }),
          h("span", { class: "s", text: `${when} (${place().tz}), ${whenFromNow(t.getTime() - now)}${sig ? `, give or take ${sig}` : ""}` }),
          h("span", { class: "s", text: `${lunarText(a.distLd)} · ${kmCompact(a.distKm)} · ${a.speedKms.toFixed(1)} km/s · H ${a.h != null ? a.h.toFixed(1) : "?"}, ${sizeText(a.h)}` })));
    })));
    kids.push(h("p", { class: "note", text: "Distance is between the centres of Earth and the asteroid. The time is JPL's, given in a time scale about 69 seconds ahead of UTC, converted here and shown in the place's time zone. The Moon's distance is taken as about 384,400 km. Most of these are far too faint to see without a telescope." }));
    kids.push(h("p", { class: "srcline", text: `Source: NASA/JPL CNEOS, SBDB Close-Approach Data API (version ${close.version}), as of ${fmtUtc(new Date(close.generated))}.` }));
    kids.push(h("div", { class: "actions" }, link("NASA's list (CNEOS)", "https://cneos.jpl.nasa.gov/ca/", "link", "small")));
    openSheet("asteroids", ...kids);
  }

  // rocket launches (The Space Devs, Launch Library 2): firm times first, then the ones planned only for a month or quarter
  function openLaunches() {
    const doc = D.hazards && D.hazards.launches;
    const head = h("h2", { text: "Rocket launches" });
    if (!doc) { openSheet("launches", head, h("p", { class: "note warn", text: "The launch list comes from a live feed (The Space Devs, Launch Library 2), and this copy of the app has no live connection, so there is nothing to show yet." })); return; }
    const now = nowDate().getTime();
    const list = L.upcoming(doc, now), g = L.groups(list);
    const kids = [head];
    kids.push(h("p", { text: list.length ? `${g.firm.length} launch${g.firm.length === 1 ? "" : "es"} with a firm time and ${g.loose.length} planned only for a month or quarter, from The Space Devs' Launch Library 2.` : "The source lists no upcoming launches right now." }));
    kids.push(h("p", { class: "note", text: "Launch dates move often. The status is the source's own: \"Go for Launch\" means the current time is confirmed by official or reliable sources, and \"To Be Determined\" means the date is a placeholder or rough estimate. The source does not guarantee that its information is accurate." }));
    const ticks = [];  // countdown updaters, run once a second while this screen is open
    const row = (l) => {
      const { vehicle, mission } = L.split(l), cd = L.countdown(l, now), dist = L.padDistanceKm(l, place());
      const live = L.isLive(l), watch = L.watchLinks(l);
      const tm = L.tMinus(l, now) ? h("span", { class: "s mono tminus" }) : null;
      if (tm) { const upd = () => { const t = L.tMinus(l, nowDate().getTime()); tm.textContent = t ? t.text : ""; }; upd(); ticks.push(upd); }
      const player = h("div", { class: "player", hidden: true });
      const playBtns = watch.filter((w) => w.embedId).map((w) => btn("Play here", "eye", () => {
        const src = L.embedUrl(w.embedId);
        if (!src) return;
        player.replaceChildren(
          h("p", { class: "note", text: "This loads YouTube's player, so YouTube (Google) is contacted from now on. Close it to stop." }),
          h("div", { class: "frame" }, h("iframe", { src, title: `${mission || vehicle}: ${w.label}`, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", referrerpolicy: "strict-origin-when-cross-origin", sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" })),
          btn("Close player", null, () => { player.replaceChildren(); player.hidden = true; }, "small"));
        player.hidden = false;
      }, "small"));
      return h("div", { class: "item near " + (live ? "alert" : l.webcast ? "watch" : "info") },
        h("div", { class: "grow" }, h("b", null, mission ? `${vehicle}: ${mission}` : vehicle, live ? h("span", { class: "tag live", style: { marginLeft: "8px" }, text: "Live now" }) : null),
          h("span", { class: "s", text: `${L.whenText(l, place().tz)}${L.isExact(l) ? ` (${place().tz})` : ""}${cd ? `, ${cd}` : ""}` }),
          tm,
          h("span", { class: "s", text: `${l.location || l.pad || "Launch site not given"}${dist != null ? ` · ${L.distanceText(dist)}` : ""}` }),
          h("span", { class: "s", text: [`${l.provider || "Provider not given"}`, L.statusLine(l), l.missionType, l.orbit, l.probability != null ? `${l.probability}% chance of good launch weather` : null].filter(Boolean).join(" · ") }),
          watch.length ? h("div", { class: "actions watchrow" }, ...watch.map((w) => link(`Watch: ${w.label}`, w.url, "link", "small")), ...playBtns) : null,
          player));
    };
    if (g.firm.length) kids.push(h("h3", { text: "With a firm time" }), h("div", { class: "list" }, ...g.firm.map(row)));
    if (g.loose.length) kids.push(h("h3", { text: "Planned for a month or quarter" }), h("div", { class: "list" }, ...g.loose.map(row)));
    kids.push(h("p", { class: "note", text: "Watch links are the source's own, labelled in its words: an official webcast comes from the broadcaster, an unofficial one or a re-stream does not. They open in a new tab. Play here is offered only for official YouTube webcasts and loads nothing from YouTube until you tap it. Distance is a straight line from your place to the pad and says nothing about whether a launch can be seen from there. Times are shown in the place's time zone." }));
    kids.push(h("p", { class: "srcline", text: `Source: The Space Devs, Launch Library 2, as of ${fmtUtc(new Date(doc.generated))}.` }));
    kids.push(h("div", { class: "actions" }, link("The Space Devs", "https://thespacedevs.com/llapi", "link", "small")));
    const root = openSheet("launches", ...kids);
    if (ticks.length) {
      const timer = setInterval(() => { if (S.sheet !== "launches" || !root.isConnected || !root.querySelector(".tminus")) { clearInterval(timer); return; } ticks.forEach((f) => f()); }, 1000);
    }
  }

  // all 88 constellations, with the ones above the horizon first
  function openConstellations() {
    const cons = D.later && D.later.constellations;
    if (!cons) { openSheet("constellations", h("h2", { text: "Constellations" }), h("p", { text: "The constellation list is still loading. Try again in a moment." })); return; }
    const now = skyNow(), sky = S.sky();
    const rows = cons.list.map((c) => { const aa = sky.altAzOf({ kind: "constellation", abbr: c.abbr }, now); return { c, alt: aa ? aa.alt : -90, az: aa ? aa.az : 0, vis: visibilityFrom(c, place().lat) }; });
    let mode = "up", query = "";
    const list = h("div", { class: "list" });
    const status = (r) => (r.vis.state === "never" ? "never rises here" : r.alt > 3 ? `${Math.round(r.alt)}° up, ${C.compassPoint(r.az)}` : r.vis.state === "circumpolar" ? "never sets here" : "below the horizon now");
    const render = () => {
      const q = query.trim().toLowerCase();
      let shown = rows.filter((r) => !q || r.c.name.toLowerCase().includes(q) || r.c.english.toLowerCase().includes(q) || r.c.abbr.toLowerCase() === q || r.c.genitive.toLowerCase().includes(q));
      if (mode === "up") shown = shown.filter((r) => r.alt > 3).sort((a, b) => b.alt - a.alt);
      else shown = shown.sort((a, b) => a.c.name.localeCompare(b.c.name));
      list.replaceChildren(...(shown.length ? shown.map((r) => h("button", { class: "item", onclick: () => actions.openConstellation(r.c.abbr) },
        h("span", { class: "mag sat", text: r.c.abbr }), h("div", { class: "grow" }, h("b", { text: r.c.name }), h("span", { class: "s", text: `${r.c.english} · ${status(r)}` })))) : [h("p", { class: "note", text: mode === "up" ? "None match that above the horizon right now. Try All." : "No constellation matches that." })]));
      tabs.forEach(([id, b]) => { b.setAttribute("aria-pressed", String(id === mode)); });
    };
    const tabs = [["up", h("button", { class: "chip glass", onclick: () => { mode = "up"; render(); } }, "Up now")], ["all", h("button", { class: "chip glass", onclick: () => { mode = "all"; render(); } }, "All 88")]];
    const input = h("input", { type: "search", placeholder: "Search by name or meaning", "aria-label": "Search constellations", autocomplete: "off", spellcheck: "false", class: "placeinput" });
    input.addEventListener("input", () => { query = input.value; if (query.trim() && mode === "up") mode = "all"; render(); });
    openSheet("constellations", h("h2", { text: "Constellations" }),
      h("p", { text: `All 88 IAU constellations. Tap one to turn the sky to it and see its outline. ${place().name} is where "up now" is measured from.` }),
      h("div", { class: "scroller", style: { margin: "8px 0", padding: 0 } }, ...tabs.map((t) => t[1])), input, list,
      h("p", { class: "note", text: "Names, meanings and boundaries: IAU. Stick figures: d3-celestial project." }));
    render();
  }

  // A star: its IAU name if it has one, where it is and when it is up, and how bright and what colour.
  function starCard(sel) {
    const i = sel.i, sky = S.sky(), L = D.later;
    const info = L && L.starInfo && L.starInfo.get(i);
    const ra = D.stars.ra[i], dec = D.stars.dec[i], mag = D.stars.mag[i], bv = D.stars.bv[i];
    const con = L && L.constellations && L.constellations.byAbbr.get(constellationAt(ra, dec));
    const title = sel.name || (info && info.name) || (L ? `HIP ${L.starIds[i]}` : "Star");
    const bayer = bayerName(info, con);
    const sub = [bayer, con ? con.english : null, `magnitude ${mag.toFixed(1)}`].filter(Boolean).join(" · ");
    const kids = [head([tag("Star", "live"), info ? tag("IAU name") : null], title, sub)];
    const nowText = () => { const a = sky.altAzOf({ kind: "star", i }, skyNow()); return a ? (a.alt > 0 ? `${Math.round(a.alt)}° up, ${C.compassPoint(a.az)}` : "below the horizon") : "n/a"; };
    const rank = magnitudeRank(D.stars.mag, i);
    const day = starDay(ra, dec, place().lat, place().lon, nowDate());
    const t = (d) => (d ? fmtTime(d, tz()) : "none");
    const dayText = day.state === "never" ? "Never rises above the horizon from here." : day.state === "circumpolar" ? `Never sets from here. Highest at ${t(day.transit)}, ${Math.round(day.transitAlt)}° up.` : `Rises ${t(day.rise)} · highest ${t(day.transit)} (${Math.round(day.transitAlt)}° up) · sets ${t(day.set)}`;
    const det = detailsFor(L && L.starDetails, i);
    kids.push(h("dl", { class: "facts" },
      kv("Brightness", `magnitude ${mag.toFixed(1)}, ${rank === 1 ? "the brightest" : `number ${num(rank)} of ${num(D.stars.n)}`} in this catalogue`, { mono: true, wide: true }),
      kv("Colour", colourName(bv) ? `${colourName(bv)} (B-V ${bv.toFixed(2)})` : "Not available", { mono: true }),
      ...(det ? [
        kv("Distance", distanceText(det.pc) || "Not known: the catalogue's parallax for this star is missing or unreliable", { wide: true }),
        det.pc != null ? kv("Light age", lightAgeText(det.pc), { wide: true }) : null,
        det.spect ? kv("Spectral type", det.spect, { mono: true }) : null,
        luminosityText(det.lum) ? kv("Luminosity", luminosityText(det.lum), { wide: true }) : null,
        det.absMag != null ? kv("Absolute magnitude", `${det.absMag.toFixed(1)} (its brightness from 10 parsecs away)`, { mono: true, wide: true }) : null,
        det.planets ? kv("Known planets", planetText(det.planets), { wide: true }) : null,
      ].filter(Boolean) : []),
      kv("Constellation", con ? h("button", { class: "linkbtn", onclick: () => actions.openConstellation(con.abbr) }, con.name) : "Not available"),
      kv("Right ascension", `${(ra / 15).toFixed(2)} h`, { mono: true }), kv("Declination", `${dec.toFixed(1)}°`, { mono: true }),
      kv("Now", nowText(), { mono: true, live: nowText }),
      kv(`From ${place().name}`, dayText, { wide: true })));
    if (L && L.starIds && !info) kids.push(h("p", { class: "note", text: `Hipparcos number ${L.starIds[i]}. The IAU has not given this star a name.` }));
    if (info) kids.push(h("p", { class: "note", text: `The name is the one approved by the IAU Working Group on Star Names${info.designation ? ` (${info.designation} in the Bright Star Catalogue)` : ""}.` }));
    kids.push(h("div", { class: "actions" }, btn("Guide me to it", "eye", () => actions.guide(sel), "primary"), con ? btn(`${con.name}`, "link", () => actions.openConstellation(con.abbr), "small") : null));
    return kids;
  }

  // Every card says where its information comes from, with a link where the source has a page for it.
  function sourceLine(sel) {
    let text, href = null, label = "Source page";
    if (sel.kind === "sat") {
      text = `Source: CelesTrak (orbit data fetched ${fmtUtc(new Date(D.meta.taken))}, and the satellite catalogue). The age of this satellite's own element set is shown above. Positions are computed on your device.`;
      href = "https://celestrak.org/";
    } else if (sel.kind === "quake") {
      const st = sel.q.status;
      text = `Source: USGS, ${st === "reviewed" ? "reviewed by an analyst" : st === "automatic" ? "automatic and not yet reviewed, so it may change" : "status not given"}.`;
      href = sel.q.url || null; label = "USGS event page";
    } else if (sel.kind === "plane") {
      const t = place().planes && place().planes.time;
      text = `Source: adsb.lol aircraft position${t ? ` observed ${fmtUtc(new Date(t))}` : ""} (ODbL 1.0); airline names from OpenFlights.`;
      href = "https://www.adsb.lol/";
    } else if (sel.kind === "event") {
      text = "Source: GDACS. Its results are model output and should be confirmed with official bulletins.";
      href = sel.e.url || null; label = "GDACS report";
    } else if (sel.kind === "constellation") {
      text = "Names and boundaries: IAU. Stick figures: d3-celestial project. Which stars and planets are inside is worked out on your device with astronomy-engine.";
      href = "https://www.iau.org/public/themes/constellations/"; label = "IAU constellations";
    } else if (sel.kind === "star") {
      const has = D.later && D.later.starDetails && detailsFor(D.later.starDetails, sel.i);
      text = `Source: star names from the IAU Working Group on Star Names; positions and brightness from a Hipparcos-based catalogue; constellation boundaries from the IAU.${has ? " Distance, spectral type and luminosity: HYG database v4.4 (CC BY-SA 4.0)." + (has.planets ? " Planets: NASA Exoplanet Archive." : "") : ""} Rise and set times are computed on your device.`;
      href = "https://www.iau.org/public/themes/naming_stars/"; label = "IAU star names";
    } else {
      text = "Computed on your device with the astronomy-engine library, whose positions we checked against NASA JPL Horizons and the US Naval Observatory.";
    }
    return h("p", { class: "srcline" }, text, href ? " " : null, href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", text: label }) : null);
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
    else if (sel.kind === "constellation") kids = constellationCard(sel);
    else kids = bodyCard(sel);
    kids.push(sourceLine(sel));
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
    if (later && later.constellations) {
      for (const x of later.starInfo.values()) items.push({ id: `star${x.i}`, name: x.name, kind: "star", st: x, extra: `${x.designation || ""} ${x.id || ""}`, priority: 4 - Math.min(4, x.mag) });
      for (const c of later.constellations.list) items.push({ id: c.abbr, name: `${c.name} ${c.english}`, kind: "con", c, extra: `${c.genitive} ${c.abbr}`, priority: 1 });
    }
    search = C.buildSearch(items);
    S.searchReady = !!later;
  }
  function runSearch(q) {
    if (!search) buildSearchIndex();
    const out = { sat: [], quake: [], place: [], plane: [], geo: [], sky: [] };
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
      else if ((r.kind === "star" || r.kind === "con") && out.sky.length < 5) out.sky.push(r);
    }
    // any place on Earth, once the index is loaded; a place within 30 km of one of the six cities is skipped as a duplicate of it
    if (S.placesIndex) {
      for (const rec of searchPlaces(S.placesIndex, query, 6)) {
        if (D.cities.some((c) => C.haversineKm(Number(c.lat), Number(c.lon), rec.lat, rec.lon) < 30)) continue;
        if (out.geo.length < 4) out.geo.push({ kind: "geo", rec });
      }
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

  // a place from the GeoNames index, as a row in search results or in the places sheet
  function geoRow(rec, cls) {
    const where = countryName(rec.cc);
    const pop = rec.pop >= 1e6 ? `${(rec.pop / 1e6).toFixed(1)} million people` : rec.pop > 0 ? `${num(Math.round(rec.pop / 100) * 100)} people` : "";
    return h("button", { class: cls, onclick: () => actions.setPlace(placeFromRecord(rec)) },
      cls === "result" ? h("span", { class: "ico", text: "PIN" }) : h("span", { class: "mag sat", text: rec.name.slice(0, 3).toUpperCase() }),
      h("div", { class: "grow" }, h("b", { text: rec.name }), h("span", { class: cls === "result" ? "" : "s", text: `${where}${pop ? " · " + pop : ""}` })));
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
    if (r.kind === "geo") return geoRow(r.rec, "result");
    if (r.kind === "star") return h("button", { class: "result", onclick: () => actions.focusItem({ kind: "star", i: r.st.i, name: r.st.name }) }, h("span", { class: "ico", text: "STAR" }), h("div", null, h("b", { text: r.st.name }), h("span", { text: `${r.st.bayer ? r.st.bayer + " " : ""}${(D.later.constellations.byAbbr.get(r.st.con) || {}).genitive || r.st.con} · magnitude ${r.st.mag.toFixed(1)}` })));
    if (r.kind === "con") return h("button", { class: "result", onclick: () => actions.openConstellation(r.c.abbr) }, h("span", { class: "ico", text: r.c.abbr.toUpperCase() }), h("div", null, h("b", { text: r.c.name }), h("span", { text: `Constellation · ${r.c.english}` })));
    return h("button", { class: "result", onclick: () => actions.setPlace(r.c.id) }, h("span", { class: "ico", text: "PIN" }), h("div", null, h("b", { text: r.c.name }), h("span", { text: `Look from ${r.c.name}, ${r.c.country}` })));
  }

  function openSearch() {
    if (!search) buildSearchIndex();
    const panel = $("searchPanel");
    const results = h("div", { class: "results", "aria-live": "polite" });
    const input = h("input", { type: "search", placeholder: "Try ISS, Sirius, Orion, M5.9 or any place", "aria-label": "Search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search" });
    const render = () => {
      const q = input.value;
      results.replaceChildren();
      if (!q.trim()) {
        results.append(h("h4", { text: "Try one of these" }), h("div", { class: "examples" },
          ...["ISS", "Tiangong", "Starlink", "Sirius", "Orion", "M5.9", "Moon"].map((t) => h("button", { class: "chip glass", onclick: () => { input.value = t; render(); input.focus(); } }, t))));
        results.append(h("p", { class: "note", style: { margin: "14px 4px" }, text: S.searchReady ? "Search 19,000 satellites and debris objects, this week's earthquakes and the aircraft above you. Pick one and the globe flies there." : "Satellite names are still loading. Earthquakes and places work already." }));
        return;
      }
      if (q.trim().toLowerCase() === "moon") { results.append(h("button", { class: "result", onclick: () => actions.focusItem({ kind: "moon" }) }, h("span", { class: "ico", text: "MOON" }), h("div", null, h("b", { text: "The Moon" }), h("span", { text: "Show it in your sky" })))); }
      const o = runSearch(q);
      const sec = (title, arr) => { if (arr.length) results.append(h("h4", { text: title }), ...arr.map(resultRow)); };
      sec("Satellites and objects", o.sat); sec("Earthquakes this week", o.quake); sec(`Aircraft near ${place().name}`, o.plane); sec("Stars and constellations", o.sky); sec("Places", [...o.place, ...o.geo]);
      if (!o.sat.length && !o.quake.length && !o.plane.length && !o.place.length && !o.geo.length && !o.sky.length && !(q.trim().toLowerCase() === "moon")) results.append(h("p", { class: "note", style: { margin: "14px 4px" }, text: S.searchReady ? "Nothing matches that. Try a satellite name, a NORAD number, a place name or a magnitude like M5.9." : "Satellite names are still loading, try again in a moment." }));
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
    // the place index loads on first use; results for places appear as soon as it arrives
    actions.ensurePlaces().then(() => { if (S.searchOpen && S.searchInput && S.searchInput.value.trim()) render(); }).catch(() => {});
  }
  function closeSearch() { $("searchPanel").hidden = true; $("searchPanel").replaceChildren(); S.searchOpen = false; }

  // ------------------------------------------------------------------ places sheet
  function openPlaces() {
    const results = h("div", { class: "list" });
    const input = h("input", { type: "search", placeholder: "Search any town or city", "aria-label": "Search for a place", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", class: "placeinput" });
    const showResults = () => {
      const q = input.value.trim();
      results.replaceChildren();
      if (q.length < 2) return;
      if (!S.placesIndex) { results.append(h("p", { class: "note", text: "Loading the place list (about 1 MB)..." })); return; }
      const found = searchPlaces(S.placesIndex, q, 8);
      if (!found.length) results.append(h("p", { class: "note", text: "No town or city of about 15,000 people or more matches that. Try a bigger place nearby, or use your location." }));
      for (const rec of found) results.append(geoRow(rec, "item"));
    };
    let timer = 0;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(showResults, 80); });
    input.addEventListener("focus", () => { actions.ensurePlaces().then(showResults).catch(() => results.replaceChildren(h("p", { class: "note warn", text: "The place list could not be loaded, so only the six cities below can be chosen." }))); }, { once: true });
    const cur = place().custom ? h("div", { class: "item" }, h("span", { class: "mag sat", text: place().name.slice(0, 3).toUpperCase() }), h("div", { class: "grow" }, h("b", { text: place().name }), h("span", { class: "s", text: `${place().country} · ${place().positionFix ? "your device's position" : "your chosen place"}` })), tag("current", "live")) : null;
    const list = h("div", { class: "list" }, ...D.cities.map((c) => h("button", { class: "item", onclick: () => { closeSheet(); actions.setPlace(c.id); } },
      h("span", { class: "mag sat", text: c.name.slice(0, 3).toUpperCase() }), h("div", null, h("b", { text: c.name }), h("span", { class: "s", text: `${c.country} · ${c.planes.aircraft.length} aircraft in the snapshot` })),
      c.id === S.place.id ? tag("current", "live") : null)));
    openSheet("places", h("h2", { text: "Where are you looking from?" }),
      h("p", { text: "Search any town or city on Earth. The sky, calendar, Tonight and the storm, fire and aurora screens all work for any place." }),
      input, results, cur,
      h("div", { class: "actions" }, btn("Use my location", "pin", () => { closeSheet(); actions.useMyLocation(); })),
      h("h3", { text: "Six cities with a full data set" }),
      h("p", { class: "note", text: "Only these have a live cloud forecast and aircraft overhead, because those come from sources that cannot be asked for every place." }),
      list,
      h("p", { class: "note", text: PLACES_CREDIT + "." }));
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
    const t = ctx.tonight();
    body.push(h("h3", { text: "Tonight and space weather" }));
    const kp = I.kpAt(D.meta.kp, nowMs);
    body.push(h("p", null, h("b", { text: t.verdict.headline }), `. ${t.verdict.sentence}`));
    if (kp) body.push(h("p", { text: `Geomagnetic activity (Kp) is ${kp.kp.toFixed(1)}.` }));
    body.push(h("div", { class: "actions" }, btn("See the full plan for tonight", "eye", () => { closeSheet(); openTonight(); }, "primary")));
    openSheet("feed", ...body);
  }

  // ------------------------------------------------------------------ tonight, strings and share sheets
  const KIND_CLASS = { pass: "pass", train: "train", aurora: "aurora", planet: "planet", shower: "shower" };
  function itemRow(it, { close = true } = {}) {
    const now = nowDate();
    const btns = [];
    if (it.target || it.sky) btns.push(h("button", { class: "btn small primary", onclick: () => { if (close) closeSheet(); actions.showItem(it); } }, icon("eye"), "Show me"));
    if (it.remind) btns.push(link("Remind me", it.remind.url, "bell", "small"));
    if (it.kind === "pass" || it.kind === "train") btns.push(btn("Share card", "share", () => actions.openShare(itemSpec(it, place(), tz())), "small"));
    return h("div", { class: "titem" },
      h("span", { class: `tchip ${KIND_CLASS[it.kind] || ""}`, text: it.tag }),
      h("div", { class: "grow" }, h("div", { class: "ttime mono", text: whenText(it.start || it.time, now, tz()) }), h("b", { text: it.title }), h("p", { class: "tdetail", text: it.detail }), btns.length ? h("div", { class: "actions tight" }, ...btns) : null));
  }

  function openTonight() {
    const holder = h("div", null, h("p", { text: "Working out your night..." }));
    openSheet("tonight", h("h2", { text: `Tonight in ${place().name}` }), holder);
    setTimeout(() => {
      if (S.sheet !== "tonight") return;
      const t = ctx.tonight(true);
      const v = t.verdict;
      const ring = h("div", { class: `ring ${v.level}`, style: { "--p": String(v.score) } }, h("span", { text: String(v.score) }));
      const kids = [
        h("div", { class: "verdict" }, ring, h("div", { class: "grow" }, h("div", { class: "kicker" }, h("span", { class: `tag ${v.level === "excellent" || v.level === "good" ? "live" : v.level === "poor" ? "warn" : ""}`, text: v.level.toUpperCase() })), h("h3", { class: "vhead", text: v.headline }), h("p", { text: v.sentence }))),
        h("div", { class: "conds" }, ...t.conditions.filter((c) => c.kind !== "note").map((c) => h("div", { class: "cond" }, h("b", { text: c.title }), h("span", { text: c.detail })))),
      ];
      for (const c of t.conditions.filter((x) => x.kind === "note")) {
        kids.push(h("div", { class: "cond wide" }, h("b", { text: c.title }), h("span", { text: c.detail }),
          c.target ? h("div", { class: "actions tight" }, h("button", { class: "btn small", onclick: () => { closeSheet(); actions.showItem({ ...c, time: c.atTime, kind: "pass" }); } }, icon("eye"), "Show me that pass")) : null));
      }
      kids.push(h("h3", { text: "What to look for" }));
      if (t.items.length) kids.push(h("div", { class: "tlist" }, ...t.items.map((it) => itemRow(it))));
      else kids.push(h("p", { text: "Nothing special is lined up. Stars and the Moon are still there." }));
      kids.push(h("div", { class: "actions" }, btn("Share tonight", "share", () => actions.openShare(tonightSpec(t, place())), "primary")));
      kids.push(h("p", { class: "note", text: "Satellite times use SGP4 with CelesTrak element sets and are good to about a minute. Meteor shower dates and rates are approximate. Cloud comes from a MET Norway forecast. A pass counts as visible only while the satellite is in sunlight and the Sun is more than 6 degrees below your horizon." }));
      holder.replaceChildren(...kids);
    }, 40);
  }

  function openTrains() {
    const trains = S.trains || [];
    const now = nowDate();
    const kids = [h("h2", { text: "Starlink strings" }), h("p", { text: "Satellites from one recent launch that are still in a line. They spread out over days and weeks as they climb to their final orbit, so a string is only worth looking for in the first few weeks." })];
    if (!trains.length) kids.push(h("p", { text: "No recent Starlink launch is still bunched together in this data." }));
    for (const tr of trains) {
      kids.push(h("h3", { text: `Launched ${fmtDate(tr.launchDate, "UTC")}, ${tr.count} satellites, spread over ${Math.round(tr.spanDeg)}°` }));
      const items = trainItems({ train: tr, precise: S.precise, place: place(), from: now, hours: 72, now, limit: 4 });
      if (items.length) kids.push(h("div", { class: "tlist" }, ...items.map((it) => itemRow(it))));
      else kids.push(h("p", { text: `No sighting from ${place().name} in the next 3 days (it has to be dark, and the satellites have to be above the horizon and in sunlight).` }));
      kids.push(h("div", { class: "actions tight" }, btn("Show on the globe", "follow", () => { closeSheet(); actions.focusItem({ kind: "sat", idx: tr.centralIdx }); }, "small")));
    }
    kids.push(h("p", { class: "note", text: "Strings are found by comparing the exact (SGP4) positions of every satellite from the same launch. Orbit data is refreshed every few hours in the full app." }));
    openSheet("trains", ...kids);
  }

  function openShare(spec) {
    const canvas = document.createElement("canvas");
    try { drawCard(spec, canvas, { when: nowDate(), tz: tz() }); } catch (e) { toast("Could not draw the card", { plain: true }); return; }
    canvas.className = "sharecanvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${spec.title}. ${spec.subtitle}`);
    const status = h("p", { class: "note", role: "status", text: "" });
    const textBox = h("div", { class: "sharetext", tabindex: "0", text: spec.text });
    const copy = async () => {
      try { await navigator.clipboard.writeText(spec.text); status.textContent = "Text copied."; }
      catch { const r = document.createRange(); r.selectNodeContents(textBox); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); status.textContent = "Copying is blocked here. The text is selected, copy it by hand."; }
    };
    const save = async () => { const ok = await actions.saveCard(canvas, spec); status.textContent = ok === true ? "Image saved." : ok || ""; };
    openSheet("share", h("h2", { text: "Share this" }), h("div", { class: "sharebox" }, canvas), textBox,
      h("div", { class: "actions" }, btn("Save image", "down", save, "primary"), btn("Copy text", "link", copy)), status,
      h("p", { class: "note", text: "On a phone you can also press and hold the picture to save it." }));
  }

  // ------------------------------------------------------------------ sky calendar
  const CAL_FILTERS = [["all", "All"], ["moon", "Moon"], ["eclipse", "Eclipses"], ["planet", "Planets"], ["shower", "Showers"], ["season", "Seasons"]];
  function calendarRow(e) {
    const zone = e.allDay ? "UTC" : tz();
    const when = e.allDay ? fmtDay(e.time, zone) : `${fmtDay(e.time, zone)}, ${fmtTime(e.time, zone)}`;
    const remind = C.googleCalendarUrl({ title: e.title, start: e.time, end: new Date(e.time.getTime() + 3600000), details: `${e.detail} From Radar Around You.`, location: place().name });
    const cls = { moon: "moon", eclipse: "eclipse", planet: "planet", shower: "shower", season: "season" }[e.kind] || "";
    return h("div", { class: "titem", "data-kind": e.kind },
      h("span", { class: `tchip ${cls}`, text: e.tag }),
      h("div", { class: "grow" }, h("div", { class: "ttime mono", text: when }), h("b", { text: e.title }), h("p", { class: "tdetail", text: e.detail }),
        h("div", { class: "actions tight" }, link("Remind me", remind, "bell", "small"))));
  }
  function openCalendar() {
    const cal = ctx.calendar();
    const list = h("div", { class: "callist" });
    const chips = h("div", { class: "scroller", style: { margin: "0 0 10px", padding: 0 } });
    const render = () => {
      const f = S.calFilter || "all";
      chips.replaceChildren(...CAL_FILTERS.map(([k, label]) => h("button", { class: "chip glass", "aria-pressed": String(f === k), onclick: () => { S.calFilter = k; render(); } }, label)));
      const rows = cal.events.filter((e) => f === "all" || e.kind === f);
      const kids = [];
      let month = "";
      for (const e of rows) {
        const m = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: e.allDay ? "UTC" : tz() }).format(e.time);
        if (m !== month) { month = m; kids.push(h("h3", { text: m })); }
        kids.push(calendarRow(e));
      }
      if (!rows.length) kids.push(h("p", { text: "Nothing of this kind in the next three months." }));
      list.replaceChildren(...kids);
    };
    render();
    openSheet("calendar", h("h2", { text: `Sky calendar for ${place().name}` }),
      h("p", { text: `The next ${Math.round((cal.to - cal.from) / 86400000)} days, with times in ${tz()}.` }), chips, list,
      h("p", { class: "note", text: "Worked out on your device with the astronomy-engine library. Moon phases, equinoxes, solstices and solar eclipses were checked against the US Naval Observatory's published tables. Meteor shower dates come from the IMO 2027 calendar and can be a day off in other years. A close pairing means two naked-eye planets under 3 degrees apart and clear of the Sun, a limit we chose." }));
  }

  // ------------------------------------------------------------------ data status
  function stateTime(iso) {
    return iso ? fmtUtc(new Date(iso)) : "not stated";
  }
  function feedRow(r, nowMs) {
    const f = r.feed;
    const pill = h("span", { class: "statepill " + r.state, text: STATE_LABEL[r.state] });
    const bits = [r.ageSec == null ? "never checked" : `checked ${agoText(r.ageSec)}`];
    if (f.sourceTime) bits.push(`source time ${stateTime(f.sourceTime)}`);
    if (f.count != null) bits.push(`${num(f.count)} item${f.count === 1 ? "" : "s"}`);
    return h("div", { class: "feedrow", "data-feed": r.id },
      h("div", { class: "frow-head" }, h("b", { text: f.label }), pill),
      h("p", { class: "mono small", text: bits.join(" · ") }),
      h("p", { class: "note", text: `${f.source}. ${f.says}` }),
      f.note ? h("p", { class: "note", text: f.note }) : null,
      f.error ? h("p", { class: "note warn", text: `Last problem: ${f.error}` }) : null,
      h("p", { class: "note" }, h("a", { href: f.docUrl, target: "_blank", rel: "noopener noreferrer", text: "Source page" }), ` · Reuse, in the source's own words: ${f.licence}`));
  }
  function openStatus() {
    const st = actions.liveStatus();
    const kids = [h("h2", { text: "Data status" })];
    if (!st.manifest || !st.summary) {
      kids.push(h("p", { text: `This copy of the app is showing the bundled snapshot taken ${fmtUtc(new Date(D.meta.taken))}. Live feeds are not connected here, so nothing on screen updates by itself.` }));
      kids.push(h("p", { class: "note", text: "Live data appears when the data folder written by the collector (the pipeline folder in the project) is published next to the page." }));
      if (st.state && st.state.lastPollAt) kids.push(h("p", { class: "note", text: `The page last looked for it ${agoText((Date.now() - st.state.lastPollAt) / 1000)} and found nothing.` }));
      openSheet("status", ...kids);
      return;
    }
    const sum = st.summary, nowMs = Date.now();
    const bad = sum.counts.failing + sum.counts.stale + sum.counts.none + sum.counts.halted;
    kids.push(h("p", { text: bad ? `${sum.counts.fresh} of ${sum.counts.fresh + bad} feeds are up to date.` : "Every feed is up to date." }));
    kids.push(h("p", { class: "note", text: `The collector last wrote its report ${agoText(sum.generatedAgeSec)}. Each time is when the collector last confirmed that feed was current. Where a source gives its own time, that is shown too.` }));
    if (st.state && st.state.offline) kids.push(h("p", { class: "note warn", text: `This page could not reach the data folder on its last try, so it is showing what it already had.` }));
    if (st.state && st.state.satellitesWaiting) kids.push(h("div", { class: "actions" }, btn("Reload to use newer orbit data", "down", () => actions.reloadForOrbits(), "primary")));
    if (st.fellBack && st.fellBack.length) kids.push(h("p", { class: "note warn", text: `Could not load live ${st.fellBack.join(", ")} at start, so the bundled snapshot was used for ${st.fellBack.length === 1 ? "it" : "them"}.` }));
    kids.push(...sum.rows.map((r) => feedRow(r, nowMs)));
    const stat = st.manifest.static || [];
    if (stat.length) {
      kids.push(h("h3", { text: "Not live yet" }));
      kids.push(h("ul", null, ...stat.map((x) => h("li", { text: `${x.label}: ${x.note}` }))));
    }
    kids.push(h("p", { class: "note", text: "Credits: " + [...new Set(sum.rows.map((r) => r.feed.credit))].join("; ") + "." }));
    openSheet("status", ...kids);
  }

  function openAbout() {
    const m = D.meta;
    const st = actions.liveStatus ? actions.liveStatus() : { used: {}, manifest: null };
    const liveUsed = Object.keys(st.used || {}).length > 0;
    openSheet("about", h("h2", { text: "About this prototype" }),
      h("p", { text: liveUsed
        ? `Live data: orbits fetched ${fmtUtc(new Date(m.taken))}, and the other feeds refresh while the page is open. ${ctx.clock.state.simulated ? "The clock runs forward from that time, because the data is more than 36 hours old." : "The clock is real time, and satellite positions are computed on your device."}`
        : `Data snapshot: ${fmtUtc(new Date(m.taken))}. ${ctx.clock.state.simulated ? "The clock runs forward from the snapshot, because it is more than 36 hours old." : "The clock is real time, and satellite positions are computed on your device."}` }),
      h("div", { class: "actions" }, btn("Data status", "link", () => openStatus(), "small")),
      h("h3", { text: "Where the data comes from" }),
      h("ul", null,
        h("li", { text: "Satellites and orbits: CelesTrak (GP data and the satellite catalogue)." }),
        h("li", { text: "Earthquakes, shaking maps, PAGER: USGS. Hazards: GDACS." }),
        h("li", { text: "Aurora and Kp: NOAA Space Weather Prediction Center. Clouds: NASA GIBS imagery from 3 Oct 2026, so the cloud layer is a day old and has visible swath seams." }),
        h("li", { text: "Aircraft and routes: adsb.lol. Airlines: OpenFlights. Cloud forecasts: MET Norway. Stars: Hipparcos-based catalogue. Earth imagery: NASA Blue Marble." }),
        h("li", { text: "Storms: NOAA National Hurricane Center. Fires: NASA FIRMS (LANCE). Solar wind and geomagnetic alerts: NOAA Space Weather Prediction Center. " + PLACES_CREDIT + "." }),
        h("li", { text: "Rocket launches: The Space Devs (Launch Library 2). Asteroid close approaches: NASA/JPL CNEOS. Star names and constellations: IAU." }),
        h("li", { text: "Star distances, spectral types and luminosities: HYG database v4.4 (astronexus), CC BY-SA 4.0. This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program." })),
      // the content site adds a text section below the app (site/home-text.mjs); this link closes the sheet and the anchor scrolls to it
      ...($("about-home") ? [h("p", { class: "overview" }, h("a", { href: "#about-home", onclick: () => closeSheet(), text: "What is this site? Read the overview" }))] : []),
      ...(SITE_PAGES ? [
        h("h3", { text: "Guides and reference" }),
        h("p", { class: "note", text: "Plain pages that sit beside this app: sky reference for 2026 and 2027, the constellations and named stars, and guides to the data on these screens." }),
        ...[...new Set(GUIDE_LINKS.map((l) => l.group))].map((g) => h("div", { class: "guidelinks" },
          h("b", { class: "s", text: g }),
          h("ul", null, ...GUIDE_LINKS.filter((l) => l.group === g).map((l) => h("li", null, h("a", { href: l.href, text: l.label }))))))] : []),
      h("h3", { text: "Data health" }),
      h("p", { text: `${num(m.health.recordsRead)} element sets read, ${num(m.health.kept)} kept. Duplicates dropped: ${m.health.duplicatesDropped}. Rejected as invalid: ${Object.values(m.health.invalidDropped).reduce((a, b) => a + b, 0)}. At the snapshot the median element set was ${m.health.ageHours.median} hours old and 90% were under ${m.health.ageHours.p90} hours. ${num(m.health.staleOver3d)} objects had data over 3 days old and ${num(m.health.staleOver7d)} over 7 days (each satellite card shows its own data age). Exact SGP4 orbits are used for ${m.preciseCount} objects: the stations, the brightest objects and everything launched in the last 30 days.` }),
      h("h3", { text: "Honest limits" }),
      h("ul", null,
        h("li", { text: "Satellite positions in the globe swarm use a fast simplified orbit model, accurate to tens or a few hundred kilometres. Pass times and Starlink strings use exact SGP4 orbits where available, good to about a minute." }),
        h("li", { text: "Seismic waves use constant speeds along straight lines. It is a teaching model, not a travel-time table." }),
        h("li", { text: "3D models of aircraft and satellites are generic and not to scale. The Moon is enlarged." }),
        h("li", { text: "Sky glow is estimated from NASA night-light imagery, not measured." }),
        h("li", { text: "Phone-sensor look-around has not been tested on a real phone in this preview." })));
  }

  const watch = createWatch(ctx, { openSheet, closeSheet, tag, btn, link });

  return { openNear: watch.openNear, openWatch: watch.openWatch, connectionList: watch.connectionList, replayControls, toast, openSheet, closeSheet, renderCard, tickLive, openSearch, closeSearch, openPlaces, openFeed, openAbout, openStatus, openAsteroids, openLaunches, openConstellations, openCalendar, openTonight, openTrains, openShare, buildSearchIndex, runSearch };
}
