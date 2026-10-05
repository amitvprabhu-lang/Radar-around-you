import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { countSatellites, ORBIT_ORDER } from "../site/satcount.mjs";
import { COUNTRY_PAGES, HUB_FILE, MIN_ACTIVE_FOR_PAGE, NOT_RECORDED, NEAR_EQUATOR_DEG, countOwners, ownerPositions, pageGuard, latitudeBands, busiestBand, latitudeSummary, nameFamily, isDesignatorOnly, launchOf } from "../site/satcountry.mjs";
import { buildFixture, STANDARD, countryFixture, nAtAltitude } from "./helpers/satfixture.mjs";

const fx = countryFixture();
const c = countOwners(fx);
const owner = (name) => c.owners.find((o) => o.name === name);
const sum = (rows) => rows.reduce((s, r) => s + r.count, 0);

test("the five pages are fixed in code, with slugs, owners as the catalogue records them, short names and title phrases", () => {
  assert.deepEqual(COUNTRY_PAGES.map((p) => p.slug), ["united-states", "china", "united-kingdom", "cis-former-ussr", "japan"]);
  assert.deepEqual(COUNTRY_PAGES.map((p) => p.owner), ["United States", "People's Republic of China", "United Kingdom", "Commonwealth of Independent States (former USSR)", "Japan"]);
  for (const p of COUNTRY_PAGES) {
    assert.match(p.slug, /^[a-z]+(-[a-z]+)*$/);
    assert.equal(p.file, `satellites-by-country/${p.slug}/index.html`);
    assert.ok(p.name && p.phrase, p.slug);
  }
  assert.equal(HUB_FILE, "satellites-by-country/index.html");
  assert.equal(MIN_ACTIVE_FOR_PAGE, 50);
  assert.ok(!JSON.stringify(COUNTRY_PAGES).includes("Russia"), "the CIS entry keeps the catalogue's name");
});

test("each owner is counted exactly", () => {
  assert.equal(c.taken, "2026-10-05T08:14:54Z");
  assert.equal(c.active, 402);
  const us = owner("United States");
  assert.equal(us.active, 130);
  assert.equal(us.starlink, 70);
  assert.equal(us.last30, 3);
  assert.equal(us.orbits.low, 130);
  assert.deepEqual(us.purposes[0], { name: "Broadband internet", count: 70 });
  const cis = owner("Commonwealth of Independent States (former USSR)");
  assert.equal(cis.active, 58);
  assert.equal(cis.starlink, 0);
  assert.equal(cis.orbits.highElliptical, 19);
  assert.equal(cis.unknownYear, 9);
  assert.equal(owner("Japan").orbits.geostationary, 26);
  assert.equal(owner("Italy").active, 4);
  assert.equal(owner(NOT_RECORDED).active, 2);
});

test("an owner whose satellites are all inactive is still listed, with zero everywhere", () => {
  const empty = owner("Empty Owner");
  assert.ok(empty, "listed");
  assert.equal(empty.active, 0);
  assert.equal(empty.starlink, 0);
  assert.equal(empty.last30, 0);
  assert.deepEqual(Object.values(empty.orbits), [0, 0, 0, 0, 0]);
  assert.deepEqual(empty.purposes, []);
  assert.deepEqual(empty.launchYears, []);
  assert.equal(c.owners.at(-1).name, "Empty Owner", "ranked last");
});

test("owners are ranked by active satellites, then by name", () => {
  assert.deepEqual(c.owners.map((o) => o.name).slice(0, 6), ["United States", "People's Republic of China", "United Kingdom", "Commonwealth of Independent States (former USSR)", "Japan", "Italy"]);
  for (let i = 1; i < c.owners.length; i++) assert.ok(c.owners[i - 1].active >= c.owners[i].active);
});

