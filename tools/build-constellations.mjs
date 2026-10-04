// Builds public/constellations.json: the 88 IAU constellations with names, boundaries and facts computed from them.
//
// Inputs (all in the repository):
//   raw3/iau-constellations-page.html   the IAU's own table: name, abbreviation, English meaning, genitive, pronunciation
//   raw3/boundaries/*.txt               the IAU boundary vertices (right ascension h m s | declination | abbreviation), in J2000
//   raw/const_lines.json                the stick figures (d3-celestial; its data licence is not stated)
//   raw/stars6.json, public/starnames.json   the star catalogue and the IAU star names
//
// The IAU vertices are J2000, but the boundaries themselves were drawn in B1875 as arcs of constant right ascension or declination, so
// between two vertices the J2000 edge is curved. To draw it, each vertex is rotated to B1875, the arc is filled in there, and the
// points are rotated back. The rotation is not taken from remembered formulas: it is fitted from astronomy-engine's own
// Constellation(), which returns the B1875 position of any J2000 point. The fit's residual is stored in the file for a test.
// usage: node tools/build-constellations.mjs
import fs from "node:fs";
import * as Astro from "astronomy-engine";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const DEG = Math.PI / 180;

// ---- the IAU table
const html = read("raw3/iau-constellations-page.html");
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const cellsOf = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]);
// a cell holds a name and then its pronunciation. The page marks this up three ways (two paragraphs; a paragraph then an <em>;
// the name, a line break and the pronunciation), so the cell is cut at any paragraph, line break or <em> and the first piece is the name.
const nameAndPron = (cell) => {
  const parts = cell.split(/<\/?(?:p|br|em)\b[^>]*>/gi).map(strip).filter(Boolean);
  return [parts[0] || "", parts.slice(1).join(" ")];
};
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => cellsOf(m[1])).filter((c) => c.length >= 4 && /Constellation boundary/.test(strip(c.join(" "))));
if (rows.length !== 88) throw new Error(`expected 88 constellations on the IAU page, found ${rows.length}`);
// the name and its pronunciation, and the genitive and its pronunciation, are separate paragraphs in their cells
const table = rows.map((c) => {
  const [name, pron] = nameAndPron(c[0]), [genitive, genitivePron] = nameAndPron(c[3]);
  return { abbr: strip(c[1]), name, pron: pron || "", english: strip(c[2]), genitive, genitivePron: genitivePron || "" };
});
if (table.some((t) => !t.name || !t.genitive || !t.abbr)) throw new Error("a row of the IAU table could not be read");

// ---- the rotation from J2000 to B1875, fitted from the engine
const vec = (raDeg, decDeg) => [Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG), Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
const unvec = (v) => ({ ra: ((Math.atan2(v[1], v[0]) / DEG) + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG });
const pts = [];
for (let i = 0; i < 400; i++) { const ra = (i * 137.508) % 360, dec = Math.asin(((i * 0.618033) % 1) * 2 - 1) / DEG; pts.push([ra, dec]); }
// least squares for the 3x3 matrix M with q = M p (an exact rotation up to the engine's rounding)
const ATA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], ATB = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
const pairs = pts.map(([ra, dec]) => { const c = Astro.Constellation(ra / 15, dec); return [vec(ra, dec), vec(c.ra1875 * 15, c.dec1875)]; });
for (const [p, q] of pairs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { ATA[i][j] += p[i] * p[j]; ATB[i][j] += p[i] * q[j]; }
const inv3 = (m) => { const [[a, b, c], [d, e, f], [g, h, i]] = m; const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]]; };
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, _, k) => s + r[k] * B[k][j], 0)));
const Mt = mul(inv3(ATA), ATB);                  // rows: p-index, cols: q-index, so q = Mt^T p
const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => Mt[j][i]));
const apply = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
// the fit is a rotation only if M is orthonormal; the largest departure is kept as a check
const MMt = mul(M, [0, 1, 2].map((i) => [0, 1, 2].map((j) => M[j][i])));
const orth = Math.max(...[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => Math.abs(MMt[i][j] - (i === j ? 1 : 0)))));
let worst = 0;
for (const [p, q] of pairs) { const r = apply(M, p); worst = Math.max(worst, Math.acos(Math.min(1, r[0] * q[0] + r[1] * q[1] + r[2] * q[2])) / DEG); }
const MT = [0, 1, 2].map((i) => [0, 1, 2].map((j) => M[j][i]));   // B1875 to J2000
const toJ2000 = (raDeg, decDeg) => unvec(apply(MT, vec(raDeg, decDeg)));
const toB1875 = (raDeg, decDeg) => unvec(apply(M, vec(raDeg, decDeg)));

