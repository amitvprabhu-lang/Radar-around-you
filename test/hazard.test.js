import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { summariseQuakes, summariseKp, summariseWind, summariseGrid, summariseSpace, summariseApproaches, summariseStorms, summariseFires, decodeFireCells, objectName,
  nearestPlace, placeLabel, freshness, parseTime, isoZ, StaleError, HAZARD_PAGES, RIGHT_NOW_FILE, MAX_AGE_HOURS, TERMS_VERIFIED, PLACE_MAX_KM } from "../site/hazard.mjs";
import { quakesDoc, kpRows, windDoc, gridBytes, gridMeta, approachesDoc, stormsDoc, gdacsEvents, fireFiles, tinyPlaces, GEN, realFeeds, realPlaces, REAL_NOW } from "./helpers/hazardfixture.mjs";

const now = new Date("2026-10-05T18:30:00Z");

test("the registry names the five hazard pages with fixed addresses, and every feed has a maximum age and a terms flag", () => {
  assert.deepEqual(HAZARD_PAGES.map((p) => p.file), ["earthquakes-today", "aurora-tonight", "asteroid-close-approaches", "tropical-storms-now", "wildfires-today"].map((s) => `${s}/index.html`));
  assert.equal(RIGHT_NOW_FILE, "right-now/index.html");
  for (const p of HAZARD_PAGES) for (const f of p.feeds) { assert.ok(MAX_AGE_HOURS[f] > 0, f); assert.equal(typeof TERMS_VERIFIED[f], "boolean", f); }
  assert.deepEqual({ quakes: 3, kp: 8, spaceweather: 6, storms: 12, closeapproaches: 48 }, Object.fromEntries(["quakes", "kp", "spaceweather", "storms", "closeapproaches"].map((k) => [k, MAX_AGE_HOURS[k]])), "the design's limits");
});

test("times: a zone-less time is UTC, anything that is not an ISO time is refused, and the output form is fixed", () => {
  assert.equal(parseTime("2026-10-05T15:00:00"), Date.parse("2026-10-05T15:00:00Z"));
  assert.equal(parseTime("2026-10-05T15:00:00+02:00"), Date.parse("2026-10-05T13:00:00Z"));
  for (const bad of ["", "yesterday", "2026-10-05", 5, null, "2026-10-05T15:00:00Zjunk"]) assert.ok(Number.isNaN(parseTime(bad)), String(bad));
  assert.equal(isoZ(Date.parse("2026-10-05T15:00:00.000Z")), "2026-10-05T15:00:00Z");
});

test("freshness: within the limit is fine, older throws a StaleError unless the snapshot copy allows it, and a future time is an error", () => {
  const t = Date.parse(GEN);
  assert.equal(freshness("quakes", t, new Date(t + 3 * 3600e3)), false);
  assert.throws(() => freshness("quakes", t, new Date(t + 3 * 3600e3 + 1000)), (e) => e instanceof StaleError && e.stale && /more than 3 hours old/.test(e.message));
  assert.equal(freshness("quakes", t, new Date(t + 30 * 3600e3), { allowStale: true }), true);
  assert.throws(() => freshness("quakes", t + 2 * 3600e3, new Date(t)), /in the future/);
});

