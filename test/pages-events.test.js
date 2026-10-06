import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchesPage, disastersPage, starlinkPage, altitudeHistogramSvg, eventMapSvg, fleetMapSvg, markerPath, EVENT_SHAPES, EVENT_HUB_ROWS, launchTimeEl } from "../site/pages-events.mjs";
import { summariseLaunches, summariseDisasters, summariseStarlink, EVENT_PAGES, EVENT_TERMS_VERIFIED } from "../site/events.mjs";
import { launchesHeadline, disastersHeadline } from "../site/live-pages-js.mjs";
import { rightNowPage, hubRows, quakesPage } from "../site/pages-hazard.mjs";
import { summariseQuakes } from "../site/hazard.mjs";
import { LIVE_FILES, LIVE_PAGES, RIGHT_NOW_FILE, SATCOUNT_FILE } from "../site/livepages.mjs";
import { renderPage, SITE } from "../site/layout.mjs";
import { coastFromBuffer } from "../site/pages-country.mjs";
import { satelliteCountPage } from "../site/pages-satcount.mjs";
import { countSatellites } from "../site/satcount.mjs";
import { xmlProblem } from "./helpers/xml.mjs";
import { buildFixture, STANDARD, countryFixture } from "./helpers/satfixture.mjs";
import { quakesDoc } from "./helpers/hazardfixture.mjs";
import { launchesDoc, eventsList, stormsNow, EV_TIME, realLaunches, realEvents, realStorms, EVENTS_TIME, EVENTS_NOW } from "./helpers/eventsfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const coast = coastFromBuffer(fs.readFileSync(path.join(root, "public/coast.bin")));
const now = new Date("2026-10-06T00:45:00Z");
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([,.;:)])/g, "$1").replace(/\( /g, "(").trim();
const mainText = (h) => textOf(h.slice(h.indexOf("<main"), h.indexOf("</main>")));
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
const leadOf = (h) => h.match(/<p class="lead">([\s\S]*?)<\/p>/)[1];
const bundled = () => ({ meta: JSON.parse(fs.readFileSync(path.join(root, "public/meta.json"), "utf8")), details: fs.readFileSync(path.join(root, "public/details.bin")), swarm: fs.readFileSync(path.join(root, "public/swarm.bin")) });

const S = {
  launches: summariseLaunches(launchesDoc(), { now }),
  disasters: summariseDisasters(eventsList(), { now, dataTime: EV_TIME, storms: stormsNow }),
  starlink: summariseStarlink(countryFixture(), { now: new Date("2026-10-05T09:00:00Z"), bounds: { min: 5, max: 1000 }, min: 50 }),
};
const R = {
  launches: summariseLaunches(realLaunches(), { now: EVENTS_NOW }),
  disasters: summariseDisasters(realEvents(), { now: EVENTS_NOW, dataTime: EVENTS_TIME(), storms: realStorms() }),
  starlink: summariseStarlink(bundled(), { now: new Date("2026-10-04T15:00:00Z") }),
};
const FN = { launches: launchesPage, disasters: disastersPage, starlink: starlinkPage };
const small = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, FN[k](s, { coast })]));
const real = Object.fromEntries(Object.entries(R).map(([k, s]) => [k, FN[k](s, { coast })]));
const html = (p) => renderPage(p, { noindex: false });
const all = () => [...Object.entries(small).map(([k, p]) => [`small ${k}`, p, html(p)]), ...Object.entries(real).map(([k, p]) => [`real ${k}`, p, html(p)])];

