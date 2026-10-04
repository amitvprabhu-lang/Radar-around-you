import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Astro from "astronomy-engine";
import { skyCalendar, highlight, PAIR_MAX_SEPARATION_DEG, MIN_ELONGATION_DEG, HIGHLIGHT_MIN_ZHR } from "../src/calendar.js";
import { SHOWERS } from "../src/tonight.js";

const usno = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/usno/${f}`, import.meta.url), "utf8"));
const PUNE = { lat: 18.5204, lon: 73.8567 };
const FROM = new Date("2026-01-01T00:00:00Z");
const two = skyCalendar({ ...PUNE, from: FROM, days: 730 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usnoTime = (e) => Date.UTC(e.year, e.month - 1, e.day, ...e.time.split(":").map(Number));

// The US Naval Observatory's published tables (fetched from aa.usno.navy.mil/api on 2026-10-04, saved in test/fixtures/usno).
test("every Moon phase of 2026 and 2027 matches the USNO table to the minute", () => {
  const ours = two.events.filter((e) => e.kind === "moon");
  const names = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
  let n = 0;
  for (const y of [2026, 2027]) {
    for (const p of usno(`phases-${y}.json`).phasedata) {
      const want = usnoTime(p), q = names.indexOf(p.phase);
      assert.ok(q >= 0, p.phase);
      const e = ours.find((x) => x.quarter === q && Math.abs(x.time - want) < 12 * 3600000);
      assert.ok(e, `no ${p.phase} near ${p.year}-${p.month}-${p.day}`);
      assert.ok(Math.abs(e.time - want) <= 90000, `${p.phase} ${p.year}-${p.month}-${p.day}: ours ${e.time.toISOString()}, USNO ${p.time}`);
      n++;
    }
  }
  const total = usno("phases-2026.json").phasedata.length + usno("phases-2027.json").phasedata.length;
  assert.equal(n, total);
  assert.equal(ours.length, total, "and we list no extra phases");
});

test("equinoxes and solstices match the USNO table", () => {
  const ours = two.events.filter((e) => e.kind === "season");
  assert.equal(ours.length, 8);
  for (const y of [2026, 2027]) {
    for (const s of usno(`seasons-${y}.json`).data.filter((d) => d.phenom === "Equinox" || d.phenom === "Solstice")) {
      const want = usnoTime(s);
      const e = ours.find((x) => Math.abs(x.time - want) < 12 * 3600000);
      assert.ok(e, `${s.phenom} ${s.year}-${s.month}-${s.day}`);
      assert.ok(Math.abs(e.time - want) <= 90000, `${e.title} ${e.time.toISOString()} vs USNO ${s.time}`);
    }
  }
});

test("the solar eclipses of 2026 and 2027 match the USNO list by date and kind", () => {
  const ours = two.events.filter((e) => e.kind === "eclipse" && e.body === "sun");
  const want = [...usno("solar-2026.json").eclipses_in_year, ...usno("solar-2027.json").eclipses_in_year];
  assert.equal(ours.length, want.length);
  for (const w of want) {
    const kind = w.event.split(" ")[0].toLowerCase();
    const e = ours.find((x) => x.time.getUTCFullYear() === w.year && x.time.getUTCMonth() === w.month - 1 && x.time.getUTCDate() === w.day);
    assert.ok(e, w.event);
    assert.equal(e.eclipseKind, kind, w.event);
  }
});

test("lunar eclipses happen at a Full Moon, and their visibility flag follows the Moon's altitude", () => {
  const full = two.events.filter((e) => e.kind === "moon" && e.quarter === 2);
  const lunar = two.events.filter((e) => e.kind === "eclipse" && e.body === "moon");
  assert.ok(lunar.length >= 2 && lunar.length <= 8, String(lunar.length));
  const obs = new Astro.Observer(PUNE.lat, PUNE.lon, 0);
  for (const e of lunar) {
    assert.ok(full.some((f) => Math.abs(f.time - e.time) < 3 * 3600000), `${e.title} ${e.time.toISOString()}`);
    const eq = Astro.Equator(Astro.Body.Moon, e.time, obs, true, true);
    assert.equal(e.visible, Astro.Horizon(e.time, obs, eq.ra, eq.dec, "normal").altitude > 0);
    assert.ok(["penumbral", "partial", "total"].includes(e.eclipseKind));
  }
});

test("a solar eclipse is only marked visible when the Sun is up from the place", () => {
  const eclipse = two.events.find((e) => e.kind === "eclipse" && e.body === "sun");
  for (const place of [{ lat: 28, lon: -15 }, { lat: -75, lon: 100 }, PUNE]) {  // somewhere near the 2026 track, the far south, and Pune
    const r = skyCalendar({ ...place, from: new Date(eclipse.time.getTime() - 5 * 86400000), days: 10 });
    const e = r.events.find((x) => x.kind === "eclipse" && x.body === "sun");
    assert.ok(e);
    if (e.visible) assert.match(e.detail, /Visible from here/);
    else assert.match(e.detail, /Not visible|below your horizon/);
  }
  const spain = skyCalendar({ lat: 41.4, lon: -4, from: new Date("2026-08-05T00:00:00Z"), days: 14 }).events.find((x) => x.kind === "eclipse" && x.body === "sun");
  assert.ok(spain.visible, "the total eclipse of 12 August 2026 is visible from northern Spain");
  assert.match(spain.detail, /\d+% of the Sun is covered/);
});

test("oppositions: the planet is opposite the Sun when the event says so", () => {
  const opp = two.events.filter((e) => e.title.endsWith("at opposition"));
  assert.ok(opp.length >= 3);
  for (const e of opp) {
    const name = e.title.split(" ")[0];
    const angle = Astro.AngleBetween(Astro.GeoVector(name, e.time, true), Astro.GeoVector(Astro.Body.Sun, e.time, true));
    assert.ok(angle > 165, `${name} is ${angle.toFixed(1)}° from the Sun`);
    assert.match(e.detail, /magnitude -?\d+\.\d, \d+\.\d\d AU/);
  }
});

test("greatest elongation is the top of Mercury's and Venus's swing", () => {
  const el = two.events.filter((e) => e.title.includes("greatest"));
  assert.ok(el.length >= 4);
  for (const e of el) {
    const name = e.title.split(" ")[0];
    const at = (days) => Astro.Elongation(name, new Date(e.time.getTime() + days * 86400000)).elongation;
    for (const d of [-3, -2, -1, 1, 2, 3]) assert.ok(at(0) >= at(d) - 0.01, `${e.title}: ${at(0)} < ${at(d)} at ${d} days`);
    assert.equal(Astro.Elongation(name, e.time).visibility, e.title.includes("eastern") ? "evening" : "morning");
  }
});

test("close pairings are real local minima, close and clear of the Sun", () => {
  const long = skyCalendar({ ...PUNE, from: FROM, days: 1500 });
  const pairs = long.events.filter((e) => e.id.startsWith("pair-"));
  assert.ok(pairs.length >= 2, "four years should hold a few close pairings");
  for (const e of pairs) {
    const [, a, b] = e.id.split("-");
    const sep = (ms) => Astro.AngleBetween(Astro.GeoVector(a, new Date(ms), true), Astro.GeoVector(b, new Date(ms), true));
    const t = e.time.getTime();
    assert.ok(sep(t) < PAIR_MAX_SEPARATION_DEG);
    assert.ok(sep(t) <= sep(t - 6 * 3600000) + 1e-6 && sep(t) <= sep(t + 6 * 3600000) + 1e-6, `${e.title} is not a minimum`);
    assert.ok(Math.min(Astro.Elongation(a, e.time).elongation, Astro.Elongation(b, e.time).elongation) >= MIN_ELONGATION_DEG);
    assert.ok(Math.abs(e.separation - sep(t)) < 0.01);
  }
});

test("meteor showers use the IMO table, and the radiant height is exact geometry", () => {
  const per = two.events.find((e) => e.title.startsWith("Perseids") && e.time.getUTCFullYear() === 2026);
  assert.equal(per.time.toISOString().slice(0, 10), "2026-08-13");
  assert.equal(per.zhr, 110);
  assert.equal(per.allDay, true);
  assert.match(per.detail, /IMO/);
  assert.equal(Math.round(per.radiantMax), Math.round(90 - Math.abs(PUNE.lat - 58)));
  const south = skyCalendar({ lat: -60, lon: 0, from: new Date("2026-08-01T00:00:00Z"), days: 30 }).events.find((e) => e.title.startsWith("Perseids"));
  assert.ok(south.radiantMax < 0 && /never gets above the horizon/.test(south.detail), "the Perseid radiant does not rise from 60 degrees south");
  assert.equal(two.events.filter((e) => e.kind === "shower" && e.time.getUTCFullYear() === 2026).length, SHOWERS.filter((s) => true).length);
  assert.ok(per.moonFraction >= 0 && per.moonFraction <= 1);
});

test("events are sorted, bounded by the window and stable between calls", () => {
  const w = skyCalendar({ ...PUNE, from: new Date("2026-10-04T12:00:00Z"), days: 60 });
  assert.deepEqual(w.events.map((e) => e.time.getTime()), w.events.map((e) => e.time.getTime()).sort((a, b) => a - b));
  for (const e of w.events) assert.ok(e.time >= w.from && e.time < w.to, e.title);
  assert.deepEqual(skyCalendar({ ...PUNE, from: new Date("2026-10-04T12:00:00Z"), days: 60 }).events.map((e) => e.id), w.events.map((e) => e.id));
  assert.equal(new Set(w.events.map((e) => e.id)).size, w.events.length, "ids are unique");
  const kinds = new Set(w.events.map((e) => e.kind));
  assert.ok(kinds.has("moon") && kinds.has("shower"));
  for (const e of w.events) assert.ok(e.title && e.detail && e.tag && !/[—–]/.test(e.title + e.detail), e.title);
});

test("a 90 day calendar is quick enough to compute on a phone", () => {
  const t0 = performance.now();
  skyCalendar({ ...PUNE, from: new Date("2026-10-04T12:00:00Z"), days: 90 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});

test("the home screen highlight prefers a near eclipse, planet event or shower, then the next Full Moon", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const w = skyCalendar({ ...PUNE, from: now, days: 90 });
  const h = highlight(w.events, now);
  assert.ok(h.time >= new Date(now.getTime() - 12 * 3600000));
  const nearSpecial = w.events.find((e) => ["eclipse", "planet", "shower"].includes(e.kind) && e.time - now < 45 * 86400000 && (e.kind !== "eclipse" || e.visible || e.body === "sun") && (e.kind !== "shower" || e.zhr >= HIGHLIGHT_MIN_ZHR));
  if (nearSpecial) assert.equal(h.id, nearSpecial.id);
  const onlyMoon = w.events.filter((e) => e.kind === "moon");
  assert.equal(highlight(onlyMoon, now).quarter, 2);
  assert.equal(highlight([], now), null);
  const faint = [{ id: "a", kind: "shower", zhr: 5, time: new Date("2026-10-09T12:00:00Z"), allDay: true }, { id: "b", kind: "shower", zhr: 20, time: new Date("2026-10-22T12:00:00Z"), allDay: true }];
  assert.equal(highlight(faint, now).id, "b", "a 5 an hour shower does not take the home screen tile");
});
