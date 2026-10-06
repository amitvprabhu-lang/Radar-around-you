import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCore, loadLater, loadFeedData, loadCoreThenTextures } from "../src/data.js";
import { loadManifest } from "../src/live.js";
import { livePack } from "./livepack.js";

const pub = new URL("../public/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, pub));
const baseMeta = JSON.parse(read("meta.json"));
const LIVE_TAKEN = "2026-10-04T19:00:00Z";

// A fake network: the bundled files, plus an optional pretend live folder.
function network(extra = {}, { fail = [] } = {}) {
  const files = new Map();
  for (const f of fs.readdirSync(pub, { recursive: true })) {
    const p = String(f);
    if (fs.statSync(new URL(p, pub)).isFile()) files.set(p, read(p));
  }
  for (const [k, v] of Object.entries(extra)) files.set(k, Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
  const requested = [];
  const fetchFn = async (url) => {
    requested.push(url);
    const body = files.get(url);
    if (!body || fail.includes(url)) return { ok: false, status: 404 };
    const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8"), arrayBuffer: async () => buf };
  };
  return { fetchFn, requested, files };
}

const livePackFiles = (opts) => livePack(opts).files;

async function core(net, manifestFetch) {
  globalThis.fetch = net.fetchFn;
  return loadCore(() => {}, manifestFetch || ((base, ms) => loadManifest(net.fetchFn, base, ms)));
}

test("with no live folder the bundled snapshot is used, exactly as before", async () => {
  const net = network();
  const c = await core(net);
  assert.deepEqual(c.live.used, {});
  assert.deepEqual(c.live.fellBack, []);
  assert.equal(c.live.manifest, null);
  assert.equal(c.meta.taken, baseMeta.taken);
  assert.equal(c.meta.count, baseMeta.count);
  assert.deepEqual(c.meta.kp, baseMeta.kp);
  assert.equal(c.quakes.events.length, JSON.parse(read("quakes.json")).events.length);
  assert.ok(net.requested.includes("live/manifest.json"), "it asked for the manifest and got a 404");
  assert.ok(!net.requested.some((u) => u.startsWith("live/") && u !== "live/manifest.json"));
});

test("a complete live set replaces the snapshot, feed by feed", async () => {
  const net = network(livePackFiles());
  const c = await core(net);
  assert.deepEqual(Object.keys(c.live.used).sort(), ["aurora", "closeapproaches", "clouds", "events", "fires", "kp", "launches", "planes", "quakes", "satellites", "spaceweather", "storms"]);
  assert.deepEqual(c.live.fellBack, []);
  assert.equal(c.meta.taken, LIVE_TAKEN, "the satellite group's own fetch time drives the clock");
  assert.equal(c.meta.count, baseMeta.count);
  assert.deepEqual(c.meta.starNames, baseMeta.starNames, "static fields still come from the bundled meta");
  assert.deepEqual(c.meta.kp, [{ t: "2026-10-04T15:00:00", kp: 6.33 }]);
  assert.equal(c.meta.aurora.observation, LIVE_TAKEN);
  assert.equal(c.aurora[100], 77);
  assert.equal(c.quakes.generated, "LIVE");
  assert.equal(c.events[0].name, "Storm");
  const pune = c.cities.find((x) => x.id === "pune"), london = c.cities.find((x) => x.id === "london");
  assert.equal(pune.clouds.hours[0].cloud, 11);
  assert.equal(london.planes.aircraft[0].hex, "abc123");
  assert.ok(pune.planes.aircraft.length > 0, "a place with no live aircraft keeps its snapshot aircraft");
  assert.deepEqual(c.hazards.storms.storms.map((x) => x.name), ["Rachel", "Nolo"]);
  assert.equal(c.hazards.fires.n, c.hazards.fires.summary.cells, "fire cells are decoded, one per record");
  assert.ok(c.hazards.space.points.length > 60 && c.hazards.space.alerts.length > 0);
  assert.equal(c.hazards.close.approaches.length, 31);
  assert.equal(c.swarmRaw.f32.length, baseMeta.count * 2);
  assert.ok(net.requested.includes("live/satellites/v1/swarm.bin"));
  assert.ok(!net.requested.includes("swarm.bin"), "the snapshot swarm is not downloaded when the live one worked");
});

test("without a live copy the storm, fire and solar wind data are simply absent", async () => {
  const c = await core(network({}));
  assert.deepEqual(c.hazards, { storms: null, fires: null, space: null, close: null, launches: null });
});

test("a live file that fails falls back to the snapshot and says so", async () => {
  const net = network(livePackFiles(), { fail: ["live/quakes/v1/quakes.json", "live/aurora/v1/aurora.json"] });
  const c = await core(net);
  assert.deepEqual(c.live.fellBack.sort(), ["aurora", "quakes"]);
  assert.equal(c.quakes.generated, JSON.parse(read("quakes.json")).generated);
  assert.equal(c.meta.aurora.observation, baseMeta.aurora.observation, "the whole aurora product falls back together");
  assert.equal(c.aurora[100], read("aurora.bin")[100], "grid and times never come from different builds");
  assert.equal(c.live.used.kp, "v1", "other feeds are unaffected");
});

test("a satellite group with a failing file falls back as a whole", async () => {
  const net = network(livePackFiles(), { fail: ["live/satellites/v1/satmeta.json"] });
  const c = await core(net);
  assert.ok(c.live.fellBack.includes("satellites"));
  assert.equal(c.live.used.satellites, undefined);
  assert.equal(c.meta.taken, baseMeta.taken);
  const later = await loadLater(c.live);
  assert.ok(net.requested.includes("names.txt") && !net.requested.some((u) => u.startsWith("live/satellites/v1/names")), "second stage follows the same source as the swarm");
  assert.equal(later.ids.length, baseMeta.count);
});

test("live data older than the snapshot is ignored", async () => {
  const net = network(livePackFiles({ taken: "2026-10-03T00:00:00Z" }));
  const c = await core(net);
  assert.deepEqual(c.live.used, {});
  assert.equal(c.meta.taken, baseMeta.taken);
});

test("a manifest without a complete satellite group leaves the satellites on the snapshot but still applies the other feeds", async () => {
  const net = network(livePackFiles({ withSatellites: false }));
  const c = await core(net);
  assert.equal(c.live.used.satellites, undefined);
  assert.equal(c.live.used.quakes, "v1");
  assert.equal(c.meta.taken, baseMeta.taken);
  assert.deepEqual(c.meta.kp, [{ t: "2026-10-04T15:00:00", kp: 6.33 }]);
});

test("the second stage reads the live satellite files when the swarm came from live", async () => {
  const net = network(livePackFiles());
  const c = await core(net);
  const later = await loadLater(c.live);
  assert.ok(net.requested.includes("live/satellites/v1/names.txt"));
  assert.ok(net.requested.includes("live/satellites/v1/ids.bin"));
  assert.ok(net.requested.includes("live/satellites/v1/details.bin"));
  assert.ok(net.requested.includes("live/satellites/v1/precise.json"));
  assert.equal(later.names.length, baseMeta.count);
  assert.equal(later.details.length, baseMeta.count * 8);
  assert.ok(net.requested.includes("impact.json"), "static data still comes from the bundle");
});

test("the second stage reads the star details, and the app still works when that file is missing", async () => {
  const net = network({});
  const c = await core(net);
  const later = await loadLater(c.live);
  assert.ok(net.requested.includes("stardetails.json"));
  assert.ok(later.starDetails && Object.keys(later.starDetails.stars).length > 5000);
  const broken = network({}, { fail: ["stardetails.json"] });
  const later2 = await loadLater((await core(broken)).live);
  assert.equal(later2.starDetails, null, "no details, but nothing else is lost");
  assert.equal(later2.starInfo.size, later.starInfo.size);
  assert.equal(later2.names.length, baseMeta.count);
});

test("the poller's decoders return what the app expects", async () => {
  const net = network(livePackFiles());
  globalThis.fetch = net.fetchFn;
  const paths = (id) => ({ paths: Object.fromEntries(Object.entries(JSON.parse(net.files.get("live/manifest.json")).feeds[id].files).map(([n, p]) => [n, "live/" + p])) });
  const a = await loadFeedData("aurora", paths("aurora"));
  assert.ok(a.grid instanceof Uint8Array && a.grid.length === 360 * 181 && a.grid[100] === 77);
  assert.equal(a.meta.observation, LIVE_TAKEN);
  assert.equal((await loadFeedData("quakes", paths("quakes"))).generated, "LIVE");
  assert.equal((await loadFeedData("kp", paths("kp")))[0].kp, 6.33);
  assert.ok((await loadFeedData("clouds", paths("clouds"))).cities.pune);
  assert.ok((await loadFeedData("planes", paths("planes"))).cities.london);
  await assert.rejects(loadFeedData("satellites", {}), /no loader/);
});

// The textures (about 640 KB) must never compete with the live manifest: loadCore gives it 2.5 s before falling back to the snapshot.
test("the textures start only after the live manifest has arrived", async () => {
  const net = network(livePackFiles());
  globalThis.fetch = net.fetchFn;
  const order = [];
  let answer;
  const gate = new Promise((r) => { answer = r; });
  // the manifest's own fetch, held back until the test lets it go
  const manifestFetch = async (url, init) => { order.push(`manifest asked (${init && init.cache})`); await gate; order.push("manifest arrived"); return net.fetchFn(url, init); };
  const { core: corePromise, textures } = loadCoreThenTextures(() => {}, async () => { order.push("textures start"); return "maps"; }, manifestFetch);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ["manifest asked (no-store)"], "the textures wait while the manifest is on its way");
  answer();
  assert.equal(await textures, "maps");
  assert.deepEqual(order, ["manifest asked (no-store)", "manifest arrived", "textures start"]);
  const c = await corePromise;
  assert.equal(Object.keys(c.live.used).length, 12, "and the live set is used");
});

test("the textures also start when the manifest fails, times out or the core load fails", async () => {
  // a manifest that fails at once (no live folder)
  const net = network();
  globalThis.fetch = net.fetchFn;
  let started = 0;
  const a = loadCoreThenTextures(() => {}, async () => { started++; }, net.fetchFn);
  await a.textures; await a.core;
  assert.equal(started, 1);
  // a manifest fetch that throws
  const b = loadCoreThenTextures(() => {}, async () => { started++; }, async () => { throw new TypeError("offline"); });
  await b.textures; await b.core;
  assert.equal(started, 2);
  // the whole core load failing (meta.json missing) still releases the textures, and the failure reaches the awaited promise
  const bad = network({}, { fail: ["meta.json"] });
  globalThis.fetch = bad.fetchFn;
  const c = loadCoreThenTextures(() => {}, async () => { started++; }, async () => new Promise(() => {}));
  await assert.rejects(c.core, /meta\.json/);
  await c.textures;
  assert.equal(started, 3);
});
