import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quakesPage, auroraPage, approachesPage, stormsPage, firesPage, rightNowPage, hubRows, datasetLd, stormBounds, HAZARD_PAGE_FUNCTIONS } from "../site/pages-hazard.mjs";
import { summariseQuakes, summariseSpace, summariseApproaches, summariseStorms, summariseFires, HAZARD_PAGES, RIGHT_NOW_FILE, TERMS_VERIFIED, PLACE_MAX_KM } from "../site/hazard.mjs";
import { LIVE_FILES, LIVE_PAGES, SATCOUNT_FILE, EVENT_FILES } from "../site/livepages.mjs";
import { renderPage, SITE, urlPath, NAV } from "../site/layout.mjs";
import { coastFromBuffer } from "../site/pages-country.mjs";
import { satelliteCountPage } from "../site/pages-satcount.mjs";
import { countSatellites } from "../site/satcount.mjs";
import { xmlProblem } from "./helpers/xml.mjs";
import { quakesDoc, kpRows, windDoc, gridBytes, gridMeta, approachesDoc, stormsDoc, gdacsEvents, fireFiles, tinyPlaces, realFeeds, realPlaces, REAL_NOW, GEN } from "./helpers/hazardfixture.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const coast = coastFromBuffer(fs.readFileSync(path.join(root, "public/coast.bin")));
const now = new Date("2026-10-05T18:30:00Z");
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([,.;:)])/g, "$1").replace(/\( /g, "(").trim();
const mainText = (h) => textOf(h.slice(h.indexOf("<main"), h.indexOf("</main>")));
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
const num = (n) => n.toLocaleString("en-GB");
const leadOf = (h) => textOf(h.match(/<p class="lead">([\s\S]*?)<\/p>/)[1]);

// small hand-made feeds with known answers
const S = {
  quakes: summariseQuakes(quakesDoc(), { now }),
  space: summariseSpace({ kp: kpRows(), spaceweather: windDoc(), aurora: { meta: gridMeta, grid: gridBytes() } }, { now }),
  approaches: summariseApproaches(approachesDoc(), { now }),
  storms: summariseStorms(stormsDoc(), { now }),
  fires: summariseFires(fireFiles(), { now, places: tinyPlaces }),
};
const small = {
  quakes: quakesPage(S.quakes, { coast }), aurora: auroraPage(S.space, { coast }), asteroids: approachesPage(S.approaches),
  storms: stormsPage(S.storms, { coast }), fires: firesPage(S.fires, { coast }),
};
small.hub = rightNowPage(hubRows({ satellites: { active: 16624, dataTime: "2026-10-05T14:00:00Z" }, quakes: S.quakes, space: S.space, approaches: S.approaches, storms: S.storms, fires: S.fires }));
const smallHtml = Object.fromEntries(Object.entries(small).map(([k, p]) => [k, renderPage(p, { noindex: false })]));

// the real collector output of 5 October 2026
const R = realFeeds(), places = realPlaces();
const RS = {
  quakes: summariseQuakes(R.quakes, { now: REAL_NOW }),
  space: summariseSpace({ kp: R.kp, spaceweather: R.spaceweather, aurora: R.aurora }, { now: REAL_NOW }),
  approaches: summariseApproaches(R.closeapproaches, { now: REAL_NOW }),
  storms: summariseStorms(R.storms, { now: REAL_NOW }),
  fires: summariseFires(R.fires, { now: REAL_NOW, places }),
};
const real = [quakesPage(RS.quakes, { coast }), auroraPage(RS.space, { coast }), approachesPage(RS.approaches), stormsPage(RS.storms, { coast }), firesPage(RS.fires, { coast }),
  rightNowPage(hubRows({ satellites: { active: 16624, dataTime: "2026-10-05T14:00:00Z" }, quakes: RS.quakes, space: RS.space, approaches: RS.approaches, storms: RS.storms, fires: RS.fires }))];
const realHtml = new Map(real.map((p) => [p.file, renderPage(p, { noindex: false })]));
const allHtml = () => [...Object.entries(smallHtml).map(([k, h]) => [`small ${k}`, h]), ...realHtml];

test("the five pages and the hub have their fixed addresses, one h1 each and a canonical address", () => {
  assert.deepEqual(real.map((p) => p.file), [...HAZARD_PAGES.map((p) => p.file), RIGHT_NOW_FILE]);
  for (const [f, h] of allHtml()) {
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, f);
    assert.match(h, new RegExp(`<link rel="canonical" href="${SITE.url}/[a-z-]+/">`), f);
  }
  assert.deepEqual(Object.keys(HAZARD_PAGE_FUNCTIONS), HAZARD_PAGES.map((p) => p.key));
});

