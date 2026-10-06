import test from "node:test";
import assert from "node:assert/strict";
import { FAMILY_PAGES, LIVE_PAGES, LIVE_FILES, SATELLITE_FILES, familyPage, RIGHT_NOW_FILE } from "../site/livepages.mjs";
import { LIVE_FAMILY, liveFamily, FAMILY_RENDERERS } from "../site/liveregistry.mjs";

test("every family page is looked up by key and has a reader, a deploy-time snapshot and a page function", () => {
  const keys = FAMILY_PAGES.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  assert.equal(new Set(FAMILY_PAGES.map((p) => p.file)).size, keys.length, "files are unique");
  for (const p of LIVE_FAMILY) {
    assert.equal(typeof p.read, "function", `${p.key}: read`);
    assert.equal(typeof p.snapshot, "function", `${p.key}: snapshot`);
    assert.equal(typeof p.render, "function", `${p.key}: render`);
    assert.ok(p.family && p.slug && p.file === `${p.slug}/index.html` && p.name && Array.isArray(p.feeds) && p.feeds.length, `${p.key}: the page fields`);
    assert.ok(Number.isFinite(p.maxAgeHours) && p.maxAgeHours > 0, `${p.key}: a limit`);
    assert.equal(familyPage(p.key).file, p.file);
    assert.equal(liveFamily(p.key), p);
    assert.equal(FAMILY_RENDERERS[p.key], p.render);
  }
  assert.equal(familyPage("no-such-page"), null);
});

test("the live list holds every family page once, the satellite pages are only the count and country pages, and the hub is last", () => {
  for (const p of FAMILY_PAGES) assert.equal(LIVE_PAGES.filter((x) => x.file === p.file && x.kind === p.family && x.key === p.key).length, 1, p.key);
  assert.ok(SATELLITE_FILES.every((f) => !FAMILY_PAGES.some((p) => p.file === f)), "a family page built from the satellites feed is not a satellite page");
  assert.equal(SATELLITE_FILES.length, 7);
  assert.equal(LIVE_FILES.at(-1), RIGHT_NOW_FILE);
  const hub = LIVE_PAGES.at(-1);
  for (const p of FAMILY_PAGES) for (const f of p.feeds) assert.ok(hub.feeds.includes(f), `the hub's feeds include ${f}`);
});
