// The one shared script of the live pages, live-pages.js (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, section 8.1).
// Progressive enhancement only: the server HTML already carries every number, table, caption and sentence, and the script only adds
// convenience on top, each part failing silently. site/build.mjs writes the script into the site output (liveScriptSource), and a live
// page opts in with data-live-v="1" on <body> plus <script src="../live-pages.js" defer>. A page whose data-live-v is not
// LIVE_SCRIPT_VERSION is left alone, so an older page and a newer script never disagree silently.
//
// Every function below is a plain function declaration with no reference to anything outside itself except the other functions in
// this file and the browser's own globals, because the script is made by joining their source text (Function.prototype.toString).
// The pure ones are exported and unit tested in node (test/live-pages-js.test.js); the DOM ones run only in the browser.
//
// What a page can carry (all optional):
//   <body data-live-v="1" data-live-page="launches|disasters" data-live-base="../live/" data-live-time="<the page's data time>">
//   <time datetime="...Z">            shown also in the reader's own time zone (the UTC text stays)
//   <td data-sort="..."> or a <time datetime> in the cell: the value a column sorts by, when the visible text does not sort well
//   <... data-tip="text">              inside a figure: a tooltip on hover and keyboard focus
//   <... data-countdown="ISO" data-precision="MIN" data-status="Go for Launch">   a countdown "if the time holds", minute precision or better
//   <... data-live-key="name">        a number the live refresh may update in place
//   <... data-live-status>             where the refresh says what it did

export const LIVE_SCRIPT_FILE = "live-pages.js";
export const LIVE_SCRIPT_VERSION = 1;
// OURS: the live refresh looks for newer data this often (the design asks for 5 minutes or more)
export const LIVE_REFRESH_MS = 5 * 60 * 1000;

// ------------------------------------------------------------------ pure functions (tested in node)

// The value a table cell sorts by: a number when the text starts with one (commas allowed), otherwise the lower-case text.
export function cellSortValue(text) {
  var t = String(text == null ? "" : text).trim();
  if (/^\d{4}-\d\d/.test(t)) return t;  // an ISO date or time (a time element's datetime) sorts as text
  var m = /^-?\d[\d,]*(\.\d+)?/.exec(t);
  if (m) return Number(m[0].replace(/,/g, ""));
  return t.toLowerCase();
}

// The value a table cell sorts by: its own data-sort, else the data-sort of an element inside it (dates and times carry an ISO value
// there; a launch whose time is only a month or a quarter carries the feed's own planned time, a date the source sets inside that
// period), else a time element's datetime, else its text.
export function cellSortKey(cellSort, innerSort, datetime, text) {
  var pick = [cellSort, innerSort, datetime].filter(function (x) { return typeof x === "string" && x !== ""; })[0];
  return cellSortValue(pick === undefined ? text : pick);
}

// Numbers before text, numbers by size, text in alphabetical order.
export function compareSortValues(a, b) {
  var an = typeof a === "number", bn = typeof b === "number";
  if (an && bn) return a - b;
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// The row order for a column: indexes of keys, ascending or descending, stable (equal keys keep their order).
export function sortOrder(keys, descending) {
  var idx = keys.map(function (k, i) { return i; });
  idx.sort(function (i, j) {
    var c = compareSortValues(keys[i], keys[j]);
    if (descending) c = -c;
    return c || i - j;
  });
  return idx;
}

// Whether a row's text holds every word of the query, ignoring case; an empty query matches every row.
export function filterMatch(text, query) {
  var words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  var t = String(text || "").toLowerCase();
  return words.every(function (w) { return t.indexOf(w) >= 0; });
}

// A time in a given time zone, for the reader's own: "Tue 6 Oct, 09:23 CEST". null for a value that is not a time with an hour.
export function localTimeText(iso, timeZone, locale) {
  if (typeof iso !== "string" || !/T\d\d:\d\d/.test(iso)) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale || "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZone || undefined, timeZoneName: "short" }).format(d);
  } catch (e) {
    return null;
  }
}