test("earthquakes: counts, bands, the largest, hours, place labels and statuses come out of the feed exactly", () => {
  const s = summariseQuakes(quakesDoc(), { now });
  assert.equal(s.dataTime, GEN);
  assert.equal(s.windowStart, "2026-10-04T18:00:00Z");
  assert.equal(s.count, 8, "the two older events are outside the 24 hours");
  assert.equal(s.below25, 1);
  assert.equal(s.minMag, 2.45);
  assert.deepEqual(s.bands.map((b) => b.count), [4, 2, 1]);
  assert.equal(s.below25 + s.bands.reduce((a, b) => a + b.count, 0), s.count, "the bands add up");
  assert.equal(s.ge45, 3);
  assert.equal(s.ge6, 1);
  assert.equal(s.largest.mag, 6.4);
  assert.equal(s.largest.place, "120 km S of Suva, Fiji");
  assert.deepEqual(s.top.map((e) => e.id), ["a1", "a2", "a3", "a4", "a5", "a6", "a8", "a7"]);
  assert.equal(s.hourly.length, 24);
  assert.equal(s.hourly.reduce((a, h) => a + h.count, 0), 8);
  assert.deepEqual([s.hourly[0].count, s.hourly[1].count, s.hourly[12].count, s.hourly[23].count], [1, 1, 1, 3]);
  assert.equal(s.hourly[23].start, "2026-10-05T17:00:00Z");
  assert.deepEqual(s.places, [{ label: "Alaska", count: 3 }, { label: "CA", count: 2 }, { label: "Fiji", count: 1 }, { label: "Hawaii", count: 1 }, { label: "Kermadec Islands region", count: 1 }]);
  assert.deepEqual([s.reviewed, s.automatic], [6, 2]);
  assert.equal(s.deepest.id, "a1");
  assert.equal(s.points.length, 8);
  assert.equal(placeLabel("Kermadec Islands region"), "Kermadec Islands region");
  assert.equal(placeLabel(""), "No place given");
});

test("earthquakes: zero events above a magnitude, or none at all in the 24 hours, are counted as zero, not refused", () => {
  const small = quakesDoc({ events: quakesDoc().events.filter((e) => e.mag < 4.5) });
  const s = summariseQuakes(small, { now });
  assert.deepEqual([s.ge45, s.ge6, s.bands[2].count], [0, 0, 0]);
  const quiet = summariseQuakes(quakesDoc({ events: [quakesDoc().events[8]] }), { now });
  assert.equal(quiet.count, 0);
  assert.equal(quiet.largest, null);
  assert.equal(quiet.minMag, null);
  assert.equal(quiet.hourly.reduce((a, h) => a + h.count, 0), 0);
});

test("earthquakes: the guard refuses an empty feed, impossible magnitudes and positions, and a stale or future feed", () => {
  assert.throws(() => summariseQuakes(quakesDoc({ events: [] }), { now }), /no events at all/);
  assert.throws(() => summariseQuakes({ generated: GEN }, { now }), /no events list/);
  const bad = (patch) => quakesDoc({ events: [{ ...quakesDoc().events[0], ...patch }] });
  assert.throws(() => summariseQuakes(bad({ mag: 11 }), { now }), /outside -2 to 10/);
  assert.throws(() => summariseQuakes(bad({ lat: 95 }), { now }), /impossible position/);
  assert.throws(() => summariseQuakes(bad({ depth: 5000 }), { now }), /depth/);
  assert.throws(() => summariseQuakes(bad({ time: "soon" }), { now }), /not a time/);
  assert.throws(() => summariseQuakes(quakesDoc(), { now: new Date("2026-10-05T21:00:01Z") }), StaleError);
  assert.equal(summariseQuakes(quakesDoc(), { now: new Date("2026-10-07T00:00:00Z"), allowStale: true }).stale, true);
});

