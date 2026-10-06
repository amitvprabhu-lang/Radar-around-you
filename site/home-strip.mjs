// The "live figures" strip in the home page's text section (site/home-text.mjs): six figures read in the visitor's browser from the
// site's own live folder (the same files the 3D app reads), as progressive enhancement. The HTML the server sends carries the labels,
// a dash for each value and a sentence saying where the figures come from, so no stale figure is ever sent in the page itself.
// The functions below are pure (no DOM, no network) apart from stripLoad (given a fetch function) and stripApply (given a root element),
// so the same code is unit tested in node and inlined into the page by STRIP_SCRIPT: each function's own source text is copied into
// the script, so they must not use imports or anything outside their own parameters except each other. Definitions mirror the live
// pages (site/hazard.mjs, site/pages-hazard.mjs hubRows) and are recorded in docs/home-sources.md.
import { MAX_AGE_HOURS } from "./hazard.mjs";

// OURS: the launch list has no live page and so no limit in MAX_AGE_HOURS; 6 hours is the owner's value (2026-10-06), measured from the
// list's own `generated` time.
export const LAUNCH_MAX_AGE_HOURS = 6;
// The oldest each feed may be before the strip adds a note, from the live pages' own limits (site/hazard.mjs).
export const STRIP_LIMITS = { quakes: MAX_AGE_HOURS.quakes, kp: MAX_AGE_HOURS.kp, storms: MAX_AGE_HOURS.storms, fires: MAX_AGE_HOURS.fires, launches: LAUNCH_MAX_AGE_HOURS };
// The six figures, in order, with their visible labels. The key is the data-fig attribute of the value.
export const STRIP_FIGURES = [
  ["quakes", "Earthquakes in the last 24 hours"],
  ["largest", "Largest magnitude among them"],
  ["kp", "Kp index now"],
  ["storms", "Active tropical storms"],
  ["fires", "Satellite fire detections in 24 hours"],
  ["launch", "Next rocket launch"],
];
// The feed files the strip reads, by the manifest's feed id (pipeline/config.py, src/data.js).
export const STRIP_FILES = { quakes: "quakes.json", kp: "kp.json", storms: "storms.json", fires: "fires.json", launches: "launches.json" };
export const STRIP_DASH = "-";

