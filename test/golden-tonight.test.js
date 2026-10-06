// Fixed expected output for the Tonight plan and the Starlink string items, taken from origin/main before they became generators
// (test/fixtures/golden/tonight-trains.json). The sliced tests compare the sliced and one-go forms, which share one generator, so
// only a stored answer catches a changed rule such as the two strings per night in buildTonight.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as G from "../src/sgp4.js";
import * as T from "../src/trains.js";
import * as N from "../src/tonight.js";
import { loadD } from "./helpers.js";

const D = loadD();
const precise = G.loadPrecise(JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8")));
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/golden/tonight-trains.json", import.meta.url), "utf8"));
const snap = Date.parse(D.meta.taken);
const pune = D.cities.find((c) => c.id === "pune");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("the golden file belongs to the bundled snapshot", () => {
  assert.equal(golden.snapshotTaken, D.meta.taken, "public/ changed: regenerate the golden file from the old code, as its note says");
});

test("tonight on the equator (three string passes in the night, two listed) is exactly the stored plan", () => {
  // the place and time where one Starlink string passes three times in the dark window, so the per-night limit shows
  const place = { ...pune, id: "test", name: "Test", lat: 0, lon: 10, tz: "UTC", clouds: null, planes: null };
  const now = new Date(snap + 24 * 3600e3);
  const plan = N.buildTonight({ D, precise, place, now, kp: null });
  assert.equal(plan.items.filter((i) => i.kind === "train").length, 2);
  assert.deepEqual(plain({ items: plan.items, verdict: plan.verdict, conditions: plan.conditions, highlights: plan.highlights }), golden.plan);
});

test("the string panel's items for Pune over 72 hours are exactly the stored ones", () => {
  const p = { ...pune, lat: Number(pune.lat), lon: Number(pune.lon) };
  const train = T.findTrains(D, precise, new Date(snap))[0];
  const items = N.trainItems({ train, precise, place: p, from: new Date(snap), hours: 72, now: new Date(snap), limit: 4 });
  assert.deepEqual(plain(items), golden.panel);
});
