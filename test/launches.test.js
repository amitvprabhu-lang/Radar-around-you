import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isExact, whenText, countdown, upcoming, groups, padDistanceKm, distanceText, split, statusLine, soonCount } from "../src/launches.js";

const DOC = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/launches.json", import.meta.url), "utf8"));
const NOW = Date.parse(DOC.generated);
const by = (p) => DOC.launches.find((l) => l.precision === p);

test("the fixture is the real feed output and covers every kind of time precision seen so far", () => {
  assert.equal(DOC.launches.length, 30);
  for (const p of ["SEC", "MIN", "HR", "M", "Q4"]) assert.ok(by(p), p);
});

test("exact times are only SEC, MIN and HR", () => {
  assert.deepEqual(DOC.launches.filter(isExact).map((l) => l.precision).sort(), ["HR", "MIN", "MIN", "MIN", "SEC", "SEC", "SEC"]);
  assert.equal(isExact({ precision: "M" }), false);
  assert.equal(isExact({ precision: null }), false);
  assert.equal(isExact({}), false);
});

test("a vague date is never worded as an exact one", () => {
  const month = whenText(by("M"), "Asia/Kolkata");
  assert.match(month, /^Expected in \w+ 2026, day not set$/);
  assert.doesNotMatch(month, /\d{2}:\d{2}/);
  assert.match(whenText(by("Q4"), "Asia/Kolkata"), /^Expected in the fourth quarter of 2026$/);
  assert.match(whenText({ net: "2027-01-31T00:00:00Z", precision: "Q1" }, "UTC"), /first quarter of 2027/);
  assert.match(whenText({ net: "2027-04-30T00:00:00Z", precision: "Q2" }, "UTC"), /second quarter/);
  assert.match(whenText({ net: "2027-09-30T00:00:00Z", precision: "Q3" }, "UTC"), /third quarter/);
  const unknown = whenText({ net: "2027-03-01T00:00:00Z", precision: "H1", precisionName: "Half 1" }, "UTC");
  assert.match(unknown, /not an exact date/);
  assert.match(unknown, /Half 1/);
  assert.doesNotMatch(unknown, /\d{2}:\d{2}/);
});

test("exact times are shown in the place's zone, to the minute", () => {
  const l = { net: "2026-10-07T03:23:00Z", precision: "MIN" };
  assert.equal(whenText(l, "UTC"), "Wed 7 Oct, 03:23");
  assert.equal(whenText(l, "Asia/Kolkata"), "Wed 7 Oct, 08:53");
  assert.equal(whenText(l, "America/New_York"), "Tue 6 Oct, 23:23");
  assert.match(whenText({ net: "2026-10-09T19:25:00Z", precision: "HR" }, "UTC"), /^Fri 9 Oct, in the hour starting 19:25$/);
});

test("month and quarter use the UTC date, whatever the viewer's zone", () => {
  const l = { net: "2026-10-31T00:00:00Z", precision: "M" };
  assert.match(whenText(l, "Pacific/Auckland"), /October 2026/);
  assert.match(whenText(l, "America/Los_Angeles"), /October 2026/);
});

test("countdown only for exact times", () => {
  const first = DOC.launches[0];
  assert.equal(first.precision, "SEC");
  assert.match(countdown(first, NOW), /^in \d+ h$/);
  assert.equal(countdown(by("M"), NOW), null);
  assert.equal(countdown(by("Q4"), NOW), null);
});

test("upcoming drops what left more than six hours ago and keeps the rest in order", () => {
  assert.equal(upcoming(DOC, NOW).length, 30);
  assert.equal(upcoming(DOC, NOW + 3 * 86400e3).length, DOC.launches.filter((l) => Date.parse(l.net) >= NOW - 6 * 3600e3 + 3 * 86400e3).length);
  assert.equal(upcoming(DOC, Date.parse("2030-01-01T00:00:00Z")).length, 0);
  assert.deepEqual(upcoming(null, NOW), []);
  assert.deepEqual(upcoming({}, NOW), []);
  const t = upcoming(DOC, NOW).map((l) => l.net);
  assert.deepEqual(t, [...t].sort());
});

test("groups split firm times from planned months and quarters", () => {
  const g = groups(DOC.launches);
  assert.equal(g.firm.length, 7);
  assert.equal(g.loose.length, 23);
  assert.ok(g.firm.every(isExact) && g.loose.every((l) => !isExact(l)));
});

test("distance from a place to the pad", () => {
  const vandenberg = DOC.launches[0];
  const la = { lat: 34.05, lon: -118.24 };
  const km = padDistanceKm(vandenberg, la);
  // Vandenberg SLC-4E (34.632, -120.611) to downtown Los Angeles: about 2.0 degrees of longitude (x cos 34 degrees) and 0.58 of latitude, roughly 227 km
  assert.ok(km > 220 && km < 235, `${km}`);
  assert.equal(padDistanceKm({ lat: null, lon: null }, la), null);
  assert.equal(distanceText(null), "");
  assert.equal(distanceText(42.4), "42 km from you");
  assert.equal(distanceText(12345), "about 12,350 km from you");
  assert.ok(padDistanceKm(vandenberg, { lat: vandenberg.lat, lon: vandenberg.lon }) < 0.01);
});

test("vehicle and mission come from the source's name or its own fields", () => {
  const f = DOC.launches[0];
  assert.deepEqual(split(f), { vehicle: "Falcon 9 Block 5", mission: f.mission });
  assert.deepEqual(split({ name: "H3-24 | Martian Moon eXplorer (MMX)", mission: null }), { vehicle: "H3-24", mission: "Martian Moon eXplorer (MMX)" });
  assert.deepEqual(split({ name: "Mystery", rocket: "Rocket X", mission: null }), { vehicle: "Rocket X", mission: null });
});

test("status is the source's wording", () => {
  assert.equal(statusLine({ statusName: "Go for Launch", status: "Go" }), "Go for Launch");
  assert.equal(statusLine({ status: "Go" }), "Go");
  assert.equal(statusLine({}), "status not given");
  for (const l of DOC.launches) assert.ok(statusLine(l).length > 1);
});

test("the home tile counts only firm launches in the next week", () => {
  const n = soonCount(DOC, NOW, 7);
  assert.equal(n, DOC.launches.filter((l) => isExact(l) && Date.parse(l.net) <= NOW + 7 * 86400e3).length);
  assert.ok(n >= 3);
  assert.equal(soonCount(DOC, NOW, 0), 0);
  assert.equal(soonCount(null, NOW), 0);
});
