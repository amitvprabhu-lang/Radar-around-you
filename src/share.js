// Shareable event cards. A card has a spec (plain data: headline, facts, art, text for a post) and a drawing routine that
// paints it on a canvas. Specs are pure, so they can be tested without a browser.
import { projectSky, compassPoint, EARTH_RADIUS_KM, DEG, formatDuration, formatAge } from "./core.js";
import { visiblePart, fmtDay } from "./tonight.js";

export const APP_NAME = "Radar Around You";
export const CARD_W = 1080, CARD_H = 1350;

const num = (n) => Math.round(n).toLocaleString("en-GB");
const durText = (sec) => {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};
const hm = (d, tz) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
const dayHm = (d, tz) => `${fmtDay(d, tz)} ${hm(d, tz)}`;

// ---------------------------------------------------------------- specs
export function quakeSpec(info, place, nowMs) {
  const age = nowMs - info.timeMs;
  const headline = `P waves reach ${place.name} in ${durText(info.pSec)}`;
  const layer = info.layer;
  return {
    kind: "quake", filename: `quake-m${info.mag.toFixed(1)}-${place.id}.png`,
    kicker: `M${info.mag.toFixed(1)} EARTHQUAKE`, title: headline, subtitle: `${info.place}, ${formatAge(age)}`,
    facts: [
      ["Distance from you", `${num(info.distKm)} km ${info.compass}`],
      ["Depth of the quake", `${Math.round(info.depthKm)} km, in the ${layer}`],
      ["S waves would arrive", durText(info.sSec)],
      ["People who felt it", info.felt != null ? `${num(info.felt)} reported` : "No reports yet"],
    ],
    art: { type: "quake", theta: info.distKm / EARTH_RADIUS_KM, depthKm: info.depthKm, chordKm: chordFor(info), placeName: place.name, pSec: info.pSec, sSec: info.sSec },
    text: `M${info.mag.toFixed(1)} earthquake near ${info.place}, ${formatAge(age)}, ${Math.round(info.depthKm)} km deep. Its P waves would reach ${place.name} in ${durText(info.pSec)} and S waves in ${durText(info.sSec)}, travelling ${num(chordFor(info))} km through the Earth. Simplified straight-line model.`,
  };
}
function chordFor(info) {
  const R = EARTH_RADIUS_KM, r = R - info.depthKm, th = info.distKm / R;
  return Math.sqrt(Math.max(0, R * R + r * r - 2 * R * r * Math.cos(th)));
}

// Geometry of the cutaway drawn on the quake card: epicentre straight up, the viewer clockwise from it.
export function quakeArtGeometry(theta, depthKm, radius) {
  const f = 1 - depthKm / EARTH_RADIUS_KM;
  return {
    focus: { x: radius * 0, y: -radius * f },
    epicentre: { x: 0, y: -radius },
    viewer: { x: radius * Math.sin(theta), y: -radius * Math.cos(theta) },
    layers: [0.995, 0.546, 0.1915].map((k) => k * radius),
  };
}

export function passSpec({ name, short, place, tz, pass, now }) {
  const v = visiblePart(pass);
  const rise = pass.rise, set = pass.set;
  const when = v ? dayHm(v.first.time, tz) : dayHm(pass.max.time, tz);
  const facts = v ? [
    ["Visible", `${hm(v.first.time, tz)} to ${hm(v.last.time, tz)}, ${durText(v.seconds)}`],
    ["Highest point", `${Math.round(v.best.el)}° up in the ${compassPoint(v.best.az)}`],
    ["Appears", `${compassPoint(v.first.az)}${v.fadesIn ? ", out of Earth's shadow" : ""}`],
    ["Disappears", `${compassPoint(v.last.az)}${v.fadesOut ? ", into Earth's shadow" : ""}`],
  ] : [
    ["Crosses the sky", `${hm(rise, tz)} to ${hm(set, tz)}, ${durText((set - rise) / 1000)}`],
    ["Highest point", `${Math.round(pass.max.el)}° up in the ${compassPoint(pass.max.az)}`],
    ["Rises", compassPoint(pass.riseAz)], ["Sets", compassPoint(pass.setAz)],
  ];
  return {
    kind: "pass", filename: `${short.toLowerCase()}-over-${place.id}.png`,
    kicker: v ? "VISIBLE PASS" : "PASS (NOT VISIBLE)", title: `${short} over ${place.name}`, subtitle: when,
    facts,
    art: { type: "dome", track: pass.track.map((t) => ({ el: t.el, az: t.az, lit: t.lit })), mode: "pass" },
    text: v
      ? `${name} passes over ${place.name} on ${when}: visible for ${durText(v.seconds)}, appearing in the ${compassPoint(v.first.az)}, highest ${Math.round(v.best.el)}° in the ${compassPoint(v.best.az)}, then ${v.fadesOut ? "fading into Earth's shadow" : "setting"} in the ${compassPoint(v.last.az)}. Look up!`
      : `${name} crosses the sky over ${place.name} on ${when}, highest ${Math.round(pass.max.el)}° in the ${compassPoint(pass.max.az)}, but it will not be visible (not lit by the Sun, or the sky is too bright).`,
  };
}

