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
const snap = (u, step = COAST_STEP) => Math.round(u / step);

// coast: polylines of [lat, lon] (decodeCoast in src/data.js). A line is broken where it jumps more than 180 degrees of longitude
// (it crosses the antimeridian), so no stroke runs across the whole map. Runs of one point draw nothing and are left out.
// The result is in half degree steps: an absolute start, then relative steps ("M720 180l1 0 1 -1"). step: the grid in map units (5, half
// a degree, unless a page asks for a coarser one to stay small; the SVG then scales the path by the same step).
export function coastPath(coast, step = COAST_STEP) {
  const runs = [];
  for (const line of coast) {
    let run = [], prevLon = null;
    const close = () => { if (run.length > 1) runs.push(run); run = []; };
    for (const [lat, lon] of line) {
      if (!fin(lat, lon)) { close(); prevLon = null; continue; }
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) close();
      prevLon = lon;
      const x = snap(ux(lon), step), y = snap(uy(lat), step), last = run[run.length - 1];
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

// OURS: dots get smaller as there are more of them, so a fleet of thousands does not become one solid block. Widths are in map units
// (a tenth of a degree); at the 720 pixel size 18 units is about 3.6 pixels.
export const dotWidth = (n) => (n > 4000 ? 8 : n > 800 ? 12 : 18);

// A part of the world map, for storm tracks: bounds { south, north, west, east } in degrees (a box that crosses the antimeridian is not
// supported; the caller then uses the whole map). lines: polylines of [lat, lon], each broken where it jumps more than 180 degrees of
// longitude; points: [lat, lon] dots; labels: [{ lat, lon, text }]. Widths are set so the drawing looks the same at any box size. The whole
// coastline is in the file and the view box shows the part asked for.
export function regionMapSvg({ coast, bounds, lines = [], points = [], labels = [], id, title, desc }) {
  const x0 = ux(bounds.west), x1 = ux(bounds.east), y0 = uy(bounds.north), y1 = uy(bounds.south);
  const w = Math.max(10, x1 - x0), h = Math.max(10, y1 - y0);
  const px = w / 720;  // map units per pixel at the size the map is shown
  const runs = [];
  for (const line of lines) {
    let run = [], prev = null;
    for (const [lat, lon] of line) {
      if (!fin(lat, lon)) continue;
      if (prev !== null && Math.abs(lon - prev) > 180) { if (run.length > 1) runs.push(run); run = []; }
      prev = lon;
      run.push([ux(lon), uy(lat)]);
    }
    if (run.length > 1) runs.push(run);
  }
  const ld = runs.map((r) => `M${r[0][0]} ${r[0][1]}` + r.slice(1).map(([x, y]) => `L${x} ${y}`).join("")).join("");
  const r1 = (v) => Math.round(v * 100) / 100;
  const text = labels.filter((l) => fin(l.lat, l.lon)).map((l) => `<text x="${ux(l.lon) + r1(8 * px)}" y="${uy(l.lat) - r1(8 * px)}" fill="var(--text)" font-size="${r1(13 * px)}">${esc(l.text)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${esc(id)}-t ${esc(id)}-d" viewBox="${x0} ${y0} ${w} ${h}" width="720" height="${Math.round((720 * h) / w)}" style="max-width:100%;height:auto">` +
    `<title id="${esc(id)}-t">${esc(title)}</title><desc id="${esc(id)}-d">${esc(desc)}</desc>` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="var(--ink2)"></rect>` +
    `<path d="${coastPath(coast)}" transform="scale(${COAST_STEP})" fill="none" stroke="var(--muted)" stroke-width="${r1(px / COAST_STEP)}" stroke-linejoin="round"></path>` +
    `<path d="${ld}" fill="none" stroke="var(--signal)" stroke-width="${r1(2 * px)}" stroke-linejoin="round"></path>` +
    `<path d="${pointsPath(points)}" fill="none" stroke="var(--signal)" stroke-width="${r1(9 * px)}" stroke-linecap="round"></path>${text}</svg>`;
}

// The points are drawn first and the coastlines on top, so the land stays readable under a dense fleet.
export function worldMapSvg({ coast, points, id, title, desc }) {
  const d = pointsPath(points);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="map" role="img" aria-labelledby="${esc(id)}-t ${esc(id)}-d" viewBox="0 0 ${W} ${H}" width="720" height="360" style="max-width:100%;height:auto">` +
    `<title id="${esc(id)}-t">${esc(title)}</title><desc id="${esc(id)}-d">${esc(desc)}</desc>` +
    `<rect width="${W}" height="${H}" fill="var(--ink2)"></rect>` +
    `<path d="${d}" fill="none" stroke="var(--ion)" stroke-opacity="0.85" stroke-width="${dotWidth((d.match(/M/g) || []).length)}" stroke-linecap="round"></path>` +
    `<path d="${coastPath(coast)}" transform="scale(${COAST_STEP})" fill="none" stroke="var(--muted)" stroke-width="0.6" stroke-linejoin="round"></path></svg>`;
}
