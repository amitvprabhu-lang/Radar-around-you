import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summariseLaunches, summariseDisasters, summariseStarlink, launchFindings, disasterFindings, starlinkFindings, EVENT_PAGES, EVENT_MAX_AGE_HOURS, EVENT_TERMS_VERIFIED, STARLINK_MIN, meanAltitudeKm, countryName } from "../site/events.mjs";
import { launchesHeadline, disastersHeadline, nextLaunchFields } from "../site/live-pages-js.mjs";
import { countSatellites } from "../site/satcount.mjs";
import { buildFixture, STANDARD, countryFixture, nAtAltitude } from "./helpers/satfixture.mjs";
import { launchesDoc, eventsList, stormsNow, EV_TIME, realLaunches, realEvents, realStorms, EVENTS_TIME, EVENTS_NOW } from "./helpers/eventsfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-10-06T00:45:00Z");
const bundled = () => ({ meta: JSON.parse(fs.readFileSync(path.join(root, "public/meta.json"), "utf8")), details: fs.readFileSync(path.join(root, "public/details.bin")), swarm: fs.readFileSync(path.join(root, "public/swarm.bin")) });
// every number written in a finding is one the finding lists (so a sentence says nothing the summary does not)
const checkNumbers = (findings) => {
  for (const f of findings) {
    const listed = new Set(f.numbers.map((n) => String(n).replace(/,/g, "")).flatMap((n) => [n, String(Number(n))]));
    const text = (f.quoted || []).reduce((t, q) => t.split(q).join(" "), f.text);
    for (const m of text.match(/\d[\d,]*(\.\d+)?/g) || []) assert.ok(listed.has(m.replace(/,/g, "")) || listed.has(String(Number(m.replace(/,/g, "")))), `"${m}" in "${f.text}" is not in ${[...listed].join(" ")}`);
  }
};

test("the three pages have fixed addresses, the design's limits and no verified terms (so no Dataset markup)", () => {
  assert.deepEqual(EVENT_PAGES.map((p) => p.file), ["starlink-tracker/index.html", "natural-disasters-now/index.html", "rocket-launches/index.html"]);
  assert.deepEqual(EVENT_MAX_AGE_HOURS, { launches: 6, events: 6, satellites: 30 });
  assert.deepEqual(EVENT_PAGES.map((p) => p.maxAgeHours), [30, 6, 6]);
  assert.ok(Object.values(EVENT_TERMS_VERIFIED).every((x) => x === false));
  for (const p of EVENT_PAGES) assert.ok(p.note && !/[–—]/.test(p.note) && !/\d/.test(p.note.replace(/Library 2|30|7/g, "")), p.key);
});

test("launches: the next launch, the 30 day counts by provider and country, pads, precision and passed times", () => {
  const s = summariseLaunches(launchesDoc(), { now });
  assert.equal(s.dataTime, "2026-10-06T00:00:00Z");
  assert.equal(s.next.name, "Falcon 9 Block 5 | Starlink Group 10-1");
  assert.equal(s.next.when, "6 October 2026, 20:15 UTC");
  assert.equal(s.upcoming.length, 5);
  assert.equal(s.in30, 4, "the December quarter launch is outside the 30 days");
  assert.equal(s.exact30, 3);
  assert.deepEqual(s.byProvider, [{ name: "SpaceX", count: 2 }, { name: "China Aerospace Science and Technology Corporation", count: 1 }, { name: "Rocket Lab", count: 1 }]);
  assert.deepEqual(s.byCountry.map((c) => [c.name, c.count]), [["US", 2], ["CN", 1], ["NZ", 1]]);
  assert.equal(s.noCoords, 1, "the launch with no pad position is counted, not mapped");
  assert.equal(s.sites.length, 3);
  assert.deepEqual(s.passed.map((l) => l.id), ["p1"]);
  assert.equal(s.nextExactHours, 20);
  assert.deepEqual(s.in24exact.map((l) => l.id), ["a1"]);
  assert.equal(s.windowShort, false, "the list reaches past the 30 days");
  assert.equal(s.total, 321);
  // the live refresh works out the same headline from the same file
  const h = launchesHeadline(launchesDoc());
  assert.deepEqual(h, { "next-name": s.next.name, "next-when": s.next.when, "launches-30": String(s.in30), "exact-upcoming": String(s.exactUpcoming), ...nextLaunchFields(s.next) });
  assert.equal(h["next-provider"], "SpaceX");
  assert.equal(h["next-status"], "Go for Launch");
});

