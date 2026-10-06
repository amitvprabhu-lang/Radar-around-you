import test from "node:test";
import assert from "node:assert/strict";
import { topWithTies, namesCapped, SAME_WITHIN, direction, ordinal, rankOf, rankPhrase, percentText, topShare, meanAndRange, and, changeSince, readHistory, historyAdd, previousEntry, HISTORY_KEEP } from "../site/insight.mjs";

test("one threshold decides the direction words: within 15 percent is about the same", () => {
  assert.equal(SAME_WITHIN, 0.15);
  assert.equal(direction(120, 100), "above");
  assert.equal(direction(80, 100), "below");
  assert.equal(direction(115, 100), "about the same as", "exactly 15 percent is about the same");
  assert.equal(direction(85, 100), "about the same as");
  assert.equal(direction(116, 100), "above");
  assert.equal(direction(100, 100), "about the same as", "a tie");
  assert.equal(direction(0, 0), "about the same as");
  assert.equal(direction(3, 0), "above");
  assert.equal(direction(-5, -10), "above", "a negative reference compares by size of the difference");
  assert.equal(direction(NaN, 1), null);
  assert.equal(direction(1, undefined), null, "a missing comparison gives no word");
});

test("ranks share their place on a tie and are worded with ordinals", () => {
  assert.deepEqual(rankOf(5, [3, 5, 9, 1]), { rank: 2, tiedWith: 0, of: 4 });
  assert.deepEqual(rankOf(5, [5, 5, 9]), { rank: 2, tiedWith: 1, of: 3 });
  assert.deepEqual(rankOf(1, [3, 1, 2], { higherFirst: false }), { rank: 1, tiedWith: 0, of: 3 });
  assert.equal(rankOf(1, []), null, "an empty window has no rank");
  assert.equal(rankPhrase({ rank: 1, tiedWith: 0 }), "the largest");
  assert.equal(rankPhrase({ rank: 2, tiedWith: 1 }, "busiest"), "the joint 2nd busiest");
  assert.equal(rankPhrase(null), null);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("shares, concentration and averages", () => {
  assert.equal(percentText(7, 10), "70");
  assert.equal(percentText(1, 300), "under 1");
  assert.equal(percentText(0, 0), "0");
  const rows = [{ name: "a", count: 5 }, { name: "b", count: 3 }, { name: "c", count: 2 }];
  assert.deepEqual(topShare(rows, 2), { rows: rows.slice(0, 2), count: 8, total: 10, share: 0.8 });
  assert.equal(topShare([], 3).share, 0, "an empty list");
  assert.deepEqual(meanAndRange([2, 4, 9]), { mean: 5, min: 2, max: 9, n: 3 });
  assert.equal(meanAndRange([]), null);
  assert.equal(and(["a", "b", "c"]), "a, b and c");
});

test("change since the previous build needs a previous value", () => {
  assert.deepEqual(changeSince(10, 8), { now: 10, before: 8, diff: 2, word: "above" });
  assert.equal(changeSince(10, undefined), null, "no history, no finding");
  assert.equal(changeSince(10, 10).word, "about the same as");
});

test("history keeps the last 48 entries per page in data time order, replaces a rebuild of the same data, and reads the entry before", () => {
  let h = readHistory("not json");
  assert.deepEqual(h, { schema: 1, pages: {} });
  assert.deepEqual(readHistory('{"schema":2,"pages":{}}'), { schema: 1, pages: {} }, "an unknown schema is an empty history");
  for (let i = 0; i < 60; i++) h = historyAdd(h, "launches", { dataTime: `2026-10-${String(1 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`, values: { n: i, bad: NaN } });
  assert.equal(h.pages.launches.length, HISTORY_KEEP);
  assert.equal(h.pages.launches.at(-1).values.n, 59);
  assert.ok(!("bad" in h.pages.launches[0].values), "only finite numbers are kept");
  const again = historyAdd(h, "launches", { dataTime: h.pages.launches.at(-1).dataTime, values: { n: 99 } });
  assert.equal(again.pages.launches.length, HISTORY_KEEP);
  assert.equal(again.pages.launches.at(-1).values.n, 99, "the same data time is replaced, not added");
  assert.equal(h.pages.launches.at(-1).values.n, 59, "the input is not changed");
  const last = h.pages.launches.at(-1).dataTime;
  assert.equal(previousEntry(h, "launches", last).values.n, 58, "the entry before, never the page's own");
  assert.equal(previousEntry(h, "starlink", last), null);
  assert.equal(previousEntry({ schema: 1, pages: {} }, "launches", last), null);
});

test("review fixes: ties at the top or at the edge are kept whole, names are capped, and shares near 100 percent never round up to all", () => {
  const r = (counts) => counts.map((count, i) => ({ name: String.fromCharCode(97 + i), count }));
  assert.deepEqual(topWithTies(r([5, 3, 2])).map((x) => x.name), ["a"], "no tie");
  assert.deepEqual(topWithTies(r([5, 5, 2])).map((x) => x.name), ["a", "b"], "a tie of two");
  assert.deepEqual(topWithTies(r([5, 5, 5, 1])).map((x) => x.name), ["a", "b", "c"], "a tie of three");
  assert.deepEqual(topWithTies([]), [], "empty");
  assert.deepEqual(topWithTies(r([9, 5, 4, 4, 4, 1]), 3).map((x) => x.name), ["a", "b", "c", "d", "e"], "a tie for third place");
  assert.deepEqual(topWithTies(r([9, 5]), 3).map((x) => x.name), ["a", "b"], "fewer rows than asked");
  assert.equal(namesCapped(["a", "b"]), "a and b");
  assert.equal(namesCapped(["a", "b", "c", "d", "e"], 3, "more days"), "a, b, c and 2 more days");
  assert.equal(percentText(249, 250), "over 99");
  assert.equal(percentText(250, 250), "100");
  assert.equal(percentText(199, 200), "over 99", "99.5 percent is not all");
});

test("review fixes: history drops malformed old entries", () => {
  const bad = { schema: 1, pages: { k: [null, { dataTime: "nonsense", values: { n: 1 } }, { dataTime: "2026-10-01T00:00:00Z", values: [1] }, { dataTime: "2026-10-02T00:00:00Z", values: { n: 2, s: "x" } }, { dataTime: "2026-10-03T00:00:00Z" }] } };
  const h = historyAdd(bad, "k", { dataTime: "2026-10-04T00:00:00Z", values: { n: 3 } });
  assert.deepEqual(h.pages.k, [{ dataTime: "2026-10-02T00:00:00Z", values: { n: 2 } }, { dataTime: "2026-10-04T00:00:00Z", values: { n: 3 } }]);
});
