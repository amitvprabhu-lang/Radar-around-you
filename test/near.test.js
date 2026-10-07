// /satellites-near-me/: the pure parts (site/near-ui.mjs, site/near.mjs, site/near-summary.mjs, site/pages-near.mjs, site/near-refresh.mjs).
// The accuracy measurement is in test/near-accuracy.test.js; the browser checks are in e2e-near.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json2satrec } from "satellite.js";
import { haversineKm, EARTH_RADIUS_KM } from "../src/core.js";
import { rowToOmm } from "../src/sgp4.js";
import { runSteps } from "../src/schedule.js";
import {
  RADII_KM, DEFAULT_RADIUS_KM, capFraction, capAreaKm2, expectedAtOnce, EARTH_AREA_KM2, parseQuery, placeQuery, storedValue, restoreStored, checkTyped, cleanName,
  chooseSource, pollDelayMs, sourceText, expectedText, announcement, mapSvg, projectLocal, shortDistance, utcText, zoneText, NAME_MAX,
} from "../site/near-ui.mjs";
import { classify, uncertaintyKm, uncertaintyBand, closestApproaches, groundDistanceKm, stateAt, searchNear, prepareSatellites, decodeFeed, tableRows, planeWindows, placeVector, parabolaMinimum, goldenMinimum, U_TABLE } from "../site/near.mjs";
import { nearSummary } from "../site/near-summary.mjs";
import { nearPage, NEAR_TITLE, NEAR_DESCRIPTION, pct } from "../site/pages-near.mjs";
import { readSatelliteFiles, nearCities } from "../site/near-site.mjs";
import { refreshNearPage } from "../site/near-refresh.mjs";
import { renderPage } from "../site/layout.mjs";
import { buildFixture } from "./helpers/satfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const PUNE = { name: "Pune", lat: 18.5204, lon: 73.8567, tz: "Asia/Kolkata" };
const omm = (o) => ({ OBJECT_NAME: "T", OBJECT_ID: "2000-001A", EPOCH: "2026-10-07T00:00:00", MEAN_MOTION: 15.2, ECCENTRICITY: 0.0001, INCLINATION: 53, RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 90001, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0, ...o });
const satOf = (o, extra = {}) => { const rec = json2satrec(omm(o)); return { rec, epochMs: (rec.jdsatepoch - 2440587.5) * 86400000, exact: true, band: "low-450-600", ...extra }; };
const T0 = Date.parse("2026-10-07T00:00:00Z");

// ------------------------------------------------------------------ areas and the expected count
test("the circle of 100 km is about 31,400 km² of the Earth's 510 million, a share of about 6.2e-5", () => {
  assert.ok(Math.abs(capAreaKm2(100) - Math.PI * 100 * 100) < 5, String(capAreaKm2(100)));
  assert.ok(Math.abs(EARTH_AREA_KM2 / 1e6 - 510.06) < 0.1);
  assert.ok(Math.abs(capFraction(100) - 6.16e-5) < 0.01e-5, String(capFraction(100)));
  assert.ok(Math.abs(expectedAtOnce(16614, 100) - 1.02) < 0.01);
  assert.equal(expectedText(1.02), "about 1"); assert.equal(expectedText(0.256), "about 0.26"); assert.equal(expectedText(25.6), "about 26"); assert.equal(expectedText(0.001), "less than 0.01");
  assert.equal(pct(capFraction(100)), "0.0062%"); assert.equal(pct(0.987), "99%");
});

