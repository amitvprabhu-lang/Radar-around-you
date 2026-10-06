import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { liveScriptSource } from "../site/live-pages-js.mjs";

// The time zone switch for the sky pages was removed after review (2026-10-06): it converted only the <time data-tz> elements, while the
// findings, the chart heading and the chart labels stayed in the city's zone. The sky pages now stay in the city's zone throughout.
test("the shared script has no time zone switch, leaves the sky pages' city-local times alone, still parses and stays small", () => {
  const src = liveScriptSource();
  assert.ok(!/liveZones|zoneTimeText/.test(src));
  assert.ok(src.includes('querySelectorAll("main time[datetime]:not([data-tz])")'), "the reader's-time note skips time[data-tz]");
  assert.doesNotThrow(() => new vm.Script(src));
  assert.ok(Buffer.byteLength(src) < 20 * 1024, `${Buffer.byteLength(src)} bytes`);
});
