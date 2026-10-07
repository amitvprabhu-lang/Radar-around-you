// /satellites-near-me/: checks added in the second review round (2026-10-07): every approach of an inclined geosynchronous satellite, the
// stations' own uncertainty, and the data choice after a broken live publish. The first round's checks are in test/near.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSteps } from "../src/schedule.js";
import { closestApproaches, groundDistanceKm, stateAt, searchNear, prepareSatellites, decodeFeed, satPassError, passKind } from "../site/near.mjs";
import { readSatelliteFiles } from "../site/near-site.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = readSatelliteFiles(path.join(root, "public"));
const t0 = Date.parse(bundled.meta.taken);
const prep = prepareSatellites(decodeFeed(bundled), t0);

test("every approach of an inclined geosynchronous satellite is found: 120 s brute force over 24 hours at 10 places, out to 500 km", () => {
  const t1 = t0 + 86400000;
  const igso = prep.sats.filter((s) => s.orbit === "geostationary");
  assert.ok(igso.length >= 100, String(igso.length));
  const places = [[-33.87, 151.21], [1.35, 103.82], [35.68, 139.69], [0.39, 9.45], [-0.18, -78.47], [1.87, -157.4], [28.61, 77.21], [-12.46, 130.84], [-6.2, 106.85], [39.9, 116.4]].map(([lat, lon]) => ({ lat, lon }));
  let minima = 0;
  for (const pl of places) {
    for (const s of igso) {
      const found = closestApproaches(s, pl, t0, t1, 500);
      const d = [];
      for (let t = t0; t <= t1; t += 120000) { const st = stateAt(s, t); d.push(st ? groundDistanceKm(pl, st.ecef).km : Infinity); }
      for (let k = 1; k < d.length - 1; k++) {
        if (!(d[k] <= d[k - 1] && d[k] < d[k + 1] && d[k] < 499)) continue;
        minima++;
        const hit = found.find((m) => Math.abs(m.t - (t0 + k * 120000)) <= 30 * 60000);
        assert.ok(hit && hit.km <= d[k] + 0.5, `${s.name} at ${pl.lat},${pl.lon}: minimum of ${d[k].toFixed(1)} km at ${new Date(t0 + k * 120000).toISOString()} not found`);
      }
    }
  }
  assert.ok(minima >= 40, String(minima));
  // the cases the review found (TJS-26A at Jakarta inside 100 km, QZS-2 near Tokyo inside 500 km)
  const tjs = igso.find((s) => s.name.startsWith("TJS-26A")), qzs2 = igso.find((s) => s.name.startsWith("QZS-2"));
  assert.ok(tjs && closestApproaches(tjs, { lat: -6.2, lon: 106.85 }, t0, t1, 100).length >= 1, "TJS-26A at Jakarta");
  assert.ok(qzs2 && closestApproaches(qzs2, { lat: 35.68, lon: 139.69 }, t0, t1, 500).length >= 1, "QZS-2 near Tokyo");
});

test("the ISS and Tiangong are listed at 25 and 50 km with a station's small uncertainty; new launches keep the wide one", () => {
  for (const id of [25544, 48274]) {
    const sat = prep.sats.find((s) => s.id === id);
    assert.ok(sat && sat.exact && sat.station && passKind(sat) === "station", `${id} is a station with its full element set`);
    // a place 10 km off the ground point an hour into the day
    const g = groundDistanceKm({ lat: 0, lon: 0 }, stateAt(sat, t0 + 3600000).ecef);
    const place = { lat: g.lat + 0.09, lon: g.lon };
    for (const r of [25, 50]) {
      const res = runSteps(searchNear({ sats: [sat], geo: [], counts: prep.counts }, place, { startMs: t0, radiusKm: r }));
      const p = res.passes.find((x) => Math.abs(x.t - (t0 + 3600000)) < 120000);
      assert.ok(p && p.status === "within", `${sat.name} at ${r} km: ${JSON.stringify(res.passes.map((x) => [x.km, x.u, x.status]))}`);
      assert.ok(p.u < 2 && p.us <= 10, `${sat.name}: ± ${p.u} km, ${p.us} s`);
    }
  }
  const fresh = prep.sats.find((s) => s.exact && s.recent && !s.station && s.band === "low-under-450");
  assert.ok(fresh && passKind(fresh) === "fullNew", "a new launch below 450 km with a full set is in the bundled data");
  const e = satPassError(fresh, 30);
  assert.ok(e.km >= 10 && e.s >= 60, `new launch: ± ${e.km} km, ${e.s} s`);
});