export function itemSpec(item, place, tz) {
  if (item.kind === "pass") {
    return {
      kind: "pass", filename: `${item.name.split(" ")[0].toLowerCase()}-over-${place.id}.png`, kicker: "VISIBLE PASS", title: `${item.title.replace(" passes over", "")} over ${place.name}`,
      subtitle: dayHm(item.start, tz), facts: passFacts(item, tz), art: { type: "dome", track: item.track.map((t) => ({ el: t.el, az: t.az, lit: t.lit })), mode: "pass" },
      text: `${item.name} over ${place.name}: ${item.detail}`,
    };
  }
  if (item.kind === "train") {
    return {
      kind: "train", filename: `starlink-string-${place.id}.png`, kicker: "STARLINK STRING", title: `Starlink string over ${place.name}`, subtitle: dayHm(item.start, tz),
      facts: [["Satellites at once", `up to ${item.count}`], ["Best moment", `${hm(item.time, tz)}, ${Math.round(item.maxEl)}° up`], ["Visible", `${hm(item.start, tz)} to ${hm(item.end, tz)}`], ["Direction", `${compassPoint(item.track[0].az)} to ${compassPoint(item.track[item.track.length - 1].az)}`]],
      art: { type: "dome", track: item.track.map((t) => ({ el: t.el, az: t.az, lit: true, count: t.count })), mode: "train" },
      text: `A string of up to ${item.count} Starlink satellites crosses the sky over ${place.name} around ${hm(item.time, tz)} on ${dayHm(item.start, tz)}: ${item.detail}`,
    };
  }
  return null;
}
function passFacts(item, tz) {
  const t = item.track.filter((x) => x.lit);
  const first = t[0], last = t[t.length - 1];
  return [["Visible", `${hm(item.start, tz)} to ${hm(item.end, tz)}, ${durText(item.visibleSeconds)}`], ["Highest point", `${Math.round(item.maxEl)}° up in the ${compassPoint(item.sky.az)}`], ["Appears", compassPoint(first.az)], ["Disappears", compassPoint(last.az)]];
}

export function tonightSpec(t, place) {
  const tz = place.tz;
  const lines = t.highlights.map((h) => `${h.tag === "PASS" ? h.name : h.title} ${h.kind === "planet" || h.kind === "shower" ? "" : "at " + hm(h.time, tz)}`.trim());
  const facts = lines.length ? lines.map((l, i) => [i === 0 ? "Worth looking for" : "", l]) : [["Worth looking for", "Nothing special tonight"]];
  if (t.cloud.known) facts.push(["Cloud", t.best ? `about ${t.cloud.bestWindowAvg}% in the best window` : `about ${t.cloud.avg}% overnight`]);
  return {
    kind: "tonight", filename: `tonight-${place.id}.png`, kicker: `TONIGHT IN ${place.name.toUpperCase()}`, title: t.verdict.headline, subtitle: t.best ? `Best window ${hm(t.best.start, tz)} to ${hm(t.best.endExclusive, tz)}` : "No good window",
    facts: facts.slice(0, 4), art: { type: "ring", score: t.verdict.score, level: t.verdict.level },
    text: `Tonight in ${place.name}: ${t.verdict.headline.toLowerCase()}. ${t.verdict.sentence}`,
  };
}

