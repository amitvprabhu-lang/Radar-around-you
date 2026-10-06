import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cellSortValue, compareSortValues, sortOrder, filterMatch, localTimeText, countdownText, minutesAgoText, launchWhenText, launchesHeadline, stormNameToken, sameStormRule, disastersHeadline, feedState, mergeRefresh, liveScriptSource, LIVE_SCRIPT_VERSION, LIVE_SCRIPT_FILE } from "../site/live-pages-js.mjs";
import { stormToken, sameStorm } from "../src/dedupe.js";

const LAUNCHES = JSON.parse(fs.readFileSync(new URL("./fixtures/events/live-20261006/launches/20261006T013040Z/launches.json", import.meta.url), "utf8"));
const EVENTS = JSON.parse(fs.readFileSync(new URL("./fixtures/events/live-20261006/events/20261006T014029Z/events.json", import.meta.url), "utf8"));

test("sorting: numbers by size before text, text alphabetically, stable, both directions", () => {
  assert.equal(cellSortValue("1,234 launches"), 1234);
  assert.equal(cellSortValue("-2.5"), -2.5);
  assert.equal(cellSortValue("  SpaceX "), "spacex");
  assert.equal(cellSortValue("2026-10-07T03:23:00Z"), 2026, "a raw ISO time sorts by its year only, so time cells carry data-sort");
  const keys = ["b", 10, 2, "a", 2];
  assert.deepEqual(sortOrder(keys, false), [2, 4, 1, 3, 0]);
  assert.deepEqual(sortOrder(keys, true), [0, 3, 1, 2, 4], "descending, equal keys still in their order");
  assert.ok(compareSortValues(1, "a") < 0 && compareSortValues("a", 1) > 0);
  assert.deepEqual(sortOrder(["2026-10-07T03:23:00Z", "2026-10-06T00:00:00Z"].map(String), false), [1, 0], "ISO strings sort as text");
});

test("filtering matches every word, ignoring case", () => {
  assert.ok(filterMatch("Falcon 9 SpaceX United States", "spacex falcon"));
  assert.ok(!filterMatch("Falcon 9 SpaceX", "spacex nuri"));
  assert.ok(filterMatch("anything", ""));
});

test("local time conversion keeps the instant and names the zone", () => {
  assert.equal(localTimeText("2026-10-07T03:23:00Z", "Asia/Kolkata"), "Wed 7 Oct, 08:53 GMT+5:30");
  assert.equal(localTimeText("2026-10-07T03:23:00Z", "UTC"), "Wed 7 Oct, 03:23 UTC");
  assert.equal(localTimeText("2026-10-07", "UTC"), null, "a date with no time is left alone");
  assert.equal(localTimeText("nonsense", "UTC"), null);
  assert.equal(localTimeText("2026-10-07T03:23:00Z", "Not/AZone"), null, "a bad zone fails quietly");
});

test("the countdown shows only for a time to the minute or second, and the source's status after the planned time", () => {
  const t = Date.parse("2026-10-07T03:23:00Z");
  assert.equal(countdownText(t, t - (26 * 3600 + 5 * 60 + 9) * 1000, "MIN", "Go"), "T-minus 1 d 02:05:09, if the time holds");
  assert.equal(countdownText(t, t - 61000, "SEC", "Go"), "T-minus 00:01:01, if the time holds");
  assert.equal(countdownText(t, t - 3600e3, "HR", "Go"), null, "an hour is not exact enough");
  assert.equal(countdownText(t, t - 3600e3, "M", "Go"), null);
  assert.equal(countdownText(t, t + 1000, "MIN", "Go for Launch"), "The planned time has passed. Status in the source when this page was built: Go for Launch.");
  assert.doesNotMatch(countdownText(t, t + 1000, "MIN", ""), /launched/i, "it never claims a launch happened");
  assert.equal(minutesAgoText(0, 30e3), "less than a minute ago");
  assert.equal(minutesAgoText(0, 60e3), "1 minute ago");
  assert.equal(minutesAgoText(0, 7200e3), "2 hours ago");
});

test("launch times are worded by the source's precision, in UTC with the year", () => {
  const at = (precision, precisionName) => launchWhenText({ net: "2026-10-31T00:00:00Z", precision, precisionName });
  assert.equal(launchWhenText({ net: "2026-10-07T03:23:00Z", precision: "MIN" }), "7 October 2026, 03:23 UTC");
  assert.equal(launchWhenText({ net: "2026-10-07T03:23:41Z", precision: "SEC" }), "7 October 2026, 03:23 UTC");
  assert.equal(launchWhenText({ net: "2026-10-07T03:23:00Z", precision: "HR" }), "7 October 2026, in the hour from 03:00 UTC");
  assert.equal(at("M"), "October 2026, day not set");
  assert.equal(at("Q4"), "the fourth quarter of 2026, day not set");
  assert.equal(at("D", "Day"), '31 October 2026, not an exact date (the source calls it "Day")');
  assert.equal(launchWhenText({ net: "x" }), "time not given");
});

