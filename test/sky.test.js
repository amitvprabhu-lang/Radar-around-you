import test from "node:test";
import assert from "node:assert/strict";
import * as Astro from "astronomy-engine";
import * as C from "../src/core.js";
import { ecefAt } from "../src/sgp4.js";
import { hourSample } from "../src/plan.js";
import * as S from "../site/sky.mjs";
import { SKY_NOW, SAT_TIME, realClouds, realPrecise, skyCities, cityOf, skyData, skyPlaces, usno, cloudsDoc } from "./helpers/skyfixture.mjs";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} +- ${tol}, got ${a}`);
const MIN = 60e3, H = 3600e3;
const cities = skyCities();
const real = () => cities.map((c) => S.summariseCity(c, { clouds: realClouds(), precise: realPrecise(), sky: skyData(), now: SKY_NOW }));
const REAL = real();

// ------------------------------------------------------------------ accuracy: the night window against the US Naval Observatory
test("sunset and sunrise of the night window agree with the USNO tables for the six cities on both 2026 solstices", (t) => {
  let n = 0, worst = 0;
  for (const c of cities) for (const date of ["2026-06-21", "2026-12-21"]) {
    const d = usno(`rstt-${c.id}-${date}`).properties.data;
    for (const e of d.sundata.filter((x) => x.phen === "Rise" || x.phen === "Set")) {
      const want = Date.parse(`${date}T${e.time}:00Z`);
      // three hours before a sunrise the Sun is down, so the night ends at that sunrise; three hours before a sunset it is up, so the
      // night starts at that sunset
      const w = S.nightWindow(c, want - 3 * H);
      assert.equal(w.kind, "night", `${c.id} ${date}`);
      const got = e.phen === "Rise" ? w.end : w.start;
      worst = Math.max(worst, Math.abs(got - want) / MIN);
      assert.ok(Math.abs(got - want) <= S.RISE_SET_CHECK_MINUTES * MIN, `${c.id} ${date} ${e.phen}: ${new Date(got).toISOString()} against USNO ${e.time}`);
      n++;
    }
  }
  t.diagnostic(`${n} sunrise and sunset times, worst difference ${worst.toFixed(2)} minutes (USNO prints whole minutes)`);
  assert.equal(n, 20);  // Tromsø has no sunrise or sunset on either solstice
});

test("Tromsø: the midnight Sun on the June solstice and the polar night on the December solstice, as the USNO tables say", () => {
  const c = cityOf("tromso");
  assert.match(usno("rstt-tromso-2026-06-21").properties.data.sundata[0].phen, /continuously above the Horizon/);
  assert.match(usno("rstt-tromso-2026-12-21").properties.data.sundata[0].phen, /continuously below the Horizon/);
  const june = S.nightWindow(c, Date.parse("2026-06-21T12:00:00Z"));
  assert.equal(june.kind, "midnightSun");
  assert.equal(june.end - june.start, 12 * H);
  assert.equal(S.hm((june.start + june.end) / 2, c.tz), "00:00");
  const dec = S.nightWindow(c, Date.parse("2026-12-21T12:00:00Z"));
  assert.equal(dec.kind, "polarNight");
  assert.equal(dec.end - dec.start, 24 * H);
  // and the pages say so in words
  const s = S.summariseCity(c, { clouds: cloudsDoc(["tromso"], { updated: "2026-06-21T12:00:00Z", from: "2026-06-21T12:00:00Z" }), sky: skyData(), now: new Date("2026-06-21T13:00:00Z") });
  assert.match(s.summary, /does not set/);
  assert.equal(s.strip.best, null);
  assert.match(s.findings[0], /Sun stays up all night/);
  assert.ok(!s.findings.some((f) => /best window is/.test(f)));
  const w = S.summariseCity(c, { clouds: cloudsDoc(["tromso"], { updated: "2026-12-21T12:00:00Z", from: "2026-12-21T12:00:00Z", cloud: 0 }), sky: skyData(), now: new Date("2026-12-21T13:00:00Z") });
  assert.match(w.findings[0], /does not rise here in the 24 hours/);
});

test("known answer: at the equator on the March 2026 equinox the day lasts 12 h 06.7 min (the Sun's centre 50 arcminutes below the horizon)", () => {
  // The USNO equinox time is 2026-03-20 14:46 UTC. With the declination near 0, sunrise and sunset happen at hour angle H where
  // cos H = -sin(-50') / cos(0), so H = 90.833 degrees and the day is 2H / 15 = 12.111 hours = 12 h 06.7 min. Refraction of 34' and the
  // Sun's semidiameter of 16' make the 50' (the convention USNO and astronomy-engine use).
  const eq = usno("seasons-2026").data.find((d) => d.phenom === "Equinox" && d.month === 3);
  assert.deepEqual([eq.day, eq.time], [20, "14:46"]);
  const place = { id: "eq", name: "Equator", lat: 0, lon: 0, tz: "UTC" };
  const rise = S.nightWindow(place, Date.parse("2026-03-20T03:00:00Z")).end;
  const set = S.nightWindow(place, Date.parse("2026-03-20T12:00:00Z")).start;
  const expected = (2 * Math.acos(-Math.sin((50 / 60) * C.DEG)) / C.DEG / 15) * H;
  near((set - rise) / MIN, expected / MIN, 1, "day length in minutes");
  near(expected / MIN, 12 * 60 + 6.7, 0.05, "the derivation itself");
  const night = S.nightWindow(place, Date.parse("2026-03-20T12:00:00Z"));
  near((night.end - night.start) / MIN, 24 * 60 - expected / MIN, 2, "the night that follows");
});

test("Moon rise and set agree with the USNO tables for the six cities on both solstices; Tromsø's Moon is up all day in December", (t) => {
  let n = 0, worst = 0;
  for (const c of cities) for (const date of ["2026-06-21", "2026-12-21"]) {
    const d = usno(`rstt-${c.id}-${date}`).properties.data;
    const day0 = Date.parse(`${date}T00:00:00Z`);
    const m = S.moonTonight(c, { kind: "night", start: day0, end: day0 + 24 * H });
    for (const e of d.moondata.filter((x) => x.phen === "Rise" || x.phen === "Set")) {
      const want = Date.parse(`${date}T${e.time}:00Z`);
      const got = m.events.find((x) => x.kind === e.phen.toLowerCase() && Math.abs(x.t - want) < H);
      assert.ok(got, `${c.id} ${date} Moon ${e.phen}`);
      worst = Math.max(worst, Math.abs(got.t - want) / MIN);
      assert.ok(Math.abs(got.t - want) <= S.RISE_SET_CHECK_MINUTES * MIN, `${c.id} ${date} Moon ${e.phen}`);
      n++;
    }
    if (/continuously above/.test(d.moondata[0].phen)) { assert.equal(m.events.length, 0); assert.ok(m.upAtStart && m.upAtEnd, `${c.id} ${date} up all day`); }
  }
  t.diagnostic(`${n} moonrise and moonset times, worst difference ${worst.toFixed(2)} minutes`);
  assert.equal(n, 22);
});

test("the Moon's lit fraction and phase name match the USNO tables (lit fraction at 12:00 UTC of the date) and the USNO phase list", () => {
  for (const c of cities) for (const date of ["2026-06-21", "2026-12-21"]) {
    const d = usno(`rstt-${c.id}-${date}`).properties.data;
    const noon = Date.parse(`${date}T12:00:00Z`);
    const m = S.moonTonight(c, { kind: "night", start: noon - H, end: noon + H }, { at: noon });
    assert.equal(`${m.illumPct}%`, d.fracillum, `${c.id} ${date}`);
    // The app's names (moonPhaseName in src/info.js) give each principal phase a 22.5 degree band around its moment; USNO says crescent or
    // gibbous on a date whose Moon is not at the principal phase. At 46 percent lit (June) the app says "First quarter" and USNO "Waxing
    // Crescent": a difference of convention, recorded in docs/sky-pages-sources.md. At 90 percent (December) both say waxing gibbous.
    if (date === "2026-12-21") assert.equal(m.phaseName.toLowerCase(), d.curphase.toLowerCase(), `${c.id} ${date}`);
    else assert.deepEqual([m.phaseName, d.curphase], ["First quarter", "Waxing Crescent"], `${c.id} ${date}`);
  }
  // every principal phase in USNO's 2026 list, at its listed minute
  const names = { "New Moon": "New Moon", "First Quarter": "First quarter", "Full Moon": "Full Moon", "Last Quarter": "Last quarter" };
  let n = 0;
  for (const p of usno("phases-2026").phasedata) {
    const at = Date.UTC(p.year, p.month - 1, p.day, ...p.time.split(":").map(Number));
    const m = S.moonTonight(cityOf("pune"), { kind: "night", start: at, end: at + H }, { at });
    assert.equal(m.phaseName, names[p.phase], `${p.phase} ${p.year}-${p.month}-${p.day}`);
    if (p.phase === "Full Moon") assert.ok(m.illumPct >= 99);
    if (p.phase === "New Moon") assert.ok(m.illumPct <= 1);
    if (/Quarter/.test(p.phase)) assert.ok(Math.abs(m.illumPct - 50) <= 2, `${p.phase}: ${m.illumPct}`);
    n++;
  }
  assert.equal(n, 50);
});

test("planet positions: the two horizon conversions in the repository agree, and Mercury and Venus stay within their known distance of the Sun", () => {
  // Not an independent ephemeris check (none is in the repository): astronomy-engine's altitudes are compared with src/core.js's own
  // conversion of the same right ascension and declination, and the elongations with the textbook maxima (about 28 and 47 degrees).
  for (const c of cities) {
    const at = Date.parse("2026-10-06T20:00:00Z"), obs = new Astro.Observer(c.lat, c.lon, 0);
    for (const name of S.PLANETS) {
      const eq = Astro.Equator(Astro.Body[name], new Date(at), obs, true, true);
      const hz = Astro.Horizon(new Date(at), obs, eq.ra, eq.dec);
      const mine = C.raDecToAltAz(eq.ra * 15, eq.dec, c.lat, c.lon, new Date(at));
      near(mine.alt, hz.altitude, 0.1, `${c.id} ${name} altitude`);
    }
  }
  for (let d = 0; d < 584; d += 7) {
    const at = new Date(Date.UTC(2026, 0, 1) + d * 864e5);
    assert.ok(Astro.AngleFromSun(Astro.Body.Mercury, at) < 28.5);
    assert.ok(Astro.AngleFromSun(Astro.Body.Venus, at) < 47.9);
  }
});

// ------------------------------------------------------------------ accuracy: the ISS
test("ISS: SGP4 from the real element set gives the ISS's height, inclination and period, and no pass over Tromsø is possible", () => {
  const p = realPrecise();
  const s = S.summariseIss(p, { dataTime: SAT_TIME, now: SKY_NOW, cities, places: null });
  assert.ok(s.position.hKm > 400 && s.position.hKm < 440, `${s.position.hKm}`);
  near(s.orbit.periodMin, 1440 / 15.48742155, 1e-9, "period from the mean motion");
  near(s.orbit.periodMin, 92.98, 0.01, "about 93 minutes");
  assert.ok(s.maxTrackLat <= s.orbit.inclination + 0.4 && s.maxTrackLat > s.orbit.inclination - 1, `${s.maxTrackLat}`);
  // Geometry, not SGP4: from 420 km up a satellite 10 degrees above the horizon is at most footprintRadiusKm away on the ground. Tromsø is
  // further than that from latitude 51.9 (the most the track reaches), so no pass at 10 degrees or more is possible there.
  const reach = C.footprintRadiusKm(440, 10);
  assert.ok((69.6492 - 51.9) * 111.2 > reach, `${reach}`);
  assert.equal(s.passes.find((x) => x.city.id === "tromso").passes.length, 0);
  // a pass's highest point recomputed with the spherical look angle in src/core.js agrees with the SGP4 pass finder
  const iss = S.issElements(p, SKY_NOW);
  for (const x of s.passes) for (const q of x.passes) {
    const pos = ecefAt(iss.sat, new Date(q.max.t)), g = C.ecefToGeodetic(pos.x, pos.y, pos.z);
    near(C.lookAngle(x.city.lat, x.city.lon, g.lat, g.lon, g.hKm).el, q.max.el, 1, `${x.city.id} pass at ${new Date(q.max.t).toISOString()}`);
  }
});

test("ISS: the track is split where it crosses the antimeridian, and the findings name only places from the list, within 300 km", () => {
  const s = S.summariseIss(realPrecise(), { dataTime: SAT_TIME, now: SKY_NOW, cities, places: skyPlaces() });
  for (const seg of s.track) for (let i = 1; i < seg.length; i++) assert.ok(Math.abs(seg[i].lon - seg[i - 1].lon) < 180);
  assert.ok(s.track.length >= 2, "a 135 minute track crosses the antimeridian at least once");
  assert.equal(s.track.flat().length, 136);
  assert.ok(s.next && s.next.place.km <= 300 && s.next.min > 0);
  assert.ok(s.findings.length >= 3 && s.findings.length <= 6);
  assert.ok(s.findings.some((f) => f.includes(s.next.place.name)));
  near(Math.abs(s.shiftDeg), 23.3, 0.5, "the Earth turns about 23 degrees in one ISS orbit");
});

test("ISS: missing, old and broken element sets are not used, with the reason", () => {
  const p = realPrecise();
  const without = { ...p, rows: p.rows.filter((r) => r[0] !== S.ISS_ID) };
  assert.equal(S.issElements(without, SKY_NOW).status, "missing");
  assert.throws(() => S.summariseIss(without, { dataTime: SAT_TIME, now: SKY_NOW, cities }), /not in this satellite data/);
  const old = S.issElements(p, new Date("2026-10-13T12:00:00Z"));
  assert.equal(old.status, "old");
  assert.match(old.reason, /more than 7 days old/);
  assert.throws(() => S.summariseIss(p, { dataTime: "2026-10-13T00:00:00Z", now: new Date("2026-10-13T12:00:00Z"), cities }), (e) => e.stale === true);
  const i = p.cols.indexOf("n");
  const broken = { ...p, rows: p.rows.map((r) => (r[0] === S.ISS_ID ? r.map((x, k) => (k === i ? 1.0027 : x)) : r)) };
  assert.equal(S.issElements(broken, SKY_NOW).status, "bad");
  // a city page without usable elements leaves the passes out and says why
  const c = S.summariseCity(cityOf("pune"), { clouds: realClouds(), precise: without, sky: skyData(), now: SKY_NOW });
  assert.equal(c.iss.status, "missing");
  assert.deepEqual(c.iss.passes, []);
  assert.throws(() => S.summariseIss(p, { dataTime: "2026-10-04T12:00:00Z", now: SKY_NOW, cities }), (e) => e.stale === true, "satellite data older than 30 hours");
});

// ------------------------------------------------------------------ freshness and guards for the cloud feed
test("a forecast older than 6 hours is stale, a city missing from the feed or a broken forecast fails, each with a reason", () => {
  const c = cityOf("london");
  const doc = cloudsDoc(["london"], { updated: "2026-10-06T01:00:00Z" });
  assert.ok(S.summariseCity(c, { clouds: doc, sky: skyData(), now: new Date("2026-10-06T06:59:00Z") }));
  assert.throws(() => S.summariseCity(c, { clouds: doc, sky: skyData(), now: new Date("2026-10-06T07:01:00Z") }), (e) => e.stale === true && /more than 6 hours old/.test(e.message));
  const stale = S.summariseCity(c, { clouds: doc, sky: skyData(), now: new Date("2026-10-06T09:00:00Z"), allowStale: true });
  assert.equal(stale.stale, true);
  assert.throws(() => S.summariseCity(cityOf("pune"), { clouds: doc, sky: skyData(), now: SKY_NOW }), /no forecast in the file/);
  assert.throws(() => S.checkClouds("x", cloudsDoc(["x"], { cloud: 101 }).cities.x), /outside 0 to 100/);
  assert.throws(() => S.checkClouds("x", cloudsDoc(["x"], { hours: 10 }).cities.x), /only 10 forecast hours/);
  assert.throws(() => S.checkClouds("x", { updated: "soon", hours: [] }), /is not a time/);
  const back = cloudsDoc(["x"]).cities.x; back.hours[5].t = back.hours[3].t;
  assert.throws(() => S.checkClouds("x", back), /not after the one before/);
  assert.throws(() => S.summariseCity(c, { clouds: cloudsDoc(["london"], { updated: "2026-10-06T05:00:00Z" }), sky: skyData(), now: new Date("2026-10-06T03:00:00Z") }), /in the future/);
});

// ------------------------------------------------------------------ the best window and the summary
test("the best window is the app's bestWindow over the night hours, kept inside the night, and follows the cloud", () => {
  const c = cityOf("london");
  const clear = S.summariseCity(c, { clouds: cloudsDoc(["london"], { cloud: 0 }), sky: skyData(), now: SKY_NOW });
  assert.ok(clear.strip.best);
  assert.ok(clear.strip.best.start >= clear.night.start && clear.strip.best.end <= clear.night.end);
  assert.equal(clear.strip.best.cloud, 0);
  // the same hours through the app's own functions (hourSample in src/plan.js, bestWindow in src/core.js) give the same window
  const doc = cloudsDoc(["london"], { cloud: 0 });
  const hours = clear.strip.hours.map((h) => hourSample({ lat: c.lat, lon: c.lon, clouds: doc.cities.london }, new Date(h.t)));
  const app = C.bestWindow(hours, S.BEST_WINDOW_THRESHOLD);
  assert.equal(clear.strip.best.start, Math.max(clear.night.start, app.best.start.getTime()));
  assert.equal(clear.strip.best.end, Math.min(clear.night.end, app.best.endExclusive.getTime()));
  assert.deepEqual(clear.strip.hours.map((h) => h.score), app.scored.map((h) => h.score));
  const cloudy = S.summariseCity(c, { clouds: cloudsDoc(["london"], { cloud: 100 }), sky: skyData(), now: SKY_NOW });
  assert.equal(cloudy.strip.best, null);
  assert.match(cloudy.summary, /No stretch of tonight in London reaches 45 out of 100/);
  assert.match(clear.summary, /^The best window tonight in London is \d\d:\d\d to \d\d:\d\d, with 0 percent cloud\.$/);
  // no promise of visibility anywhere in the computed sentences
  for (const s of [...REAL, clear, cloudy]) for (const f of [s.summary, ...s.findings]) assert.ok(!/will see|guarantee|definitely|you can see/i.test(f), f);
});

test("everything is computed from the inputs and the time given: the same inputs give the same summary", () => {
  const again = real();
  assert.equal(JSON.stringify(again), JSON.stringify(REAL));
  // a later build time with the same data changes nothing but the freshness
  const later = S.summariseCity(cities[0], { clouds: realClouds(), precise: realPrecise(), sky: skyData(), now: new Date("2026-10-06T03:00:00Z") });
  assert.equal(later.summary, REAL[0].summary);
});

test("the real data of 6 October: each city has its own night, Moon times, planets and chart", () => {
  assert.equal(REAL.length, 6);
  for (const s of REAL) {
    assert.ok(s.night.kind === "night", s.city.id);
    assert.ok(s.findings.length >= 3 && s.findings.length <= 6, `${s.city.id}: ${s.findings.length}`);
    assert.ok(s.chart.stars.length > 50 && s.chart.figures.length > 0 && s.chart.figures.length <= S.FIGURE_MAX);
    for (const st of s.chart.stars) assert.ok(st.alt > 0 && st.mag <= S.CHART_MAG_LIMIT);
    assert.equal(s.planets.length, 5);
    assert.equal(s.dataTime, realClouds().cities[s.city.id].updated.replace(/\.\d+Z$/, "Z"));
  }
  assert.equal(new Set(REAL.map((s) => s.chart.stars.map((x) => x.i).join())).size, 6, "six different charts");
  // the Southern Cross is on Sydney's chart and not on London's
  const names = (id) => new Set(REAL.find((s) => s.city.id === id).chart.named.map((x) => x.name));
  assert.ok(names("sydney").has("Acrux") && !names("london").has("Acrux"));
  // the Pune page has no ISS pass tonight; Sydney has four, two sunlit in a dark sky
  const syd = REAL.find((s) => s.city.id === "sydney");
  assert.equal(syd.iss.passes.length, 4);
  assert.equal(syd.iss.passes.filter((p) => p.visible).length, 2);
  assert.ok(syd.iss.passes.every((p) => !p.fromStart));
  // a window that starts in the middle of a pass marks it as already up
  const lon = REAL.find((x) => x.city.id === "london"), iss = S.issElements(realPrecise(), SKY_NOW);
  const mid = S.issPasses(iss, lon.city, Date.parse("2026-10-06T11:32:00Z"), 1);
  assert.equal(mid[0].fromStart, true);
});

// ------------------------------------------------------------------ findings (design section 8.2)
test("direction words use the one 15 percent threshold, with above, below, about the same, zero and missing inputs", () => {
  assert.equal(S.ABOUT_SAME, 0.15);
  assert.equal(S.direction(115, 100), "about the same as");
  assert.equal(S.direction(85, 100), "about the same as");
  assert.equal(S.direction(116, 100), "above");
  assert.equal(S.direction(84, 100), "below");
  assert.equal(S.direction(0, 0), "about the same as");
  assert.equal(S.direction(3, 0), "above");
  assert.equal(S.direction(null, 10), null);
  assert.equal(S.direction(10, undefined), null);
});

test("city findings: below, above and the same cloud as the night, ties, no window, no planets, no ISS data", () => {
  const c = cityOf("london");
  // first two night hours clear, the rest overcast: the window is clearer than the night
  const s1 = S.summariseCity(c, { clouds: cloudsDoc(["london"], { cloud: (i) => (i < 3 ? 0 : 60) }), sky: skyData(), now: SKY_NOW });
  const f1 = s1.findings.find((f) => f.startsWith("Cloud in the best window"));
  assert.match(f1, /is below the average/);
  const s2 = S.summariseCity(c, { clouds: cloudsDoc(["london"], { cloud: 20 }), sky: skyData(), now: SKY_NOW });
  assert.match(s2.findings.find((f) => f.startsWith("Cloud in the best window")), /about the same as the average/);
  const s3 = S.summariseCity(c, { clouds: cloudsDoc(["london"], { cloud: 100 }), sky: skyData(), now: SKY_NOW });
  assert.ok(s3.findings.some((f) => /^No hour tonight reaches 45 out of 100/.test(f)));
  assert.ok(!s3.findings.some((f) => f.startsWith("Cloud in the best window")), "no comparison without a window");
  // no satellite data: no ISS finding (left out, not guessed)
  assert.ok(!s2.findings.some((f) => /ISS/.test(f)));
  // every number in a finding is in the summary's own values (the page prints them too)
  for (const s of REAL) {
    const known = JSON.stringify(s) + s.findings.join(" ");
    for (const f of s.findings) for (const n of f.match(/\d+(\.\d+)?/g) || []) assert.ok(known.includes(n), `${s.city.id}: ${n} in "${f}"`);
  }
  // a tie for the clearest city is broken by name, so the hub's sentence is stable
  const tie = ["pune", "london"].map((id) => S.summariseCity(cityOf(id), { clouds: cloudsDoc([id], { cloud: 0 }), sky: skyData(), now: SKY_NOW }));
  assert.match(S.hubFindings(tie)[0], /^London has the clearest best window/);
  assert.match(S.hubFindings([...tie].reverse())[0], /^London has the clearest best window/);
});

test("hub findings: the clearest city, the cities with no window, the longest and shortest nights, polar cases said plainly", () => {
  const f = S.hubFindings(REAL);
  assert.match(f[0], /^New York has the clearest best window of the 6 cities: 0 percent cloud/);
  assert.ok(f.some((x) => /^Tromsø has no best window tonight/.test(x)));
  // on 6 October New York and London were already dark at the forecast time: they are not ranked against the whole nights
  assert.ok(f.some((x) => /^Of the 3 nights measured from sunset to sunrise, the longest is in Tokyo \(12 h 22 min\) and the shortest in Sydney \(11 h 23 min\)\.$/.test(x)), f.join(" | "));
  assert.ok(f.some((x) => /^In New York, London and Tromsø the nights were already under way at the forecast time/.test(x)), f.join(" | "));
  assert.ok(f.length >= 3 && f.length <= 6);
  const june = S.summariseCity(cityOf("tromso"), { clouds: cloudsDoc(["tromso"], { updated: "2026-06-21T12:00:00Z", from: "2026-06-21T12:00:00Z" }), sky: skyData(), now: new Date("2026-06-21T13:00:00Z") });
  assert.ok(S.hubFindings([june]).some((x) => /In Tromsø the Sun does not set tonight/.test(x)));
  assert.deepEqual(S.hubFindings([]), []);
});

test("time words: local times carry the weekday only on another day, zones give their offset, durations read plainly", () => {
  assert.equal(S.whenLocal(Date.parse("2026-10-06T20:00:00Z"), Date.parse("2026-10-06T13:00:00Z"), "Asia/Kolkata"), "Wed 7 Oct 01:30");
  assert.equal(S.whenLocal(Date.parse("2026-10-06T15:00:00Z"), Date.parse("2026-10-06T13:00:00Z"), "Asia/Kolkata"), "20:30");
  assert.equal(S.utcOffset(Date.parse("2026-10-06T00:00:00Z"), "Asia/Kolkata"), "UTC+05:30");
  assert.equal(S.utcOffset(Date.parse("2026-10-06T00:00:00Z"), "UTC"), "UTC+00:00");
  assert.equal(S.durationText(65 * MIN), "1 h 05 min");
  assert.equal(S.durationText(9 * MIN), "9 min");
  assert.equal(S.compassWords(0), "north");
  assert.equal(S.compassWords(112.5), "east-southeast");
  assert.equal(S.moonPhrase("Full Moon"), "full");
  assert.equal(S.moonPhrase("Waning crescent"), "a waning crescent");
});

// ------------------------------------------------------------------ review fix round (2026-10-06)
test("review: the hub ranks only whole nights; nights already under way are given as remaining darkness, never ranked", () => {
  const at = (id, iso) => S.summariseCity(cityOf(id), { clouds: cloudsDoc([id], { updated: iso, from: iso }), sky: skyData(), now: new Date(Date.parse(iso) + H) });
  // 21:00 UTC: Pune (02:30 local) and London (22:00 local) are dark already; Tokyo (06:00) and Sydney (08:00) start at sunset
  const mix = [at("pune", "2026-10-06T21:00:00Z"), at("london", "2026-10-06T21:00:00Z"), at("tokyo", "2026-10-06T21:00:00Z"), at("sydney", "2026-10-06T21:00:00Z")];
  assert.deepEqual(mix.map((x) => x.night.startsAtData), [true, true, false, false]);
  const f = S.hubFindings(mix);
  const rank = f.find((x) => /^Of the 2 nights measured from sunset to sunrise/.test(x));
  assert.ok(rank && /longest is in (Tokyo|Sydney)/.test(rank) && /shortest in (Tokyo|Sydney)/.test(rank) && !/Pune|London/.test(rank), rank);
  assert.ok(f.some((x) => /^In Pune and London the nights were already under way at the forecast time, so their pages give the remaining darkness: \d+ h \d\d min until sunrise in Pune and \d+ h \d\d min until sunrise in London\.$/.test(x)), f.join(" | "));
  // one whole night only: nothing to rank
  assert.ok(!S.hubFindings([mix[0], mix[2]]).some((x) => /measured from sunset to sunrise/.test(x)));
  assert.ok(S.hubFindings([mix[0]]).some((x) => /^In Pune the night was already under way/.test(x)));
});

test("review: the hub's Moon is one figure at one stated UTC moment, with the range the city pages show", () => {
  const f = S.hubFindings(REAL, { at: Date.parse("2026-10-06T01:17:49Z") });
  const m = S.moonAt(Date.parse("2026-10-06T01:17:49Z"));
  const pcts = REAL.map((x) => x.moon.illumPct), lo = Math.min(...pcts), hi = Math.max(...pcts);
  assert.ok(lo < hi, "the cities' own chart times give different figures");
  const line = f.find((x) => x.startsWith("At 01:17 UTC on 6 October 2026 the Moon is"));
  assert.equal(line, `At 01:17 UTC on 6 October 2026 the Moon is a ${m.phaseName.toLowerCase()}, ${m.illumPct} percent lit, as seen from anywhere; the city pages give it at each city's own chart time, from ${lo} to ${hi} percent.`);
  assert.ok(!f.some((x) => /the same phase for every city/.test(x)));
});

