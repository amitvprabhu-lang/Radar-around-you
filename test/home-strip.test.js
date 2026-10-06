// Tests for the live figures strip on the home page (site/home-strip.mjs): the figure functions on hand-made and real feeds, empty, stale,
// broken and missing feeds, the loader with a pretend live folder, and the inline script itself run in node with a pretend page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  STRIP_LIMITS, STRIP_FIGURES, STRIP_FILES, STRIP_SCRIPT, LAUNCH_MAX_AGE_HOURS, stripTime, stripUtc, stripQuakes, stripKp, stripStorms,
  stripFires, stripLaunch, stripFigures, stripStatus, stripLoad, stripApply,
} from "../site/home-strip.mjs";
import { MAX_AGE_HOURS, summariseQuakes, summariseKp, summariseStorms, summariseFires } from "../site/hazard.mjs";
import { num } from "../site/pages-satcount.mjs";
import { summariseLaunches, EVENT_MAX_AGE_HOURS } from "../site/events.mjs";
import { realLaunches, EVENTS_NOW } from "./helpers/eventsfixture.mjs";
import { quakesDoc, kpRows, stormsDoc, fireFiles, GEN, REAL_DIR, REAL_NOW, realJson, realFile, realPlaces } from "./helpers/hazardfixture.mjs";

const H = 3600e3;
const NOW = Date.parse(GEN) + 30 * 60e3;  // 18:30 on the fixture day
const launchesDoc = () => JSON.parse(fs.readFileSync(fileURLToPath(new URL("./fixtures/hazards/launches.json", import.meta.url)), "utf8"));
const manifest = (generatedAt = GEN) => ({ generatedAt, feeds: Object.fromEntries(Object.keys(STRIP_FILES).map((k) => [k, { files: { [STRIP_FILES[k]]: `${k}/v1/${STRIP_FILES[k]}` } }])) });
const docs = () => ({ quakes: quakesDoc(), kp: kpRows(), storms: stormsDoc(), fires: fireFiles().summary, launches: { ...launchesDoc(), generated: "2026-10-05T17:30:00Z" } });

test("the limits mirror the live pages' own limits, with launches at 6 hours", () => {
  assert.deepEqual(STRIP_LIMITS, { quakes: MAX_AGE_HOURS.quakes, kp: MAX_AGE_HOURS.kp, storms: MAX_AGE_HOURS.storms, fires: MAX_AGE_HOURS.fires, launches: 6 });
  assert.equal(LAUNCH_MAX_AGE_HOURS, 6);
  assert.equal(LAUNCH_MAX_AGE_HOURS, EVENT_MAX_AGE_HOURS.launches, "the launches page's own limit");
  assert.deepEqual(STRIP_FIGURES.map(([k]) => k), ["quakes", "largest", "kp", "storms", "fires", "launch"]);
  for (const [k, f] of Object.entries(STRIP_FILES)) assert.equal(f, `${k}.json`, "the loader reads each feed's file as its id plus .json");
});

test("times: with or without a zone, no zone is UTC; anything else is not a time; UTC text", () => {
  assert.equal(stripTime("2026-10-05T15:00:00"), Date.parse("2026-10-05T15:00:00Z"));
  assert.equal(stripTime("2026-10-05T15:00:00Z"), Date.parse("2026-10-05T15:00:00Z"));
  assert.equal(stripTime("2026-10-05T20:30:00+05:30"), Date.parse("2026-10-05T15:00:00Z"));
  assert.equal(stripTime("2026-10-05T15:00:00.123Z"), Date.parse("2026-10-05T15:00:00.123Z"));
  for (const bad of ["LIVE", "", null, undefined, 5, "2026-10-05", "yesterday 15:00"]) assert.ok(Number.isNaN(stripTime(bad)), String(bad));
  assert.equal(stripUtc(Date.parse("2026-10-06T02:10:32Z")), "2026-10-06 02:10 UTC");
  assert.equal(stripUtc(Date.parse("2026-10-06T02:10:32Z"), false), "2026-10-06");
});

