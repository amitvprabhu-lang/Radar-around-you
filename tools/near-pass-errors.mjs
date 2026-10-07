// How far the "satellites near me" page's passes are from the real ones: the error of the CLOSEST GROUND DISTANCE and of the TIME of closest
// approach, measured with older and newer sets of real element sets for the same satellites.
//
// "Model": the page's model run on older published data (site/near.mjs: SGP4 from the swarm's packed mean elements, or from the full element
// set where the older precise.json had one). "Truth": SGP4 from the newer CelesTrak element sets. For each satellite, place and time window,
// every closest approach of the truth within 300 km is matched with the model's nearest approach in time (within 15 minutes), and the two
// differences are kept: |distance(model) - distance(truth)| in km and |time(model) - time(truth)| in s. An along-track error moves WHEN a pass
// happens much more than how close it comes; the page states the two separately.
//
// Kinds (site/near.mjs passKind): "station" (a full element set of a crewed station: the swarm's display kind 4, which pipeline/pack.py gives
// to the stations it lists, ISS 25544 and Tiangong 48274), "fullNew" (a full element set of a satellite launched in the last 30 days: most
// are still raising their orbits), "full" (any other full set) and "mean" (the swarm's packed mean elements without drag).
//
// Tables (site/near-errors.mjs, written by this script) give the 95th percentile of each by kind, height band and hours since the model's
// element epoch at the pass. Several older data sets can be measured together against one newer download:
//   node tools/near-pass-errors.mjs                                        the committed sample (test/fixtures/near-accuracy.json)
//   node tools/near-pass-errors.mjs <gp.json> <ISO time> <older folder> [<older folder> ...] [--write] [--marks]
// An older folder is a published live/satellites/<version>/ folder (swarm.bin, ids.bin, details.bin, precise.json, satmeta.json). Keep such
// folders from the live data branch and repeat this whenever a newer download exists; one week of data is one measurement.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json2satrec } from "satellite.js";
import { rowToOmm } from "../src/sgp4.js";
import { swarmOmm, uncertaintyBand, closestApproaches, classify, passError } from "../site/near.mjs";
import { COLS, usable, toRow, percentile, readOld } from "./near-accuracy.mjs";

export { readOld };

// OURS: where passes are compared. The twelve places the tables are made from (poles, equator, the date line, mid latitudes), and 28
// others (high latitudes, the equator, mid latitudes and eight random ones; the reviewer's list of 2026-10-07) for checking the marks
// out of sample.
export const PASS_PLACES = [
  { lat: 18.52, lon: 73.86 }, { lat: 69.65, lon: 18.96 }, { lat: 78.22, lon: 15.65 }, { lat: -16.8, lon: 179.99 }, { lat: 52, lon: -179.95 }, { lat: -0.18, lon: -78.47 },
  { lat: 0, lon: 0 }, { lat: -77.85, lon: 166.67 }, { lat: 51.5, lon: -0.12 }, { lat: 40.7, lon: -74 }, { lat: 35.68, lon: 139.69 }, { lat: -33.87, lon: 151.21 },
];
export const CHECK_PLACES = [
  [82.5, -62.35], [71.29, -156.79], [68.97, 33.07], [64.18, -51.72], [64.15, -21.94], [-54.8, -68.3], [-89.95, 0], [-68.58, 77.97], [1.35, 103.82], [-1.29, 36.82],
  [0.03, -51.07], [0.39, 9.45], [1.87, -157.4], [30.04, 31.24], [19.43, -99.13], [-12.05, -77.04], [-26.2, 28.05], [-31.95, 115.86], [55.75, 37.62], [49.28, -123.12],
].map(([lat, lon]) => ({ lat, lon }));
// windows of 12 hours from 12 to 72 hours after each older data time
export const PASS_WINDOWS = [[12, 24], [24, 36], [36, 48], [48, 60], [60, 72]];
// the upper edges of the age buckets (hours since the model's element epoch at the pass); the last bucket is open
export const AGE_EDGES = [36, 48, 60, 72];
export const ageBucket = (h) => { const k = AGE_EDGES.findIndex((e) => h < e); return k < 0 ? AGE_EDGES.length : k; };
export const KINDS = ["mean", "full", "fullNew", "station"];
const TRUTH_KM = 300, MATCH_MS = 15 * 60000, RECENT_MS = 30 * 86400000;
const satOf = (rec) => ({ rec, epochMs: (rec.jdsatepoch - 2440587.5) * 86400000 });
const launchMs = (day) => (day > 0 ? Date.UTC(1957, 9, 4) + (day - 1) * 86400000 : null);

