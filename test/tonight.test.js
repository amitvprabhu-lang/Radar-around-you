import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Astro from "astronomy-engine";
import * as C from "../src/core.js";
import * as G from "../src/sgp4.js";
import * as N from "../src/tonight.js";
import { kpAt } from "../src/info.js";
import { loadD } from "./helpers.js";

const D = loadD();
const precise = G.loadPrecise(JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8")));
const snap = new Date(Date.parse(D.meta.taken));
const placeOf = (id, patch = {}) => { const c = D.cities.find((x) => x.id === id); return { ...c, lat: Number(c.lat), lon: Number(c.lon), ...patch }; };
const run = (place, now = snap) => N.buildTonight({ D, precise, place, now, kp: kpAt(D.meta.kp, now.getTime()) });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} +- ${tol}, got ${a}`);
const withCloud = (place, pct) => ({ ...place, clouds: { ...place.clouds, hours: place.clouds.hours.map((h) => ({ ...h, cloud: pct })) } });

test("dark window starts and ends where the Sun crosses 6 degrees below the horizon", () => {
  for (const id of ["pune", "newyork", "london", "tromso", "tokyo", "sydney"]) {
    const p = placeOf(id);
    const w = N.darkWindow(p, snap);
    assert.ok(w, `${id} has a dark window`);
    assert.ok(w.end > w.start);
    for (let t = w.start.getTime(); t < w.end.getTime(); t += 20 * 60000) assert.ok(C.sunAltAz(p.lat, p.lon, new Date(t)).alt < -6 + 1e-9, `${id} dark inside the window`);
    if (!w.startsNow) assert.ok(C.sunAltAz(p.lat, p.lon, new Date(w.start.getTime() - 10 * 60000)).alt >= -6, `${id} not dark just before the start`);
    if (!w.truncated) assert.ok(C.sunAltAz(p.lat, p.lon, w.end).alt >= -6, `${id} not dark at the end`);
  }
});

test("no dark window under the midnight Sun, and the verdict says so", () => {
  const svalbard = { id: "sval", name: "Longyearbyen", lat: 78.2, lon: 15.6, tz: "Arctic/Longyearbyen", clouds: null };
  const july = new Date("2026-07-01T10:00:00Z");
  assert.equal(N.darkWindow(svalbard, july), null);
  const t = N.buildTonight({ D, precise, place: svalbard, now: july, kp: null });
  assert.equal(t.verdict.level, "none");
  assert.match(t.verdict.headline, /No real darkness/);
  assert.deepEqual(t.highlights, []);
});

test("tonight plans are complete, ordered and never in the past", () => {
  for (const id of ["pune", "newyork", "london", "tromso", "tokyo", "sydney"]) {
    const t = run(placeOf(id));
    assert.ok(["excellent", "good", "fair", "poor"].includes(t.verdict.level), id);
    assert.ok(t.verdict.headline.length > 5 && t.verdict.sentence.length > 20);
    assert.ok(t.verdict.score >= 0 && t.verdict.score <= 100);
    assert.ok(t.conditions.some((c) => c.kind === "dark") && t.conditions.some((c) => c.kind === "moon") && t.conditions.some((c) => c.kind === "weather"));
    let prev = 0;
    for (const it of t.items) {
      assert.ok(it.title && it.detail && it.tag && it.kind, `${id} ${it.id} has the fields the sheet shows`);
      assert.ok(it.time.getTime() >= prev, `${id} items in time order`);
      prev = it.time.getTime();
      if (it.kind === "pass" || it.kind === "train") assert.ok(it.end > snap, "a pass or string that is already over is not listed");
    }
    assert.ok(t.highlights.length <= 3);
    for (const h of t.highlights) assert.ok(t.items.includes(h));
  }
});

test("every listed pass is a real, lit, dark-sky, high-enough pass (checked independently with SGP4)", () => {
  let checked = 0;
  for (const id of ["pune", "newyork", "tokyo", "sydney"]) {
    const p = placeOf(id);
    for (const it of run(p).items.filter((i) => i.kind === "pass")) {
      const sat = precise.get(D.later.ids[it.target.idx]);
      const l = G.lookFrom(sat, it.time, p.lat, p.lon);
      assert.ok(l.el >= 14.5, `${id} ${it.name} at ${it.time.toISOString()} is ${l.el}° up`);
      for (const edge of [it.start, it.end]) { const e = G.lookFrom(sat, edge, p.lat, p.lon); assert.ok(e.sunlit && e.el >= 9, `${id} edge of the visible part is lit and above 9°`); }
      assert.ok(it.visibleSeconds > 20 && it.visibleSeconds <= 15 * 60);
      assert.ok(l.sunlit, "satellite in sunlight");
      assert.ok(C.sunAltAz(p.lat, p.lon, it.time).alt < -6, "sky dark");
      near(l.el, it.maxEl, 1.0, "peak elevation shown");
      assert.ok(it.remind.url.startsWith("https://calendar.google.com/"));
      checked++;
    }
  }
  assert.ok(checked >= 3, `checked ${checked} passes`);
});

test("planet entries match astronomy-engine", () => {
  const p = placeOf("pune");
  const t = run(p);
  const planets = t.items.filter((i) => i.kind === "planet");
  assert.ok(planets.length >= 2);
  const obs = new Astro.Observer(p.lat, p.lon, 0);
  for (const it of planets) {
    const eq = Astro.Equator(Astro.Body[it.title], it.time, obs, true, true);
    const hz = Astro.Horizon(it.time, obs, eq.ra, eq.dec, "normal");
    near(hz.altitude, it.sky.alt, 0.01, `${it.title} altitude at its peak`);
    assert.ok(hz.altitude >= 15, `${it.title} is high enough to bother with`);
  }
  assert.ok(planets.some((x) => x.title === "Jupiter") && planets.some((x) => x.title === "Saturn"), "October 2026 evening and night sky from Pune has Saturn and Jupiter");
});

test("meteor showers by date", () => {
  const names = (iso) => N.showersOn(new Date(iso)).map((s) => s.name);
  assert.ok(names("2026-10-04T12:00:00Z").includes("Orionids") && names("2026-10-04T12:00:00Z").includes("Southern Taurids"));
  assert.ok(!names("2026-10-04T12:00:00Z").includes("Draconids"), "Draconids start on 6 Oct");
  assert.ok(names("2027-01-03T12:00:00Z").includes("Quadrantids"), "range that runs over New Year");
  assert.ok(names("2026-12-31T12:00:00Z").includes("Quadrantids"));
  assert.ok(names("2026-08-12T12:00:00Z").includes("Perseids"));
  assert.deepEqual(names("2026-03-01T12:00:00Z"), [], "nothing active at the start of March");
  for (const s of N.SHOWERS) assert.ok(s.zhr > 0 && s.ra >= 0 && s.ra < 360 && Math.abs(s.dec) <= 90 && s.peak.length === 2);
});

test("meteor showers are only listed close to their peak", () => {
  const near = (iso) => N.showersNearPeak(new Date(iso)).map((s) => s.name);
  assert.deepEqual(near("2026-10-04T12:00:00Z"), [], "Orionids and Southern Taurids are active on 4 Oct but 17 and 6 days from peak");
  assert.ok(near("2026-10-20T12:00:00Z").includes("Orionids"));
  assert.ok(near("2026-10-24T12:00:00Z").includes("Orionids"), "3 days after the peak still counts");
  assert.ok(!near("2026-10-25T12:00:00Z").includes("Orionids"), "4 days after does not");
  assert.ok(near("2026-12-31T12:00:00Z").includes("Quadrantids") && near("2027-01-05T12:00:00Z").includes("Quadrantids"), "peak across New Year");
  assert.ok(!near("2027-01-10T12:00:00Z").includes("Quadrantids"));
  assert.equal(N.daysFromPeak(new Date("2026-08-12T23:59:00Z"), N.SHOWERS.find((s) => s.name === "Perseids")), 0);
  for (const iso of ["2026-10-04", "2026-10-20", "2026-12-14"]) for (const s of N.showersNearPeak(new Date(iso + "T12:00:00Z"))) assert.ok(N.showersOn(new Date(iso + "T12:00:00Z")).includes(s), "near peak implies active");
});

test("verdict follows the cloud: cloudy is poor, clear is good, and the reason is stated", () => {
  const pune = placeOf("pune");
  const clear = run(withCloud(pune, 0));
  const cloudy = run(withCloud(pune, 100));
  assert.ok(["excellent", "good"].includes(clear.verdict.level));
  assert.equal(cloudy.verdict.level, "poor");
  assert.match(cloudy.verdict.headline, /Cloudy/);
  assert.ok(clear.verdict.score > cloudy.verdict.score);
  assert.equal(cloudy.cloud.avg, 100);
  assert.equal(clear.cloud.min, 0);
  // events hidden by cloud are still listed but ranked lower and say so
  const cl = cloudy.items.filter((i) => i.kind === "pass" || i.kind === "train");
  for (const it of cl) assert.match(it.detail, /Cloud then about 100%/);
  const nofc = run({ ...pune, clouds: null });
  assert.equal(nofc.cloud.known, false);
  assert.match(nofc.conditions.find((c) => c.kind === "weather").title, /not available/);
});

test("aurora appears for Tromsø and not for Pune", () => {
  const tr = run(placeOf("tromso"));
  const a = tr.items.find((i) => i.kind === "aurora");
  assert.ok(a, "Tromsø gets an aurora entry");
  assert.match(a.title, /Aurora chance about \d+%/);
  assert.equal(tr.aurora.chance, parseInt(a.title.match(/(\d+)%/)[1], 10));
  assert.equal(run(placeOf("pune")).items.find((i) => i.kind === "aurora"), undefined);
});

test("when text uses a weekday only when the day differs", () => {
  const tz = "Asia/Kolkata";
  const ref = new Date("2026-10-04T16:00:00Z");
  assert.equal(N.whenText(new Date("2026-10-04T17:00:00Z"), ref, tz), "22:30");
  assert.match(N.whenText(new Date("2026-10-05T03:00:00Z"), ref, tz), /^Mon 5 Oct 08:30$/);
});

test("building the plan is quick enough to run on a click", () => {
  const t0 = Date.now();
  for (const id of ["pune", "newyork", "tokyo"]) run(placeOf(id));
  assert.ok(Date.now() - t0 < 4000, `three plans took ${Date.now() - t0} ms`);
});

test("visible part of a pass leaves out the stretch in Earth's shadow", () => {
  const track = [0, 20, 40, 60, 80, 100].map((s, i) => ({ time: new Date(1e12 + s * 1000), el: [10, 20, 30, 40, 30, 20][i], az: i * 10, lit: [false, false, true, true, true, false][i] }));
  const pass = { rise: track[0].time, set: track[5].time, track };
  const v = N.visiblePart(pass);
  assert.equal(v.first.time.getTime(), 1e12 + 40000);
  assert.equal(v.last.time.getTime(), 1e12 + 80000);
  assert.equal(v.best.el, 40);
  assert.equal(v.fadesIn, true);
  assert.equal(v.fadesOut, false, "only 20 s of the pass remain after the last lit sample, so it simply sets");
  const early = N.visiblePart({ rise: track[0].time, set: new Date(1e12 + 300000), track });
  assert.equal(early.fadesOut, true, "a long stretch of pass left after the last lit sample means it fades into shadow");
  assert.equal(v.seconds, 60);
  assert.equal(N.visiblePart({ rise: track[0].time, set: track[1].time, track: track.slice(0, 2) }), null, "no lit sample, no visible part");
});

test("date text never carries a comma, whatever the engine's locale data does", () => {
  assert.equal(N.fmtDay(new Date("2026-10-05T03:00:00Z"), "Asia/Kolkata"), "Mon 5 Oct");
  assert.equal(N.fmtDay(new Date("2026-10-04T23:30:00Z"), "Asia/Kolkata"), "Mon 5 Oct", "after local midnight it is already the next day");
  assert.equal(N.fmtDay(new Date("2026-12-31T20:00:00Z"), "Pacific/Auckland"), "Fri 1 Jan");
  const t = run(placeOf("pune"));
  assert.match(t.conditions.find((c) => c.kind === "dark").title, /^Dark (now, until|from) /);
  assert.match(t.conditions.find((c) => c.kind === "weather").title, /^Cloud: \d+%( all night| to \d+% overnight)$/);
});