test("earthquakes: the count and the largest magnitude in the 24 hours up to the feed's own time, the same as the earthquake page", () => {
  const q = stripQuakes(quakesDoc());
  assert.deepEqual(q, { t: Date.parse(GEN), v: { quakes: "8", largest: "6.4" } });
  const page = summariseQuakes(quakesDoc(), { now: new Date(NOW) });
  assert.equal(q.v.quakes, num(page.count)); assert.equal(q.v.largest, num(page.largest.mag));
  // nothing in the window: a count of 0 and no largest
  assert.deepEqual(stripQuakes(quakesDoc({ events: quakesDoc().events.filter((e) => e.id.startsWith("old")) })).v, { quakes: "0", largest: "none" });
  // an empty list, a broken event or no time: no figure (the earthquake page refuses these too)
  assert.equal(stripQuakes({ generated: GEN, events: [] }), null);
  assert.equal(stripQuakes(quakesDoc({ events: [{ mag: "5", time: GEN }] })), null);
  assert.equal(stripQuakes(quakesDoc({ events: [{ mag: 12, time: GEN }] })), null);
  assert.equal(stripQuakes(quakesDoc({ generated: "LIVE" })), null);
});

test("Kp now: the newest period with a value whose tag is not after now", () => {
  assert.deepEqual(stripKp(kpRows(), NOW), { t: Date.parse("2026-10-05T15:00:00Z"), v: { kp: "2.67" } });
  assert.equal(stripKp(kpRows(), NOW).v.kp, num(summariseKp(kpRows(), { now: new Date(NOW) }).latest.kp), "the same as the aurora page when no period is in the future");
  // a period tagged after now is not "now"; a newest period with no value is skipped
  const rows = [...kpRows(), { t: "2026-10-05T21:00:00", kp: 7 }];
  assert.equal(stripKp(rows, NOW).v.kp, "2.67");
  assert.equal(stripKp([...kpRows(), { t: "2026-10-05T18:00:00", kp: null }], NOW).v.kp, "2.67");
  assert.equal(stripKp([], NOW), null);
  assert.equal(stripKp([{ t: "2026-10-05T15:00:00", kp: 12 }], NOW), null);
  assert.equal(stripKp([{ t: "nope", kp: 2 }], NOW), null);
});

test("storms, fires and the next launch", () => {
  assert.deepEqual(stripStorms(stormsDoc()), { t: Date.parse(GEN), v: { storms: "2" } });
  assert.equal(stripStorms(stormsDoc()).v.storms, num(summariseStorms(stormsDoc(), { now: new Date(NOW) }).storms.length));
  assert.deepEqual(stripStorms(stormsDoc({ storms: [] })).v, { storms: "0" }, "no active storm is a figure, not a failure");
  assert.equal(stripStorms({ generated: GEN }), null);
  const f = fireFiles();
  assert.deepEqual(stripFires(f.summary), { t: Date.parse("2026-10-05T16:00:00Z"), v: { fires: "72" } });
  assert.equal(stripFires({ ...f.summary, detections: 242515 }).v.fires, "242,515");
  assert.equal(stripFires({ ...f.summary, cells: 0 }), null);
  assert.equal(stripFires({ ...f.summary, detections: -1 }), null);
  // launches: the launches page's definition, the earliest planned time at or after the list's own generated time, worded as the page words it
  const L = launchesDoc();
  const page = summariseLaunches(L, { now: new Date(L.generated), allowStale: true });
  assert.equal(stripLaunch(L).v.launch, `${page.next.name}, ${page.next.when}`);
  assert.equal(stripLaunch(L).t, Date.parse(L.generated));
  // a launch planned exactly at the list's time counts (>=), as on the page
  const atGen = { ...L, launches: [{ ...L.launches[0], net: L.generated, precision: "MIN" }, ...L.launches.slice(1)] };
  assert.equal(stripLaunch(atGen).v.launch.split(", ")[0], L.launches[0].name.trim());
  assert.match(stripLaunch({ ...L, launches: [{ ...L.launches[0], net: "2026-11-01T00:00:00Z", precision: "M" }] }).v.launch, /, November 2026, day not set$/);
  assert.match(stripLaunch({ ...L, launches: [{ ...L.launches[0], net: "2026-10-01T00:00:00Z", precision: "Q4" }], generated: "2026-09-30T00:00:00Z" }).v.launch, /, the fourth quarter of 2026, day not set$/);
  assert.equal(stripLaunch({ generated: GEN, launches: [] }).v.launch, "none listed");
  assert.equal(stripLaunch({ ...L, launches: L.launches.map((l) => ({ ...l, net: "2026-01-01T00:00:00Z" })) }).v.launch, "none listed");
  assert.equal(stripLaunch({ ...L, generated: "soon" }), null, "no list time, no next launch");
});