// ------------------------------------------------------------------ values from outside
test("the address: numbers in range only, names cleaned, bad parts dropped on their own, a bad radius falls back", () => {
  const ok = parseQuery("?lat=18.52&lon=73.86&r=250&name=Pune&tz=Asia/Kolkata");
  assert.deepEqual(ok.place, { name: "Pune", lat: 18.52, lon: 73.86, tz: "Asia/Kolkata" }); assert.equal(ok.radiusKm, 250); assert.deepEqual(ok.problems, []);
  for (const bad of ["?lat=91&lon=0", "?lat=10&lon=181", "?lat=abc&lon=1", "?lat=1e1&lon=2", "?lat=&lon=2", "?lat=10", "?lat=0x10&lon=1", "?lat=10.1234567&lon=1", "?lat=Infinity&lon=1"]) {
    const q = parseQuery(bad);
    assert.equal(q.place, null, bad); assert.ok(q.problems.includes("coordinates"), bad);
  }
  const named = parseQuery("?lat=-33.87&lon=151.21&name=%3Cscript%3Ealert(1)%3C%2Fscript%3E&tz=Not/AZone");
  assert.equal(named.place.name, "33.87° S, 151.21° E"); assert.equal(named.place.tz, null); assert.deepEqual(named.problems, ["name", "tz"]);
  assert.equal(parseQuery("?lat=1&lon=1&name=" + "x".repeat(NAME_MAX + 1)).place.name, "1.00° N, 1.00° E");
  for (const r of ["99", "100.0", "abc", "-100", "1e2", ""]) { const q = parseQuery(`?lat=1&lon=1&r=${r}`); assert.equal(q.radiusKm, null, r); assert.ok(q.problems.includes("radius"), r); }
  assert.deepEqual(parseQuery(""), { place: null, radiusKm: null, problems: [] });
  assert.equal(cleanName("  Pune\u0000 "), null); assert.equal(cleanName("São  Paulo"), "São Paulo"); assert.equal(cleanName(42), null);
});

test("the shareable address round-trips, and storage keeps only checked values", () => {
  const p = { name: "Tromsø", lat: 69.64921, lon: 18.95531, tz: "Europe/Oslo" };
  const back = parseQuery(placeQuery(p, 50));
  assert.deepEqual(back.place, { name: "Tromsø", lat: 69.6492, lon: 18.9553, tz: "Europe/Oslo" }); assert.equal(back.radiusKm, 50);
  assert.deepEqual(restoreStored(storedValue(p, 500)), { place: { name: "Tromsø", lat: 69.6492, lon: 18.9553, tz: "Europe/Oslo" }, radiusKm: 500 });
  for (const bad of ["", "null", "{", "[]", JSON.stringify({ v: 2, name: "A", lat: 1, lon: 1 }), JSON.stringify({ v: 1, name: "<b>", lat: 1, lon: 1 }), JSON.stringify({ v: 1, name: "A", lat: 100, lon: 1 }), JSON.stringify({ v: 1, name: "A", lat: "1", lon: 1 })]) assert.equal(restoreStored(bad), null, bad);
  assert.equal(restoreStored(JSON.stringify({ v: 1, name: "A", lat: 1, lon: 1, tz: "Bad/Zone", r: 77 })).radiusKm, DEFAULT_RADIUS_KM);
});

test("typed coordinates give a message per field", () => {
  assert.deepEqual(checkTyped("18.52", "-73.86").ok, true);
  const bad = checkTyped("95", "abc");
  assert.equal(bad.ok, false); assert.match(bad.latError, /-90 to 90/); assert.match(bad.lonError, /-180 to 180/);
  assert.equal(checkTyped("-90", "180").ok, true);
});