test("Kp: the latest value, a missing latest slot, the maximum and the periods at Kp 5 or more", () => {
  const s = summariseKp(kpRows(), { now });
  assert.equal(s.dataTime, "2026-10-05T15:00:00Z");
  assert.deepEqual(s.latest, { t: "2026-10-05T15:00:00Z", kp: 2.67 });
  assert.equal(s.missingLatest, false);
  assert.deepEqual(s.max, { t: "2026-10-04T12:00:00Z", kp: 6 });
  assert.equal(s.atLeastG1, 3, "5, 5.33 and 6; 4.67 is under 5");
  assert.equal(s.rows.length, 16);
  assert.equal(s.first, "2026-10-03T18:00:00Z");
  const gap = kpRows(); gap[15] = { t: gap[15].t, kp: null };
  const m = summariseKp(gap, { now });
  assert.equal(m.missingLatest, true);
  assert.deepEqual(m.latest, { t: "2026-10-05T12:00:00Z", kp: 4 });
  assert.equal(m.dataTime, "2026-10-05T12:00:00Z", "the data time is the newest row with a value");
  assert.equal(m.newestTag, "2026-10-05T15:00:00Z");
  assert.equal(m.missing, 1);
  // a newest row without a value does not count as fresh: the age is that of the newest value, 12:00
  assert.equal(summariseKp(gap, { now: new Date("2026-10-05T20:00:00Z") }).stale, false);
  assert.throws(() => summariseKp(gap, { now: new Date("2026-10-05T20:00:01Z") }), (e) => e instanceof StaleError && /kp data from 2026-10-05T12:00:00Z is more than 8 hours old/.test(e.message));
  assert.throws(() => summariseKp([{ t: "2026-10-05T15:00:00", kp: 12 }], { now }), /outside 0 to 9/);
  assert.throws(() => summariseKp([{ t: "2026-10-05T15:00:00", kp: null }], { now }), /no row has a Kp value/);
  assert.throws(() => summariseKp([], { now }), /no rows/);
  assert.equal(summariseKp(kpRows(), { now: new Date("2026-10-05T23:00:00Z") }).stale, false, "8 hours after the newest tag is still current");
  assert.throws(() => summariseKp(kpRows(), { now: new Date("2026-10-05T23:00:01Z") }), (e) => e instanceof StaleError && /more than 8 hours old/.test(e.message));
});

test("solar wind: the newest value of each field, its six hour range, the alerts newest first, and the guard", () => {
  const s = summariseWind(windDoc(), { now });
  assert.deepEqual(s.fields.speed, { now: 480, at: "2026-10-05T17:55:00Z", min: 400, max: 520.4, n: 3 });
  assert.deepEqual(s.fields.density, { now: 3.2, at: "2026-10-05T15:00:00Z", min: 3.2, max: 5, n: 2 }, "the newest density is the newest that has one");
  assert.deepEqual([s.fields.bz.now, s.fields.bz.min, s.fields.bz.max], [-2, -6.25, 1.5]);
  assert.deepEqual(s.alerts.map((a) => a.kind), ["warning", "alert"]);
  assert.equal(s.alertsReplaced, 0);
  // a warning that a later extension replaced (the extension names its serial in "supersedes") is left out
  const ext = summariseWind(windDoc({ alerts: [
    { kind: "warning", serial: 10, headline: "WARNING: Geomagnetic K-index of 4 expected", issued: "2026-10-05T09:10:00Z", supersedes: null },
    { kind: "warning", serial: 11, headline: "EXTENDED WARNING: Geomagnetic K-index of 4 expected", issued: "2026-10-05T12:10:00Z", supersedes: 10 },
    { kind: "alert", serial: 12, headline: "ALERT: Geomagnetic K-index of 4", issued: "2026-10-05T13:00:00Z", supersedes: null },
  ] }), { now });
  assert.deepEqual(ext.alerts.map((a) => a.headline), ["ALERT: Geomagnetic K-index of 4", "EXTENDED WARNING: Geomagnetic K-index of 4 expected"]);
  assert.equal(ext.alertsReplaced, 1);
  assert.equal(s.spacecraft[0], "SOLAR1");
  assert.throws(() => summariseWind(windDoc({ points: [{ t: "2026-10-05T17:00:00Z", speed: 5000 }] }), { now }), /outside 100 to 3000/);
  assert.throws(() => summariseWind(windDoc({ points: [{ t: "2026-10-05T17:00:00Z", speed: null, bz: 1 }] }), { now }), /no point has a solar wind speed/);
});

test("aurora grid: the highest value and how far towards the equator a value of 10 or more reaches, per hemisphere", () => {
  const s = summariseGrid(gridMeta, gridBytes(), { now });
  assert.equal(s.peak, 30);
  assert.deepEqual(s.north, { max: 30, edge: 58, pole: 65 });
  assert.deepEqual(s.south, { max: 20, edge: 75, pole: 75 }, "9 is under the threshold");
  assert.deepEqual(s.points, [[-75, -60], [58, -160], [65, 10]], "the grid points of 10 or more, longitude from -180 to 180");
  const none = summariseGrid(gridMeta, gridBytes([[60, 0, 9]]), { now });
  assert.deepEqual(none.north, { max: 9, edge: null, pole: null });
  assert.throws(() => summariseGrid(gridMeta, Buffer.alloc(100), { now }), /expected 65160/);
  assert.throws(() => summariseGrid(gridMeta, gridBytes([[10, 0, 101]]), { now }), /over 100/);
});