test("the per-owner numbers add up to the totals the count page shows, for the fixture and for the bundled snapshot", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const real = { meta: JSON.parse(fs.readFileSync(root + "meta.json", "utf8")), details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") };
  for (const [label, data] of [["fixture", fx], ["standard", buildFixture(STANDARD, { newIdx: [1, 6, 8] })], ["snapshot", real]]) {
    const t = countSatellites(data, { topOwners: 1000 }), o = countOwners(data);
    const add = (f) => o.owners.reduce((s, r) => s + f(r), 0);
    assert.equal(o.active, t.active, label);
    assert.equal(add((r) => r.active), t.active, `${label}: active`);
    assert.equal(add((r) => r.starlink), t.starlink, `${label}: starlink`);
    assert.equal(add((r) => r.last30), t.last30, `${label}: last 30 days`);
    for (const k of ORBIT_ORDER) assert.equal(add((r) => r.orbits[k]), t.orbits.find((x) => x.key === k).count, `${label}: ${k}`);
    for (const k of ORBIT_ORDER) assert.equal(o.orbits[k], t.orbits.find((x) => x.key === k).count, `${label}: world ${k}`);
    assert.equal(add((r) => sum(r.launchYears) + r.unknownYear), t.active, `${label}: launch years`);
    assert.equal(add((r) => sum(r.purposes)), t.active, `${label}: purposes`);
    for (const row of t.owners) assert.equal(o.owners.find((r) => r.name === row.name).active, row.count, `${label}: ${row.name}`);
    for (const r of o.owners) assert.equal(Object.values(r.orbits).reduce((s, n) => s + n, 0), r.active, `${label}: ${r.name} orbits`);
  }
});

test("the bundled snapshot has the owners the pages were chosen from, each above the guard", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const o = countOwners({ meta: JSON.parse(fs.readFileSync(root + "meta.json", "utf8")), details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") });
  for (const p of COUNTRY_PAGES) assert.equal(pageGuard(o, p), null, p.slug);
});

test("the guard skips an owner that is missing or has under 50 active satellites, and says why", () => {
  const japan = COUNTRY_PAGES.find((p) => p.slug === "japan");
  assert.equal(pageGuard(c, japan), null, "52 is enough");
  assert.match(pageGuard(c, japan, { min: 53 }), /Japan.*52 active satellites.*under 53/);
  const fiftyOrNot = (n) => countOwners(buildFixture(Array.from({ length: n }, () => ({ type: 0, status: 1, owner: 1, alt: 600 })), { owners: ["Japan"] }));
  assert.equal(pageGuard(fiftyOrNot(50), japan), null, "exactly 50 passes");
  assert.match(pageGuard(fiftyOrNot(49), japan), /49 active satellites/);
  assert.match(pageGuard(countOwners(buildFixture(STANDARD)), japan), /Japan.*not in the feed/);
});

test("positions are finite latitudes and longitudes on the globe, one per active satellite of that owner", () => {
  for (const p of COUNTRY_PAGES) {
    const pts = ownerPositions(fx, p.owner);
    assert.equal(pts.length, owner(p.owner).active, p.slug);
    for (const [lat, lon] of pts) {
      assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${p.slug} lat ${lat}`);
      assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${p.slug} lon ${lon}`);
    }
  }
  assert.deepEqual(ownerPositions(fx, "Empty Owner"), []);
  assert.deepEqual(ownerPositions(fx, "Nobody"), []);
});

test("positions follow the orbit: a satellite never goes further from the equator than its inclination, and geostationary ones sit on it", () => {
  const us = ownerPositions(fx, "United States");
  for (const [lat] of us.slice(0, 70)) assert.ok(Math.abs(lat) <= 53.5, `Starlink-like orbit at ${lat}`);
  const jp = ownerPositions(fx, "Japan").filter((_, j) => j % 2 === 1);
  for (const [lat] of jp) assert.ok(Math.abs(lat) < 0.5, `geostationary at ${lat}`);
  // the same input gives the same output
  assert.deepEqual(ownerPositions(fx, "Japan"), ownerPositions(fx, "Japan"));
});

