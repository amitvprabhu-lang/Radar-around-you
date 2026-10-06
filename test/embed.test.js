// Tests for the embeddable widgets and their gallery (site/embed-models.mjs, site/embed-widgets.mjs, site/embed.mjs): the pure feed to
// view functions against the live pages' own summaries on the same fixtures, the option and snippet checks, the computed sky against
// astronomy-engine and the sky pages, and the built files (size budget, noindex, no outside requests, the credit, house style).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as Astro from "astronomy-engine";
import { wTime, wNum, wUtc, wAgo, wOptions, wSnippet, wLoad, quakeModel, quakeText, wG, kpModel, kpText, wCat, stormModel, stormText, fireModel, fireText, skyPos, skyNight, skyEvents, skyCloud, skyText } from "../site/embed-models.mjs";
import { WIDGETS, WIDGET_IDS, widgetFile, widgetHtml, coastRuns, coastEncode, wCoastRuns, COAST_EPS } from "../site/embed-widgets.mjs";
import { galleryPage, galleryScript, embedSpec, defaultSnippet, GALLERY_FILE, EMBED_SIZES } from "../site/embed.mjs";
import { summariseQuakes, summariseKp, summariseStorms, summariseFires, MAX_AGE_HOURS } from "../site/hazard.mjs";
import { nightWindow, riseSetBetween, SKY_CITY_IDS, SKY_MAX_AGE_HOURS } from "../site/sky.mjs";
import { skyStatic } from "../site/sky-data.mjs";
import { gLevelForKp, categoryForKnots } from "../src/scales.js";
import { SITE, renderPage, urlPath, robotsMeta } from "../site/layout.mjs";
import { build, loadCoast } from "../site/build.mjs";
import { embedPack, FIXTURE_TIMES } from "./embedpack.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fx = (f) => fs.readFileSync(path.join(root, "test/fixtures", f));
const fxj = (f) => JSON.parse(fx(f));
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const T = (k) => Date.parse(FIXTURE_TIMES[k]);
const coast = loadCoast();
const cities = Object.fromEntries(skyStatic().cities.map((c) => [c.id, { name: c.name, lat: c.lat, lon: c.lon, tz: c.tz }]));
const ENC = coastEncode(coastRuns(coast));
const DOCS = Object.fromEntries(WIDGETS.map((w) => [w.id, widgetHtml(w, { coast: ENC, cities })]));
const scriptOf = (h) => h.match(/<script>([\s\S]*?)<\/script>/)[1];
const EM_DASH = /[\u2013\u2014]/, EMOJI = /\p{Extended_Pictographic}/u;

// ------------------------------------------------------------------ time words and options
test("time words: ISO times with and without a zone, UTC text, ages", () => {
  assert.equal(wTime("2026-10-05T15:00:00"), Date.parse("2026-10-05T15:00:00Z"));
  assert.ok(Number.isNaN(wTime("yesterday")) && Number.isNaN(wTime(null)));
  assert.equal(wUtc(Date.parse("2026-10-04T13:49:21Z")), "4 Oct 13:49 UTC");
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.equal(wAgo(now - 30e3, now), "just now");
  assert.equal(wAgo(now + 60e3, now), "just now");
  assert.equal(wAgo(now - 12 * 6e4, now), "12 minutes ago");
  assert.equal(wAgo(now - 3600e3 * 1.6, now), "2 hours ago");
  assert.equal(wAgo(now - 3600e3 * 26, now), "26 hours ago");
  assert.equal(wAgo(now - 864e5 * 2, now), "2 days ago");
  assert.equal(wNum(191619), "191,619");
  assert.equal(wNum(3.6666, 2), "3.67");
});