test("titles are 60 characters or fewer and unique, descriptions 160 or fewer, on the longest date and with large numbers", () => {
  const long = "2026-09-30T23:59:00Z";
  const big = {
    quakes: quakesPage({ ...S.quakes, dataTime: long, count: 99999, largest: { ...S.quakes.largest, mag: 9.5 } }, { coast }),
    aurora: auroraPage({ ...S.space, dataTime: long, kp: { ...S.space.kp, latest: { t: long, kp: 8.67 }, max: { t: long, kp: 8.67 } }, wind: { ...S.space.wind, fields: { ...S.space.wind.fields, speed: { ...S.space.wind.fields.speed, now: 2999.9 } } } }, { coast }),
    asteroids: approachesPage({ ...S.approaches, dataTime: long, upcoming: Array(999).fill(S.approaches.upcoming[0]), next: { ...S.approaches.next, name: "524522 Zoozve (2002 VE68)", distLd: 19.46 } }),
    asteroidsEmpty: approachesPage({ ...S.approaches, dataTime: long, upcoming: [], next: null, nearest: null, fastest: null, faintest: null, insideMoon: 0, last: null }),
    storms: stormsPage({ ...S.storms, dataTime: long, storms: S.storms.storms.map((x) => ({ ...x, name: "Christopher", windKt: 185 })) }, { coast }),
    stormsNone: stormsPage({ ...S.storms, dataTime: long, storms: [] }, { coast }),
    fires: firesPage({ ...S.fires, dataTime: long, detections: 999999 }, { coast }),
  };
  const titles = new Set();
  for (const p of [...Object.values(small), ...real, ...Object.values(big)]) {
    assert.ok(p.title.length >= 15 && p.title.length <= 60, `${p.file}: title ${p.title.length}: ${p.title}`);
    assert.ok(p.description.length >= 60 && p.description.length <= 160, `${p.file}: description ${p.description.length}: ${p.description}`);
  }
  for (const p of [...Object.values(small)]) titles.add(p.title);
  assert.equal(titles.size, 6, "six different titles");
  const counts = satelliteCountPage(countSatellites(buildFixture(STANDARD)), { updated: now });
  assert.ok(!titles.has(counts.title));
});

