import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Astro from "astronomy-engine";
import { colourName, magnitudeRank, dayState, starDay, bayerName, BV_BANDS } from "../src/starinfo.js";
import { decodeStars } from "../src/data.js";
import { raDecToAltAz } from "../src/core.js";

const buf = fs.readFileSync(new URL("../public/stars.bin", import.meta.url));
const STARS = decodeStars(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const NAMES = JSON.parse(fs.readFileSync(new URL("../public/starnames.json", import.meta.url), "utf8"));
const IDS = new Uint32Array(fs.readFileSync(new URL("../public/starids.bin", import.meta.url)).buffer.slice(0));
const CONS = JSON.parse(fs.readFileSync(new URL("../public/constellations.json", import.meta.url), "utf8"));

test("every named star points at the same star in the catalogue: magnitude, Hipparcos number and constellation agree", () => {
  assert.equal(IDS.length, STARS.n);
  assert.ok(NAMES.stars.length > 300);
  for (const s of NAMES.stars) {
    assert.equal(IDS[s.i], s.hip, `${s.name}: Hipparcos number`);
    assert.ok(Math.abs(STARS.mag[s.i] - s.mag) < 0.05, `${s.name}: catalogue magnitude ${STARS.mag[s.i]} against ${s.mag}`);
    const c = Astro.Constellation(STARS.ra[s.i] / 15, STARS.dec[s.i]).symbol;
    assert.equal(c, s.con, `${s.name}: the IAU file puts it in ${s.con} and the boundaries put its position in ${c}`);
  }
});

test("colour bands follow B-V and a missing value says nothing", () => {
  assert.deepEqual([-0.2, 0.1, 0.45, 0.65, 1.0, 1.7].map(colourName), ["blue-white", "white", "yellow-white", "yellow", "orange", "orange-red"]);
  assert.equal(colourName(null), null);
  assert.equal(colourName(NaN), null);
  assert.equal(BV_BANDS.at(-1)[0], Infinity);
  // the catalogue's own B-V for Betelgeuse is the reddest of the first-magnitude stars
  const named = (n) => NAMES.stars.find((s) => s.name === n);
  assert.equal(colourName(STARS.bv[named("Betelgeuse").i]), "orange-red");
  assert.ok(["blue-white", "white"].includes(colourName(STARS.bv[named("Rigel").i])));
  assert.equal(colourName(STARS.bv[named("Sirius").i]), "white");
});

test("magnitude rank: Sirius first, ties share a rank", () => {
  const sirius = NAMES.stars.find((s) => s.name === "Sirius").i, canopus = NAMES.stars.find((s) => s.name === "Canopus").i;
  assert.equal(magnitudeRank(STARS.mag, sirius), 1);
  assert.equal(magnitudeRank(STARS.mag, canopus), 2);
  assert.equal(magnitudeRank(new Float32Array([1, 1, 2]), 1), 1);
  assert.equal(magnitudeRank(new Float32Array([1, 1, 2]), 2), 3);
});

test("always up, never up, or both", () => {
  assert.equal(dayState(89.26, 18.5), "circumpolar");   // Polaris from Pune
  assert.equal(dayState(-63.1, 40), "never");           // Acrux from 40 N
  assert.equal(dayState(-16.7, 18.5), "normal");        // Sirius from Pune
  assert.equal(dayState(-89, -33.9), "circumpolar");    // near the south celestial pole from Sydney
  assert.equal(dayState(80, -33.9), "never");
});

test("rise and set times match the library's own altitude at those instants", () => {
  const sirius = NAMES.stars.find((s) => s.name === "Sirius");
  const ra = STARS.ra[sirius.i], dec = STARS.dec[sirius.i];
  const date = new Date("2026-10-04T12:00:00Z");
  const d = starDay(ra, dec, 18.52, 73.86, date);
  assert.equal(d.state, "normal");
  assert.ok(d.rise && d.set && d.transit);
  for (const [t, label] of [[d.rise, "rise"], [d.set, "set"]]) {
    const alt = raDecToAltAz(ra, dec, 18.52, 73.86, t).alt;
    assert.ok(Math.abs(alt - -0.57) < 0.6, `${label}: altitude ${alt}, expected about -0.57 (the standard refraction allowance)`);
  }
  const alt = raDecToAltAz(ra, dec, 18.52, 73.86, d.transit).alt;
  assert.ok(Math.abs(alt - d.transitAlt) < 0.2, `transit altitude ${alt} against ${d.transitAlt}`);
  assert.ok(d.rise < d.transit && d.transit < d.set, "rise, then highest, then set, within the day after `date`");
});

test("a star that never rises or never sets has no rise or set time", () => {
  const polaris = NAMES.stars.find((s) => s.name === "Polaris");
  const d = starDay(STARS.ra[polaris.i], STARS.dec[polaris.i], 18.52, 73.86, new Date("2026-10-04T12:00:00Z"));
  assert.equal(d.state, "circumpolar");
  assert.equal([d.rise, d.set].filter(Boolean).length, 0);
  assert.ok(d.transit);
  const acrux = NAMES.stars.find((s) => s.name === "Acrux");
  const n = starDay(STARS.ra[acrux.i], STARS.dec[acrux.i], 52, 0, new Date("2026-10-04T12:00:00Z"));
  assert.deepEqual([n.state, n.rise, n.set, n.transit], ["never", null, null, null]);
});

test("Bayer designation from the letter and the constellation's genitive", () => {
  const sirius = NAMES.stars.find((s) => s.name === "Sirius");
  const cma = CONS.constellations.find((c) => c.abbr === sirius.con);
  assert.equal(bayerName(sirius, cma), "α Canis Majoris");
  assert.equal(bayerName({ bayer: null }, cma), null);
  assert.equal(bayerName(sirius, null), null);
});
