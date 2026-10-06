// The start-up work that is now done in slices (src/schedule.js): each sliced form must give exactly what the one-go form gives.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as G from "../src/sgp4.js";
import * as T from "../src/trains.js";
import * as N from "../src/tonight.js";
import { skyCalendar, skyCalendarSteps, planetEvents, planetEventsSteps } from "../src/calendar.js";
import { findPasses, findPassesSteps, PASS_STEPS_PER_PAUSE } from "../src/core.js";
import { runSteps, runStepsAsync } from "../src/schedule.js";
import { kpAt } from "../src/info.js";
import { loadD } from "./helpers.js";

const D = loadD();
const precise = G.loadPrecise(JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8")));
const snap = new Date(Date.parse(D.meta.taken));
const placeOf = (id) => { const c = D.cities.find((x) => x.id === id); return { ...c, lat: Number(c.lat), lon: Number(c.lon) }; };
const pune = placeOf("pune");
const ISS = precise.get(25544);
// a yield that counts, and a budget of 0 ms so every pause really yields
const counting = () => { const c = { n: 0 }; c.opts = { yieldFn: async () => { c.n++; }, budgetMs: 0 }; return c; };
const pauses = (gen) => { let n = 0; for (;;) { const r = gen.next(); if (r.done) return n; n++; } };

test("findPassesSteps pauses during a long search and finds the same passes as findPasses", () => {
  const look = (d) => G.lookFrom(ISS, d, pune.lat, pune.lon) || { el: -90, az: 0, sunlit: false };
  const sun = () => -20;
  const a = findPasses(look, sun, snap, 48, { stepSec: 20 });
  const b = runSteps(findPassesSteps(look, sun, snap, 48, { stepSec: 20 }));
  assert.deepEqual(b, a);
  assert.ok(a.length > 3, "the ISS passes over Pune several times in two days");
  // 48 hours at 20 s steps is 8,641 steps, so the search pauses 8641 / 240 times (rounded down)
  assert.equal(pauses(findPassesSteps(look, sun, snap, 48, { stepSec: 20 })), Math.floor(8641 / PASS_STEPS_PER_PAUSE));
});

test("passesForSteps and passesFor agree", () => {
  assert.deepEqual(runSteps(G.passesForSteps(ISS, pune, snap, 24 * 10, { minEl: 10 })), G.passesFor(ISS, pune, snap, 24 * 10, { minEl: 10 }));
});

test("trainEventsSteps and trainEvents agree", () => {
  const train = T.findTrains(D, precise, snap)[0];
  assert.ok(train, "the snapshot has a Starlink string");
  const a = T.trainEvents(train, precise, pune, snap, 72);
  assert.deepEqual(runSteps(T.trainEventsSteps(train, precise, pune, snap, 72)), a);
  assert.ok(pauses(T.trainEventsSteps(train, precise, pune, snap, 72)) >= 72 * 60 / 30 - 1);
});

test("buildTonightAsync gives exactly the plan buildTonight gives, for every city, after many pauses", async () => {
  for (const c of D.cities) {
    const place = placeOf(c.id);
    const args = { D, precise, place, now: snap, kp: kpAt(D.meta.kp, snap.getTime()) };
    const y = counting();
    const sliced = await N.buildTonightAsync(args, y.opts);
    assert.deepEqual(sliced, N.buildTonight(args), c.id);
    if (sliced.window) assert.ok(y.n > 20, `${c.id}: the work was spread over many slices (${y.n})`);
  }
});

test("buildTonightAsync with a budget yields only when a slice used it up", async () => {
  const args = { D, precise, place: pune, now: snap, kp: null };
  let t = 0;
  const y = { n: 0 };
  // a pretend clock that never moves: no slice ever uses up its budget, so it never yields and still gives the same plan
  const plan = await N.buildTonightAsync(args, { yieldFn: async () => { y.n++; }, now: () => t, budgetMs: 40 });
  assert.equal(y.n, 0);
  assert.deepEqual(plan, N.buildTonight(args));
});

test("skyCalendarSteps gives the same events in the same order as skyCalendar, in slices", async () => {
  for (const place of [pune, placeOf("tromso"), placeOf("sydney")]) {
    const args = { lat: place.lat, lon: place.lon, from: new Date(Date.UTC(2026, 9, 6)), days: 90 };
    const y = counting();
    const sliced = await runStepsAsync(skyCalendarSteps(args), y.opts);
    assert.deepEqual(sliced, skyCalendar(args));
    assert.ok(y.n >= 10, `paused ${y.n} times`);
  }
  const from = new Date(Date.UTC(2026, 0, 1)), end = new Date(Date.UTC(2027, 0, 1));
  assert.deepEqual(runSteps(planetEventsSteps(from, end)), planetEvents(from, end));
});