test("positions are computed for the data time unless another time is given", () => {
  const one = buildFixture([{ type: 0, status: 1, owner: 1, alt: 550, incl: 53 }], { owners: ["X"], ref: Date.parse("2026-10-05T08:14:54Z") });
  const atData = ownerPositions(one, "X");
  assert.deepEqual(ownerPositions(one, "X", new Date("2026-10-05T08:14:54Z")), atData);
  assert.notDeepEqual(ownerPositions(one, "X", new Date("2026-10-05T08:44:54Z")), atData, "half an orbit later it is elsewhere");
  assert.ok(nAtAltitude(550) > 0);
});

test("latitude bands of 30 degrees count every point once, and the busiest band is found", () => {
  const pts = [[-90, 0], [-60, 0], [-45, 0], [0, 0], [10, 0], [29.99, 0], [30, 0], [89, 0], [90, 0]];
  assert.deepEqual(latitudeBands(pts).map((b) => [b.from, b.to, b.count]), [[-90, -60, 1], [-60, -30, 2], [-30, 0, 0], [0, 30, 3], [30, 60, 1], [60, 90, 2]]);
  assert.deepEqual(busiestBand(pts), { from: 0, to: 30, count: 3, share: 3 / 9 });
  assert.deepEqual(busiestBand([[-45, 1], [45, 1]]), { from: -60, to: -30, count: 1, share: 0.5 }, "a tie goes to the southern band");
  assert.equal(busiestBand([]), null);
});

test("files of the wrong size are refused with a message that names the file", () => {
  assert.throws(() => countOwners({ ...fx, details: fx.details.subarray(1) }), /details\.bin has \d+ bytes/);
  assert.throws(() => countOwners({ ...fx, swarm: fx.swarm.subarray(1) }), /swarm\.bin has \d+ bytes/);
  assert.throws(() => ownerPositions({ ...fx, meta: { ...fx.meta, ref: undefined } }, "Japan"), /no reference time/);
});

test("each position carries its orbit group, and geostationary satellites are counted as near the equator", () => {
  const jp = ownerPositions(fx, "Japan");
  assert.deepEqual(jp.filter((_, j) => j % 2 === 1).map((p) => p[2]), Array(26).fill("geostationary"));
  assert.deepEqual(jp.filter((_, j) => j % 2 === 0).map((p) => p[2]), Array(26).fill("low"));
  const s = latitudeSummary(jp);
  assert.equal(NEAR_EQUATOR_DEG, 1);
  assert.ok(s.near >= 26 && s.nearGeo === 26, JSON.stringify(s));
  assert.equal(s.near + s.considered, 52);
});

test("the latitude summary leaves out points within one degree of the equator, so their side never decides anything", () => {
  const far = [[45, 0, "low"], [50, 1, "low"], [-20, 2, "low"]];
  const a = latitudeSummary([...far, [0.4, 3, "geostationary"], [0.3, 4, "geostationary"], [-0.2, 5, "low"]]);
  const b = latitudeSummary([...far, [-0.4, 3, "geostationary"], [-0.3, 4, "geostationary"], [0.2, 5, "low"]]);
  assert.deepEqual(a, b, "flipping the side of near-equator points changes nothing");
  assert.deepEqual(a, { total: 6, near: 3, nearGeo: 2, considered: 3, band: { from: 30, to: 60, count: 2, share: 2 / 3 }, north: 2 });
  assert.deepEqual(latitudeSummary([[0.5, 0, "geostationary"], [-0.9, 0, "geostationary"]]), { total: 2, near: 2, nearGeo: 2, considered: 0, band: null, north: 0 });
  assert.deepEqual(latitudeSummary([[1, 0, "low"], [-1, 0, "low"]]).considered, 2, "exactly one degree counts as placed");
  assert.deepEqual(latitudeSummary([]), { total: 0, near: 0, nearGeo: 0, considered: 0, band: null, north: 0 });
});