test("the aurora summary needs Kp; stale or missing solar wind and grid are left out with a reason", () => {
  const all = summariseSpace({ kp: kpRows(), spaceweather: windDoc(), aurora: { meta: gridMeta, grid: gridBytes() } }, { now });
  assert.equal(all.dataTime, "2026-10-05T17:55:00Z", "the newest of the three feeds");
  assert.ok(all.wind && all.grid);
  const old = summariseSpace({ kp: kpRows(), spaceweather: windDoc({ updated: "2026-10-05T10:00:00Z" }), aurora: null }, { now });
  assert.equal(old.wind, null);
  assert.equal(old.windReason, "older than 6 hours");
  assert.equal(old.gridReason, "not available in this build");
  assert.equal(old.dataTime, "2026-10-05T15:00:00Z");
  // a broken (not merely old) solar wind or grid file leaves only its section out, with the reason; the Kp page stands
  const broken = summariseSpace({ kp: kpRows(), spaceweather: windDoc({ points: [{ t: "2026-10-05T17:00:00Z", speed: 9999 }] }), aurora: { meta: gridMeta, grid: Buffer.alloc(10) } }, { now });
  assert.equal(broken.wind, null);
  assert.equal(broken.windReason, "not usable: it failed our checks");
  assert.equal(broken.grid, null);
  assert.equal(broken.gridReason, "not usable: it failed our checks");
  assert.deepEqual(broken.warnings, ["hazard: spaceweather: point 0 has speed 9999, outside 100 to 3000", "hazard: aurora: the grid has 10 values, expected 65160"]);
  assert.equal(broken.dataTime, "2026-10-05T15:00:00Z");
  assert.deepEqual(all.warnings, []);
});

test("close approaches: the passes from the day the list was read, the first, nearest, fastest and faintest, and those inside the Moon's distance", () => {
  const s = summariseApproaches(approachesDoc(), { now });
  assert.equal(s.dataTime, "2026-10-05T00:00:00Z", "the day the list was read");
  assert.equal(s.readTime, GEN);
  assert.equal(s.earlier, 1, "2026 ZZ passed the day before");
  assert.deepEqual(s.upcoming.map((a) => a.name), ["2026 AA", "2026 BB", "2019 CC", "2026 EE", "2001 DD"], "2026 AA, earlier on the day read, is kept");
  assert.equal(s.next.name, "2026 AA");
  assert.equal(s.nearest.name, "2019 CC");
  assert.equal(s.fastest.name, "2001 DD");
  assert.equal(s.faintest.name, "2019 CC", "the highest H; an object without H is never picked");
  assert.equal(s.insideMoon, 1);
  assert.equal(s.upcoming[1].sigma, "1 day 2 h 1 min");
  assert.equal(s.upcoming[2].sigma, "under 1 minute");
  assert.equal(s.upcoming[3].h, null);
  assert.equal(s.last, "2026-11-20T23:59:00Z");
  assert.equal(objectName("524522 Zoozve (2002 VE68"), "524522 Zoozve (2002 VE68)", "the bracket the collector leaves open is closed");
  assert.equal(objectName("2026 TX1"), "2026 TX1", "no brackets: unchanged");
  assert.equal(objectName("524522 Zoozve (2002 VE68)"), "524522 Zoozve (2002 VE68)", "balanced: unchanged");
  assert.equal(objectName("433 Eros (A898 PA (x))"), "433 Eros (A898 PA (x))", "nested and balanced: unchanged");
  assert.equal(objectName("433 Eros (A898 PA (x)"), "433 Eros (A898 PA (x))", "nested with one left open: one closed");
  assert.equal(objectName("A (B (C"), "A (B (C))", "two left open: both closed");
  assert.equal(objectName("x) y"), "x) y", "a stray closing bracket is left alone");
});