test("each lead answers first with the feed's own data time and the headline number", () => {
  assert.equal(leadOf(smallHtml.quakes), "As of 5 October 2026, 18:00 UTC, USGS's feed of earthquakes of magnitude 2.5 and above lists 8 earthquakes in the previous 24 hours. The largest was magnitude 6.4, 120 km S of Suva, Fiji, at 15:30 UTC on 5 October 2026.");
  assert.match(leadOf(smallHtml.aurora), /^As of 5 October 2026, 17:55 UTC, the latest planetary Kp index in NOAA's data is Kp 2\.67, for the three-hour period tagged 15:00 UTC on 5 October 2026\. The solar wind measured by SOLAR1 was 480 km\/s at 17:55 UTC, with Bz -2\.0 nT \(pointing south\)\.$/);
  assert.equal(leadOf(smallHtml.asteroids), "As of 5 October 2026, NASA JPL's close-approach list, as our collector read it that day, has 5 close approaches to Earth from that day on, within 0.05 au in its 60 day window. The first is 2026 AA, on 5 October 2026 at 03:00 UTC, at 4.20 lunar distances (1,614,480 km).");
  assert.match(leadOf(smallHtml.storms), /^As of 5 October 2026, 15:00 UTC, the time of its newest advisory, the US National Hurricane Center lists 2 active storms in its Atlantic, Eastern Pacific and Central Pacific basins: Rachel <b> \(Hurricane, Eastern Pacific\), maximum wind 100 knots \(185 km\/h\); Alpha/);
  assert.match(leadOf(smallHtml.fires), /^As of 5 October 2026, 16:00 UTC \(the time of the newest detection\), NASA FIRMS's 24 hour global files for the VIIRS instruments on Suomi NPP, NOAA-20 and NOAA-21 hold 72 fire detections in 3 cells/);
  for (const [f, h] of realHtml) if (f !== RIGHT_NOW_FILE) assert.match(leadOf(h), f === "asteroid-close-approaches/index.html" ? /^As of 5 October 2026, NASA JPL's/ : /^As of \d{1,2} [A-Z][a-z]+ 2026, \d\d:\d\d UTC/, f);
  // each page says what its data time is
  const meta = (h) => textOf(h.match(/<p class="meta">([\s\S]*?)<\/p>/)[1]);
  assert.equal(meta(smallHtml.quakes), "Data as of 5 October 2026, 18:00 UTC, the time given in the data itself. Data from the U.S. Geological Survey.");
  assert.equal(meta(smallHtml.storms), "Data as of 5 October 2026, 15:00 UTC, the time of the newest advisory in NHC's list. Data from the US National Hurricane Center.");
  assert.equal(meta(smallHtml.asteroids), "Data as of 5 October 2026, the day our collector read the list. Data from NASA JPL's Center for Near-Earth Object Studies.");
  assert.equal(meta(smallHtml.fires), "Data as of 5 October 2026, 16:00 UTC, the time of the newest detection in the files. Data from NASA FIRMS (LANCE).");
  // the data time is the feed's, in a time element, and the structured date is the same data time
  for (const [k, s] of Object.entries({ quakes: S.quakes, aurora: S.space, asteroids: S.approaches, storms: S.storms, fires: S.fires })) {
    assert.ok(smallHtml[k].includes(`<time datetime="${s.dataTime}">`), k);
    assert.equal(ldOf(smallHtml[k]).find((o) => o["@type"] === "WebPage").dateModified, s.dataTime, k);
  }
});

test("the numbers in the tables add up to the headline numbers", () => {
  const cells = (h, caption) => {
    const m = h.match(new RegExp(`aria-label="${caption}"[\\s\\S]*?</table>`));
    assert.ok(m, caption);
    return [...m[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1])));
  };
  const sum = (rows, col) => rows.reduce((a, r) => a + Number(r[col].replace(/,/g, "")), 0);
  const bands = cells(smallHtml.quakes, "Earthquakes by magnitude band");
  assert.equal(sum(bands.slice(0, -1), 1), 8);
  assert.deepEqual(bands.at(-1), ["All in the 24 hours", "8"]);
  assert.equal(sum(cells(smallHtml.quakes, "Earthquakes per hour"), 1), 8);
  assert.equal(sum(cells(smallHtml.quakes, "Most frequent USGS place labels"), 1), 8);
  const sats = cells(smallHtml.fires, "Fire detections by satellite");
  assert.equal(sum(sats.slice(0, -1), 1), 72);
  assert.equal(cells(smallHtml.aurora, "Planetary Kp per three-hour period").length, 16);
  assert.equal(cells(smallHtml.asteroids, "Close approaches from the day the list was read, soonest first").length, 5);
  const realQ = realHtml.get(HAZARD_PAGES[0].file);
  assert.equal(sum(cells(realQ, "Earthquakes by magnitude band").slice(0, -1), 1), RS.quakes.count);
  assert.equal(sum(cells(realHtml.get(HAZARD_PAGES[4].file), "Fire detections by satellite").slice(0, -1), 1), 192083);
});

test("Dataset markup only on pages whose every feed has verified terms, describing only what is visible", () => {
  for (const [k, h] of Object.entries(smallHtml)) {
    const ds = ldOf(h).filter((o) => o["@type"] === "Dataset");
    const want = ["quakes", "storms", "fires"].includes(k);
    assert.equal(ds.length, want ? 1 : 0, k);
    if (!want) continue;
    const d = ds[0];
    assert.ok(d.description.length >= 50 && d.description.length <= 5000, k);
    assert.equal(d.isAccessibleForFree, true);
    assert.ok(!("license" in d) && !("distribution" in d), `${k}: no licence or download is claimed`);
    assert.equal(d.url, `${SITE.url}/${urlPath(small[k].file)}`);
    assert.equal(d.dateModified, small[k].jsonld[0].dateModified);
    const visible = mainText(h);
    for (const n of JSON.stringify(d).match(/\d[\d,.]*/g)) {
      if (/^\d{4}-|^20\d\d/.test(n) || d.url.includes(n) || (d.isBasedOn.url || "").includes(n) || (d.temporalCoverage || "").includes(n)) continue;
      assert.ok(visible.includes(n.replace(/[.,]$/, "")), `${k}: ${n} from the markup is not on the page`);
    }
  }
  for (const [f, h] of realHtml) for (const o of ldOf(h)) assert.notEqual(o["@type"], "FAQPage", f);
  // a storm page that prints GDACS cyclones (terms not verified) carries no Dataset
  const none = stormsPage(summariseStorms(stormsDoc({ storms: [] }), { now, events: { list: gdacsEvents, dataTime: "2026-10-05T17:00:00Z" } }), { coast });
  assert.ok(!none.jsonld.some((o) => o["@type"] === "Dataset"));
  assert.equal(datasetLd({ feeds: ["kp"], name: "x", description: "y", file: "a/index.html", dataTime: GEN, temporal: GEN, spatial: "Earth", keywords: [], basedOn: { title: "t", url: "https://x" } }), null);
});

test("the terms flags in the code match the table in docs/hazard-pages-sources.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/hazard-pages-sources.md"), "utf8");
  const rows = new Map([...doc.matchAll(/^\| `([a-z]+)` \|(.*)$/gm)].map((m) => [m[1], m[2].split("|").map((c) => c.trim())]));
  for (const [feed, verified] of Object.entries(TERMS_VERIFIED)) {
    assert.ok(rows.has(feed), `${feed} has a row`);
    const flag = rows.get(feed).find((c) => /^(yes|no)\b/i.test(c));
    assert.ok(flag, `${feed}: a terms verified cell`);
    assert.equal(/^yes/i.test(flag), verified, `${feed}: ${flag}`);
  }
});

