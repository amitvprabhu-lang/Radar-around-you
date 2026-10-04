import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  agoText, feedState, summarize, resolveSources, overlayCities, pollDelayMs, loadManifest, createLive, APPLIED, FEED_ORDER,
} from "../src/live.js";

// a real manifest written by the pipeline on 2026-10-04 (see pipeline/tests/fixtures/README.md for how it was made)
const MANIFEST = JSON.parse(fs.readFileSync(new URL("./fixtures/live-manifest.json", import.meta.url), "utf8"));
const GEN = Date.parse(MANIFEST.generatedAt);
const BASE_TAKEN = Date.parse("2026-10-04T14:19:25Z");
const clone = (o) => JSON.parse(JSON.stringify(o));

test("age text uses plain steps", () => {
  assert.equal(agoText(10), "just now");
  assert.equal(agoText(89), "just now");
  assert.equal(agoText(120), "2 min ago");
  assert.equal(agoText(3600), "60 min ago");
  assert.equal(agoText(5399), "90 min ago");
  assert.equal(agoText(5400), "2 h ago");
  assert.equal(agoText(86400), "24 h ago");
  assert.equal(agoText(172800), "2 d ago");
  assert.equal(agoText(-5), "unknown");
  assert.equal(agoText(NaN), "unknown");
});

test("a feed is fresh, failing, stale, halted or not fetched", () => {
  const f = { checkedAt: "2026-10-04T18:00:00Z", staleAfterSec: 2400, status: "ok", halted: null };
  const at = (min) => Date.parse("2026-10-04T18:00:00Z") + min * 60000;
  assert.deepEqual(feedState(f, at(5)), { state: "fresh", ageSec: 300 });
  assert.equal(feedState({ ...f, status: "failing" }, at(5)).state, "failing", "a failed last try inside the limit");
  assert.equal(feedState({ ...f, status: "failing" }, at(41)).state, "stale", "past the limit it is stale, whatever the last try did");
  assert.equal(feedState(f, at(41)).state, "stale");
  assert.equal(feedState({ ...f, halted: { reason: "HTTP 403" } }, at(5)).state, "halted");
  assert.equal(feedState({ ...f, checkedAt: null }, at(5)).state, "none");
  assert.equal(feedState(undefined, at(5)).state, "none");
  assert.equal(feedState(f, at(-3)).ageSec, 0, "a client clock slightly behind never gives a negative age");
});

test("the summary lists feeds in a fixed order and names the worst state of the core feeds", () => {
  const s = summarize(MANIFEST, GEN + 60000);
  assert.deepEqual(s.rows.map((r) => r.id), FEED_ORDER);
  assert.equal(s.overall, "fresh");
  assert.deepEqual(s.counts, { fresh: 7, failing: 0, stale: 0, none: 0, halted: 0 }, "the private catalogue is not counted");
  const later = summarize(MANIFEST, GEN + 10 * 3600e3);
  assert.equal(later.overall, "stale");
  assert.ok(later.counts.stale >= 5);
  const m = clone(MANIFEST);
  m.feeds.satellites.halted = { since: "x", until: "y", reason: "HTTP 403" };
  assert.equal(summarize(m, GEN + 60000).overall, "halted", "a policy halt outranks everything");
  const m2 = clone(MANIFEST);
  m2.feeds.quakes.status = "failing";
  assert.equal(summarize(m2, GEN + 60000).overall, "failing");
  assert.ok(summarize(MANIFEST, GEN + 90000).generatedAgeSec >= 89);
});

test("live files are used only when complete and newer than the bundled snapshot", () => {
  const s = resolveSources(MANIFEST, BASE_TAKEN, "live/");
  for (const id of APPLIED.concat("satellites")) assert.ok(s[id], id);
  assert.match(s.quakes.paths["quakes.json"], /^live\/quakes\/\d{8}T\d{6}Z\/quakes\.json$/);
  assert.equal(s.satellites.version, MANIFEST.feeds.satellites.version);
  assert.deepEqual(Object.keys(s.satellites.paths).sort(), ["details.bin", "ids.bin", "names.txt", "precise.json", "satmeta.json", "swarm.bin"]);
  assert.ok(s.satellites.paths["swarm.bin"].startsWith("live/satellites/"));

  const newer = resolveSources(MANIFEST, Date.parse("2026-10-05T00:00:00Z"));
  assert.ok(Object.values(newer).every((v) => v === null), "a snapshot newer than the live copy wins");

  const m = clone(MANIFEST);
  delete m.feeds.satellites.files["ids.bin"];
  const part = resolveSources(m, BASE_TAKEN);
  assert.equal(part.satellites, null, "a satellite group missing one file is not used at all, so indexes can never be mixed");
  assert.ok(part.quakes);

  const never = clone(MANIFEST);
  never.feeds.kp.files = {}; never.feeds.kp.version = null;
  assert.equal(resolveSources(never, BASE_TAKEN).kp, null);
  for (const bad of [null, {}, { schema: 2, generatedAt: "x", feeds: {} }, { schema: 1, feeds: {} }]) {
    assert.ok(Object.values(resolveSources(bad, BASE_TAKEN)).every((v) => v === null));
  }
});

