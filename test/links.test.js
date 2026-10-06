import test from "node:test";
import assert from "node:assert/strict";
import { parseHash, buildHash, parsePlaceToken, VIEWS, SHEETS, WATCH_TABS, createHashSync } from "../src/links.js";

test("every view, sheet and watch tab parses from its own name", () => {
  for (const v of VIEWS) assert.equal(parseHash("#" + v).view, v);
  for (const s of SHEETS) assert.equal(parseHash("#" + s).sheet, s);
  for (const w of WATCH_TABS) assert.equal(parseHash("#" + w).watch, w);
  assert.deepEqual(parseHash(""), { view: null, sheet: null, watch: null, place: null, con: null });
  assert.deepEqual(parseHash("#"), { view: null, sheet: null, watch: null, place: null, con: null });
  assert.deepEqual(parseHash(undefined), { view: null, sheet: null, watch: null, place: null, con: null });
});

test("a place and a screen can be combined", () => {
  assert.deepEqual(parseHash("#place=pune&sky"), { view: "sky", sheet: null, watch: null, place: { kind: "city", id: "pune" }, con: null });
  assert.deepEqual(parseHash("#place=g3413829&aurora"), { view: null, sheet: null, watch: "aurora", place: { kind: "geonames", id: "g3413829" }, con: null });
  assert.deepEqual(parseHash("#aurora&place=new-york").place, { kind: "city", id: "new-york" });
});

test("a position fix keeps its sign and decimals and is range checked", () => {
  assert.deepEqual(parsePlaceToken("pos_-12.05_-77.04"), { kind: "fix", lat: -12.05, lon: -77.04 });
  assert.deepEqual(parsePlaceToken("pos_0_0"), { kind: "fix", lat: 0, lon: 0 });
  assert.equal(parsePlaceToken("pos_91_10"), null);
  assert.equal(parsePlaceToken("pos_10_181"), null);
  assert.equal(parsePlaceToken("pos_1.23456_2"), null, "more than four decimals is not one of our links");
});

test("anything else is ignored, never trusted", () => {
  for (const bad of ["#place=<script>", "#place=../../etc", "#place=g", "#place=G123", "#place=%E0%A4%A", "#place=" + "a".repeat(100), "#javascript:alert(1)", "#sky=1", "#place", "#unknown&also-unknown", "#" + "x".repeat(300)]) {
    const r = parseHash(bad);
    assert.equal(r.place, null, bad);
    if (!bad.startsWith("#sky=")) assert.equal(r.view, null, bad);
  }
  assert.equal(parseHash("#sky=1").view, null, "a bare name with a value is not a view");
});

test("the hash for a state round-trips and the default state is empty", () => {
  assert.equal(buildHash({}), "");
  assert.equal(buildHash({ view: "globe", placeId: "pune", defaultPlaceId: "pune" }), "");
  assert.equal(buildHash({ view: "sky" }), "#sky");
  assert.equal(buildHash({ view: "sky", placeId: "g3413829", defaultPlaceId: "pune" }), "#place=g3413829&sky");
  assert.equal(buildHash({ view: "globe", sheet: "watch", watchTab: "storms" }), "#storms");
  assert.equal(buildHash({ view: "sky", sheet: "calendar" }), "#calendar", "an open sheet wins over the view behind it");
  assert.equal(buildHash({ sheet: "share" }), "", "the share sheet is not linkable");
  for (const state of [{ view: "under" }, { sheet: "tonight" }, { sheet: "watch", watchTab: "fires", placeId: "pos_-12.05_-77.04" }, { view: "sky", placeId: "london" }]) {
    const p = parseHash(buildHash(state));
    if (state.view && state.view !== "globe" && !state.sheet) assert.equal(p.view, state.view);
    if (state.sheet === "watch") assert.equal(p.watch, state.watchTab);
    else if (state.sheet) assert.equal(p.sheet, state.sheet);
    if (state.placeId) assert.ok(p.place);
  }
});

test("a constellation link takes exactly three letters and nothing else", () => {
  assert.equal(parseHash("#sky&con=Cru").con, "cru");
  assert.equal(parseHash("#con=UMi").con, "umi");
  assert.equal(parseHash("#sky&con=cru").view, "sky");
  for (const bad of ["#con=", "#con=cr", "#con=crux", "#con=c1u", "#con=<s>", "#con=cru%20", "#con", "#con=../x"]) assert.equal(parseHash(bad).con, null, bad);
});

test("the hash sync writes nothing until the opening link has been read, then keeps the address in step", () => {
  let hash = "#status", screen = "#sky";
  const writes = [];
  const s = createHashSync({ want: () => screen, read: () => hash, write: (h) => { writes.push(h); hash = h; } });
  // during start-up a tab press changes the screen: the deep link must survive
  assert.equal(s.ready, false);
  assert.equal(s.sync(), false);
  assert.equal(hash, "#status");
  assert.deepEqual(writes, []);
  s.start();
  screen = "#status";  // the link was applied
  assert.equal(s.sync(), false, "nothing to write when the address already matches");
  screen = "#sky";
  assert.equal(s.sync(), true);
  assert.equal(hash, "#sky");
  screen = ""; hash = "";
  assert.equal(s.sync(), false);
  assert.deepEqual(writes, ["#sky"]);
});