// ------------------------------------------------------------------ which data
const manifestWith = (feed) => ({ schema: 1, generatedAt: "2026-10-07T05:00:00Z", pollSec: 300, feeds: feed ? { satellites: feed } : {} });
const FILES = { "swarm.bin": "satellites/V/swarm.bin", "ids.bin": "satellites/V/ids.bin", "details.bin": "satellites/V/details.bin", "names.txt": "satellites/V/names.txt", "precise.json": "satellites/V/precise.json", "satmeta.json": "satellites/V/satmeta.json" };
const feedAt = (t, extra = {}) => ({ version: "V", fetchedAt: t, checkedAt: t, staleAfterSec: 21600, status: "ok", refreshSec: 7200, files: FILES, sizes: {}, ...extra });
test("the live feed is used when it is complete and newer than the bundled copy; otherwise the bundled copy, with the reason", () => {
  const bundled = Date.parse("2026-10-04T14:19:25Z"), now = Date.parse("2026-10-07T05:10:00Z");
  const live = chooseSource(manifestWith(feedAt("2026-10-07T04:20:23Z")), bundled, "live/", now);
  assert.equal(live.source, "live"); assert.equal(live.version, "V"); assert.equal(live.paths["swarm.bin"], "live/satellites/V/swarm.bin"); assert.equal(live.state, "fresh");
  assert.equal(chooseSource(manifestWith(feedAt("2026-10-03T00:00:00Z")), bundled, "live/", now).reason, "older");
  assert.equal(chooseSource(null, bundled, "live/", now).reason, "no-manifest");
  assert.equal(chooseSource(manifestWith(null), bundled, "live/", now).reason, "no-feed");
  const { "names.txt": _, ...missing } = FILES;
  assert.equal(chooseSource(manifestWith(feedAt("2026-10-07T04:20:23Z", { files: missing })), bundled, "live/", now).reason, "incomplete");
  // past its own stale limit but newer than the bundle: still the newest data, used and marked
  const old = chooseSource(manifestWith(feedAt("2026-10-06T04:00:00Z")), bundled, "live/", now);
  assert.equal(old.source, "live"); assert.equal(old.state, "stale");
  assert.equal(sourceText({ source: "live", fetchedAt: "2026-10-07T03:50:00Z" }), "orbit data from 7 Oct 03:50 UTC, live feed");
  assert.equal(sourceText({ source: "bundled", fetchedAt: "2026-10-04T14:19:25Z" }), "bundled snapshot of 4 Oct 14:19 UTC");
});

test("the manifest is looked at no more often than every 300 seconds, less often after failures", () => {
  assert.equal(pollDelayMs(60, 0), 300000); assert.equal(pollDelayMs(300, 0), 300000); assert.equal(pollDelayMs(600, 0), 600000);
  assert.equal(pollDelayMs(300, 1), 600000); assert.equal(pollDelayMs(300, 10), 1800000); assert.equal(pollDelayMs(undefined, 0), 300000);
});

// ------------------------------------------------------------------ classification and uncertainty
test("within, borderline and uncertain", () => {
  assert.equal(classify(80, 10, 100), "within"); assert.equal(classify(100, 10, 100), "within"); assert.equal(classify(105, 10, 100), "borderline");
  assert.equal(classify(111, 10, 100), null); assert.equal(classify(50, 100, 100), "uncertain"); assert.equal(classify(150, 100, 100), null);
  assert.equal(classify(10, 0, 25), "within"); assert.equal(classify(26, 0, 25), null);
  assert.equal(uncertaintyBand(60 * Math.sqrt(398600.4418 / (6378.137 + 550) ** 3), 0), "low-450-600");
  assert.equal(uncertaintyBand(60 * Math.sqrt(398600.4418 / (6378.137 + 35786) ** 3), 0), "geostationary");
  assert.equal(uncertaintyKm("low-under-450", 24), U_TABLE["low-under-450"][3]);
});

// ------------------------------------------------------------------ geometry and the search
test("fits: a parabola through three points finds its minimum; golden-section finds a minimum", () => {
  const f = (t) => (t - 3.3) ** 2 + 1;
  assert.ok(Math.abs(parabolaMinimum(3, 1, f(2), f(3), f(4)) - 3.3) < 1e-9);
  assert.equal(parabolaMinimum(0, 1, 1, 2, 1), null, "a maximum is not a minimum");
  assert.ok(Math.abs(goldenMinimum(f, 0, 10, 1e-3) - 3.3) < 1e-3);
});