// The model for each satellite of an older data set: { band, kind, model } as the page would build it (site/near.mjs passKind).
export function oldModels(old) {
  const full = new Map((old.precise ? old.precise.rows : []).map((r) => [r[0], r]));
  const out = new Map();
  for (const o of old.rows) {
    const f32 = new Float32Array([o[1], o[2]]), u16 = new Uint16Array([o[3], o[4], o[5], o[6], o[7], o[8] || 0]);
    const band = uncertaintyBand(f32[1], u16[0] / 65535);
    const pr = full.get(o[0]);
    const f = pr ? json2satrec(rowToOmm(old.precise.cols, pr)) : null;
    const lm = launchMs(o[9] || 0);
    const recent = lm !== null && old.refMs - lm <= RECENT_MS;
    if (f && !f.error) { out.set(o[0], { band, recent, kind: o[8] === 4 ? "station" : recent ? "fullNew" : "full", model: satOf(f) }); continue; }
    const mean = json2satrec(swarmOmm(f32, u16, 0, old.refMs, o[0]));
    if (!mean.error) out.set(o[0], { band, recent, kind: "mean", model: satOf(mean) });
  }
  return out;
}

const nearest = (p, list) => { let best = null; for (const q of list) if (Math.abs(q.t - p.t) <= MATCH_MS && (!best || Math.abs(q.t - p.t) < Math.abs(best.t - p.t))) best = q; return best; };

// Every matched pass of every older data set: { id, band, kind, ageH, km, s, truthKm } and the truth passes the model did not match.
export function measurePasses(rows, olds, { places = PASS_PLACES, windows = PASS_WINDOWS } = {}) {
  const recs = [], missed = {};
  const truths = new Map();
  for (const row of rows) { const tr = json2satrec(rowToOmm(COLS, row)); if (!tr.error) truths.set(row[0], satOf(tr)); }
  for (const old of [].concat(olds)) {
    const models = oldModels(old);
    for (const [id, truth] of truths) {
      const m = models.get(id);
      if (!m) continue;
      for (const pl of places) for (const [a, b] of windows) {
        const t0 = old.refMs + a * 3600000, t1 = old.refMs + b * 3600000;
        const tp = closestApproaches(truth, pl, t0, t1, TRUTH_KM);
        if (!tp.length) continue;
        const mp = closestApproaches(m.model, pl, t0 - MATCH_MS, t1 + MATCH_MS, 2 * TRUTH_KM);
        for (const p of tp) {
          const best = nearest(p, mp);
          if (!best) { const key = `${m.kind} ${m.band}`; missed[key] = (missed[key] || 0) + 1; continue; }
          recs.push({ id, band: m.band, kind: m.kind, ageH: (p.t - m.model.epochMs) / 3600000, km: Math.abs(best.km - p.km), s: Math.abs(best.t - p.t) / 1000, truthKm: p.km });
        }
      }
    }
  }
  return { recs, missed };
}

