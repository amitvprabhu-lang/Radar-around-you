// The pure parts of the embeddable widgets (docs/embed-sources.md): option checks, the snippet, time wording, and for each widget a
// function that turns the collector's feed files into what the widget draws and says. No DOM, no network and no clock: every function
// takes "now" as a parameter, so the same code is unit tested in node (test/embed.test.js) and copied into the widget pages by its
// source text (site/embed-widgets.mjs, as site/home-strip.mjs does). So each function may use only its own parameters, the browser's
// built-ins and the other functions of this file, and must not import anything. Definitions follow the live pages (site/hazard.mjs,
// site/sky.mjs) and are recorded in docs/embed-sources.md.

// ------------------------------------------------------------------ options, snippet, time wording
// An ISO time with or without a zone; no zone means UTC (NOAA's Kp time tags have none), as parseTime in site/hazard.mjs.
export function wTime(s) {
  if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:[\d.]+)?(Z|[+-]\d\d:\d\d)?$/.test(s)) return NaN;
  return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + "Z");
}
// a real, finite number from lo to hi (null, strings and NaN fail, unlike a bare comparison, where null counts as 0)
export function wFin(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
// The wait before the next look at the manifest, in ms: the manifest's pollSec (never under 300 s, never over an hour), doubled after
// each failure in a row up to 16 times, at most 30 minutes (pollDelayMs in src/live.js, with a higher floor for other people's pages).
export function wPollDelay(pollSec, failures) {
  var base = Math.min(3600, Math.max(300, wFin(pollSec, 1, 1e6) ? pollSec : 300)) * 1000;
  return Math.min(18e5, base * Math.pow(2, Math.min(failures || 0, 4)));
}
// numbers as the live pages print them (en-GB grouping), rounded to d decimals when d is given
export function wNum(n, d) {
  var x = d == null ? n : Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
  return x.toLocaleString("en-GB");
}
// "4 Oct 13:49 UTC"
export function wUtc(ms) {
  var s = new Date(ms).toISOString(), m = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return Number(s.slice(8, 10)) + " " + m[Number(s.slice(5, 7)) - 1] + " " + s.slice(11, 16) + " UTC";
}
// "just now", "1 minute ago", "12 minutes ago", "3 hours ago", "2 days ago" (a time a little after now, from a clock that is behind, is "just now")
export function wAgo(ms, now) {
  var s = (now - ms) / 1000, n;
  if (s < 90) return "just now";
  if (s < 5400) { n = Math.round(s / 60); return n + " minutes ago"; }
  if (s < 129600) { n = Math.round(s / 3600); return n + (n === 1 ? " hour ago" : " hours ago"); }
  n = Math.round(s / 86400);
  return n + (n === 1 ? " day ago" : " days ago");
}
// The widget's options from its address (?theme=dark&city=pune). Only values on the lists are taken; anything else falls back to the
// default, so no query value ever reaches the page except as one of these known words. cities: the allowed city ids (the first is the
// default) or null for a widget without a city.
export function wOptions(search, cities) {
  var o = { theme: "auto", city: cities && cities.length ? cities[0] : null };
  var q = String(search || "").replace(/^\?/, "").split("&");
  for (var i = 0; i < q.length; i++) {
    var kv = q[i].split("="), k = kv[0], v = kv.slice(1).join("=");
    try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { continue; }
    if (k === "theme" && (v === "light" || v === "dark" || v === "auto")) o.theme = v;
    if (k === "city" && cities && cities.indexOf(v) >= 0) o.city = v;
  }
  return o;
}
// The HTML an embedder pastes: one iframe and one plain visible credit line with one link. spec: { base (the site address, no
// trailing slash), widgets: { id: { title, page } }, cities: [ids], themes: [names], sizes: [[w, h]] }; the choice is checked against
// these lists and the size range, and anything else throws. page: the matching live page, the credit link's target (for the sky widget,
// the chosen city's page).
export function wSnippet(spec, c) {
  var w = Object.prototype.hasOwnProperty.call(spec.widgets, c.widget) ? spec.widgets[c.widget] : null;
  if (!w) throw new Error("embed: unknown widget");
  var width = Number(c.width), height = Number(c.height);
  if (!(Number.isInteger(width) && width >= 280 && width <= 800 && Number.isInteger(height) && height >= 200 && height <= 600)) throw new Error("embed: size out of range");
  var theme = c.theme || "auto";
  if (spec.themes.indexOf(theme) < 0) throw new Error("embed: unknown theme");
  var q = [], page = w.page;
  if (w.city) {
    var city = c.city || spec.cities[0];
    if (spec.cities.indexOf(city) < 0) throw new Error("embed: unknown city");
    q.push("city=" + city);
    page = w.page + city + "/";
  }
  if (theme !== "auto") q.push("theme=" + theme);
  var e = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var src = spec.base + "/embed/" + c.widget + "/" + (q.length ? "?" + q.join("&") : "");
  return '<iframe src="' + e(src) + '" width="' + width + '" height="' + height + '" title="' + e(w.title) + '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="border:0;max-width:100%"></iframe>\n' +
    '<p style="margin:4px 0 0;font-size:13px">Live data by <a href="' + e(spec.base + "/" + page) + '">Radar Around You</a></p>';
}

// ------------------------------------------------------------------ the shared loader
// Reads the live folder's manifest (fresh), then the files each widget needs, by the manifest's versioned paths. need: [[feed, file,
// kind]] with kind "json" or "bin"; get(url, kind, fresh): a promise of the parsed JSON or an ArrayBuffer. Resolves to { manifest,
// docs: { "feed/file": data }, missing: [feed ids] }; a file the manifest does not name, or whose path is not of the expected shape, is
// missing (never fetched); a failed manifest rejects. version: the feeds' versions joined; when it equals prev, nothing else is fetched
// and the result says same: true (the widget keeps what it has).
export function wLoad(base, get, need, prev) {
  return get(base + "manifest.json", "json", true).then(function (m) {
    var docs = {}, missing = [];
    if (!m || !m.feeds) throw new Error("no manifest");
    var v = need.map(function (n) { var f = m.feeds[n[0]]; return String(f && f.version); }).join(",");
    if (prev != null && v === prev) return { manifest: m, docs: null, missing: [], version: v, same: true };
    return Promise.all(need.map(function (n) {
      var f = m.feeds[n[0]], p = f && f.files && f.files[n[1]];
      if (typeof p !== "string" || !/^[a-z]+\/[A-Za-z0-9]+\/[a-z]+\.(json|bin)$/.test(p)) { missing.push(n[0]); return 0; }
      return get(base + p, n[2], false).then(function (d) { docs[n[0] + "/" + n[1]] = d; }, function () { missing.push(n[0]); });
    })).then(function () { return { manifest: m, docs: docs, missing: missing, version: v, same: false }; });
  });
}

// ------------------------------------------------------------------ earthquakes (USGS, the feed of magnitude 2.5 and above, 7 days)
// The events in the 24 hours up to the feed's own generated time (summariseQuakes in site/hazard.mjs), newest first, the largest
// (ties: the newer), and whether the feed is older than its limit. Throws on a feed that fails the live page's checks.
export function quakeModel(doc, now, C) {
  var g = wTime(doc && doc.generated), ev = [], big = null;
  if (!(g > 0) || !Array.isArray(doc.events) || !doc.events.length) throw new Error("quakes: no usable list");
  if (g > now + 36e5) throw new Error("quakes: data time in the future");
  for (var i = 0; i < doc.events.length; i++) {
    var e = doc.events[i], t = wTime(e && e.time);
    if (!(t > 0) || !wFin(e.mag, -2, 10) || !wFin(e.lat, -90, 90) || !wFin(e.lon, -180, 180)) throw new Error("quakes: event " + i + " fails its checks");
    if (t > g - 864e5 && t <= g) ev.push({ t: t, mag: e.mag, lat: e.lat, lon: e.lon, place: String(e.place || "").trim().slice(0, 120) });
  }
  ev.sort(function (a, b) { return b.t - a.t || b.mag - a.mag; });
  for (var j = 0; j < ev.length; j++) if (!big || ev[j].mag > big.mag) big = ev[j];
  return { t: g, stale: now - g > C.maxHours * 36e5, events: ev, largest: big, newest: ev[0] || null };
}
// the summary line, the text alternative and the list (newest first) of the widget
export function quakeText(m, now) {
  var mag = function (x) { return "M" + x.toFixed(1); };
  var where = function (e) { return e.place ? ", " + e.place : ""; };
  var n = m.events.length, sum, alt, short;
  if (!n) {
    short = "No earthquakes in 24 hours";
    sum ="No earthquakes in USGS's feed in the 24 hours to " + wUtc(m.t) + ".";
    alt = "World map with no earthquakes. " + sum;
  } else {
    short = "Newest " + mag(m.newest.mag) + where(m.newest) + ", " + wAgo(m.newest.t, now);
    sum = "Newest " + mag(m.newest.mag) + where(m.newest) + ", " + wAgo(m.newest.t, now) + ". " + wNum(n) + (n === 1 ? " earthquake" : " earthquakes") + " in 24 hours, largest " + mag(m.largest.mag) + ".";
    alt = "World map of " + wNum(n) + (n === 1 ? " earthquake" : " earthquakes") + " of magnitude 2.5 and above in USGS's feed in the 24 hours to " + wUtc(m.t) + ". Largest " + mag(m.largest.mag) + where(m.largest) + ". Newest " + mag(m.newest.mag) + where(m.newest) + ", " + wAgo(m.newest.t, now) + ".";
  }
  return { short: short, sum: sum, alt: alt, list: m.events.slice(0, 5).map(function (e) { return mag(e.mag) + where(e) + ", " + wAgo(e.t, now); }) };
}

// ------------------------------------------------------------------ Kp (NOAA SWPC)
// NOAA's G level for a Kp value (gLevelForKp in src/scales.js): G1 at Kp 5 up to G5 at Kp 9; 0 below storm level.
export function wG(kp) { return Math.max(0, Math.min(5, Math.floor(kp + 1e-9) - 4)); }
// Kp now: the newest three-hour period with a value whose time tag is not after now (summariseKp and the home strip); the series is the
// valued periods up to now, at most the last 24 (three days of three-hour periods; NOAA's file may hold fewer).
export function kpModel(rows, now, C) {
  var list = [];
  if (!Array.isArray(rows) || !rows.length) throw new Error("kp: no rows");
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], t = wTime(r && r.t);
    if (!(t > 0)) throw new Error("kp: row " + i + " has no time");
    if (r.kp != null && !wFin(r.kp, 0, 9)) throw new Error("kp: row " + i + " is out of range");
    if (r.kp != null && t <= now) list.push({ t: t, kp: r.kp });
  }
  if (!list.length) throw new Error("kp: no value up to now");
  list.sort(function (a, b) { return a.t - b.t; });
  var series = list.slice(-24), last = series[series.length - 1], max = series[0];
  for (var j = 1; j < series.length; j++) if (series[j].kp >= max.kp) max = series[j];
  return { t: last.t, kp: last.kp, g: wG(last.kp), stale: now - last.t > C.maxHours * 36e5, series: series, max: max, hours: (last.t - series[0].t) / 36e5 + 3 };
}
export function kpText(m) {
  var k = function (x) { return wNum(x, 2); };
  var hh = function (t) { return new Date(t).toISOString().slice(11, 16); };
  var level = m.g ? "storm level G" + m.g + " on NOAA's scale" : "below storm level (NOAA's G1 starts at Kp 5)";
  var sum = "Kp " + k(m.kp) + " for the period tagged " + hh(m.t) + " UTC: " + level + ". Highest in the " + wNum(m.hours) + " hours shown: Kp " + k(m.max.kp) + (wG(m.max.kp) ? " (G" + wG(m.max.kp) + ")" : "") + ".";
  var short = "Kp " + k(m.kp) + (m.g ? ", storm level G" + m.g : ", below storm level") + "; highest " + k(m.max.kp) + " in " + wNum(m.hours) + "\u00a0h";
  return { short: short, sum: sum, alt: "Gauge of the planetary Kp index from 0 to 9 at " + k(m.kp) + ", with bars for the last " + wNum(m.series.length) + " three-hour periods. " + sum };
}

