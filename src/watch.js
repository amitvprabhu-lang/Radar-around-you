// The "Around you" and "Storms, fire and aurora" screens. Plain DOM and SVG on top of the pure logic in connect.js and scales.js.
// Every number on these screens comes from a live feed or an official scale, and each block says where it is from and as of when.
import { h, fmtUtc, num, kmText, ageText, latLonText } from "./dom.js";
import { connections, spaceSituation, stormsNear, firesNear, topFireClusters, CONE_NOTE, NEAR } from "./connect.js";
import { GEOMAGNETIC_SCALE, GEOMAGNETIC_SOURCE, gLevelForKp, scaleFor, SAFFIR_SIMPSON, SSHWS_NOTE, SSHWS_SOURCE, categoryForKnots } from "./scales.js";
import { compassPoint, haversineKm } from "./core.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

// ------------------------------------------------------------------ pure helpers (tested)
// SVG path for one field of a series of { t, ... } points, scaled into a w by h box between min and max. Missing values break the line.
export function seriesPath(points, field, w, hgt, min, max) {
  if (!points || !points.length || !(max > min)) return "";
  const t0 = Date.parse(points[0].t), t1 = Date.parse(points[points.length - 1].t);
  const span = Math.max(1, t1 - t0);
  let d = "", pen = false;
  for (const p of points) {
    const v = p[field];
    if (v == null) { pen = false; continue; }
    const x = ((Date.parse(p.t) - t0) / span) * w;
    const y = hgt - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * hgt;
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

// Rounded y-range for a field, always including `include` (for example 0 for Bz) so the zero line is on the chart.
export function niceRange(points, field, include = null, pad = 0.1) {
  const xs = (points || []).map((p) => p[field]).filter((v) => v != null);
  if (!xs.length) return null;
  let lo = Math.min(...xs), hi = Math.max(...xs);
  if (include != null) { lo = Math.min(lo, include); hi = Math.max(hi, include); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const p = (hi - lo) * pad;
  return { min: lo - p, max: hi + p };
}

// Equirectangular map for a storm: every longitude is shifted to sit within 180 degrees of `centerLon`, so a storm that
// crosses the dateline is drawn continuously. Returns project(lon, lat) -> [x, y] in a w by h box, plus the box in degrees.
export function stormMapFrame(storm, w, hgt, padDeg = 3) {
  const shift = (lon) => { let d = lon - storm.lon; while (d > 180) d -= 360; while (d < -180) d += 360; return storm.lon + d; };
  const pts = [[storm.lon, storm.lat], ...(storm.track || []).map((p) => [shift(p.lon), p.lat]), ...(storm.cone || []).flat().map(([lo, la]) => [shift(lo), la])];
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lo, la] of pts) { minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); }
  minLon -= padDeg; maxLon += padDeg; minLat -= padDeg; maxLat += padDeg;
  const cos = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const degW = (maxLon - minLon) * cos, degH = maxLat - minLat;
  const scale = Math.min(w / degW, hgt / degH);
  const ox = (w - degW * scale) / 2, oy = (hgt - degH * scale) / 2;
  const project = (lon, lat) => [ox + (shift(lon) - minLon) * cos * scale, oy + (maxLat - lat) * scale];
  return { project, minLon, maxLon, minLat, maxLat, shift };
}

// Grid lines for a storm map: a step in degrees that gives about three to seven lines across the shorter side, and the
// line positions inside the frame's box. Longitudes are returned as drawn (they may pass 180) and `wrapLon` gives the label.
export function graticule(frame) {
  const spanLon = frame.maxLon - frame.minLon, spanLat = frame.maxLat - frame.minLat;
  const step = [1, 2, 5, 10, 15, 20, 30].find((st) => Math.min(spanLon, spanLat) / st <= 6) || 30;
  const range = (lo, hi) => { const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v); return out; };
  return { step, lons: range(frame.minLon, frame.maxLon), lats: range(frame.minLat, frame.maxLat) };
}
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const gratLabel = (v, pos, neg) => `${Math.abs(Math.round(v))}°${v >= 0 ? pos : neg}`;

