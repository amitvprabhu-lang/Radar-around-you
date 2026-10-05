import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stormToken, sameStorm, unmatchedCyclones, withoutDuplicateStorms } from "../src/dedupe.js";
import { connections } from "../src/connect.js";

const J = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/hazards/${f}`, import.meta.url), "utf8"));
const STORMS = J("storms.json").storms, EVENTS = J("events.json");
const tc = (n) => EVENTS.find((e) => e.type === "TC" && e.name.includes(n));
const nhc = (n) => STORMS.find((s) => s.name === n);

test("storm names are reduced to the name itself", () => {
  assert.equal(stormToken("Tropical Cyclone NOLO-26"), "NOLO");
  assert.equal(stormToken("Nolo"), "NOLO");
  assert.equal(stormToken("Hurricane Rachel"), "RACHEL");
  assert.equal(stormToken("Tropical Cyclone CHOI-WAN-26"), "CHOI WAN");
  assert.equal(stormToken("Super Typhoon Ragasa-25"), "RAGASA");
  assert.equal(stormToken("Tropical Depression"), null);
  assert.equal(stormToken("TC-26"), null);
  assert.equal(stormToken("Eighteen-E"), "EIGHTEEN E");
  assert.equal(stormToken(null), null);
  assert.equal(stormToken(""), null);
});

test("the real GDACS copies of the two NHC storms are recognised, and the western Pacific one is not", () => {
  assert.ok(sameStorm(nhc("Nolo"), tc("NOLO")), "Nolo is 1.8 degrees apart in the two sources");
  assert.ok(sameStorm(nhc("Rachel"), tc("RACHEL")));
  assert.ok(!sameStorm(nhc("Nolo"), tc("RACHEL")));
  assert.ok(!sameStorm(nhc("Rachel"), tc("NOLO")));
  for (const s of STORMS) assert.ok(!sameStorm(s, tc("CHOI-WAN")), s.name);
});

test("the unmatched list keeps only what NHC does not cover", () => {
  assert.deepEqual(unmatchedCyclones(EVENTS, STORMS).map((e) => e.name), ["Tropical Cyclone CHOI-WAN-26"]);
  assert.equal(unmatchedCyclones(EVENTS, []).length, 3, "with no NHC data every GDACS cyclone stays");
  assert.equal(unmatchedCyclones(EVENTS, null).length, 3);
  assert.equal(unmatchedCyclones(null, STORMS).length, 0);
});

test("removing duplicates leaves every other kind of event alone", () => {
  const out = withoutDuplicateStorms(EVENTS, STORMS);
  assert.equal(out.length, EVENTS.length - 2);
  assert.deepEqual(out.filter((e) => e.type !== "TC"), EVENTS.filter((e) => e.type !== "TC"));
  assert.equal(withoutDuplicateStorms(EVENTS, []), EVENTS);
  assert.deepEqual(withoutDuplicateStorms(undefined, STORMS), []);
});

test("matching works across the dateline and by position when a name is missing", () => {
  const a = { name: "Nolo", lat: 23.8, lon: 179.5 }, e = { type: "TC", name: "Tropical Cyclone NOLO-26", lat: 23.6, lon: -179.2 };
  assert.ok(sameStorm(a, e));
  assert.ok(sameStorm({ name: "Eighteen-E", lat: 10, lon: -100 }, { type: "TC", name: "TC-26", lat: 10.5, lon: -101 }), "no usable name on one side: position decides");
  assert.ok(!sameStorm({ name: "Eighteen-E", lat: 10, lon: -100 }, { type: "TC", name: "TC-26", lat: 16, lon: -100 }));
  assert.ok(!sameStorm({ name: "Nolo", lat: 10, lon: 100 }, { type: "TC", name: "NOLO-26", lat: 10, lon: -100 }), "a shared name far apart is not the same storm");
  assert.ok(!sameStorm(a, { type: "FL", name: "NOLO flood", lat: 23.6, lon: -179.2 }));
  assert.ok(!sameStorm(a, { type: "TC", name: "NOLO-26", lat: NaN, lon: 0 }));
  assert.ok(!sameStorm(null, e));
});

// The old rule dropped every GDACS cyclone as soon as NHC listed any storm anywhere.
test("regression: a GDACS cyclone NHC does not cover still shows near a place that is close to it", () => {
  const choi = tc("CHOI-WAN");
  const place = { name: "Test point", lat: choi.lat + 1, lon: choi.lon - 1 };
  const c = connections({ place, nowMs: Date.parse("2026-10-04T19:45:00Z"), storms: J("storms.json"), events: EVENTS });
  assert.ok(c.some((x) => x.kind === "hazard" && /CHOI-WAN/.test(x.title)), JSON.stringify(c.map((x) => x.title)));
});

test("a GDACS copy of an NHC storm is not listed a second time near that storm", () => {
  const rachel = nhc("Rachel");
  const place = { name: "Test point", lat: rachel.lat + 0.5, lon: rachel.lon + 0.5 };
  const c = connections({ place, nowMs: Date.parse("2026-10-04T19:45:00Z"), storms: J("storms.json"), events: EVENTS });
  assert.ok(c.some((x) => x.kind === "storm"), "the NHC storm is listed");
  assert.ok(!c.some((x) => x.kind === "hazard" && /RACHEL/.test(x.title)), "and its GDACS copy is not");
});
