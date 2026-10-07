// How far the "satellites near me" page's passes are from the real ones: the error of the CLOSEST GROUND DISTANCE and of the TIME of closest
// approach, measured with an older and a newer set of real element sets for the same satellites.
//
// "Model": the page's model run on the older published data (site/near.mjs: SGP4 from the swarm's packed mean elements, or from the full
// element set where the older precise.json had one). "Truth": SGP4 from the newer CelesTrak element sets, near their own epoch. For each
// satellite, place and time window, every closest approach of the truth within 300 km is matched with the model's nearest approach in time
// (within 15 minutes), and the two differences are kept: |distance(model) - distance(truth)| in km and |time(model) - time(truth)| in s.
// An along-track error moves WHEN a pass happens much more than how close it comes; the page states the two separately.
//
// Tables (site/near-errors.mjs, written by this script) give the 95th percentile of each by height band (site/near.mjs uncertaintyBand),
// by kind ("mean": packed mean elements, no drag; "full": full element sets) and by hours since the model's element epoch at the pass.
//   node tools/near-pass-errors.mjs                     measures the committed sample (test/fixtures/near-accuracy.json) and prints
//   node tools/near-pass-errors.mjs <gp.json> <ISO time of that download> <older satellites folder> --write
//                                                       measures a whole download against an older published folder and writes the tables
// Limits: one older/newer pair is one measurement; repeat it whenever a newer pair exists (keep an older live/satellites/<version>/ folder
// and a fresh download) and compare.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json2satrec } from "satellite.js";
import { rowToOmm } from "../src/sgp4.js";
import { swarmOmm, uncertaintyBand, closestApproaches, classify, passError } from "../site/near.mjs";
import { COLS, usable, toRow, percentile } from "./near-accuracy.mjs";

// OURS: where and when passes are compared. Twelve places from the poles to the equator and across the date line; three windows of 12
// hours, 24 to 60 hours after the older data time, so the truth (the newer sets, made about 36 to 48 hours after it) is never far from its
// own epoch.
export const PASS_PLACES = [
  { lat: 18.52, lon: 73.86 }, { lat: 69.65, lon: 18.96 }, { lat: 78.22, lon: 15.65 }, { lat: -16.8, lon: 179.99 }, { lat: 52, lon: -179.95 }, { lat: -0.18, lon: -78.47 },
  { lat: 0, lon: 0 }, { lat: -77.85, lon: 166.67 }, { lat: 51.5, lon: -0.12 }, { lat: 40.7, lon: -74 }, { lat: 35.68, lon: 139.69 }, { lat: -33.87, lon: 151.21 },
];
export const PASS_WINDOWS = [[24, 36], [36, 48], [48, 60]];
// the upper edges of the age buckets (hours since the model's element epoch at the pass); the last bucket is open
export const AGE_EDGES = [36, 48, 60, 72];
export const ageBucket = (h) => { const k = AGE_EDGES.findIndex((e) => h < e); return k < 0 ? AGE_EDGES.length : k; };
const TRUTH_KM = 300, MATCH_MS = 15 * 60000;
const satOf = (rec) => ({ rec, epochMs: (rec.jdsatepoch - 2440587.5) * 86400000 });

// The older side for each satellite: { mean, full? } SGP4 records. old: { refMs, rows: [[id, f0, f1, u0..u4]], precise: { cols, rows } }
export function oldModels(old) {
  const full = new Map((old.precise ? old.precise.rows : []).map((r) => [r[0], r]));
  const out = new Map();
  for (const o of old.rows) {
    const f32 = new Float32Array([o[1], o[2]]), u16 = new Uint16Array([o[3], o[4], o[5], o[6], o[7], 0]);
    const mean = json2satrec(swarmOmm(f32, u16, 0, old.refMs, o[0]));
    if (mean.error) continue;
    const pr = full.get(o[0]);
    const f = pr ? json2satrec(rowToOmm(old.precise.cols, pr)) : null;
    out.set(o[0], { band: uncertaintyBand(f32[1], u16[0] / 65535), mean: satOf(mean), full: f && !f.error ? satOf(f) : null });
  }
  return out;
}