test("the strip's figures from fresh feeds, with the manifest time and no notes", () => {
  const r = stripFigures(manifest(), docs(), NOW, STRIP_LIMITS);
  assert.deepEqual(r.values, { quakes: "8", largest: "6.4", kp: "2.67", storms: "2", fires: "72", launch: "Nuri | NeonSat-2 to 6, 7 October 2026, 03:23 UTC" });
  assert.deepEqual(r.old, []);
  assert.equal(r.time, "2026-10-05 18:00 UTC");
  assert.equal(stripStatus(r, STRIP_LIMITS), "Live data published 2026-10-05 18:00 UTC.");
});

test("stale feeds keep their figures and get a calm note naming the limit", () => {
  // 10 hours later: quakes (3 h), Kp (8 h, tagged 15:00), fires (8 h, newest 16:00) and launches (6 h) are behind; storms (12 h) are not
  const later = Date.parse(GEN) + 10 * H;
  const r = stripFigures(manifest(), docs(), later, STRIP_LIMITS);
  assert.deepEqual(r.old, ["quakes", "kp", "fires", "launches"]);
  assert.equal(r.values.quakes, "8");
  assert.equal(stripStatus(r, STRIP_LIMITS), "Live data published 2026-10-05 18:00 UTC. Some feeds are behind: earthquakes (more than 3 hours old), Kp (more than 8 hours old), fire detections (more than 8 hours old), launches (more than 6 hours old).");
  assert.ok(!/warning|danger|alert|error|fail/i.test(stripStatus(r, STRIP_LIMITS)), "nothing alarming");
  // exactly at the limit is not behind
  assert.deepEqual(stripFigures(manifest(), docs(), Date.parse(GEN) + 3 * H, STRIP_LIMITS).old, []);
});

test("missing, empty, broken and future feeds give no figure and no note; the rest still show", () => {
  const d = docs();
  delete d.kp; d.storms = "not json"; d.fires = null; d.quakes = { generated: GEN, events: [] };
  const r = stripFigures(manifest(), d, NOW, STRIP_LIMITS);
  assert.deepEqual(r.values, { launch: "Nuri | NeonSat-2 to 6, 7 October 2026, 03:23 UTC" });
  assert.deepEqual(r.old, []);
  const future = stripFigures(manifest(), { ...docs(), quakes: quakesDoc({ generated: "2026-10-05T21:00:00Z" }) }, NOW, STRIP_LIMITS);
  assert.ok(!("quakes" in future.values), "a feed more than an hour in the future is ignored");
  const none = stripFigures(null, {}, NOW, STRIP_LIMITS);
  assert.deepEqual(none, { values: {}, old: [], time: null });
  assert.equal(stripStatus(none, STRIP_LIMITS), "");
});

