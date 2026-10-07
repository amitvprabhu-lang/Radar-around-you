// How far the "satellites near me" page's orbit model can be from full SGP4, measured on real CelesTrak element sets.
//
// The page (site/near.mjs) runs SGP4 from the mean elements the published swarm.bin carries, which has no drag terms. This compares, for
// each element set, the ground point (the point straight below the satellite) of:
//   truth: SGP4 from the full element set (with BSTAR and the mean motion derivatives), as satellite.js computes it;
//   page:  SGP4 from the same element set packed the way pipeline/pack.py packs swarm.bin, drag terms zero (site/near.mjs swarmOmm);
//   app:   the app's fast swarm model (src/core.js decodeSwarm and swarmPositionEcef), for comparison.
// Distances are great-circle km between the geodetic ground points (site/near.mjs groundDistanceKm).
//
// Used two ways: test/near-accuracy.test.js runs the measurement on the committed sample test/fixtures/near-accuracy.json, and by hand
//   node tools/near-accuracy.mjs <gp.json> <download time, ISO> [<old live satellites folder>] [--write-sample]
// measures a whole CelesTrak GP download (FORMAT=json) and, with --write-sample, writes a new sample. The old live folder (a published
// satellites/<version>/ folder with swarm.bin, ids.bin and satmeta.json) adds the second check: positions predicted from that older data
// against the newer element sets at their own epochs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json2satrec, sgp4, gstime } from "satellite.js";
import { decodeSwarm, swarmPositionEcef } from "../src/core.js";
import { rowToOmm } from "../src/sgp4.js";
import { swarmOmm, groundDistanceKm, uncertaintyBand, U_HOURS, U_TABLE } from "../site/near.mjs";

export const COLS = ["id", "epoch", "n", "e", "i", "raan", "argp", "ma", "bstar", "ndot", "nddot"];
export const BANDS = Object.keys(U_TABLE);
// OURS: how many element sets of each band the committed sample keeps (all of a band when it has fewer)
export const SAMPLE_SIZES = { "low-under-450": 150, "low-450-600": 250, "low-600-1000": 120, "low-1000-2000": 100, medium: 80, geostationary: 80, highElliptical: 60, beyond: 20 };
export const FROM_DATA_HOURS = [0, 6, 24];

const rad = (d) => (d * Math.PI) / 180;
const q = (v, top) => Math.max(0, Math.min(65535, Math.round((v / top) * 65535)));
const epochMs = (iso) => Date.parse(iso.endsWith("Z") ? iso : iso + "Z");

// One element set packed as pipeline/pack.py packs it into swarm.bin: float32 epoch offset (minutes from the reference time) and mean motion
// (radians per minute), then uint16 eccentricity and angles.
export function packSwarm(o, refMs) {
  const f32 = new Float32Array([(epochMs(o.epoch) - refMs) / 60000, (o.n * 2 * Math.PI) / 1440]);
  const u16 = new Uint16Array([q(o.e, 1), q(rad(o.i), Math.PI), q(rad(o.raan) % (2 * Math.PI), 2 * Math.PI), q(rad(o.argp) % (2 * Math.PI), 2 * Math.PI), q(rad(o.ma) % (2 * Math.PI), 2 * Math.PI), 0]);
  return { f32, u16 };
}

const rowObj = (row) => Object.fromEntries(COLS.map((c, k) => [c, row[k]]));
const ecefOf = (rec, tMs) => {
  const r = sgp4(rec, (tMs - (rec.jdsatepoch - 2440587.5) * 86400000) / 60000);
  if (!r || !r.position || !Number.isFinite(r.position.x)) return null;
  const g = gstime(new Date(tMs)), c = Math.cos(g), s = Math.sin(g), p = r.position;
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c, z: p.z };
};
const gap = (a, b) => { const ga = groundDistanceKm({ lat: 0, lon: 0 }, a), gb = groundDistanceKm({ lat: ga.lat, lon: ga.lon }, b); return gb.km; };

// The three models for one element set (a row in COLS order). null when SGP4 refuses the set.
export function models(row, refMs) {
  const o = rowObj(row);
  const truth = json2satrec(rowToOmm(COLS, row));
  if (!truth || truth.error) return null;
  const { f32, u16 } = packSwarm(o, refMs);
  const page = json2satrec(swarmOmm(f32, u16, 0, refMs, o.id));
  const app = decodeSwarm(f32, u16, refMs)[0];
  return { o, truth, page, app, band: uncertaintyBand(f32[1], u16[0] / 65535), epochMs: epochMs(o.epoch) };
}