test("a satellite in an equatorial orbit passes a place at 0.5 degrees north once per lap, every time 55.6 km away", () => {
  const sat = satOf({ INCLINATION: 0, ECCENTRICITY: 0.0001, MEAN_MOTION: 15 });
  const place = { lat: 0.5, lon: 10 };
  const found = closestApproaches(sat, place, T0, T0 + 86400000, 100);
  const expected = 0.5 * (Math.PI / 180) * EARTH_RADIUS_KM;
  // relative to the turning Earth the ground point laps the equator at (15 - 1.0027) turns a day
  assert.ok(found.length >= 13 && found.length <= 15, String(found.length));
  for (const m of found) assert.ok(Math.abs(m.km - expected) < 0.5, `${m.km} km`);
  const gaps = found.slice(1).map((m, i) => (m.t - found[i].t) / 60000);
  for (const g of gaps) assert.ok(Math.abs(g - 1440 / (15 - 1.0027)) < 1.5, `${g} min between passes`);
  // at each time the ground point's longitude is the place's
  for (const m of found) { const g = groundDistanceKm(place, stateAt(sat, m.t).ecef); assert.ok(Math.abs(((g.lon - 10 + 540) % 360) - 180) < 0.05, String(g.lon)); }
  assert.equal(closestApproaches(sat, { lat: 2, lon: 10 }, T0, T0 + 86400000, 100).length, 0, "222 km away: never within 100 km");
});

test("the orbit-plane windows: none for a place far from every point of the plane, two short ones a day for Pune and a 53 degree orbit", () => {
  const rec = json2satrec(omm({ INCLINATION: 53 }));
  assert.deepEqual(planeWindows(rec, placeVector({ lat: 80, lon: 0 }), T0, T0 + 86400000, 0.03, 0), []);
  const w = planeWindows(rec, placeVector(PUNE), T0, T0 + 86400000, 0.03, 0);
  const total = w.reduce((s, [a, b]) => s + (b - a), 0) / 60000;
  assert.ok(w.length >= 2 && w.length <= 3, String(w.length));
  assert.ok(total > 20 && total < 120, `${total} minutes`);
  for (const [a, b] of w) assert.ok(a >= T0 && b <= T0 + 86400000 && b > a);
});

test("the plane test never drops a time when the ground point is near (checked against brute force on real element sets)", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/near-accuracy.json"), "utf8"));
  const rows = fx.rows.filter((r, k) => k % 23 === 0).slice(0, 30);
  const start = fx.refMs;
  let checked = 0, minima = 0;
  for (const place of [PUNE, { lat: 69.65, lon: 18.96 }, { lat: -0.18, lon: -78.47 }]) {
    for (const row of rows) {
      const rec = json2satrec(rowToOmm(fx.cols, row));
      if (rec.error) continue;
      const sat = { rec, epochMs: (rec.jdsatepoch - 2440587.5) * 86400000 };
      const R = 500, end = start + 12 * 3600000;
      // brute force: the exact distance every 10 s; a local minimum under R must be found by the search within 20 s
      const samples = [];
      for (let t = start; t <= end; t += 10000) { const st = stateAt(sat, t); samples.push(st ? groundDistanceKm(place, st.ecef).km : Infinity); }
      const found = closestApproaches(sat, place, start, end, R);
      for (let i = 1; i < samples.length - 1; i++) {
        if (samples[i] <= samples[i - 1] && samples[i] < samples[i + 1] && samples[i] < R - 20) {
          minima++;
          const t = start + i * 10000;
          const hit = found.find((m) => Math.abs(m.t - t) <= 20000);
          assert.ok(hit, `NORAD ${row[0]} near ${place.lat}: minimum of ${samples[i].toFixed(1)} km at ${new Date(t).toISOString()} not found`);
          assert.ok(hit.km <= samples[i] + 0.5, "the refined minimum is no larger than the sampled one");
        }
      }
      checked++;
    }
  }
  assert.ok(checked >= 80 && minima >= 20, `${checked} satellites, ${minima} minima`);
});