test("options: only listed values are taken, anything else falls back to the default", () => {
  assert.deepEqual(wOptions("", null), { theme: "auto", city: null });
  assert.deepEqual(wOptions("?theme=dark", null), { theme: "dark", city: null });
  assert.deepEqual(wOptions("?theme=light&city=tokyo", SKY_CITY_IDS), { theme: "light", city: "tokyo" });
  assert.deepEqual(wOptions("?city=atlantis&theme=blue", SKY_CITY_IDS), { theme: "auto", city: "pune" });
  assert.deepEqual(wOptions("?theme=%3Cscript%3E&city=%3Cimg%20src%3Dx%3E", SKY_CITY_IDS), { theme: "auto", city: "pune" });
  assert.deepEqual(wOptions("?theme=%E0%A4%A&city=london", SKY_CITY_IDS), { theme: "auto", city: "london" }, "a broken escape is skipped");
  assert.deepEqual(wOptions("?city=pune&city=tromso", SKY_CITY_IDS).city, "tromso");
  assert.equal(wOptions("?city=__proto__", SKY_CITY_IDS).city, "pune");
});

// ------------------------------------------------------------------ the snippet
test("the default snippet: one iframe with size, title, lazy loading and a referrer policy, and one plain visible credit link", () => {
  const spec = embedSpec("https://zeninnov8.com");
  const s = wSnippet(spec, { widget: "earthquakes", width: 400, height: 300 });
  assert.equal(s, '<iframe src="https://zeninnov8.com/embed/earthquakes/" width="400" height="300" title="Earthquakes now: live map from USGS data" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="border:0;max-width:100%"></iframe>\n' +
    '<p style="margin:4px 0 0;font-size:13px">Live data by <a href="https://zeninnov8.com/earthquakes-today/">Radar Around You</a></p>');
  for (const id of WIDGET_IDS) {
    const d = defaultSnippet(id, spec);
    assert.equal((d.match(/<iframe /g) || []).length, 1);
    assert.equal((d.match(/<a /g) || []).length, 1, "exactly one link");
    assert.ok(!/nofollow|display:none|visibility|hidden/.test(d), "nothing hidden and no rel forced");
    assert.match(d, />Radar Around You<\/a>/, "the anchor text is the site's name only");
  }
  assert.match(defaultSnippet("tonights-sky", spec), /src="https:\/\/zeninnov8\.com\/embed\/tonights-sky\/\?city=pune"[\s\S]*href="https:\/\/zeninnov8\.com\/tonights-sky\/pune\/"/);
});

test("the snippet takes the theme and the city, and refuses anything off the lists", () => {
  const spec = embedSpec("https://zeninnov8.com");
  const s = wSnippet(spec, { widget: "tonights-sky", width: 800, height: 450, theme: "dark", city: "tromso" });
  assert.ok(s.includes('src="https://zeninnov8.com/embed/tonights-sky/?city=tromso&amp;theme=dark"') && s.includes('href="https://zeninnov8.com/tonights-sky/tromso/"'));
  assert.ok(wSnippet(spec, { widget: "aurora", width: 280, height: 200, theme: "light", city: "tokyo" }).includes('embed/aurora/?theme=light"'), "a city is ignored for a widget without one");
  for (const bad of [{ widget: "launches" }, { widget: "constructor" }, { widget: "aurora", width: 279 }, { widget: "aurora", height: 601 }, { widget: "aurora", width: "400px" }, { widget: "aurora", theme: "neon" }, { widget: "tonights-sky", city: "<x>" }]) {
    assert.throws(() => wSnippet(spec, { width: 400, height: 300, ...bad }), /embed:/, JSON.stringify(bad));
  }
  for (const [w, h] of EMBED_SIZES) assert.doesNotThrow(() => wSnippet(spec, { widget: "aurora", width: w, height: h }));
  assert.ok(wSnippet({ ...spec, base: 'https://x.org/"><b' }, { widget: "aurora", width: 400, height: 300 }).includes("&quot;&gt;&lt;b"), "the attributes are escaped");
});