test("each page has its fixed address, one h1, its canonical address and an answer-first lead with the feed's own data time", () => {
  for (const [k, p] of Object.entries(small)) assert.equal(p.file, EVENT_PAGES.find((x) => x.key === k).file);
  for (const [name, p, h] of all()) {
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, name);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${p.file.replace("index.html", "")}">`), name);
    assert.ok(leadOf(h).startsWith(`As of <time datetime="${p.dataTime}">`), `${name}: ${leadOf(h).slice(0, 80)}`);
    assert.match(leadOf(h), /<strong>[^<]*(<span[^>]*>)?[^<]*\d/, `${name}: a number in the lead`);
  }
  assert.equal(textOf(leadOf(html(small.launches))), 'As of 6 October 2026, 00:00 UTC, when our collector read Launch Library 2, the next launch in its list is Falcon 9 Block 5 | Starlink Group 10-1, planned for 6 October 2026, 20:15 UTC by SpaceX, status "Go for Launch". 4 launches are planned in the 30 days after it.');
  assert.equal(textOf(leadOf(html(small.disasters))), "As of 6 October 2026, 00:30 UTC, the time of GDACS's newest update, the Global Disaster Alert and Coordination System lists 4 current events that are not earthquakes: 1 with an Orange alert, 0 with a Red alert and the rest Green. 1 more are no longer current, with an end date in the 7 days before.");
  assert.equal(textOf(leadOf(html(small.starlink))), "As of 5 October 2026, 08:14 UTC, the time of the satellite data, CelesTrak's active list holds 70 active Starlink satellites, 17 percent of the 402 active satellites in our count. A Starlink satellite here is one whose catalogue name contains STARLINK.");
});

test("titles are under 60 characters and unique, descriptions under 160, on the longest date and with long names", () => {
  const long = "2026-09-30T23:59:00Z", name = "Long March 2F/G | Shenzhou-23 crewed mission to the Tiangong space station with a very long name";
  const big = [
    launchesPage({ ...S.launches, dataTime: long, in30: 9999, next: { ...S.launches.next, name, when: "30 September 2026, in the hour from 23:00 UTC" } }, { coast }),
    launchesPage({ ...S.launches, dataTime: long, next: null, upcoming: [], in30: 0, byProvider: [], byCountry: [], sites: [], exact30: 0, exactUpcoming: 0, nextExact: null }, { coast }),
    disastersPage({ ...S.disasters, dataTime: long, current: 299, currentOrange: 120, currentRed: 99 }, { coast }),
    starlinkPage({ ...S.starlink, dataTime: long, starlink: 99999, active: 99999 }, { coast }),
  ];
  const titles = new Set();
  for (const p of [...Object.values(small), ...Object.values(real), ...big]) {
    assert.ok(p.title.length >= 15 && p.title.length < 60, `${p.file}: title ${p.title.length}: ${p.title}`);
    assert.ok(p.description.length >= 60 && p.description.length < 160, `${p.file}: description ${p.description.length}: ${p.description}`);
  }
  for (const p of Object.values(small)) titles.add(p.title);
  assert.equal(titles.size, 3);
  const others = [satelliteCountPage(countSatellites(buildFixture(STANDARD)), { updated: now }), quakesPage(summariseQuakes(quakesDoc(), { now: new Date("2026-10-05T18:30:00Z") }), { coast })];
  for (const o of others) assert.ok(!titles.has(o.title) && !Object.values(small).some((p) => p.description === o.description));
});

test("structured data: a BreadcrumbList and a WebPage with inLanguage, dateModified, isPartOf and breadcrumb; no Dataset and no FAQPage", () => {
  for (const [name, p, h] of all()) {
    const ld = ldOf(h);
    assert.deepEqual(ld.map((o) => o["@type"]), ["BreadcrumbList", "WebPage"], name);
    const wp = ld[1];
    assert.equal(wp.inLanguage, "en");
    assert.equal(wp.dateModified, p.dataTime, `${name}: the data time`);
    assert.deepEqual(wp.isPartOf, { "@type": "WebSite", name: SITE.name, url: `${SITE.url}/` });
    assert.deepEqual(wp.breadcrumb.itemListElement.map((x) => x.item), ld[0].itemListElement.map((x) => x.item), `${name}: the same breadcrumb as the page`);
    assert.equal(wp.url, `${SITE.url}/${p.file.replace("index.html", "")}`);
    assert.equal(wp.name, p.title);
  }
  assert.ok(Object.values(EVENT_TERMS_VERIFIED).every((x) => !x), "no source has verified terms, so no Dataset");
});