test("a note when many satellites reach the oldest measured age before the 24 hours end; counted by the search", async () => {
  const { staleState, WARN_AGING_SHARE } = await import("../site/near-ui.mjs");
  assert.equal(staleState({ active: 16000, stale: 100, used: 15900, agingByEnd: 6000 }).aging, true);
  assert.equal(staleState({ active: 16000, stale: 100, used: 15900, agingByEnd: 1000 }).aging, false);
  assert.equal(staleState({ active: 16000, stale: 15990, used: 10, agingByEnd: 10 }).aging, false, "no note when there is no answer");
  // 50 hours after the bundled data time most element sets pass 72 hours before the day ends
  const later = prepareSatellites(decodeFeed(bundled), t0 + 50 * 3600000);
  const res = runSteps(searchNear({ sats: later.sats.slice(0, 2000), geo: [], counts: later.counts }, { lat: 18.52, lon: 73.86 }, { startMs: t0 + 50 * 3600000, radiusKm: 25 }));
  assert.ok(res.counts.agingByEnd / 2000 > WARN_AGING_SHARE, String(res.counts.agingByEnd));
});

test("after a broken publish the calculation keeps the last good live data; a version that does not decode is fetched once", async () => {
  const calc = await import("../site/near-calc.mjs");
  const pub = (f) => fs.readFileSync(path.join(root, "public", f));
  const F = ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json", "satmeta.json"];
  const files = new Map(["meta.json", "manifest.json", "swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json"].map((f) => [`E/${f}`, pub(f)]));
  const put = (v, taken, names = pub("names.txt")) => {
    for (const f of F.slice(0, 5)) files.set(`E/live/satellites/${v}/${f}`, f === "names.txt" ? names : pub(f));
    files.set(`E/live/satellites/${v}/satmeta.json`, Buffer.from(JSON.stringify({ ref: bundled.meta.ref, taken, count: bundled.meta.count })));
  };
  const manifest = (v, t) => files.set("E/live/manifest.json", Buffer.from(JSON.stringify({ schema: 1, generatedAt: t, pollSec: 300, feeds: { satellites: { version: v, fetchedAt: t, checkedAt: t, staleAfterSec: 21600, status: "ok", refreshSec: 7200, sizes: {}, files: Object.fromEntries(F.map((f) => [f, `satellites/${v}/${f}`])) } } })));
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); const b = files.get(String(url).split("?")[0]); return b ? new Response(b, { status: 200 }) : new Response("", { status: 404 }); };
  try {
    const now = t0 + 3 * 3600000;
    const at = (h) => new Date(t0 + h * 3600000).toISOString().replace(/\.\d+Z/, "Z");
    put("G1", at(1)); manifest("G1", at(1));
    assert.equal((await calc.loadFeed("E/", () => {}, now)).info.version, "G1");
    manifest("BROKEN", at(2));
    let r = await calc.loadFeed("E/", () => {}, now);
    assert.equal(r.info.source, "live"); assert.equal(r.info.version, "G1"); assert.equal(r.info.failedVersion, "BROKEN");
    asked.length = 0;
    r = await calc.loadFeed("E/", () => {}, now);
    assert.equal(r.info.version, "G1", "the next run (a new distance, say) keeps the good live data");
    assert.deepEqual(asked.filter((u) => !u.includes("manifest")), [], "nothing is downloaded again");
    put("SHORT", at(2), Buffer.from(bundled.names.split("\n").slice(1).join("\n"))); manifest("SHORT", at(2));
    asked.length = 0;
    r = await calc.loadFeed("E/", () => {}, now);
    assert.equal(r.info.version, "G1"); assert.equal(r.info.failedVersion, "SHORT");
    const first = asked.filter((u) => u.includes("SHORT")).length;
    asked.length = 0;
    await calc.loadFeed("E/", () => {}, now);
    assert.ok(first >= 5 && asked.filter((u) => u.includes("SHORT")).length === 0, "a version that does not decode is fetched once");
    put("G3", at(2.5)); manifest("G3", at(2.5));
    assert.equal((await calc.loadFeed("E/", () => {}, now)).info.version, "G3", "a new good version is taken up");
  } finally { globalThis.fetch = realFetch; }
});