test("review: a night whose Sun never gets 6 degrees down (Tromsø, 10 May and 5 August 2026) says twilight, not cloud", () => {
  for (const iso of ["2026-05-10T12:00:00Z", "2026-08-05T12:00:00Z"]) {
    const s = S.summariseCity(cityOf("tromso"), { clouds: cloudsDoc(["tromso"], { updated: iso, from: iso, cloud: 5 }), sky: skyData(), now: new Date(Date.parse(iso) + H) });
    assert.equal(s.night.kind, "night");
    assert.equal(s.twilightOnly, true);
    assert.equal(s.strip.best, null);
    assert.ok(s.dark.lowestSunAlt > S.DARK_SUN_ALT && s.dark.lowestSunAlt < 0);
    assert.equal(s.summary, "The Sun sets in Tromsø tonight but never gets 6 degrees below the horizon, so the sky stays in twilight and no hour gets a viewing score.");
    assert.ok(s.findings.some((x) => /stays in twilight; that, not the cloud, is why there is no best window\.$/.test(x)), s.findings.join(" | "));
    assert.ok(!s.findings.some((x) => /^No hour tonight reaches/.test(x)), "cloud is not given as the cause");
    assert.ok(S.hubFindings([s]).some((x) => /^In Tromsø the Sun sets but stays less than 6 degrees below the horizon/.test(x)));
    assert.ok(!S.hubFindings([s]).some((x) => /no best window tonight on the viewing score/.test(x)));
  }
  // polar day and polar night keep their own words
  const day = S.summariseCity(cityOf("tromso"), { clouds: cloudsDoc(["tromso"], { updated: "2026-06-21T12:00:00Z", from: "2026-06-21T12:00:00Z", cloud: 5 }), sky: skyData(), now: new Date("2026-06-21T13:00:00Z") });
  assert.equal(day.twilightOnly, false);
  assert.match(day.summary, /^The Sun does not set in Tromsø/);
  const night = S.summariseCity(cityOf("tromso"), { clouds: cloudsDoc(["tromso"], { updated: "2026-12-21T12:00:00Z", from: "2026-12-21T12:00:00Z", cloud: 5 }), sky: skyData(), now: new Date("2026-12-21T13:00:00Z") });
  assert.equal(night.twilightOnly, false);
  assert.ok(night.dark.any);
  assert.match(night.findings[0], /^The Sun does not rise here in the 24 hours/);
  // a normal night is not twilight
  for (const x of REAL) assert.equal(x.twilightOnly, false);
});