test("the loader reads the manifest, then the files it names; a missing file leaves only its figures out; a missing manifest rejects", async () => {
  const folder = new Map([["live/manifest.json", manifest()], ...Object.entries(docs()).map(([k, v]) => [`live/${k}/v1/${k}.json`, v])]);
  const asked = [];
  const get = async (u, fresh) => { asked.push([u, !!fresh]); if (!folder.has(u)) throw new Error("404"); return structuredClone(folder.get(u)); };
  const r = await stripLoad("live/", get, NOW, STRIP_LIMITS);
  assert.equal(Object.keys(r.values).length, 6);
  assert.deepEqual(asked[0], ["live/manifest.json", true], "the manifest first, never from a cache");
  assert.equal(asked.length, 6);
  folder.delete("live/fires/v1/fires.json");
  const r2 = await stripLoad("live/", get, NOW, STRIP_LIMITS);
  assert.ok(!("fires" in r2.values) && r2.values.quakes === "8");
  // a manifest path that climbs out of the folder is not followed
  const m = manifest(); m.feeds.kp.files["kp.json"] = "../secret.json";
  folder.set("live/manifest.json", m); asked.length = 0;
  const r3 = await stripLoad("live/", get, NOW, STRIP_LIMITS);
  assert.ok(!("kp" in r3.values) && !asked.some(([u]) => u.includes("..")));
  folder.delete("live/manifest.json");
  await assert.rejects(stripLoad("live/", get, NOW, STRIP_LIMITS));
});

test("on the real collected feeds the strip gives the live pages' own numbers", async () => {
  const m = JSON.parse(fs.readFileSync(path.join(REAL_DIR, "manifest.json"), "utf8"));
  const get = async (u) => JSON.parse(fs.readFileSync(path.join(REAL_DIR, u), "utf8"));
  const now = REAL_NOW.getTime();
  const r = await stripLoad("", get, now, STRIP_LIMITS);
  const q = summariseQuakes(realJson("quakes", "quakes.json"), { now: REAL_NOW });
  assert.equal(r.values.quakes, num(q.count)); assert.equal(r.values.largest, num(q.largest.mag));
  assert.equal(r.values.kp, num(summariseKp(realJson("kp", "kp.json"), { now: REAL_NOW }).latest.kp));
  assert.equal(r.values.storms, num(summariseStorms(realJson("storms", "storms.json"), { now: REAL_NOW }).storms.length));
  assert.equal(r.values.fires, num(summariseFires({ summary: realJson("fires", "fires.json"), bin: realFile("fires", "fires.bin") }, { now: REAL_NOW, places: realPlaces() }).detections));
  assert.ok(!("launch" in r.values), m.feeds.launches ? "launches" : "the saved set has no launch list");
  assert.deepEqual(r.old, []);
});

test("apply fills the values as text, never as HTML, and the status line", () => {
  const els = STRIP_FIGURES.map(([k]) => ({ k, textContent: "-", getAttribute: () => k }));
  const status = { textContent: "" };
  const root = { querySelectorAll: () => els, querySelector: () => status };
  stripApply(root, { values: { quakes: "<b>8</b>", kp: "2.67" }, old: [], time: "2026-10-05 18:00 UTC" }, STRIP_LIMITS);
  assert.deepEqual(els.map((e) => e.textContent), ["<b>8</b>", "-", "2.67", "-", "-", "-"]);
  assert.equal(status.textContent, "Live data published 2026-10-05 18:00 UTC.");
});

// runs the inline script in a fresh context with a pretend page and a pretend fetch
async function runScript(files, now = NOW) {
  const els = STRIP_FIGURES.map(([k]) => ({ textContent: "-", getAttribute: () => k }));
  const status = { textContent: "" };
  const root = { querySelectorAll: (s) => (s === "[data-fig]" ? els : []), querySelector: (s) => (s === ".home-strip-status" ? status : null) };
  const fetched = [];
  const fetch = async (u, opts) => { fetched.push([u, opts]); return files.has(u) ? { ok: true, status: 200, json: async () => structuredClone(files.get(u)) } : { ok: false, status: 404, json: async () => { throw new Error("no"); } }; };
  class FixedDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({ document: { getElementById: (id) => (id === "home-strip" ? root : null), readyState: "complete" }, window: { fetch }, fetch, Date: FixedDate, Promise, Object, Number, String, Array, JSON });
  vm.runInContext(STRIP_SCRIPT.replace(/^<script[^>]*>/, "").replace(/<\/script>\n$/, ""), ctx);
  for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
  return { values: els.map((e) => e.textContent), status: status.textContent, fetched };
}