// Every matched pass: { id, band, kind, ageH, km, s, truthKm } and the truth passes the model did not match (missed).
export function measurePasses(rows, old, { places = PASS_PLACES, windows = PASS_WINDOWS, ids = null } = {}) {
  const models = oldModels(old);
  const recs = [], missed = {};
  for (const row of rows) {
    if (ids && !ids.has(row[0])) continue;
    const m = models.get(row[0]);
    if (!m) continue;
    const tr = json2satrec(rowToOmm(COLS, row));
    if (tr.error) continue;
    const truth = satOf(tr);
    // a satellite with a full element set is shown with it, so its packed mean elements are not measured
    for (const [kind, model] of m.full ? [["full", m.full]] : [["mean", m.mean]]) {
      if (!model) continue;
      for (const pl of places) for (const [a, b] of windows) {
        const t0 = old.refMs + a * 3600000, t1 = old.refMs + b * 3600000;
        const tp = closestApproaches(truth, pl, t0, t1, TRUTH_KM);
        if (!tp.length) continue;
        const mp = closestApproaches(model, pl, t0 - MATCH_MS, t1 + MATCH_MS, 2 * TRUTH_KM);
        for (const p of tp) {
          let best = null;
          for (const q of mp) if (Math.abs(q.t - p.t) <= MATCH_MS && (!best || Math.abs(q.t - p.t) < Math.abs(best.t - p.t))) best = q;
          const key = `${kind} ${m.band}`;
          if (!best) { missed[key] = (missed[key] || 0) + 1; continue; }
          recs.push({ id: row[0], band: m.band, kind, ageH: (p.t - model.epochMs) / 3600000, km: Math.abs(best.km - p.km), s: Math.abs(best.t - p.t) / 1000, truthKm: p.km });
        }
      }
    }
  }
  return { recs, missed };
}

// 95th percentiles by kind, band and age bucket, with their counts. Values: km rounded up to 0.5 km (at least 0.5), seconds rounded up to
// 5 s (at least 5); never falling with age. A bucket with fewer than MIN_N passes takes the value of the bucket before it (marked filled);
// a band with no bucket of MIN_N passes but MIN_ALL in all takes its all-ages value in every bucket; a band with fewer than MIN_ALL in all
// has no row, and the page then uses the kind's "other" row: every pass of that kind, all bands together.
export const MIN_N = 30, MIN_ALL = 10;
const kmP95 = (v) => Math.max(0.5, Math.ceil(percentile(v.map((r) => r.km), 0.95) * 2) / 2);
const sP95 = (v) => Math.max(5, Math.ceil(percentile(v.map((r) => r.s), 0.95) / 5) * 5);
function rowOf(v) {
  const row = { km: [], s: [], n: [], filled: [] };
  for (let k = 0; k <= AGE_EDGES.length; k++) {
    const b = v.filter((r) => ageBucket(r.ageH) === k);
    row.n.push(b.length);
    if (b.length >= MIN_N) { row.km.push(kmP95(b)); row.s.push(sP95(b)); row.filled.push(false); } else { row.km.push(null); row.s.push(null); row.filled.push(true); }
  }
  const first = row.km.findIndex((x) => x !== null);
  if (first < 0) {
    if (v.length < MIN_ALL) return null;
    return { km: row.km.map(() => kmP95(v)), s: row.s.map(() => sP95(v)), n: row.n, filled: row.n.map(() => true), allAges: true };
  }
  // fill gaps from the nearest measured bucket before (or after, at the start), then make them never fall with age
  for (let k = 0; k < row.km.length; k++) if (row.km[k] === null) { const j = k < first ? first : k - 1; row.km[k] = row.km[j]; row.s[k] = row.s[j]; }
  for (let k = 1; k < row.km.length; k++) { row.km[k] = Math.max(row.km[k], row.km[k - 1]); row.s[k] = Math.max(row.s[k], row.s[k - 1]); }
  return row;
}
export function passTables(recs) {
  const out = {};
  for (const kind of ["mean", "full"]) {
    out[kind] = {};
    const mine = recs.filter((r) => r.kind === kind);
    for (const band of [...new Set(mine.map((r) => r.band))].sort()) {
      const row = rowOf(mine.filter((r) => r.band === band));
      if (row) out[kind][band] = row;
    }
    const other = rowOf(mine);
    if (other) out[kind].other = other;
  }
  return out;
}