// ------------------------------------------------------------------ tropical storms (NOAA NHC)
// The Saffir-Simpson category for a wind in knots (categoryForKnots in src/scales.js, NHC's table); 0 below hurricane strength.
export function wCat(kt) { return kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0; }
// Every storm in NHC's active list, strongest first, with its forecast track. The list's own read time is its age (summariseStorms);
// the newest advisory time is reported too.
export function stormModel(doc, now, C) {
  var g = wTime(doc && doc.generated), out = [], adv = null;
  var ll = function (p) { return !!p && wFin(p.lat, -90, 90) && wFin(p.lon, -180, 180); };
  if (!(g > 0) || !Array.isArray(doc.storms)) throw new Error("storms: no usable list");
  if (g > now + 36e5) throw new Error("storms: data time in the future");
  for (var i = 0; i < doc.storms.length; i++) {
    var s = doc.storms[i];
    if (!s || typeof s.name !== "string" || !s.name.trim() || !wFin(s.windKt, 0, 250) || !ll(s)) throw new Error("storms: storm " + i + " fails its checks");
    var track = Array.isArray(s.track) ? s.track : [];
    for (var j = 0; j < track.length; j++) if (!ll(track[j]) || !wFin(track[j].hours, -48, 240)) throw new Error("storms: a forecast point fails its checks");
    var a = Math.max(wTime(s.issued) || 0, wTime(s.updated) || 0);
    if (a > 0 && (!adv || a > adv)) adv = a;
    out.push({ name: s.name.trim().slice(0, 40), cls: String(s.classText || "").slice(0, 40), basin: String(s.basin || "").slice(0, 40), kt: s.windKt, kmh: wFin(s.windKmh, 0, 500) ? s.windKmh : Math.round(s.windKt * 1.852), cat: wCat(s.windKt), lat: s.lat, lon: s.lon,
      track: track.slice().sort(function (p, q) { return p.hours - q.hours; }).map(function (p) { return { lat: p.lat, lon: p.lon, hours: p.hours }; }) });
  }
  out.sort(function (p, q) { return q.kt - p.kt || (p.name < q.name ? -1 : p.name > q.name ? 1 : 0); });
  return { t: g, stale: now - g > C.maxHours * 36e5, storms: out, advisory: adv };
}
export function stormText(m) {
  var one = function (s) { return (s.cls ? s.cls + " " : "") + s.name + ", " + wNum(s.kt) + " knots (" + wNum(s.kmh) + " km/h)" + (s.cat ? ", Category " + s.cat : ""); };
  var n = m.storms.length;
  if (!n) {
    var none = "No active storms in NHC's list for the Atlantic, Eastern Pacific and Central Pacific (read " + wUtc(m.t) + ").";
    return { short: "No active storms in NHC's list", sum: none, alt: "Map of the Atlantic and Pacific with no active storms. " + none, list: [] };
  }
  var sum = one(m.storms[0]) + (n > 1 ? "; " + (n - 1) + " more active" : "") + "." + (m.advisory ? " Newest NHC advisory " + wUtc(m.advisory) + "." : "");
  var s0 = m.storms[0], short = (s0.cls ? s0.cls + " " : "") + s0.name + ", " + wNum(s0.kt) + " kt" + (s0.cat ? ", Cat " + s0.cat : "") + (n > 1 ? "; " + (n - 1) + " more" : "");
  return { short: short, sum: sum, alt: "Map of " + n + " active " + (n === 1 ? "storm" : "storms") + " from NHC with forecast tracks: " + m.storms.map(one).join("; ") + ".", list: m.storms.slice(0, 5).map(one) };
}

