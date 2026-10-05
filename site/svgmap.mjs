// A plain world map as one inline SVG: equirectangular (longitude across, latitude up), no JavaScript and nothing loaded from elsewhere.
// One path draws the coastlines and one draws the points, so a map of thousands of satellites stays small. Pure and deterministic.
import { esc } from "./layout.mjs";

// The drawing is 3600 by 1800 units, one unit per 0.1 degree, so a point rounded to 0.1 degree lands on a whole unit.
export const MAP_UNITS_PER_DEGREE = 10;
const W = 360 * MAP_UNITS_PER_DEGREE, H = 180 * MAP_UNITS_PER_DEGREE;
// OURS: coast points are merged onto a half degree grid (5 units), about one pixel at the size the map is shown. The coast path is written
// in those half degree steps with relative moves and scaled back up by the SVG, which keeps the file small.
const COAST_STEP = 5;
const fin = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon);
const ux = (lon) => Math.round(Math.max(-180, Math.min(180, lon)) * MAP_UNITS_PER_DEGREE) + W / 2;
const uy = (lat) => H / 2 - Math.round(Math.max(-90, Math.min(90, lat)) * MAP_UNITS_PER_DEGREE);
const snap = (u) => Math.round(u / COAST_STEP);

// coast: polylines of [lat, lon] (decodeCoast in src/data.js). A line is broken where it jumps more than 180 degrees of longitude
// (it crosses the antimeridian), so no stroke runs across the whole map. Runs of one point draw nothing and are left out.
// The result is in half degree steps: an absolute start, then relative steps ("M720 180l1 0 1 -1").
export function coastPath(coast) {
  const runs = [];
  for (const line of coast) {
    let run = [], prevLon = null;
    const close = () => { if (run.length > 1) runs.push(run); run = []; };
    for (const [lat, lon] of line) {
      if (!fin(lat, lon)) { close(); prevLon = null; continue; }
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) close();
      prevLon = lon;
      const x = snap(ux(lon)), y = snap(uy(lat)), last = run[run.length - 1];
      if (last && last[0] === x && last[1] === y) continue;
      run.push([x, y]);
    }
    close();
  }
  return runs.map((r) => `M${r[0][0]} ${r[0][1]}l` + r.slice(1).map(([x, y], k) => `${x - r[k][0]} ${y - r[k][1]}`).join(" ")).join("");
}

// points: [lat, lon]. Each is rounded to 0.1 degree; points that round to the same place are one dot. Sorted, so the input order does
// not change the output. A dot is a zero-length line drawn with round caps.
export function pointsPath(points) {
  const seen = new Set(), dots = [];
  for (const [lat, lon] of points) {
    if (!fin(lat, lon)) continue;
    const x = ux(lon), y = uy(lat), key = `${x} ${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dots.push([x, y]);
  }
  dots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return dots.map(([x, y]) => `M${x} ${y}h0`).join("");
}

export const uniqueDots = (points) => (pointsPath(points).match(/M/g) || []).length;

export function worldMapSvg({ coast, points, id, title, desc }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${esc(id)}-t ${esc(id)}-d" viewBox="0 0 ${W} ${H}" width="720" height="360" style="max-width:100%;height:auto">` +
    `<title id="${esc(id)}-t">${esc(title)}</title><desc id="${esc(id)}-d">${esc(desc)}</desc>` +
    `<rect width="${W}" height="${H}" fill="var(--ink2)"></rect>` +
    `<path d="${coastPath(coast)}" transform="scale(${COAST_STEP})" fill="none" stroke="var(--dim)" stroke-width="0.8" stroke-linejoin="round"></path>` +
    `<path d="${pointsPath(points)}" fill="none" stroke="var(--ion)" stroke-width="13" stroke-linecap="round"></path></svg>`;
}