// The countdown text for a planned time: only for a time exact to the minute or second; after the planned time, the source's status.
export function countdownText(targetMs, nowMs, precision, statusText) {
  if (precision !== "SEC" && precision !== "MIN") return null;
  if (!isFinite(targetMs) || !isFinite(nowMs)) return null;
  var diff = targetMs - nowMs;
  if (diff <= 0) return "The planned time has passed. Status in the source when this page was built: " + (statusText || "not given") + ".";
  var s = Math.floor(diff / 1000), days = Math.floor(s / 86400);
  var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  return "T-minus " + (days ? days + " d " : "") + p2(Math.floor((s % 86400) / 3600)) + ":" + p2(Math.floor((s % 3600) / 60)) + ":" + p2(s % 60) + ", if the time holds";
}

// "less than a minute ago", "1 minute ago", "12 minutes ago", "3 hours ago"
export function minutesAgoText(fromMs, nowMs) {
  var m = Math.floor((nowMs - fromMs) / 60000);
  if (!(m >= 1)) return "less than a minute ago";
  if (m < 120) return m + (m === 1 ? " minute ago" : " minutes ago");
  return Math.floor(m / 60) + " hours ago";
}

// When a launch is planned, worded to match how exact the source says the time is (the rules of src/launches.js, in UTC with the year,
// for a page that is read later): SEC and MIN to the minute, HR to the hour, M a month, Q1 to Q4 a quarter; anything else with the
// source's own name for its precision. Used by the page and by the refresh, so both print the same text.
export function launchWhenText(l) {
  var d = new Date(l && l.net);
  if (isNaN(d.getTime())) return "time not given";
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var quarters = { Q1: "first", Q2: "second", Q3: "third", Q4: "fourth" };
  var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  var day = d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
  var p = l.precision;
  if (p === "SEC" || p === "MIN") return day + ", " + p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + " UTC";
  if (p === "HR") return day + ", in the hour from " + p2(d.getUTCHours()) + ":00 UTC";
  if (p === "M") return months[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", day not set";
  if (quarters[p]) return "the " + quarters[p] + " quarter of " + d.getUTCFullYear() + ", day not set";
  // other precisions are worded by the source's own name for them (the codes behind these names were not seen in our data, so they are
  // matched by the name): a day without a time, a half year or a year; the placeholder day the source puts in `net` is not printed
  var name = String(l.precisionName || "");
  if (/^day$/i.test(name)) return day + ", time not set";
  if (/half/i.test(name)) return (/1/.test(name) ? "the first half of " : /2/.test(name) ? "the second half of " : "a half year in ") + d.getUTCFullYear() + ", day not set";
  if (/year/i.test(name)) return d.getUTCFullYear() + ", day not set";
  return d.getUTCFullYear() + ", not an exact date" + (name ? " (the source calls its precision \"" + name + "\")" : "");
}

// How exact a planned time is, in words, from the source's precision (lower case; the page capitalises it in tables).
export function launchPrecisionText(l) {
  var words = { SEC: "to the second", MIN: "to the minute", HR: "to the hour", M: "only to the month", Q1: "only to the quarter", Q2: "only to the quarter", Q3: "only to the quarter", Q4: "only to the quarter" };
  if (words[l && l.precision]) return words[l.precision];
  return l && l.precisionName ? "only as \"" + String(l.precisionName) + "\" (the source's word)" : "not given";
}

// A country name for an ISO code from the runtime's own region names; the code itself if there is none; "Not given" for none.
export function regionName(cc) {
  if (!cc) return "Not given";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) || cc; } catch (e) { return cc; }
}

// An ISO time with or without a zone in milliseconds; no zone means UTC (GDACS's times have none).
export function isoMs(s) {
  if (typeof s !== "string") return NaN;
  return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s.trim()) ? s.trim() : s.trim() + "Z");
}

