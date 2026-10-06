// The fixes of the review round of 2026-10-06 on the fleet and events pages: ties in the findings, places counted from multi-place
// GDACS fields, a live refresh that changes every field of the next launch, sorting of date cells, and the smaller items.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { summariseLaunches, summariseDisasters, summariseStarlink, launchFindings, disasterFindings, starlinkFindings } from "../site/events.mjs";
import { launchesPage, disastersPage, starlinkPage } from "../site/pages-events.mjs";
import { launchesHeadline, disastersHeadline, mergeRefresh, cellSortKey, sortOrder, liveScriptSource, LIVE_SCRIPT_VERSION } from "../site/live-pages-js.mjs";
import { renderPage } from "../site/layout.mjs";
import { countryFixture } from "./helpers/satfixture.mjs";
import { launchesDoc, eventsList, stormsNow, EV_TIME } from "./helpers/eventsfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-10-06T00:45:00Z");
const L = summariseLaunches(launchesDoc(), { now });
const D = summariseDisasters(eventsList(), { now, dataTime: EV_TIME, storms: stormsNow });
const S = summariseStarlink(countryFixture(), { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 1000 }, min: 50 });
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<\/?span[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
const rows = (counts, name = (i) => `P${i}`) => counts.map((count, i) => ({ name: name(i), count }));
const texts = (f) => f.map((x) => x.text).join("\n");

// ------------------------------------------------------------------ IMPORTANT 1: ties
test("launch findings: the provider with the most, with no tie, a tie of two, a tie of three and none", () => {
  const f = (byProvider, in30 = byProvider.reduce((a, x) => a + x.count, 0)) => texts(launchFindings({ ...L, in30, byProvider, exact30: Math.min(L.exact30, in30) }));
  assert.match(f(rows([3, 2, 1, 1])), /P0 has the most launches planned in the 30 days after the data time: 3 of 7 \(43 percent\)\. The 4 providers with the most, counting a tie for third place, together have 7 \(100 percent\)\./);
  assert.match(f(rows([3, 2, 1])), /P0 has the most launches .*: 3 of 6 \(50 percent\)\./);
  const two = f(rows([2, 2, 1, 1]));
  assert.match(two, /P0 and P1 have the joint most launches planned in the 30 days after the data time: 2 each of 6 \(33 percent each\)\./);
  assert.ok(!/P1 has the most|P0 has the most/.test(two), "never one of a tie alone");
  assert.match(f(rows([2, 2, 2, 1])), /P0, P1 and P2 have the joint most .*: 2 each of 7/);
  assert.match(f(rows([1, 1, 1, 1, 1])), /P0, P1, P2 and 2 more providers have the joint most .*: 1 each of 5/);
  assert.match(f([], 0), /^No launch in the list is planned in the 30 days after the data time\./);
  assert.match(f(rows([4])), /All 4 launches planned in the 30 days after the data time come from P0\./);
});

test("launch findings: the country of the pad with the most, with ties", () => {
  const f = (byCountry) => texts(launchFindings({ ...L, byCountry }));
  assert.match(f(rows([2, 1, 1], (i) => ["US", "CN", "NZ"][i])), /the country with the most is United States, with 2 \(50 percent\)\./);
  assert.match(f(rows([2, 2], (i) => ["US", "CN"][i])), /the countries with the most are United States and China, with 2 each \(50 percent each\)\./);
  assert.match(f(rows([1, 1, 1, 1], (i) => ["US", "CN", "NZ", "IN"][i])), /the countries with the most are United States, China, New Zealand and 1 more country, with 1 each/);
  assert.match(f(rows([4], () => "US")), /By the country of the pad, all of them are planned from United States\./);
});

test("disaster findings: the place GDACS names most often, with ties and none", () => {
  const f = (countries) => texts(disasterFindings({ ...D, countries }));
  assert.match(f(rows([5, 3])), /The place GDACS names most often among current events is P0, in 5 events/);
  assert.match(f(rows([5, 5, 1])), /The places GDACS names most often among current events are P0 and P1, in 5 events each/);
  assert.match(f(rows([4, 4, 4])), /are P0, P1 and P2, in 4 events each/);
  assert.ok(!/names most often/.test(f([])), "no place, no sentence");
  assert.ok(!/names most often/.test(f(rows([1, 1]))), "a place named once is not worth a sentence");
});

test("Starlink findings: the inclination group, the busiest bands and the launch day, with ties and none", () => {
  const f = (o) => texts(starlinkFindings({ ...S, ...o }));
  const inc = (counts) => counts.map((count, i) => ({ deg: [53, 43, 97, 70][i], count }));
  assert.match(f({ inclinations: inc([5, 3]) }), /The largest inclination group is 53 degrees, with 5 satellites/);
  assert.match(f({ inclinations: inc([5, 5, 1]) }), /The largest inclination groups are 53 degrees and 43 degrees, with 5 satellites each \(\d+ percent each\), of 3 groups\./);
  assert.match(f({ inclinations: inc([4, 4, 4]) }), /groups are 53 degrees, 43 degrees and 97 degrees, with 4 satellites each/);
  assert.ok(!/inclination group/.test(f({ inclinations: [] })));
  const b = (counts) => counts.map((count, i) => ({ from: 400 + i * 10, to: 410 + i * 10, count }));
  assert.match(f({ topBands: b([9, 5, 3]) }), /The 3 busiest 10 km altitude bands hold \d+ percent of them: 400 to 410 km \(9\), 410 to 420 km \(5\) and 420 to 430 km \(3\)\./);
  assert.match(f({ topBands: b([9, 5, 3, 3]) }), /The 4 busiest 10 km altitude bands, counting a tie for third place, hold \d+ percent of them: 400 to 410 km \(9\), 410 to 420 km \(5\), 420 to 430 km \(3\) and 1 more band with 3 each\./);
  assert.match(f({ topBands: b([9]) }), /The 1 busiest 10 km altitude band holds \d+ percent of them: 400 to 410 km \(9\)\./);
  assert.ok(!/busiest/.test(f({ topBands: [] })));
  const d = (counts) => counts.map((count, i) => ({ day: `2026-09-${String(10 + i).padStart(2, "0")}`, count }));
  assert.match(f({ topDays: d([56, 40]) }), /The launch day with the most active Starlink satellites is 10 September 2026, with 56\./);
  assert.match(f({ topDays: d([56, 56, 40]) }), /The launch days with the most active Starlink satellites are 10 September 2026 and 11 September 2026, with 56 each\./);
  assert.match(f({ topDays: d([56, 56, 56]) }), /are 10 September 2026, 11 September 2026 and 12 September 2026, with 56 each\./);
  assert.match(f({ topDays: d([56, 56, 56, 56]) }), /12 September 2026 and 1 more day, with 56 each\./);
  assert.ok(!/launch day/.test(f({ topDays: [] })));
});

test("the summaries keep whole ties: busiest bands and launch days are cut only after a tie at the edge", async () => {
  const D2 = (iso) => Math.round((Date.parse(iso) - Date.UTC(1957, 9, 4)) / 86400e3) + 1;
  const { buildFixture } = await import("./helpers/satfixture.mjs");
  // four bands of 2, 2, 1, 1 and six launch days of 2, 1, 1, 1, 1, 1: the third band and the fifth day tie with the next
  const objs = [[455, "2026-09-01"], [455, "2026-09-01"], [465, "2026-09-02"], [465, "2026-09-03"], [475, "2026-09-04"], [485, "2026-09-05"], [495, "2026-09-06"]]
    .map(([alt, day], j) => ({ type: 0, status: 1, owner: 1, purpose: 9, kind: 1, alt, incl: 53, ma: j * 40, launchDay: D2(day) }));
  const s = summariseStarlink(buildFixture(objs, { ref: Date.parse("2026-10-05T08:00:00Z") }), { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 1, max: 100 }, min: 1 });
  assert.deepEqual(s.topBands.map((b) => b.count), [2, 2, 1, 1, 1], "every band that ties with the third is kept");
  assert.deepEqual(s.topDays.map((d) => d.count), [2, 1, 1, 1, 1, 1], "every day that ties with the fifth is kept");
});

