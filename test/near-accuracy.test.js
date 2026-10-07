// The "satellites near me" page's accuracy, measured on real CelesTrak element sets (test/fixtures/near-accuracy.json: a stratified sample
// of 841 sets from the active list downloaded on 2026-10-07, plus 184 satellites that had full element sets in the older data, made by
// tools/near-accuracy.mjs). Two measurements: the model's position against full SGP4 (why the page uses SGP4), and the pass errors the page
// prints (tools/near-pass-errors.mjs, site/near-errors.mjs). See docs/satellites-near-me-sources.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { measure, measureAhead, packSwarm, percentile, COLS } from "../tools/near-accuracy.mjs";
import { measurePasses, passTables, AGE_EDGES, ageBucket } from "../tools/near-pass-errors.mjs";
import { POSITION_P95, U_HOURS, ACCURACY, positionErrorKm, PASS_ERRORS } from "../site/near.mjs";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/near-accuracy.json", import.meta.url), "utf8"));
const added = new Set(fx.addedForFullSets.ids);
const stratified = fx.rows.filter((r) => !added.has(r[0]));
const m = measure(stratified, fx.refMs, { bandCounts: fx.bandCounts });

// Stated bounds (km). The page model is SGP4 from the swarm's packed mean elements with no drag terms (site/near.mjs).
export const BOUNDS = {
  pageP95At24hFrom450: 30,  // satellites from 450 km up, 24 hours after the data time; 26.7 on the whole download
  pageP95At24hAll: 70,      // every satellite; 59.6 on the whole download, set by the low, high-drag ones
  pageP95At6hAll: 20,       // 15.0 on the whole download
  pageP95At0hAll: 10,       // 7.4 on the whole download
};

test("the sample is the committed one: real element sets, every band, the layout the tool writes", () => {
  assert.equal(fx.cols.join(), COLS.join());
  assert.equal(stratified.length, 841); assert.equal(fx.rows.length, 841 + added.size);
  assert.equal(m.n, 841, "SGP4 accepts every set in the sample");
  for (const band of Object.keys(POSITION_P95)) assert.ok(m.inBand[band] > 0, `${band} is sampled`);
  assert.ok(fx.old.precise.rows.length >= 150, "the older full element sets are in the sample");
  assert.equal(Object.values(fx.bandCounts).reduce((a, b) => a + b, 0), ACCURACY.sets, "the band counts are the whole download's");
  assert.equal(new Date(fx.refMs).toISOString().replace(".000", ""), ACCURACY.downloadedAt);
});

test("the page's model stays within the stated bounds at +0, +6 and +24 hours from the data time (95th percentile, catalogue-weighted)", () => {
  assert.ok(m.fromData[0].page.p95 <= BOUNDS.pageP95At0hAll, `+0 h: ${m.fromData[0].page.p95}`);
  assert.ok(m.fromData[6].page.p95 <= BOUNDS.pageP95At6hAll, `+6 h: ${m.fromData[6].page.p95}`);
  assert.ok(m.fromData[24].page.p95 <= BOUNDS.pageP95At24hAll, `+24 h: ${m.fromData[24].page.p95}`);
  assert.ok(m.fromData[24].pageFrom450.p95 <= BOUNDS.pageP95At24hFrom450, `+24 h from 450 km: ${m.fromData[24].pageFrom450.p95}`);
  // the medians are far smaller: most of the 95th percentile is drag on the lowest satellites
  assert.ok(m.fromData[24].page.p50 < 5, String(m.fromData[24].page.p50));
});

test("why the page does not use the app's fast swarm model: it is off by about 8 km even at the data time, and over 25 km at +24 hours", () => {
  assert.ok(m.fromData[0].app.p50 > 5 && m.fromData[0].page.p50 < 1, `${m.fromData[0].app.p50} against ${m.fromData[0].page.p50}`);
  assert.ok(m.fromData[24].app.p95 > 25, String(m.fromData[24].app.p95));
  assert.ok(m.fromData[24].app.p50 > m.fromData[24].page.p50 * 2);
});

test("the position table covers the sample: every band and hour within the table's value (50 percent and 1 km allowed for sampling)", () => {
  for (const [band, hours] of Object.entries(m.byBand)) {
    for (const h of U_HOURS) {
      const s = hours[h];
      if (!s || s.n < 15) continue;
      const allowed = POSITION_P95[band][U_HOURS.indexOf(h)] * 1.5 + 1;
      assert.ok(s.p95 <= allowed, `${band} at ${h} h: sample p95 ${s.p95.toFixed(1)} km, table ${POSITION_P95[band][U_HOURS.indexOf(h)]} km`);
    }
  }
});

test("the position table never falls with time and is at least 1 km; between hours it is interpolated", () => {
  for (const [band, row] of Object.entries(POSITION_P95)) {
    assert.equal(row.length, U_HOURS.length, band);
    row.forEach((v, k) => { assert.ok(v >= 1, band); if (k) assert.ok(v >= row[k - 1], `${band} at ${U_HOURS[k]} h`); });
  }
  assert.equal(positionErrorKm("low-450-600", 24), 11);
  assert.equal(positionErrorKm("low-450-600", 30), 11 + (24 - 11) / 2);
  assert.equal(positionErrorKm("low-450-600", -3), 1, "an epoch just after the start counts as hour 0");
  assert.equal(positionErrorKm("low-450-600", 500), 168, "past the last hour the last value holds");
});

