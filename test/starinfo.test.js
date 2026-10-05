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

// ---- distances, luminosity and planets (public/stardetails.json)
import { LY_PER_PC, lightYears, distanceText, lightAgeText, luminosityText, planetText, detailsFor } from "../src/starinfo.js";
const DETAILS = JSON.parse(fs.readFileSync(new URL("../public/stardetails.json", import.meta.url), "utf8"));
const byName = (n) => NAMES.stars.find((s) => s.name === n);

test("a parsec is 3.2616 light-years, as the HYG readme rounds it (3.262)", () => {
  assert.ok(Math.abs(LY_PER_PC - 3.26156) < 1e-4, String(LY_PER_PC));
  assert.ok(Math.abs(LY_PER_PC - 3.262) < 5e-4);
  assert.equal(lightYears(null), null);
  assert.equal(lightYears(0), null);
  assert.equal(lightYears(NaN), null);
  assert.ok(Math.abs(lightYears(1) - LY_PER_PC) < 1e-12);
});

test("distance wording rounds to what the data can support", () => {
  assert.equal(distanceText(2.6371), "about 8.6 light-years (2.64 parsecs)");
  assert.equal(distanceText(10.3584), "about 34 light-years (10 parsecs)");
  assert.equal(distanceText(132.626), "about 430 light-years (133 parsecs)");
  assert.equal(distanceText(432.9), "about 1,400 light-years (433 parsecs)");
  assert.equal(distanceText(null), null);
  assert.equal(lightAgeText(2.6371), "The light you see left it about 8.6 years ago.");
  assert.equal(lightAgeText(null), null);
});

test("luminosity wording", () => {
  assert.equal(luminosityText(22.8), "about 23 times the Sun's");
  assert.equal(luminosityText(1.54), "about 1.5 times the Sun's");
  assert.equal(luminosityText(0.629), "about 0.63 times the Sun's");
  assert.equal(luminosityText(13900), "about 13,900 times the Sun's");
  assert.equal(luminosityText(116), "about 116 times the Sun's");
  for (const bad of [null, 0, -1, NaN, undefined]) assert.equal(luminosityText(bad), null);
});

test("planet wording", () => {
  assert.equal(planetText({ n: 1, names: ["HD 62509 b"], year: [2006, 2006], methods: ["Radial Velocity"] }), "1 confirmed planet: HD 62509 b (found in 2006, by radial velocity)");
  assert.equal(planetText({ n: 4, names: ["a", "b", "c", "d"], year: [2008, 2010], methods: ["Imaging"] }), "4 confirmed planets: a, b, c, d (found between 2008 and 2010, by imaging)");
  assert.match(planetText({ n: 10, names: Array.from({ length: 10 }, (_, i) => `p${i}`), year: null, methods: [] }), /p7 and 2 more$/);
  assert.equal(planetText(null), null);
  assert.equal(planetText({ n: 0, names: [] }), null);
});

test("the shipped details line up with the catalogue and the IAU names", () => {
  assert.equal(DETAILS.counts.catalogue, STARS.n);
  assert.equal(DETAILS.counts.matched, Object.keys(DETAILS.stars).length);
  const sirius = detailsFor(DETAILS, byName("Sirius").i);
  assert.ok(Math.abs(sirius.pc - 2.64) < 0.05 && Math.abs(lightYears(sirius.pc) - 8.6) < 0.1, "Sirius is about 8.6 light-years away (HYG gives 2.64 parsecs)");
  assert.ok(sirius.lum > 20 && sirius.lum < 26);
  const betelgeuse = detailsFor(DETAILS, byName("Betelgeuse").i);
  assert.match(betelgeuse.spect, /^M/);
  assert.ok(betelgeuse.pc > 100 && betelgeuse.pc < 250);
  assert.equal(detailsFor(null, 0), null);
  assert.equal(detailsFor(DETAILS, 99999999), null);
});

test("details agree with the apparent magnitude: absolute magnitude = apparent - 5 log10(distance / 10 pc)", () => {
  let n = 0, worst = 0;
  for (const [k, v] of Object.entries(DETAILS.stars)) {
    if (v[0] == null || v[3] == null) continue;
    const want = STARS.mag[Number(k)] - 5 * Math.log10(v[0] / 10);
    worst = Math.max(worst, Math.abs(want - v[3]));
    n++;
  }
  assert.ok(n > 4900);
  assert.ok(worst < 0.1, `largest difference ${worst}`);
});

test("no star has a luminosity or absolute magnitude without a usable distance, and none has a distance beyond the sanity limit", () => {
  for (const v of Object.values(DETAILS.stars)) {
    if (v[0] == null) { assert.equal(v[2], null); assert.equal(v[3], null); }
    else assert.ok(v[0] > 0 && v[0] <= 5000);
  }
});

test("planet hosts are unique stars, planet names are unique across the file, and the known ones are there", () => {
  const names = Object.values(DETAILS.planets).flatMap((p) => p.names);
  assert.equal(new Set(names).size, names.length, "a planet is never listed twice");
  for (const [k, p] of Object.entries(DETAILS.planets)) { assert.equal(p.n, p.names.length); assert.ok(DETAILS.stars[k]); }
  assert.deepEqual(detailsFor(DETAILS, byName("Pollux").i).planets.names, ["HD 62509 b"]);
  assert.equal(detailsFor(DETAILS, byName("Sirius").i).planets, null);
  assert.equal(DETAILS.counts.hostDistanceDiffers, 0, "HYG and the Exoplanet Archive agree on every host's distance");
});

test("the details file carries both credits and the share-alike licence", () => {
  assert.match(DETAILS.hygCredit, /CC BY-SA 4\.0/);
  assert.match(DETAILS.hygLicence, /ShareAlike/);
  assert.match(DETAILS.planetCredit, /^This research has made use of the NASA Exoplanet Archive/);
});