test("name families, recent launches and the earliest launches come from names.txt, and are empty without it", () => {
  assert.deepEqual(["STARLINK-1234", "COSMOS 2545", "COSMOS 2620 [GLONASS-K1]", "2026-205A", "", "X", "qianfan-1", "DMC3", "SDA_1664", "AE1C"].map(nameFamily),
    ["STARLINK", "COSMOS", "COSMOS", null, null, null, "QIANFAN", "DMC", "SDA", "AE"]);
  assert.deepEqual(["2026-205A", "2026-205AB", "1998-067A", "STARLINK-1", "2026-205", " 2026-220F "].map(isDesignatorOnly), [true, true, true, false, false, true]);
  assert.equal(launchOf("2026-205A"), "2026-205");
  const us = owner("United States");
  assert.deepEqual(us.families.map((f) => [f.name, f.count]), [["STARLINK", 70], ["FLOCK", 30], ["USA", 30]]);
  assert.deepEqual(us.families[0].orbits, ["low"]);
  assert.deepEqual(us.families[0].purposes, ["Broadband internet"]);
  assert.deepEqual(owner("Japan").families.map((f) => [f.name, f.count, f.orbits.join(), f.purposes.join()]), [["GRUS", 26, "low", "Earth observation,Weather and climate"], ["JCSAT", 26, "geostationary", "Communications,Weather and climate"]], "a tie for the main purpose names both");
  assert.equal(us.noFamily, 0);
  assert.equal(c.named, true);
  assert.deepEqual(us.recent.map((r) => r.name), ["FLOCK 4Y-75", "STARLINK-1000", "STARLINK-1001"], "sorted by launch date, then name");
  assert.equal(us.recent.length, us.last30);
  assert.deepEqual(owner("Commonwealth of Independent States (former USSR)").recent.map((r) => r.name), ["MOLNIYA 2-14"]);
  assert.deepEqual(us.earliest.map((e) => e.date), ["2008-05-01", "2009-05-01", "2010-05-01"]);
  assert.deepEqual(us.earliest[0].names, ["USA 372", "USA 390", "USA 408", "USA 426"], "every satellite launched on the earliest day");
  const noNames = countOwners({ ...fx, names: null });
  assert.equal(noNames.named, false);
  for (const o of noNames.owners) { assert.deepEqual(o.families, []); assert.deepEqual(o.recent, []); assert.deepEqual(o.earliest, []); assert.equal(o.noFamily, 0); }
  assert.deepEqual(noNames.owners.map((o) => o.active), c.owners.map((o) => o.active), "names change no count");
  assert.deepEqual(countOwners({ ...fx, names: fx.names.join("\n") }).owners[0].families, us.families, "a string works as well as an array");
});

test("a names file that does not have one line per object is refused", () => {
  assert.throws(() => countOwners({ ...fx, names: fx.names.slice(1) }), /names\.txt has 403 lines, expected 404/);
  assert.throws(() => countOwners({ ...fx, names: [...fx.names, "EXTRA"] }), /names\.txt has 405 lines, expected 404/);
  assert.throws(() => countOwners({ ...fx, names: fx.names.join("\n") + "\n" }), /names\.txt has 405 lines/, "a stray newline at the end is a line too");
});

test("satellites with no name family are counted, and only those", () => {
  const objs = [["STARLINK-1"], ["2026-205A"], ["2026-205B"], ["123 SAT"], [""], ["QPS-SAR 9"]].map(([name]) => ({ type: 0, status: 1, owner: 1, alt: 550, name }));
  const o = countOwners(buildFixture(objs, { owners: ["X"] })).owners[0];
  assert.equal(o.noFamily, 4);
  assert.deepEqual(o.families.map((f) => [f.name, f.count]), [["QPS", 1], ["STARLINK", 1]]);
  assert.equal(o.families.reduce((s, f) => s + f.count, 0) + o.noFamily, o.active, "families and the unnamed add up to the fleet");
});

test("the server's allowed page list in hosting/lib.php names exactly the slugs in COUNTRY_PAGES", () => {
  const php = fs.readFileSync(fileURLToPath(new URL("../hosting/lib.php", import.meta.url)), "utf8");
  const m = php.match(/satellites-by-country\/\(\?:([a-z|-]+)\)\/index/);
  assert.ok(m, "the slug list is in radar_safe_page_path");
  assert.deepEqual(m[1].split("|").sort(), COUNTRY_PAGES.map((p) => p.slug).sort());
  for (const p of COUNTRY_PAGES) assert.ok(php.includes(p.slug), p.slug);
});