// An ISO time with or without a zone; no zone means UTC (NOAA's Kp time tags have none), as parseTime in site/hazard.mjs.
export function stripTime(s) {
  if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:[\d.]+)?(Z|[+-]\d\d:\d\d)?$/.test(s)) return NaN;
  return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + "Z");
}
// numbers as the live pages print them (num in site/pages-satcount.mjs)
export function stripNum(n) { return n.toLocaleString("en-GB"); }
// "2026-10-06 02:10 UTC", or with hour false the date only
export function stripUtc(ms, hour) {
  var s = new Date(ms).toISOString();
  return hour === false ? s.slice(0, 10) : s.slice(0, 10) + " " + s.slice(11, 16) + " UTC";
}
// a launch time worded to match how exact the source says it is (src/launches.js: SEC, MIN and HR are exact to the second, minute and
// hour; anything else, a month or a quarter included, is not an exact date), in UTC
export function stripWhen(l, t) {
  var p = l.precision;
  return p === "SEC" || p === "MIN" ? stripUtc(t) : p === "HR" ? stripUtc(t) + ", to the hour" : stripUtc(t, false) + ", not an exact date";
}
// earthquakes: the events in the 24 hours up to the feed's own generated time, and the largest magnitude among them (summariseQuakes)
export function stripQuakes(q) {
  var g = stripTime(q.generated), n = 0, big = null;
  if (!(g > 0) || !q.events.length) return null;
  for (var e of q.events) {
    var t = stripTime(e.time);
    if (!(t > 0) || typeof e.mag !== "number" || !(e.mag >= -2 && e.mag <= 10)) return null;
    if (t > g - 864e5 && t <= g) { n++; if (big === null || e.mag > big) big = e.mag; }
  }
  return { t: g, v: { quakes: stripNum(n), largest: big === null ? "none" : stripNum(big) } };
}
// Kp now: the newest three-hour period with a value whose time tag is not after now; its tag is the data time (summariseKp, kpAt)
export function stripKp(rows, now) {
  var best = null;
  for (var r of rows) {
    var t = stripTime(r.t);
    if (!(t > 0) || (r.kp != null && !(typeof r.kp === "number" && r.kp >= 0 && r.kp <= 9))) return null;
    if (r.kp != null && t <= now && (!best || t > best.t)) best = { t: t, v: { kp: stripNum(r.kp) } };
  }
  return best;
}
// storms: every storm in NHC's active list; the list's own read time is its age (summariseStorms)
export function stripStorms(s) {
  var g = stripTime(s.generated);
  return g > 0 && Array.isArray(s.storms) ? { t: g, v: { storms: stripNum(s.storms.length) } } : null;
}
// fires: the detections in the FIRMS 24 hour files; the newest detection is the data time (summariseFires)
export function stripFires(f) {
  var t = stripTime(f.newest);
  return t > 0 && Number.isInteger(f.detections) && f.detections >= 0 && f.cells > 0 ? { t: t, v: { fires: stripNum(f.detections) } } : null;
}
// the next launch: the earliest planned time (net) after the manifest's time; the list's generated time is its age
export function stripLaunch(d, ref) {
  var g = stripTime(d.generated), best = null;
  if (!(g > 0) || !(ref > 0)) return null;
  for (var l of d.launches) {
    var t = stripTime(l.net);
    if (!(t > 0) || !String(l.name || "").trim()) return null;
    if (t > ref && (!best || t < best.t)) best = { t: t, l: l };
  }
  return { t: g, v: { launch: best ? best.l.name.trim() + ", " + stripWhen(best.l, best.t) : "none listed" } };
}
// manifest: the live folder's manifest.json; docs: the parsed feed files by feed id (missing when not loaded); now: the visitor's clock
// (ms); lim: STRIP_LIMITS. Returns the figure texts, the feeds older than their limit and the manifest time as text. A feed that is
// missing, broken (anything that throws counts) or more than an hour in the future gives no figures, so its dashes stay.
export function stripFigures(m, docs, now, lim) {
  var ref = stripTime(m && m.generatedAt), out = { values: {}, old: [], time: ref > 0 ? stripUtc(ref) : null };
  var f = { quakes: stripQuakes, kp: stripKp, storms: stripStorms, fires: stripFires, launches: stripLaunch };
  for (var k in f) {
    var p = null;
    try { p = f[k](docs[k], k === "kp" ? now : ref); } catch (e) {}
    if (!p || p.t > now + 36e5) continue;
    for (var x in p.v) out.values[x] = p.v[x];
    if (now - p.t > lim[k] * 36e5) out.old.push(k);
  }
  return out;
}
// the line under the figures: the manifest's time and, calmly, which feeds are older than their limit
export function stripStatus(r, lim) {
  var names = { quakes: "earthquakes", kp: "Kp", storms: "storms", fires: "fire detections", launches: "launches" };
  return r.time ? "Live data published " + r.time + "." + (r.old.length ? " Some feeds are behind: " + r.old.map((k) => names[k] + " (more than " + lim[k] + " hours old)").join(", ") + "." : "") : "";
}
// get(url, fresh): the parsed JSON of a file, or a rejection. Reads the manifest, then the feed files it names (STRIP_FILES: each feed's
// file is its id plus .json), side by side.
export async function stripLoad(base, get, now, lim) {
  var m = await get(base + "manifest.json", true), docs = {};
  await Promise.all(Object.keys(lim).map((k) => {
    var p = m.feeds[k] && m.feeds[k].files[k + ".json"];
    return typeof p === "string" && p.indexOf("..") < 0 ? get(base + p).then((d) => { docs[k] = d; }, () => 0) : 0;
  }));
  return stripFigures(m, docs, now, lim);
}
// fills the values with textContent (never HTML) and the status line
export function stripApply(root, r, lim) {
  root.querySelectorAll("[data-fig]").forEach((el) => { var v = r.values[el.getAttribute("data-fig")]; if (typeof v === "string") el.textContent = v; });
  var st = root.querySelector(".home-strip-status");
  if (st) st.textContent = stripStatus(r, lim);
}

const FUNCTIONS = [stripTime, stripNum, stripUtc, stripWhen, stripQuakes, stripKp, stripStorms, stripFires, stripLaunch, stripFigures, stripStatus, stripLoad, stripApply];
// The inline script: the functions above, copied by their source text, and two lines that run them. It sits after the section, so the
// strip is already parsed when it runs (an external copy loaded with defer would also run after parsing; anywhere earlier it finds no
// strip and does nothing). It reads the site's live folder relative to the page ("live/", as the app does), and on any failure leaves
// the dashes and says nothing.
const body = `var L = ${JSON.stringify(STRIP_LIMITS)};
${FUNCTIONS.map((f) => f.toString()).join("\n")}
var root = document.getElementById("home-strip");
if (root && window.fetch) stripLoad("live/", (u, fresh) => fetch(u, fresh ? { cache: "no-store" } : {}).then((r) => { if (!r.ok) throw r.status; return r.json(); }), Date.now(), L).then((r) => stripApply(root, r, L), () => 0);`;
// leading indentation removed to keep the script small; no line of the source relies on it
export const STRIP_SCRIPT = `<script id="home-strip-js">(function () {\n${body.replace(/\n[ \t]+/g, "\n")}\n})();</script>\n`;
