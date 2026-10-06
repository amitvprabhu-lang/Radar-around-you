import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubPage, countryPage, countryPageSet, bandLabel, mapSummaryText, COUNTRY_FILES, HUB_FILE, LIVE_FILES, sitemapLive } from "../site/pages-country.mjs";
import { COUNTRY_PAGES, countOwners, ownerPositions, latitudeSummary } from "../site/satcountry.mjs";
import { SATCOUNT_FILE, satelliteCountPage } from "../site/pages-satcount.mjs";
import { countSatellites, ORBIT_ORDER, ORBIT_CHART_LABELS } from "../site/satcount.mjs";
import { renderPage, SITE, NAV, urlPath } from "../site/layout.mjs";
import { decodeCoast } from "../src/data.js";
import { countryFixture, buildFixture } from "./helpers/satfixture.mjs";
import { launchDayFromIso } from "../src/core.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const coastBuf = fs.readFileSync(path.join(root, "public/coast.bin"));
const coast = decodeCoast(coastBuf.buffer.slice(coastBuf.byteOffset, coastBuf.byteOffset + coastBuf.byteLength));
const updated = new Date("2026-10-05T09:00:00Z");
const fx = countryFixture();
const counts = countOwners(fx);
const set = countryPageSet(fx, { coast, updated });
const html = new Map(set.pages.map((p) => [p.file, renderPage(p, { noindex: false })]));
const hub = html.get(HUB_FILE);
const bySlug = (slug) => html.get(COUNTRY_PAGES.find((p) => p.slug === slug).file);
const owner = (name) => counts.owners.find((o) => o.name === name);
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([,.;)])/g, "$1").replace(/\( /g, "(").trim();
const num = (n) => n.toLocaleString("en-GB");
const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const tableCells = (h, caption) => {
  const m = h.match(new RegExp(`aria-label="${caption.replace(/[()]/g, "\\$&")}"[\\s\\S]*?</table>`));
  assert.ok(m, caption);
  return [...m[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
};
const tableNums = (h, caption, col = 1) => tableCells(h, caption).map((cells) => cells[col]);
const sum = (a) => a.reduce((s, x) => s + Number(String(x).replace(/,/g, "")), 0);
const faqOf = (h) => [...h.slice(h.indexOf('id="faq"')).matchAll(/<h3>([^<]*)<\/h3>\n<p>([\s\S]*?)<\/p>/g)].map((m) => [textOf(m[1]), textOf(m[2])]);

// the bundled snapshot, the real data the deploy-time copy is built from
const real = { meta: JSON.parse(fs.readFileSync(path.join(root, "public/meta.json"), "utf8")), details: fs.readFileSync(path.join(root, "public/details.bin")), swarm: fs.readFileSync(path.join(root, "public/swarm.bin")), names: fs.readFileSync(path.join(root, "public/names.txt"), "utf8") };
const realSet = countryPageSet(real, { coast, updated });

test("the hub and the five country pages have fixed addresses and one h1 each", () => {
  assert.deepEqual(COUNTRY_FILES, ["united-states", "china", "united-kingdom", "cis-former-ussr", "japan"].map((s) => `satellites-by-country/${s}/index.html`));
  assert.deepEqual(set.pages.map((p) => p.file), [HUB_FILE, ...COUNTRY_FILES]);
  assert.deepEqual(set.skipped, []);
  for (const [f, h] of html) {
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, f);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`), f);
  }
  assert.equal(bySlug("china").match(/<h1>([^<]*)<\/h1>/)[1], "How many satellites does China have?");
  assert.match(hub, /<h1>Which countries have the most satellites\?<\/h1>/);
});

test("all seven live titles are 60 characters or fewer, unique and owner first, and descriptions are 160 or fewer, even on the longest date", () => {
  for (const taken of ["2026-09-30T23:59:00Z", "2026-10-05T08:14:54Z"]) {
    for (const data of [fx, real]) {
      const c = { ...countOwners(data), taken };
      const pages = [satelliteCountPage({ ...countSatellites(data), taken }, { updated }), hubPage(c, { updated }),
        ...COUNTRY_PAGES.map((p) => countryPage(c, p, { updated, coast, positions: [] }))];
      assert.equal(new Set(pages.map((p) => p.title)).size, 7, "unique titles");
      for (const p of pages) {
        assert.ok(p.title.length >= 15 && p.title.length <= 60, `${p.file}: title ${p.title.length}: ${p.title}`);
        assert.ok(p.description.length >= 60 && p.description.length <= 160, `${p.file}: description ${p.description.length}: ${p.description}`);
      }
      for (const [i, p] of COUNTRY_PAGES.entries()) assert.ok(pages[i + 2].title.startsWith(`${p.name} satellites: live count, `), pages[i + 2].title);
    }
  }
  assert.equal(countryPage(counts, COUNTRY_PAGES[3], { updated, coast, positions: [] }).title, "CIS (former USSR) satellites: live count, 5 October 2026");
});

test("every country page has its sections, an answer-first lead in plain grammar, and no heading repeats the h1", () => {
  for (const p of COUNTRY_PAGES) {
    const h = html.get(p.file), o = owner(p.owner);
    for (const id of ["answer", "orbits", "map", "purpose", "growth", "how", "faq", "sources"]) assert.ok(h.includes(` id="${id}"`), `${p.slug}: ${id}`);
    assert.equal(textOf(h.match(/<p class="lead">([\s\S]*?)<\/p>/)[1]), `As of 5 October 2026, 08:14 UTC, the catalogue records ${num(o.active)} active satellites for ${p.phrase}, ${pct(o.active / counts.active)} percent of the catalogue's active satellites.`);
    assert.ok(!/world's/.test(h), `${p.slug}: says the catalogue's, not the world's`);
  }
  for (const [f, h] of [...html, ...realSet.pages.map((p) => [p.file, renderPage(p)])]) {
    const h1 = textOf(h.match(/<h1>([^<]*)<\/h1>/)[1]), h2 = textOf(h.match(/<h2 id="answer">([^<]*)<\/h2>/)[1]), q1 = faqOf(h)[0][0];
    assert.equal(new Set([h1, h2, q1]).size, 3, `${f}: ${h1} | ${h2} | ${q1}`);
  }
  for (const id of ["answer", "pages", "ranking", "concentration", "orbits", "read", "method", "faq", "sources"]) assert.ok(hub.includes(` id="${id}"`), `hub: ${id}`);
});

test("the numbers on each country page match countOwners", () => {
  for (const p of COUNTRY_PAGES) {
    const h = html.get(p.file), o = owner(p.owner), t = textOf(h);
    const rows = tableCells(h, "By orbit group, largest first");
    const used = ORBIT_ORDER.filter((k) => o.orbits[k] > 0).sort((a, b) => o.orbits[b] - o.orbits[a] || ORBIT_ORDER.indexOf(a) - ORBIT_ORDER.indexOf(b));
    assert.deepEqual(rows.map((r) => r[0]), used.map((k) => ORBIT_CHART_LABELS[k]), `${p.slug}: largest first`);
    assert.deepEqual(rows.map((r) => Number(r[1].replace(/,/g, ""))), used.map((k) => o.orbits[k]), p.slug);
    assert.equal(sum(rows.map((r) => r[1])), o.active, `${p.slug}: orbits add up`);
    assert.deepEqual(rows.map((r) => r[3]), used.map((k) => pct(counts.orbits[k] / counts.active)), `${p.slug}: catalogue shares`);
    assert.equal(sum(tableNums(h, "By purpose, largest first")), o.active, `${p.slug}: purposes`);
    assert.match(h, /<desc id="chart-years-d">[^<]*table below gives the numbers/, `${p.slug}: the chart points to its table`);
    assert.ok(t.includes(textOf(mapSummaryText(ownerPositions(fx, p.owner)))), `${p.slug}: map summary`);
    assert.match(h, /<svg [^>]*class="map" role="img"/, `${p.slug}: map`);
    assert.ok(t.includes(`Recorded as "${p.owner}", ${p.slug === "united-states" ? "the largest fleet" : `the ${["", "", "2nd", "3rd", "4th", "5th"][COUNTRY_PAGES.indexOf(p) + 1]} largest fleet`} among 6 owners.`), `${p.slug}: rank`);
  }
  assert.equal(sum(tableNums(bySlug("united-states"), "Largest name families")), 130);
  assert.deepEqual(tableNums(bySlug("china"), "Largest name families", 0), ["YAOGAN", "BEIDOU"]);
  assert.deepEqual(tableCells(bySlug("united-states"), "Recent launches by launch date (two launches on one day share a row)").map((r) => r.map(textOf)),
    [["1 May 2011", "1", "FLOCK 4Y-75", "None"], ["1 March 2020", "1", "STARLINK-1000", "None"], ["1 March 2021", "1", "STARLINK-1001", "None"]]);
  for (const p of COUNTRY_PAGES) {
    const o = owner(p.owner), h = html.get(p.file);
    assert.equal(sum(tableNums(h, "By launch year")), o.active, `${p.slug}: the launch year table adds up`);
    assert.equal(sum(tableNums(h, "Largest name families")), o.active, `${p.slug}: families and the unnamed add up`);
  }
  assert.ok(textOf(bySlug("united-states")).includes("Starlink makes up 70 of them; the other 60 are not Starlink."));
  assert.ok(!textOf(bySlug("china")).includes("Starlink"), "no Starlink text when there are none");
});

test("the FAQ is chosen and answered from each owner's own numbers", () => {
  const q = (slug) => faqOf(bySlug(slug));
  assert.deepEqual(q("united-states"), [
    ["Where does the United States rank among satellite owners?", "First. China follows with 90."],
    ["How much of this fleet is Starlink?", `${pct(70 / 130)} percent. Starlink alone is ${pct(70 / 402)} percent of our whole count.`],
    ["How many were launched in the last 30 days?", "3 of the 6 active satellites launched in the 30 days before the data time."]]);
  assert.deepEqual(q("china"), [
    ["Where does China rank among satellite owners?", "2nd. The United States is ahead with 130; the United Kingdom follows with 66."],
    ["Which name family is largest among satellites the catalogue records for China?", "YAOGAN, with 68, ahead of BEIDOU with 22."],
    ["How many were launched in the last 30 days?", "1 of the 6 active satellites launched in the 30 days before the data time."]]);
  // Japan's two families tie at 26, so there is no "largest family" answer; its largest recorded purpose is asked instead
  assert.deepEqual(q("japan")[1], ["What are most satellites the catalogue records for Japan used for?", "Weather and climate, the largest recorded purpose (18)."]);
  const uk = owner("United Kingdom");
  assert.deepEqual(q("united-kingdom")[2], ["Which orbit group stands out for the United Kingdom?", `Low Earth orbit: ${pct(1)} percent of this fleet, catalogue ${pct(counts.orbits.low / counts.active)}.`]);
  assert.equal(uk.last30, 0);
  assert.ok(!q("china").some(([x]) => /Starlink/.test(x)), "no Starlink question without Starlink");
  const texts = COUNTRY_PAGES.map((p) => JSON.stringify(q(p.slug).map((x) => x[1])));
  assert.equal(new Set(texts).size, 5, "no two pages have the same answers");
});

test("the 30 day answer counts satellites, never launches", () => {
  for (const p of [...set.pages, ...realSet.pages].slice(0)) {
    const h = renderPage(p), t = textOf(h);
    assert.ok(!/recent launches/.test(t), `${p.file}: says launches`);
    for (const m of t.matchAll(/How many were launched in the last 30 days\? ([^?]*?\.)/g)) assert.match(m[1], /^[\d,]+ of the [\d,]+ active satellites launched in the 30 days before the data time\.$/, p.file);
  }
  assert.ok(textOf(renderPage(realSet.pages[2])).includes("of the 160 active satellites launched in the 30 days before the data time."), "the real figure names satellites");
  const china = textOf(renderPage(realSet.pages[2]));
  assert.ok(china.includes("How many satellites the catalogue records for China have a purpose group?"), "China has more unrecorded than its top group");
  assert.ok(!/Broadband internet, the largest recorded purpose/.test(china));
});

// a small owner with chosen names, launch dates and recent satellites, for the name based sections
const D = launchDayFromIso;
function namedFleet(objs, newIdx) {
  const base = Array.from({ length: 52 - objs.length }, (_, j) => ({ type: 0, status: 1, owner: 1, alt: 600, purpose: 4, launchDay: D("2015-01-01"), name: `ALPHA-${j}` }));
  const fxN = buildFixture([...objs.map((o) => ({ type: 0, status: 1, owner: 1, alt: 600, purpose: 4, ...o })), ...base], { owners: ["Japan"], ref: Date.parse("2026-10-05T08:14:54Z"), newIdx });
  const c = countOwners(fxN);
  return { c, h: renderPage(countryPage(c, COUNTRY_PAGES[4], { updated, coast, positions: [] })) };
}

test("recent launches: named satellites are listed by launch date and those with only a launch designator are counted, never shown as names", () => {
  const mixed = namedFleet([{ name: "STRIX-10", launchDay: D("2026-09-19") }, { name: "2026-205A", launchDay: D("2026-09-10") }, { name: "2026-205B", launchDay: D("2026-09-10") }, { name: "2026-220A", launchDay: D("2026-09-21") }], [0, 1, 2, 3]);
  const t = textOf(mixed.h);
  assert.ok(t.includes("4 of these satellites were launched in the 30 days before the data time. 1 has a name in the catalogue and 3 have only a launch designator so far, for example 2026-205A."), t);
  assert.deepEqual(tableCells(mixed.h, "Recent launches by launch date (two launches on one day share a row)").map((r) => r.map(textOf)),
    [["10 September 2026", "2", "None", "2 (2026-205)"], ["19 September 2026", "1", "STRIX-10", "None"], ["21 September 2026", "1", "None", "1 (2026-220)"]]);
  const only = textOf(namedFleet([{ name: "2026-205A", launchDay: D("2026-09-10") }, { name: "2026-205B", launchDay: D("2026-09-10") }], [0, 1]).h);
  assert.ok(only.includes("2 of these satellites were launched in the 30 days before the data time. Both have only a launch designator so far, for example 2026-205A, so they are not named in the catalogue yet."), only);
  const none = namedFleet([], []).h;
  assert.ok(!none.includes('id="recent"'), "no section without recent satellites");
  const many = namedFleet(Array.from({ length: 5 }, (_, k) => ({ name: `QPS-SAR ${k}`, launchDay: D("2026-09-19") })), [0, 1, 2, 3, 4]).h;
  assert.ok(textOf(many).includes("QPS-SAR 0, QPS-SAR 1, QPS-SAR 2 and 2 more"));
});

test("name families count the unnamed, and the largest-family answer appears only when the unnamed cannot change it and nobody ties", () => {
  const fam = (n, name) => Array.from({ length: n }, (_, k) => ({ name: `${name}-${k}` }));
  // a 5 satellite lead and 5 unnamed: the unnamed could reverse it, so no family answer
  const close = namedFleet([...fam(22, "QPS"), ...fam(17, "STRIX"), ...fam(8, "ZZ"), ...Array.from({ length: 5 }, (_, k) => ({ name: `2026-1${k}0A` }))], []);
  const tc = textOf(close.h);
  assert.ok(tc.includes("Our own grouping by the run of two or more letters that starts each catalogue name"), "the grouping is described as ours, as the code applies it");
  assert.ok(tc.includes("5 of these satellites (9.6 percent) have no name family: they have only a launch designator so far."), tc);
  assert.ok(!/Which name family is largest/.test(tc));
  assert.deepEqual(tableCells(close.h, "Largest name families").at(-1).slice(0, 3).map(textOf), ["No name family", "5", "9.6"]);
  // a lead bigger than the unnamed: answered, with every runner-up that ties named
  const clear = namedFleet([...fam(30, "QPS"), ...fam(5, "STRIX"), ...fam(5, "GRUS"), ...fam(4, "AA"), ...fam(4, "BB"), ...fam(3, "CC"), { name: "2026-150A" }], []);
  assert.ok(textOf(clear.h).includes("Which name family is largest among satellites the catalogue records for Japan? QPS, with 30, ahead of GRUS and STRIX with 5 each; 1 has no name family, too few to change that order."), textOf(clear.h));
  // the group column: named "Most common CelesTrak group", explained under the table, and blank of a label below 5 satellites
  assert.ok(close.h.includes('<th scope="col">Most common CelesTrak group</th>') && !close.h.includes("Main recorded purpose"));
  assert.ok(tc.includes("The group is the CelesTrak list a satellite is in, as the collector maps those lists to purposes; a satellite in several lists gets only one of them"));
  const famRows = tableCells(clear.h, "Largest name families").map((r) => r.map(textOf));
  assert.deepEqual(famRows.find((r) => r[0] === "QPS")[4], "Earth observation");
  assert.deepEqual(famRows.find((r) => r[0] === "AA")[4], "Fewer than 5 satellites");
  assert.deepEqual(famRows.find((r) => r[0] === "GRUS")[4], "Earth observation", "exactly 5 shows the group");
  // a tie for first: no ranking
  const tie = namedFleet([...fam(26, "GRUS"), ...fam(26, "JCSAT")], []);
  assert.ok(!/Which name family is largest/.test(textOf(tie.h)));
  assert.ok(textOf(tie.h).includes("Every one of these satellites has a name family."));
});

test("satellites with no name family are worded by kind: a launch designator, or a name that does not start with two or more letters", () => {
  const odd = namedFleet([{ name: "Z-SAT" }, { name: "S5" }, { name: "123 SAT" }, { name: "2026-205A" }, { name: "QIANFAN 16 OBJECT A" }, { name: "R5-S4" }], []);
  const t = textOf(odd.h);
  assert.ok(t.includes("5 of these satellites (9.6 percent) have no name family: 1 has only a launch designator so far; 4 have names that do not start with two or more letters, such as 123 SAT, R5-S4 and S5."), t);
  assert.equal(odd.c.owners[0].families.find((f) => f.name === "QIANFAN").count, 1, "a placeholder such as QIANFAN 16 OBJECT A is a real name with a family");
  const one = textOf(namedFleet([{ name: "Z-SAT" }], []).h);
  assert.ok(one.includes("1 of these satellites (1.9 percent) has no name family: its name does not start with two or more letters, such as Z-SAT."), one);
});

test("the earliest launches name every satellite of the earliest days, up to three each", () => {
  const h = namedFleet([{ name: "OLD-A", launchDay: D("1990-01-01") }, { name: "OLD-B", launchDay: D("1990-01-01") }, { name: "OLD-C", launchDay: D("1990-01-01") }, { name: "OLD-D", launchDay: D("1990-01-01") }, { name: "MID", launchDay: D("1995-06-01") }], []).h;
  assert.ok(textOf(h).includes("Earliest launches among satellites the catalogue lists as active:"));
  assert.deepEqual(tableCells(h, "Earliest launches still listed as active").map((r) => r.map(textOf)),
    [["1 January 1990", "OLD-A, OLD-B, OLD-C and 1 more launched the same day"], ["1 June 1995", "MID"], ["1 January 2015", "ALPHA-0, ALPHA-1, ALPHA-10 and 44 more launched the same day"]]);
  assert.ok(!/oldest still active|Newest/i.test(textOf(h)));
});

test("without names.txt every name based section is left out cleanly and the rest of the page is unchanged in shape", () => {
  const plain = countryPageSet({ ...fx, names: null }, { coast, updated });
  assert.equal(plain.pages.length, 6);
  for (const p of plain.pages.slice(1)) {
    const h = renderPage(p), t = textOf(h);
    for (const id of ["names", "recent"]) assert.ok(!h.includes(` id="${id}"`), `${p.file}: ${id}`);
    assert.ok(!t.includes("Earliest launches") && !t.includes("name family"), p.file);
    for (const id of ["answer", "orbits", "map", "purpose", "growth", "how", "faq", "sources"]) assert.ok(h.includes(` id="${id}"`), `${p.file}: ${id}`);
    assert.ok(!/NaN|undefined|null/.test(t), p.file);
  }
});

test("each statement is a full sentence, not a fragment", () => {
  const t = textOf(renderPage(realSet.pages[2]));
  assert.match(t, /Satellites closer than 0\.1 degree share a dot, so the map has [\d,]+ dots\./);
  assert.match(t, /After it come [A-Za-z ]+ \([\d,]+\), [A-Za-z ]+ \([\d,]+\) and [A-Za-z ]+ \([\d,]+\)\./);
  assert.ok(!/ Next: |Peak \d|Undated:/.test(t));
});

test("the map text never decides north or south from satellites within one degree of the equator, and says how many there are", () => {
  const far = [[45, 0, "low"], [50, 1, "low"], [-20, 2, "low"]];
  const a = mapSummaryText([...far, [0.4, 0, "geostationary"], [0.3, 1, "geostationary"], [-0.2, 2, "low"]]);
  const b = mapSummaryText([...far, [-0.4, 0, "geostationary"], [-0.3, 1, "geostationary"], [0.2, 2, "low"]]);
  assert.equal(a, b, "points straddling the equator within half a degree change nothing");
  assert.equal(a, `3 within 1 degree of the equator (2 geostationary) are not placed north or south. Busiest band of the rest: 30 to 60 degrees north, ${pct(2 / 3)} percent; ${pct(2 / 3)} percent north of the equator.`);
  const allNear = [[0.2, 10, "geostationary"], [-0.6, 20, "geostationary"]];
  assert.equal(mapSummaryText(allNear), "All 2 within 1 degree of the equator (all geostationary) are not placed north or south.");
  const page = renderPage(countryPage(counts, COUNTRY_PAGES[4], { updated, coast, positions: allNear }));
  assert.ok(textOf(page).includes("All 2 within 1 degree of the equator (all geostationary) are not placed north or south."));
  assert.ok(!/NaN|undefined|null/.test(textOf(page)));
  assert.equal(mapSummaryText([[10, 0, "low"]]), `Busiest band: the equator to 30 degrees north, ${pct(1)} percent; ${pct(1)} percent north of the equator.`);
  assert.equal(mapSummaryText([]), "");
  // on the fixture's Japan, half of whose satellites are geostationary, the near-equator ones are reported and left out
  const jp = latitudeSummary(ownerPositions(fx, "Japan"));
  assert.ok(jp.near === 26 && jp.nearGeo === 26);
  assert.ok(textOf(bySlug("japan")).includes("26 within 1 degree of the equator (all geostationary) are not placed north or south. Busiest band of the rest:"));
});

test("latitude bands are named plainly", () => {
  assert.deepEqual([-90, -60, -30, 0, 30, 60].map((from) => bandLabel({ from, to: from + 30 })), [
    "60 to 90 degrees south", "30 to 60 degrees south", "the equator to 30 degrees south", "the equator to 30 degrees north", "30 to 60 degrees north", "60 to 90 degrees north"]);
});

test("an owner whose largest purpose is Unspecified, or that leans towards an orbit group, is described truthfully", () => {
  const jp = owner("Japan");
  const changed = { ...jp, purposes: [{ name: "Unspecified", count: 30 }, { name: "Communications", count: 22 }], orbits: { low: 30, medium: 22, geostationary: 0, highElliptical: 0, beyond: 0 } };
  const c2 = { ...counts, owners: counts.owners.map((o) => (o === jp ? changed : o)) };
  const t = textOf(renderPage(countryPage(c2, COUNTRY_PAGES[4], { updated, coast, positions: [] })));
  assert.ok(t.includes(`The catalogue records no purpose grouping for ${pct(30 / 52)} percent of them. The most common recorded purpose is Communications, with 22 satellites, ${pct(22 / 52)} percent.`), t);
  assert.ok(t.includes(`Japan leans towards medium Earth orbit: ${pct(22 / 52)} percent of its fleet against ${pct(counts.orbits.medium / counts.active)} percent of the catalogue.`));
  assert.ok(t.includes("None of them is in the geostationary belt or high elliptical orbits or orbits beyond the geostationary belt."));
  // more satellites without a recorded group than in the largest group: no "most used for" claim
  assert.ok(t.includes("How many satellites the catalogue records for Japan have a purpose group? 22 of the 52. The other 30 have no recorded group, more than any single group has, so the catalogue cannot say what most of them are for."), t);
  assert.ok(!/What are most satellites the catalogue records for Japan used for/.test(t));
});

test("the hub ranks every owner with an active satellite, adds up, holds the method and links to exactly the five country pages", () => {
  const ranks = tableNums(hub, "Every owner with an active satellite, ranked", 0);
  assert.deepEqual(ranks, ["1", "2", "3", "4", "5", "6", ""], "six ranked owners and the unrecorded row");
  assert.equal(sum(tableNums(hub, "Every owner with an active satellite, ranked", 2)), counts.active);
  assert.ok(!hub.includes("Empty Owner"), "an owner with no active satellite is not ranked");
  const targets = new Set([...hub.matchAll(/href="([^"#]*)"/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l)).map((l) => path.posix.normalize(path.posix.join("satellites-by-country", l)).replace(/\/$/, "")).filter((t) => t.startsWith("satellites-by-country/")));
  assert.deepEqual([...targets].sort(), COUNTRY_PAGES.map((p) => `satellites-by-country/${p.slug}`).sort());
  const t = textOf(hub);
  assert.ok(t.includes(`6 owners in the catalogue have at least one active satellite. The United States has the most, ${num(130)} active satellites, ${pct(130 / 402)} percent of all 402 active satellites in our count.`));
  assert.ok(t.includes(`The top three owners together hold ${pct((130 + 90 + 66) / 402)} percent`));
  assert.ok(t.includes("Every Starlink satellite in the data, 70 of them, is recorded under the United States."));
  assert.ok(t.includes(`Leaving Starlink out, the United States has 60 of the other 332 active satellites, ${pct(60 / 332)} percent.`));
  // the method lives here once, including the orbit groups the hub's orbit table shows
  const method = hub.slice(hub.indexOf('id="method"'), hub.indexOf('id="faq"'));
  for (const part of ["Operational, Partially operational", "STARLINK", "eccentricity of 0.25", "Purposes are CelesTrak's own groupings", "not counts of launches", "within 1 degree of the equator", "two-body orbit"]) assert.ok(method.includes(part), part);
  assert.deepEqual(tableNums(hub, "Active satellites by orbit group", 0).at(-1), "All active satellites");
  assert.equal(sum(tableNums(hub, "Active satellites by orbit group", 1)), owner("United States").orbits.low + owner("People's Republic of China").orbits.low + owner("United Kingdom").orbits.low + owner("Commonwealth of Independent States (former USSR)").orbits.low + owner("Japan").orbits.low + counts.orbits.low);
  for (const p of COUNTRY_PAGES) assert.ok(html.get(p.file).includes('href="../#method"'), `${p.slug} links to the method`);
});

test("internal links and anchors on every live page resolve to pages the site builds", () => {
  const known = new Set(["index.html", "methods/index.html", ...LIVE_FILES, ...NAV.map(([f]) => (f === "" ? "index.html" : f + "index.html"))]);
  for (const [f, h] of html) {
    for (const m of h.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/ href="([^"]*)"/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      const [p, frag] = m[1].split("#");
      let target = p === "" ? f : path.posix.normalize(path.posix.join(path.posix.dirname(f), p));
      if (target === "." || target === "./") target = "index.html";
      if (target.endsWith("/")) target += "index.html";
      assert.ok(known.has(target), `${f}: ${m[1]} -> ${target}`);
      if (frag && html.has(target)) assert.ok(html.get(target).includes(` id="${frag}"`), `${f}: #${frag} missing in ${target}`);
    }
  }
});

// Share of shared 8-word sequences between two country pages, over the page as served inside <main>, after numbers become "n" and every
// country page's owner name, short name and phrase become "owner". Shared over all distinct sequences of the pair (Jaccard), and also
// over the smaller page (containment), which is reported but not limited.
function overlap(pages) {
  const norm = (h) => {
    let t = h.slice(h.indexOf("<main"), h.indexOf("</main>")).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    for (const q of COUNTRY_PAGES) for (const s of [q.owner, q.phrase.charAt(0).toUpperCase() + q.phrase.slice(1), q.phrase, q.name]) t = t.split(s).join(" OWNER ");
    return t.toLowerCase().replace(/\d[\d,.]*(st|nd|rd|th)?/g, " n ").split(/[^a-z']+/).filter(Boolean);
  };
  const sh = pages.map((p) => { const w = norm(renderPage(p)), s = new Set(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; });
  const out = [];
  for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
    let c = 0; for (const x of sh[i]) if (sh[j].has(x)) c++;
    out.push({ pair: `${pages[i].crumbTitle} / ${pages[j].crumbTitle}`, jaccard: c / (sh[i].size + sh[j].size - c), containment: c / Math.min(sh[i].size, sh[j].size) });
  }
  return out;
}

test("the five country pages share under half of their 8-word sequences, with numbers and owner names made alike", (t) => {
  const pairs = overlap(realSet.pages.slice(1));
  const worst = pairs.reduce((a, b) => (b.jaccard > a.jaccard ? b : a));
  t.diagnostic(`worst pair ${worst.pair}: ${pct(worst.jaccard)} percent shared (Jaccard), ${pct(worst.containment)} percent of the smaller page`);
  for (const p of pairs) assert.ok(p.jaccard < 0.5, `${p.pair}: ${pct(p.jaccard)} percent`);
  // OURS: measured on 2026-10-06 at 64.3 percent for the worst pair (China and the CIS); the limit is that plus 5 points, so the pages
  // cannot drift back towards a template. It is above half: see docs/satcountry-sources.md.
  const worstC = pairs.reduce((a, b) => (b.containment > a.containment ? b : a));
  t.diagnostic(`worst containment ${worstC.pair}: ${pct(worstC.containment)} percent`);
  for (const p of pairs) assert.ok(p.containment < 0.693, `${p.pair}: ${pct(p.containment)} percent of the smaller page`);
  assert.equal(pairs.length, 10);
});

test("the CIS page keeps the catalogue's name and never says Russia", () => {
  const h = bySlug("cis-former-ussr");
  assert.ok(!/russia/i.test(h));
  assert.ok(textOf(h).includes('Recorded as "Commonwealth of Independent States (former USSR)"'));
  assert.ok(!/russia/i.test(renderPage(realSet.pages.find((p) => p.file.includes("cis-former-ussr")))));
});

test("house style: no dashes, no emoji, no hidden text, no FAQ markup, nothing loaded from elsewhere, a dated WebPage, sources", () => {
  for (const [f, h] of [...html, ...realSet.pages.map((p) => [p.file, renderPage(p)])]) {
    const t = textOf(h);
    assert.ok(!/[–—]/.test(h), `${f}: en or em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), `${f}: emoji`);
    assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), `${f}: hidden text`);
    assert.ok(!/<script[^>]+src=/.test(h) && !/<img /.test(h) && !/<link[^>]+stylesheet/.test(h), f);
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
    assert.ok(!ld.some((o) => o["@type"] === "FAQPage" || o["@type"] === "Dataset"), f);
    assert.equal(ld.find((o) => o["@type"] === "WebPage").dateModified, "2026-10-05T09:00:00.000Z", f);
    assert.ok(t.includes("CelesTrak"), `${f}: credit`);
    assert.ok(h.includes('href="https://celestrak.org/satcat/sources.php"'), `${f}: the owner names are sourced`);
    assert.ok(!/NaN|undefined/.test(t), `${f}: no broken values`);
  }
});

test("each page stays under 400 KB, also with the bundled snapshot's full fleets", () => {
  for (const [f, h] of html) assert.ok(Buffer.byteLength(h) < 400 * 1024, `${f}: ${Buffer.byteLength(h)}`);
  assert.equal(realSet.pages.length, 6);
  for (const p of realSet.pages) assert.ok(Buffer.byteLength(renderPage(p)) < 400 * 1024, `${p.file}: ${Buffer.byteLength(renderPage(p))}`);
});

test("a page that trips the guard is skipped with its reason, and no other page links to it", () => {
  const r = countryPageSet(fx, { coast, updated, min: 53 });
  assert.deepEqual(r.skipped.map((s) => s.slug), ["japan"]);
  assert.match(r.skipped[0].reason, /Japan has 52 active satellites, under 53/);
  for (const p of r.pages) assert.ok(!renderPage(p).includes('japan/"'), `${p.file} links to the skipped page`);
  assert.equal(r.pages.length, 5);
  const none = countryPageSet(fx, { coast, updated, min: 1000 });
  assert.equal(none.pages.length, 1);
  const h = renderPage(none.pages[0]);
  assert.ok(!h.includes('id="pages"') && !h.includes("Owners with their own page"), "no section of owner pages when every page is skipped");
  assert.ok(!/satellites-by-country\/[a-z-]+\//.test(h.replace(/<link rel="canonical"[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")), "no link to a country page");
});

test("a country page for an owner with no active satellite is refused, and a hub with no owner says so plainly", () => {
  assert.throws(() => countryPage(counts, { ...COUNTRY_PAGES[0], owner: "Empty Owner" }, { updated, coast, positions: [] }), /no active satellites/);
  const empty = hubPage({ ...counts, owners: [], active: 0, starlink: 0, last30: 0, orbits: { low: 0, medium: 0, geostationary: 0, highElliptical: 0, beyond: 0 } }, { updated, pages: [] });
  const h = renderPage(empty), t = textOf(h);
  assert.ok(t.includes("As of 5 October 2026, 08:14 UTC, no owner in the catalogue has an active satellite."));
  assert.ok(t.includes("The satellite data of 5 October 2026 has no active satellite with an owner, so there is nothing to rank."));
  assert.ok(!/NaN|undefined|0\.0 percent/.test(t), t);
  assert.ok(!h.includes('id="pages"') && !h.includes('id="ranking"'));
  assert.ok(h.includes('id="method"') && h.includes('id="faq"'));
  assert.ok(empty.description.length >= 60 && empty.description.length <= 160, String(empty.description.length));
});

test("the live sitemap lists every live page by default, or the pages given, each with its own last modified time", () => {
  assert.deepEqual(LIVE_FILES.slice(0, 7), [SATCOUNT_FILE, HUB_FILE, ...COUNTRY_FILES], "the satellite pages come first in the registry");
  const xml = sitemapLive("2026-10-05T09:00:00.000Z");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, LIVE_FILES.map((f) => `${SITE.url}/${urlPath(f)}`));
  assert.equal((xml.match(/<lastmod>2026-10-05T09:00:00.000Z<\/lastmod>/g) || []).length, LIVE_FILES.length);
  assert.equal([...sitemapLive("x", [SATCOUNT_FILE]).matchAll(/<loc>/g)].length, 1);
  const own = sitemapLive([{ file: SATCOUNT_FILE, lastmod: "2026-10-05T08:14:54Z" }, { file: HUB_FILE, lastmod: "2026-10-05T08:00:00Z" }]);
  assert.deepEqual([...own.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]), ["2026-10-05T08:14:54Z", "2026-10-05T08:00:00Z"]);
});