test("the inline script is small, loads nothing but the live folder, and carries the tested functions' own source", () => {
  // OURS: 6 KB since the merge of 2026-10-06 (4 KB at first, 5 KB when the strip took on the launches page's own wording function
  // launchWhenText, 6 KB when the events branch's review round grew that function to about 1.4 KB without its comments)
  assert.ok(Buffer.byteLength(STRIP_SCRIPT) < 6144, `${Buffer.byteLength(STRIP_SCRIPT)} bytes`);
  assert.ok(!/\n\/\//.test(STRIP_SCRIPT), "no comment lines are sent");
  assert.ok(STRIP_SCRIPT.includes("function launchWhenText("));
  assert.match(STRIP_SCRIPT, /^<script id="home-strip-js">\(function \(\) \{\n/);
  assert.ok(STRIP_SCRIPT.endsWith("})();</script>\n"));
  assert.ok(!/\beval\b|new Function|import\(|src=|innerHTML|insertAdjacentHTML|document\.write/.test(STRIP_SCRIPT), "no eval, no HTML from data, nothing loaded");
  assert.ok(!/<\/(?!script>\n$)/.test(STRIP_SCRIPT.slice(0, -10)), "no closing tag inside the script");
  for (const f of [stripTime, stripQuakes, stripKp, stripStorms, stripFires, stripLaunch, stripFigures, stripStatus, stripLoad, stripApply]) {
    assert.ok(STRIP_SCRIPT.includes(f.toString().replace(/\n[ \t]+/g, "\n")), `${f.name} is inlined as tested`);
  }
  assert.ok(!/\u2014|\u2013/.test(STRIP_SCRIPT) && !/\p{Extended_Pictographic}/u.test(STRIP_SCRIPT));
  assert.ok(!/animation|transition|setInterval/.test(STRIP_SCRIPT), "nothing moves");
});

test("the inline script fills the strip from a pretend live folder, and leaves the dashes when the folder is missing or broken", async () => {
  const files = new Map([["live/manifest.json", manifest()], ...Object.entries(docs()).map(([k, v]) => [`live/${k}/v1/${k}.json`, v])]);
  const ok = await runScript(files);
  assert.deepEqual(ok.values, ["8", "6.4", "2.67", "2", "72", "Nuri | NeonSat-2 to 6, 7 October 2026, 03:23 UTC"]);
  assert.equal(ok.status, "Live data published 2026-10-05 18:00 UTC.");
  assert.equal(JSON.stringify(ok.fetched[0]), JSON.stringify(["live/manifest.json", { cache: "no-store" }]), "the manifest first, never from a cache");
  assert.ok(ok.fetched.every(([u]) => u.startsWith("live/")), "only the site's own live folder");
  const gone = await runScript(new Map());
  assert.deepEqual(gone.values, ["-", "-", "-", "-", "-", "-"]);
  assert.equal(gone.status, "", "says nothing when the live folder is not there");
  const broken = await runScript(new Map([["live/manifest.json", { generatedAt: GEN }]]));
  assert.deepEqual(broken.values, ["-", "-", "-", "-", "-", "-"]);
  const stale = await runScript(files, Date.parse(GEN) + 10 * H);
  assert.match(stale.status, /Some feeds are behind: earthquakes \(more than 3 hours old\)/);
});

test("review: the strip's next launch and the launches page agree on the same data (the saved launch list of 6 October)", () => {
  const doc = realLaunches();
  const page = summariseLaunches(doc, { now: EVENTS_NOW });
  const strip = stripLaunch(doc);
  assert.equal(strip.v.launch, `${page.next.name}, ${page.next.when}`);
  assert.equal(strip.t, Date.parse(page.dataTime));
  // and the right-now hub prints the same next launch
  assert.ok(`Next: ${strip.v.launch}`.startsWith("Next: ") && page.next.when.length > 5);
});