test("close approaches: an empty list (or one with only passes before the day read), a zero or too large distance, a bad speed and a stale list are refused", () => {
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [] }), { now }), /no close approach in its window/);
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [approachesDoc().approaches[0]] }), { now }), /no close approach in its window/);
  // the read time within the day changes nothing
  const a = summariseApproaches(approachesDoc(), { now }), b = summariseApproaches(approachesDoc({ generated: "2026-10-05T23:10:00Z" }), { now: new Date("2026-10-05T23:30:00Z") });
  assert.deepEqual({ ...a, readTime: null, stale: null }, { ...b, readTime: null, stale: null });
  const row = approachesDoc().approaches[1];
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [{ ...row, distAu: 0 }] }), { now }), /not above 0/);
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [{ ...row, distAu: 0.2 }] }), { now }), /up to 0.05/);
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [{ ...row, speedKms: 0 }] }), { now }), /speed/);
  assert.throws(() => summariseApproaches(approachesDoc({ ldKm: 10 }), { now }), /lunar distance/);
  assert.throws(() => summariseApproaches(approachesDoc(), { now: new Date("2026-10-07T18:00:01Z") }), StaleError);
});

test("storms: strongest first with the Saffir-Simpson category from the wind; no storms is a valid answer; GDACS cyclones are read when given", () => {
  const s = summariseStorms(stormsDoc(), { now });
  assert.deepEqual(s.storms.map((x) => [x.name, x.category]), [["Rachel <b>", 3], ["Alpha", 0]]);
  assert.equal(s.storms[1].track.length, 2);
  assert.equal(s.earliestAdvisory, "2026-10-05T15:00:00Z");
  const none = summariseStorms(stormsDoc({ storms: [] }), { now, events: { list: gdacsEvents, dataTime: "2026-10-05T17:00:00Z" } });
  assert.equal(none.storms.length, 0);
  assert.deepEqual(none.gdacs.map((g) => g.name), ["Tropical Cyclone KOINU-26"], "only tropical cyclones");
  // the data time is the newest advisory, not when the list was read; with no storm it is the day the list was read
  assert.deepEqual([s.dataTime, s.dataKind, s.readTime], ["2026-10-05T15:00:00Z", "advisory", GEN]);
  const newer = summariseStorms(stormsDoc({ storms: stormsDoc().storms.map((x, i) => (i ? { ...x, updated: "2026-10-05T16:30:00Z" } : x)) }), { now });
  assert.equal(newer.dataTime, "2026-10-05T16:30:00Z", "an update time counts too");
  assert.deepEqual([none.dataTime, none.dataKind], ["2026-10-05T00:00:00Z", "day"]);
  const later = summariseStorms(stormsDoc({ generated: "2026-10-05T18:50:00Z" }), { now: new Date("2026-10-05T19:00:00Z") });
  assert.deepEqual({ ...later, readTime: null }, { ...s, readTime: null }, "a later read of the same list changes nothing but the read time");
  const oldEvents = summariseStorms(stormsDoc({ storms: [] }), { now, events: { list: gdacsEvents, dataTime: "2026-10-04T00:00:00Z" } });
  assert.equal(oldEvents.gdacs, null);
  assert.equal(oldEvents.gdacsReason, "older than 12 hours");
  const st = stormsDoc().storms[0];
  assert.throws(() => summariseStorms(stormsDoc({ storms: [{ ...st, windKt: 400 }] }), { now }), /outside 0 to 250/);
  assert.throws(() => summariseStorms(stormsDoc({ storms: [{ ...st, pressureMb: 500 }] }), { now }), /pressure/);
  assert.throws(() => summariseStorms(stormsDoc({ storms: [{ ...st, track: [{ hours: 12, lat: 99, lon: 0, valid: GEN }] }] }), { now }), /forecast point 0/);
  assert.throws(() => summariseStorms(stormsDoc(), { now: new Date("2026-10-06T06:00:01Z") }), StaleError);
});