test("live clouds and aircraft are laid onto the bundled places in place", () => {
  const cities = [{ id: "pune", name: "Pune", clouds: { updated: "old", hours: [] }, planes: { time: "old", aircraft: [] } }, { id: "london", name: "London", clouds: { updated: "old", hours: [] }, planes: { time: "old", aircraft: [] } }];
  const ref = cities[0];
  const changed = overlayCities(cities,
    { cities: { pune: { updated: "u", hours: [{ t: "t", cloud: 5, temp: 20 }], fetchedAt: "f" } } },
    { cities: { london: { time: "T", aircraft: [{ hex: "abc" }], fetchedAt: "f" }, nowhere: { time: "T", aircraft: [] } } });
  assert.deepEqual([...changed].sort(), ["london", "pune"]);
  assert.equal(ref, cities[0], "the same object, so earlier references stay valid");
  assert.deepEqual(ref.clouds, { updated: "u", hours: [{ t: "t", cloud: 5, temp: 20 }] });
  assert.equal(ref.planes.time, "old", "pune had no live aircraft");
  assert.equal(cities[1].planes.aircraft.length, 1);
  assert.equal(cities[1].name, "London");
  assert.equal(overlayCities(cities, null, null).size, 0);
  assert.equal(overlayCities(cities, { cities: { pune: { hours: "bad" } } }, { cities: { pune: { aircraft: 3 } } }).size, 0, "malformed entries are ignored");
});

test("polling waits the manifest's interval and backs off after failures", () => {
  assert.equal(pollDelayMs({ pollSec: 300 }, 0), 300000);
  assert.equal(pollDelayMs(null, 0), 300000);
  assert.equal(pollDelayMs({ pollSec: 300 }, 1), 600000);
  assert.equal(pollDelayMs({ pollSec: 300 }, 2), 1200000);
  assert.equal(pollDelayMs({ pollSec: 300 }, 3), 1800000, "capped at 30 minutes");
  assert.equal(pollDelayMs({ pollSec: 300 }, 40), 1800000);
  assert.equal(pollDelayMs({ pollSec: 5 }, 0), 60000, "never faster than a minute");
  assert.equal(pollDelayMs({ pollSec: 99999 }, 0), 1800000);
});

test("the manifest loader never throws and rejects anything that is not a v1 manifest", async () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  assert.equal((await loadManifest(ok(MANIFEST), "live/")).generatedAt, MANIFEST.generatedAt);
  assert.equal(await loadManifest(async () => ({ ok: false, status: 404 }), "live/"), null);
  assert.equal(await loadManifest(ok({ schema: 3, generatedAt: "x", feeds: {} }), "live/"), null);
  assert.equal(await loadManifest(ok("text"), "live/"), null);
  assert.equal(await loadManifest(async () => { throw new TypeError("network"); }, "live/"), null);
  assert.equal(await loadManifest(async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }), "live/"), null);
  let called = 0;
  assert.equal(await loadManifest(async () => { called++; }, ""), null);
  assert.equal(called, 0, "no live folder configured means no request");
  let seen;
  await loadManifest(async (url, init) => { seen = { url, init }; return { ok: false }; }, "live/");
  assert.equal(seen.url, "live/manifest.json");
  assert.equal(seen.init.cache, "no-store", "the manifest is never served from a cache");
});

test("a manifest request that hangs is abandoned", async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  assert.equal(await loadManifest(hang, "live/", 30), null);
  assert.ok(Date.now() - t0 < 1000);
});

function harness(manifests, { loadFeed, baseline = BASE_TAKEN, loaded = {} } = {}) {
  const calls = { applied: [], satellites: [], fetches: 0, scheduled: [], cleared: 0, states: 0 };
  let i = 0;
  const fetchFn = async () => {
    calls.fetches++;
    const m = manifests[Math.min(i++, manifests.length - 1)];
    return m === null ? { ok: false, status: 500 } : { ok: true, json: async () => m };
  };
  const live = createLive({
    fetchFn, baselineTakenMs: baseline, loaded,
    loadFeed: loadFeed || (async (id, s) => ({ id, version: s.version })),
    apply: (id, data) => calls.applied.push(id),
    onState: () => calls.states++, onSatellites: (v) => calls.satellites.push(v),
    timers: { set: (fn, ms) => { calls.scheduled.push(ms); return calls.scheduled.length; }, clear: () => { calls.cleared++; } },
  });
  return { live, calls };
}

