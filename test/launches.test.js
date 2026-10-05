import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isExact, whenText, countdown, upcoming, groups, padDistanceKm, distanceText, split, statusLine, soonCount } from "../src/launches.js";

const DOC = JSON.parse(fs.readFileSync(new URL("./fixtures/hazards/launches.json", import.meta.url), "utf8"));
const NOW = Date.parse(DOC.generated);
const by = (p) => DOC.launches.find((l) => l.precision === p);

test("the fixture is the real feed output and covers every kind of time precision seen so far", () => {
  assert.equal(DOC.launches.length, 30);
  for (const p of ["SEC", "MIN", "HR", "M", "Q4"]) assert.ok(by(p), p);
});

test("exact times are only SEC, MIN and HR", () => {
  assert.deepEqual(DOC.launches.filter(isExact).map((l) => l.precision).sort(), ["HR", "MIN", "MIN", "MIN", "SEC", "SEC", "SEC"]);
  assert.equal(isExact({ precision: "M" }), false);
  assert.equal(isExact({ precision: null }), false);
  assert.equal(isExact({}), false);
});

test("a vague date is never worded as an exact one", () => {
  const month = whenText(by("M"), "Asia/Kolkata");
  assert.match(month, /^Expected in \w+ 2026, day not set$/);
  assert.doesNotMatch(month, /\d{2}:\d{2}/);
  assert.match(whenText(by("Q4"), "Asia/Kolkata"), /^Expected in the fourth quarter of 2026$/);
  assert.match(whenText({ net: "2027-01-31T00:00:00Z", precision: "Q1" }, "UTC"), /first quarter of 2027/);
  assert.match(whenText({ net: "2027-04-30T00:00:00Z", precision: "Q2" }, "UTC"), /second quarter/);
  assert.match(whenText({ net: "2027-09-30T00:00:00Z", precision: "Q3" }, "UTC"), /third quarter/);
  const unknown = whenText({ net: "2027-03-01T00:00:00Z", precision: "H1", precisionName: "Half 1" }, "UTC");
  assert.match(unknown, /not an exact date/);
  assert.match(unknown, /Half 1/);
  assert.doesNotMatch(unknown, /\d{2}:\d{2}/);
});

test("exact times are shown in the place's zone, to the minute", () => {
  const l = { net: "2026-10-07T03:23:00Z", precision: "MIN" };
  assert.equal(whenText(l, "UTC"), "Wed 7 Oct, 03:23");
  assert.equal(whenText(l, "Asia/Kolkata"), "Wed 7 Oct, 08:53");
  assert.equal(whenText(l, "America/New_York"), "Tue 6 Oct, 23:23");
  assert.match(whenText({ net: "2026-10-09T19:25:00Z", precision: "HR" }, "UTC"), /^Fri 9 Oct, in the hour starting 19:25$/);
});

test("month and quarter use the UTC date, whatever the viewer's zone", () => {
  const l = { net: "2026-10-31T00:00:00Z", precision: "M" };
  assert.match(whenText(l, "Pacific/Auckland"), /October 2026/);
  assert.match(whenText(l, "America/Los_Angeles"), /October 2026/);
});

test("countdown only for exact times", () => {
  const first = DOC.launches[0];
  assert.equal(first.precision, "SEC");
  assert.match(countdown(first, NOW), /^in \d+ h$/);
  assert.equal(countdown(by("M"), NOW), null);
  assert.equal(countdown(by("Q4"), NOW), null);
});

test("upcoming drops what left more than six hours ago and keeps the rest in order", () => {
  assert.equal(upcoming(DOC, NOW).length, 30);
  assert.equal(upcoming(DOC, NOW + 3 * 86400e3).length, DOC.launches.filter((l) => Date.parse(l.net) >= NOW - 6 * 3600e3 + 3 * 86400e3).length);
  assert.equal(upcoming(DOC, Date.parse("2030-01-01T00:00:00Z")).length, 0);
  assert.deepEqual(upcoming(null, NOW), []);
  assert.deepEqual(upcoming({}, NOW), []);
  const t = upcoming(DOC, NOW).map((l) => l.net);
  assert.deepEqual(t, [...t].sort());
});

test("groups split firm times from planned months and quarters", () => {
  const g = groups(DOC.launches);
  assert.equal(g.firm.length, 7);
  assert.equal(g.loose.length, 23);
  assert.ok(g.firm.every(isExact) && g.loose.every((l) => !isExact(l)));
});