// ------------------------------------------------------------------ IMPORTANT 2: places in multi-place fields
test("places: a field naming several places counts once for each place, and the table's country cell is unchanged", () => {
  const list = [
    ...eventsList(),
    { id: "20", type: "FL", name: "Flood in Papua New Guinea", alert: "Green", country: "Papua New Guinea, Indonesia", from: "2026-10-04T00:00:00", to: "2026-10-06T00:00:00", current: true, lat: -5, lon: 141, severity: "x", url: "https://www.gdacs.org/r" },
    { id: "21", type: "FL", name: "Flood twice", alert: "Green", country: "Indonesia, Indonesia", from: "2026-10-04T00:00:00", to: "2026-10-06T00:00:00", current: true, lat: -5, lon: 120, severity: "x", url: "https://www.gdacs.org/r" },
  ];
  const s = summariseDisasters(list, { now, dataTime: EV_TIME, storms: stormsNow });
  const indo = s.countries.find((c) => c.name === "Indonesia");
  // the two fires and the volcano's neighbour list: the fires name Indonesia, the two new floods name it too (once each)
  assert.equal(indo.count, list.filter((e) => e.current && e.type !== "EQ" && e.id !== "1" && e.country.split(",").map((x) => x.trim()).includes("Indonesia")).length);
  assert.equal(s.countries.find((c) => c.name === "Papua New Guinea").count, 1);
  assert.equal(s.countries.find((c) => c.name === "Bangladesh").count, 1, "the trailing comma of 'Bangladesh, India, ' makes no empty place");
  assert.ok(!s.countries.some((c) => c.name === ""));
  const h = renderPage(disastersPage(s, { coast: [] }));
  assert.ok(h.includes("<td>Papua New Guinea, Indonesia</td>"), "the table keeps the field as GDACS gives it");
});