test("the first poll applies every live feed and announces new satellites once", async () => {
  const { live, calls } = harness([MANIFEST]);
  live.start();
  assert.deepEqual(calls.scheduled, [300000], "scheduled at the manifest's default before any manifest is known");
  await live.pollNow();
  assert.deepEqual(calls.applied.sort(), [...APPLIED].sort());
  assert.deepEqual(calls.satellites, [MANIFEST.feeds.satellites.version]);
  await live.pollNow();
  assert.equal(calls.applied.length, APPLIED.length, "the same versions are not applied twice");
  assert.equal(calls.satellites.length, 1, "and the satellite notice is not repeated");
  assert.equal(live.state().satellitesWaiting, MANIFEST.feeds.satellites.version);
});

test("only a changed feed is fetched again", async () => {
  const next = clone(MANIFEST);
  next.feeds.quakes.version = "20261004T190000Z";
  next.feeds.quakes.files = { "quakes.json": "quakes/20261004T190000Z/quakes.json" };
  const { live, calls } = harness([MANIFEST, next]);
  live.start();
  await live.pollNow();
  calls.applied.length = 0;
  await live.pollNow();
  assert.deepEqual(calls.applied, ["quakes"]);
});

test("a newer satellite version raises one notice and is never applied silently", async () => {
  const next = clone(MANIFEST);
  next.feeds.satellites.version = "20261004T210000Z";
  for (const k of Object.keys(next.feeds.satellites.files)) next.feeds.satellites.files[k] = next.feeds.satellites.files[k].replace(MANIFEST.feeds.satellites.version, "20261004T210000Z");
  const { live, calls } = harness([MANIFEST, next, next], { loaded: { satellites: MANIFEST.feeds.satellites.version } });
  live.start();
  await live.pollNow();
  assert.deepEqual(calls.satellites, [], "the loaded version is the current one");
  await live.pollNow();
  assert.deepEqual(calls.satellites, ["20261004T210000Z"]);
  await live.pollNow();
  assert.equal(calls.satellites.length, 1);
  assert.ok(!calls.applied.includes("satellites"));
});

test("a failed manifest request keeps the app running and backs off, and recovery resets it", async () => {
  const { live, calls } = harness([MANIFEST, null, null, MANIFEST]);
  live.start();
  await live.pollNow();
  await live.pollNow();
  assert.equal(live.state().offline, true);
  assert.equal(live.state().failures, 1);
  await live.pollNow();
  assert.equal(live.state().failures, 2);
  assert.deepEqual(calls.scheduled.slice(-2), [600000, 1200000], "the wait doubles");
  await live.pollNow();
  assert.equal(live.state().offline, false);
  assert.equal(live.state().failures, 0);
  assert.equal(calls.scheduled.at(-1), 300000);
});

test("one feed that fails to load does not stop the others and is retried on the next poll", async () => {
  let failQuakes = true;
  const { live, calls } = harness([MANIFEST], { loadFeed: async (id, s) => { if (id === "quakes" && failQuakes) throw new Error("HTTP 404"); return { id }; } });
  live.start();
  await live.pollNow();
  assert.ok(calls.applied.includes("kp") && !calls.applied.includes("quakes"));
  assert.match(live.state().errors.quakes, /HTTP 404/);
  failQuakes = false;
  await live.pollNow();
  assert.ok(calls.applied.includes("quakes"));
  assert.equal(live.state().errors.quakes, undefined);
});

test("an apply that throws is recorded, not fatal", async () => {
  const calls = [];
  const live = createLive({ fetchFn: async () => ({ ok: true, json: async () => MANIFEST }), baselineTakenMs: BASE_TAKEN, loadFeed: async (id) => ({ id }),
    apply: (id) => { calls.push(id); if (id === "aurora") throw new Error("texture size"); }, timers: { set: () => 0, clear: () => {} } });
  live.start();
  await live.pollNow();
  assert.ok(calls.includes("kp") && calls.includes("planes"));
  assert.match(live.state().errors.aurora, /texture size/);
});

test("overlapping polls make one request, and a stopped poller makes none", async () => {
  const { live, calls } = harness([MANIFEST]);
  live.start();
  await Promise.all([live.pollNow(), live.pollNow(), live.pollNow()]);
  assert.equal(calls.fetches, 1);
  live.stop();
  await live.pollNow();
  assert.equal(calls.fetches, 1);
  assert.ok(calls.cleared >= 1);
});