test("distance from a place to the pad", () => {
  const vandenberg = DOC.launches[0];
  const la = { lat: 34.05, lon: -118.24 };
  const km = padDistanceKm(vandenberg, la);
  // Vandenberg SLC-4E (34.632, -120.611) to downtown Los Angeles: about 2.0 degrees of longitude (x cos 34 degrees) and 0.58 of latitude, roughly 227 km
  assert.ok(km > 220 && km < 235, `${km}`);
  assert.equal(padDistanceKm({ lat: null, lon: null }, la), null);
  assert.equal(distanceText(null), "");
  assert.equal(distanceText(42.4), "42 km from you");
  assert.equal(distanceText(12345), "about 12,350 km from you");
  assert.ok(padDistanceKm(vandenberg, { lat: vandenberg.lat, lon: vandenberg.lon }) < 0.01);
});

test("vehicle and mission come from the source's name or its own fields", () => {
  const f = DOC.launches[0];
  assert.deepEqual(split(f), { vehicle: "Falcon 9 Block 5", mission: f.mission });
  assert.deepEqual(split({ name: "H3-24 | Martian Moon eXplorer (MMX)", mission: null }), { vehicle: "H3-24", mission: "Martian Moon eXplorer (MMX)" });
  assert.deepEqual(split({ name: "Mystery", rocket: "Rocket X", mission: null }), { vehicle: "Rocket X", mission: null });
});

test("status is the source's wording", () => {
  assert.equal(statusLine({ statusName: "Go for Launch", status: "Go" }), "Go for Launch");
  assert.equal(statusLine({ status: "Go" }), "Go");
  assert.equal(statusLine({}), "status not given");
  for (const l of DOC.launches) assert.ok(statusLine(l).length > 1);
});

test("the home tile counts only firm launches in the next week", () => {
  const n = soonCount(DOC, NOW, 7);
  assert.equal(n, DOC.launches.filter((l) => isExact(l) && Date.parse(l.net) <= NOW + 7 * 86400e3).length);
  assert.ok(n >= 3);
  assert.equal(soonCount(DOC, NOW, 0), 0);
  assert.equal(soonCount(null, NOW), 0);
});

// ---- webcasts, live badge, countdown, embed
import { platformName, watchLinks, isLive, hasEmbed, embedUrl, tMinus } from "../src/launches.js";
const vid = (o = {}) => ({ url: "https://www.youtube.com/watch?v=FJpcyVk9vaI", host: "youtube.com", type: "Official Webcast", official: true, publisher: "SpaceX", live: false, start: null, youtube: "FJpcyVk9vaI", ...o });

test("platform names", () => {
  assert.equal(platformName("youtube.com"), "YouTube");
  assert.equal(platformName("www.youtube.com"), "YouTube");
  assert.equal(platformName("x.com"), "X");
  assert.equal(platformName("global.nasa.example"), "global.nasa.example");
  assert.equal(platformName("nasa.gov"), "NASA");
  assert.equal(platformName(""), "web");
  assert.equal(platformName(null), "web");
});

test("watch links are labelled with the source's own words and keep their order", () => {
  const w = watchLinks({ videos: [vid(), vid({ url: "https://www.youtube.com/watch?v=abcdefghijk", type: "Unofficial Re-stream", official: false, publisher: "SPACE AFFAIRS", youtube: "abcdefghijk" }), vid({ url: "https://x.com/i/broadcasts/1yKAPwdemygxb", host: "x.com", youtube: null, publisher: null })] });
  assert.deepEqual(w.map((x) => x.label), ["Official Webcast (YouTube, SpaceX)", "Unofficial Re-stream (YouTube, SPACE AFFAIRS)", "Official Webcast (X)"]);
  assert.deepEqual(w.map((x) => x.official), [true, false, true]);
});

test("links that are not https, or are not objects, are never shown", () => {
  const w = watchLinks({ videos: [vid({ url: "http://www.youtube.com/watch?v=FJpcyVk9vaI" }), vid({ url: "javascript:alert(1)" }), vid({ url: "//evil.example/x" }), vid({ url: "https://" }), null, "x", { url: 5 }, vid()] });
  assert.equal(w.length, 1);
  assert.equal(watchLinks(null).length, 0);
  assert.equal(watchLinks({}).length, 0);
  assert.equal(watchLinks({ videos: "no" }).length, 0);
});