test("every figure has a caption, every SVG is well formed with a title and a description, every table a caption and scoped headers", () => {
  let figures = 0;
  for (const [name, , h] of all()) {
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    for (const svg of main.match(/<svg[\s\S]*?<\/svg>/g) || []) {
      assert.equal(xmlProblem(svg), null, `${name}: ${xmlProblem(svg)}`);
      assert.match(svg, /role="img"/);
      assert.match(svg, /<title id="[a-z0-9-]+-t">[^<]+<\/title><desc id="[a-z0-9-]+-d">[^<]+<\/desc>/, name);
    }
    const figs = main.match(/<figure[\s\S]*?<\/figure>/g) || [];
    figures += figs.length;
    assert.equal(figs.length, (main.match(/<svg/g) || []).length, `${name}: every SVG is in a figure`);
    for (const f of figs) assert.match(f, /<figcaption[^>]*>[^<]{20,}<\/figcaption>/, name);
    for (const t of main.match(/<table>[\s\S]*?<\/table>/g) || []) {
      assert.match(t, /<caption>[^<]+<\/caption>/, name);
      assert.ok(!/<th(?! scope="(col|row)")[ >]/.test(t), `${name}: a header cell without scope`);
    }
  }
  assert.ok(figures >= 12, String(figures));
});

