// The five embeddable widget pages (/embed/<id>/index.html): one self-contained HTML file each, with inline style and script, that reads
// the site's own live folder (the files the home page strip and the live pages read) and draws an animated view on a canvas. The pure
// parts are in site/embed-models.mjs; the drawing and the page loop are below. Every function that runs in the page is copied into it
// by its source text (as site/home-strip.mjs does), so these may use only their own parameters, the browser and the other copied
// functions. Rules (docs/embed-sources.md): no request except the same-origin live files, no cookies or storage, no tracking, no fonts;
// a visible text summary, a text alternative with the numbers, and the source credit and one link back always visible at the bottom;
// prefers-reduced-motion and an out-of-date feed both stop the animation; a failed load shows a plain message.
import { transformSync } from "esbuild";
import { esc, SITE, href } from "./layout.mjs";
import { wTime, wFin, wPollDelay, wNum, wUtc, wAgo, wOptions, wLoad, quakeModel, quakeText, wG, kpModel, kpText, wCat, stormModel, stormText, fireModel, fireText, skyPos, skyNight, skyEvents, skyCloud, skyText } from "./embed-models.mjs";
import { MAX_AGE_HOURS } from "./hazard.mjs";
import { SKY_MAX_AGE_HOURS, SKY_CITY_IDS } from "./sky.mjs";

// ------------------------------------------------------------------ the coastline (build time only)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Douglas-Peucker on [lat, lon] points, tolerance in degrees
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], dx = b[1] - a[1], dy = b[0] - a[0], L = Math.hypot(dx, dy);
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], d = L === 0 ? Math.hypot(p[1] - a[1], p[0] - a[0]) : Math.abs(dy * (p[1] - a[1]) - dx * (p[0] - a[0])) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
// OURS: the widget maps draw the app's coastlines (public/coast.bin, Natural Earth 1:50m) simplified to 0.4 degrees, on a half degree
// grid, leaving out outlines smaller than 2 degrees across, so the outline costs about 6 KB per widget. Returns runs of [x, y] grid
// points (x = (lon + 180) * 2, y = (90 - lat) * 2), each broken where a line crosses the antimeridian.
export const COAST_EPS = 0.4, COAST_MIN_SPAN = 2;
export function coastRuns(coast) {
  const runs = [];
  for (const line of coast) {
    const segs = [];
    let cur = [];
    for (const p of line) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { segs.push(cur); cur = []; continue; }
      if (cur.length && Math.abs(p[1] - cur[cur.length - 1][1]) > 180) { segs.push(cur); cur = []; }
      cur.push(p);
    }
    segs.push(cur);
    for (const s of segs) {
      if (s.length < 2) continue;
      const lats = s.map((p) => p[0]), lons = s.map((p) => p[1]);
      if (Math.max(...lats) - Math.min(...lats) < COAST_MIN_SPAN && Math.max(...lons) - Math.min(...lons) < COAST_MIN_SPAN) continue;
      const r = simplify(s, COAST_EPS).map(([la, lo]) => [Math.round((lo + 180) * 2), Math.round((90 - la) * 2)]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
      if (r.length > 1) runs.push(r);
    }
  }
  return runs;
}
// Runs as text: per run an absolute start (two base64url digits each for x and y), then steps of dx and dy from -32 to 31 (one digit
// each, plus 32); longer steps are split. Runs are separated by "|". wCoastRuns decodes it in the page.
export function coastEncode(runs) {
  const d2 = (v) => B64[Math.floor(v / 64)] + B64[v % 64];
  return runs.map((r) => {
    let s = d2(r[0][0]) + d2(r[0][1]), [x, y] = r[0];
    for (const [nx, ny] of r.slice(1)) {
      while (x !== nx || y !== ny) {
        const sx = Math.max(-32, Math.min(31, nx - x)), sy = Math.max(-32, Math.min(31, ny - y));
        s += B64[sx + 32] + B64[sy + 32]; x += sx; y += sy;
      }
    }
    return s;
  }).join("|");
}