// ------------------------------------------------------------------ fire detections (NASA FIRMS, VIIRS, 24 hour files)
// fires.json and fires.bin (12-byte little-endian records: uint16 latIndex, uint16 lonIndex, uint16 detections, float32 FRP, uint16
// minutes; pipeline/hazards.py). The same checks as summariseFires: quarter degree cells, the cell count and the detection total agree
// with fires.json (a cell clamped at 65535 may hold more). The newest detection is the data time. Only the cell positions and counts
// are used, as on the wildfires page.
export function fireModel(sum, buf, now, C) {
  var t = wTime(sum && sum.newest);
  if (!(t > 0) || sum.cellDeg !== 0.25 || !(Number.isInteger(sum.cells) && sum.cells > 0) || !(Number.isInteger(sum.detections) && sum.detections >= 0)) throw new Error("fires: no usable summary");
  if (t > now + 36e5) throw new Error("fires: data time in the future");
  if (!buf || buf.byteLength !== sum.cells * 12) throw new Error("fires: the cell file does not match the summary");
  var dv = new DataView(buf), n = sum.cells, lat = new Float32Array(n), lon = new Float32Array(n), cnt = new Uint16Array(n), total = 0, clamped = false, max = 0;
  for (var i = 0; i < n; i++) {
    var li = dv.getUint16(i * 12, true), lo = dv.getUint16(i * 12 + 2, true), c = dv.getUint16(i * 12 + 4, true);
    if (li >= 720 || lo >= 1440 || c === 0) throw new Error("fires: a cell fails its checks");
    lat[i] = -90 + (li + 0.5) * 0.25; lon[i] = -180 + (lo + 0.5) * 0.25; cnt[i] = c; total += c;
    if (c === 65535) clamped = true;
    if (c > max) max = c;
  }
  if (clamped ? total > sum.detections : total !== sum.detections) throw new Error("fires: the cells do not add up to the summary");
  return { t: t, stale: now - t > C.maxHours * 36e5, detections: sum.detections, cells: n, lat: lat, lon: lon, cnt: cnt, max: max };
}
export function fireText(m) {
  var sum = wNum(m.detections) + " satellite fire detections in NASA FIRMS's 24 hour files, newest " + wUtc(m.t) + ". Detections, not confirmed fires.";
  return { short: wNum(m.detections) + " fire detections in 24 hours (not confirmed fires)", sum: sum, alt: "World map of " + wNum(m.cells) + " quarter-degree cells with fire detections, brighter where there are more. " + sum };
}