test("headings: one h1, h2 sections, h3 only under an h2, the findings right after the lead", () => {
  for (const [name, , h] of all()) {
    const levels = [...h.slice(h.indexOf("<main")).matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${name}: h${levels[i - 1]} then h${levels[i]}`);
    const firstH2 = h.match(/<h2 id="([a-z-]+)">/);
    assert.equal(firstH2[1], "meaning", `${name}: What this means comes first`);
    const items = h.slice(h.indexOf('id="meaning"')).split("</ul>")[0].match(/<li>/g) || [];
    assert.ok(items.length >= 3 && items.length <= 6, `${name}: ${items.length} findings`);
  }
});

test("the source is credited visibly near the top and linked, with the sources section and a visible FAQ", () => {
  const top = (h) => h.slice(h.indexOf("<main"), h.indexOf('id="meaning"'));
  assert.ok(top(html(small.launches)).includes('href="https://thespacedevs.com/llapi"') && mainText(html(small.launches)).includes("Data: The Space Devs, Launch Library 2."));
  assert.ok(top(html(small.disasters)).includes('href="https://www.gdacs.org/About/overview.aspx"') && mainText(html(small.disasters)).includes("GDACS says its information is purely indicative"));
  assert.ok(top(html(small.starlink)).includes('href="https://celestrak.org/NORAD/elements/"'));
  for (const [name, , h] of all()) assert.ok(h.includes('id="faq"') && h.includes('id="sources"'), name);
  assert.ok(mainText(html(small.starlink)).includes("A Starlink satellite is one whose catalogue name contains STARLINK."), "the rule is stated");
});

test("text from the feeds is escaped", () => {
  const l = html(small.launches), d = html(small.disasters);
  assert.ok(!l.includes("<b>Test & Go</b>") && l.includes("Electron | &lt;b&gt;Test &amp; Go&lt;/b&gt;"));
  assert.ok(!d.includes("Flood in <Somewhere>") && d.includes("Flood in &lt;Somewhere&gt; &amp; co"));
});

test("launch times are in UTC with the source's precision; no countdown in the HTML, only the hook for the script", () => {
  const t = mainText(html(small.launches));
  assert.ok(t.includes("October 2026, day not set Only to the month Long March 12 | Unknown Payload"), t);
  assert.ok(t.includes("9 October 2026, in the hour from 03:00 UTC To the hour"));
  assert.ok(!/T-minus|countdown:/i.test(t), "no countdown text in the server HTML");
  assert.ok(html(small.launches).includes('<p data-countdown="2026-10-06T20:15:00Z" data-precision="MIN" data-status="Go for Launch">'));
  assert.equal(launchTimeEl({ net: "2026-10-31T00:00:00Z", precision: "M", when: "October 2026, day not set" }), '<time datetime="2026-10">October 2026, day not set</time>');
  assert.equal(launchTimeEl({ net: "2026-12-31T00:00:00Z", precision: "Q4", when: "x" }), '<time datetime="2026">x</time>');
  // the passed launch is listed without a claim that it happened
  assert.ok(t.includes("The list does not say whether they launched"));
});

test("edge cases render sensibly: no launch in 30 days, a pad with no position, no Orange or Red event, an event with no country, a stale snapshot", () => {
  const far = mainText(html(launchesPage(summariseLaunches(launchesDoc({ launches: [launchesDoc().launches[5]] }), { now }), { coast })));
  assert.ok(far.includes("No launch in the list is planned in the 30 days after the data time.") && far.includes("No launch in the 30 days has pad coordinates in the list, so there is no map."));
  assert.ok(mainText(html(small.launches)).includes("1 launch has no usable pad coordinates in the list and is not on the map."));
  const green = mainText(html(disastersPage(summariseDisasters(eventsList().map((e) => ({ ...e, alert: "Green" })), { now, dataTime: EV_TIME }), { coast })));
  assert.ok(green.includes("None of the events on this page has an Orange or Red alert as of 6 October 2026, 00:30 UTC."));
  assert.ok(mainText(html(small.disasters)).includes("GDACS gives no country for 1 event on this page; the tables say Not given."));
  assert.ok(mainText(html(small.disasters)).includes("Not given"));
  const old = mainText(html(starlinkPage(summariseStarlink(bundled(), { now: new Date("2026-10-08T00:00:00Z"), allowStale: true }), { coast })));
  assert.ok(old.includes("This copy was built from the data bundled with the site when it was deployed, which is older than the 30 hours this page allows for live data."));
  assert.ok(!mainText(html(small.starlink)).includes("This copy was built"));
  // NHC's storm is left out and named, and linked when the storm page exists
  const d = html(disastersPage(S.disasters, { coast, built: LIVE_FILES }));
  assert.ok(mainText(d).includes("1 tropical cyclone GDACS lists is also in the US National Hurricane Center's list (Tropical Cyclone ALPHA-26, NHC's Alpha) and is left out here, so no storm is shown twice"));
  assert.ok(d.includes('href="../tropical-storms-now/"'));
  assert.ok(!html(disastersPage(S.disasters, { coast, built: [] })).includes('href="../tropical-storms-now/"'), "not linked when it was not built");
});

test("the disaster map shows type by shape and alert by size and colour, with a legend in words", () => {
  const shapes = Object.values(EVENT_SHAPES);
  assert.equal(new Set(shapes).size, 5);
  const paths = new Set(shapes.map((sh) => markerPath(sh, 100, 100, 20).replace(/\d+/g, "n")));
  assert.equal(paths.size, 5, "five different outlines");
  const svg = eventMapSvg({ coast: [], events: S.disasters.points, id: "m", title: "t", desc: "d" });
  assert.equal(xmlProblem(svg), null);
  for (const w of ["Tropical cyclone", "Flood", "Wildfire", "Drought", "Volcano", "Green alert", "Orange alert", "Red alert"]) assert.ok(svg.includes(`>${w}</text>`), w);
  assert.equal((svg.match(/data-tip=/g) || []).length, S.disasters.points.length);
  const hist = altitudeHistogramSvg({ id: "h", title: "t", desc: "d", rows: S.starlink.bands });
  assert.equal(xmlProblem(hist), null);
  const fleet = fleetMapSvg({ coast, points: [[10, 20], [10.01, 20.01], [-5, 30]], id: "f", title: "t", desc: "d" });
  assert.equal(xmlProblem(fleet), null);
  assert.ok(fleet.includes('d="M2500 1000h0m-200 50h0"') || /M\d+ \d+h0m-?\d+ -?\d+h0/.test(fleet), "two dots after rounding, relative steps");
});

test("house style: no dashes, no emoji, no hidden text, only the shared script, under 250 KB, deterministic", () => {
  for (const [name, p, h] of all()) {
    assert.ok(!/[–—]/.test(h), `${name}: en or em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), `${name}: emoji`);
    assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), `${name}: hidden text`);
    assert.deepEqual([...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]), ["../live-pages.js"], name);
    assert.ok(!/<img |<link[^>]+stylesheet/.test(h), name);
    assert.ok(Buffer.byteLength(h) < 250 * 1024, `${name}: ${Buffer.byteLength(h)}`);
    assert.ok(!/NaN|undefined|\bnull\b|\[object/.test(textOf(h)), `${name}: a broken value`);
    assert.match(h, /<body data-live-v="1"/, name);
    assert.equal(p.bodyAttrs["data-live-time"], p.dataTime);
  }
  const later = new Date("2026-10-06T03:00:00Z");
  assert.equal(html(launchesPage(summariseLaunches(launchesDoc(), { now: later }), { coast })), html(small.launches));
  assert.equal(html(disastersPage(summariseDisasters(eventsList(), { now: later, dataTime: EV_TIME, storms: stormsNow }), { coast })), html(small.disasters));
});