test("every chart and map is well formed XML with a title and a description", () => {
  let n = 0;
  for (const [f, h] of allHtml()) {
    for (const svg of h.match(/<svg[\s\S]*?<\/svg>/g) || []) {
      n++;
      assert.equal(xmlProblem(svg), null, `${f}: ${xmlProblem(svg)}`);
      assert.match(svg, /role="img"/);
      assert.match(svg, /<title id="[a-z0-9-]+-t">[^<]+<\/title>/, f);
      assert.match(svg, /<desc id="[a-z0-9-]+-d">[^<]+<\/desc>/, f);
    }
  }
  assert.ok(n >= 15, String(n));
  assert.equal(xmlProblem("<svg><a></b></svg>"), "closing </b> does not match");
  assert.equal(xmlProblem('<svg x="a&b"></svg>'), "bare & in attribute x");
});

test("text from the feeds is escaped", () => {
  assert.ok(!smallHtml.storms.includes("Rachel <b>"));
  assert.ok(smallHtml.storms.includes("Rachel &lt;b&gt;"));
  const evil = quakesPage(summariseQuakes(quakesDoc({ events: [{ ...quakesDoc().events[0], place: '<script>alert(1)</script> & "x", Fiji' }] }), { now }), { coast });
  const h = renderPage(evil);
  assert.ok(!h.includes("<script>alert"));
  assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;"));
});