// ------------------------------------------------------------------ tonight's sky (computed), cloud from MET Norway
// Low-precision positions of the Sun, Moon and planets (Paul Schlyter's method: orbital elements of the date, the main lunar and
// Jupiter and Saturn perturbations), checked in test/embed.test.js against astronomy-engine, the library the sky pages use, and the
// Moon made topocentric with the simple parallax correction. Returns, for an observer, { name: { alt, az } } in degrees (no refraction)
// plus the Moon's lit fraction and whether it is waxing. Mean sidereal time is gmstDeg's (src/core.js).
export function skyPos(ms, lat, lon) {
  var R = Math.PI / 180, d = ms / 864e5 + 2440587.5 - 2451543.5;
  var rev = function (x) { return ((x % 360) + 360) % 360; };
  var orb = function (N, i, w, a, e, M) {
    N *= R; i *= R; w *= R; M = rev(M) * R;
    var E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    for (var k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    var xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E), r = Math.sqrt(xv * xv + yv * yv), u = Math.atan2(yv, xv) + w;
    return [r * (Math.cos(N) * Math.cos(u) - Math.sin(N) * Math.sin(u) * Math.cos(i)), r * (Math.sin(N) * Math.cos(u) + Math.cos(N) * Math.sin(u) * Math.cos(i)), r * Math.sin(u) * Math.sin(i)];
  };
  // ecliptic longitude, latitude (degrees) and distance of a vector, and back
  var sph = function (v) { return [rev(Math.atan2(v[1], v[0]) / R), Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) / R, Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])]; };
  var vec = function (s) { var l = s[0] * R, b = s[1] * R; return [s[2] * Math.cos(b) * Math.cos(l), s[2] * Math.cos(b) * Math.sin(l), s[2] * Math.sin(b)]; };
  var ws = 282.9404 + 4.70935e-5 * d, Ms = 356.0470 + 0.9856002585 * d;
  var sun = orb(0, 0, ws, 1, 0.016709 - 1.151e-9 * d, Ms);
  // the Moon, in Earth radii, with its largest perturbations
  var Nm = 125.1228 - 0.0529538083 * d, wm = 318.0634 + 0.1643573223 * d, Mm = 115.3654 + 13.0649929509 * d;
  var mo = sph(orb(Nm, 5.1454, wm, 60.2666, 0.0549, Mm));
  var Lm = Mm + wm + Nm, D = (Lm - Ms - ws) * R, F = (Lm - Nm) * R, A = Mm * R, B = Ms * R;
  mo[0] += -1.274 * Math.sin(A - 2 * D) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(B) - 0.059 * Math.sin(2 * A - 2 * D) - 0.057 * Math.sin(A - 2 * D + B) + 0.053 * Math.sin(A + 2 * D) +
    0.046 * Math.sin(2 * D - B) + 0.041 * Math.sin(A - B) - 0.035 * Math.sin(D) - 0.031 * Math.sin(A + B) - 0.015 * Math.sin(2 * F - 2 * D) + 0.011 * Math.sin(A - 4 * D);
  mo[1] += -0.173 * Math.sin(F - 2 * D) - 0.055 * Math.sin(A - F - 2 * D) - 0.046 * Math.sin(A + F - 2 * D) + 0.033 * Math.sin(F + 2 * D) + 0.017 * Math.sin(2 * A + F);
  mo[2] += -0.58 * Math.cos(A - 2 * D) - 0.46 * Math.cos(2 * D);
  // planets: N, i, w, a, e, M at d = 0 and their daily rates (Schlyter's table)
  var EL = {
    Mercury: [48.3313, 3.24587e-5, 7.0047, 5.0e-8, 29.1241, 1.01444e-5, 0.387098, 0, 0.205635, 5.59e-10, 168.6562, 4.0923344368],
    Venus: [76.6799, 2.4659e-5, 3.3946, 2.75e-8, 54.891, 1.38374e-5, 0.72333, 0, 0.006773, -1.302e-9, 48.0052, 1.6021302244],
    Mars: [49.5574, 2.11081e-5, 1.8497, -1.78e-8, 286.5016, 2.92961e-5, 1.523688, 0, 0.093405, 2.516e-9, 18.6021, 0.5240207766],
    Jupiter: [100.4542, 2.76854e-5, 1.303, -1.557e-7, 273.8777, 1.64505e-5, 5.20256, 0, 0.048498, 4.469e-9, 19.895, 0.0830853001],
    Saturn: [113.6634, 2.3898e-5, 2.4886, -1.081e-7, 339.3939, 2.97661e-5, 9.55475, 0, 0.055546, -9.499e-9, 316.967, 0.0334442282],
  };
  var Mj = (19.895 + 0.0830853001 * d) * R, Mt = (316.967 + 0.0334442282 * d) * R;
  var ecl = (23.4393 - 3.563e-7 * d) * R, gst = rev(280.46061837 + 360.98564736629 * (d - 1.5) + 0.000387933 * Math.pow((d - 1.5) / 36525, 2));
  var out = {};
  var put = function (name, g, topo) {
    var x = g[0], y = g[1] * Math.cos(ecl) - g[2] * Math.sin(ecl), z = g[1] * Math.sin(ecl) + g[2] * Math.cos(ecl);
    var ra = Math.atan2(y, x), dec = Math.atan2(z, Math.sqrt(x * x + y * y)), ha = (gst + lon) * R - ra, la = lat * R;
    var alt = Math.asin(Math.sin(dec) * Math.sin(la) + Math.cos(dec) * Math.cos(la) * Math.cos(ha));
    var az = rev(Math.atan2(-Math.sin(ha) * Math.cos(dec), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha)) / R);
    alt /= R;
    if (topo) alt -= Math.asin(1 / topo) / R * Math.cos(alt * R);
    out[name] = { alt: alt, az: az };
  };
  put("Sun", sun);
  put("Moon", vec(mo), mo[2]);
  for (var p in EL) {
    var q = EL[p], h = orb(q[0] + q[1] * d, q[2] + q[3] * d, q[4] + q[5] * d, q[6], q[8] + q[9] * d, q[10] + q[11] * d);
    if (p === "Jupiter" || p === "Saturn") {
      var hs = sph(h);
      if (p === "Jupiter") hs[0] += -0.332 * Math.sin(2 * Mj - 5 * Mt - 67.6 * R) - 0.056 * Math.sin(2 * Mj - 2 * Mt + 21 * R) + 0.042 * Math.sin(3 * Mj - 5 * Mt + 21 * R) - 0.036 * Math.sin(Mj - 2 * Mt) + 0.022 * Math.cos(Mj - Mt) + 0.023 * Math.sin(2 * Mj - 3 * Mt + 52 * R) - 0.016 * Math.sin(Mj - 5 * Mt - 69 * R);
      else { hs[0] += 0.812 * Math.sin(2 * Mj - 5 * Mt - 67.6 * R) - 0.229 * Math.cos(2 * Mj - 4 * Mt - 2 * R) + 0.119 * Math.sin(Mj - 2 * Mt - 3 * R) + 0.046 * Math.sin(2 * Mj - 6 * Mt - 69 * R) + 0.014 * Math.sin(Mj - 3 * Mt + 32 * R); hs[1] += -0.02 * Math.cos(2 * Mj - 4 * Mt - 2 * R) + 0.018 * Math.sin(2 * Mj - 6 * Mt - 49 * R); }
      h = vec(hs);
    }
    put(p, [h[0] + sun[0], h[1] + sun[1], h[2] + sun[2]]);
  }
  // the Moon's lit fraction from its elongation from the Sun, and waxing while it is east of the Sun
  var sl = Math.atan2(sun[1], sun[0]) / R, el = Math.acos(Math.cos((mo[0] - sl) * R) * Math.cos(mo[1] * R));
  out.Moon.lit = (1 - Math.cos(el)) / 2;
  out.Moon.waxing = rev(mo[0] - sl) < 180;
  return out;
}