// Ground distances (km) between truth and the page model, and truth and the app model, at tMs; null when SGP4 fails there.
export function errorsAt(m, tMs) {
  const t = ecefOf(m.truth, tMs), p = ecefOf(m.page, tMs);
  if (!t || !p) return null;
  return { page: gap(t, p), app: gap(t, swarmPositionEcef(m.app, new Date(tMs))) };
}

// Percentile of a list, with optional weights (a stratified sample is weighted back to the catalogue's mix).
export function percentile(values, p, weights = null) {
  const idx = values.map((v, k) => [v, weights ? weights[k] : 1]).sort((a, b) => a[0] - b[0]);
  const total = idx.reduce((s, x) => s + x[1], 0);
  let acc = 0;
  for (const [v, w] of idx) { acc += w; if (acc >= p * total - 1e-9) return v; }
  return idx.length ? idx[idx.length - 1][0] : NaN;
}

// The measurement: errors from the data time (ref + 0, 6, 24 hours, every set at its real age) and from each set's own epoch (U_HOURS),
// by band. bandCounts (the whole catalogue's) turns the sample's overall figures back into catalogue-weighted ones.
export function measure(rows, refMs, { bandCounts = null } = {}) {
  const ms = rows.map((r) => models(r, refMs)).filter(Boolean);
  const inBand = {};
  for (const m of ms) inBand[m.band] = (inBand[m.band] || 0) + 1;
  const weightOf = (m) => (bandCounts ? (bandCounts[m.band] || 0) / inBand[m.band] : 1);
  const fromData = {}, byBand = {};
  for (const h of FROM_DATA_HOURS) {
    const page = [], app = [], w = [], pageHigh = [], wHigh = [];
    for (const m of ms) {
      const e = errorsAt(m, refMs + h * 3600000);
      if (!e) continue;
      page.push(e.page); app.push(e.app); w.push(weightOf(m));
      if (m.band !== "low-under-450") { pageHigh.push(e.page); wHigh.push(weightOf(m)); }
    }
    const stats = (v, ww) => ({ n: v.length, p50: percentile(v, 0.5, ww), p95: percentile(v, 0.95, ww), max: Math.max(...v) });
    fromData[h] = { page: stats(page, w), app: stats(app, w), pageFrom450: stats(pageHigh, wHigh) };
  }
  for (const b of BANDS) {
    byBand[b] = {};
    const list = ms.filter((m) => m.band === b);
    if (!list.length) continue;
    for (const h of U_HOURS) {
      const v = list.map((m) => errorsAt(m, m.epochMs + h * 3600000)).filter(Boolean).map((e) => e.page);
      byBand[b][h] = { n: v.length, p50: percentile(v, 0.5), p95: percentile(v, 0.95), max: Math.max(...v) };
    }
  }
  return { n: ms.length, inBand, fromData, byBand };
}

// The second check: positions predicted from an older published swarm (packed elements, no drag) against SGP4 of the newer element sets
// at their own epochs. old: { refMs, rows: [[id, f0, f1, u0, u1, u2, u3, u4]] }. Groups by band and by hours from the old epoch.
export const AHEAD_GROUPS = [[0, 24], [24, 36], [36, 48], [48, 60], [60, 72]];
export function measureAhead(rows, old) {
  const byId = new Map(rows.map((r) => [r[0], r]));
  const out = {};
  for (const o of old.rows) {
    const row = byId.get(o[0]);
    if (!row) continue;
    const truth = json2satrec(rowToOmm(COLS, row));
    if (!truth || truth.error) continue;
    const f32 = new Float32Array([o[1], o[2]]), u16 = new Uint16Array([o[3], o[4], o[5], o[6], o[7], 0]);
    const page = json2satrec(swarmOmm(f32, u16, 0, old.refMs, o[0]));
    const t = epochMs(rowObj(row).epoch), h = (t - (old.refMs + o[1] * 60000)) / 3600000;
    const g = AHEAD_GROUPS.find(([a, b]) => h >= a && h < b);
    if (!g || h < 1) continue;
    const a = ecefOf(truth, t), b = ecefOf(page, t);
    if (!a || !b) continue;
    const band = uncertaintyBand(f32[1], u16[0] / 65535), key = `${g[0]}-${g[1]}`;
    for (const k of [band, "all"]) { out[k] = out[k] || {}; (out[k][key] = out[k][key] || []).push(gap(a, b)); }
  }
  const res = {};
  for (const [band, groups] of Object.entries(out)) {
    res[band] = {};
    for (const [key, v] of Object.entries(groups)) res[band][key] = { n: v.length, p50: percentile(v, 0.5), p95: percentile(v, 0.95), max: Math.max(...v) };
  }
  return res;
}

