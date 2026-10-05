import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { worldMapSvg, regionMapSvg, coastPath, pointsPath, uniqueDots, dotWidth, MAP_UNITS_PER_DEGREE } from "../site/svgmap.mjs";
import { xmlProblem } from "./helpers/xml.mjs";
import { decodeCoast } from "../src/data.js";

const coastFile = fileURLToPath(new URL("../public/coast.bin", import.meta.url));
const buf = fs.readFileSync(coastFile);
const coast = decodeCoast(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const paths = (svg) => [...svg.matchAll(/<path [^>]*d="([^"]*)"/g)].map((m) => m[1]);

test("the coastline file decodes into polylines of [lat, lon] on the globe", () => {
  assert.ok(coast.length > 100, String(coast.length));
  for (const line of coast) for (const [lat, lon] of line) assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${lat} ${lon}`);
});

test("the map is an accessible image with a title, a description, one path for the coast and one for the points", () => {
  const svg = worldMapSvg({ coast, points: [[0, 0], [51.5, -0.1]], id: "map-x", title: "Where they are", desc: "Two dots." });
  assert.match(svg, /^<svg [^>]*role="img"[^>]*aria-labelledby="map-x-t map-x-d"/);
  assert.match(svg, /<title id="map-x-t">Where they are<\/title>/);
  assert.match(svg, /<desc id="map-x-d">Two dots\.<\/desc>/);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /viewBox="0 0 3600 1800"/);
  assert.ok(svg.endsWith("</svg>"));
});

test("points are placed equirectangularly, rounded to 0.1 degree, deduplicated and sorted", () => {
  assert.equal(MAP_UNITS_PER_DEGREE, 10);
  assert.equal(pointsPath([[0, 0]]), "M1800 900h0");
  assert.equal(pointsPath([[90, -180]]), "M0 0h0");
  assert.equal(pointsPath([[-90, 180]]), "M3600 1800h0");
  assert.equal(pointsPath([[51.54, -0.14], [51.51, -0.06], [10, 10]]), "M1799 385h0M1900 800h0", "two points that round to the same 0.1 degree are one dot");
  assert.equal(pointsPath([[10, 10], [51.5, -0.1]]), pointsPath([[51.5, -0.1], [10, 10]]), "order does not matter");
  assert.equal(pointsPath([[NaN, 0], [0, Infinity]]), "");
  assert.equal(pointsPath([]), "");
  assert.equal(uniqueDots([[1, 1], [1.01, 1.01], [2, 2]]), 2, "the number of dots drawn");
  assert.deepEqual([1, 800, 801, 4000, 4001].map(dotWidth), [18, 18, 12, 12, 8], "dots shrink as there are more of them");
  assert.match(worldMapSvg({ coast: [], points: [[1, 1]], id: "m", title: "t", desc: "d" }), /stroke-width="18"/);
});

test("coast lines are drawn as one path, and a line that crosses the antimeridian is broken there", () => {
  const d = coastPath([[[0, 170], [0, 179], [0, -179], [0, -170]]]);
  assert.equal(d, "M700 180l18 0M2 180l18 0", "in half degree steps, the start absolute and the rest relative");
  assert.equal(coastPath([[[0, 0], [0, 0.1], [0, 0.2], [0, 1]]]), "M360 180l2 0", "points closer than the coast step of half a degree are merged");
  assert.equal(coastPath([[[10, 10]]]), "", "a single point draws nothing");
  const all = coastPath(coast);
  for (const sub of all.split("M").slice(1)) {
    const [start, rest] = sub.split("l");
    let [x, y] = start.split(" ").map(Number);
    const steps = rest.split(" ").map(Number);
    for (let k = 0; k < steps.length; k += 2) {
      assert.ok(Math.abs(steps[k]) < 360, "no segment runs across the map");
      x += steps[k]; y += steps[k + 1];
      assert.ok(x >= 0 && x <= 720 && y >= 0 && y <= 360, `stays on the map: ${x} ${y}`);
    }
  }
});

test("the output is deterministic, refers to nothing outside itself and is well formed", () => {
  const args = { coast, points: [[1, 2], [3, 4]], id: "m", title: "A & B <x>", desc: "\"quoted\"" };
  const a = worldMapSvg(args), b = worldMapSvg(args);
  assert.equal(a, b);
  assert.ok(!/href|url\(|<image|<use|<script|https?:/i.test(a.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "")), "no external references");
  assert.ok(a.includes("A &amp; B &lt;x&gt;") && a.includes("&quot;quoted&quot;"), "text is escaped");
  // every opened element is closed in order
  const stack = [];
  for (const m of a.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2]); else stack.push(m[2]);
  }
  assert.deepEqual(stack, []);
});

test("the map stays small: the coast and ten thousand spread points fit well under the page budget", () => {
  const coastOnly = worldMapSvg({ coast, points: [], id: "m", title: "t", desc: "d" });
  assert.ok(Buffer.byteLength(coastOnly) < 120 * 1024, `coast only: ${Buffer.byteLength(coastOnly)} bytes`);
  const pts = Array.from({ length: 10000 }, (_, k) => [((k * 7919) % 1600) / 10 - 80, ((k * 104729) % 3600) / 10 - 180]);
  const svg = worldMapSvg({ coast, points: pts, id: "m", title: "t", desc: "d" });
  assert.ok(Buffer.byteLength(svg) < 300 * 1024, `with points: ${Buffer.byteLength(svg)} bytes`);
  assert.ok(paths(svg)[1].length > 0);
});

test("a region map shows the box asked for, joins the track points in order, breaks a line at the antimeridian and is well formed", () => {
  const svg = regionMapSvg({ coast, bounds: { south: 10, north: 30, west: -130, east: -90 }, lines: [[[20, -116], [20.5, -117.3], [21, -119]]], points: [[20, -116]], labels: [{ lat: 20, lon: -116, text: "Rachel <b>" }], id: "map", title: "Storm", desc: "One storm." });
  assert.match(svg, /viewBox="500 600 400 200"/);
  assert.match(svg, /width="720" height="360"/);
  assert.ok(svg.includes('d="M640 700L627 695L610 690"'), "the track as one line in order");
  assert.ok(svg.includes("Rachel &lt;b&gt;"));
  assert.equal(xmlProblem(svg), null);
  const cross = regionMapSvg({ coast: [], bounds: { south: -90, north: 90, west: -180, east: 180 }, lines: [[[10, 179], [11, -179], [12, -178]]], id: "m", title: "t", desc: "d" });
  assert.ok(cross.includes('d="M10 790L20 780"'), "the part before the antimeridian is dropped as a single point; the rest is one line");
  assert.equal(xmlProblem(cross), null);
});