test("review: every rise and set in the night is given in order, and 'highest in the dark' falls inside a time the body is up", () => {
  const t = (ms) => new Date(ms).toISOString().slice(11, 16);
  const start = Date.parse("2026-10-04T15:53:00Z"), end = Date.parse("2026-10-05T05:14:00Z");
  // a Jupiter-like track in Tromsø: up at nightfall, sets 16:42, rises again 22:00, still up at sunrise
  const events = [{ kind: "set", t: Date.parse("2026-10-04T16:42:00Z") }, { kind: "rise", t: Date.parse("2026-10-04T22:00:00Z") }];
  assert.equal(S.eventsPhrase(events, true, t, "nightfall"), "up at nightfall, sets at 16:42, rises again at 22:00");
  assert.deepEqual(S.upSpans(events, true, start, end), [{ from: start, to: events[0].t }, { from: events[1].t, to: end }]);
  assert.equal(S.eventsPhrase([{ kind: "rise", t: start + H }, { kind: "set", t: start + 5 * H }, { kind: "rise", t: start + 12 * H }], false, t), "rises at 16:53, sets at 20:53, rises again at 03:53");
  assert.equal(S.eventsPhrase([], true, t), "up all night");
  assert.equal(S.eventsPhrase([], false, t), "below the horizon all night");
  // the real pages: every planet's and the Moon's best time lies in one of its up spans, and every event is in the window
  for (const s of REAL) {
    for (const p of s.planets) {
      for (const e of p.events) assert.ok(e.t >= s.night.start && e.t <= s.night.end);
      if (p.best) assert.ok(S.upSpans(p.events, p.upAtStart, s.night.start, s.night.end).some((u) => p.best.t >= u.from - 10 * MIN && p.best.t <= u.to + 10 * MIN), `${s.city.id} ${p.name}`);
    }
    const f = s.findings.find((x) => x.startsWith("The Moon is"));
    for (const e of s.moon.events) assert.ok(f.includes(S.localText(e.t, s.night.start, s.tz)), `${s.city.id}: ${f}`);
  }
});