export function summary(recs) {
  const out = {};
  for (const r of recs) (out[`${r.kind} ${r.band}`] = out[`${r.kind} ${r.band}`] || []).push(r);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, kmP50: percentile(v.map((r) => r.km), 0.5), kmP95: percentile(v.map((r) => r.km), 0.95), sP50: percentile(v.map((r) => r.s), 0.5), sP95: percentile(v.map((r) => r.s), 0.95) }]));
}

// How well the page's "within" and "borderline" marks match reality at one distance: the page's model on the older data, classified as
// the page does (site/near.mjs classify with the measured pass error), against the truth passes of the newer element sets, in one window.
// A full element set gets the floor of the packed elements' error (the page does so below 450 km and for launches in the last 30 days;
// launch dates are not in this data, so every full set gets it here).
export function markCheck(rows, old, radiusKm, { places = PASS_PLACES, window = [36, 48], tables } = {}) {
  const models = oldModels(old);
  const out = { truth: 0, truthWithin: 0, truthBorder: 0, truthUncertain: 0, truthMissed: 0, within: 0, withinTrue: 0, border: 0, borderInside: 0, borderNear: 0, uncertain: 0 };
  const t0 = old.refMs + window[0] * 3600000, t1 = old.refMs + window[1] * 3600000;
  for (const row of rows) {
    const m = models.get(row[0]);
    if (!m) continue;
    const tr = json2satrec(rowToOmm(COLS, row));
    if (tr.error) continue;
    const truth = satOf(tr), kind = m.full ? "full" : "mean", model = m.full || m.mean;
    const err = (t) => passError(m.band, kind, (t - model.epochMs) / 3600000, { floorMean: kind === "full", ...(tables ? { tables } : {}) });
    const uEnd = err(t1).km;
    for (const pl of places) {
      // truth out to the radius plus the widest borderline zone, so a borderline row can be judged
      const tp = closestApproaches(truth, pl, t0 - MATCH_MS, t1 + MATCH_MS, radiusKm + Math.min(uEnd, radiusKm) + 50);
      const mp = closestApproaches(model, pl, t0, t1, radiusKm + Math.min(uEnd, radiusKm)).map((p) => { const e = err(p.t); return { ...p, u: e.km, st: classify(p.km, e.km, radiusKm) }; });
      const near = (p, list) => { let best = null; for (const q of list) if (Math.abs(q.t - p.t) <= MATCH_MS && (!best || Math.abs(q.t - p.t) < Math.abs(best.t - p.t))) best = q; return best; };
      for (const p of tp) {
        if (p.t < t0 || p.t > t1 || p.km > radiusKm) continue;
        out.truth++;
        const q = near(p, mp);
        if (!q || !q.st) out.truthMissed++; else if (q.st === "within") out.truthWithin++; else if (q.st === "borderline") out.truthBorder++; else out.truthUncertain++;
      }
      for (const q of mp) {
        if (!q.st) continue;
        const p = near(q, tp);
        if (q.st === "within") { out.within++; if (p && p.km <= radiusKm) out.withinTrue++; }
        else if (q.st === "borderline") { out.border++; if (p && p.km <= radiusKm) out.borderInside++; if (p && p.km <= radiusKm + q.u) out.borderNear++; }
        else out.uncertain++;
      }
    }
  }
  return {
    ...out,
    recallWithin: out.truthWithin / out.truth, recallListed: (out.truthWithin + out.truthBorder) / out.truth, precisionWithin: out.withinTrue / out.within,
    borderInsideShare: out.border ? out.borderInside / out.border : null, borderNearShare: out.border ? out.borderNear / out.border : null,
  };
}