// ------------------------------------------------------------------ IMPORTANT 3: the refresh changes every field of the next launch
test("a refresh that brings a new next launch replaces every field of it: lead, card, table, FAQ and the countdown target", () => {
  const before = renderPage(launchesPage(L, { coast: [] }));
  const doc = launchesDoc();
  // later: the Starlink launch is gone; the next is Rocket Lab's, only to the hour, with another status
  doc.generated = "2026-10-06T21:00:00Z";
  doc.launches = doc.launches.filter((l) => l.id !== "a1").map((l) => (l.id === "a2" ? { ...l, statusName: "To Be Confirmed" } : l));
  const fresh = launchesHeadline(doc);
  const current = Object.fromEntries([...before.matchAll(/data-live-key="([a-z0-9-]+)">([^<]*)</g)].map((m) => [m[1], m[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')]));
  const merged = mergeRefresh(current, fresh);
  for (const k of Object.keys(current)) assert.equal(merged.values[k], fresh[k], `${k} is refreshed`);
  for (const k of ["next-name", "next-when", "next-provider", "next-status", "next-rocket", "next-pad", "next-location", "next-country", "next-precision", "launches-30"]) assert.ok(k in current, `${k} has a live key on the page`);
  // the page as the script leaves it: every keyed span holds the merged value, the countdown its new attributes
  let after = before.replace(/(data-live-key="([a-z0-9-]+)">)[^<]*</g, (m0, a, k) => `${a}${merged.values[k].replace(/&/g, "&amp;").replace(/</g, "&lt;")}<`);
  after = after.replace(/data-countdown="[^"]*" data-precision="[^"]*" data-status="[^"]*"/, `data-countdown="${fresh["next-net"]}" data-precision="${fresh["next-precision-code"]}" data-status="${fresh["next-status-text"]}"`);
  const lead = textOf(after.match(/<p class="lead">([\s\S]*?)<\/p>/)[1]);
  assert.match(lead, /the next launch in its list is Electron \| <b>Test & Go<\/b>, planned for 9 October 2026, in the hour from 03:00 UTC by Rocket Lab, status "To Be Confirmed"\./);
  assert.ok(!/SpaceX|Go for Launch/.test(lead), "nothing of the old next launch stays in the lead");
  const next = textOf(after.slice(after.indexOf('id="next"'), after.indexOf('id="list"')));
  assert.ok(next.includes("Provider Rocket Lab") && next.includes("Rocket Electron") && next.includes("How exact To the hour") && next.includes("Status To Be Confirmed") && !next.includes("SpaceX"), next);
  assert.ok(after.includes('data-countdown="2026-10-09T03:00:00Z" data-precision="HR" data-status="To Be Confirmed"'));
});

// ------------------------------------------------------------------ IMPORTANT 4: sorting date cells
// the rows of a table (found by its caption) as the script's sort keys for one column
function columnKeys(html, caption, col) {
  const t = html.match(new RegExp(`<caption>${caption}</caption>[\\s\\S]*?</table>`))[0];
  return [...t.split("<tbody>")[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => {
    const cell = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][col][1];
    const inner = (cell.match(/data-sort="([^"]*)"/) || [])[1], dt = (cell.match(/<time datetime="([^"]*)"/) || [])[1];
    return { key: cellSortKey(null, inner, dt, cell.replace(/<[^>]+>/g, "")), text: cell.replace(/<[^>]+>/g, "") };
  });
}
const sortedTexts = (cells, desc = false) => sortOrder(cells.map((c) => c.key), desc).map((i) => cells[i].text);

test("dates sort by their ISO value: GDACS days, launch months and imprecise launch times, both ways", () => {
  const dis = renderPage(disastersPage(summariseDisasters([...eventsList(), { id: "30", type: "WF", name: "Old fire", alert: "Green", country: "X", from: "2026-09-29T00:00:00", to: "2026-10-03T00:00:00", current: true, lat: 1, lon: 1, severity: "x", url: "" }], { now, dataTime: EV_TIME, storms: stormsNow }), { coast: [] }));
  const from = columnKeys(dis, "Wildfire events with a Green alert", 4);
  assert.deepEqual(sortedTexts(from), ["29 Sept 2026", "1 Oct 2026", "5 Oct 2026", "5 Oct 2026"], "by date, not by day number");
  const star = renderPage(starlinkPage(S, { coast: [] }));
  const months = columnKeys(star, "Active Starlink satellites by launch month", 0);
  assert.equal(months.length, 24);
  assert.deepEqual(sortedTexts(months), months.map((m) => m.text), "ascending is the calendar order");
  assert.deepEqual(sortedTexts(months, true), [...months.map((m) => m.text)].reverse());
  const doc = launchesDoc();
  doc.launches.push({ ...doc.launches[1], id: "b1", name: "Early November | x", net: "2026-11-02T10:00:00Z", precision: "MIN" });
  const lp = renderPage(launchesPage(summariseLaunches(doc, { now }), { coast: [] }));
  const times = columnKeys(lp, "The next 6 launches in the list, soonest first", 0);
  assert.deepEqual(sortedTexts(times), ["6 October 2026, 20:15 UTC", "9 October 2026, in the hour from 03:00 UTC", "12 October 2026, 18:00 UTC", "October 2026, day not set", "2 November 2026, 10:00 UTC", "the fourth quarter of 2026, day not set"],
    "a month sorts at the source's own planned time (31 October), a quarter at 31 December, never as the number 2026");
  // every date or time in a table of these pages carries a sort value
  for (const h of [dis, star, lp]) for (const t of h.match(/<table>[\s\S]*?<\/table>/g)) for (const tm of t.match(/<time [^>]*>/g) || []) assert.match(tm, /data-sort="\d{4}-\d\d/, tm);
  // shares sort by the share, so "under 1" sits below 1
  const bands = columnKeys(star, "Active Starlink satellites by 10 km band of mean altitude", 2);
  assert.ok(bands.every((c) => typeof c.key === "number"));
});

// ------------------------------------------------------------------ smaller items
test("the script runs only on pages of its own version, taken from the constant", () => {
  const src = liveScriptSource();
  assert.ok(src.includes(`liveMain(document, window, ${JSON.stringify(String(LIVE_SCRIPT_VERSION))})`));
  assert.ok(!/getAttribute\("data-live-v"\) !== "1"/.test(src), "no version written into liveMain itself");
  const run = (v) => { let touched = false; vm.runInNewContext(src, { document: { body: { getAttribute: (k) => (k === "data-live-v" ? v : null) }, head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => { touched = true; return []; }, querySelector: () => null }, window: {}, Intl, Date, Math, JSON, Promise, Object, Array, String, Number, isFinite, isNaN }); return touched; };
  assert.equal(run(String(LIVE_SCRIPT_VERSION)), true, "a page of this version is enhanced");
  assert.equal(run(String(LIVE_SCRIPT_VERSION + 1)), false, "a page of another version is left alone");
});

test("no current event reads as such, not as 'all 0 events are Green'", () => {
  const s = summariseDisasters(eventsList().filter((e) => !e.current || e.type === "EQ"), { now, dataTime: EV_TIME });
  assert.equal(s.current, 0);
  const t = texts(disasterFindings(s));
  assert.ok(t.includes("GDACS lists no current event on this page (earthquakes are left out).") && !/all 0/.test(t), t);
});

test("an NHC storm without a name is matched by position the same way on the page and in the refresh", () => {
  const list = [{ id: "40", type: "TC", name: "Tropical Cyclone X-26", alert: "Green", country: "", from: "2026-10-04T00:00:00", to: "2026-10-06T00:00:00", current: true, lat: 15, lon: -120, severity: "x", url: "" }, ...eventsList().slice(1)];
  for (const storms of [{ generated: "2026-10-06T00:20:00Z", storms: [{ lat: 15.5, lon: -121 }] }, { generated: "2026-10-06T00:20:00Z", storms: [{ name: null, lat: 15.5, lon: -121 }] }, { generated: "2026-10-06T00:20:00Z", storms: [{ name: "", lat: 30, lon: -60 }] }]) {
    const s = summariseDisasters(list, { now, dataTime: EV_TIME, storms });
    assert.equal(String(s.current), disastersHeadline(list, storms, EV_TIME).current, JSON.stringify(storms.storms));
  }
  const s = summariseDisasters(list, { now, dataTime: EV_TIME, storms: { generated: "2026-10-06T00:20:00Z", storms: [{ lat: 15.5, lon: -121 }] } });
  assert.deepEqual(s.duplicates, [{ name: "Tropical Cyclone X-26", nhc: "an unnamed storm" }]);
});

test("Starlink: the 30 day count and its wording agree (the 30 days to the data day, that day included)", () => {
  const h = renderPage(starlinkPage(S, { coast: [] }));
  assert.ok(!/30 days before the data time/.test(h));
  assert.ok(textOf(h).includes(`${S.last30} of the active ones were launched in the 30 days to 5 October 2026, that day included.`));
});

test("descriptions are under 160 characters, not up to 160", () => {
  const src = fs.readFileSync(path.join(root, "site/pages-events.mjs"), "utf8");
  assert.ok(!/length <= 160/.test(src));
});
