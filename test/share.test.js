import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../src/core.js";
import * as I from "../src/info.js";
import * as G from "../src/sgp4.js";
import * as N from "../src/tonight.js";
import * as S from "../src/share.js";
import { loadD } from "./helpers.js";

const D = loadD();
const precise = G.loadPrecise(JSON.parse(fs.readFileSync(new URL("../public/precise.json", import.meta.url), "utf8")));
const snap = new Date(Date.parse(D.meta.taken));
const placeOf = (id) => { const c = D.cities.find((x) => x.id === id); return { ...c, lat: Number(c.lat), lon: Number(c.lon) }; };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} +- ${tol}, got ${a}`);
const clean = (spec) => {
  const flat = JSON.stringify(spec);
  assert.ok(!/undefined|NaN|null|\[object/.test(flat), `no placeholder text in ${spec.kind}: ${flat.slice(0, 200)}`);
  assert.ok(spec.filename.endsWith(".png") && !/\s/.test(spec.filename));
  assert.ok(spec.title.length > 4 && spec.subtitle.length > 2 && spec.kicker.length > 3);
  assert.ok(spec.facts.length >= 2 && spec.facts.length <= 5);
  assert.ok(spec.text.length > 40 && spec.text.length < 420, `post text length ${spec.text.length}`);
};

test("quake card says when the waves reach you, with the same numbers as the quake card", () => {
  const pune = placeOf("pune");
  const q = D.quakes.events.find((e) => e.id === "us6000tzer");
  const info = I.quakeInfo(D, q, pune, snap.getTime());
  const spec = S.quakeSpec(info, pune, snap.getTime());
  clean(spec);
  assert.equal(spec.kind, "quake");
  assert.match(spec.title, /^P waves reach Pune in 11 min \d+ s$/);
  assert.match(spec.kicker, /M5\.9/);
  assert.ok(spec.facts.some(([k, v]) => /Distance/.test(k) && v.startsWith("5,846 km")));
  assert.ok(spec.facts.some(([k, v]) => /Depth/.test(k) && /46 km, in the upper mantle/.test(v)));
  assert.ok(spec.text.includes("Tambolaka") && spec.text.includes("Simplified"));
  near(spec.art.chordKm, 5622.5, 3, "straight-line distance through the Earth");
  const noFelt = S.quakeSpec({ ...info, felt: null }, pune, snap.getTime());
  assert.ok(noFelt.facts.some(([, v]) => v === "No reports yet"));
});

test("quake art geometry: focus below the epicentre, viewer on the rim at the right angle", () => {
  const R = 262, theta = 0.9175;
  const g = S.quakeArtGeometry(theta, 46, R);
  near(Math.hypot(g.focus.x, g.focus.y), R * (1 - 46 / C.EARTH_RADIUS_KM), 1e-9, "focus depth");
  near(g.epicentre.y, -R, 1e-9, "epicentre straight up");
  near(Math.hypot(g.viewer.x, g.viewer.y), R, 1e-9, "viewer on the rim");
  near(Math.atan2(g.viewer.x, -g.viewer.y), theta, 1e-9, "angle from the epicentre");
  // the chord drawn on the card is scaled like the real one
  near(Math.hypot(g.viewer.x - g.focus.x, g.viewer.y - g.focus.y) / R * C.EARTH_RADIUS_KM, 5622.5, 3, "chord to scale");
  assert.equal(g.layers.length, 3);
  assert.ok(g.layers[0] > g.layers[1] && g.layers[1] > g.layers[2]);
  const antipode = S.quakeArtGeometry(Math.PI, 10, R);
  near(antipode.viewer.y, R, 1e-6, "a viewer on the far side is at the bottom");
});

test("pass card from a real pass: visible and not-visible wording", () => {
  const sydney = placeOf("sydney"), tz = sydney.tz;
  const iss = precise.get(25544);
  const passes = G.passesFor(iss, sydney, snap, 72);
  const vis = passes.find((p) => p.visible && N.visiblePart(p));
  assert.ok(vis, "Sydney has a visible ISS pass within three days");
  const spec = S.passSpec({ name: "International Space Station", short: "ISS", place: sydney, tz, pass: vis });
  clean(spec);
  assert.equal(spec.kicker, "VISIBLE PASS");
  assert.equal(spec.title, "ISS over Sydney");
  assert.ok(spec.facts[0][1].includes(" to "), "visible time range");
  assert.ok(spec.art.track.length > 5 && spec.art.track.some((t) => t.lit));
  assert.match(spec.text, /Look up!/);
  const dark = passes.find((p) => !p.visible);
  assert.ok(dark, "there is also a pass that cannot be seen");
  const spec2 = S.passSpec({ name: "International Space Station", short: "ISS", place: sydney, tz, pass: dark });
  clean(spec2);
  assert.equal(spec2.kicker, "PASS (NOT VISIBLE)");
  assert.match(spec2.text, /will not be visible/);
});

test("tonight cards for a pass, a string and the whole night", () => {
  const pune = placeOf("pune"), tz = pune.tz;
  const t = N.buildTonight({ D, precise, place: pune, now: snap, kp: I.kpAt(D.meta.kp, snap.getTime()) });
  const ts = S.tonightSpec(t, pune);
  clean(ts);
  assert.equal(ts.title, t.verdict.headline);
  assert.equal(ts.art.score, t.verdict.score);
  assert.ok(ts.subtitle.startsWith("Best window"));
  const pass = t.items.find((i) => i.kind === "pass");
  assert.ok(pass);
  const ps = S.itemSpec(pass, pune, tz);
  clean(ps);
  assert.equal(ps.art.type, "dome");
  assert.equal(S.itemSpec(t.items.find((i) => i.kind === "planet"), pune, tz), null, "only passes and strings have a card");
  // a string, using the real finder over several days
  const train = N.buildTonight({ D, precise, place: pune, now: new Date(snap.getTime() + 2 * 86400e3 - 3600e3), kp: null }).items.find((i) => i.kind === "train");
  assert.ok(train, "a Starlink string is visible from Pune on the evening of 6 October");
  const trs = S.itemSpec(train, pune, tz);
  clean(trs);
  assert.equal(trs.kind, "train");
  assert.equal(trs.art.mode, "train");
  assert.ok(trs.art.track.length >= 2);
  assert.match(trs.facts[0][1], /^up to \d+$/);
  // a cloudy night still produces a card
  const cloudy = N.buildTonight({ D, precise, place: { ...pune, clouds: { hours: pune.clouds.hours.map((h) => ({ ...h, cloud: 100 })) } }, now: snap, kp: null });
  clean(S.tonightSpec(cloudy, pune));
  assert.equal(S.tonightSpec(cloudy, pune).subtitle, "No good window");
});

test("drawing a card needs the browser and is covered by the end-to-end run", () => {
  assert.equal(S.CARD_W, 1080); assert.equal(S.CARD_H, 1350);
  assert.equal(typeof S.drawCard, "function");
});