// ------------------------------------------------------------------ the loader
test("the loader reads the manifest fresh, then each file by its versioned path, and skips paths of any other shape", async () => {
  const pack = embedPack(T("quakes") + 6e5);
  const asked = [];
  const get = (u, kind, fresh) => { asked.push([u, kind, !!fresh]); const k = u.replace(/^base\//, "live/"); return pack.files.has(k) ? Promise.resolve(pack.files.get(k)) : Promise.reject(new Error("404")); };
  const r = await wLoad("base/", get, [["quakes", "quakes.json", "json"], ["fires", "fires.bin", "bin"], ["nope", "x.json", "json"]]);
  assert.deepEqual(asked[0], ["base/manifest.json", "json", true]);
  assert.ok(r.docs["quakes/quakes.json"].events.length > 0 && Buffer.isBuffer(r.docs["fires/fires.bin"]));
  assert.deepEqual(r.missing, ["nope"]);
  asked.length = 0;
  const again = await wLoad("base/", get, [["quakes", "quakes.json", "json"]], "v1");
  assert.ok(again.same && again.docs === null && asked.length === 1, "an unchanged version fetches the manifest only");
  assert.equal((await wLoad("base/", get, [["quakes", "quakes.json", "json"]], "v0")).same, false);
  const m = JSON.parse(JSON.stringify(pack.manifest));
  m.feeds.quakes.files["quakes.json"] = "../../etc/passwd";
  const r2 = await wLoad("base/", (u) => (u.endsWith("manifest.json") ? Promise.resolve(m) : get(u)), [["quakes", "quakes.json", "json"]]);
  assert.deepEqual(r2.missing, ["quakes"]);
  await assert.rejects(wLoad("base/", () => Promise.reject(new Error("down")), [["quakes", "quakes.json", "json"]]));
});

// ------------------------------------------------------------------ feed to view, against the live pages' own summaries
test("earthquakes: the same 24 hour window, count and largest as the earthquakes page, newest first, and the age limit", () => {
  const doc = fxj("hazards/quakes.json"), now = T("quakes") + 10 * 6e4, C = { maxHours: MAX_AGE_HOURS.quakes };
  const m = quakeModel(doc, now, C), s = summariseQuakes(doc, { now });
  assert.equal(m.events.length, s.count);
  assert.equal(m.largest.mag, s.largest.mag);
  assert.equal(new Date(m.largest.t).toISOString().replace(/\.000Z$/, "Z"), s.largest.time);
  for (let i = 1; i < m.events.length; i++) assert.ok(m.events[i - 1].t >= m.events[i].t, "newest first");
  assert.equal(m.newest, m.events[0]);
  assert.equal(m.stale, false);
  assert.equal(quakeModel(doc, T("quakes") + 3.01 * 36e5, C).stale, true);
  assert.equal(quakeModel(doc, T("quakes") + 2.99 * 36e5, C).stale, false);
  const tx = quakeText(m, now);
  assert.ok(tx.sum.includes(`${s.count} earthquakes in 24 hours, largest M${s.largest.mag.toFixed(1)}`), tx.sum);
  assert.ok(tx.short.startsWith(`Newest M${m.newest.mag.toFixed(1)}, ${m.newest.place}, `), tx.short);
  assert.ok(tx.alt.includes(String(s.count)) && tx.alt.includes("4 Oct 13:49 UTC"));
  assert.equal(tx.list.length, 5);
  assert.throws(() => quakeModel({ ...doc, events: [{ ...doc.events[0], mag: 12 }] }, now, C), /fails its checks/);
  assert.throws(() => quakeModel({ ...doc, generated: "2026-10-04T20:00:00Z" }, T("quakes"), C), /future/);
  assert.throws(() => quakeModel({ generated: doc.generated, events: [] }, now, C));
  assert.match(quakeText({ ...m, events: [], newest: null, largest: null }, now).sum, /^No earthquakes in USGS's feed/);
});

test("aurora: Kp now and the highest Kp as the aurora page gives them, NOAA's G levels as src/scales.js, and the age limit", () => {
  const rows = fxj("hazards/live-20261005/kp/20261005T183040Z/kp.json"), now = T("kp") + 3.5 * 36e5, C = { maxHours: MAX_AGE_HOURS.kp };
  const m = kpModel(rows, now, C), s = summariseKp(rows, { now });
  assert.equal(m.kp, s.latest.kp);
  assert.equal(new Date(m.t).toISOString().replace(/\.000Z$/, "Z"), s.latest.t);
  assert.equal(m.max.kp, s.max.kp);
  assert.equal(m.series.length, rows.filter((r) => r.kp != null).length);
  assert.equal(m.hours, 48);
  for (let k = 0; k <= 9; k += 1 / 3) assert.equal(wG(k), gLevelForKp(k), `Kp ${k}`);
  assert.equal(wG(8.67), 4); assert.equal(wG(9), 5); assert.equal(wG(4.99), 0);
  assert.equal(kpModel(rows, T("kp") + 8.1 * 36e5, C).stale, true);
  // a period tagged after now is not "now"
  const early = kpModel(rows, T("kp") - 60e3, C);
  assert.ok(early.t < T("kp"));
  const tx = kpText(m);
  assert.ok(tx.sum.startsWith(`Kp ${wNum(m.kp, 2)} for the period tagged 15:00 UTC: below storm level`), tx.sum);
  assert.ok(tx.sum.includes(`Highest in the 48 hours shown: Kp ${wNum(s.max.kp, 2)} (G1)`), tx.sum);
  assert.throws(() => kpModel([{ t: "2026-10-05T15:00:00", kp: 10 }], now, C), /out of range/);
  assert.throws(() => kpModel([{ t: "2026-10-05T15:00:00", kp: null }], now, C), /no value/);
});

test("storms: every active storm, strongest first, with forecast tracks, as the storms page reads them; categories as NHC's table", () => {
  const doc = fxj("hazards/storms.json"), now = T("storms") + 6e5, C = { maxHours: MAX_AGE_HOURS.storms };
  const m = stormModel(doc, now, C), s = summariseStorms(doc, { now });
  assert.deepEqual(m.storms.map((x) => x.name), s.storms.map((x) => x.name));
  assert.deepEqual(m.storms.map((x) => x.cat), s.storms.map((x) => x.category));
  assert.deepEqual(m.storms.map((x) => x.track.length), s.storms.map((x) => x.track.length));
  assert.equal(new Date(m.advisory).toISOString().replace(/\.000Z$/, "Z"), s.dataTime);
  for (let kt = 0; kt <= 200; kt += 0.5) assert.equal(wCat(kt), categoryForKnots(kt), `${kt} kt`);
  const tx = stormText(m);
  assert.ok(tx.sum.startsWith(`Hurricane Nolo, 100 knots (185 km/h), Category 3; 1 more active.`), tx.sum);
  const none = stormText(stormModel({ generated: doc.generated, storms: [] }, now, C));
  assert.match(none.sum, /^No active storms in NHC's list for the Atlantic, Eastern Pacific and Central Pacific \(read 4 Oct 19:55 UTC\)\.$/);
  assert.equal(stormModel(doc, T("storms") + 12.1 * 36e5, C).stale, true);
  assert.throws(() => stormModel({ ...doc, storms: [{ ...doc.storms[0], lat: 95 }] }, now, C), /fails its checks/);
});

test("fires: the detection total and cells as the wildfires page reads them, the same file checks, and the age limit", () => {
  const sum = fxj("hazards/fires.json"), bin = fx("hazards/fires.bin"), now = T("fires") + 6e5, C = { maxHours: MAX_AGE_HOURS.fires };
  const m = fireModel(sum, ab(bin), now, C), s = summariseFires({ summary: sum, bin }, { now });
  assert.equal(m.detections, s.detections);
  assert.equal(m.cells, s.cells);
  let total = 0; for (let i = 0; i < m.cells; i++) total += m.cnt[i];
  assert.equal(total, s.detections);
  assert.ok(m.lat.every((x) => x > -90 && x < 90) && m.lon.every((x) => x > -180 && x < 180));
  assert.equal(fireModel(sum, ab(bin), T("fires") + 8.1 * 36e5, C).stale, true);
  assert.throws(() => fireModel(sum, ab(bin.subarray(12)), now, C), /does not match/);
  assert.throws(() => fireModel({ ...sum, detections: sum.detections + 1 }, ab(bin), now, C), /do not add up/);
  const tx = fireText(m);
  assert.ok(tx.sum.startsWith("191,619 satellite fire detections in NASA FIRMS's 24 hour files, newest 4 Oct 17:15 UTC.") && /not confirmed fires/.test(tx.sum), tx.sum);
});

// ------------------------------------------------------------------ the computed sky
const sep = (a1, z1, a2, z2) => { const R = Math.PI / 180; return Math.acos(Math.min(1, Math.sin(a1 * R) * Math.sin(a2 * R) + Math.cos(a1 * R) * Math.cos(a2 * R) * Math.cos((z1 - z2) * R))) / R; };
// The tolerances the gallery's claim rests on (docs/embed-sources.md): astronomy-engine with no refraction, topocentric, of date.
export const SKY_TOLERANCE_DEG = { Moon: 0.2, other: 0.1 };
test("the Moon, Sun and planets agree with astronomy-engine (the sky pages' library) within 0.2 degrees for the Moon and 0.1 for the others, 2024 to 2030, six cities", () => {
  const worst = {};
  let lit = 0;
  for (let k = 0; k < 360; k++) {
    const ms = Date.UTC(2024, 0, 1) + ((k * 7919 * 36e5) % (7 * 365 * 864e5)), c = cities[SKY_CITY_IDS[k % 6]], obs = new Astro.Observer(c.lat, c.lon, 0), p = skyPos(ms, c.lat, c.lon);
    for (const b of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]) {
      const eq = Astro.Equator(b, new Date(ms), obs, true, true), h = Astro.Horizon(new Date(ms), obs, eq.ra, eq.dec);
      worst[b] = Math.max(worst[b] || 0, sep(p[b].alt, p[b].az, h.altitude, h.azimuth));
    }
    lit = Math.max(lit, Math.abs(Astro.Illumination("Moon", new Date(ms)).phase_fraction - p.Moon.lit));
    assert.equal(p.Moon.waxing, Astro.MoonPhase(new Date(ms)) < 180, "waxing as astronomy-engine's phase angle says");
  }
  for (const [b, d] of Object.entries(worst)) assert.ok(d < (b === "Moon" ? SKY_TOLERANCE_DEG.Moon : SKY_TOLERANCE_DEG.other), `${b}: ${d.toFixed(3)} degrees`);
  assert.ok(lit < 0.01, `lit fraction off by ${lit}`);
});

test("tonight's window and the Moon's rises and sets agree with the sky pages (site/sky.mjs) within 2 and 3 minutes", () => {
  let checked = 0;
  for (const day of ["2026-01-15", "2026-03-29", "2026-06-21", "2026-10-06", "2026-12-21"]) for (const id of SKY_CITY_IDS) {
    const c = cities[id], ref = Date.parse(`${day}T12:00:00Z`) - (c.lon / 15) * 36e5, n = skyNight(c.lat, c.lon, ref, 10), w = nightWindow({ ...c, id }, ref);
    if (w.kind === "night" && !w.startsAtData) {
      assert.equal(n.kind, "night", `${id} ${day}`);
      assert.ok(Math.abs(n.start - w.start) < 2 * 6e4 && Math.abs(n.end - w.end) < 2 * 6e4, `${id} ${day}: ${new Date(n.start).toISOString()} ${new Date(w.start).toISOString()}`);
      const ours = skyEvents(n, "Moon").events, theirs = riseSetBetween(Astro.Body.Moon, new Astro.Observer(c.lat, c.lon, 0), n.start, n.end);
      const inner = (e) => e.t > n.start + 15 * 6e4 && e.t < n.end - 15 * 6e4;
      assert.deepEqual(ours.filter(inner).map((e) => e.kind), theirs.filter(inner).map((e) => e.kind), `${id} ${day} moon events`);
      ours.filter(inner).forEach((e, i) => assert.ok(Math.abs(e.t - theirs.filter(inner)[i].t) < 3 * 6e4, `${id} ${day} moon ${e.kind}`));
      checked++;
    } else if (w.kind !== "night") assert.equal(n.kind, w.kind, `${id} ${day} polar case`);
  }
  assert.ok(checked >= 25, `${checked} nights compared`);
});

test("less than an hour before sunrise the sky widget shows the coming night, as the sky pages would from just after sunrise", () => {
  const c = cities.pune, w = nightWindow({ ...c, id: "pune" }, Date.parse("2026-10-05T12:00:00Z"));
  const atDawn = skyNight(c.lat, c.lon, w.end - 30 * 6e4, 10), next = nightWindow({ ...c, id: "pune" }, w.end + 6e4);
  assert.equal(atDawn.underWay, false);
  assert.ok(Math.abs(atDawn.start - next.start) < 2 * 6e4 && Math.abs(atDawn.end - next.end) < 2 * 6e4);
  const earlier = skyNight(c.lat, c.lon, w.end - 90 * 6e4, 10);
  assert.ok(earlier.underWay && Math.abs(earlier.end - w.end) < 2 * 6e4, "with more than an hour left, the rest of the night");
});

test("the sky words: the window, the Moon, the planets in the dark and the cloud range, with out-of-date and missing cloud said plainly", () => {
  const clouds = fxj("sky/clouds-20261006.json"), now = T("clouds") + 30 * 6e4, c = cities.pune, C = { cloudHours: SKY_MAX_AGE_HOURS.clouds };
  const n = skyNight(c.lat, c.lon, now, 10), cl = skyCloud(clouds, "pune", n, now, C);
  assert.ok(cl.hours.length > 6 && cl.hours.every((h) => h.t > n.start - 36e5 && h.t < n.end), "the forecast hours of the night");
  const fmt = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: c.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  const tx = skyText(c, n, cl, fmt, true);
  assert.match(tx.sum, /^Tonight in Pune, \d\d:\d\d to \d\d:\d\d local time: Moon \d+% lit \((waxing|waning)\), /);
  const lo = Math.round(Math.min(...cl.hours.map((h) => h.cloud))), hi = Math.round(Math.max(...cl.hours.map((h) => h.cloud)));
  assert.ok(tx.sum.includes(`Cloud ${lo === hi ? `${lo}%` : `${lo} to ${hi}%`} in MET Norway's forecast of 6 Oct 01:17 UTC.`), tx.sum);
  assert.equal(skyCloud(clouds, "pune", n, T("clouds") + 6.1 * 36e5, C).stale, true);
  assert.match(skyText(c, n, { ...cl, stale: true }, fmt, true).sum, /cloud forecast of 6 Oct 01:17 UTC is out of date, so no cloud is shown\.$/);
  assert.match(skyText(c, n, null, fmt, false).sum, /The cloud forecast could not be loaded\.$/);
  assert.equal(skyCloud(clouds, "atlantis", n, now, C), null);
  assert.equal(skyCloud({ cities: { pune: { ...clouds.cities.pune, hours: [{ t: "x", cloud: 5 }] } } }, "pune", n, now, C), null);
  // Tromsø near midsummer: the Sun does not set, and nothing is called dark
  const t = cities.tromso, mid = skyNight(t.lat, t.lon, Date.parse("2026-06-21T12:00:00Z"), 10);
  assert.equal(mid.kind, "midnightSun");
  assert.match(skyText(t, mid, null, fmt, true).sum, /^The Sun does not set tonight in Tromsø/);
});

// ------------------------------------------------------------------ the coastline and the widget files
test("the coastline text decodes to the simplified outline, point for point", () => {
  const runs = coastRuns(coast), back = wCoastRuns(ENC);
  assert.equal(back.length, runs.length);
  runs.forEach((r, i) => {
    const pts = back[i], last = r[r.length - 1];
    assert.deepEqual([pts[0], pts[1]], [r[0][0] / 2 - 180, 90 - r[0][1] / 2]);
    assert.deepEqual([pts[pts.length - 2], pts[pts.length - 1]], [last[0] / 2 - 180, 90 - last[1] / 2]);
  });
  assert.ok(ENC.length < 7000, `${ENC.length} characters`);
  assert.ok(/^[A-Za-z0-9_|-]+$/.test(ENC), "only base64url digits and the separator");
  assert.equal(COAST_EPS, 0.4);
});

const SIZE_LIMIT = 30 * 1024;
test("each widget page is one self-contained file under 30 KB", () => {
  for (const [id, h] of Object.entries(DOCS)) {
    const n = Buffer.byteLength(h);
    assert.ok(n < SIZE_LIMIT, `${id}: ${n} bytes`);
    assert.equal((h.match(/<script/g) || []).length, 1, `${id}: one inline script`);
    assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import|url\(/.test(h), `${id}: nothing loaded from a file`);
    assert.doesNotThrow(() => new vm.Script(scriptOf(h)), `${id}: the script parses`);
  }
});

test("each widget page is noindex, forbids outside requests in its content security policy, and has no tracking, storage or cookies", () => {
  for (const [id, h] of Object.entries(DOCS)) {
    assert.ok(h.includes('<meta name="robots" content="noindex">'), id);
    assert.ok(!h.includes('rel="canonical"'), `${id}: no canonical`);
    assert.match(h, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self';[^"]*">/);
    assert.ok(!/frame-ancestors|X-Frame-Options/i.test(h), `${id}: nothing blocks framing`);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|eval\(/.test(h), id);
    // every web address in the page is the site's own credit link, or the text of NASA's acknowledgement
    const urls = [...h.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    for (const u of urls) assert.ok(u.startsWith(`${SITE.url}/`) || u === "https://earthdata.nasa.gov/lance", `${id}: ${u}`);
    // the only fetches are relative, into the live folder
    assert.match(scriptOf(h), /wRun\(\{base:"\.\.\/\.\.\/live\/"/);
  }
});

test("each widget page shows its source credit and one link back to the matching live page, with no em dashes or emoji", () => {
  for (const w of WIDGETS) {
    const h = DOCS[w.id], foot = h.match(/<footer>([\s\S]*?)<\/footer>/)[1];
    assert.ok(foot.includes(w.credit.replace(/'/g, "&#39;").replace(/&#39;/g, "'")) || foot.includes(w.credit), `${w.id}: credit`);
    const links = [...foot.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    assert.equal(links.length, 1, `${w.id}: one link`);
    assert.equal(links[0][1], `${SITE.url}/${w.page}`);
    assert.equal(links[0][2], "Radar Around You");
    assert.match(links[0][0], /target="_blank" rel="noopener"/);
    assert.ok(!EM_DASH.test(h) && !EMOJI.test(h), `${w.id}: house style`);
    assert.ok(h.includes('role="img" aria-label=') && h.includes('aria-live="polite"'), `${w.id}: text alternative and summary`);
    assert.ok(h.includes("prefers-reduced-motion"), `${w.id}: reduced motion`);
  }
  assert.ok(DOCS.wildfires.includes("We acknowledge the use of data and/or imagery from NASA&#39;s Land, Atmosphere Near real-time Capability") || DOCS.wildfires.includes("We acknowledge the use of data and/or imagery from NASA's Land, Atmosphere Near real-time Capability"), "NASA's acknowledgement, in full");
  assert.ok(DOCS["tonights-sky"].includes("MET Norway") && DOCS["tonights-sky"].includes("CC BY 4.0"));
});

test("the widget scripts hold every function they call (run in a sandbox, each defines wRun and its widget's drawing)", () => {
  for (const w of WIDGETS) {
    const src = scriptOf(DOCS[w.id]).replace(/^\(function\(\)\{\n/, "").replace(/\nwRun\(\{base:[\s\S]*$/, "");
    const ctx = vm.createContext({ location: { search: "?city=london" }, Intl, Date, Math, JSON });
    vm.runInContext(src, ctx);
    for (const name of ["wTime", "wUtc", "wAgo", "wOptions", "wLoad", "wRun", ...w.fns.map((f) => f.name)]) assert.equal(typeof ctx[name], "function", `${w.id}: ${name}`);
  }
});

// ------------------------------------------------------------------ the gallery
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "embed-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const appFile = path.join(tmp, "radar.html");
fs.writeFileSync(appFile, '<title>Radar Around You</title>\n<div id="app"></div>\n');
const out = path.join(tmp, "out");
build({ outDir: out, appFile, publicDir: null, noindex: false });
const gallery = fs.readFileSync(path.join(out, GALLERY_FILE), "utf8");

test("the build writes the gallery and the five widget pages; the gallery is in the sitemap and llms.txt, the widgets in neither", () => {
  for (const id of WIDGET_IDS) assert.ok(fs.existsSync(path.join(out, widgetFile(id))), id);
  const sm = fs.readFileSync(path.join(out, "sitemap.xml"), "utf8"), llms = fs.readFileSync(path.join(out, "llms.txt"), "utf8");
  assert.ok(sm.includes(`<loc>${SITE.url}/embed/</loc>`));
  assert.ok(llms.includes(`(${SITE.url}/embed/): Five free live widgets`));
  for (const id of WIDGET_IDS) { assert.ok(!sm.includes(`/embed/${id}/`), id); assert.ok(!llms.includes(`/embed/${id}/`), id); }
  assert.ok(!fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("/embed/"));
  const home = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(home.includes('<a href="embed/">live widgets for your own website</a>'), "the home page links the gallery");
});

test("the gallery meets the readiness checklist: title, description, canonical, robots, headings, structured data, sources", () => {
  const title = gallery.match(/<title>([^<]*)<\/title>/)[1], desc = gallery.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.ok(title.length > 0 && title.length < 60, `title ${title.length}`);
  assert.ok(desc.length > 0 && desc.length < 160, `description ${desc.length}`);
  assert.ok(gallery.includes(`<link rel="canonical" href="${SITE.url}/embed/">`) && gallery.includes(robotsMeta(false)));
  const lv = [...gallery.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  assert.equal(lv.filter((x) => x === 1).length, 1);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i] <= lv[i - 1] + 1, `h${lv[i - 1]} then h${lv[i]}`);
  const ld = [...gallery.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  const wp = ld.find((o) => o["@type"] === "WebPage");
  assert.ok(wp && wp.inLanguage === "en" && wp.isPartOf.url === `${SITE.url}/` && wp.url === `${SITE.url}/embed/` && wp.breadcrumb && ld.some((o) => o["@type"] === "BreadcrumbList"));
  assert.ok(!ld.some((o) => o["@type"] === "FAQPage"));
  assert.match(gallery, /<h2 id="sources">Sources<\/h2>\s*<ul class="sources"><li><a href="https:\/\//);
  for (const t of gallery.match(/<table>[\s\S]*?<\/table>/g)) { assert.match(t, /<caption>[^<]+<\/caption>/); assert.ok(!/<th(?! scope="col")[ >]/.test(t)); }
  assert.ok(!/>\s*(click here|here|read more|more|link)\s*</i.test(gallery));
  assert.ok(!EM_DASH.test(gallery) && !EMOJI.test(gallery));
});

test("the gallery's text is readable without JavaScript: every widget's default snippet is in the HTML as text, and the generator is progressive", () => {
  const pres = [...gallery.matchAll(/<pre class="snip"><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.deepEqual(pres, WIDGET_IDS.map((id) => defaultSnippet(id)));
  assert.ok(gallery.includes('<form id="gen" class="gen" hidden>'), "the generator is hidden until its script runs");
  assert.ok(gallery.includes("<noscript>"));
  for (const w of WIDGETS) assert.ok(gallery.includes(`<h3 id="w-${w.id}">${w.name.replace(/'/g, "&#39;")}</h3>`) || gallery.includes(`<h3 id="w-${w.id}">${w.name}</h3>`), w.id);
  // the words of the credit explanation
  assert.match(gallery, /It is a credit for the work/);
  assert.match(gallery, /keyword-rich, hidden or low-quality links in widgets/);
  assert.doesNotThrow(() => new vm.Script(galleryScript(embedSpec())));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(galleryScript(embedSpec())), "the generator never writes HTML from values");
});
