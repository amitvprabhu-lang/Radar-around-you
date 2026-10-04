import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../src/info.js";
import * as C from "../src/core.js";
import { loadD } from "./helpers.js";

const D = loadD();
const snapMs = Date.parse(D.meta.taken);
const pune = { lat: 18.5204, lon: 73.8567, name: "Pune" };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} +- ${tol}, got ${a}`);

test("ISS card facts come from the packed catalogue", () => {
  const idx = D.later.ids.indexOf(25544);
  const info = I.satelliteInfo(D, idx, new Date(snapMs), pune);
  assert.equal(info.noradId, 25544);
  assert.match(info.name, /ISS/);
  assert.equal(info.owner, "International Space Station");
  assert.equal(info.siteCode, "TYMSC");
  assert.equal(info.launchDate.toISOString().slice(0, 10), "1998-11-20");
  assert.equal(info.objectType, "Satellite");
  assert.equal(info.purpose, "Space station");
  assert.ok(info.altKm > 380 && info.altKm < 440, `ISS height ${info.altKm}`);
  near(info.speedKmS, 7.66, 0.06, "ISS speed is about 7.66 km/s");
  near(info.periodMin, 92.9, 1.2, "ISS period is about 93 minutes");
  near(info.inclinationDeg, 51.6, 0.1, "inclination");
  assert.ok(info.footprintKm > 2100 && info.footprintKm < 2400);
  assert.ok(info.look && info.look.az >= 0 && info.look.az < 360);
  assert.equal(info.isNew, false);
});

test("a Starlink satellite is owned by the United States and flies at about 550 km", () => {
  const idx = D.later.names.findIndex((n, i) => /^STARLINK-/.test(n) && D.swarm[i].a - 6378 < 600);
  const info = I.satelliteInfo(D, idx, new Date(snapMs), pune);
  assert.equal(info.owner, "United States");
  assert.equal(info.groupType, 1);
  assert.ok(info.altKm > 300 && info.altKm < 620, `altitude ${info.altKm}`);
});

test("objects launched in the last 30 days are marked new and grouped by launch day", () => {
  const launches = I.recentLaunches(D, snapMs);
  assert.equal(launches.reduce((s, g) => s + g.count, 0), D.meta.newIdx.length, "every new object is in a group");
  assert.ok(launches.length >= 3 && launches.length <= 30, `groups: ${launches.length}`);
  for (let i = 1; i < launches.length; i++) assert.ok(launches[i - 1].launchDay >= launches[i].launchDay, "newest first");
  const first = launches[0];
  assert.ok(first.ageDays >= 0 && first.ageDays <= 30, `age ${first.ageDays}`);
  const info = I.satelliteInfo(D, first.first, new Date(snapMs), pune);
  assert.equal(info.isNew, true);
  assert.match(I.listWithMore(["A", "B", "C", "D"], 2), /A, B and 2 more/);
  assert.equal(I.listWithMore(["A", "B"], 2), "A, B");
});

test("earthquake card: distance, wave arrival and exposure", () => {
  const q = D.quakes.events.find((e) => e.id === "us6000tzer");
  const info = I.quakeInfo(D, q, pune, snapMs);
  assert.equal(info.mag, 5.9);
  assert.equal(info.alert, "green");
  assert.equal(info.tsunami, false);
  assert.equal(info.hasShakeMap, true);
  near(info.distKm, C.haversineKm(pune.lat, pune.lon, q.lat, q.lon), 1e-6, "distance");
  assert.ok(info.sSec > info.pSec * 1.6 && info.sSec < info.pSec * 1.9, "S arrives after P (speed ratio 8.0/4.5)");
  assert.equal(info.pReached, true, "the quake is hours old, so the waves have passed");
  assert.equal(info.layer, "upper mantle", "46 km deep is below the crust");
  assert.equal(I.exposureAtOrAbove(info.exposure, 4), 498194 + 163178);
  assert.equal(I.exposureAtOrAbove(info.exposure, 6), 0);
  assert.equal(I.exposureAtOrAbove(null, 4), 0);
  assert.ok(I.quakeTimeMs(q) > 0 && I.quakeTimeMs({ time: 1000 }) === 1000);
  // a quake with no ShakeMap data still gives a usable card
  const plain = I.quakeInfo(D, D.quakes.events.find((e) => !D.later.impact[e.id]), pune, snapMs);
  assert.equal(plain.hasShakeMap, false);
  assert.equal(plain.exposure, null);
});

test("aircraft card: airline, route and progress", () => {
  const pune0 = D.cities.find((c) => c.id === "pune");
  const withRoute = pune0.planes.aircraft.find((p) => D.later.routes[p.call]);
  assert.ok(withRoute, "at least one Pune aircraft has a known route");
  const rec = { p: withRoute, pos: { lat: withRoute.lat, lon: withRoute.lon }, distKm: 50, slantKm: 52, el: 10, az: 90 };
  const info = I.planeInfo(D, rec);
  assert.ok(info.route.length >= 2);
  assert.ok(info.progress && info.progress.fraction >= 0 && info.progress.fraction <= 1);
  assert.equal(info.altM, Math.round(withRoute.altFt * 0.3048));
  assert.equal(info.gsKmh, Math.round(withRoute.gsKt * 1.852));
  assert.equal(I.aircraftName("A21N"), "Airbus A321neo");
  assert.equal(I.aircraftName("ZZZ9"), "Type ZZZ9");
  assert.equal(I.aircraftName(""), "Type not reported");
  const known = pune0.planes.aircraft.find((p) => D.later.airlines[C.airlineCode(p.call)]);
  assert.ok(known, "an airline name is known for at least one aircraft");
  assert.ok(I.planeInfo(D, { p: known, distKm: 1, slantKm: 1, el: 1, az: 1 }).airline);
  const noRoute = I.planeInfo(D, { p: { ...withRoute, call: "ZZZ0000" }, distKm: 1, slantKm: 1, el: 1, az: 1 });
  assert.equal(noRoute.route, null); assert.equal(noRoute.progress, null);
});

test("Kp lookup uses the latest value at or before the time", () => {
  const kp = [{ t: "2026-10-04T00:00:00", kp: 3 }, { t: "2026-10-04T03:00:00", kp: 3.3 }, { t: "2026-10-04T06:00:00", kp: 4.3 }];
  assert.equal(I.kpAt(kp, Date.parse("2026-10-04T04:00:00Z")).kp, 3.3);
  assert.equal(I.kpAt(kp, Date.parse("2026-10-03T23:00:00Z")), null);
  assert.equal(I.kpAt(kp, Date.parse("2026-10-05T00:00:00Z")).kp, 4.3);
});

import { tonightPlan, cloudAtHour } from "../src/plan.js";

test("moon phase names cover the whole circle", () => {
  assert.equal(I.moonPhaseName(0), "New Moon");
  assert.equal(I.moonPhaseName(45), "Waxing crescent");
  assert.equal(I.moonPhaseName(90), "First quarter");
  assert.equal(I.moonPhaseName(135), "Waxing gibbous");
  assert.equal(I.moonPhaseName(180), "Full Moon");
  assert.equal(I.moonPhaseName(225), "Waning gibbous");
  assert.equal(I.moonPhaseName(270), "Last quarter");
  assert.equal(I.moonPhaseName(315), "Waning crescent");
  assert.equal(I.moonPhaseName(359), "New Moon");
  assert.equal(I.moonPhaseName(-45), "Waning crescent");
});

test("tonight planner scores dark clear hours highest and daylight zero", () => {
  const pune0 = D.cities.find((c) => c.id === "pune");
  const place = { ...pune0, lat: Number(pune0.lat), lon: Number(pune0.lon) };
  const plan = tonightPlan(place, new Date(snapMs), 0);
  assert.equal(plan.hours.length, 13);
  for (const h of plan.scored) {
    assert.ok(h.score >= 0 && h.score <= 100);
    if (h.sunAlt > -6) assert.equal(h.score, 0, "daylight and bright twilight score zero");
  }
  // the same hours with the cloud forecast replaced by solid cloud can never score better
  const cloudy = tonightPlan({ ...place, clouds: { hours: place.clouds.hours.map((x) => ({ ...x, cloud: 100 })) } }, new Date(snapMs), 0);
  cloudy.scored.forEach((h, i) => assert.ok(h.score <= plan.scored[i].score));
  assert.ok(cloudy.best === null || cloudy.best.avg === 0 || cloudy.scored.every((h) => h.score === 0));
  assert.equal(cloudAtHour(place.clouds, new Date("2000-01-01")), null, "no forecast far outside the window");
  assert.equal(cloudAtHour(null, new Date()), null);
});
