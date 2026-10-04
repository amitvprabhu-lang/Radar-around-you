import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GEOMAGNETIC_SCALE, gLevelForKp, scaleFor, SAFFIR_SIMPSON, categoryForKnots } from "../src/scales.js";

const noaa = fs.readFileSync(new URL("../raw3/noaa-scales-explanation.txt", import.meta.url), "utf8");
const nhc = fs.readFileSync(new URL("../raw3/nhc-sshws.txt", import.meta.url), "utf8");

test("the geomagnetic scale in the app matches the saved NOAA page row by row", () => {
  for (const s of GEOMAGNETIC_SCALE) {
    const m = noaa.match(new RegExp(`G ${s.g} ${s.name} .*? Kp = ${s.kp}[ ,]`));
    assert.ok(m, `row G${s.g}`);
    assert.ok(m[0].includes(s.aurora), `G${s.g} aurora wording: ${s.aurora}`);
    if (s.geomagLat) assert.ok(m[0].includes(`(typically ${s.geomagLat}° geomagnetic lat.)`), `G${s.g} latitude`);
  }
  assert.match(noaa, /Kp = 8, including a 9-/);
});

test("G level from Kp, including the 9- case", () => {
  assert.deepEqual([0, 4.67, 5, 5.33, 6, 6.67, 7, 8, 8.67, 9].map(gLevelForKp), [0, 0, 1, 1, 2, 2, 3, 4, 4, 5]);
  assert.equal(gLevelForKp(null), 0);
  assert.equal(gLevelForKp(NaN), 0);
  assert.equal(scaleFor(2).name, "Moderate");
  assert.equal(scaleFor(0), null);
});

test("the Saffir-Simpson ranges match the saved NHC page", () => {
  for (const c of SAFFIR_SIMPSON) {
    const top = c.maxKt === Infinity ? "or higher" : `${c.minKt}-${c.maxKt} kt`;
    const re = c.maxKt === Infinity ? new RegExp(`${c.minKt} kt or higher ${c.kmh.replace(" or higher", "")} km/h or higher`) : new RegExp(`${c.minKt}-${c.maxKt} kt ${c.kmh.replace(" to ", "-")} km/h`);
    assert.match(nhc, re, `category ${c.cat} (${top})`);
  }
  assert.match(nhc, /Category 3 and higher are known as major hurricanes/);
  assert.deepEqual(SAFFIR_SIMPSON.filter((c) => c.major).map((c) => c.cat), [3, 4, 5]);
});

test("category from knots at every boundary", () => {
  assert.deepEqual([63, 64, 82, 83, 95, 96, 112, 113, 136, 137, 200].map(categoryForKnots), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(categoryForKnots(90), 2);   // Hurricane Rachel on 2026-10-04: 90 kt is category 2
  assert.equal(categoryForKnots(100), 3);  // Nolo: 100 kt is category 3
  assert.equal(categoryForKnots(null), 0);
});