test("no safety advice, no prediction and no claim of danger", () => {
  for (const [name, , h] of all()) {
    const bad = mainText(h).match(/.{0,60}(\bsafe\b|\bunsafe\b|danger|evacuat|you should|threat|\brisk\b|will launch|will happen).{0,30}/i);
    assert.ok(!bad, `${name}: ${bad && bad[0]}`);
  }
});

test("the live refresh hooks hold exactly the numbers the script computes from the same files", () => {
  const keys = (h) => Object.fromEntries([...h.matchAll(/data-live-key="([a-z0-9-]+)">([^<]*)</g)].map((m) => [m[1], textOf(m[2])]));
  assert.deepEqual(keys(html(real.launches)), launchesHeadline(realLaunches()));
  assert.deepEqual(keys(html(real.disasters)), disastersHeadline(realEvents(), realStorms()));
  assert.equal(real.launches.bodyAttrs["data-live-page"], "launches");
  assert.equal(real.disasters.bodyAttrs["data-live-page"], "disasters");
  assert.ok(!("data-live-page" in real.starlink.bodyAttrs), "no refresh for the satellite data");
  assert.equal(real.launches.bodyAttrs["data-live-base"], "../live/");
});

test("the hub gets a row, a limit, a source and a notable line for each of the three pages, and links only the pages built", () => {
  const more = [EVENT_HUB_ROWS.starlink(S.starlink), EVENT_HUB_ROWS.disasters(S.disasters), EVENT_HUB_ROWS.launches(S.launches)];
  const rows = hubRows({ satellites: { active: 402, dataTime: "2026-10-05T08:14:54Z" }, more });
  const hub = renderPage(rightNowPage(rows, { available: [...LIVE_FILES] }));
  const t = mainText(hub);
  for (const p of EVENT_PAGES) assert.ok(hub.includes(`href="../${p.slug}/"`), p.slug);
  assert.ok(t.includes("70 active Starlink satellites"));
  assert.ok(t.includes("1 Orange and 0 Red alerts among 4 current GDACS events"));
  assert.ok(t.includes("Next: Falcon 9 Block 5 | Starlink Group 10-1, 6 October 2026, 20:15 UTC"));
  assert.ok(t.includes("What is notable"));
  assert.ok(t.includes("GDACS lists 1 current event with an Orange or Red alert (earthquakes left out): Flood in <Somewhere> & co, Orange."));
  assert.ok(t.includes("A launch is planned in the 24 hours after the launch list's time: Falcon 9 Block 5 | Starlink Group 10-1, 6 October 2026, 20:15 UTC."));
  assert.ok(t.includes("satellite data for the Starlink page 30 hours, GDACS events 6 hours and rocket launches 6 hours"), t);
  assert.ok(hub.includes('href="https://thespacedevs.com/llapi"') && hub.includes('href="https://www.gdacs.org/About/overview.aspx"'));
  const r = rightNowPage(rows, { available: LIVE_FILES });
  assert.ok(r.description.length < 160, r.description);
  // a page that is not built: no number and no link, with the reason
  const missing = hubRows({ more: [EVENT_HUB_ROWS.launches(null, { missing: { launches: "not in the collector's data" } })] });
  const mh = renderPage(rightNowPage(missing, { available: LIVE_FILES.filter((f) => f !== "rocket-launches/index.html") }));
  assert.ok(!mh.includes('href="../rocket-launches/"'));
  assert.ok(mainText(mh).includes("Rocket launches Not in the collector's data; page not updated"));
});

