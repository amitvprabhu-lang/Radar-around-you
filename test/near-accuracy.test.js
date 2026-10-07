// The "satellites near me" page's accuracy, measured on real CelesTrak element sets (test/fixtures/near-accuracy.json: a stratified sample
// of 841 sets from the active list downloaded on 2026-10-07, made by tools/near-accuracy.mjs). See docs/satellites-near-me-sources.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { measure, measureAhead, packSwarm, percentile, COLS } from "../tools/near-accuracy.mjs";
import { U_TABLE, U_HOURS, ACCURACY, uncertaintyKm } from "../site/near.mjs";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/near-accuracy.json", import.meta.url), "utf8"));
const m = measure(fx.rows, fx.refMs, { bandCounts: fx.bandCounts });

// Stated bounds (km). The page model is SGP4 from the swarm's packed mean elements with no drag terms (site/near.mjs).
export const BOUNDS = {
  pageP95At24hFrom450: 30,  // satellites from 450 km up, 24 hours after the data time; 26.7 on the whole download
  pageP95At24hAll: 70,      // every satellite; 59.6 on the whole download, set by the low, high-drag ones
  pageP95At6hAll: 20,       // 15.0 on the whole download
  pageP95At0hAll: 10,       // 7.4 on the whole download
};

test("the sample is the committed one: real element sets, every band, the layout the tool writes", () => {
  assert.equal(fx.cols.join(), COLS.join());
  assert.equal(fx.rows.length, 841);
  assert.equal(m.n, 841, "SGP4 accepts every set in the sample");
  for (const band of Object.keys(U_TABLE)) assert.ok(m.inBand[band] > 0, `${band} is sampled`);
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

test("the uncertainty table covers the sample: every band and hour within the table's value (50 percent and 1 km allowed for sampling)", () => {
  for (const [band, hours] of Object.entries(m.byBand)) {
    for (const h of U_HOURS) {
      const s = hours[h];
      if (!s || s.n < 15) continue;
      const allowed = U_TABLE[band][U_HOURS.indexOf(h)] * 1.5 + 1;
      assert.ok(s.p95 <= allowed, `${band} at ${h} h: sample p95 ${s.p95.toFixed(1)} km, table ${U_TABLE[band][U_HOURS.indexOf(h)]} km`);
    }
  }
});

test("the uncertainty table never falls with time and is at least 1 km; between hours it is interpolated", () => {
  for (const [band, row] of Object.entries(U_TABLE)) {
    assert.equal(row.length, U_HOURS.length, band);
    row.forEach((v, k) => { assert.ok(v >= 1, band); if (k) assert.ok(v >= row[k - 1], `${band} at ${U_HOURS[k]} h`); });
  }
  assert.equal(uncertaintyKm("low-450-600", 24), 11);
  assert.equal(uncertaintyKm("low-450-600", 30), 11 + (24 - 11) / 2);
  assert.equal(uncertaintyKm("low-450-600", -3), 1, "an epoch just after the start counts as hour 0");
  assert.equal(uncertaintyKm("low-450-600", 500), 168, "past the last hour the last value holds");
});

test("the second check (older published data against newer element sets) is larger than the model's own error, as the page says", () => {
  const a = measureAhead(fx.rows, fx.old);
  const s = a["low-450-600"]["48-60"];
  assert.ok(s.n >= 50, String(s.n));
  // the model alone at 48 hours: 42 km at the 95th percentile (U_TABLE); the real-world check is of the same order or larger
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