test("launches: no launch in the next 30 days, a list that ends inside the window, stale and broken lists", () => {
  const far = summariseLaunches(launchesDoc({ launches: [launchesDoc().launches[5]] }), { now });
  assert.equal(far.in30, 0);
  assert.deepEqual(far.byProvider, []);
  assert.equal(far.next.precision, "Q4");
  assert.equal(launchFindings(far)[0].text, "No launch in the list is planned in the 30 days after the data time.");
  const short = summariseLaunches(launchesDoc({ launches: launchesDoc().launches.slice(0, 3) }), { now });
  assert.equal(short.windowShort, true);
  assert.throws(() => summariseLaunches(launchesDoc(), { now: new Date("2026-10-06T06:01:00Z") }), (e) => e.stale && /launches data from 2026-10-06T00:00:00Z is more than 6 hours old/.test(e.message));
  assert.equal(summariseLaunches(launchesDoc(), { now: new Date("2026-10-09T00:00:00Z"), allowStale: true }).stale, true);
  assert.throws(() => summariseLaunches(launchesDoc({ launches: [] }), { now }), /the list is empty/);
  assert.throws(() => summariseLaunches(launchesDoc({ launches: [{ ...launchesDoc().launches[1], lat: 120 }] }), { now }), /impossible pad position/);
  assert.throws(() => summariseLaunches(launchesDoc({ launches: [{ ...launchesDoc().launches[1], net: "2031-01-01T00:00:00Z" }] }), { now }), /far from the list's own time/);
  assert.throws(() => summariseLaunches(launchesDoc({ generated: "yesterday" }), { now }), /not a time/);
});

test("launches: the real list of 6 October", () => {
  const s = summariseLaunches(realLaunches(), { now: EVENTS_NOW });
  assert.equal(s.dataTime, "2026-10-06T01:30:38Z");
  assert.equal(s.next.name, "Nuri | NeonSat-2 to 6");
  assert.equal(s.upcoming.length, 30);
  assert.equal(s.in30, s.byProvider.reduce((a, x) => a + x.count, 0));
  assert.equal(s.in30, s.byCountry.reduce((a, x) => a + x.count, 0));
  assert.equal(s.in30, s.sites.reduce((a, x) => a + x.count, 0) + s.noCoords);
  assert.equal(launchesHeadline(realLaunches())["launches-30"], String(s.in30));
  const f = launchFindings(s);
  assert.ok(f.length >= 3 && f.length <= 6);
  checkNumbers(f);
  assert.equal(countryName("GF"), "French Guiana");
  assert.equal(countryName(""), "Not given");
});

test("disasters: earthquakes left out, NHC's storm not shown twice, current and recent by type and alert, older events left out", () => {
  const s = summariseDisasters(eventsList(), { now, dataTime: EV_TIME, storms: stormsNow });
  assert.equal(s.dataTime, EV_TIME);
  assert.equal(s.earthquakesLeftOut, 1);
  assert.deepEqual(s.duplicates, [{ name: "Tropical Cyclone ALPHA-26", nhc: "Alpha" }]);
  assert.equal(s.current, 4, "the flood, two fires and the volcano");
  assert.equal(s.recent, 1);
  assert.equal(s.olderLeftOut, 1, "the drought ended more than 7 days before");
  assert.equal(s.currentRed, 0, "the Red cyclone is NHC's storm, so it is not counted here");
  assert.equal(s.currentOrange, 1);
  assert.deepEqual(s.alerted.map((e) => e.id), ["2"]);
  assert.equal(s.alerted[0].country, "Bangladesh, India", "a trailing comma is trimmed");
  assert.equal(s.noCountry, 1);
  assert.equal(s.stormsNote, null);
  assert.deepEqual(s.currentByType.find((t) => t.type === "WF"), { type: "WF", name: "Wildfire", Red: 0, Orange: 0, Green: 2, total: 2 });
  assert.equal(s.points.length, 5);
  // without NHC's list the cyclone stays, with the reason
  const alone = summariseDisasters(eventsList(), { now, dataTime: EV_TIME });
  assert.equal(alone.currentRed, 1);
  assert.match(alone.stormsNote, /not available/);
  const oldStorms = summariseDisasters(eventsList(), { now, dataTime: EV_TIME, storms: { ...stormsNow, generated: "2026-10-05T10:00:00Z" } });
  assert.match(oldStorms.stormsNote, /older than 12 hours/);
  // the live refresh counts the same way
  const h = disastersHeadline(eventsList(), stormsNow, EV_TIME);
  assert.deepEqual(h, { current: "4", orange: "1", red: "0", recent: "1" });
});

test("disasters: zero Orange or Red events, stale data and broken records", () => {
  const green = eventsList().map((e) => ({ ...e, alert: "Green" }));
  const s = summariseDisasters(green, { now, dataTime: EV_TIME });
  assert.equal(s.alerted.length, 0);
  assert.equal(disasterFindings(s)[0].text, "No current event on this page has an Orange or Red alert; all 5 current events are Green.");
  const quakesOnly = summariseDisasters([eventsList()[5]], { now, dataTime: EV_TIME });
  assert.equal(quakesOnly.current, 0);
  assert.ok(disasterFindings(quakesOnly).length >= 2);
  assert.throws(() => summariseDisasters(eventsList(), { now: new Date("2026-10-06T07:00:00Z"), dataTime: EV_TIME }), (e) => e.stale && /more than 6 hours old/.test(e.message));
  assert.throws(() => summariseDisasters([], { now, dataTime: EV_TIME }), /the list is empty/);
  assert.throws(() => summariseDisasters([{ ...eventsList()[2], alert: "Purple" }], { now, dataTime: EV_TIME }), /unknown alert level/);
  assert.throws(() => summariseDisasters([{ ...eventsList()[2], lat: 99 }], { now, dataTime: EV_TIME }), /impossible position/);
  assert.throws(() => summariseDisasters(eventsList(), { now, dataTime: null }), /not a time/);
});

test("disasters: the real GDACS list of 6 October", () => {
  const s = summariseDisasters(realEvents(), { now: EVENTS_NOW, dataTime: EVENTS_TIME(), storms: realStorms() });
  assert.equal(s.listed, 300);
  assert.equal(s.atCap, true);
  assert.deepEqual(s.duplicates.map((d) => d.nhc), ["Rachel"]);
  assert.equal(s.current, realEvents().filter((e) => e.type !== "EQ" && e.current).length - 1);
  assert.equal(String(s.current), disastersHeadline(realEvents(), realStorms(), EVENTS_TIME()).current);
  assert.equal(String(s.recent), disastersHeadline(realEvents(), realStorms(), EVENTS_TIME()).recent);
  assert.equal(s.currentOrange, 1);
  const f = disasterFindings(s);
  assert.ok(f.length >= 3 && f.length <= 6);
  checkNumbers(f);
});

test("Starlink: count, share, bands, inclinations, launch months and days, positions, from the same definitions as the count page", () => {
  const D = (iso) => Math.round((Date.parse(iso) - Date.UTC(1957, 9, 4)) / 86400e3) + 1;
  const objs = [
    ...Array.from({ length: 6 }, (_, j) => ({ type: 0, status: 1, owner: 1, purpose: 9, kind: 1, alt: 465, incl: 53.2, ma: j * 50, launchDay: D("2026-09-20") })),
    ...Array.from({ length: 3 }, (_, j) => ({ type: 0, status: 1, owner: 1, purpose: 9, kind: 1, alt: 552, incl: 43, ma: j * 90, launchDay: D("2025-02-10") })),
    { type: 0, status: 1, owner: 1, purpose: 9, kind: 1, alt: 305, incl: 97.6, launchDay: 0 },
    { type: 0, status: 6, owner: 1, purpose: 9, kind: 1, alt: 465 },  // decayed: not active
    { type: 0, status: 1, owner: 2, purpose: 4, alt: 700 },           // not Starlink
  ];
  const fx = buildFixture(objs, { ref: Date.parse("2026-10-05T08:14:54Z"), newIdx: [0, 1, 9, 11] });
  const s = summariseStarlink(fx, { now, bounds: { min: 1, max: 100 }, min: 1 });
  assert.equal(s.starlink, 10);
  assert.equal(s.starlink, countSatellites(fx).starlink, "the count page's Starlink number");
  assert.equal(s.active, 11);
  assert.equal(s.last30, 6, "active and Starlink and launched in the 30 days to the data day (5 October): the six of 20 September");
  assert.equal(s.last30From, "2026-09-06T00:00:00Z");
  assert.deepEqual(s.topBands.map((b) => [b.from, b.count]), [[460, 6], [550, 3], [300, 1]]);
  assert.equal(s.bands[0].from, 300);
  assert.equal(s.bands.at(-1).from, 550);
  assert.equal(s.bands.reduce((a, b) => a + b.count, 0), 10);
  assert.ok(s.bands.length === 26 && s.occupiedBands === 3, "empty bands between are kept for the chart");
  assert.deepEqual(s.inclinations, [{ deg: 53, count: 6 }, { deg: 43, count: 3 }, { deg: 98, count: 1 }]);
  assert.equal(s.months.length, 24);
  assert.equal(s.months.at(-1).month, "2026-10");
  assert.equal(s.months.find((m) => m.month === "2026-09").count, 6);
  assert.equal(s.noLaunchDate, 1);
  assert.deepEqual(s.topDays[0], { day: "2026-09-20", count: 6 });
  assert.equal(s.points.length, 10);
  assert.ok(Math.abs(meanAltitudeKm(nAtAltitude(465)) - 465) < 0.01);
  checkNumbers(starlinkFindings(s));
});

test("Starlink: too few is skipped (not a failure), an old feed is stale, an implausible feed fails", () => {
  const fx = buildFixture(STANDARD, { ref: 0 });
  assert.throws(() => summariseStarlink(fx, { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 100 } }), (e) => e.skip === true && /2 active Starlink satellites in the data, under the page's minimum of 1,000/.test(e.message));
  const none = buildFixture(STANDARD.map((o) => ({ ...o, kind: 0 })), { ref: 0 });
  assert.throws(() => summariseStarlink(none, { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 100 }, min: 1 }), (e) => e.skip && /^satellites: 0 active Starlink satellites/.test(e.message), "a count of zero is skipped with a message");
  assert.throws(() => summariseStarlink(fx, { now: new Date("2026-10-06T14:15:00Z"), bounds: { min: 5, max: 100 }, min: 1 }), (e) => e.stale && /more than 30 hours old/.test(e.message));
  assert.throws(() => summariseStarlink(fx, { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 50, max: 100 }, min: 1 }), /implausible/);
  assert.equal(STARLINK_MIN, 1000);
  const c = countryFixture();
  assert.equal(summariseStarlink(c, { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 1000 }, min: 50 }).starlink, 70);
});