// pack.py's rejection rules (pipeline/pack.py rejection), so the measurement uses the sets the feed would publish.
export function usable(r, refMs) {
  const ep = epochMs(r.EPOCH);
  return r.ECCENTRICITY >= 0 && r.ECCENTRICITY < 0.99 && r.MEAN_MOTION > 0.05 && r.MEAN_MOTION < 20 && r.INCLINATION >= 0 && r.INCLINATION <= 180
    && ep <= refMs + 86400000 && refMs - ep <= 90 * 86400000;
}
export const toRow = (r) => [r.NORAD_CAT_ID, r.EPOCH, r.MEAN_MOTION, r.ECCENTRICITY, r.INCLINATION, r.RA_OF_ASC_NODE, r.ARG_OF_PERICENTER, r.MEAN_ANOMALY, r.BSTAR, r.MEAN_MOTION_DOT, r.MEAN_MOTION_DDOT];

// Every k-th set of each band in NORAD order, so the sample is spread over the band and the same input always gives the same sample.
export function stratifiedSample(rows, refMs, sizes = SAMPLE_SIZES) {
  const by = {};
  for (const r of rows) {
    const { f32, u16 } = packSwarm(rowObj(r), refMs);
    const b = uncertaintyBand(f32[1], u16[0] / 65535);
    (by[b] = by[b] || []).push(r);
  }
  const counts = Object.fromEntries(Object.entries(by).map(([b, v]) => [b, v.length]));
  const sample = [];
  for (const [b, v] of Object.entries(by)) {
    v.sort((x, y) => x[0] - y[0]);
    const n = Math.min(v.length, sizes[b] || 20), step = v.length / n;
    for (let k = 0; k < n; k++) sample.push(v[Math.floor(k * step)]);
  }
  return { sample: sample.sort((x, y) => x[0] - y[0]), counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, when, oldDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!file || !when) { console.error("usage: node tools/near-accuracy.mjs <gp.json> <download time ISO> [<old satellites folder>] [--write-sample]"); process.exit(2); }
  const refMs = Date.parse(when);
  const rows = JSON.parse(fs.readFileSync(file, "utf8")).filter((r) => usable(r, refMs)).map(toRow);
  const { sample, counts } = stratifiedSample(rows, refMs);
  const full = measure(rows, refMs);
  let old = null;
  if (oldDir) {
    const meta = JSON.parse(fs.readFileSync(path.join(oldDir, "satmeta.json"), "utf8"));
    const sw = fs.readFileSync(path.join(oldDir, "swarm.bin")), ids = fs.readFileSync(path.join(oldDir, "ids.bin"));
    const ab = sw.buffer.slice(sw.byteOffset, sw.byteOffset + sw.byteLength);
    const F = new Float32Array(ab, 0, meta.count * 2), U = new Uint16Array(ab, meta.count * 8, meta.count * 6);
    const I = new Uint32Array(ids.buffer.slice(ids.byteOffset, ids.byteOffset + ids.byteLength));
    old = { refMs: meta.ref, taken: meta.taken, rows: [] };
    for (let k = 0; k < meta.count; k++) old.rows.push([I[k], F[2 * k], F[2 * k + 1], U[6 * k], U[6 * k + 1], U[6 * k + 2], U[6 * k + 3], U[6 * k + 4]]);
  }
  const report = { refIso: new Date(refMs).toISOString(), sets: rows.length, bandCounts: counts, full, ahead: old ? measureAhead(rows, old) : null };
  console.log(JSON.stringify(report, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v), 1));
  if (process.argv.includes("--write-sample")) {
    const ids = new Set(sample.map((r) => r[0]));
    const out = {
      note: "A stratified sample of CelesTrak's GP list GROUP=active (FORMAT=json), for test/near-accuracy.test.js. Made by tools/near-accuracy.mjs. Columns as public/precise.json.",
      source: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json", downloadedAt: new Date(refMs).toISOString(), refMs, bandCounts: counts, cols: COLS, rows: sample,
      old: old ? { note: "The same satellites as packed in the published swarm.bin of an older collection: [id, epoch offset min, mean motion rad/min, e, i, node, perigee, mean anomaly as uint16]", taken: old.taken, refMs: old.refMs, rows: old.rows.filter((r) => ids.has(r[0])) } : null,
    };
    const f = fileURLToPath(new URL("../test/fixtures/near-accuracy.json", import.meta.url));
    fs.writeFileSync(f, JSON.stringify(out) + "\n");
    console.error(`wrote ${f} (${sample.length} sets)`);
  }
}