test("only an official YouTube webcast with a valid id can be played in the page", () => {
  const w = watchLinks({ videos: [
    vid(), vid({ official: false, type: "Unofficial Webcast" }), vid({ youtube: "bad id!" }), vid({ youtube: "short" }), vid({ youtube: "<script>aaaa" }),
    vid({ url: "https://x.com/i/broadcasts/abc", host: "x.com" }), vid({ url: "https://evil.example/watch?v=FJpcyVk9vaI", host: "evil.example" }), vid({ youtube: null }),
  ] });
  assert.deepEqual(w.map((x) => x.embedId), ["FJpcyVk9vaI", null, null, null, null, null, null, null]);
  assert.equal(hasEmbed({ videos: [vid()] }), true);
  assert.equal(hasEmbed({ videos: [vid({ official: false })] }), false);
  assert.equal(hasEmbed({}), false);
});

test("the player address is built only from a valid id and uses the no-cookie domain", () => {
  assert.equal(embedUrl("FJpcyVk9vaI"), "https://www.youtube-nocookie.com/embed/FJpcyVk9vaI?autoplay=1&rel=0&playsinline=1");
  for (const bad of ["", "short", "FJpcyVk9vaI1", "FJpcy k9vaI", "../../evil1234", "<script>aaa", null, undefined, 5, "FJpcyVk9va\"onload=1"]) assert.equal(embedUrl(bad), null, String(bad));
});

test("live now follows the source's flag and nothing else", () => {
  assert.equal(isLive({ liveNow: true }), true);
  for (const x of [{ liveNow: false }, { liveNow: "true" }, { webcast: true }, {}, null]) assert.equal(isLive(x), false);
});

test("the countdown ticks to the second for a minute-accurate time and says nothing beyond 24 hours", () => {
  const at = Date.parse("2026-10-07T03:23:00Z");
  const l = { net: "2026-10-07T03:23:00Z", precision: "MIN" };
  assert.equal(tMinus(l, at - (3 * 3600 + 12 * 60 + 45) * 1000).text, "T-minus 03:12:45");
  assert.equal(tMinus(l, at - 1000).text, "T-minus 00:00:01");
  assert.equal(tMinus(l, at - 86399000).text, "T-minus 23:59:59");
  assert.equal(tMinus(l, at - 86400000).text, "T-minus 24:00:00");
  assert.equal(tMinus(l, at - 86401000), null);
  assert.equal(tMinus(l, at - 3600e3).ticking, true);
  // consecutive seconds count down
  const a = tMinus(l, at - 100000).text, b = tMinus(l, at - 99000).text;
  assert.equal(a, "T-minus 00:01:40"); assert.equal(b, "T-minus 00:01:39");
});

test("an hour-accurate time is not shown with false precision, and a vague date has no countdown", () => {
  const hr = { net: "2026-10-09T19:25:00Z", precision: "HR" };
  const t = tMinus(hr, Date.parse(hr.net) - 5.2 * 3600e3);
  assert.match(t.text, /^About 5 h to go \(the time is only accurate to the hour\)$/);
  assert.equal(t.ticking, false);
  assert.doesNotMatch(t.text, /\d\d:\d\d/);
  assert.equal(tMinus({ net: "2026-10-31T00:00:00Z", precision: "M" }, Date.parse("2026-10-30T12:00:00Z")), null);
  assert.equal(tMinus({ net: "2026-12-31T00:00:00Z", precision: "Q4" }, Date.parse("2026-12-30T12:00:00Z")), null);
  assert.equal(tMinus(null, 0), null);
  assert.equal(tMinus({ net: "nonsense", precision: "MIN" }, 0), null);
});

test("a time that has just passed does not claim the launch happened, and goes quiet after six hours", () => {
  const l = { net: "2026-10-07T03:23:00Z", precision: "MIN" }, at = Date.parse(l.net);
  const t = tMinus(l, at + 12 * 60000);
  assert.match(t.text, /^The planned time passed 12 min ago\. Waiting for the source to update\.$/);
  assert.doesNotMatch(t.text, /launched|T\+/i);
  assert.equal(t.ticking, false);
  assert.equal(tMinus(l, at + 6 * 3600e3 + 1000), null);
  assert.match(tMinus(l, at + 100).text, /1 min ago/);
});