test("Starlink: the bundled snapshot of 4 October passes the real guard and gives sensible numbers", () => {
  const s = summariseStarlink(bundled(), { now: new Date("2026-10-04T15:00:00Z") });
  assert.equal(s.starlink, 11149);
  assert.equal(s.active, 16629);
  assert.ok(s.topBands[0].from >= 300 && s.topBands[0].to <= 600, JSON.stringify(s.topBands));
  assert.ok(s.inclinations[0].deg === 53, JSON.stringify(s.inclinations.slice(0, 3)));
  const f = starlinkFindings(s, { dataTime: "2026-10-03T14:00:00Z", values: { starlink: 11000 } });
  assert.ok(f.length >= 3 && f.length <= 6);
  checkNumbers(f);
  assert.ok(f.some((x) => /against 11,000 in the previous build of this page \(data as of 3 October 2026, 14:00 UTC\), about the same\./.test(x.text)), f.map((x) => x.text).join("\n"));
});

test("findings: change since the previous build, both directions and about the same, and left out without history", () => {
  const s = summariseLaunches(launchesDoc(), { now });
  const prev = (n) => ({ dataTime: "2026-10-05T23:00:00Z", values: { in30: n } });
  const change = (n) => launchFindings(s, prev(n)).find((f) => /previous build/.test(f.text));
  assert.match(change(2).text, /against 2 in the previous build .*, more\.$/);
  assert.match(change(9).text, /against 9 .*, fewer\.$/);
  assert.match(change(4).text, /against 4 .*, about the same\.$/);
  assert.equal(launchFindings(s, null).find((f) => /previous build/.test(f.text)), undefined, "no history, no finding");
  assert.equal(launchFindings(s, { dataTime: "x", values: {} }).find((f) => /previous build/.test(f.text)), undefined, "a history without this number");
  const d = summariseDisasters(eventsList(), { now, dataTime: EV_TIME, storms: stormsNow });
  assert.match(disasterFindings(d, { dataTime: "2026-10-05T23:00:00Z", values: { current: 4 } }).find((f) => /previous build/.test(f.text)).text, /about the same/);
  for (const f of [launchFindings(s, prev(2)), disasterFindings(d), starlinkFindings(summariseStarlink(countryFixture(), { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 1000 }, min: 50 }))]) {
    assert.ok(f.length >= 3 && f.length <= 6, String(f.length));
    checkNumbers(f);
    for (const x of f) assert.ok(!/[–—]/.test(x.text) && !/\bsafe\b|danger|you should|will (launch|happen)/i.test(x.text), x.text);
  }
});