test("fires: cells decode, the counts add up, the densest cells name the nearest place only within 300 km, and broken files are refused", () => {
  const s = summariseFires(fireFiles(), { now, places: tinyPlaces });
  assert.equal(s.detections, 72);
  assert.equal(s.cells, 3);
  assert.deepEqual(s.satellites.map((x) => [x.name, x.count]), [["Suomi NPP", 42], ["NOAA-20", 20], ["NOAA-21", 10]]);
  assert.deepEqual(s.dense.map((d) => d.detections), [40, 25, 7]);
  assert.equal(s.dense[0].place.name, "Pune");
  assert.ok(s.dense[0].place.km < 20, String(s.dense[0].place.km));
  assert.equal(s.dense[1].place, null, "the Southern Ocean cell is far from every place");
  assert.ok(s.dense[1].nearestKm > PLACE_MAX_KM);
  assert.deepEqual([s.dense[0].lat, s.dense[0].lon], [18.625, 73.875], "the cell centre");
  assert.equal(s.mapSquares, 2, "the two cells near Pune share a one degree square");
  assert.equal(s.lowLeftOut, 9);
  const { summary, bin } = fireFiles();
  assert.throws(() => summariseFires({ summary: { ...summary, cells: 0, detections: 0, bySatellite: {} }, bin: Buffer.alloc(0) }, { now, places: tinyPlaces }), /no detection cells/);
  assert.throws(() => summariseFires({ summary, bin: bin.subarray(0, 13) }, { now, places: tinyPlaces }), /whole number/);
  assert.throws(() => summariseFires({ summary: { ...summary, detections: 99 }, bin }, { now, places: tinyPlaces }), /hold 72 detections but fires.json says 99/);
  assert.throws(() => summariseFires({ summary: { ...summary, bySatellite: { N: 1 } }, bin }, { now, places: tinyPlaces }), /do not add up/);
  assert.throws(() => decodeFireCells(Buffer.from([255, 255, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), 0.25), /outside the grid/);
  assert.throws(() => summariseFires(fireFiles(), { now: new Date("2026-10-06T00:00:01Z"), places: tinyPlaces }), StaleError);
  assert.equal(nearestPlace(19.07, 72.88, tinyPlaces).name, "Mumbai");
});

test("every summary gives the exact values of the real collector output of 5 October 2026", () => {
  const r = realFeeds(), places = realPlaces();
  const q = summariseQuakes(r.quakes, { now: REAL_NOW });
  assert.deepEqual([q.dataTime, q.feedEvents, q.count, q.below25, q.minMag, q.bands.map((b) => b.count), q.ge45, q.ge6], ["2026-10-05T18:40:02Z", 295, 40, 2, 2.46, [28, 10, 0], 10, 0]);
  assert.deepEqual([q.largest.id, q.largest.mag, q.largest.place], ["us6000tzlp", 5.3, "central Mid-Atlantic Ridge"]);
  assert.deepEqual([q.reviewed, q.automatic, q.places[0], q.placeLabels], [32, 8, { label: "Alaska", count: 6 }, 25]);
  const sp = summariseSpace({ kp: r.kp, spaceweather: r.spaceweather, aurora: r.aurora }, { now: REAL_NOW });
  assert.deepEqual([sp.kp.latest, sp.kp.max, sp.kp.atLeastG1, sp.dataTime], [{ t: "2026-10-05T15:00:00Z", kp: 3.67 }, { t: "2026-10-04T18:00:00Z", kp: 5.67 }, 3, "2026-10-05T18:34:00Z"]);
  assert.deepEqual(sp.wind.fields.speed, { now: 590.1, at: "2026-10-05T18:30:00Z", min: 540.3, max: 600.97, n: 71 });
  assert.deepEqual([sp.wind.fields.bz.now, sp.wind.fields.bz.min, sp.wind.fields.bz.max], [-2.72, -4.14, 1.25]);
  assert.deepEqual([sp.wind.alerts.length, sp.wind.alertsReplaced], [12, 2], "14 messages, 2 of them replaced by an extension");
  assert.deepEqual([sp.grid.north, sp.grid.south, sp.grid.points.length], [{ max: 43, edge: 61, pole: 77 }, { max: 43, edge: 46, pole: 88 }, 647]);
  const ca = summariseApproaches(r.closeapproaches, { now: REAL_NOW });
  assert.deepEqual([ca.dataTime, ca.upcoming.length, ca.earlier, ca.next.name, ca.nearest.name, ca.nearest.distLd, ca.fastest.name, ca.fastest.speedKms, ca.insideMoon, ca.last],
    ["2026-10-05T00:00:00Z", 35, 0, "2026 TD1", "2025 UK9", 0.82, "2001 KF54", 16.42, 1, "2026-11-30T17:51:36Z"]);
  const st = summariseStorms(r.storms, { now: REAL_NOW });
  assert.deepEqual([st.dataTime, st.dataKind, st.storms.map((x) => [x.name, x.windKt, x.category, x.pressureMb, x.track.length])], ["2026-10-05T15:00:00Z", "advisory", [["Rachel", 75, 1, 976, 8]]]);
  const f = summariseFires(r.fires, { now: REAL_NOW, places });
  assert.deepEqual([f.detections, f.cells, f.lowLeftOut, f.satellites.map((x) => [x.code, x.count]), f.mapSquares, f.north, f.south],
    [192083, 16177, 29225, [["N20", 64945], ["N21", 63713], ["N", 63425]], 4329, 49862, 142221]);
  assert.deepEqual([f.dense[0].lat, f.dense[0].lon, f.dense[0].detections, f.dense[0].place.name, Math.round(f.dense[0].place.km)], [-2.875, -54.125, 1463, "Mojuí dos Campos", 61]);
  assert.equal(f.dense.filter((d) => d.place === null).length, 1);
  for (const d of f.dense) assert.ok(d.place === null ? d.nearestKm > PLACE_MAX_KM : d.place.km <= PLACE_MAX_KM);
});

test("the earthquake snapshot bundled in public/ gives its exact values", () => {
  const s = summariseQuakes(JSON.parse(fs.readFileSync(fileURLToPath(new URL("../public/quakes.json", import.meta.url)), "utf8")), { now: new Date("2026-10-04T14:00:00Z") });
  assert.deepEqual([s.dataTime, s.count, s.below25, s.bands.map((b) => b.count), s.ge45, s.ge6, s.largest.id, s.largest.mag], ["2026-10-04T13:49:21Z", 48, 0, [29, 19, 0], 19, 0, "us6000tzer", 5.9]);
});

test("earthquake boundaries: an event exactly 24 hours before the feed's time is out, one at the feed's time is in, and 4.5 and 6.0 count in the higher band", () => {
  const ev = (id, mag, time) => ({ id, mag, place: "x, Fiji", time, lat: 1, lon: 1, depth: 10, status: "reviewed", felt: 0, url: "" });
  const s = summariseQuakes({ generated: GEN, events: [ev("edge", 3, "2026-10-04T18:00:00Z"), ev("justin", 3, "2026-10-04T18:00:01Z"), ev("atgen", 3, GEN), ev("m45", 4.5, "2026-10-05T10:00:00Z"), ev("m6", 6.0, "2026-10-05T11:00:00Z"), ev("m449", 4.49, "2026-10-05T12:00:00Z"), ev("m599", 5.99, "2026-10-05T13:00:00Z")] }, { now });
  assert.equal(s.count, 6, "the event at exactly 24 hours before is left out");
  assert.ok(!s.top.some((e) => e.id === "edge") && s.top.some((e) => e.id === "justin") && s.top.some((e) => e.id === "atgen"));
  assert.deepEqual(s.bands.map((b) => b.count), [3, 2, 1], "two of 3 and 4.49 are under 4.5; 4.5 and 5.99 are in 4.5 to under 6; 6.0 is 6 and above");
  assert.deepEqual([s.ge45, s.ge6], [3, 1]);
  assert.equal(s.hourly[0].count, 1, "one second after the edge is in the first hour");
  assert.equal(s.hourly[23].count, 1, "the feed's own time is in the last hour");
});