// The headline numbers of the launches page from a launches.json document: the next launch at or after the list's own time
// (`generated`), soonest first and then by name, and how many are planned in the 30 days from that time.
export function launchesHeadline(doc) {
  var gen = Date.parse(doc && doc.generated);
  if (!isFinite(gen) || !doc || !Array.isArray(doc.launches)) return null;
  var up = doc.launches.filter(function (l) { return l && isFinite(Date.parse(l.net)) && Date.parse(l.net) >= gen; });
  up.sort(function (a, b) { return Date.parse(a.net) - Date.parse(b.net) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  var in30 = up.filter(function (l) { return Date.parse(l.net) < gen + 30 * 86400000; }).length;
  var next = up[0] || null;
  var exact = up.filter(function (l) { return l.precision === "SEC" || l.precision === "MIN" || l.precision === "HR"; }).length;
  var out = { "next-name": "none in the list", "next-when": "", "launches-30": in30.toLocaleString("en-GB"), "exact-upcoming": exact.toLocaleString("en-GB") };
  if (!next) return out;
  var f = nextLaunchFields(next);
  Object.keys(f).forEach(function (k) { out[k] = f[k]; });
  return out;
}

// Every field of the next launch the page shows, as text, keyed as the page's data-live-key spans: the page builds its lead, card and
// table from this, and the live refresh from the same function, so a refresh that brings a new next launch changes all of them
// together. The last three keys set the countdown's attributes, not text.
export function nextLaunchFields(next) {
  var txt = function (v) { return typeof v === "string" && v.trim() ? v.trim() : "Not given"; };
  var precision = launchPrecisionText(next);
  var cc = String(next.country || "").trim();
  return {
    "next-name": String(next.name).trim(), "next-when": launchWhenText(next),
    "next-provider": typeof next.provider === "string" && next.provider.trim() ? next.provider.trim() : "a provider the list does not name",
    "next-provider-name": txt(next.provider), "next-status": txt(next.statusName || next.status), "next-rocket": txt(next.rocket), "next-mission": txt(next.mission),
    "next-mission-type": txt(next.missionType), "next-orbit": txt(next.orbit), "next-pad": txt(next.pad), "next-location": txt(next.location),
    "next-country": regionName(/^[A-Z]{2,3}$/.test(cc) ? cc : ""), "next-precision": precision.charAt(0).toUpperCase() + precision.slice(1), "next-precision-words": precision,
    "next-net": String(next.net), "next-precision-code": String(next.precision || ""), "next-status-text": txt(next.statusName || next.status),
  };
}

// The name part GDACS and NHC share for a tropical cyclone ("Tropical Cyclone NOLO-26" and "Nolo" both give "NOLO"), the same rule as
// stormToken in src/dedupe.js (a test checks the two agree).
export function stormNameToken(name) {
  if (typeof name !== "string") return null;
  var words = /\b(SUPER|TROPICAL|SUBTROPICAL|CYCLONE|STORM|DEPRESSION|HURRICANE|TYPHOON|POST|REMNANTS|OF|SEVERE|INTENSE|VERY|CATEGORY|MAJOR)\b/g;
  var t = name.toUpperCase().replace(words, " ").replace(/-\d{1,2}(?=\s|$)/g, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return t && !/^\d+$/.test(t) && !/^TC( \d+)?$/.test(t) ? t : null;
}

// Whether a GDACS event is an NHC storm: the rule of sameStorm in src/dedupe.js (a shared name and within 8 degrees, or without a
// name on either side within 2.5 degrees).
export function sameStormRule(nhc, ev) {
  if (!nhc || !ev || ev.type !== "TC") return false;
  if (![nhc.lat, nhc.lon, ev.lat, ev.lon].every(function (v) { return typeof v === "number" && isFinite(v); })) return false;
  var lonDiff = Math.abs(((nhc.lon - ev.lon + 540) % 360) - 180);
  var near = function (deg) { return Math.abs(nhc.lat - ev.lat) < deg && lonDiff < deg; };
  var a = stormNameToken(nhc.name), b = stormNameToken(ev.name);
  return a && b ? a === b && near(8) : near(2.5);
}

// The headline numbers of the disasters page from events.json (and NHC's storms.json, or null): current events that are not
// earthquakes, without the cyclones NHC also lists, counted by alert level, and the events no longer current whose end date is in the 7
// days before dataTime (the feed's own time).
export function disastersHeadline(list, storms, dataTime) {
  if (!Array.isArray(list)) return null;
  var nhc = storms && Array.isArray(storms.storms) ? storms.storms.filter(function (s) { return s && typeof s === "object"; }) : [];
  var kept = list.filter(function (e) { return e && e.type !== "EQ" && !nhc.some(function (s) { return sameStormRule(s, e); }); });
  var cur = kept.filter(function (e) { return e.current === true; });
  var t = isoMs(dataTime);
  var recent = kept.filter(function (e) { return e.current !== true && isoMs(e.to) >= t - 7 * 86400000; });
  var n = function (level) { return cur.filter(function (e) { return e.alert === level; }).length.toLocaleString("en-GB"); };
  var out = { "current": cur.length.toLocaleString("en-GB"), "orange": n("Orange"), "red": n("Red") };
  if (isFinite(t)) out.recent = recent.length.toLocaleString("en-GB");
  return out;
}

// What the refresh should do with a feed: "newer" (fresher than the page and within its limit), "same", "stale" or "missing".
// entry: the feed's record in the live manifest; builtTime: the page's data time; maxAgeHours: the page's limit.
export function feedState(entry, builtTime, maxAgeHours, nowMs) {
  if (!entry || !entry.files) return "missing";
  var t = Date.parse(entry.sourceTime || entry.fetchedAt || "");
  if (!isFinite(t)) return "missing";
  if (nowMs - t > maxAgeHours * 3600000) return "stale";
  return t > Date.parse(builtTime || "") ? "newer" : "same";
}

// The values to show after a refresh: the fresh ones where there are any, and which keys changed.
export function mergeRefresh(current, fresh) {
  var values = {}, changed = [];
  Object.keys(current || {}).forEach(function (k) {
    var f = fresh && Object.prototype.hasOwnProperty.call(fresh, k) ? String(fresh[k]) : null;
    values[k] = f === null ? current[k] : f;
    if (f !== null && f !== current[k]) changed.push(k);
  });
  return { values: values, changed: changed };
}


// ------------------------------------------------------------------ browser parts (each wrapped so a failure stays silent)

function liveStyle(d) {
  var s = d.createElement("style");
  s.textContent = ".lt{color:var(--dim);font-size:.92em}.live-filter{margin:8px 0;font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)}" +
    "th button{all:unset;cursor:pointer}th button:focus-visible{outline:2px solid var(--signal)}.live-tip{position:fixed;z-index:20;pointer-events:none;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:14px;max-width:280px}" +
    ".live-new{outline:2px solid var(--signal);outline-offset:2px}@media (prefers-reduced-motion:no-preference){.live-new{transition:outline-color 1s}}@media print{.live-filter,.live-tip,.lt{display:none}}";
  d.head.appendChild(s);
}

function liveTimes(d) {
  var tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { tz = ""; }
  if (!tz || tz === "UTC" || tz === "Etc/UTC") return;
  // a sky page's city-local times (data-tz) are left as they are: the sky pages are worked out for the city's own night, so their
  // sentences, chart and headings stay in that zone (design section 8.1 f was dropped for them after review, see docs/sky-pages-sources.md)
  Array.prototype.forEach.call(d.querySelectorAll("main time[datetime]:not([data-tz])"), function (t) {
    if (t.closest && t.closest("table")) return;  // tables keep one time per cell
    var txt = localTimeText(t.getAttribute("datetime"), tz);
    if (!txt) return;
    var s = d.createElement("span");
    s.className = "lt";
    s.textContent = " (your time: " + txt + ")";
    t.parentNode.insertBefore(s, t.nextSibling);
  });
}

function liveTables(d) {
  Array.prototype.forEach.call(d.querySelectorAll("main .tablewrap table"), function (table, n) {
    var body = table.tBodies[0];
    if (!body || body.rows.length <= 8) return;
    var heads = table.tHead ? table.tHead.rows[0].cells : [];
    Array.prototype.forEach.call(heads, function (th, col) {
      var b = d.createElement("button");
      b.type = "button";
      b.textContent = th.textContent;
      b.setAttribute("aria-label", "Sort by " + th.textContent);
      th.textContent = "";
      th.appendChild(b);
      b.addEventListener("click", function () {
        var desc = th.getAttribute("aria-sort") === "ascending";
        Array.prototype.forEach.call(heads, function (h) { h.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", desc ? "descending" : "ascending");
        var rows = Array.prototype.slice.call(body.rows);
        var keys = rows.map(function (r) {
          var c = r.cells[col];
          if (!c) return cellSortValue("");
          var inner = c.querySelector("[data-sort]"), tm = c.querySelector("time[datetime]");
          return cellSortKey(c.getAttribute("data-sort"), inner && inner.getAttribute("data-sort"), tm && tm.getAttribute("datetime"), c.textContent);
        });
        sortOrder(keys, desc).forEach(function (i) { body.appendChild(rows[i]); });
      });
    });
    var input = d.createElement("input");
    input.type = "search";
    input.className = "live-filter";
    input.id = "live-filter-" + n;
    input.setAttribute("aria-label", "Filter the table: " + (table.caption ? table.caption.textContent : "rows"));
    input.placeholder = "Filter rows";
    input.addEventListener("input", function () {
      Array.prototype.forEach.call(body.rows, function (r) { r.style.display = filterMatch(r.textContent, input.value) ? "" : "none"; });
    });
    var wrap = table.parentNode;
    wrap.parentNode.insertBefore(input, wrap);
  });
}

function liveTips(d) {
  var tip = null;
  var show = function (el, x, y) {
    if (!tip) { tip = d.createElement("div"); tip.className = "live-tip"; tip.setAttribute("role", "status"); d.body.appendChild(tip); }
    tip.textContent = el.getAttribute("data-tip");
    tip.style.left = Math.round(x + 12) + "px";
    tip.style.top = Math.round(y + 12) + "px";
    tip.style.display = "block";
  };
  var hide = function () { if (tip) tip.style.display = "none"; };
  Array.prototype.forEach.call(d.querySelectorAll("main figure"), function (fig) {
    var items = fig.querySelectorAll("[data-tip]");
    if (!items.length) return;
    Array.prototype.forEach.call(items, function (el) {
      if (items.length <= 60) el.setAttribute("tabindex", "0");
      el.addEventListener("mouseenter", function (e) { show(el, e.clientX, e.clientY); });
      el.addEventListener("mouseleave", hide);
      el.addEventListener("focus", function () { var r = el.getBoundingClientRect(); show(el, r.right, r.top); });
      el.addEventListener("blur", hide);
    });
  });
}

function liveCountdown(d, w) {
  Array.prototype.forEach.call(d.querySelectorAll("[data-countdown]"), function (el) {
    var out = d.createElement("span");
    out.className = "lt";
    out.setAttribute("aria-live", "off");
    el.appendChild(out);
    var tick = function () {
      // read on every tick, so a live refresh that brings a new next launch moves the countdown with it
      var txt = countdownText(Date.parse(el.getAttribute("data-countdown")), Date.now(), el.getAttribute("data-precision"), el.getAttribute("data-status"));
      out.textContent = txt ? " " + txt + "." : "";
    };
    tick();
    w.setInterval(tick, 1000);
  });
}

function liveRefresh(d, w) {
  var b = d.body, page = b.getAttribute("data-live-page"), base = b.getAttribute("data-live-base"), built = b.getAttribute("data-live-time");
  var status = d.querySelector("[data-live-status]");
  var feeds = { launches: ["launches", "launches.json", 6], disasters: ["events", "events.json", 6] }[page];
  if (!feeds || !base || !status || typeof w.fetch !== "function") return;
  var say = function (t) { status.textContent = t; };
  var getJson = function (u) { return w.fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); };
  var shownAt = null;
  // after a successful refresh the page no longer shows the build's numbers, so a later failure says which numbers stay
  var keeps = function () { return shownAt === null ? "this page shows the numbers from its data time" : "this page keeps the numbers from the live data of " + (localTimeText(built) || built); };
  var check = function () {
    getJson(base + "manifest.json").then(function (m) {
      var entry = m && m.feeds && m.feeds[feeds[0]];
      var state = feedState(entry, built, feeds[2], Date.now());
      if (state !== "newer") { say(state === "same" ? "Checked the live data: nothing newer than the numbers on this page." : "The live data is not usable right now, so " + keeps() + "."); return null; }
      var storms = m.feeds.storms;
      var stormsFile = page === "disasters" && storms && storms.files && storms.files["storms.json"] ? getJson(base + storms.files["storms.json"]).catch(function () { return null; }) : Promise.resolve(null);
      return Promise.all([getJson(base + entry.files[feeds[1]]), stormsFile]).then(function (r) {
        var st = r[1] && Date.now() - Date.parse(r[1].generated) <= 12 * 3600000 ? r[1] : null;
        var fresh = page === "launches" ? launchesHeadline(r[0]) : disastersHeadline(r[0], st, entry.sourceTime || entry.fetchedAt);
        if (!fresh) throw new Error("unreadable");
        var els = d.querySelectorAll("[data-live-key]"), current = {};
        Array.prototype.forEach.call(els, function (el) { current[el.getAttribute("data-live-key")] = el.textContent; });
        var merged = mergeRefresh(current, fresh);
        Array.prototype.forEach.call(els, function (el) {
          var k = el.getAttribute("data-live-key");
          el.textContent = merged.values[k];
          if (merged.changed.indexOf(k) >= 0) el.classList.add("live-new");
        });
        if (fresh["next-net"]) Array.prototype.forEach.call(d.querySelectorAll("[data-countdown]"), function (el) {
          el.setAttribute("data-countdown", fresh["next-net"]); el.setAttribute("data-precision", fresh["next-precision-code"]); el.setAttribute("data-status", fresh["next-status-text"]);
        });
        built = entry.sourceTime || entry.fetchedAt;
        shownAt = Date.parse(built);
        say("Updated in place from the live data of " + (localTimeText(built) || built) + ", " + minutesAgoText(shownAt, Date.now()) + ". Marked numbers changed since the page was built; the rest of the page is from its data time.");
        return null;
      });
    }).catch(function () { say("Could not read the live data, so " + keeps() + "."); });
  };
  w.setTimeout(check, 3000);
  w.setInterval(check, 300000);
}

// version: the script's own version, written into the call at the end of the script from LIVE_SCRIPT_VERSION
function liveMain(d, w, version) {
  var b = d.body;
  if (!b || b.getAttribute("data-live-v") !== version) return;
  [liveStyle, liveTimes, liveTables, liveTips, liveCountdown, liveRefresh].forEach(function (f) { try { f(d, w); } catch (e) { /* each part fails silently */ } });
}

// The pure functions the browser parts use, in the order they are written into the script.
const PURE = [cellSortValue, cellSortKey, compareSortValues, sortOrder, filterMatch, localTimeText, countdownText, minutesAgoText, launchWhenText, launchPrecisionText, regionName, isoMs, launchesHeadline, nextLaunchFields, stormNameToken, sameStormRule, disastersHeadline, feedState, mergeRefresh];
const DOM = [liveStyle, liveTimes, liveTables, liveTips, liveCountdown, liveRefresh, liveMain];

// The text of live-pages.js. Deterministic: the same code gives the same bytes.
export function liveScriptSource() {
  return `// live-pages.js, version ${LIVE_SCRIPT_VERSION}: progressive enhancement for the live pages of Radar Around You. Generated by site/live-pages-js.mjs.\n` +
    `(function () {\n"use strict";\n${[...PURE, ...DOM].map((f) => f.toString()).join("\n")}\ntry { liveMain(document, window, ${JSON.stringify(String(LIVE_SCRIPT_VERSION))}); } catch (e) { /* silent */ }\n})();\n`;
}