// ------------------------------------------------------------------ page functions (copied by source text)
// decodes coastEncode's text into flat [lon, lat, lon, lat, ...] arrays
export function wCoastRuns(s) {
  var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", out = [];
  s.split("|").forEach(function (r) {
    var v = function (i) { return A.indexOf(r.charAt(i)); };
    var x = v(0) * 64 + v(1), y = v(2) * 64 + v(3), pts = [x / 2 - 180, 90 - y / 2];
    for (var i = 4; i + 1 < r.length; i += 2) { x += v(i) - 32; y += v(i + 1) - 32; pts.push(x / 2 - 180, 90 - y / 2); }
    out.push(pts);
  });
  return out;
}
// The map: fits the box [west, south, east, north] (equirectangular; west and east may go past 180 degrees for a view across the date
// line) inside W by H, draws sea, a 30 degree grid and the coast once per size into a cached canvas, paints it and returns the projection
// { x(lon), y(lat), k (pixels per degree) }. wLatBox: the whole world from 58 south to 80 north, widened to take in every point of the
// data (lats: n latitudes), so nothing in the feed is ever left off the map.
export function wLatBox(lats, n) {
  var lo = -58, hi = 80;
  for (var i = 0; i < n; i++) { if (lats[i] < lo + 2) lo = Math.max(-90, lats[i] - 2); if (lats[i] > hi - 2) hi = Math.min(90, lats[i] + 2); }
  return [-180, lo, 180, hi];
}
export function wMap(ctx, W, H, box, f) {
  var k = Math.min(W / (box[2] - box[0]), H / (box[3] - box[1])), mw = k * (box[2] - box[0]), mh = k * (box[3] - box[1]);
  var ox = (W - mw) / 2, oy = (H - mh) / 2, c = f.col;
  var P = { k: k, x: function (lon) { return ox + (lon - box[0]) * k; }, y: function (lat) { return oy + (box[3] - lat) * k; }, w: mw, h: mh, ox: ox, oy: oy };
  var key = box.join(",") + W + "x" + H;
  if (f.cache.mapKey !== key) {
    var dpr = ctx.getTransform ? ctx.getTransform().a : 1, cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = c.sea; g.fillRect(ox, oy, mw, mh);
    g.save(); g.beginPath(); g.rect(ox, oy, mw, mh); g.clip();
    g.strokeStyle = c.grid; g.lineWidth = 1; g.beginPath();
    for (var lo = Math.ceil(box[0] / 30) * 30; lo <= box[2]; lo += 30) { g.moveTo(P.x(lo), oy); g.lineTo(P.x(lo), oy + mh); }
    for (var la = -60; la <= 60; la += 30) { g.moveTo(ox, P.y(la)); g.lineTo(ox + mw, P.y(la)); }
    g.stroke();
    if (!f.cache.runs) f.cache.runs = wCoastRuns(f.coast);
    g.strokeStyle = c.land; g.lineWidth = Math.max(0.7, Math.min(1.4, k / 3)); g.lineJoin = "round"; g.beginPath();
    [-360, 0, 360].forEach(function (o) {
      if (box[0] > 180 + o || box[2] < -180 + o) return;
      f.cache.runs.forEach(function (r) { g.moveTo(P.x(r[0] + o), P.y(r[1])); for (var i = 2; i < r.length; i += 2) g.lineTo(P.x(r[i] + o), P.y(r[i + 1])); });
    });
    g.stroke(); g.restore();
    f.cache.map = cv; f.cache.mapKey = key;
  }
  ctx.drawImage(f.cache.map, 0, 0, W, H);
  return P;
}
// earthquakes: a dot per quake sized by magnitude, the newest brightest; rings pulse out of each, larger and slower for larger quakes
export function drawQuakes(ctx, W, H, m, f) {
  ctx.clearRect(0, 0, W, H);
  if (!f.cache.box) f.cache.box = wLatBox(m.events.map(function (e) { return e.lat; }), m.events.length);
  var P = wMap(ctx, W, H, f.cache.box, f), c = f.col, ev = m.events, s = Math.max(0.6, Math.min(1.6, P.k / 1.6));
  for (var i = ev.length - 1; i >= 0; i--) {
    var e = ev[i], x = P.x(e.lon), y = P.y(e.lat), age = (m.t - e.t) / 36e5, r = s * (1.2 + Math.pow(1.55, e.mag - 2.5));
    var col = age < 1 ? c.alert : age < 6 ? c.signal : c.ion;
    if (!f.still) {
      var per = 1.6 + (e.mag - 2.5) * 0.5, ph = (f.t / per + i * 0.618) % 1, amp = age < 1 ? 1 : age < 6 ? 0.7 : 0.35;
      ctx.globalAlpha = (1 - ph) * 0.55 * amp; ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r + ph * r * (2 + e.mag / 3), 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = age < 6 ? 0.95 : 0.65; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (m.largest && W >= 360) {
    var L = m.largest, lx = P.x(L.lon), ly = P.y(L.lat), t = "M" + L.mag.toFixed(1);
    ctx.font = "600 12px system-ui,sans-serif"; ctx.fillStyle = c.text; ctx.textAlign = lx > W - 60 ? "right" : "left";
    ctx.fillText(t, lx + (lx > W - 60 ? -9 : 9), ly - 7);
  }
}
// the Kp gauge (0 to 9, NOAA's G levels from Kp 5 coloured) with a needle that sweeps to the value, and bars for the recent periods
export function drawKp(ctx, W, H, m, f) {
  ctx.clearRect(0, 0, W, H);
  var c = f.col, lev = [c.ion, c.signal, c.orange, c.alert, c.violet, c.magenta], side = W > H * 1.45, gw = side ? W * 0.55 : W, gh = side ? H : H * 0.66;
  // the arc of radius R above the pivot and two lines of text below it must fit the height: R + 1.5R + 10 for a large gauge, R + 36 for
  // a small one (the text has a minimum size)
  var R = Math.max(18, Math.min((gw / 2 - 8) / 1.09, (gh - 10) / 1.58, (gh - 42) / 1.09)), tx = Math.max(13, R * 0.27) * 1.05 + Math.max(13, R * 0.2) + 4;
  var cx = gw / 2, cy = Math.max(R * 1.09 + 2, (gh - R * 1.09 - tx) / 2 + R * 1.09), A = function (v) { return Math.PI + (v / 9) * Math.PI; };
  var e = f.still ? 1 : Math.min(1, f.t / 1.8), v = m.kp * (1 - Math.pow(1 - e, 3));
  if (!f.still) {
    var glow = 0.08 + m.kp / 9 * 0.35;
    for (var b = 0; b < 3; b++) {
      ctx.globalAlpha = glow * (0.6 + 0.4 * Math.sin(f.t * 0.7 + b * 2)); ctx.strokeStyle = b === 1 ? c.violet : c.ion; ctx.lineWidth = R * 0.1;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.12 + b * 0.08) + 3 * Math.sin(f.t * 0.9 + b), Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = Math.max(6, R * 0.16); ctx.lineCap = "butt";
  for (var k = 0; k < 9; k++) { ctx.strokeStyle = k < 5 ? c.track : lev[k - 4]; ctx.beginPath(); ctx.arc(cx, cy, R, A(k) + 0.01, A(k + 1) - 0.01); ctx.stroke(); }
  ctx.strokeStyle = lev[Math.max(0, wG(v))]; ctx.beginPath(); ctx.arc(cx, cy, R, A(0), A(v)); ctx.stroke();
  ctx.fillStyle = c.muted; ctx.font = Math.max(9, R * 0.13) + "px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (var n = 0; n <= 9; n += 3) ctx.fillText(String(n), cx + Math.cos(A(n)) * R * 0.74, cy + Math.sin(A(n)) * R * 0.74);
  ctx.strokeStyle = c.text; ctx.lineWidth = Math.max(2, R * 0.035); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(A(v)) * R * 0.86, cy + Math.sin(A(v)) * R * 0.86); ctx.stroke();
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, R * 0.06), 0, 6.2832); ctx.fill();
  var big = Math.max(13, R * 0.27);
  ctx.font = "700 " + big + "px system-ui,sans-serif"; ctx.textBaseline = "alphabetic";
  ctx.fillText("Kp " + wNum(m.kp, 2), cx, cy + big + Math.max(3, R * 0.06));
  ctx.font = Math.max(10, R * 0.13) + "px system-ui,sans-serif"; ctx.fillStyle = m.g ? lev[m.g] : c.muted;
  ctx.fillText(m.g ? "G" + m.g + " storm level" : "below storm level", cx, cy + big * 1.05 + Math.max(13, R * 0.2));
  var x0 = side ? gw + 8 : 10, x1 = W - 6, y1 = H - 16, y0 = side ? H * 0.22 : gh + 14, bw = (x1 - x0) / m.series.length;
  if (y1 - y0 < 16) return;
  ctx.fillStyle = c.muted; ctx.font = "10px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.fillText("last " + wNum(m.hours) + " h", x0, y1 + 12);
  ctx.textAlign = "right"; ctx.fillText("now", x1, y1 + 12);
  var g1 = y1 - (y1 - y0) * 5 / 9;
  ctx.strokeStyle = c.signal; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, g1); ctx.lineTo(x1, g1); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1; ctx.fillStyle = c.signal; ctx.textAlign = "left"; ctx.fillText("G1", x0, g1 - 3);
  for (var i = 0; i < m.series.length; i++) {
    var s = m.series[i], hh = Math.max(1, (y1 - y0) * s.kp / 9), g = wG(s.kp);
    ctx.fillStyle = g ? lev[g] : c.ion; ctx.globalAlpha = i === m.series.length - 1 ? 1 : 0.55;
    ctx.fillRect(x0 + i * bw + 1, y1 - hh, Math.max(1, bw - 2), hh);
  }
  ctx.globalAlpha = 1;
}
// storms: the map around the active storms, each a turning spiral (anticlockwise in the north, clockwise in the south, faster for
// stronger winds) with NHC's forecast track, which a dot travels along
export function drawStorms(ctx, W, H, m, f) {
  ctx.clearRect(0, 0, W, H);
  var c = f.col, box = [-180, 0, -10, 55], st = m.storms, ref = st.length ? st[0].lon : 0;
  // longitudes are taken within 180 degrees of the strongest storm, so a track across the date line stays in one piece
  var U = function (lon) { return lon - 360 * Math.round((lon - ref) / 360); };
  if (st.length) {
    var w = 999, s = 90, e = -999, n = -90;
    st.forEach(function (x) { [x].concat(x.track).forEach(function (p) { w = Math.min(w, U(p.lon)); e = Math.max(e, U(p.lon)); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }); });
    var cx = (w + e) / 2, cy = (s + n) / 2, hw = Math.max((e - w) / 2 + 14, 30), hh = Math.max((n - s) / 2 + 10, 15), asp = W / Math.max(1, H);
    if (hw / hh < asp) hw = hh * asp; else hh = hw / asp;
    hw = Math.min(hw, 180); hh = Math.min(hh, 85);
    cy = Math.max(-85 + hh, Math.min(85 - hh, cy));
    box = [cx - hw, cy - hh, cx + hw, cy + hh];
  }
  var P = wMap(ctx, W, H, box, f);
  if (!st.length) { ctx.fillStyle = c.muted; ctx.font = "600 13px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText("No active storms in NHC's list", W / 2, H / 2); return; }
  ctx.save(); ctx.beginPath(); ctx.rect(P.ox, P.oy, P.w, P.h); ctx.clip();
  st.forEach(function (x, i) {
    var pts = [[U(x.lon), x.lat]].concat(x.track.map(function (p) { return [U(p.lon), p.lat]; })), sz = Math.max(6, Math.min(16, 6 + x.cat * 2)), col = x.cat ? c.alert : c.signal;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
    pts.forEach(function (p, j) { if (j) ctx.lineTo(P.x(p[0]), P.y(p[1])); else ctx.moveTo(P.x(p[0]), P.y(p[1])); });
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    pts.slice(1).forEach(function (p) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P.x(p[0]), P.y(p[1]), 2.2, 0, 6.2832); ctx.fill(); });
    if (!f.still && pts.length > 1) {
      var u = ((f.t / 5 + i * 0.3) % 1) * (pts.length - 1), j = Math.floor(u), q = u - j, a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(P.x(a[0] + (b[0] - a[0]) * q), P.y(a[1] + (b[1] - a[1]) * q), 2.6, 0, 6.2832); ctx.fill();
    }
    var X = P.x(U(x.lon)), Y = P.y(x.lat), rot = f.still ? 0 : (x.lat >= 0 ? -1 : 1) * f.t * (0.6 + x.kt / 60);
    ctx.save(); ctx.translate(X, Y); ctx.rotate(rot); ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = "round";
    for (var arm = 0; arm < 2; arm++) {
      ctx.beginPath();
      for (var t = 0; t <= 1.001; t += 0.1) { var ang = arm * Math.PI + t * 2.6 * (x.lat >= 0 ? 1 : -1), rr = sz * (0.25 + t * 0.85); ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
      ctx.stroke();
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, sz * 0.28, 0, 6.2832); ctx.fill(); ctx.restore();
    if (W < 360 && i > 0) return;
    // the name above the spiral (tracks mostly run sideways), kept inside the map
    var lab = x.name + (x.cat ? " (Cat " + x.cat + ")" : "");
    ctx.font = "600 " + (W < 360 ? 11 : 12) + "px system-ui,sans-serif"; ctx.textAlign = "center";
    var lw = ctx.measureText(lab).width / 2, lx = Math.max(P.ox + lw + 2, Math.min(P.ox + P.w - lw - 2, X)), ly = Y - sz - 5 < P.oy + 12 ? Y + sz + 14 : Y - sz - 5;
    ctx.fillStyle = c.text; ctx.fillText(lab, lx, ly);
  });
  ctx.restore();
}
// fires: a heat dot per quarter-degree cell, brighter and yellower where there are more detections, drawn once per size; a soft band
// sweeps west to east over the map, the way a satellite's pass crosses the ground
export function drawFires(ctx, W, H, m, f) {
  ctx.clearRect(0, 0, W, H);
  if (!f.cache.box) f.cache.box = wLatBox(m.lat, m.cells);
  var P = wMap(ctx, W, H, f.cache.box, f), key = W + "x" + H, light = f.col.heat === "light";
  if (f.cache.heatKey !== key) {
    var dpr = ctx.getTransform ? ctx.getTransform().a : 1, cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    var g = cv.getContext("2d"), lm = Math.log(m.max + 1), d = Math.max(0.8, P.k * 0.35);
    // ten shades from few to many detections, each cell drawn in its shade (few colour changes); on a light map darker reds without
    // adding light, on a dark one glowing oranges and yellows
    var shade = function (b) { var q = b / 9; return light ? "rgba(" + Math.round(235 - 60 * q) + "," + Math.round(120 - 110 * q) + ",0," + (0.45 + 0.5 * q).toFixed(2) + ")" : "rgba(255," + Math.round(60 + 170 * q) + "," + Math.round(30 * q) + "," + (0.35 + 0.5 * q).toFixed(2) + ")"; };
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = light ? "source-over" : "lighter";
    var bk = new Uint8Array(m.cells);
    for (var i = 0; i < m.cells; i++) bk[i] = Math.min(9, Math.floor(Math.log(m.cnt[i] + 1) / lm * 10));
    for (var b = 0; b < 10; b++) {
      g.fillStyle = shade(b);
      var r = d * (0.8 + (b + 0.5) / 10 * 1.4);
      for (i = 0; i < m.cells; i++) if (bk[i] === b) g.fillRect(P.x(m.lon[i]) - r / 2, P.y(m.lat[i]) - r / 2, r, r);
    }
    f.cache.heat = cv; f.cache.heatKey = key;
  }
  ctx.drawImage(f.cache.heat, 0, 0, W, H);
  if (f.still) return;
  var bx = P.ox + ((f.t / 7) % 1) * (P.w + 80) - 40, grd = ctx.createLinearGradient(bx - 40, 0, bx + 40, 0);
  grd.addColorStop(0, "rgba(255,200,80,0)"); grd.addColorStop(0.5, "rgba(255,200,80,0.08)"); grd.addColorStop(1, "rgba(255,200,80,0)");
  ctx.fillStyle = grd; ctx.fillRect(Math.max(P.ox, bx - 40), P.oy, 80, P.h);
  ctx.save(); ctx.beginPath(); ctx.rect(bx - 30, P.oy, 60, P.h); ctx.clip(); ctx.globalAlpha = light ? 0.5 : 0.8; ctx.globalCompositeOperation = light ? "source-over" : "lighter";
  ctx.drawImage(f.cache.heat, 0, 0, W, H); ctx.restore();
}
// tonight's sky: a polar chart (zenith in the middle, north up, east on the left, as projectSky in src/core.js), the paths of the Moon
// and planets over the night, and the bodies at the moment shown, which runs through the night in a loop (or stays at now, or the middle
// of the night, without motion); below it MET Norway's hourly cloud for the night with the same moment marked
export function drawSky(ctx, W, H, m, f) {
  ctx.clearRect(0, 0, W, H);
  var c = f.col, n = m.night, side = W > H * 1.4, sh = side ? 0 : Math.max(34, H * 0.24), R = Math.max(20, Math.min((side ? W * 0.55 : W) / 2, (H - sh) / 2 - 2) / 1.16);
  // a small chart beside the strip gets a column on its left for the time, so the label never sits on the disc
  var col = side && R < 70 ? 38 : 0, cx = side ? R * 1.16 + 2 + col : W / 2, cy = (H - sh) / 2, L = n.end - n.start;
  var at = f.still ? (f.now >= n.start && f.now <= n.end ? f.now : n.start + L / 2) : n.start + ((f.t / 20) % 1) * L;
  var pr = function (alt, az) { var r = R * (90 - alt) / 90, a = az * Math.PI / 180; return [cx - r * Math.sin(a), cy - r * Math.cos(a)]; };
  var p = skyPos(at, m.city.lat, m.city.lon), sa = p.Sun.alt, dark = Math.max(0, Math.min(1, (-sa - 0) / 12));
  var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  grd.addColorStop(0, dark > 0.6 ? c.night : c.dusk); grd.addColorStop(1, dark > 0.3 ? c.dusk : c.day);
  ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = "rgba(200,215,255,.16)"; ctx.lineWidth = 1;
  [30, 60].forEach(function (a) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - a) / 90, 0, 6.2832); ctx.stroke(); });
  ctx.strokeStyle = c.land; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = c.muted; ctx.font = "600 11px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (d) { var q = pr(-9, d[1]); ctx.fillText(d[0], q[0], q[1]); });
  var names = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"], pc = { Moon: "#eef2ff", Mercury: "#b8c2dc", Venus: "#ffd166", Mars: "#ff7b6b", Jupiter: "#ffae5c", Saturn: "#8fc4ff" }, ink = "#e8eeff";
  ctx.lineWidth = 1.2;
  names.forEach(function (b) {
    ctx.strokeStyle = pc[b]; ctx.globalAlpha = 0.4; ctx.beginPath(); var on = false;
    n.samples.forEach(function (s) { var q = s.p[b]; if (q.alt > 0) { var xy = pr(q.alt, q.az); if (on) ctx.lineTo(xy[0], xy[1]); else ctx.moveTo(xy[0], xy[1]); on = true; } else on = false; });
    ctx.stroke();
  });
  ctx.globalAlpha = 1; ctx.textBaseline = "alphabetic"; ctx.font = "11px system-ui,sans-serif";
  var placed = [];
  names.forEach(function (b) {
    var q = p[b]; if (q.alt <= 0) return;
    var xy = pr(q.alt, q.az), r = b === "Moon" ? Math.max(5, R * 0.06) : 3;
    if (b === "Moon") {
      var sp = pr(sa, p.Sun.az), k = q.lit;
      ctx.save(); ctx.translate(xy[0], xy[1]); ctx.rotate(Math.atan2(sp[1] - xy[1], sp[0] - xy[0]));
      ctx.fillStyle = c.moonDark; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
      ctx.fillStyle = pc.Moon; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
      ctx.ellipse(0, 0, Math.abs(1 - 2 * k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
      ctx.fill(); ctx.restore();
    } else { ctx.fillStyle = pc[b]; ctx.beginPath(); ctx.arc(xy[0], xy[1], r, 0, 6.2832); ctx.fill(); }
    if (R > 55 || b === "Moon") {
      // a label that would overlap one already placed moves down one line, or is left out
      var t = R > 55 ? b : b.charAt(0), tw = ctx.measureText(t).width, left = xy[0] < cx, lx = left ? xy[0] + r + 3 : xy[0] - r - 3 - tw;
      for (var k2 = 0; k2 < 2; k2++) {
        var ly = xy[1] + 4 + k2 * 12, hit = placed.some(function (q) { return lx < q[0] + q[2] && lx + tw > q[0] && ly - 10 < q[1] && ly > q[1] - 10; });
        if (!hit) { placed.push([lx, ly, tw]); ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.fillText(t, lx, ly); break; }
      }
    }
  });
  ctx.fillStyle = c.text; ctx.font = "600 12px system-ui,sans-serif"; ctx.textAlign = "left";
  ctx.fillText(f.fmt(at), 2, 12);
  if (sa > -6) { ctx.fillStyle = c.muted; ctx.font = "10px system-ui,sans-serif"; ctx.fillText(sa > -0.833 ? "Sun up" : "twilight", 2, 25); }
  var x0 = side ? cx + R * 1.16 + 20 : 4, x1 = W - 4, y0 = side ? H * 0.18 : H - sh + 6, y1 = side ? H * 0.8 : H - 13;
  ctx.font = "10px system-ui,sans-serif"; ctx.fillStyle = c.muted; ctx.textAlign = "left";
  if (!m.cloud || m.cloud.stale || !m.cloud.hours.length) {
    var why = m.state === "failed" ? ["Cloud forecast could not be loaded", "Cloud: not loaded"] : m.state === "missing" ? ["No cloud forecast in the live data", "Cloud: no data"] : m.cloud && m.cloud.stale ? ["Cloud forecast out of date", "Cloud: out of date"] : ["No cloud forecast for tonight", "Cloud: none tonight"];
    ctx.fillText(ctx.measureText(why[0]).width <= x1 - x0 ? why[0] : why[1], x0, (y0 + y1) / 2 + 4); return;
  }
  var X = function (t) { return x0 + (Math.max(n.start, Math.min(n.end, t)) - n.start) / L * (x1 - x0); };
  ctx.fillText("Cloud, MET Norway", x0, y0 + 2);
  m.cloud.hours.forEach(function (h) {
    var a = X(h.t), b = X(h.t + 36e5); if (b - a < 0.5) return;
    ctx.fillStyle = c.grid; ctx.fillRect(a + 0.5, y0 + 6, b - a - 1, y1 - y0 - 6);
    ctx.fillStyle = c.cloud; var hh = (y1 - y0 - 6) * h.cloud / 100; ctx.fillRect(a + 0.5, y1 - hh, b - a - 1, hh);
  });
  ctx.fillStyle = c.muted; ctx.fillText(f.fmt(n.start), x0, y1 + 11); ctx.textAlign = "right"; ctx.fillText(f.fmt(n.end), x1, y1 + 11);
  ctx.strokeStyle = c.ion; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(at), y0 + 4); ctx.lineTo(X(at), y1 + 2); ctx.stroke();
}
// The page loop: options, theme, sizes, loading and polling, the summary and text alternative, the out-of-date and failed states, and
// the animation (about 30 frames a second, only while visible, never with reduced motion or out-of-date data). Polling (wPollDelay): one
// look at the manifest at a time, each request given up after 20 s, the next one after the manifest's pollSec (at least 300 s) and
// later after failures; while the page is hidden or the frame is scrolled out of view nothing is fetched, and one look follows when it is
// seen again. An unchanged feed version is not downloaded again; the sky widget then works its night out again from the data it has.
// No live region: the text changes every minute ("12 minutes ago") and must not be read out each time on someone else's page.
export function wRun(cfg) {
  var D = document, $ = function (id) { return D.getElementById(id); }, root = $("w"), cv = $("cv"), vis = $("vis"), msg = $("msg"), stale = $("stale"), list = $("list");
  var opt = wOptions(location.search, cfg.cities), mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (opt.theme !== "auto") D.documentElement.setAttribute("data-theme", opt.theme);
  if (cfg.start) cfg.start(opt);
  var model = null, seen = true, raf = 0, t0 = performance.now(), last = 0, W = 0, H = 0, dpr = 1, cache = {}, ver = null, lastR = null;
  var busy = false, seq = 0, fails = 0, timer = 0, due = false, pollSec = cfg.C.pollSec;
  var still = function () { return !!(mq && mq.matches) || !model || model.stale; };
  var colors = function () { var cs = getComputedStyle(D.documentElement), o = {}; cfg.colors.forEach(function (k) { o[k] = cs.getPropertyValue("--" + k).trim(); }); return o; };
  var put = function (id, s) { var el = $(id); if (el.textContent !== s) el.textContent = s; };
  var draw = function () {
    if (!model || !W || !H) return;
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!cache.col) cache.col = colors();
    cfg.draw(ctx, W, H, model, { t: (performance.now() - t0) / 1000, still: still(), col: cache.col, cache: cache, coast: cfg.coast, now: Date.now(), fmt: cfg.fmt });
  };
  var loop = function (ts) { raf = 0; if (still() || !seen) return; if (ts - last > 32) { last = ts; draw(); } raf = requestAnimationFrame(loop); };
  var kick = function () { draw(); if (!raf && !still() && seen) raf = requestAnimationFrame(loop); };
  var size = function () { var r = vis.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); cache = { runs: cache.runs }; kick(); };
  var show = function () {
    var now = Date.now();
    if (cfg.C.maxHours) model.stale = now - model.t > cfg.C.maxHours * 36e5;
    var tx = cfg.text(model, now, cfg.C, opt);
    put("sum-s", tx.short || tx.sum); put("sum-f", tx.sum); vis.setAttribute("aria-label", tx.alt);
    put("when-l", tx.whenLabel != null ? tx.whenLabel : "Data of "); put("when-v", tx.when || wUtc(model.t));
    var items = (tx.list || []).join("\n");
    if (list.getAttribute("data-t") !== items) { list.setAttribute("data-t", items); list.textContent = ""; (tx.list || []).forEach(function (s) { var li = D.createElement("li"); li.textContent = s; list.appendChild(li); }); }
    stale.hidden = !model.stale;
    if (model.stale) put("stale-s", "Out of date: data of " + wUtc(model.t) + ", " + wAgo(model.t, now) + ".");
    root.setAttribute("data-state", model.stale ? "stale" : "ok"); msg.hidden = true;
    kick();
  };
  // a new model is kept only if its words can be made; otherwise the previous one stays (or the failed state shows)
  var apply = function (m) {
    var old = model, oc = cache;
    model = m; cache = { runs: cache.runs };
    try { show(); } catch (e) { model = old; cache = oc; if (model) show(); else fail(); }
  };
  var fail = function () {
    if (model) return;
    root.setAttribute("data-state", "failed"); msg.hidden = false; msg.textContent = "Live data could not be loaded right now. The widget tries again later.";
    put("sum-s", ""); put("sum-f", ""); put("when-l", ""); put("when-v", ""); vis.setAttribute("aria-label", "Live data could not be loaded right now.");
  };
  var get = function (u, kind, fresh) {
    var ac = window.AbortController ? new AbortController() : null, to = ac ? setTimeout(function () { ac.abort(); }, 20000) : 0;
    return fetch(u, { cache: fresh ? "no-store" : "default", credentials: "omit", signal: ac ? ac.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return kind === "bin" ? r.arrayBuffer() : r.json(); })
      .then(function (d) { clearTimeout(to); return d; }, function (e) { clearTimeout(to); throw e; });
  };
  var visible = function () { return !D.hidden && seen; };
  var schedule = function () { clearTimeout(timer); timer = setTimeout(function () { if (visible()) load(); else due = true; }, wPollDelay(pollSec, fails)); };
  var wake = function () { if (due && visible()) { due = false; load(); } };
  var load = function () {
    if (busy) return;
    busy = true;
    var my = ++seq;
    wLoad(cfg.base, get, cfg.need, model && ver != null ? ver : null).then(function (r) {
      if (my !== seq) return;
      fails = 0;
      if (wFin(r.manifest.pollSec, 1, 1e6)) pollSec = r.manifest.pollSec;
      if (r.same) { if (cfg.renew) apply(cfg.model(lastR, Date.now(), cfg.C, opt)); else show(); return; }
      if (r.missing.length && !cfg.optional) throw new Error("missing " + r.missing.join(","));
      var m = cfg.model(r, Date.now(), cfg.C, opt);
      ver = r.version; lastR = r; apply(m);
    }).catch(function () {
      if (my !== seq) return;
      fails++;
      if (cfg.optional) { try { apply(cfg.model(lastR, Date.now(), cfg.C, opt)); return; } catch (e) {} }
      fail();
    }).then(function () { busy = false; schedule(); });
  };
  if (window.ResizeObserver) new ResizeObserver(size).observe(vis); else window.addEventListener("resize", size);
  if (window.IntersectionObserver) new IntersectionObserver(function (es) { seen = es[es.length - 1].isIntersecting; if (seen) { kick(); wake(); } }).observe(root);
  D.addEventListener("visibilitychange", wake);
  if (mq && mq.addEventListener) mq.addEventListener("change", kick);
  if (window.matchMedia) { var cs = matchMedia("(prefers-color-scheme: dark)"); if (cs.addEventListener) cs.addEventListener("change", function () { cache = { runs: cache.runs }; kick(); }); }
  size(); load();
  setInterval(function () { if (model && !D.hidden) show(); }, 60000);
}