test("house style: no dashes, no emoji, no hidden text, nothing loaded from elsewhere, under 250 KB, deterministic", () => {
  for (const [f, h] of allHtml()) {
    assert.ok(!/[\u2013\u2014]/.test(h), `${f}: en or em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), `${f}: emoji`);
    assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), `${f}: hidden text`);
    assert.ok(!/<script[^>]+src=/.test(h) && !/<img /.test(h) && !/<link[^>]+stylesheet/.test(h), f);
    assert.ok(Buffer.byteLength(h) < 250 * 1024, `${f}: ${Buffer.byteLength(h)}`);
    assert.ok(!/NaN|undefined|\bnull\b/.test(textOf(h)), `${f}: a broken value`);
    assert.ok(h.includes('id="faq"') && h.includes('id="sources"'), `${f}: a visible FAQ and sources`);
  }
  // the same data built at another moment gives the same bytes: no build time is printed
  const later = new Date("2026-10-05T19:59:00Z");
  assert.equal(renderPage(quakesPage(summariseQuakes(quakesDoc(), { now: later }), { coast })), smallHtml.quakes);
  assert.equal(renderPage(firesPage(summariseFires(fireFiles(), { now: later, places: tinyPlaces }), { coast })), smallHtml.fires);
});

test("no safety advice and no claims of danger or safety; the storm page says it is not a warning service and links to NHC", () => {
  for (const [f, h] of allHtml()) {
    const t = mainText(h);
    const bad = t.match(/.{0,60}(\bsafe\b|\bunsafe\b|danger|evacuat|you should|threat|\brisk).{0,30}/i);
    assert.ok(!bad, `${f}: ${bad && bad[0]}`);
  }
  assert.ok(mainText(smallHtml.storms).includes("This page is not a warning service. For official advisories, see the National Hurricane Center."));
  assert.ok(smallHtml.storms.includes('href="https://www.nhc.noaa.gov/"'));
  assert.ok(!/wildfires? (was|were) detected|confirmed wildfire[^s]/i.test(mainText(smallHtml.fires).replace("It is not a confirmed wildfire", "")), "a detection is never called a wildfire");
});

test("the aurora page prints no Kp to latitude table and points to NOAA's own explanation instead", () => {
  const t = mainText(smallHtml.aurora).replace("NOAA's full G1 to G5 table is in our aurora guide.", "").replace("The G1 to G5 table, with where aurora has been seen", "");
  assert.ok(!/\bG[2-5]\b/.test(t), `no G level table: ${(t.match(/.{0,40}\bG[2-5]\b.{0,40}/) || [""])[0]}`);
  assert.ok(!/New York|Idaho|Illinois|Alabama|Florida/.test(t));
  assert.ok(smallHtml.aurora.includes('href="https://www.swpc.noaa.gov/noaa-scales-explanation"'));
  assert.ok(t.includes("This page does not turn Kp into a latitude."));
});

test("the fire page names the nearest place with its distance and the rule, and only coordinates beyond 300 km", () => {
  const t = mainText(smallHtml.fires);
  assert.ok(t.includes(`If the nearest place is more than ${PLACE_MAX_KM} km away, we give only the coordinates.`));
  assert.ok(t.includes("the nearest of the 2 places in our place list"));
  assert.match(t, /18\.625° N, 73\.875° E 40 Pune, India: 12 km/);
  assert.match(t, /64\.875° S, 79\.875° W 25 None within 300 km/);
  for (const d of RS.fires.dense) if (!d.place) assert.ok(d.nearestKm > PLACE_MAX_KM);
});

test("edge cases render a sensible page: no big quakes, no quakes at all, a missing latest Kp, no close approaches, no storms, a stale snapshot", () => {
  const noBig = mainText(renderPage(quakesPage(summariseQuakes(quakesDoc({ events: quakesDoc().events.filter((e) => e.mag < 4.5) }), { now }), { coast })));
  assert.ok(noBig.includes("How many earthquakes of magnitude 4.5 or more were there in the last 24 hours? 0 in the 24 hours to 5 October 2026, 18:00 UTC."), noBig);
  const quiet = renderPage(quakesPage(summariseQuakes(quakesDoc({ events: [quakesDoc().events[8]] }), { now }), { coast }));
  assert.match(leadOf(quiet), /lists 0 earthquakes in the previous 24 hours\.$/);
  assert.ok(mainText(quiet).includes("No hour had an earthquake in the feed."));
  const gap = kpRows(); gap[15] = { t: gap[15].t, kp: null };
  const kpGap = renderPage(auroraPage(summariseSpace({ kp: gap }, { now }), { coast }));
  assert.ok(leadOf(kpGap).includes("is Kp 4, for the three-hour period tagged 12:00 UTC on 5 October 2026. The newest period in the data, tagged 15:00 UTC, has no value yet."), leadOf(kpGap));
  assert.ok(mainText(kpGap).includes("Not shown: the solar wind data is not available in this build."));
  assert.ok(mainText(kpGap).includes("1 period has no value and is drawn at 0."));
  // an empty close approach list is refused by the guard (the previous page stays); one pass earlier on the day read is still a page
  assert.throws(() => summariseApproaches(approachesDoc({ approaches: [] }), { now }), /no close approach in its window/);
  const onePast = renderPage(approachesPage(summariseApproaches(approachesDoc({ approaches: [approachesDoc().approaches[1]] }), { now })));
  assert.match(leadOf(onePast), /has 1 close approach to Earth from that day on, .* The first is 2026 AA, on 5 October 2026 at 03:00 UTC/);
  assert.ok(mainText(onePast).includes("a pass earlier that day can already be over when you read this"));
  assert.ok(!/NaN|undefined|null/.test(textOf(onePast)));
  const calm = renderPage(stormsPage(summariseStorms(stormsDoc({ storms: [] }), { now }), { coast }));
  assert.match(leadOf(calm), /lists no active storms in its Atlantic, Eastern Pacific and Central Pacific basins\.$/);
  assert.ok(!calm.includes('class="map"'), "no empty map");
  const calmG = mainText(renderPage(stormsPage(summariseStorms(stormsDoc({ storms: [] }), { now, events: { list: gdacsEvents, dataTime: "2026-10-05T17:00:00Z" } }), { coast })));
  assert.ok(calmG.includes("Tropical Cyclone KOINU-26") && calmG.includes("GDACS says its information is purely indicative"));
  const old = renderPage(quakesPage(summariseQuakes(quakesDoc(), { now: new Date("2026-10-08T00:00:00Z"), allowStale: true }), { coast }));
  assert.ok(mainText(old).includes("This copy was built from the data bundled with the site when it was deployed, which is older than the 3 hours this page allows for live data."));
  assert.ok(!mainText(smallHtml.quakes).includes("This copy was built from the data bundled"));
});

test("the storm map frames the storms and their tracks, and falls back to the whole map across the antimeridian", () => {
  const b = stormBounds(S.storms.storms);
  for (const x of S.storms.storms) for (const [lat, lon] of [[x.lat, x.lon], ...x.track.map((t) => [t.lat, t.lon])]) assert.ok(lat > b.south && lat < b.north && lon > b.west && lon < b.east);
  assert.ok(b.east - b.west >= 2 * (b.north - b.south) - 1);
  assert.deepEqual(stormBounds([{ lat: 20, lon: 178, track: [{ lat: 22, lon: -179 }] }]), { south: -90, north: 90, west: -180, east: 180 });
  assert.equal(stormBounds([]), null);
});

test("the hub lists every live page it can link, links each one that exists, and shows a stale page without a link or a number", () => {
  const t = mainText(smallHtml.hub);
  for (const p of HAZARD_PAGES) assert.ok(smallHtml.hub.includes(`href="../${p.slug}/"`), p.slug);
  // the rows of the fleet and events pages come from their own family (hubRows' "more"); test/pages-events.test.js checks them
  for (const f of LIVE_FILES.filter((x) => x !== RIGHT_NOW_FILE && !EVENT_FILES.includes(x))) assert.ok(smallHtml.hub.includes(`href="../${urlPath(f)}"`), `${f} is linked from the hub`);
  assert.ok(t.includes("16,624 active satellites"));
  assert.ok(t.includes("8 earthquakes in 24 hours in USGS's magnitude 2.5 and above feed, largest magnitude 6.4"));
  const rows = hubRows({ satellites: { active: 16624, dataTime: "2026-10-05T14:00:00Z" }, quakes: S.quakes, space: S.space, missing: { asteroids: "data older than 48 hours" } });
  const stale = rightNowPage(rows, { available: LIVE_FILES.filter((f) => !/asteroid|storms|wildfires/.test(f)) });
  const sh = renderPage(stale), st = mainText(sh);
  assert.ok(st.includes("Asteroid close approaches Data older than 48 hours; page not updated"), st);
  assert.ok(st.includes("Tropical storms now Not available in this build; page not updated"));
  assert.ok(!sh.includes('href="../asteroid-close-approaches/"') || sh.match(/href="\.\.\/asteroid-close-approaches\/"/g).length === 0, "the stale page is not linked");
  assert.ok(!sh.includes('href="../tropical-storms-now/"'));
  assert.equal(stale.jsonld[0].dateModified, "2026-10-05T18:00:00Z", "the newest data time of the pages shown");
  // every link on the hub lands on a live page, a guide, the app or an outside source
  const known = new Set([...LIVE_FILES, "index.html", "methods/index.html", ...NAV.map(([f]) => (f === "" ? "index.html" : f + "index.html")), ...HAZARD_PAGES.map((p) => p.guide), "guides/satellites/index.html"]);
  for (const m of smallHtml.hub.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/ href="([^"#]*)"/g)) {
    if (/^https?:/.test(m[1])) continue;
    let target = path.posix.normalize(path.posix.join("right-now", m[1]));
    if (target === "." || target === "./") target = "index.html"; else if (!target.endsWith(".html")) target = target.replace(/\/?$/, "/index.html");
    assert.ok(known.has(target), `${m[1]} -> ${target}`);
  }
});

test("the registry of live pages holds the count page, the country hub, five country pages, five hazard pages, three fleet and events pages and the hub", () => {
  assert.equal(LIVE_FILES.length, 16);
  assert.equal(new Set(LIVE_FILES).size, 16);
  assert.equal(LIVE_FILES[0], SATCOUNT_FILE);
  assert.deepEqual(LIVE_PAGES.filter((p) => p.kind === "hazard").map((p) => p.file), HAZARD_PAGES.map((p) => p.file));
  assert.equal(LIVE_FILES.at(-1), RIGHT_NOW_FILE);
});

test("the server allows every live page that is not a count or country page (hosting/lib.php, read as text)", () => {
  const php = fs.readFileSync(path.join(root, "hosting/lib.php"), "utf8");
  const re = php.match(/function radar_safe_page_path[\s\S]*?preg_match\('#\^\(\?:([\s\S]*?)\)\\z#'/);
  assert.ok(re, "the allowed list is found");
  const allowed = new RegExp(`^(?:${re[1]})$`);
  for (const p of LIVE_PAGES.filter((x) => x.kind === "hazard" || x.kind === "hub")) assert.ok(allowed.test(p.file), `${p.file} is not allowed by hosting/lib.php`);
  for (const f of LIVE_FILES) assert.ok(allowed.test(f), `${f}`);
  assert.ok(!allowed.test("right-now/index.html\n") && !allowed.test("about/index.html"));
});

test("the five pages share little text with each other or with the count page: they share the shell only", (t) => {
  const words = (h) => mainText(h).toLowerCase().replace(/\d[\d,.]*/g, " n ").split(/[^a-z']+/).filter(Boolean);
  const shingles = (h) => { const w = words(h), s = new Set(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; };
  const pages = [...realHtml].filter(([f]) => f !== RIGHT_NOW_FILE).map(([f, h]) => [f, shingles(h)]);
  pages.push(["count", shingles(renderPage(satelliteCountPage(countSatellites(buildFixture(STANDARD)), { updated: now })))]);
  let worst = 0;
  for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) {
    let c = 0; for (const x of pages[i][1]) if (pages[j][1].has(x)) c++;
    const jac = c / (pages[i][1].size + pages[j][1].size - c);
    worst = Math.max(worst, jac);
    assert.ok(jac < 0.1, `${pages[i][0]} / ${pages[j][0]}: ${jac}`);
  }
  t.diagnostic(`worst shared share of 8-word sequences: ${(worst * 100).toFixed(1)} percent`);
});

test("review fixes: the alerts table names how many it shows and leaves out replaced warnings; a broken solar wind file leaves a Kp-only page", () => {
  const a = mainText(realHtml.get("aurora-tonight/index.html"));
  assert.ok(a.includes("NOAA issued 14 geomagnetic messages in the 72 hours our collector keeps. 2 were warnings that a later extension replaced, and are left out. The latest 10 of the other 12 are shown, newest first, in NOAA's own words."), a);
  assert.ok(realHtml.get("aurora-tonight/index.html").includes('aria-label="The latest 10 NOAA geomagnetic messages"'));
  const broken = renderPage(auroraPage(summariseSpace({ kp: kpRows(), spaceweather: windDoc({ points: [{ t: "2026-10-05T17:00:00Z", speed: 9999 }] }) }, { now }), { coast }));
  assert.match(leadOf(broken), /^As of 5 October 2026, 15:00 UTC, the latest planetary Kp index in NOAA's data is Kp 2\.67, for the three-hour period tagged 15:00 UTC on 5 October 2026\.$/);
  assert.ok(mainText(broken).includes("Not shown: the solar wind data is not usable: it failed our checks."));
});

test("review fixes: busiest hours that tie are all named (three, then a count), the FIRMS satellites are the collector's fixed three, and no unsourced cone sentence", () => {
  const ev = (id, h) => ({ id, mag: 3, place: "x, Fiji", time: new Date(Date.parse(GEN) - h * 3600e3).toISOString().replace(".000Z", "Z"), lat: 1, lon: 1, depth: 10, status: "reviewed", felt: 0, url: "" });
  const two = mainText(renderPage(quakesPage(summariseQuakes({ generated: GEN, events: [ev("a", 0.5), ev("b", 2.5)] }, { now }), { coast })));
  assert.ok(two.includes("The busiest hours, with 1 each, were the ones from 15:00 UTC and 17:00 UTC."), two);
  const five = mainText(renderPage(quakesPage(summariseQuakes({ generated: GEN, events: [0.5, 2.5, 4.5, 6.5, 8.5].map((h, i) => ev(`e${i}`, h)) }, { now }), { coast })));
  assert.ok(five.includes("The busiest hours, with 1 each, were the ones from 09:00 UTC, 11:00 UTC, 13:00 UTC and 2 more."), five);
  assert.ok(mainText(smallHtml.quakes).includes("The busiest hour was the one from 17:00 UTC, with 3."));
  const f = mainText(smallHtml.fires);
  assert.ok(f.includes("Our collector reads NASA FIRMS's 24 hour global files for Suomi NPP, NOAA-20 and NOAA-21, one file each. This set of files holds detections from all 3."));
  const oneSat = fireFiles(); oneSat.summary.bySatellite = { N20: oneSat.summary.detections };
  const f1 = mainText(renderPage(firesPage(summariseFires(oneSat, { now, places: tinyPlaces }), { coast })));
  assert.ok(f1.includes("for the VIIRS instruments on Suomi NPP, NOAA-20 and NOAA-21 hold") && f1.includes("This set of files holds detections from 1 of the 3."), f1);
  assert.ok(!mainText(smallHtml.storms).includes("The cone of uncertainty is on each storm's NHC page"));
  assert.ok(!mainText(smallHtml.quakes).includes("just under"));
});

test("review fixes: the hub says what each time is, and gives no structured date when there is no data", () => {
  const t = mainText(smallHtml.hub);
  for (const part of ["5 Oct, 14:00 (satellite data)", "5 Oct, 18:00 (USGS feed)", "Kp period tagged 5 Oct, 15:00; solar wind 5 Oct, 17:55", "5 October 2026 (the day the list was read)", "5 Oct, 15:00 (newest advisory)", "5 Oct, 16:00 (newest detection)"]) assert.ok(t.includes(part), part);
  const empty = rightNowPage(hubRows({}));
  const wp = empty.jsonld.find((o) => o["@type"] === "WebPage");
  assert.ok(!("dateModified" in wp), "no 1970 date");
  assert.ok(!renderPage(empty).includes("1970"));
});

test("review fixes: storm and asteroid pages do not change when only the collector's read time changes", () => {
  const later = new Date("2026-10-05T23:40:00Z");
  assert.equal(renderPage(stormsPage(summariseStorms(stormsDoc({ generated: "2026-10-05T23:30:00Z" }), { now: later }), { coast })), smallHtml.storms);
  assert.equal(renderPage(approachesPage(summariseApproaches(approachesDoc({ generated: "2026-10-05T23:30:00Z" }), { now: later }))), smallHtml.asteroids);
  const calm = (g) => renderPage(stormsPage(summariseStorms(stormsDoc({ storms: [], generated: g }), { now: later }), { coast }));
  assert.equal(calm("2026-10-05T19:00:00Z"), calm("2026-10-05T23:30:00Z"), "no active storm: the same page all day");
  assert.notEqual(calm("2026-10-05T23:30:00Z"), renderPage(stormsPage(summariseStorms(stormsDoc({ storms: [], generated: "2026-10-06T00:10:00Z" }), { now: new Date("2026-10-06T00:20:00Z") }), { coast })), "a new day is a new page");
});