function readOld(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "satmeta.json"), "utf8"));
  const sw = fs.readFileSync(path.join(dir, "swarm.bin")), ids = fs.readFileSync(path.join(dir, "ids.bin"));
  const ab = sw.buffer.slice(sw.byteOffset, sw.byteOffset + sw.byteLength);
  const F = new Float32Array(ab, 0, meta.count * 2), U = new Uint16Array(ab, meta.count * 8, meta.count * 6);
  const I = new Uint32Array(ids.buffer.slice(ids.byteOffset, ids.byteOffset + ids.byteLength));
  const rows = [];
  for (let k = 0; k < meta.count; k++) rows.push([I[k], F[2 * k], F[2 * k + 1], U[6 * k], U[6 * k + 1], U[6 * k + 2], U[6 * k + 3], U[6 * k + 4]]);
  return { refMs: meta.ref, taken: meta.taken, rows, precise: JSON.parse(fs.readFileSync(path.join(dir, "precise.json"), "utf8")) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  let rows, old, label;
  if (args.length >= 3) {
    const refMs = Date.parse(args[1]);
    rows = JSON.parse(fs.readFileSync(args[0], "utf8")).filter((r) => usable(r, refMs)).map(toRow);
    old = readOld(args[2]);
    label = { newer: `CelesTrak GP GROUP=active, downloaded ${new Date(refMs).toISOString()}`, older: `published live data of ${old.taken}`, sets: rows.length };
  } else {
    const fx = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../test/fixtures/near-accuracy.json", import.meta.url)), "utf8"));
    rows = fx.rows; old = fx.old; label = { newer: `the committed sample (${fx.downloadedAt})`, older: `published live data of ${fx.old.taken}`, sets: rows.length };
  }
  const t = Date.now();
  if (process.argv.includes("--marks")) {
    for (const r of [25, 100, 500]) console.log(r, JSON.stringify(markCheck(rows, old, r), (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
    process.exit(0);
  }
  const { recs, missed } = measurePasses(rows, old);
  const tables = passTables(recs);
  console.log(JSON.stringify({ ...label, seconds: Math.round((Date.now() - t) / 1000), passes: recs.length, missed, summary: summary(recs), tables }, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  if (process.argv.includes("--write")) {
    const f = fileURLToPath(new URL("../site/near-errors.mjs", import.meta.url));
    const head = `// Written by tools/near-pass-errors.mjs (do not edit by hand; run it again on newer data). The measured error of the page's passes: the
// 95th percentile of |closest ground distance, model - truth| (km) and of |time of closest approach, model - truth| (s), by kind ("mean": the
// swarm's packed mean elements without drag; "full": full element sets), height band and age bucket (hours since the model's element epoch at
// the pass: under ${AGE_EDGES.join(", ")} and over). n: matched passes in each bucket; filled: fewer than ${MIN_N} passes, the value of the bucket
// before is used. Truth: SGP4 from the newer element sets. Newer: ${label.newer}; older: ${label.older}; ${label.sets} satellites.
`;
    fs.writeFileSync(f, `${head}export const PASS_ERRORS = ${JSON.stringify({ measured: { newer: label.newer, older: label.older, satellites: label.sets, passes: recs.length, places: PASS_PLACES.length, windowsHours: PASS_WINDOWS }, ageEdges: AGE_EDGES, minN: MIN_N, tables })};\n`);
    console.error(`wrote ${f}`);
  }
}
