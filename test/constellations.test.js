import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Astro from "astronomy-engine";
import { indexConstellations, constellationAt, bestMonth, visibilityFrom, wanderersIn, wherePlanets, MONTHS } from "../src/constellations.js";

const DOC = JSON.parse(fs.readFileSync(new URL("../public/constellations.json", import.meta.url), "utf8"));
const IDX = indexConstellations(DOC);
const DEG = Math.PI / 180;
const vec = (ra, dec) => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
const unvec = (v) => { const n = Math.hypot(...v); return { ra: ((Math.atan2(v[1], v[0]) / DEG) + 360) % 360, dec: Math.asin(v[2] / n) / DEG }; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

test("88 constellations with the IAU's own names, abbreviations and meanings", () => {
  assert.equal(IDX.list.length, 88);
  assert.equal(new Set(IDX.list.map((c) => c.abbr)).size, 88);
  const orion = IDX.byAbbr.get("Ori");
  assert.deepEqual([orion.name, orion.genitive, orion.english], ["Orion", "Orionis", "the Hunter"]);
  assert.equal(IDX.byAbbr.get("And").english, "the Chained Maiden");
  assert.equal(IDX.byAbbr.get("CMa").genitive, "Canis Majoris");
  assert.deepEqual([IDX.byAbbr.get("CMa").name, IDX.byAbbr.get("CMa").english], ["Canis Major", "the Great Dog"]);
  assert.equal(IDX.byAbbr.get("PsA").name, "Piscis Austrinus");
  assert.deepEqual(IDX.list.filter((c) => c.name.includes(" ")).map((c) => c.name).sort(), ["Canes Venatici", "Canis Major", "Canis Minor", "Coma Berenices", "Corona Australis", "Corona Borealis", "Leo Minor", "Piscis Austrinus", "Triangulum Australe", "Ursa Major", "Ursa Minor"]);
  assert.deepEqual([IDX.byAbbr.get("Aps").name, IDX.byAbbr.get("Aps").pron], ["Apus", "APE-us, APP-us"], "the row whose markup differs from the others");
  assert.deepEqual(IDX.list.filter((c) => !/^[A-ZÀ-ÿ][a-zà-ÿ]+( [A-Z][a-z]+)?$/.test(c.name)).map((c) => c.name), [], "every name is a name, not a pronunciation");
  for (const c of IDX.list) {
    assert.ok(c.name && c.english && c.genitive && c.pron, c.abbr);
    assert.ok(c.figure.length > 0, `${c.abbr} has a figure`);
    assert.ok(c.boundary.length >= 1 && c.boundary.every((l) => l.length >= 4), `${c.abbr} boundary`);
  }
  assert.match(IDX.credit, /IAU/);
});

test("the areas add up to the whole sky and the three largest are the known ones", () => {
  const total = IDX.list.reduce((s, c) => s + c.areaDeg2, 0);
  assert.ok(Math.abs(total - 41252.96) < 2, `total ${total}`);  // 4 pi steradians in square degrees
  assert.deepEqual([...IDX.list].sort((a, b) => b.areaDeg2 - a.areaDeg2).slice(0, 3).map((c) => c.abbr), ["Hya", "Vir", "UMa"]);
});

test("the boundary build checked itself: the rotation is exact and every edge is a meridian or a parallel", () => {
  assert.ok(DOC.fit.worstResidualDeg < 1e-4, `residual ${DOC.fit.worstResidualDeg}`);
  assert.ok(DOC.fit.orthonormalityError < 1e-9);
  assert.equal(DOC.fit.edgeViolations, 0);
  assert.ok(DOC.fit.worstEdgeOffsetDeg < 0.005);
});

test("the boundaries agree with the engine's constellation lookup: one side of every edge is inside, the other is not", () => {
  let checked = 0, bad = [];
  for (const c of IDX.list) {
    for (const loop of c.boundary) {
      for (let i = 2; i < loop.length - 2; i += 3) {
        const p = vec(...loop[i]), a = vec(...loop[i - 1]), b = vec(...loop[i + 1]);
        const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        if (Math.hypot(...t) < 1e-4) continue;
        const n = cross(p, t), nl = Math.hypot(...n);
        const off = (sign) => unvec(p.map((x, k) => x + (sign * 0.03 * DEG * n[k]) / nl));
        const s1 = constellationAt(off(1).ra, off(1).dec), s2 = constellationAt(off(-1).ra, off(-1).dec);
        checked++;
        const inside = [s1, s2].filter((s) => s === c.abbr).length;
        if (inside !== 1) bad.push(`${c.abbr}@${loop[i]} -> ${s1},${s2}`);
      }
    }
  }
  assert.ok(checked > 800, `checked ${checked}`);
  assert.ok(bad.length / checked < 0.01, `${bad.length} of ${checked} edge points disagree: ${bad.slice(0, 6).join("; ")}`);
});

test("the centre of each constellation is inside it, and the declination range contains the centre", () => {
  for (const c of IDX.list) {
    assert.equal(constellationAt(c.centre.ra, c.centre.dec), c.abbr, c.abbr);
    assert.ok(c.decMin <= c.centre.dec && c.centre.dec <= c.decMax, c.abbr);
  }
});

test("the brightest star in each famous constellation is the one everyone knows", () => {
  const want = { CMa: "Sirius", Car: "Canopus", Boo: "Arcturus", Lyr: "Vega", Aur: "Capella", Ori: "Rigel", CMi: "Procyon", Eri: "Achernar", Aql: "Altair", Tau: "Aldebaran", Sco: "Antares", Vir: "Spica", Leo: "Regulus", Gem: "Pollux", Cyg: "Deneb", PsA: "Fomalhaut", Cru: "Acrux", Cen: "Rigil Kentaurus" };
  for (const [abbr, name] of Object.entries(want)) assert.equal(IDX.byAbbr.get(abbr).stars.brightest.name, name, abbr);
  assert.equal(IDX.list.reduce((s, c) => s + c.stars.count, 0), 5044, "every catalogue star is in exactly one constellation");
});

test("the best month is when the constellation is highest at 9 in the evening", () => {
  const month = (abbr) => bestMonth(IDX.byAbbr.get(abbr).centre.ra).month;
  assert.equal(month("Ori"), "January");
  assert.equal(month("Leo"), "April");
  assert.equal(month("Sco"), "July");
  assert.equal(month("Peg"), "October");
  assert.ok(MONTHS.includes(month("UMa")));
  // independent check: at that date and 21:00 local solar time the centre is near the meridian
  const b = bestMonth(IDX.byAbbr.get("Ori").centre.ra);
  const t = new Date(Date.UTC(2027, b.monthIndex, b.day, 21, 0));  // 21:00 UT is 21:00 solar time at longitude 0
  const sid = Astro.SiderealTime(t) * 15;
  const diff = Math.abs(((sid - IDX.byAbbr.get("Ori").centre.ra + 540) % 360) - 180);
  assert.ok(diff < 8, `Orion is ${diff} degrees from the meridian at 21:00 on its best date`);
});

test("visibility from a latitude: never rises, circumpolar, partial or full", () => {
  const cru = IDX.byAbbr.get("Cru"), uma = IDX.byAbbr.get("UMa"), ump = IDX.byAbbr.get("UMi"), ori = IDX.byAbbr.get("Ori");
  assert.equal(visibilityFrom(cru, 60).state, "never", "the Southern Cross from 60 N");
  assert.equal(visibilityFrom(cru, 18.5).state, "full", "from Pune the whole Cross clears the horizon, low in the south: Acrux, its southernmost star at declination -63, reaches about 8 degrees");
  assert.equal(visibilityFrom(cru, 30).state, "partial", "from 30 N Acrux (declination -63) cannot rise but Gacrux (-57) can");
  assert.equal(visibilityFrom(cru, -33).state, "full", "from Sydney the Cross's stars never set, but the constellation's region reaches up to declination -55.9 and so does dip below the horizon");
  assert.equal(visibilityFrom(cru, -40).state, "circumpolar", "from 40 S all of the constellation's region stays up");
  assert.equal(visibilityFrom(ump, 51.5).state, "circumpolar", "the Little Bear from London");
  assert.equal(visibilityFrom(uma, 18.5).state, "full", "all of the Plough's region clears the horizon from Pune, though low");
  assert.equal(visibilityFrom(uma, -45).state, "partial", "from 45 S only the southern part of Ursa Major (declination below +45) ever rises");
  assert.equal(visibilityFrom(ori, 0).state, "full");
  assert.ok(Math.abs(visibilityFrom(ori, 51.5).maxAltCentre - (90 - Math.abs(51.5 - ori.centre.dec))) < 1e-9);
  assert.equal(visibilityFrom(uma, -60).state, "partial", "from 60 S a corner of Ursa Major at declination 28 to 30 still just rises");
  assert.equal(visibilityFrom(uma, -70).state, "never", "the Plough from 70 S");
});

test("which wandering bodies are inside a constellation", () => {
  const d = new Date("2026-10-04T12:00:00Z");
  const where = wherePlanets(d);
  assert.equal(Object.keys(where).length, 9);
  for (const abbr of Object.values(where)) assert.ok(IDX.byAbbr.has(abbr), abbr);
  for (const [body, abbr] of Object.entries(where)) if (body !== "Sun") assert.ok(wanderersIn(abbr, d).includes(body), `${body} is listed in ${abbr}`);
  // the Sun on 4 October is in Virgo; the Sun's longitude is in the sign Libra by tradition but the boundaries say Virgo
  assert.equal(where.Sun, "Vir");
});