test("review: the best window ends when darkness ends, not at sunrise (Pune, 6 October)", () => {
  const pune = REAL.find((x) => x.city.id === "pune");
  const b = pune.strip.best;
  assert.ok(b.end < pune.night.end, "before sunrise");
  assert.ok(C.sunAltAz(pune.city.lat, pune.city.lon, new Date(b.end - MIN)).alt < S.DARK_SUN_ALT, "dark the minute before the end");
  assert.ok(C.sunAltAz(pune.city.lat, pune.city.lon, new Date(b.end)).alt >= S.DARK_SUN_ALT, "twilight at the end");
  assert.equal(S.hm(b.end, "Asia/Kolkata"), S.hm(pune.dark.last + MIN, "Asia/Kolkata"));
  for (const s of REAL) if (s.strip.best) assert.ok(s.strip.best.end <= s.dark.last + MIN, s.city.id);
});

test("review: a clock change in the night is found, and the repeated hour carries its offset (London 25 October, Sydney 4 October 2026)", () => {
  const lon = S.summariseCity(cityOf("london"), { clouds: cloudsDoc(["london"], { updated: "2026-10-24T18:00:00Z", from: "2026-10-24T18:00:00Z" }), sky: skyData(), now: new Date("2026-10-24T19:00:00Z") });
  assert.deepEqual({ ...lon.clock, at: new Date(lon.clock.at).toISOString() }, { at: "2026-10-25T01:00:00.000Z", before: "UTC+01:00", after: "UTC+00:00" });
  assert.equal(S.localText(Date.parse("2026-10-25T00:30:00Z"), lon.night.start, "Europe/London"), "Sun 25 Oct 01:30 (UTC+01:00)");
  assert.equal(S.localText(Date.parse("2026-10-25T01:30:00Z"), lon.night.start, "Europe/London"), "Sun 25 Oct 01:30 (UTC+00:00)");
  assert.equal(S.localText(Date.parse("2026-10-25T04:00:00Z"), lon.night.start, "Europe/London"), "Sun 25 Oct 04:00", "an unambiguous time has no offset");
  const hours = lon.strip.hours.map((h) => S.localText(h.t, lon.night.start, "Europe/London"));
  assert.equal(new Set(hours).size, hours.length, "every hour of the table reads differently");
  const syd = S.summariseCity(cityOf("sydney"), { clouds: cloudsDoc(["sydney"], { updated: "2026-10-03T06:00:00Z", from: "2026-10-03T06:00:00Z" }), sky: skyData(), now: new Date("2026-10-03T07:00:00Z") });
  assert.deepEqual([syd.clock.before, syd.clock.after, new Date(syd.clock.at).toISOString()], ["UTC+10:00", "UTC+11:00", "2026-10-03T16:00:00.000Z"]);
  assert.equal(REAL.find((x) => x.city.id === "pune").clock, null);
});