// ---------------------------------------------------------------- drawing
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function wrapText(ctx, text, maxW) {
  const words = text.split(" "), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCard(spec, canvas, { when = new Date(), tz = "UTC" } = {}) {
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext("2d");
  const DISPLAY = '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif', BODY = '"Hanken Grotesk", system-ui, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  // sky
  const bg = g.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, "#050810"); bg.addColorStop(0.45, "#0b1630"); bg.addColorStop(1, "#04060c");
  g.fillStyle = bg; g.fillRect(0, 0, CARD_W, CARD_H);
  const r = rng(hash(spec.title + spec.kicker));
  for (let i = 0; i < 260; i++) { const x = r() * CARD_W, y = r() * CARD_H, s = r() < 0.07 ? 2.4 : r() * 1.3 + 0.4; g.fillStyle = `rgba(220,230,255,${0.15 + r() * 0.6})`; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
  const glow = g.createRadialGradient(CARD_W / 2, 760, 20, CARD_W / 2, 760, 520);
  glow.addColorStop(0, "rgba(98,230,195,0.10)"); glow.addColorStop(1, "rgba(98,230,195,0)");
  g.fillStyle = glow; g.fillRect(0, 300, CARD_W, 900);
  // brand
  g.fillStyle = "#62e6c3"; g.beginPath(); g.arc(84, 84, 12, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#a98cff"; g.lineWidth = 3; g.beginPath(); g.ellipse(84, 84, 34, 14, -0.49, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#ffd166"; g.beginPath(); g.arc(116, 70, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#eaf0ff"; g.font = `700 34px ${DISPLAY}`; g.textBaseline = "middle"; g.fillText(APP_NAME, 140, 84);
  g.fillStyle = "#9aa7c7"; g.font = `500 26px ${MONO}`; g.textAlign = "right"; g.fillText(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(when), CARD_W - 64, 84); g.textAlign = "left";
  // headline
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffd166"; g.font = `500 28px ${MONO}`; g.fillText(spec.kicker, 64, 190);
  g.fillStyle = "#eaf0ff"; g.font = `700 74px ${DISPLAY}`;
  const tl = wrapText(g, spec.title, CARD_W - 128).slice(0, 3);
  tl.forEach((l, i) => g.fillText(l, 64, 270 + i * 80));
  g.fillStyle = "#9aa7c7"; g.font = `400 34px ${BODY}`;
  const subY = 270 + tl.length * 80 - 8;
  wrapText(g, spec.subtitle || "", CARD_W - 128).slice(0, 2).forEach((l, i) => g.fillText(l, 64, subY + 30 + i * 42));
  // art
  const artTop = 440, artH = 560, cx = CARD_W / 2, cy = artTop + artH / 2;
  const a = spec.art;
  if (a.type === "dome") drawDome(g, cx, cy, 255, a, { MONO });
  else if (a.type === "quake") drawQuake(g, cx, cy, 262, a, { MONO, BODY });
  else if (a.type === "ring") drawRing(g, cx, cy, 235, a, { DISPLAY, MONO });
  // facts
  const fy0 = 1040;
  spec.facts.slice(0, 4).forEach(([label, value], i) => {
    const y = fy0 + i * 58;
    g.fillStyle = "#6c7794"; g.font = `500 22px ${MONO}`; g.fillText(label.toUpperCase(), 64, y);
    g.fillStyle = "#eaf0ff"; g.font = `600 33px ${BODY}`; g.fillText(value, 380, y + 2);
  });
  // footer
  g.fillStyle = "rgba(4,6,12,0.8)"; g.fillRect(0, 1290, CARD_W, 60);
  g.fillStyle = "#6c7794"; g.font = `400 21px ${MONO}`; g.fillText("Prototype. Data: CelesTrak, USGS, NOAA, MET Norway, NASA", 64, 1328);
}

function drawDome(g, cx, cy, R, a, { MONO }) {
  g.save();
  g.strokeStyle = "rgba(160,185,255,0.35)"; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5; g.strokeStyle = "rgba(160,185,255,0.18)";
  for (const k of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  g.fillStyle = "#9aa7c7"; g.font = `500 28px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
  for (const [t, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) { const p = projectSky(0, az, cx, cy, R + 38); g.fillText(t, p.x, p.y); }
  const pts = a.track.map((t) => projectSky(Math.max(0, t.el), t.az, cx, cy, R));
  if (pts.length > 1) {
    // dim stretch (in Earth's shadow or not lit), then the bright visible stretch
    for (let i = 1; i < pts.length; i++) {
      const lit = a.track[i].lit && a.track[i - 1].lit;
      g.strokeStyle = lit ? "#ffd166" : "rgba(160,185,255,0.45)"; g.lineWidth = lit ? 7 : 3; g.setLineDash(lit ? [] : [10, 10]);
      g.beginPath(); g.moveTo(pts[i - 1].x, pts[i - 1].y); g.lineTo(pts[i].x, pts[i].y); g.stroke();
    }
    g.setLineDash([]);
    if (a.mode === "train") {
      for (let i = 0; i < pts.length; i += 1) { g.fillStyle = "rgba(255,244,214,0.95)"; g.beginPath(); g.arc(pts[i].x, pts[i].y, 6.5, 0, Math.PI * 2); g.fill(); }
    }
    const peak = a.track.reduce((best, t, i) => (t.el > a.track[best].el ? i : best), 0);
    g.fillStyle = "#62e6c3"; g.beginPath(); g.arc(pts[peak].x, pts[peak].y, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#050810"; g.beginPath(); g.arc(pts[peak].x, pts[peak].y, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#eaf0ff"; g.beginPath(); g.arc(pts[0].x, pts[0].y, 9, 0, Math.PI * 2); g.fill();
    const e = pts[pts.length - 1], p = pts[pts.length - 2];
    const ang = Math.atan2(e.y - p.y, e.x - p.x);
    g.fillStyle = "#eaf0ff"; g.beginPath(); g.moveTo(e.x + Math.cos(ang) * 16, e.y + Math.sin(ang) * 16); g.lineTo(e.x + Math.cos(ang + 2.5) * 16, e.y + Math.sin(ang + 2.5) * 16); g.lineTo(e.x + Math.cos(ang - 2.5) * 16, e.y + Math.sin(ang - 2.5) * 16); g.closePath(); g.fill();
  }
  g.fillStyle = "#6c7794"; g.font = `400 22px ${MONO}`; g.fillText("sky seen looking up, east on the left", cx, cy + R + 78);
  g.restore(); g.textAlign = "left";
}

function drawQuake(g, cx, cy, R, a, { MONO, BODY }) {
  const geo = quakeArtGeometry(a.theta, a.depthKm, R);
  g.save();
  g.translate(cx, cy);
  const fills = [["#7a4a22", 1], ["#e2711f", 0.995], ["#ffb43a", 0.546], ["#fff3d2", 0.1915]];
  for (const [col, k] of fills) { g.fillStyle = col; g.beginPath(); g.arc(0, 0, R * k, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = "rgba(60,25,5,0.55)"; g.lineWidth = 2;
  for (const rr of geo.layers) { g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke(); }
  // expanding wave circles around the focus, clipped to the Earth
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
  const chordPx = Math.hypot(geo.viewer.x - geo.focus.x, geo.viewer.y - geo.focus.y);
  g.lineWidth = 5;
  [0.28, 0.56, 0.84].forEach((k, i) => { g.strokeStyle = `rgba(255,255,255,${0.75 - i * 0.2})`; g.beginPath(); g.arc(geo.focus.x, geo.focus.y, chordPx * k, 0, Math.PI * 2); g.stroke(); });
  g.restore();
  g.strokeStyle = "#ffffff"; g.lineWidth = 4; g.setLineDash([14, 10]);
  g.beginPath(); g.moveTo(geo.focus.x, geo.focus.y); g.lineTo(geo.viewer.x, geo.viewer.y); g.stroke(); g.setLineDash([]);
  g.fillStyle = "#ffffff"; g.beginPath(); g.arc(geo.focus.x, geo.focus.y, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ff6b7a"; g.beginPath(); g.arc(geo.focus.x, geo.focus.y, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#62e6c3"; g.beginPath(); g.arc(geo.viewer.x, geo.viewer.y, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#050810"; g.font = `600 26px ${BODY}`; g.textAlign = "center";
  g.fillStyle = "#eaf0ff"; g.font = `600 28px ${BODY}`;
  const vx = geo.viewer.x, vy = geo.viewer.y;
  g.textAlign = vx > 0 ? "left" : "right"; g.fillText(a.placeName, vx + (vx > 0 ? 28 : -28), vy - 16);
  g.textAlign = "center"; g.fillStyle = "#ffe9b0"; g.font = `500 24px ${MONO}`; g.fillText("quake", geo.focus.x, geo.focus.y + 46);
  g.restore(); g.textAlign = "left";
}

function drawRing(g, cx, cy, R, a, { DISPLAY, MONO }) {
  const color = a.level === "excellent" ? "#62e6c3" : a.level === "good" ? "#8be37a" : a.level === "fair" ? "#ffd166" : "#ff8a6b";
  g.save();
  g.lineWidth = 34; g.lineCap = "round";
  g.strokeStyle = "rgba(160,185,255,0.14)"; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = color; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0.02, a.score / 100))); g.stroke();
  g.fillStyle = "#eaf0ff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `700 170px ${DISPLAY}`; g.fillText(String(a.score), cx, cy - 8);
  g.fillStyle = "#9aa7c7"; g.font = `500 28px ${MONO}`; g.fillText("OUT OF 100", cx, cy + 112);
  g.restore(); g.textAlign = "left"; g.textBaseline = "alphabetic";
}
