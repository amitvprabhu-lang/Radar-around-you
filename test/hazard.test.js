import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(m.dataTime, "2026-10-05T15:00:00Z");
  assert.equal(m.missing, 1);
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
  assert.throws(() => summariseSpace({ kp: kpRows(), spaceweather: windDoc({ points: [{ t: "2026-10-05T17:00:00Z", speed: 9999 }] }) }, { now }), /outside 100 to 3000/, "a broken feed is an error, not a gap");
});

test("close approaches: upcoming passes after the data time, the next, nearest, fastest and faintest, and those inside the Moon's distance", () => {
  const s = summariseApproaches(approachesDoc(), { now });
  assert.equal(s.earlier, 1, "2026 AA passed before the data time");
  assert.deepEqual(s.upcoming.map((a) => a.name), ["2026 BB", "2019 CC", "2026 EE", "2001 DD"]);
  assert.equal(s.next.name, "2026 BB");
  assert.equal(s.nearest.name, "2019 CC");
  assert.equal(s.fastest.name, "2001 DD");
  assert.equal(s.faintest.name, "2019 CC", "the highest H; an object without H is never picked");
  assert.equal(s.insideMoon, 1);
  assert.equal(s.upcoming[0].sigma, "1 day 2 h 1 min");
  assert.equal(s.upcoming[1].sigma, "under 1 minute");
  assert.equal(s.upcoming[2].h, null);
  assert.equal(s.last, "2026-11-20T23:59:00Z");
  assert.equal(objectName("524522 Zoozve (2002 VE68"), "524522 Zoozve (2002 VE68)", "the bracket the collector leaves open is closed");
  assert.equal(objectName("2026 TX1"), "2026 TX1", "no brackets: unchanged");
  assert.equal(objectName("524522 Zoozve (2002 VE68)"), "524522 Zoozve (2002 VE68)", "balanced: unchanged");
  assert.equal(objectName("433 Eros (A898 PA (x))"), "433 Eros (A898 PA (x))", "nested and balanced: unchanged");
  assert.equal(objectName("433 Eros (A898 PA (x)"), "433 Eros (A898 PA (x))", "nested with one left open: one closed");
  assert.equal(objectName("A (B (C"), "A (B (C))", "two left open: both closed");
  assert.equal(objectName("x) y"), "x) y", "a stray closing bracket is left alone");
});

test("close approaches: an empty list is a page with no passes; a zero or too large distance, a bad speed and a stale list are refused", () => {
  const e = summariseApproaches(approachesDoc({ approaches: [] }), { now });
  assert.deepEqual([e.upcoming.length, e.next, e.nearest, e.fastest, e.faintest, e.insideMoon], [0, null, null, null, null, 0]);
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

test("every summary works on the real collector output of 5 October 2026", () => {
  const r = realFeeds(), places = realPlaces();
  const q = summariseQuakes(r.quakes, { now: REAL_NOW });
  assert.ok(q.count > 20 && q.largest && q.largest.mag >= 4, `${q.count} ${q.largest && q.largest.mag}`);
  const sp = summariseSpace({ kp: r.kp, spaceweather: r.spaceweather, aurora: r.aurora }, { now: REAL_NOW });
  assert.ok(sp.wind && sp.grid && sp.kp.latest.kp >= 0);
  const ca = summariseApproaches(r.closeapproaches, { now: REAL_NOW });
  assert.ok(ca.upcoming.length > 10 && ca.next);
  const st = summariseStorms(r.storms, { now: REAL_NOW });
  assert.deepEqual(st.storms.map((x) => x.name), ["Rachel"]);
  const f = summariseFires(r.fires, { now: REAL_NOW, places });
  assert.equal(f.detections, 192083);
  assert.equal(f.dense.length, 10);
  for (const d of f.dense) assert.ok(d.place === null ? d.nearestKm > PLACE_MAX_KM : d.place.km <= PLACE_MAX_KM);
});
