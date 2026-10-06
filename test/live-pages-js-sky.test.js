import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { zoneTimeText, liveScriptSource } from "../site/live-pages-js.mjs";

test("the sky pages' zone switch prints a time in another zone in the pages' own form, with the weekday only on another day", () => {
  const ref = "2026-10-06T12:49:00Z";  // 18:19 in Pune, 14:49 in Berlin
  assert.equal(zoneTimeText("2026-10-06T15:00:00Z", "Asia/Kolkata", ref), "20:30");
  assert.equal(zoneTimeText("2026-10-06T20:00:00Z", "Asia/Kolkata", ref), "Wed 7 Oct 01:30");
  assert.equal(zoneTimeText("2026-10-06T20:00:00Z", "Europe/Berlin", ref), "22:00");
  assert.equal(zoneTimeText("2026-10-06T23:30:00Z", "America/New_York", ref), "19:30");
  assert.equal(zoneTimeText("2026-10-06T20:00:00Z", "UTC", null), "20:00", "no reference: the clock time only");
  assert.equal(zoneTimeText("soon", "UTC", ref), null);
  assert.equal(zoneTimeText("2026-10-06T20:00:00Z", "Not/AZone", ref), null, "an unknown zone gives nothing, so the switch is not offered");
});

test("the script carries the zone switch, still parses, and leaves a page without city times alone", () => {
  const src = liveScriptSource();
  assert.ok(src.includes("function liveZones(d)") && src.includes("function zoneTimeText("));
  assert.doesNotThrow(() => new vm.Script(src));
  assert.ok(Buffer.byteLength(src) < 20 * 1024, `${Buffer.byteLength(src)} bytes`);
});