test("the refresh headlines: the next launch and the 30 day count, and the current Orange and Red disasters", () => {
  const h = launchesHeadline(LAUNCHES);
  assert.equal(h["next-name"], "Nuri | NeonSat-2 to 6");
  assert.equal(h["next-when"], "7 October 2026, 03:23 UTC");
  assert.equal(h["launches-30"], String(LAUNCHES.launches.filter((l) => Date.parse(l.net) >= Date.parse(LAUNCHES.generated) && Date.parse(l.net) < Date.parse(LAUNCHES.generated) + 30 * 86400e3).length));
  assert.equal(launchesHeadline({ generated: "x", launches: [] }), null);
  assert.deepEqual(launchesHeadline({ generated: "2026-10-06T00:00:00Z", launches: [] }), { "next-name": "none in the list", "next-when": "", "launches-30": "0" });
  const d = disastersHeadline(EVENTS, null);
  assert.equal(d.orange, String(EVENTS.filter((e) => e.type !== "EQ" && e.current && e.alert === "Orange").length));
  assert.equal(d.red, "0");
  const storms = { storms: [{ name: "Rachel", lat: 20.4, lon: -116.2 }] };
  assert.equal(Number(disastersHeadline(EVENTS, storms).current), Number(d.current) - 1, "the NHC storm's GDACS copy is left out");
  assert.equal(disastersHeadline("x"), null);
});

test("the storm rule matches src/dedupe.js on every GDACS cyclone in the fixture and on hand-made cases", () => {
  const nhc = [{ name: "Rachel", lat: 20.4, lon: -116.2 }, { name: "Nolo", lat: 22.6, lon: 178.5 }, { name: "", lat: 15.1, lon: -122.9 }, { name: "Alpha", lat: 0, lon: 0 }];
  const evs = [...EVENTS.filter((e) => e.type === "TC"), { type: "TC", name: "Tropical Cyclone NOLO-26", lat: 24.2, lon: -179.9 }, { type: "TC", name: "TC 12", lat: 15, lon: -123 }, { type: "FL", name: "Rachel", lat: 20.4, lon: -116.2 }];
  for (const s of nhc) for (const e of evs) assert.equal(sameStormRule(s, e), sameStorm(s, e), `${s.name} / ${e.name}`);
  for (const n of ["Tropical Cyclone KOINU-26", "Super Typhoon MAWAR-23", "TC 03", "12", null, "Post-Tropical Cyclone Lee"]) assert.equal(stormNameToken(n), stormToken(n), String(n));
});

test("feed state and the refresh merge", () => {
  const now = Date.parse("2026-10-06T03:00:00Z");
  const e = { sourceTime: "2026-10-06T02:00:00Z", files: { "x.json": "x" } };
  assert.equal(feedState(e, "2026-10-06T01:00:00Z", 6, now), "newer");
  assert.equal(feedState(e, "2026-10-06T02:00:00Z", 6, now), "same");
  assert.equal(feedState(e, "2026-10-06T01:00:00Z", 0.5, now), "stale");
  assert.equal(feedState(null, "x", 6, now), "missing");
  assert.equal(feedState({ files: {} }, "x", 6, now), "missing");
  assert.deepEqual(mergeRefresh({ a: "1", b: "2" }, { a: "1", b: "3", c: "9" }), { values: { a: "1", b: "3" }, changed: ["b"] });
  assert.deepEqual(mergeRefresh({ a: "1" }, null), { values: { a: "1" }, changed: [] });
});

test("the script is one small file, version 1, no eval or outside requests, and its pure parts run the same in a sandbox", () => {
  const src = liveScriptSource();
  assert.equal(LIVE_SCRIPT_FILE, "live-pages.js");
  assert.equal(LIVE_SCRIPT_VERSION, 1);
  assert.ok(Buffer.byteLength(src) < 20 * 1024, `${Buffer.byteLength(src)} bytes`);
  assert.ok(!/\beval\(|new Function|https?:\/\//.test(src), "no eval and no address of another site");
  assert.ok(!/[–—]/.test(src));
  assert.equal(src, liveScriptSource(), "deterministic");
  assert.ok(!/\bexport\b/.test(src));
  // run it with a page that has not opted in: nothing happens and nothing throws
  const calls = [];
  const sandbox = { document: { body: { getAttribute: () => null } }, window: {}, Intl, Date, Math, JSON, Promise, Object, Array, String, Number, isFinite, isNaN, console: { log: (...a) => calls.push(a) } };
  vm.runInNewContext(src, sandbox);
  assert.deepEqual(calls, []);
  // a page of another version is left alone too
  vm.runInNewContext(src, { ...sandbox, document: { body: { getAttribute: (k) => (k === "data-live-v" ? "2" : null) }, querySelectorAll: () => { throw new Error("touched"); } } });
});