// ---- boundaries: densify along the arcs (constant RA or constant Dec in B1875), then rotate
const parseVertex = (line) => {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\|\s*(-?[\d.]+)\|(\w+)/);
  if (!m) throw new Error("bad boundary line: " + line);
  const b = toB1875((Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 15, Number(m[4]));  // the file is J2000; the arcs are drawn in B1875
  return { ra: b.ra, dec: b.dec, tag: m[5] };
};
function loops(abbrLower) {
  const files = fs.readdirSync(new URL("raw3/boundaries/", root)).filter((f) => f.replace(/\d*\.txt$/, "") === abbrLower);
  return files.sort().map((f) => read(`raw3/boundaries/${f}`).split("\n").filter((l) => l.trim()).map(parseVertex));
}
const STEP = 1;  // degrees between densified points
let edgeViolations = 0, worstEdge = 0;
function densify(loop) {
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    let dra = b.ra - a.ra; while (dra > 180) dra -= 360; while (dra < -180) dra += 360;
    const ddec = b.dec - a.dec;
    // at a pole the right ascension means nothing, so an edge to a pole is a meridian through the other vertex
    const poleA = Math.abs(a.dec) > 89.9, poleB = Math.abs(b.dec) > 89.9;
    if (poleA) dra = 0, a.ra = b.ra; else if (poleB) dra = 0, b.ra = a.ra;
    const mer = poleA || poleB || Math.abs(dra) * Math.cos(((a.dec + b.dec) / 2) * DEG) < Math.abs(ddec);   // a meridian arc: right ascension is constant
    const off = poleA || poleB ? 0 : Math.min(Math.abs(dra) * Math.cos(((a.dec + b.dec) / 2) * DEG), Math.abs(ddec));
    if (off > worstEdge) worstEdge = off;
    if (off > 5e-3) edgeViolations++;   // an edge must follow one coordinate (the file's own rounding of the vertices allows a few thousandths of a degree)
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dra) * Math.cos(((a.dec + b.dec) / 2) * DEG), Math.abs(ddec)) / STEP));
    const raFixed = a.ra + dra / 2, decFixed = (a.dec + b.dec) / 2;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push(k === 0 ? { ra: a.ra, dec: a.dec } : mer ? { ra: (raFixed + 360) % 360, dec: a.dec + ddec * t } : { ra: (a.ra + dra * t + 360) % 360, dec: decFixed });
    }
  }
  return out;
}

// ---- sampling the sky with the engine's own constellation lookup for area, centre, extent
const GRID = 0.25;
const acc = new Map(table.map((t) => [t.abbr, { n: 0, area: 0, sx: 0, sy: 0, sz: 0, decMin: 90, decMax: -90, pts: [] }]));
for (let di = 0; di < 180 / GRID; di++) {
  const dec = -90 + (di + 0.5) * GRID, w = Math.cos(dec * DEG) * GRID * GRID;
  for (let ri = 0; ri < 360 / GRID; ri++) {
    const ra = (ri + 0.5) * GRID, a = acc.get(Astro.Constellation(ra / 15, dec).symbol);
    a.area += w; const v = vec(ra, dec); a.sx += v[0] * w; a.sy += v[1] * w; a.sz += v[2] * w;
    if (dec < a.decMin) a.decMin = dec; if (dec > a.decMax) a.decMax = dec;
    if (ri % 8 === 0 && di % 8 === 0) a.pts.push([ra, dec]);
  }
}