// Tonight for a place, from now: the night starts at the next sunset (or now, when the Sun is already down) and ends at the next
// sunrise; sunset and sunrise are the Sun's centre at -0.833 degrees (the upper limb on the horizon with standard refraction, the
// convention of the sky pages). The Sun never setting in the next 24 hours gives kind "midnightSun" (the 12 hours from now are shown, and
// nothing is called dark), never rising gives "polarNight" (24 hours from the start). Less than an hour before sunrise the next night is
// shown instead. Each body's altitude and azimuth are sampled every
// `step` minutes over the window. Times are found to about a minute by linear interpolation between samples.
export function skyNight(lat, lon, now, step) {
  var H0 = -0.833, dt = (step || 10) * 6e4, sunAlt = function (t) { return skyPos(t, lat, lon).Sun.alt; };
  var cross = function (from, to, up) {
    var t0 = from, a0 = sunAlt(t0);
    for (var t = from + dt; t <= to; t += dt) {
      var a = sunAlt(t);
      if (up ? a0 < H0 && a >= H0 : a0 >= H0 && a < H0) return t0 + (t - t0) * (H0 - a0) / (a - a0);
      t0 = t; a0 = a;
    }
    return null;
  };
  var kind = "night", start, end, under = sunAlt(now) < H0;
  if (under) start = now;
  else { start = cross(now, now + 864e5, false); if (start === null) { kind = "midnightSun"; start = now; } }
  end = kind === "midnightSun" ? start + 432e5 : cross(start, start + 864e5, true);
  if (end === null) { kind = "polarNight"; end = start + 864e5; }
  // OURS: in the last hour before sunrise the widget shows the coming night instead of a few minutes of dawn
  if (under && kind === "night" && end - now < 36e5) {
    var next = cross(end + dt, end + 864e5, false), nend = next === null ? null : cross(next, next + 864e5, true);
    if (next !== null && nend !== null) { start = next; end = nend; under = false; }
  }
  var samples = [];
  for (var t = start; t < end + dt; t += dt) { var tt = Math.min(t, end); samples.push({ t: tt, p: skyPos(tt, lat, lon) }); if (tt === end) break; }
  return { kind: kind, start: start, end: end, underWay: under, samples: samples };
}
// Rise and set events of a body in the sampled window ("rise" or "set" with a time), from the samples' altitudes against -0.833 degrees
// (the Moon's altitude is topocentric, so the same value stands for its upper limb with refraction).
export function skyEvents(night, name) {
  var s = night.samples, out = [], H0 = -0.833;
  for (var i = 1; i < s.length; i++) {
    var a0 = s[i - 1].p[name].alt, a = s[i].p[name].alt;
    if ((a0 < H0) !== (a < H0)) out.push({ kind: a >= H0 ? "rise" : "set", t: s[i - 1].t + (s[i].t - s[i - 1].t) * (H0 - a0) / (a - a0) });
  }
  return { upAtStart: s[0].p[name].alt >= H0, events: out };
}
// The cloud hours of a city that fall in the window (MET Norway's total cloud cover, percent), from the clouds feed; null when the feed
// has no usable forecast for the city. The forecast's own update time is its age (the sky pages' 6 hour limit).
export function skyCloud(doc, id, night, now, C) {
  var c = doc && doc.cities && doc.cities[id], u = wTime(c && c.updated), hours = [];
  if (!(u > 0) || u > now + 36e5 || !Array.isArray(c.hours)) return null;
  for (var i = 0; i < c.hours.length; i++) {
    var h = c.hours[i], t = wTime(h && h.t);
    if (!(t > 0) || !(typeof h.cloud === "number" && h.cloud >= 0 && h.cloud <= 100)) return null;
    if (t > night.start - 36e5 && t < night.end) hours.push({ t: t, cloud: h.cloud });
  }
  return { t: u, stale: now - u > C.cloudHours * 36e5, hours: hours };
}
// The words of the sky widget. city: { name, tz }; fmt(ms): the city's local time "21:47"; cloud: skyCloud's result or null, and
// state: why it is null ("failed": the live data could not be loaded, "missing": the live data has no cloud forecast, "unusable": the
// forecast has nothing usable for the city). Planets are named as the sky pages name them (planetsTonight in site/sky.mjs): well placed
// means at least 15 degrees up while the Sun is more than 6 degrees down; a night that never gets that dark names none.
export function skyText(city, night, cloud, fmt, state) {
  var PL = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"], up = [], dark = false, i, j;
  var moon = skyEvents(night, "Moon"), mid = night.samples[Math.floor(night.samples.length / 2)].p.Moon;
  if (night.kind !== "midnightSun") for (j = 0; j < night.samples.length; j++) if (night.samples[j].p.Sun.alt < -6) dark = true;
  for (i = 0; dark && i < PL.length; i++) for (j = 0; j < night.samples.length; j++) {
    var p = night.samples[j].p;
    // with standard refraction added (Bennett's formula, about 0.06 degrees at 15 degrees), as the sky pages measure altitude
    var h = p[PL[i]].alt, hr = h + 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * Math.PI / 180) / 60;
    if (p.Sun.alt < -6 && hr >= 15) { up.push(PL[i]); break; }
  }
  var ev = moon.events.length ? moon.events.map(function (e) { return (e.kind === "rise" ? "rises " : "sets ") + fmt(e.t); }).join(", ") : moon.upAtStart ? "up all night" : "below the horizon all night";
  var span = night.kind === "midnightSun" ? "The Sun does not set tonight in " + city.name + "; the next 12 hours from " + fmt(night.start) :
    (night.underWay ? "Tonight in " + city.name + ", now to " : "Tonight in " + city.name + ", " + fmt(night.start) + " to ") + (night.kind === "polarNight" ? fmt(night.end) + " (the Sun does not rise)" : fmt(night.end));
  var list = up.length < 2 ? up.join("") : up.slice(0, -1).join(", ") + " and " + up[up.length - 1];
  var moonText = "Moon " + Math.round(mid.lit * 100) + "% lit (" + (mid.waxing ? "waxing" : "waning") + "), " + ev + ".";
  var plan = !dark ? (night.kind === "midnightSun" ? "The Sun does not set, so no planet is in a dark sky." : "The Sun stays less than 6 degrees down, so no planet is in a dark sky.") :
    up.length ? list + (up.length === 1 ? " is" : " are") + " well placed in the dark (at least 15 degrees up)." : "No planet from Mercury to Saturn is well placed in the dark (at least 15 degrees up).";
  var cl;
  if (!cloud) cl = state === "missing" ? " The live data has no cloud forecast right now." : state === "unusable" ? " MET Norway's cloud forecast has nothing usable for " + city.name + "." : " The cloud forecast could not be loaded.";
  else if (cloud.stale) cl = " MET Norway's cloud forecast of " + wUtc(cloud.t) + " is out of date, so no cloud is shown.";
  else if (!cloud.hours.length) cl = " MET Norway's forecast of " + wUtc(cloud.t) + " does not cover these hours.";
  else {
    var lo = 100, hi = 0;
    for (i = 0; i < cloud.hours.length; i++) { lo = Math.min(lo, cloud.hours[i].cloud); hi = Math.max(hi, cloud.hours[i].cloud); }
    cl = " Cloud " + (Math.round(lo) === Math.round(hi) ? Math.round(lo) + "%" : Math.round(lo) + " to " + Math.round(hi) + "%") + " in MET Norway's forecast of " + wUtc(cloud.t) + ".";
  }
  var sum = span + " local time: " + moonText + " " + plan + cl;
  var short = "Moon " + Math.round(mid.lit * 100) + "% lit, " + ev + (up.length ? ". Well placed: " + up.join(", ") : "");
  return { short: short, sum: sum, alt: "Sky chart of tonight over " + city.name + ", north at the top and east on the left, with the paths of the Moon and planets. " + sum };
}