// ------------------------------------------------------------------ the whole search on a small made-up feed
function smallFeed() {
  const objs = [
    { type: 0, status: 1, owner: 1, purpose: 9, alt: 550, incl: 53, kind: 1, name: "STARLINK-1" },
    { type: 0, status: 1, owner: 2, purpose: 4, alt: 700, incl: 97.5, ma: 120, name: "EO-1" },
    { type: 0, status: 3, owner: 3, purpose: 10, alt: 35786, incl: 0.05, name: "GEO-1" },
    { type: 0, status: 6, owner: 1, alt: 600, incl: 45, name: "DEAD-1" },
    { type: 2, status: 0, alt: 700, incl: 70, name: "DEB" },
    { type: 0, status: 1, owner: 1, alt: 550, incl: 53, name: "OLD-1", old: true },
  ];
  const f = buildFixture(objs, { ref: T0, taken: "2026-10-07T00:00:00Z" });
  // the fixture writes epoch offset 0; make one element set 4 days old
  f.swarm.writeFloatLE(-4 * 1440, 5 * 8);
  const ids = Buffer.alloc(objs.length * 4); objs.forEach((o, i) => ids.writeUInt32LE(90000 + i, i * 4));
  return decodeFeed({ meta: f.meta, swarm: f.swarm, ids, details: f.details, names: f.names, precise: { cols: [], rows: [] } });
}
test("only active payloads are worked out; old element sets are counted and left out; the geostationary belt is kept apart", () => {
  const prep = prepareSatellites(smallFeed(), T0 + 3600000);
  assert.equal(prep.counts.active, 4); assert.equal(prep.counts.stale, 1); assert.equal(prep.counts.geostationary, 1); assert.equal(prep.sats.length, 2);
  assert.deepEqual(prep.sats.map((s) => s.name), ["STARLINK-1", "EO-1"]);
  assert.equal(prep.sats[0].starlink, true); assert.equal(prep.sats[0].owner, "Alpha"); assert.equal(prep.sats[0].purpose, "Broadband internet");
  // a place 0.3 degrees from the geostationary satellite's ground point
  const g = groundDistanceKm({ lat: 0, lon: 0 }, stateAt(prep.geo[0], T0 + 3600000).ecef);
  const res = runSteps(searchNear(prep, { lat: g.lat + 0.3, lon: g.lon + 0.2 }, { startMs: T0 + 3600000, radiusKm: 500 }));
  assert.equal(res.geo.length, 1, "the geostationary satellite is near a place below it");
  assert.ok(res.geo[0].allDay); assert.ok(res.geo[0].minKm < 100);
  for (let i = 1; i < res.passes.length; i++) assert.ok(res.passes[i].t >= res.passes[i - 1].t, "passes in time order");
  for (const p of res.passes) assert.ok(p.km <= 500 + p.u, "every pass is within the radius plus its uncertainty");
  const far = runSteps(searchNear(prep, { lat: 45, lon: 0 }, { startMs: T0 + 3600000, radiusKm: 500 }));
  assert.equal(far.geo.length, 0, "5,000 km from the equator: no geostationary satellite is near");
});

// ------------------------------------------------------------------ on the bundled data
const bundled = readSatelliteFiles(path.join(root, "public"));
const summary = nearSummary(bundled, { source: "bundled", dataTime: bundled.meta.taken });
test("the build-time summary of the bundled data: counts from the feed, an example in time order within the radius", () => {
  assert.ok(summary.active > 10000);
  const e100 = summary.expected.find((e) => e.radiusKm === 100);
  assert.ok(Math.abs(e100.expected - summary.active * capFraction(100)) < 1e-9);
  assert.deepEqual(summary.expected.map((e) => e.radiusKm), RADII_KM);
  const ex = summary.example;
  assert.equal(ex.startMs, Date.parse(bundled.meta.taken), "the example starts at the data time, not at the build time");
  assert.ok(ex.within > 500 && ex.rows.length === 10, `${ex.within} passes`);
  for (let i = 1; i < ex.rows.length; i++) assert.ok(ex.rows[i].t >= ex.rows[i - 1].t);
  for (const r of ex.rows) { assert.ok(r.km <= 100 + r.u); assert.ok(r.t > ex.startMs && r.t < ex.endMs); }
  assert.ok(summary.lowestPerigeeKm > 100, "no active satellite comes within 100 km of the ground, so the straight-line sentence holds");
});