// ------------------------------------------------------------------ the widgets (build time)
// OURS: the colours, named as CSS custom properties, in the dark and light themes (the site's own palette for dark).
const THEMES = {
  dark: { heat: "dark", bg: "#04060c", text: "#eaf0ff", muted: "#9aa7c7", line: "rgba(160,185,255,.18)", link: "#62e6c3", sea: "#0a1222", grid: "rgba(160,185,255,.10)", land: "#4f6385", ion: "#62e6c3", signal: "#ffd166", orange: "#ff9f43", alert: "#ff6b7a", violet: "#b48cff", magenta: "#ff5fd2", sky: "#6fb4ff", track: "rgba(160,185,255,.16)", warn: "#ffd166", warnbg: "rgba(255,209,102,.12)", night: "#060b18", dusk: "#16244a", day: "#3b5d9a", moonDark: "#2a3248", cloud: "#9fb2d6" },
  light: { heat: "light", bg: "#f6f8fc", text: "#0d1526", muted: "#4b5873", line: "rgba(20,40,90,.14)", link: "#0a7d64", sea: "#e3ebf6", grid: "rgba(20,40,90,.08)", land: "#8394b3", ion: "#0a8a6c", signal: "#9a6400", orange: "#c2551a", alert: "#d43d50", violet: "#7b4fd6", magenta: "#b5199a", sky: "#2f6fbf", track: "rgba(20,40,90,.12)", warn: "#8a5a00", warnbg: "rgba(201,138,0,.13)", night: "#0e1a36", dusk: "#26386a", day: "#5b7fbf", moonDark: "#3a4460", cloud: "#6f86b0" },
};
const vars = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v}`).join(";");
const CSS = `:root{${vars(THEMES.dark)};color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){${vars(THEMES.light)};color-scheme:light}}
:root[data-theme=light]{${vars(THEMES.light)};color-scheme:light}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
.w{display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:6px 9px 5px;gap:3px;overflow:hidden}
header,.stale,.sum,footer{flex:none}
header{display:flex;align-items:center;gap:7px;min-width:0}
h1{font-size:13px;margin:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--ion);animation:p 2s ease-in-out infinite}
@keyframes p{50%{opacity:.25}}
.when{margin-left:auto;flex:none;color:var(--muted);font-size:11px;white-space:nowrap}
.wl{display:none}
.vis{position:relative;flex:1 1 0;min-height:0}
canvas{position:absolute;left:0;top:0;width:100%;height:100%}
.msg{flex:1 1 0;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 14px;margin:0;color:var(--muted)}
[data-state=loading] .vis,[data-state=failed] .vis{display:none}
.msg[hidden],.stale[hidden]{display:none}
.stale{margin:0;padding:2px 7px;border-radius:6px;background:var(--warnbg);color:var(--warn);font-size:11px}
.sum{margin:0;font-size:12px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
.list{display:none;flex:0 1 auto;min-height:0;overflow:hidden;margin:0;padding:0 0 0 1.2em;color:var(--muted);font-size:11.5px}
footer{display:flex;flex-wrap:wrap;column-gap:8px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:4px}
footer .by{white-space:nowrap}
.sum .f{display:none}
footer a{color:var(--link);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.long{display:none}
@media (min-width:360px){.wl{display:inline}}
@media (min-width:460px) and (min-height:300px){h1{font-size:15px}.when{font-size:12px}.sum{font-size:13.5px;-webkit-line-clamp:4;line-clamp:4}footer{font-size:12px}.stale{font-size:12px}.w{padding:10px 14px 8px;gap:6px}}
@media (min-height:400px) and (min-width:400px){.list{display:block}.long{display:inline}}
@media (min-height:300px) and (min-width:400px){.sum .s{display:none}.sum .f{display:inline}}
[data-state=stale] .dot{background:var(--warn);animation:none}
[data-state=failed] .dot,[data-state=loading] .dot{background:var(--muted)}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}`;

const LIVE_BASE = (file) => href(file, "live/");
const C_COLORS = Object.keys(THEMES.dark);
// one entry per widget: what the page needs, how it is built and what it credits. page: the live page the credit links to (for the sky
// widget the hub; the page sets the chosen city's page). name: the short name in the gallery and the snippet generator.
export const WIDGETS = [
  { id: "earthquakes", name: "Earthquakes now", page: "earthquakes-today/", title: "Earthquakes now: live map from USGS data", need: [["quakes", "quakes.json", "json"]], maxHours: MAX_AGE_HOURS.quakes, map: true,
    credit: "Data: U.S. Geological Survey (USGS)", fns: [quakeModel, quakeText, drawQuakes],
    cfg: "model:function(r,now,C){return quakeModel(r.docs['quakes/quakes.json'],now,C)},text:function(m,now){return quakeText(m,now)},draw:drawQuakes" },
  { id: "aurora", name: "Aurora meter", page: "aurora-tonight/", title: "Aurora meter: the planetary Kp index from NOAA SWPC", need: [["kp", "kp.json", "json"]], maxHours: MAX_AGE_HOURS.kp,
    credit: "Data: NOAA Space Weather Prediction Center", fns: [wG, kpModel, kpText, drawKp],
    cfg: "model:function(r,now,C){return kpModel(r.docs['kp/kp.json'],now,C)},text:function(m){return kpText(m)},draw:drawKp" },
  { id: "tropical-storms", name: "Tropical storms", page: "tropical-storms-now/", title: "Tropical storms: active storms and forecast tracks from NOAA NHC", need: [["storms", "storms.json", "json"]], maxHours: MAX_AGE_HOURS.storms, map: true,
    credit: "Data: NOAA National Hurricane Center", fns: [wCat, stormModel, stormText, drawStorms],
    cfg: "model:function(r,now,C){return stormModel(r.docs['storms/storms.json'],now,C)},text:function(m){return stormText(m)},draw:drawStorms" },
  { id: "wildfires", name: "Wildfire map", page: "wildfires-today/", title: "Wildfire map: satellite fire detections from NASA FIRMS", need: [["fires", "fires.json", "json"], ["fires", "fires.bin", "bin"]], maxHours: MAX_AGE_HOURS.fires, map: true,
    credit: "Data: NASA FIRMS (LANCE).", long: " We acknowledge the use of data and/or imagery from NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance), part of NASA's Earth Science Data and Information System (ESDIS).", fns: [fireModel, fireText, drawFires],
    cfg: "model:function(r,now,C){return fireModel(r.docs['fires/fires.json'],r.docs['fires/fires.bin'],now,C)},text:function(m){return fireText(m)},draw:drawFires" },
  { id: "tonights-sky", name: "Tonight's sky", page: "tonights-sky/", city: true, title: "Tonight's sky: Moon, planets and cloud for one city", need: [["clouds", "clouds.json", "json"]], maxHours: 0, cloudHours: SKY_MAX_AGE_HOURS.clouds,
    credit: "Moon and planets computed; cloud: MET Norway", long: " (The Norwegian Meteorological Institute), CC BY 4.0", fns: [skyPos, skyNight, skyEvents, skyCloud, skyText, drawSky],
    cfg: "optional:true,renew:true,model:function(r,now,C,o){var c=C.cities[o.city],n=skyNight(c.lat,c.lon,now,10),d=r&&r.docs?r.docs['clouds/clouds.json']:null,cl=d?skyCloud(d,o.city,n,now,C):null;return{t:now,stale:false,city:c,night:n,cloud:cl,state:!r?'failed':!d?'missing':cl?'ok':'unusable'}},text:function(m,now,C){var t=skyText(m.city,m.night,m.cloud,C.fmt,m.state);t.whenLabel='';t.when=m.city.name+' '+C.fmt(now);return t},draw:drawSky" },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
export const widgetFile = (id) => `embed/${id}/index.html`;
const COMMON = [wTime, wFin, wPollDelay, wNum, wUtc, wAgo, wOptions, wLoad, wRun];

// the inline script: the functions by their source text, the constants and the call, with comments and spaces taken out by esbuild
// (whitespace only: every name stays as written, so the page runs the same code the tests import)
function script(w, { coast, cities }) {
  const file = widgetFile(w.id);
  const C = { maxHours: w.maxHours, pollSec: 300, ...(w.cloudHours ? { cloudHours: w.cloudHours, cities } : {}) };
  const fns = [...COMMON, ...(w.map ? [wCoastRuns, wLatBox, wMap] : []), ...w.fns];
  const extra = w.city
    ? `C.fmt=function(t){return new Intl.DateTimeFormat("en-GB",{timeZone:C.cities[O.city].tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(t))};`
    : "";
  const body = `var C=${JSON.stringify(C)},O;
${fns.map((f) => f.toString()).join("\n")}
${w.city ? `O=wOptions(location.search,${JSON.stringify(cities ? Object.keys(cities) : [])});` : ""}${extra}
wRun({base:${JSON.stringify(LIVE_BASE(file))},need:${JSON.stringify(w.need)},C:C,colors:${JSON.stringify(C_COLORS)},${w.map ? `coast:${JSON.stringify(coast)},` : ""}${w.city ? `cities:${JSON.stringify(Object.keys(cities))},fmt:C.fmt,start:function(o){var a=document.getElementById("credit");a.href=a.href+o.city+"/"},` : ""}${w.cfg}});`;
  return transformSync(body, { loader: "js", minifyWhitespace: true, legalComments: "none", charset: "ascii" }).code.trim();
}

// The widget page. coast: coastEncode's text; cities: { id: { name, lat, lon, tz } } for the sky widget.
export function widgetHtml(w, { coast = "", cities = null, siteUrl = SITE.url } = {}) {
  if (w.city && !cities) throw new Error("embed: the sky widget needs its cities");
  const link = `${siteUrl}/${w.page}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>${esc(w.name)}: a live widget from ${esc(SITE.name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="w" id="w" data-state="loading">
<header><span class="dot" aria-hidden="true"></span><h1>${esc(w.name)}</h1><span class="when" id="when"><span class="wl" id="when-l"></span><span id="when-v"></span></span></header>
<p class="stale" id="stale" hidden><span id="stale-s"></span><span class="long"> The source or our collector may be behind.</span></p>
<div class="vis" id="vis" role="img" aria-label="Loading live data."><canvas id="cv"></canvas></div>
<p class="msg" id="msg">Loading live data...</p>
<p class="sum" id="sum"><span class="s" id="sum-s"></span><span class="f" id="sum-f"></span></p>
<ol class="list" id="list"></ol>
<footer><span class="src">${esc(w.credit)}${w.long ? `<span class="long">${esc(w.long)}</span>` : ""}</span> <span class="by">Live data by <a id="credit" href="${esc(link)}" target="_blank" rel="noopener">${esc(SITE.name)}</a></span></footer>
</div>
<noscript><p style="padding:8px 12px">This live widget needs JavaScript. See the <a href="${esc(link)}" target="_blank" rel="noopener">live page on ${esc(SITE.name)}</a>.</p></noscript>
<script>(function(){
${script(w, { coast, cities })}
})();</script>
</body>
</html>
`;
}
