import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { countSatellites, orbitClass, assertPlausible, ACTIVE_STATUSES, ORBIT_ORDER } from "../site/satcount.mjs";
import { buildFixture, STANDARD, nAtAltitude } from "./helpers/satfixture.mjs";

const fx = () => buildFixture(STANDARD, { newIdx: [1, 6, 8] });

test("the standard fixture is counted exactly", () => {
  const c = countSatellites(fx());
  assert.equal(c.taken, "2026-10-05T08:14:54Z");
  assert.equal(c.objects, 13);
  assert.deepEqual(c.types, { payload: 9, rocketBody: 1, debris: 2, unknown: 1 });
  assert.equal(c.active, 7);
  assert.equal(c.starlink, 2);
  assert.equal(c.starlinkShare, 2 / 7);
  assert.equal(c.last30, 1, "only object 1 of the 30 day list is an active payload");
  assert.deepEqual(c.statusRows, [
    { name: "Not known", count: 1 }, { name: "Operational", count: 3 }, { name: "Partially operational", count: 1 },
    { name: "Backup or standby", count: 1 }, { name: "Spare", count: 1 }, { name: "Extended mission", count: 1 },
    { name: "Not operational", count: 1 },
  ]);
  assert.deepEqual(c.owners, [{ name: "Alpha", count: 2 }, { name: "Beta", count: 2 }, { name: "Gamma", count: 2 }, { name: "Not recorded", count: 1 }]);
  assert.equal(c.ownersOther, 0);
  assert.deepEqual(c.purposes, [
    { name: "Broadband internet", count: 2 }, { name: "Science", count: 2 }, { name: "Communications", count: 1 },
    { name: "Earth observation", count: 1 }, { name: "Unspecified", count: 1 },
  ]);
  assert.deepEqual(c.orbits.map((o) => [o.key, o.count]), [["low", 4], ["medium", 1], ["geostationary", 1], ["highElliptical", 1], ["beyond", 0]]);
  assert.deepEqual(c.launchYears, [{ year: 2018, count: 1 }, { year: 2019, count: 1 }, { year: 2020, count: 1 }, { year: 2022, count: 1 }, { year: 2024, count: 1 }, { year: 2025, count: 1 }]);
  assert.equal(c.unknownYear, 1);
});

test("only the top owners are listed and the rest are summed", () => {
  const c = countSatellites(fx(), { topOwners: 2 });
  assert.deepEqual(c.owners, [{ name: "Alpha", count: 2 }, { name: "Beta", count: 2 }]);
  assert.equal(c.ownersOther, 3);
});

test("the active statuses are exactly operational, partial, backup, spare and extended", () => {
  assert.deepEqual(ACTIVE_STATUSES, [1, 2, 3, 4, 5]);
  assert.deepEqual(ORBIT_ORDER, ["low", "medium", "geostationary", "highElliptical", "beyond"]);
});

test("orbit classes change exactly at the stated altitudes and at eccentricity 0.25", () => {
  assert.equal(orbitClass(nAtAltitude(1999), 0), "low");
  assert.equal(orbitClass(nAtAltitude(2001), 0), "medium");
  assert.equal(orbitClass(nAtAltitude(35585), 0), "medium");
  assert.equal(orbitClass(nAtAltitude(35587), 0), "geostationary");
  assert.equal(orbitClass(nAtAltitude(35985), 0), "geostationary");
  assert.equal(orbitClass(nAtAltitude(35987), 0), "beyond");
  assert.equal(orbitClass(nAtAltitude(500), 0.25), "highElliptical");
  assert.equal(orbitClass(nAtAltitude(500), 0.2499), "low");
});

test("a feed with no objects counts as zero, and a one object feed works", () => {
  const empty = countSatellites(buildFixture([]));
  assert.equal(empty.active, 0);
  assert.equal(empty.starlinkShare, 0);
  assert.deepEqual(empty.owners, []);
  const one = countSatellites(buildFixture([{ type: 0, status: 1, owner: 1, purpose: 4, launchDay: 1, alt: 500 }]));
  assert.equal(one.active, 1);
  assert.deepEqual(one.launchYears, [{ year: 1957, count: 1 }]);
});

test("files of the wrong size are refused with a message that names the file", () => {
  const f = fx();
  assert.throws(() => countSatellites({ ...f, details: f.details.subarray(0, f.details.length - 1) }), /details\.bin has \d+ bytes, expected 104/);
  assert.throws(() => countSatellites({ ...f, swarm: f.swarm.subarray(0, f.swarm.length - 1) }), /swarm\.bin has \d+ bytes, expected 260/);
});

test("the plausibility check accepts sane counts and refuses silly ones", () => {
  const c = countSatellites(fx());
  assert.doesNotThrow(() => assertPlausible(c, { min: 5, max: 100 }));
  assert.throws(() => assertPlausible(c, { min: 8, max: 100 }), /7 active satellites is implausible/);
  assert.throws(() => assertPlausible(c, { min: 1, max: 6 }), /implausible/);
  assert.throws(() => assertPlausible({ ...c, types: { ...c.types, payload: c.types.payload + 1 } }, { min: 5, max: 100 }), /add up to 14 but the feed has 13/);
});

test("the bundled snapshot counts consistently", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const meta = JSON.parse(fs.readFileSync(root + "meta.json", "utf8"));
  const c = countSatellites({ meta, details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") });
  const sum = (rows) => rows.reduce((s, r) => s + r.count, 0);
  assert.equal(c.objects, meta.count);
  assert.equal(c.types.payload + c.types.rocketBody + c.types.debris + c.types.unknown, meta.count);
  assert.ok(c.active > 5000 && c.active <= c.types.payload, `active ${c.active}`);
  assert.equal(sum(c.orbits), c.active);
  assert.equal(sum(c.purposes), c.active);
  assert.equal(sum(c.owners) + c.ownersOther, c.active);
  assert.equal(sum(c.launchYears) + c.unknownYear, c.active);
  assert.equal(sum(c.statusRows), c.types.payload);
  assert.ok(c.starlink > 0 && c.starlink <= meta.kinds["1"]);
  assert.doesNotThrow(() => assertPlausible(c));
});