test("changing the radius changes the answer, and tableRows keeps the cap in either order", () => {
  const feed = decodeFeed(bundled);
  const start = Date.parse(bundled.meta.taken);
  const prep = prepareSatellites(feed, start);
  const a = runSteps(searchNear(prep, PUNE, { startMs: start, hours: 3, radiusKm: 25 }));
  const b = runSteps(searchNear(prep, PUNE, { startMs: start, hours: 3, radiusKm: 250 }));
  assert.ok(b.passes.length > a.passes.length * 3, `${a.passes.length} against ${b.passes.length}`);
  const byT = tableRows(b.passes, PUNE, { cap: 7 }), byD = tableRows(b.passes, PUNE, { order: "distance", cap: 7 });
  assert.equal(byT.length, 7); assert.equal(byD.length, 7);
  for (let i = 1; i < 7; i++) { assert.ok(byT[i].t >= byT[i - 1].t); assert.ok(byD[i].km >= byD[i - 1].km); }
  for (const r of byT) assert.ok(r.el > 40, "a ground point within 250 km puts the satellite well up in the sky");
});

// ------------------------------------------------------------------ the page
const cities = nearCities();
const page = nearPage(summary, { assets: { page: "near-page.0123456789.js", calc: "near-calc.0123456789.js" }, cities });
const html = renderPage(page, { noindex: false });
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
test("the page: title and description lengths, one h1, a sources section, numbers from the data, no promises of visibility", () => {
  assert.ok(NEAR_TITLE.length < 60, String(NEAR_TITLE.length)); assert.ok(NEAR_DESCRIPTION.length < 160, String(NEAR_DESCRIPTION.length));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(html.includes('id="sources"')); assert.ok(!/FAQPage/.test(html), "no FAQ markup");
  assert.ok(text.includes(summary.active.toLocaleString("en-GB")), "the active count from the data");
  assert.ok(text.includes("as the catalogue records"));
  assert.ok(!/—|–/.test(html), "no em or en dashes");
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), "no emoji");
  assert.ok(!/you will see|will be visible|visible to the naked eye/i.test(text), "never promises visibility");
  assert.ok(text.includes("never reaches a satellite"), "the straight-line sentence");
  for (const t of [...html.matchAll(/<time datetime="([^"]+)"/g)].map((m) => m[1])) assert.ok(!Number.isNaN(Date.parse(t)), t);
  for (const link of ["how-many-satellites-in-orbit/", "satellites-by-country/", "iss-today/", "tonights-sky/"]) assert.ok(html.includes(`href="../${link}"`), link);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(ld.some((o) => o["@type"] === "WebPage" && o.inLanguage === "en" && o.dateModified === new Date(Date.parse(summary.dataTime)).toISOString().replace(/\.\d{3}Z$/, "Z")));
  assert.ok(ld.some((o) => o["@type"] === "BreadcrumbList"));
  // every table has a caption and header scopes
  for (const t of html.match(/<table[\s\S]*?<\/table>/g)) { assert.ok(t.includes("<caption>")); assert.ok(!/<th\b(?![^>]*scope=)/.test(t)); }
  // the tool is hidden until its script runs; the explanation is plain text without it
  assert.ok(html.includes('<form id="nm-form" class="nm-form" hidden novalidate>'));
  assert.ok(html.includes("<noscript>"));
  assert.ok(html.includes('<script src="near-page.0123456789.js" defer></script>')); assert.ok(html.includes('data-calc="near-calc.0123456789.js"'));
});

test("the page's numbers carry the data time and the example's source", () => {
  assert.ok(text.includes("the satellite data bundled with the site when this page was built"));
  const live = renderPage(nearPage({ ...summary, source: "live" }, { assets: { page: "a", calc: "b" }, cities }), { noindex: false });
  assert.ok(live.includes("the live satellite feed the site had when this page was built"));
});