test("the second check (older published data against newer element sets) is larger than the model's own error, as the page says", () => {
  const a = measureAhead(stratified, fx.old);
  const s = a["low-450-600"]["48-60"];
  assert.ok(s.n >= 50, String(s.n));
  // the model alone at 48 hours: 42 km at the 95th percentile (POSITION_P95); the real-world check is of the same order or larger
  assert.ok(s.p95 >= 30 && s.p95 <= 120, String(s.p95));
  assert.ok(a.medium["48-60"].p95 < 5, "medium orbits stay within a few km");
});

test("packing matches the published swarm.bin for the rows of public/precise.json (the epoch to a few milliseconds)", () => {
  // public/precise.json and public/swarm.bin come from the same collection, so packing the full row must give the published values
  const precise = JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8"));
  const meta = JSON.parse(fs.readFileSync(new URL("../public/meta.json", import.meta.url), "utf8"));
  const ids = new Uint32Array(fs.readFileSync(new URL("../public/ids.bin", import.meta.url)).buffer.slice(0));
  const sw = fs.readFileSync(new URL("../public/swarm.bin", import.meta.url));
  const ab = sw.buffer.slice(sw.byteOffset, sw.byteOffset + sw.byteLength);
  const F = new Float32Array(ab, 0, meta.count * 2), U = new Uint16Array(ab, meta.count * 8, meta.count * 6);
  let checked = 0;
  for (const row of precise.rows.slice(0, 20)) {
    const k = ids.indexOf(row[0]);
    if (k < 0) continue;
    const o = Object.fromEntries(precise.cols.map((c, i) => [c, row[i]]));
    const p = packSwarm(o, meta.ref);
    // pack.py reads the epoch to the microsecond, Date.parse to the millisecond: one float32 step (about 2 ms here) apart at most
    assert.ok(Math.abs(p.f32[0] - F[2 * k]) < 1e-4, `${row[0]} epoch`); assert.equal(p.f32[1], F[2 * k + 1], `${row[0]} mean motion`);
    for (let j = 0; j < 5; j++) assert.equal(p.u16[j], U[6 * k + j], `${row[0]} element ${j}`);
    checked++;
  }
  assert.ok(checked >= 10, String(checked));
});

test("percentile handles weights", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 100], 0.5, [9, 1]), 1);
  assert.equal(percentile([1, 100], 0.95, [9, 1]), 100);
});

// ------------------------------------------------------------------ the pass errors the page prints (site/near-errors.mjs)
const passes = measurePasses(fx.rows, fx.old);
const own = passTables(passes.recs);
// Stated bounds for the committed sample (95th percentiles of the packed elements' passes under 72 hours; the whole download in comments)
export const PASS_BOUNDS = {
  "low-450-600": { km: 3, s: 20 },      // 1.85 km and 7.5 s on the whole download, all ages
  "low-600-1000": { km: 3, s: 20 },     // 0.64 km and 2.5 s
  "low-under-450": { km: 40, s: 240 },  // 19.7 km and 123 s
};
test("pass errors on the committed sample: the closest-distance and time errors per band stay within the stated bounds", () => {
  assert.ok(passes.recs.length > 5000, String(passes.recs.length));
  for (const [band, b] of Object.entries(PASS_BOUNDS)) {
    const v = passes.recs.filter((r) => r.kind === "mean" && r.band === band && r.ageH < 72);
    assert.ok(v.length >= 100, `${band}: ${v.length} passes`);
    const km = percentile(v.map((r) => r.km), 0.95), s = percentile(v.map((r) => r.s), 0.95);
    assert.ok(km <= b.km, `${band}: distance p95 ${km.toFixed(2)} km`);
    assert.ok(s <= b.s, `${band}: time p95 ${s.toFixed(1)} s`);
  }
});

test("the page's pass-error tables agree with the committed sample (each measured bucket within 50 percent plus 1 km and 10 s)", () => {
  const T = PASS_ERRORS.tables;
  assert.deepEqual(PASS_ERRORS.ageEdges, AGE_EDGES);
  let compared = 0;
  for (const kind of ["mean", "full"]) for (const [band, row] of Object.entries(own[kind])) {
    const page = T[kind][band];
    if (!page || band === "other") continue;
    for (let k = 0; k <= AGE_EDGES.length; k++) {
      if (row.filled[k] || row.n[k] < 100) continue;
      assert.ok(row.km[k] <= page.km[k] * 1.5 + 1, `${kind} ${band} bucket ${k}: sample ${row.km[k]} km, table ${page.km[k]} km`);
      assert.ok(row.s[k] <= page.s[k] * 1.5 + 10, `${kind} ${band} bucket ${k}: sample ${row.s[k]} s, table ${page.s[k]} s`);
      compared++;
    }
  }
  assert.ok(compared >= 8, String(compared));
  assert.equal(ageBucket(10), 0); assert.equal(ageBucket(36), 1); assert.equal(ageBucket(100), AGE_EDGES.length);
});

test("why the pass error is not the position error: along the track, passes move in time, not in closest distance", () => {
  // for satellites 450 to 600 km up, about two days ahead, the position is tens of km off (POSITION_P95) while the closest distance is a few km
  const v = passes.recs.filter((r) => r.kind === "mean" && r.band === "low-450-600" && r.ageH >= 36 && r.ageH < 60);
  assert.ok(percentile(v.map((r) => r.km), 0.95) * 5 < positionErrorKm("low-450-600", 48), "the closest-distance error is far smaller than the position error");
});