// ---- stars
const feats = JSON.parse(read("raw/stars6.json")).features;
const names = JSON.parse(read("public/starnames.json")).stars;
const nameOf = new Map(names.map((s) => [s.i, s.name]));
const perCon = new Map(table.map((t) => [t.abbr, { count: 0, brightest: null }]));
feats.forEach((f, i) => {
  let [ra, dec] = f.geometry.coordinates; if (ra < 0) ra += 360;
  const c = perCon.get(Astro.Constellation(ra / 15, dec).symbol);
  c.count++;
  if (!c.brightest || f.properties.mag < c.brightest.mag) c.brightest = { i, hip: f.id, mag: f.properties.mag, name: nameOf.get(i) || null };
});

// ---- figures
const figures = new Map();
for (const f of JSON.parse(read("raw/const_lines.json")).features) figures.set(f.id, (figures.get(f.id) || []).concat(f.geometry.coordinates.map((l) => l.map(([ra, dec]) => [Math.round(ra * 100) / 100, Math.round(dec * 100) / 100]))));

const r3 = (x) => Math.round(x * 1000) / 1000;
const out = table.map((t) => {
  const a = acc.get(t.abbr);
  const mean = [a.sx, a.sy, a.sz], len = Math.hypot(...mean);
  // the centre is the sampled point inside the constellation nearest to the mean direction, so it always lies inside, even for
  // a crescent such as Hydra or Serpens where the mean direction itself falls outside
  const mu = mean.map((x) => x / len);
  let best = null, bestD = Infinity;
  for (const [ra, dec] of a.pts) { const v = vec(ra, dec), d = Math.acos(Math.min(1, v[0] * mu[0] + v[1] * mu[1] + v[2] * mu[2])); if (d < bestD) { bestD = d; best = [ra, dec]; } }
  const lp = loops(t.abbr.toLowerCase());
  if (!lp.length) throw new Error("no boundary file for " + t.abbr);
  return { ...t, areaDeg2: Math.round(a.area * 10) / 10, centre: { ra: r3(best[0]), dec: r3(best[1]) }, decMin: r3(a.decMin), decMax: r3(a.decMax),
    stars: { count: perCon.get(t.abbr).count, brightest: perCon.get(t.abbr).brightest },
    figure: figures.get(t.abbr) || [], boundary: lp.map((loop) => densify(loop).map((p) => { const j = toJ2000(p.ra, p.dec); return [r3(j.ra), r3(j.dec)]; })) };
});
const total = out.reduce((s, c) => s + c.areaDeg2, 0);
const doc = {
  source: "IAU constellations: names, abbreviations and boundaries", url: "https://www.iau.org/public/themes/constellations/", pageRead: "2026-10-04",
  credit: "Constellation names and boundaries: IAU (iau.org). Figures: d3-celestial project",
  notes: { boundaryEpoch: "the IAU files give J2000 vertices; the arcs between them follow B1875 meridians and parallels, which is how the boundaries were drawn", rotation: "fitted from astronomy-engine's Constellation(); see fit", areaMethod: `counted on a ${GRID} degree grid with astronomy-engine's Constellation()`, figures: "d3-celestial; its data licence is not stated", precisionOfCentre: "a sampled point inside the constellation near its mean direction" },
  fit: { points: pts.length, worstEdgeOffsetDeg: worstEdge, worstResidualDeg: worst, orthonormalityError: orth, edgeViolations, totalAreaDeg2: Math.round(total * 10) / 10 },
  constellations: out,
};
fs.writeFileSync(new URL("public/constellations.json", root), JSON.stringify(doc));
console.log(`${out.length} constellations, total area ${total.toFixed(1)} sq deg (sphere is 41252.96), fit residual ${worst.toExponential(2)} deg, orthonormality ${orth.toExponential(2)}, edge violations ${edgeViolations}, worst edge offset ${worstEdge.toFixed(4)} deg`);
console.log(`file: ${(fs.statSync(new URL("public/constellations.json", root)).size / 1024).toFixed(0)} KB`);