// ------------------------------------------------------------------ wording and the map
test("wording: distances with their uncertainty, times in UTC and in the place's zone, one sentence when done", () => {
  assert.equal(shortDistance(87.4, 10.2), "87 km ± 11"); assert.equal(shortDistance(87.4, 0), "87 km");
  assert.equal(utcText(Date.parse("2026-10-07T05:08:54Z"), Date.parse("2026-10-07T05:00:00Z")), "05:08:54 UTC");
  assert.equal(utcText(Date.parse("2026-10-08T01:00:00Z"), Date.parse("2026-10-07T05:00:00Z")), "Thu 8 Oct, 01:00:00 UTC");
  assert.equal(zoneText(Date.parse("2026-10-07T05:08:54Z"), "Asia/Kolkata"), "Wed 7 Oct, 10:38");
  assert.equal(announcement({ placeName: "Pune", radiusKm: 100, now: 0, within: 2921, borderline: 365 }), "Done: for Pune within 100 km, none right now, and 2,921 passes in the next 24 hours, plus 365 borderline.");
});

test("the map: north up, the circle to scale, nothing but numbers and fixed words in the SVG", () => {
  assert.deepEqual(projectLocal(PUNE, PUNE.lat, PUNE.lon, 250, 400), [200, 200]);
  const north = projectLocal(PUNE, PUNE.lat + 1, PUNE.lon, 250, 400);
  assert.ok(Math.abs(north[0] - 200) < 0.2 && north[1] < 200);
  assert.equal(projectLocal(PUNE, 60, 10, 250, 400), null);
  const svg = mapSvg({ place: { ...PUNE, name: "<b>x</b>" }, radiusKm: 100, tracks: [{ status: "within", points: [[18, 73], [19, 74]] }], coast: [[[18, 72.8], [19, 72.9]]] });
  assert.ok(!svg.includes("<b>"), "the place name never goes into the SVG");
  assert.match(svg, /<circle cx="200" cy="200" r="80"/);
  assert.match(svg, /stroke="#a98cff"/); assert.match(svg, /stroke="#6d8fbf"/);
});