// 95th percentiles by kind, band and age bucket. Values: km rounded up to 0.5 km (at least FLOOR_KM), seconds up to 5 s (at least FLOOR_S).
// Small samples are never used raw: a bucket with fewer than MIN_BUCKET passes takes the value of the bucket before it (the first one, the
// row's all-ages value); a value may rise above the bucket before only when MIN_RISE or more passes say so; a row with fewer than MIN_ROW
// passes in all is left out, and the page then uses the kind's "other" row (its bands together) or, for a kind with no rows, the compact
// data's row for the band. A row with fewer than MIN_BUCKET passes in all gets a higher floor (SMALL_FLOOR_KM, SMALL_FLOOR_S), because its 95th
// percentile rests on a handful of the largest values. Every value is then made never to fall with age. `merged` marks each bucket whose own
// passes were too few.
export const MIN_BUCKET = 300, MIN_RISE = 500, MIN_ROW = 100, FLOOR_KM = 0.5, FLOOR_S = 5, SMALL_FLOOR_KM = 1, SMALL_FLOOR_S = 10;
const kmP95 = (v) => Math.max(FLOOR_KM, Math.ceil(percentile(v.map((r) => r.km), 0.95) * 2) / 2);
const sP95 = (v) => Math.max(FLOOR_S, Math.ceil(percentile(v.map((r) => r.s), 0.95) / 5) * 5);
export function rowOf(v) {
  if (v.length < MIN_ROW) return null;
  const small = v.length < MIN_BUCKET;
  const all = { km: small ? Math.max(SMALL_FLOOR_KM, kmP95(v)) : kmP95(v), s: small ? Math.max(SMALL_FLOOR_S, sP95(v)) : sP95(v) };
  const row = { km: [], s: [], n: [], merged: [] };
  for (let k = 0; k <= AGE_EDGES.length; k++) {
    const b = v.filter((r) => ageBucket(r.ageH) === k);
    row.n.push(b.length);
    const prev = k ? { km: row.km[k - 1], s: row.s[k - 1] } : all;
    if (b.length < MIN_BUCKET) { row.km.push(prev.km); row.s.push(prev.s); row.merged.push(true); continue; }
    let km = kmP95(b), s = sP95(b);
    if (k && b.length < MIN_RISE) { km = Math.min(km, prev.km); s = Math.min(s, prev.s); }
    row.km.push(km); row.s.push(s); row.merged.push(false);
  }
  for (let k = 1; k < row.km.length; k++) { row.km[k] = Math.max(row.km[k], row.km[k - 1]); row.s[k] = Math.max(row.s[k], row.s[k - 1]); }
  return { ...row, all, total: v.length };
}
export function passTables(recs) {
  const out = {};
  for (const kind of KINDS) {
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

// How well the page's marks match the truth at 25, 100 and 500 km, classified exactly as the page does (site/near.mjs classify and
// passError with the given tables). One search per satellite, place and window serves the three distances. Also the coverage: the share of
// listed rows whose true closest distance and true time are within the "±" printed next to them.
export function markCheck(rows, olds, { radii = [25, 100, 500], places = CHECK_PLACES, windows = PASS_WINDOWS, tables } = {}) {
  const truths = new Map();
  for (const row of rows) { const tr = json2satrec(rowToOmm(COLS, row)); if (!tr.error) truths.set(row[0], satOf(tr)); }
  const R = Object.fromEntries(radii.map((r) => [r, { truth: 0, truthWithin: 0, truthBorder: 0, truthUncertain: 0, truthMissed: 0, within: 0, withinTrue: 0, border: 0, borderInside: 0, borderNear: 0, uncertain: 0, listed: 0, kmCov: 0, sCov: 0, byKind: {} }]));
  const maxR = Math.max(...radii);
  for (const old of [].concat(olds)) {
    const models = oldModels(old);
    for (const [id, truth] of truths) {
      const m = models.get(id);
      if (!m) continue;
      const err = (t) => passError(m.band, m.kind, (t - m.model.epochMs) / 3600000, { floorMean: (m.kind === "full" || m.kind === "fullNew") && (m.band === "low-under-450" || m.recent), ...(tables ? { tables } : {}) });
      for (const pl of places) for (const [a, b] of windows) {
        const t0 = old.refMs + a * 3600000, t1 = old.refMs + b * 3600000;
        const uEnd = err(t1).km;
        const tp = closestApproaches(truth, pl, t0 - MATCH_MS, t1 + MATCH_MS, maxR + Math.min(uEnd, maxR) + 50);
        const mp = closestApproaches(m.model, pl, t0, t1, maxR + Math.min(uEnd, maxR)).map((p) => ({ ...p, e: err(p.t) }));
        for (const r of radii) {
          const o = R[r];
          for (const p of tp) {
            if (p.t < t0 || p.t > t1 || p.km > r) continue;
            o.truth++;
            const q = nearest(p, mp), st = q && classify(q.km, q.e.km, r);
            if (!st) o.truthMissed++; else if (st === "within") o.truthWithin++; else if (st === "borderline") o.truthBorder++; else o.truthUncertain++;
          }
          for (const q of mp) {
            const st = classify(q.km, q.e.km, r);
            if (!st) continue;
            if (st === "uncertain") { o.uncertain++; continue; }
            const p = nearest(q, tp);
            o.listed++;
            const kmOk = p && Math.abs(q.km - p.km) <= q.e.km ? 1 : 0, sOk = p && Math.abs(q.t - p.t) / 1000 <= q.e.s ? 1 : 0;
            o.kmCov += kmOk; o.sCov += sOk;
            for (const key of [m.kind, `${m.kind} ${m.band}`]) { const bk = (o.byKind[key] = o.byKind[key] || { n: 0, km: 0, s: 0 }); bk.n++; bk.km += kmOk; bk.s += sOk; }
            if (st === "within") { o.within++; if (p && p.km <= r) o.withinTrue++; }
            else { o.border++; if (p && p.km <= r) o.borderInside++; if (p && p.km <= r + q.e.km) o.borderNear++; }
          }
        }
      }
    }
  }
  const pc = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  return Object.fromEntries(Object.entries(R).map(([r, o]) => [r, {
    ...o, recallWithin: pc(o.truthWithin, o.truth), recallListed: pc(o.truthWithin + o.truthBorder, o.truth), precisionWithin: pc(o.withinTrue, o.within),
    borderInside: pc(o.borderInside, o.border), borderNear: pc(o.borderNear, o.border), kmCoverage: pc(o.kmCov, o.listed), sCoverage: pc(o.sCov, o.listed),
    byKind: Object.fromEntries(Object.entries(o.byKind).map(([k, x]) => [k, { n: x.n, km: pc(x.km, x.n), s: pc(x.s, x.n) }])),
  }]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  let rows, olds, label;
  if (args.length >= 3) {
    const refMs = Date.parse(args[1]);
    rows = JSON.parse(fs.readFileSync(args[0], "utf8")).filter((r) => usable(r, refMs)).map(toRow);
    olds = args.slice(2).map(readOld);
    label = { newer: `CelesTrak GP GROUP=active, downloaded ${new Date(refMs).toISOString()}`, older: olds.map((o) => `published live data of ${o.taken}`).join("; "), sets: rows.length };
  } else {
    const fx = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../test/fixtures/near-accuracy.json", import.meta.url)), "utf8"));
    rows = fx.rows; olds = [fx.old]; label = { newer: `the committed sample (${fx.downloadedAt})`, older: `published live data of ${fx.old.taken}`, sets: rows.length };
  }
  const t = Date.now();
  if (process.argv.includes("--marks")) {
    console.log(JSON.stringify(markCheck(rows, olds, { windows: [[12, 24], [36, 48], [60, 72]] }), null, 1));
    console.error(`marks: ${Math.round((Date.now() - t) / 1000)} s`);
    process.exit(0);
  }
  const { recs, missed } = measurePasses(rows, olds);
  const tables = passTables(recs);
  const merged = [];
  for (const [kind, t2] of Object.entries(tables)) for (const [band, row] of Object.entries(t2)) row.merged.forEach((x, k) => { if (x) merged.push(`${kind} ${band} bucket ${k} (${row.n[k]} passes)`); });
  console.log(JSON.stringify({ ...label, seconds: Math.round((Date.now() - t) / 1000), passes: recs.length, missed, summary: summary(recs), tables }, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  console.error(`buckets with fewer than ${MIN_BUCKET} passes of their own, given the value of the bucket before: ${merged.join("; ") || "none"}`);
  if (process.argv.includes("--write")) {
    const f = fileURLToPath(new URL("../site/near-errors.mjs", import.meta.url));
    const head = `// Written by tools/near-pass-errors.mjs (do not edit by hand; run it again on newer data). The measured error of the page's passes: the
// 95th percentile of |closest ground distance, model - truth| (km) and of |time of closest approach, model - truth| (s), by kind ("station",
// "fullNew", "full", "mean"; see the tool), height band and age bucket (hours since the model's element epoch at the pass: under
// ${AGE_EDGES.join(", ")} and over). n: matched passes in each bucket; merged: fewer than ${MIN_BUCKET} passes of its own, so the bucket before
// gives the value; all: the row's all-ages value. Truth: SGP4 from the newer element sets. Newer: ${label.newer}; older: ${label.older};
// ${label.sets} satellites.
`;
    fs.writeFileSync(f, `${head}export const PASS_ERRORS = ${JSON.stringify({ measured: { newer: label.newer, older: label.older, satellites: label.sets, passes: recs.length, places: PASS_PLACES.length, windowsHours: PASS_WINDOWS, datasets: olds.length }, ageEdges: AGE_EDGES, rules: { minBucket: MIN_BUCKET, minRise: MIN_RISE, minRow: MIN_ROW, floorKm: FLOOR_KM, floorS: FLOOR_S, smallFloorKm: SMALL_FLOOR_KM, smallFloorS: SMALL_FLOOR_S }, tables })};\n`);
    console.error(`wrote ${f}`);
  }
}
