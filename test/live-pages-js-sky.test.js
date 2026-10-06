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

test("after the merge: the site build writes live-pages.js once, and no page adds header scopes of its own (site/layout.mjs's table does)", async () => {
  const fs = await import("node:fs");
  const build = fs.readFileSync(new URL("../site/build.mjs", import.meta.url), "utf8");
  assert.equal((build.match(/writeFileSync\(path\.join\(outDir, LIVE_SCRIPT_FILE\)/g) || []).length, 1);
  for (const f of ["liveseo.mjs", "pages-events.mjs", "pages-sky.mjs"]) assert.ok(!/scopedTable|scope="col"'\)/.test(fs.readFileSync(new URL(`../site/${f}`, import.meta.url), "utf8")), f);
  const { table } = await import("../site/layout.mjs");
  assert.ok(!/<th(?=[\s>])(?![^>]*scope="col")/.test(table({ caption: "c", head: ["a", "b"], rows: [["1", "2"]] })), "every header cell carries scope");
});
