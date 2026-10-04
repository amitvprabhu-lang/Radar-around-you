import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { haversineKm } from "../src/core.js";
import { decodePlaces, searchPlaces, nearestPlace, placeFromRecord, placeFromPosition, validCustomPlace, isValidTimeZone, countryName } from "../src/places.js";

const DOC = JSON.parse(fs.readFileSync(new URL("../public/places.json", import.meta.url), "utf8"));
const IDX = decodePlaces(DOC);

test("the real index decodes, every time zone is one this runtime knows, and the credit is carried", () => {
  assert.equal(IDX.list.length, DOC.p.length);
  assert.ok(IDX.list.length > 30000);
  for (const z of DOC.tz) assert.ok(isValidTimeZone(z), z);
  assert.match(IDX.credit, /GeoNames.*CC BY 4\.0/);
  assert.throws(() => decodePlaces({ p: [], tz: [], fields: ["x"] }), /unexpected structure/);
  assert.throws(() => decodePlaces(null));
});

test("searching finds the biggest place with that name first", () => {
  const r = searchPlaces(IDX, "pune");
  assert.equal(r[0].name, "Pune");
  assert.equal(r[0].tz, "Asia/Kolkata");
  assert.equal(searchPlaces(IDX, "parbhani")[0].cc, "IN");
  const london = searchPlaces(IDX, "london", 10);
  assert.equal(london[0].cc, "GB");
  assert.ok(london.some((p) => p.cc === "CA"), "London, Canada is also listed, after the larger one");
  assert.ok(london.findIndex((p) => p.cc === "GB") < london.findIndex((p) => p.cc === "CA"));
});

test("accents and case do not matter, and short or empty queries return nothing", () => {
  assert.equal(searchPlaces(IDX, "REYKJAVIK")[0].name, "Reykjavík");
  assert.equal(searchPlaces(IDX, "reykjavík")[0].name, "Reykjavík");
  assert.deepEqual(searchPlaces(IDX, "p"), []);
  assert.deepEqual(searchPlaces(IDX, ""), []);
  assert.deepEqual(searchPlaces(null, "pune"), []);
  assert.deepEqual(searchPlaces(IDX, "zzzzqqqq"), []);
});

test("multi-word names match by the start of each word", () => {
  const r = searchPlaces(IDX, "new yor");
  assert.ok(r.some((p) => p.name === "New York City"), r.map((p) => p.name).join());
  assert.ok(searchPlaces(IDX, "san fran").some((p) => p.name === "San Francisco"));
});

test("nearest place and the distance limit", () => {
  const n = nearestPlace(IDX, 18.5204, 73.8567, 50);
  assert.equal(n.place.name, "Pune");
  assert.ok(n.km < 5);
  assert.equal(nearestPlace(IDX, -48, -120, 300), null, "open ocean has nothing within 300 km");
  assert.ok(nearestPlace(IDX, -48, -120).km > 300, "without a limit the nearest is still found");
  assert.equal(nearestPlace(null, 0, 0), null);
});

test("a position fix is named for a place within 25 km and takes its time zone", () => {
  const p = placeFromPosition(IDX, 18.53, 73.85, "America/New_York");
  const within = IDX.list.filter((q) => haversineKm(18.53, 73.85, q.lat, q.lon) <= 25).sort((a, b) => b.pop - a.pop);
  assert.ok(within.length > 1, "several indexed places lie within 25 km (Pune's neighbourhoods)");
  assert.equal(p.name, within[0].name, "named for the most populous place within 25 km");
  assert.equal(p.name, "Pune");
  assert.equal(placeFromPosition(IDX, -12.0464, -77.0428, "America/Lima").name, "Lima", "a fix in the middle of Lima is not named for a district");
  assert.equal(p.tz, "Asia/Kolkata");
  assert.equal(p.country, "India");
  assert.equal(p.positionFix, true);
  assert.equal(p.id, "pos_18.53_73.85");
  const off = nearestPlace(IDX, 18, 71.5);  // in the Arabian Sea
  assert.ok(off.km > 25 && off.km < 300, `${off.km} km from ${off.place.name}`);
  const farm = placeFromPosition(IDX, 18, 71.5, "America/New_York");
  assert.equal(farm.name, "Your location", "too far from any place to be named for it");
  assert.equal(farm.tz, "Asia/Kolkata", "but the nearest place's zone is used, not the device's");
  assert.equal(farm.country, "18.00°, 71.50°");
  const sea = placeFromPosition(IDX, -48, -120, "Pacific/Auckland");
  assert.equal(sea.tz, "Pacific/Auckland", "at sea the device's zone is used");
  assert.equal(placeFromPosition(IDX, -48, -120, "Not/AZone").tz, "UTC");
});

test("a place from the index has the app's shape", () => {
  const rec = searchPlaces(IDX, "tokyo")[0];
  const p = placeFromRecord(rec);
  assert.deepEqual(Object.keys(p).sort(), ["country", "custom", "id", "lat", "lon", "name", "tz"]);
  assert.match(p.id, /^g\d+$/);
  assert.equal(p.country, "Japan");
  assert.ok(validCustomPlace(p));
});

test("a saved place is only trusted when every field is sane", () => {
  const ok = { id: "g1", name: "Pune", lat: 18.5, lon: 73.8, tz: "Asia/Kolkata" };
  assert.ok(validCustomPlace(ok));
  for (const bad of [null, "x", {}, { ...ok, lat: 91 }, { ...ok, lon: "73" }, { ...ok, tz: "Mars/Olympus" }, { ...ok, name: "" }, { ...ok, id: 5 }, { ...ok, name: "x".repeat(200) }, { ...ok, lat: NaN }]) assert.equal(validCustomPlace(bad), false, JSON.stringify(bad));
});

test("country names", () => {
  assert.equal(countryName("IN"), "India");
  assert.equal(countryName("XX").length > 0, true);
});