// ------------------------------------------------------------------ the deploy step
test("near-refresh: rebuilds the page from a live feed newer than the bundle, keeps it otherwise", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "near-refresh-"));
  try {
    const nearDir = path.join(dir, "satellites-near-me");
    fs.mkdirSync(nearDir, { recursive: true });
    fs.writeFileSync(path.join(nearDir, "index.html"), html);
    fs.copyFileSync(path.join(root, "public/meta.json"), path.join(dir, "meta.json"));
    const ver = "20261005T081455Z", sat = path.join(dir, "live/satellites", ver);
    fs.mkdirSync(sat, { recursive: true });
    for (const f of ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"]) fs.copyFileSync(path.join(root, "public", f), path.join(sat, f));
    // the same orbits, said to be collected a day after the bundle (the satmeta keeps the bundle's reference time, so they stay the same)
    const later = new Date(Date.parse(bundled.meta.taken) + 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(path.join(sat, "satmeta.json"), JSON.stringify({ ref: bundled.meta.ref, taken: later, count: bundled.meta.count }));
    const files = Object.fromEntries(["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json", "satmeta.json"].map((f) => [f, `satellites/${ver}/${f}`]));
    const write = (fetchedAt) => fs.writeFileSync(path.join(dir, "live/manifest.json"), JSON.stringify(manifestWith({ version: ver, fetchedAt, checkedAt: fetchedAt, staleAfterSec: 21600, status: "ok", files })));
    write("2026-10-01T00:00:00Z");
    assert.match(refreshNearPage(dir, { noindex: false }), /kept the bundled numbers \(live satellite data not used: older\)/);
    assert.equal(fs.readFileSync(path.join(nearDir, "index.html"), "utf8"), html);
    write(later);
    assert.match(refreshNearPage(dir, { noindex: false }), /rebuilt from the live satellite data of/);
    const out = fs.readFileSync(path.join(nearDir, "index.html"), "utf8");
    assert.ok(out.includes("the live satellite feed the site had when this page was built"));
    assert.ok(out.includes('data-calc="near-calc.0123456789.js"') && out.includes('<script src="near-page.0123456789.js" defer></script>'), "the same scripts");
    fs.writeFileSync(path.join(dir, "live/manifest.json"), JSON.stringify(manifestWith({ version: ver, fetchedAt: later, checkedAt: later, files: { ...files, "swarm.bin": "../../etc/passwd" } })));
    assert.match(refreshNearPage(dir, { noindex: false }), /kept the bundled numbers/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ the calculation's data choice and a mid-session update (pretend fetch)
test("the calculation uses a newer live feed, falls back to the bundled copy when the live one is older or broken, and picks up new data", async () => {
  const { loadFeed, run } = await import("../site/near-calc.mjs");
  const pubFile = (f) => fs.readFileSync(path.join(root, "public", f));
  const files = new Map(["meta.json", "manifest.json", "swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"].map((f) => [`B/${f}`, pubFile(f)]));
  const satmeta = (taken) => Buffer.from(JSON.stringify({ ref: bundled.meta.ref, taken, count: bundled.meta.count }));
  const put = (v, taken) => { for (const f of ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"]) files.set(`B/live/satellites/${v}/${f}`, pubFile(f)); files.set(`B/live/satellites/${v}/satmeta.json`, satmeta(taken)); };
  const manifest = (v, fetchedAt) => files.set("B/live/manifest.json", Buffer.from(JSON.stringify(manifestWith(feedAt(fetchedAt, { version: v, files: Object.fromEntries(Object.keys(FILES).map((f) => [f, `satellites/${v}/${f}`])) })))));
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(url);
    const b = files.get(url);
    if (!b) return new Response("", { status: 404 });
    return new Response(b, { status: 200 });
  };
  try {
    const now = Date.parse(bundled.meta.taken) + 3 * 3600000;
    put("V1", "2026-10-04T16:00:00Z"); manifest("V1", "2026-10-04T16:00:00Z");
    let r = await loadFeed("B/", () => {}, now);
    assert.equal(r.info.source, "live"); assert.equal(r.info.version, "V1"); assert.equal(r.feed.meta.taken, "2026-10-04T16:00:00Z");
    const again = await loadFeed("B/", () => {}, now);
    assert.equal(again.feed, r.feed, "the same version is not downloaded again");
    put("V2", "2026-10-04T17:00:00Z"); manifest("V2", "2026-10-04T17:00:00Z");
    r = await loadFeed("B/", () => {}, now);
    assert.equal(r.info.version, "V2", "a new version is picked up on the next run");
    manifest("V0", "2026-10-01T00:00:00Z");
    r = await loadFeed("B/", () => {}, now);
    assert.equal(r.info.source, "bundled"); assert.equal(r.info.reason, "older"); assert.equal(r.info.fetchedAt, bundled.meta.taken);
    manifest("VX", "2026-10-04T18:00:00Z");  // listed, but its files are missing
    r = await loadFeed("B/", () => {}, now);
    assert.equal(r.info.source, "bundled"); assert.equal(r.info.reason, "failed");
    // a whole run answers with the place, the counts and rows that are within the radius plus their uncertainty
    manifest("V2", "2026-10-04T17:00:00Z");
    const msgs = [];
    await run({ id: 7, base: "B/", place: PUNE, radiusKm: 100, startMs: now }, (m) => msgs.push(m), async () => {}, 1e9);
    const res = msgs.find((m) => m.type === "result");
    assert.ok(res, JSON.stringify(msgs.find((m) => m.type === "error")));
    assert.equal(res.info.source, "live"); assert.equal(res.place.name, "Pune");
    assert.ok(res.byTime.length > 0 && res.byTime.every((x) => x.km <= 100 + x.u) && res.byTime.every((x, i) => !i || x.t >= res.byTime[i - 1].t));
    assert.ok(res.byTime[0].track.length > 10, "each row carries its ground track for the map");
    assert.equal(res.total, res.within + res.borderline);
  } finally { globalThis.fetch = realFetch; }
});

test("the distance rule is the app's haversine between the place and the geodetic ground point", () => {
  const sat = satOf({ INCLINATION: 53 });
  const st = stateAt(sat, T0);
  const g = groundDistanceKm(PUNE, st.ecef);
  assert.ok(Math.abs(g.km - haversineKm(PUNE.lat, PUNE.lon, g.lat, g.lon)) < 1e-9);
  assert.ok(g.hKm > 400 && g.hKm < 700);
});