// The `satellite` column of the FIRMS files: each code appears only in the file named for that satellite
export const FIRMS_SATELLITES = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21" };
export const plural = (n, one, many) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export const catColor = (kt, cls) => {
  const cat = cls === "HU" || cls === "TY" ? categoryForKnots(kt) : 0;
  return cat >= 3 ? "var(--alert)" : cat >= 1 ? "var(--ember)" : "var(--sky)";
};
// NHC prints miles per hour rounded to the nearest 5 (its KML gives 90 kt as 105 mph, 55 kt as 65 mph and 45 kt as 50 mph), so the same rounding is used here
export const mph = (kt) => Math.round((kt * 1.15078) / 5) * 5;

// ------------------------------------------------------------------ the screens
export function createWatch(ctx, ui) {
  const { D, S, actions } = ctx;
  const { openSheet, closeSheet, tag, btn, link } = ui;
  const nowMs = () => ctx.clock.now().getTime();
  const hz = () => D.hazards || { storms: null, fires: null, space: null };
  const place = () => S.place;
  const kpNow = () => { const rows = (D.meta && D.meta.kp) || []; const t = nowMs(); let best = null; for (const r of rows) if (Date.parse(r.t + "Z") <= t + 3600e3) best = r; return best; };
  const src = (name, asOf) => h("p", { class: "srcline", text: `Source: ${name}${asOf ? `, as of ${fmtUtc(new Date(asOf))}` : ""}.` });
  const absent = (what) => h("p", { class: "note warn", text: `${what} come from live feeds, and this copy of the app has no live connection, so there is nothing to show yet. Open Data status to see which feeds are connected.` });

  function connectionList(st) {
    return connections({ place: place(), nowMs: nowMs(), storms: st.storms, fires: st.fires, space: st.space, events: D.events, quakes: D.quakes.events, auroraChance: ctx.auroraChance() });
  }
  const severityClass = (s) => (s >= 3 ? "alert" : s === 2 ? "watch" : "info");

  // ---- Around you
  function openNear(tab) {
    const st = hz();
    const list = connectionList(st);
    const kids = [h("h2", { text: `Around ${place().name}` }), h("p", { text: list.length ? `${list.length} thing${list.length === 1 ? "" : "s"} from the live feeds ${list.length === 1 ? "is" : "are"} near ${place().name} right now, most serious first.` : `Nothing from the live feeds is near ${place().name} right now.` })];
    kids.push(h("p", { class: "note", text: "These are measurements and official forecasts that happen to be close in place and time. Nothing here says one event caused another, and nothing is predicted by this app itself." }));
    if (!st.storms && !st.fires && !st.space) kids.push(absent("Storm, fire and solar wind data"));
    if (list.length) {
      kids.push(h("div", { class: "list" }, ...list.map((c) => h("div", { class: `item near ${severityClass(c.severity)}` },
        h("div", { class: "grow" }, h("b", { text: c.title }), h("span", { class: "s", text: c.detail }),
          h("span", { class: "srcline", text: `${c.source}${c.asOf ? `, as of ${fmtUtc(new Date(c.asOf))}` : ""}` }),
          h("div", { class: "actions" }, c.kind === "storm" ? btn("Storm map", "link", () => openWatch("storms"), "small") : c.kind === "fire" ? btn("Fires", "link", () => openWatch("fires"), "small")
            : c.kind === "aurora" ? btn("Aurora", "link", () => openWatch("aurora"), "small") : c.url ? link("Open report", c.url, "link", "small") : null))))));
    }
    kids.push(h("div", { class: "actions" }, btn("Storms, fire and aurora", "link", () => openWatch("aurora"), "primary")));
    openSheet("near", ...kids);
  }

  // ---- the three-tab screen. The sheet is opened once; a tab swaps only the content under the tab strip, so switching
  // tabs does not replay the sheet's entrance animation.
  function openWatch(tab = "aurora") {
    const tabs = [["aurora", "Aurora", auroraBody], ["storms", "Storms", stormsBody], ["fires", "Fires", firesBody]];
    const content = h("div", { class: "watchbody" });
    const buttons = tabs.map(([id, label]) => h("button", { class: "chip glass", role: "tab", "data-tab": id, onclick: () => show(id) }, label));
    function show(id) {
      buttons.forEach((b, i) => { const on = tabs[i][0] === id; b.setAttribute("aria-selected", String(on)); b.setAttribute("aria-pressed", String(on)); });
      content.replaceChildren(...tabs.find((t) => t[0] === id)[2]());
      const body = content.closest(".body");
      if (body) body.scrollTop = 0;
      S.watchTab = id;
    }
    openSheet("watch", h("h2", { text: "Storms, fire and aurora" }), h("div", { class: "scroller", role: "tablist", style: { margin: "10px 0 6px", padding: 0 } }, ...buttons), content);
    show(tab);
  }

  // ---- aurora
  function auroraBody() {
    const st = hz(), kids = [];
    const kp = kpNow();
    const sit = spaceSituation(st.space, nowMs());
    const g = kp ? gLevelForKp(kp.kp) : 0;
    kids.push(h("div", { class: "kpbox" },
      h("div", { class: "kpnum" }, h("b", { text: kp ? kp.kp.toFixed(1) : "n/a" }), h("span", { text: "Kp now" })),
      h("div", { class: "grow" }, h("div", { class: "kpbar", "aria-hidden": "true" }, ...Array.from({ length: 9 }, (_, i) => h("i", { class: (kp && kp.kp >= i + 0.67 ? "on " : "") + (i >= 4 ? "g" : "") }))),
        h("p", { class: "kpnote", text: g ? `G${g}, ${scaleFor(g).name}: NOAA says ${scaleFor(g).aurora}.` : "Below storm level (NOAA's scale starts at Kp 5)." }))));
    const chance = ctx.auroraChance();
    kids.push(h("dl", { class: "facts" },
      h("div", null, h("dt", { text: `Aurora chance over ${place().name}` }), h("dd", { class: "mono", text: chance == null ? "Not available" : `${Math.round(chance)}%` })),
      h("div", null, h("dt", { text: "Kp expected (NOAA warning)" }), h("dd", { class: "mono", text: sit && sit.maxKpExpected ? `up to ${sit.maxKpExpected}` : "no warning in force" }))));
    kids.push(h("p", { class: "note", text: "The chance is NOAA's own aurora forecast, which looks 30 to 90 minutes ahead. It is a probability for the sky overhead, and cloud and city lights still matter." }));
    if (!st.space) { kids.push(absent("Solar wind and NOAA warnings")); return kids; }

    if (sit.warnings.length || sit.lastAlert) {
      kids.push(h("h3", { text: "What NOAA has issued" }));
      const rows = [];
      for (const w of sit.warnings) {
        const gl = gLevelForKp(w.kp);
        rows.push(h("div", { class: "item near watch" }, h("div", { class: "grow" }, h("b", { text: `Warning: Kp ${w.kp} expected${gl ? ` (G${gl}, ${scaleFor(gl).name})` : ""}` }),
          h("span", { class: "s", text: `In force from ${fmtUtc(new Date(w.from))} until ${fmtUtc(new Date(w.until))}.${w.impact ? " " + w.impact : ""}` }))));
      }
      if (sit.lastAlert) {
        const a = sit.lastAlert;
        rows.push(h("div", { class: "item near info" }, h("div", { class: "grow" }, h("b", { text: `Alert: Kp ${a.kp} reached` }), h("span", { class: "s", text: `Threshold reached ${fmtUtc(new Date(a.reached))}, ${ageText(nowMs() - Date.parse(a.reached))}.` }))));
      }
      kids.push(h("div", { class: "list" }, ...rows));
    } else kids.push(h("p", { class: "note", text: "NOAA has no geomagnetic warning in force and no Kp alert in the last 24 hours." }));

    kids.push(h("h3", { text: "Solar wind, last 6 hours" }));
    const fmt = (o, unit, d = 0) => (o ? `${o.value.toFixed(d)} ${unit}` : "n/a");
    kids.push(h("dl", { class: "facts" },
      h("div", null, h("dt", { text: "Speed" }), h("dd", { class: "mono", text: fmt(sit.speed, "km/s") })),
      h("div", null, h("dt", { text: "Density" }), h("dd", { class: "mono", text: fmt(sit.density, "per cm³", 1) })),
      h("div", null, h("dt", { text: "Magnetic field Bz" }), h("dd", { class: "mono", text: sit.bz ? `${sit.bz.value.toFixed(1)} nT, pointing ${sit.bz.value < 0 ? "south" : "north"}` : "n/a" })),
      h("div", null, h("dt", { text: "Total field Bt" }), h("dd", { class: "mono", text: fmt(sit.bt, "nT", 1) }))));
    kids.push(chart(st.space.points, "bz", "Bz (nT)", { include: 0, signed: true }), chart(st.space.points, "speed", "Speed (km/s)", {}));
    kids.push(h("p", { class: "note", text: "NOAA's aurora tutorial says that when the solar wind speeds up and its magnetic field turns southward (a negative Bz), geomagnetic activity increases and the aurora becomes brighter, more active, and moves further from the poles. It also says that satellite measurements of the wind give a forecast roughly 15 to 45 minutes ahead." }));
    kids.push(src(`NOAA Space Weather Prediction Center, spacecraft ${((st.space.spacecraft || []).join(", ")) || "unknown"}`, st.space.updated));

    kids.push(h("h3", { text: "NOAA's geomagnetic storm scale" }));
    kids.push(h("div", { class: "list" }, ...GEOMAGNETIC_SCALE.map((s) => h("div", { class: "item near info" + (g === s.g ? " here" : "") }, h("span", { class: "mag sat", text: `G${s.g}` }),
      h("div", { class: "grow" }, h("b", { text: `${s.name}, Kp ${s.kp}${s.g === 4 ? " (including 9-)" : ""}` }), h("span", { class: "s", text: `NOAA: ${s.aurora}${s.geomagLat ? ` (typically ${s.geomagLat}° geomagnetic latitude)` : ""}.` }))))));
    kids.push(src(GEOMAGNETIC_SOURCE + " (swpc.noaa.gov/noaa-scales-explanation)"));
    return kids;
  }

  function chart(points, field, label, { include = null, signed = false }) {
    const W = 320, H = 70;
    const pts = (points || []).filter((p) => p[field] != null);
    const r = niceRange(pts, field, include);
    if (!r || pts.length < 3) return h("p", { class: "note", text: `${label}: not enough data yet.` });
    const y0 = H - ((0 - r.min) / (r.max - r.min)) * H;
    const d = seriesPath(pts, field, W, H, r.min, r.max);
    const area = signed ? `${d} L${W} ${y0.toFixed(1)} L0 ${y0.toFixed(1)} Z` : null;
    return h("figure", { class: "wchart" }, h("figcaption", { text: `${label}, ${r.min.toFixed(0)} to ${r.max.toFixed(0)}` }),
      svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${label} over the last six hours`, preserveAspectRatio: "none" },
        include != null ? svg("line", { x1: 0, x2: W, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "zero" }) : null,
        area ? svg("path", { d: area, class: "fillneg", "clip-path": "none" }) : null,
        svg("path", { d, class: "line" })));
  }

  // ---- storms
  function stormsBody() {
    const st = hz(), kids = [];
    if (!st.storms) { kids.push(absent("Storm positions and forecasts")); }
    else if (!st.storms.storms.length) kids.push(h("p", { text: "NHC lists no active tropical cyclones in the Atlantic, eastern Pacific or central Pacific right now." }));
    if (st.storms) {
      for (const s of stormsNear(st.storms, place().lat, place().lon)) kids.push(stormCard(s));
      kids.push(src("NOAA National Hurricane Center (CurrentStorms.json and forecast files)", st.storms.generated));
    }
    const others = (D.events || []).filter((e) => e.type === "TC" && !(st.storms && st.storms.storms.some((s) => Math.abs(s.lat - e.lat) < 2 && Math.abs(((s.lon - e.lon + 540) % 360) - 180) < 2)));
    if (others.length) {
      kids.push(h("h3", { text: "Other cyclones, from GDACS" }));
      kids.push(h("p", { class: "note", text: "NHC covers the Atlantic and the eastern and central Pacific. These come from GDACS, which gives a position and one wind figure for the whole storm, so its strength right now can be lower. Check the forecast centre for your region." }));
      kids.push(h("div", { class: "list" }, ...others.map((e) => h("div", { class: "item near info" }, h("div", { class: "grow" }, h("b", { text: e.name }), h("span", { class: "s", text: `${latLonText(e.lat, e.lon)} · ${kmText(Math.round(haversineKm(place().lat, place().lon, e.lat, e.lon)))} from ${place().name}` }), e.url ? link("GDACS report", e.url, "link", "small") : null)))));
    }
    kids.push(h("h3", { text: "How hurricane strength is rated" }));
    kids.push(h("p", { class: "note", text: SSHWS_NOTE }));
    kids.push(h("div", { class: "list" }, ...SAFFIR_SIMPSON.map((c) => h("div", { class: "item near info" }, h("span", { class: "mag sat", text: String(c.cat) }),
      h("div", { class: "grow" }, h("b", { text: `Category ${c.cat}${c.major ? " (major)" : ""}` }), h("span", { class: "s", text: `${c.maxKt === Infinity ? `${c.minKt} knots or more` : `${c.minKt} to ${c.maxKt} knots`}, ${c.kmh} km/h sustained wind.` }))))));
    kids.push(src(SSHWS_SOURCE + " (nhc.noaa.gov/aboutsshws.php)"));
    return kids;
  }

  function stormCard(s) {
    const st = s.storm, cat = st.class === "HU" || st.class === "TY" ? categoryForKnots(st.windKt) : 0;
    const title = cat ? `${st.classText} ${st.name}, category ${cat}` : `${st.classText} ${st.name}`;
    const kids = [h("div", { class: "stormhead" }, h("div", { class: "grow" }, h("b", { text: title }), h("span", { class: "s", text: `${st.basin} · advisory ${st.advisory} issued ${fmtUtc(new Date(st.issued))}` })),
      tag(`${kmText(Math.round(s.km))} ${compassPoint(s.bearing)}`, s.inCone ? "warn" : ""))];
    kids.push(stormMap(st, s));
    kids.push(h("dl", { class: "facts" },
      h("div", null, h("dt", { text: "Maximum sustained wind" }), h("dd", { class: "mono", text: `${st.windKt} kt, ${st.windKmh} km/h, ${mph(st.windKt)} mph` })),
      h("div", null, h("dt", { text: "Central pressure" }), h("dd", { class: "mono", text: st.pressureMb ? `${st.pressureMb} mb` : "not reported" })),
      h("div", null, h("dt", { text: "Moving" }), h("dd", { class: "mono", text: st.moveKt != null ? `${compassPoint(st.moveDeg)} at ${st.moveKt} kt` : "not reported" })),
      h("div", null, h("dt", { text: "Position" }), h("dd", { class: "mono", text: latLonText(st.lat, st.lon) }))));
    if (st.track.length) {
      kids.push(h("p", { class: "note", text: "NHC's forecast of maximum wind at each point: " + st.track.map((p) => `${p.hours} h ${p.windKt} kt`).join(", ") + "." }));
      if (s.inCone) kids.push(h("p", { class: "note warn", text: `${place().name} is inside NHC's forecast cone.` }));
      kids.push(h("p", { class: "note", text: CONE_NOTE + " NHC marks its forecast track file as an experimental product." }));
    } else if (st.extras.length) kids.push(h("p", { class: "note warn", text: st.extras.join(" ") }));
    kids.push(h("div", { class: "actions" }, st.url ? link("NHC advisory and graphics", st.url, "link", "small") : null, btn("Show on the globe", "pin", () => { closeSheet(); actions.flyTo(st.lat, st.lon); }, "small")));
    return h("section", { class: "stormcard" }, ...kids);
  }

  function stormMap(st, s) {
    const W = 320, H = 190;
    const f = stormMapFrame(st, W, H);
    const root = svg("svg", { class: "stormmap", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Map of ${st.name}: its position, NHC's forecast track and cone of uncertainty` });
    root.append(svg("rect", { x: 0, y: 0, width: W, height: H, class: "sea" }));
    const grat = graticule(f);
    for (const lo of grat.lons) {
      const [x] = f.project(lo, f.minLat);
      root.append(svg("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: 0, y2: H, class: "grid" }), svg("text", { x: (x + 2).toFixed(1), y: H - 3, class: "glabel" }, gratLabel(wrapLon(lo), "E", "W")));
    }
    for (const la of grat.lats) {
      const [, y] = f.project(f.minLon, la);
      root.append(svg("line", { x1: 0, x2: W, y1: y.toFixed(1), y2: y.toFixed(1), class: "grid" }), svg("text", { x: 2, y: (y - 2).toFixed(1), class: "glabel" }, gratLabel(la, "N", "S")));
    }
    let land = "";
    for (const line of D.coast || []) {
      let pen = false;
      for (const [la, lo] of line) {
        const [x, y] = f.project(lo, la);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) { pen = false; continue; }
        land += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen = true;
      }
    }
    root.append(svg("path", { d: land, class: "coast" }));
    for (const ring of st.cone || []) {
      root.append(svg("path", { d: ring.map(([lo, la], i) => { const [x, y] = f.project(lo, la); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join("") + "Z", class: "cone" }));
    }
    const path = [[st.lon, st.lat], ...st.track.map((p) => [p.lon, p.lat])].map(([lo, la], i) => { const [x, y] = f.project(lo, la); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join("");
    if (st.track.length) root.append(svg("path", { d: path, class: "track" }));
    for (const p of st.track) {
      const [x, y] = f.project(p.lon, p.lat);
      root.append(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2, fill: catColor(p.windKt, st.class), class: "fpt" }), svg("text", { x: (x + 5).toFixed(1), y: (y - 5).toFixed(1), class: "flabel" }, `${p.hours}h`));
    }
    const [sx, sy] = f.project(st.lon, st.lat);
    root.append(svg("circle", { cx: sx.toFixed(1), cy: sy.toFixed(1), r: 6, fill: catColor(st.windKt, st.class), class: "now" }));
    const [px, py] = f.project(place().lon, place().lat);
    if (px > 0 && px < W && py > 0 && py < H) root.append(svg("circle", { cx: px.toFixed(1), cy: py.toFixed(1), r: 4, class: "you" }), svg("text", { x: (px + 6).toFixed(1), y: (py + 4).toFixed(1), class: "flabel you" }, place().name));
    return root;
  }

  // ---- fires
  function firesBody() {
    const st = hz(), kids = [];
    if (!st.fires) { kids.push(absent("Fire detections")); return kids; }
    const f = st.fires, s = f.summary || {};
    kids.push(h("dl", { class: "facts" },
      h("div", null, h("dt", { text: "Heat detections, last 24 h" }), h("dd", { class: "mono", text: num(s.detections || 0) })),
      h("div", null, h("dt", { text: "Newest detection" }), h("dd", { class: "mono", text: s.newest ? `${ageText(nowMs() - Date.parse(s.newest))}, ${fmtUtc(new Date(s.newest))}` : "n/a" })),
      h("div", null, h("dt", { text: "Satellites" }), h("dd", { class: "mono", text: Object.entries(s.bySatellite || {}).map(([k, v]) => `${FIRMS_SATELLITES[k] || k} ${num(v)}`).join(" · ") || "n/a" })),
      h("div", null, h("dt", { text: "Left out (low confidence)" }), h("dd", { class: "mono", text: num(s.lowConfidenceLeftOut || 0) }))));
    const rings = NEAR.fire.radiiKm.map((r) => ({ r, ...firesNear(f, place().lat, place().lon, r) }));
    kids.push(h("h3", { text: `Near ${place().name}` }));
    kids.push(h("div", { class: "list" }, ...rings.map((x) => h("div", { class: "item near " + (x.detections ? (x.r <= NEAR.fire.alertKm ? "alert" : "watch") : "info") }, h("span", { class: "mag sat", text: `${x.r}` }),
      h("div", { class: "grow" }, h("b", { text: x.detections ? `${plural(x.detections, "detection", "detections")} within ${x.r} km` : `None within ${x.r} km` }), h("span", { class: "s", text: x.detections ? `Combined fire radiative power about ${num(x.frpMw)} MW.` : x.nearestKm != null ? `The nearest is about ${num(x.nearestKm)} km away.` : "" }))))));
    kids.push(h("h3", { text: "Strongest clusters worldwide" }));
    kids.push(h("div", { class: "list" }, ...topFireClusters(f, 10, 150).map((c) => h("button", { class: "item", onclick: () => { closeSheet(); actions.flyTo(c.lat, c.lon); } },
      h("span", { class: "mag sat", text: (c.frpMw / 1000).toFixed(1) }),
      h("div", { class: "grow" }, h("b", { text: latLonText(c.lat, c.lon) }), h("span", { class: "s", text: `${plural(c.detections, "detection", "detections")}, about ${num(c.frpMw)} MW · ${kmText(Math.round(haversineKm(place().lat, place().lon, c.lat, c.lon)))} from ${place().name}` }))))));
    kids.push(h("p", { class: "note", text: "A detection is one heat signal seen by one satellite on one pass. It is not a confirmed wildfire, and the same fire seen on two passes counts twice. Detections are grouped in 0.25 degree cells (about 28 km), so counts near a boundary are approximate. The number on each cluster is its combined fire radiative power in gigawatts." }));
    kids.push(src("NASA FIRMS (LANCE), VIIRS 375 m, three satellites", s.newest));
    kids.push(h("p", { class: "note", text: "We acknowledge the use of data and/or imagery from NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance), part of NASA's Earth Science Data and Information System (ESDIS)." }));
    return kids;
  }

  return { openNear, openWatch, connectionList };
}
