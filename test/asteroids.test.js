import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { diameterM, sizeText, sigmaText, lunarText, kmCompact, whenFromNow, ASSUMED_ALBEDO } from "../src/asteroids.js";

const DOC = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/closeapproaches.json", import.meta.url), "utf8"));

test("size from brightness reproduces NASA's own example: H = 22 with an albedo of 13 percent is about 150 m", () => {
  assert.equal(ASSUMED_ALBEDO, 0.13);
  const d = diameterM(22);
  assert.ok(d > 140 && d < 155, `${d}`);
  assert.ok(diameterM(25) < diameterM(22) / 3, "three magnitudes fainter is about four times smaller");
  assert.equal(diameterM(null), null);
  assert.equal(diameterM(NaN), null);
});

test("size text rounds sensibly and never claims more precision than the estimate has", () => {
  assert.equal(sizeText(22), "about 150 m");
  assert.match(sizeText(27.3), /^about \d+(\.\d)? m$/);
  assert.equal(sizeText(null), "size not known");
  assert.match(sizeText(18), /^about [\d,]+ m$/);
  for (const a of DOC.approaches) assert.match(sizeText(a.h), /^(about [\d.,]+ m|size not known)$/);
});

test("JPL's time uncertainty strings", () => {
  assert.equal(sigmaText("3_19:55"), "3 days 19 h 55 min");
  assert.equal(sigmaText("13:02"), "13 h 2 min");
  assert.equal(sigmaText("00:15"), "15 min");
  assert.equal(sigmaText("< 00:01"), "under 1 minute");
  assert.equal(sigmaText("1_00:00"), "1 day");
  assert.equal(sigmaText(null), null);
  assert.equal(sigmaText("nonsense"), null);
  for (const a of DOC.approaches) assert.ok(a.timeSigma === null || sigmaText(a.timeSigma), a.timeSigma);
});

test("distance wording", () => {
  assert.match(lunarText(0.82), /closer than the Moon/);
  assert.equal(lunarText(5.23), "5.2 times the Moon's distance");
  assert.equal(lunarText(18.9), "19 times the Moon's distance");
  assert.equal(kmCompact(4031570), "4.0 million km");
  assert.equal(kmCompact(315000), "315 thousand km");
});

test("the real list: sorted by time, with the closest object inside the Moon's distance on the day it was fetched", () => {
  const a = DOC.approaches;
  assert.equal(a.length, 31);
  assert.deepEqual(a.map((x) => x.time), [...a.map((x) => x.time)].sort());
  const closest = [...a].sort((x, y) => x.distAu - y.distAu)[0];
  assert.equal(closest.des, "2025 UK9");
  assert.ok(closest.distLd < 1);
  for (const x of a) assert.ok(Math.abs(x.distKm / 384400 - x.distLd) < 0.01, x.des);
});

test("relative time reads naturally in both directions", () => {
  const M = 60000, H = 60 * M, D = 24 * H;
  assert.equal(whenFromNow(20000), "now");
  assert.equal(whenFromNow(5 * M), "in 5 min");
  assert.equal(whenFromNow(-5 * M), "5 min ago");
  assert.equal(whenFromNow(6 * H), "in 6 h");
  assert.equal(whenFromNow(-16 * H), "16 h ago");
  assert.equal(whenFromNow(3 * D), "in 3 days");
  assert.equal(whenFromNow(-3 * D), "3 days ago");
  assert.equal(whenFromNow(47 * H), "in 47 h");
});