test("the pages differ in substance from each other and from the earlier live pages", (t) => {
  const words = (h) => mainText(h).toLowerCase().replace(/\d[\d,.]*/g, " n ").split(/[^a-z']+/).filter(Boolean);
  const shingles = (h) => { const w = words(h), s = new Set(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; };
  const pages = Object.entries(real).map(([k, p]) => [k, shingles(html(p))]);
  pages.push(["count", shingles(renderPage(satelliteCountPage(countSatellites(buildFixture(STANDARD)), { updated: now })))]);
  pages.push(["quakes", shingles(renderPage(quakesPage(summariseQuakes(quakesDoc(), { now: new Date("2026-10-05T18:30:00Z") }), { coast })))]);
  let worst = 0;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < pages.length; j++) {
    let c = 0; for (const x of pages[i][1]) if (pages[j][1].has(x)) c++;
    const jac = c / (pages[i][1].size + pages[j][1].size - c);
    worst = Math.max(worst, jac);
    assert.ok(jac < 0.1, `${pages[i][0]} / ${pages[j][0]}: ${jac}`);
  }
  t.diagnostic(`worst shared share of 8-word sequences: ${(worst * 100).toFixed(1)} percent`);
});

test("the server allows every page in the registry (hosting/lib.php, read as text, not changed)", () => {
  const php = fs.readFileSync(path.join(root, "hosting/lib.php"), "utf8");
  const re = php.match(/function radar_safe_page_path[\s\S]*?preg_match\('#\^\(\?:([\s\S]*?)\)\\z#'/);
  assert.ok(re, "the allowed list is found");
  const allowed = new RegExp(`^(?:${re[1]})$`);
  for (const p of LIVE_PAGES) assert.ok(allowed.test(p.file), `${p.file} is not allowed by hosting/lib.php`);
  for (const p of EVENT_PAGES) assert.ok(allowed.test(p.file), p.file);
  assert.ok(!allowed.test("rocket-launches/index.html.bak") && !allowed.test("history.json"), "history.json is never copied to the site");
});

test("the terms flags in the code match the table in docs/events-pages-sources.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/events-pages-sources.md"), "utf8");
  const rows = new Map([...doc.matchAll(/^\| `([a-z]+)` \|(.*)$/gm)].map((m) => [m[1], m[2].split("|").map((c) => c.trim())]));
  for (const [feed, verified] of Object.entries(EVENT_TERMS_VERIFIED)) {
    assert.ok(rows.has(feed), `${feed} has a row`);
    const flag = rows.get(feed).find((c) => /^(yes|no)\b/i.test(c));
    assert.ok(flag, `${feed}: a terms verified cell`);
    assert.equal(/^yes/i.test(flag), verified, `${feed}: ${flag}`);
  }
  for (const p of EVENT_PAGES) assert.ok(doc.includes(`/${p.slug}/`), `${p.slug} is named in the record`);
});
