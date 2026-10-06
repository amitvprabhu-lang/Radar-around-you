import test from "node:test";
import assert from "node:assert/strict";
import { cityPage, skyHubPage, issPage, polarChartSvg, moonStripSvg, cloudStripSvg, issMapSvg, splitAtAntimeridian, webPageLd, MET_CREDIT } from "../site/pages-sky.mjs";
import * as S from "../site/sky.mjs";
import { renderPage, SITE, urlPath } from "../site/layout.mjs";
import { xmlProblem } from "./helpers/xml.mjs";
import { SKY_NOW, SAT_TIME, realClouds, realPrecise, skyCities, cityOf, skyData, skyCoast, skyPlaces, cloudsDoc } from "./helpers/skyfixture.mjs";

const cities = skyCities(), coast = skyCoast();
const built = [S.SKY_HUB_FILE, S.ISS_FILE, ...cities.map((c) => S.skyCityFile(c.id)), "aurora-tonight/index.html", "right-now/index.html"];
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));

const SUMS = cities.map((c) => S.summariseCity(c, { clouds: realClouds(), precise: realPrecise(), sky: skyData(), now: SKY_NOW }));
const ISS = S.summariseIss(realPrecise(), { dataTime: SAT_TIME, now: SKY_NOW, cities, places: skyPlaces() });
const PAGES = [...SUMS.map((s) => cityPage(s, { built, cities })), skyHubPage(SUMS, S.hubFindings(SUMS), { built, cities }), issPage(ISS, { built, cities, coast })];
const HTML = new Map(PAGES.map((p) => [p.file, renderPage(p, { noindex: false })]));
// edge cases: the midnight Sun and the polar night in Tromsø, no satellite data, no window, a stale deploy-time copy
const tromso = cityOf("tromso");
const EDGE = [
  S.summariseCity(tromso, { clouds: cloudsDoc(["tromso"], { updated: "2026-06-21T12:00:00Z", from: "2026-06-21T12:00:00Z" }), sky: skyData(), now: new Date("2026-06-21T13:00:00Z") }),
  S.summariseCity(tromso, { clouds: cloudsDoc(["tromso"], { updated: "2026-12-21T12:00:00Z", from: "2026-12-21T12:00:00Z", cloud: 0 }), precise: realPrecise(), sky: skyData(), now: new Date("2026-12-21T13:00:00Z") }),
  S.summariseCity(cityOf("london"), { clouds: cloudsDoc(["london"], { cloud: 100 }), sky: skyData(), now: new Date("2026-10-06T09:00:00Z"), allowStale: true }),
];
const EDGE_HTML = EDGE.map((s, i) => [`edge ${i}`, renderPage(cityPage(s, { built, cities }), { noindex: false })]);
const ALL = [...HTML, ...EDGE_HTML];

test("the hub, six city pages and the ISS page have their addresses, one h1 each and their own canonical address", () => {
  assert.deepEqual(PAGES.map((p) => p.file), [...S.SKY_CITY_IDS.map(S.skyCityFile), S.SKY_HUB_FILE, S.ISS_FILE]);
  for (const [f, h] of HTML) {
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, f);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`), f);
  }
});

test("titles are under 60 characters and unique, descriptions under 160 and unique, also for the longest city name and date", () => {
  const all = [...PAGES, ...EDGE.map((s) => cityPage(s, { built, cities }))];
  for (const p of all) {
    assert.ok(p.title.length < 60, `${p.file}: ${p.title.length} ${p.title}`);
    assert.ok(p.description.length < 160, `${p.file}: ${p.description.length} ${p.description}`);
  }
  assert.equal(new Set(PAGES.map((p) => p.title)).size, PAGES.length);
  assert.equal(new Set(PAGES.map((p) => p.description)).size, PAGES.length);
  const long = { ...cityOf("newyork"), name: "New York" };
  const s = S.summariseCity(long, { clouds: cloudsDoc(["newyork"], { updated: "2026-09-30T20:00:00Z", from: "2026-09-30T20:00:00Z", cloud: 3 }), sky: skyData(), now: new Date("2026-09-30T21:00:00Z") });
  const p = cityPage(s, { built, cities });
  assert.ok(p.description.length < 160 && p.description.includes("30 September 2026"), p.description);
});

test("each lead answers first with the data time in a <time datetime> that is the WebPage's dateModified", () => {
  for (const [f, h] of ALL) {
    const lead = h.match(/<p class="lead">([\s\S]*?)<\/p>/)[1];
    const m = lead.match(/^As of <time datetime="(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)">/);
    assert.ok(m, `${f}: ${lead.slice(0, 80)}`);
    const web = ldOf(h).find((o) => o["@type"] === "WebPage");
    assert.equal(web.dateModified, m[1], f);
  }
  assert.ok(HTML.get(S.skyCityFile("sydney")).includes('<time datetime="2026-10-05T23:18:36Z">'));
  // the ISS lead names the element set's own time as well
  assert.match(HTML.get(S.ISS_FILE).match(/<p class="lead">([\s\S]*?)<\/p>/)[1], /element set of <time datetime="2026-10-05T11:57:27Z">/);
});

test("'What this means' comes right after the lead with 3 to 6 findings, and every number in them is on the page elsewhere too", () => {
  for (const [f, h] of ALL) {
    const main = mainOf(h);
    const firstH2 = main.match(/<h2[^>]*>([^<]*)<\/h2>/);
    assert.equal(firstH2[1], "What this means", f);
    const items = [...main.match(/<ul class="findings">([\s\S]*?)<\/ul>/)[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => textOf(x[1]));
    assert.ok(items.length >= 3 && items.length <= 6, `${f}: ${items.length}`);
    const rest = textOf(main.replace(/<ul class="findings">[\s\S]*?<\/ul>/, "")) + JSON.stringify(ldOf(h));
    for (const it of items) for (const n of it.match(/\d+(\.\d+)?/g) || []) assert.ok(rest.includes(n), `${f}: ${n} from "${it}" is not elsewhere on the page`);
  }
});

test("Google readiness (design section 7): figures with captions, tables with captions and column headers, headings in order, JSON-LD", () => {
  for (const [f, h] of ALL) {
    const main = mainOf(h);
    const svgs = main.match(/<svg[\s\S]*?<\/svg>/g) || [];
    assert.ok(svgs.length >= 1, f);
    assert.equal((main.match(/<figure>/g) || []).length, svgs.length, `${f}: every chart and map is in a figure`);
    for (const fig of main.match(/<figure>[\s\S]*?<\/figure>/g)) {
      assert.match(fig, /<figcaption>[^<]*[\s\S]*<time datetime="[^"]+Z">[\s\S]*<\/figcaption>/, `${f}: the caption gives the data time`);
      assert.equal((fig.match(/<svg/g) || []).length, 1);
    }
    for (const t of main.match(/<table>[\s\S]*?<\/table>/g) || []) {
      assert.match(t, /^<table><caption>[^<]+<\/caption>/, f);
      assert.ok(!/<th(?=[\s>])(?![^>]*scope="(col|row)")/.test(t), `${f}: a header cell without scope`);
    }
    let level = 1;
    for (const m of main.matchAll(/<h([1-6])[ >]/g)) { const l = Number(m[1]); assert.ok(l <= level + 1, `${f}: h${l} after h${level}`); level = l; }
    const ld = ldOf(h);
    assert.ok(!ld.some((o) => o["@type"] === "FAQPage"), f);
    const web = ld.find((o) => o["@type"] === "WebPage");
    assert.equal(web.inLanguage, "en");
    assert.equal(web.url, `${SITE.url}/${urlPath(f.startsWith("edge") ? S.skyCityFile(f === "edge 2" ? "london" : "tromso") : f)}`);
    assert.deepEqual(web.isPartOf, { "@type": "WebSite", name: SITE.name, url: `${SITE.url}/` });
    const crumbs = ld.find((o) => o["@type"] === "BreadcrumbList");
    assert.deepEqual(web.breadcrumb.itemListElement, crumbs.itemListElement, `${f}: the WebPage's breadcrumb is the page's breadcrumb`);
    assert.ok(main.includes('id="faq"') && main.includes('id="sources"'), f);
  }
});

test("every chart and map is well formed XML with role img, a title and a description, and its marks are labelled, not only coloured", () => {
  let n = 0;
  for (const [f, h] of ALL) for (const svg of h.match(/<svg[\s\S]*?<\/svg>/g) || []) {
    n++;
    assert.equal(xmlProblem(svg), null, `${f}: ${xmlProblem(svg)}`);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title id="[a-z0-9-]+-t">[^<]+<\/title>/, f);
    assert.match(svg, /<desc id="[a-z0-9-]+-d">[^<]+<\/desc>/, f);
  }
  assert.ok(n >= 25, String(n));
  const syd = SUMS.find((s) => s.city.id === "sydney");
  const chart = polarChartSvg({ id: "c", title: "t", desc: "d", chart: syd.chart });
  for (const p of syd.chart.planets) assert.ok(chart.includes(`>${p.name}</text>`), `${p.name} is labelled`);
  for (const t of ["N", "E", "S", "W"]) assert.ok(chart.includes(`>${t}</text>`));
  const strip = cloudStripSvg({ id: "k", title: "t", desc: "d", hours: syd.strip.hours, best: syd.strip.best, tz: syd.tz });
  for (const q of syd.strip.hours) assert.ok(strip.includes(`>${q.cloud}</text>`), "each bar has its value printed");
  assert.ok(strip.includes(">best window</text>"));
  const moon = moonStripSvg({ id: "m", title: "t", desc: "d", moon: syd.moon, start: syd.night.start, end: syd.night.end, tz: syd.tz });
  assert.ok(moon.includes(">horizon</text>") && moon.includes(">Moonrise "));
  const map = issMapSvg({ id: "i", title: "t", desc: "d", coast: [], track: ISS.track, position: ISS.position, cities });
  assert.ok(map.includes(">ISS at the data time</text>") && map.includes('stroke-dasharray="30 24"'));
  for (const c of cities) assert.ok(map.includes(`>${c.name}</text>`));
});

test("the track is broken at the antimeridian, so no line crosses the whole map", () => {
  assert.deepEqual(splitAtAntimeridian([{ lat: 0, lon: 170 }, { lat: 1, lon: 179 }, { lat: 2, lon: -178 }, { lat: 3, lon: -170 }]).map((r) => r.length), [2, 2]);
  assert.deepEqual(splitAtAntimeridian([{ lat: 0, lon: 10 }, { lat: 1, lon: 20 }]).map((r) => r.length), [2]);
  assert.deepEqual(splitAtAntimeridian([{ lat: 0, lon: 179 }, { lat: 1, lon: -179 }]), [], "runs of one point draw nothing");
  const map = issMapSvg({ id: "i", title: "t", desc: "d", coast: [], track: ISS.track, position: ISS.position, cities: [] });
  for (const d of [...map.matchAll(/<path d="(M[^"]*)" fill="none" stroke="var\(--signal\)"/g)].map((m) => m[1])) {
    for (const run of d.split("M").filter(Boolean)) {
      const xs = run.split("L").map((pt) => Number(pt.split(" ")[0]));
      for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1]) < 1800, "no jump of more than half the map");
    }
  }
});

test("MET Norway is credited visibly on the city pages and the hub, and the forecast is called theirs", () => {
  for (const [f, h] of HTML) {
    if (f === S.ISS_FILE) continue;
    const t = textOf(mainOf(h));
    assert.ok(t.includes(MET_CREDIT), f);
    assert.ok(t.includes("Cloud forecast: MET Norway's, not ours."), f);
    assert.ok(t.includes("NLOD 2.0 and CC BY 4.0"), f);
  }
});

test("method sections say what is computed with what, and that times are computed, not observed; no promise of visibility", () => {
  for (const [f, h] of ALL) {
    const t = textOf(mainOf(h));
    assert.ok(/computed, not observed/i.test(t), f);
    const bad = t.match(/.{0,50}(you will see|will be visible|guaranteed|definitely|perfect view).{0,30}/i);
    assert.ok(!bad, `${f}: ${bad && bad[0]}`);
  }
  const hub = textOf(mainOf(HTML.get(S.SKY_HUB_FILE)));
  assert.ok(hub.includes("astronomy-engine") && hub.includes("SGP4") && hub.includes(`within ${S.RISE_SET_CHECK_MINUTES} minutes`));
  assert.ok(hub.includes("The planet positions are not compared with a second source."));
  assert.ok(hub.includes("within 15 percent"));
  assert.ok(textOf(mainOf(HTML.get(S.ISS_FILE))).includes("The real-time view is the live globe"));
});

test("polar cases and missing data are said in words: no night under the midnight Sun, polar night, no ISS data, a stale copy", () => {
  const [june, dec, stale] = EDGE_HTML.map(([, h]) => textOf(mainOf(h)));
  assert.ok(june.includes("the Sun does not set in Tromsø in the 24 hours after the forecast time"), june.slice(0, 300));
  assert.ok(june.includes("nothing in them is dark"));
  assert.ok(dec.includes("The Sun does not rise in Tromsø in the 24 hours from"));
  assert.ok(june.includes("Not shown: no satellite data in this build."));
  assert.ok(stale.includes("This copy was built from the data bundled with the site when it was deployed"));
  assert.ok(textOf(mainOf(HTML.get(S.skyCityFile("pune")))).includes("does not pass at least 10° above the horizon"));
});

test("house style: no dashes, no emoji, no hidden text, nothing loaded from elsewhere, under 250 KB, no broken values, deterministic", () => {
  for (const [f, h] of ALL) {
    assert.ok(!/[\u2013\u2014]/.test(h), `${f}: en or em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), `${f}: emoji`);
    assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), `${f}: hidden text`);
    // the only script loaded is the site's own live-pages.js (design section 8.1), and nothing else comes from elsewhere
    assert.deepEqual([...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^(\.\.\/)+/, "")), ["live-pages.js"], f);
    assert.match(h, /<body data-live-v="1"/, f);
    assert.ok(!/<img /.test(h) && !/<link[^>]+stylesheet/.test(h), f);
    assert.ok(Buffer.byteLength(h) < 250 * 1024, `${f}: ${Buffer.byteLength(h)}`);
    assert.ok(!/NaN|undefined|\bnull\b|Infinity/.test(textOf(h)), `${f}: a broken value`);
  }
  const again = cities.map((c) => S.summariseCity(c, { clouds: realClouds(), precise: realPrecise(), sky: skyData(), now: new Date("2026-10-06T03:30:00Z") }));
  assert.equal(renderPage(cityPage(again[0], { built, cities }), { noindex: false }), HTML.get(S.skyCityFile("pune")), "another build time with the same data gives the same bytes");
  assert.equal(renderPage(skyHubPage(again, S.hubFindings(again), { built, cities }), { noindex: false }), HTML.get(S.SKY_HUB_FILE));
});

test("text from outside is escaped, and links point only at pages that exist in the build", () => {
  const evil = { ...cityOf("london"), name: 'Lon<b>don & "x"' };
  const s = S.summariseCity(evil, { clouds: cloudsDoc(["london"]), sky: skyData(), now: SKY_NOW });
  const h = renderPage(cityPage(s, { built, cities: [evil] }));
  assert.ok(!h.includes("Lon<b>don"));
  assert.ok(h.includes("Lon&lt;b&gt;don &amp; &quot;x&quot;"));
  const few = renderPage(cityPage(SUMS[0], { built: [S.skyCityFile("pune")], cities }));
  assert.ok(!few.includes('href="../../iss-today/"') && !few.includes('href="../../aurora-tonight/"') && !few.includes('href="../london/"'));
  const hub = HTML.get(S.SKY_HUB_FILE);
  for (const c of cities) assert.ok(hub.includes(`href="${c.id}/"`), c.id);
  assert.ok(hub.includes('href="../iss-today/"') && hub.includes('href="../moon-phases/"') && hub.includes('href="../planets/"') && hub.includes('href="../meteor-showers/"') && hub.includes('href="../aurora-tonight/"'));
  // a missing city is shown on the hub with its reason and no link
  const five = SUMS.filter((x) => x.city.id !== "tokyo");
  const h5 = renderPage(skyHubPage(five, S.hubFindings(five), { built: built.filter((f) => !f.includes("tokyo")), cities, missing: { tokyo: "data older than the page's limit" } }));
  assert.ok(textOf(h5).includes("Tokyo Data older than the page's limit; page not updated"));
  assert.ok(!h5.includes('href="tokyo/"'));
});

// Share of shared 8-word sequences between two city pages, over the page inside <main>, after numbers become "n" and each page's city name
// becomes "city" (the measure of test/pages-country.test.js).
test("the six city pages differ in substance: under half of their 8-word sequences are shared", (t) => {
  const norm = (h, name) => textOf(mainOf(h)).split(name).join(" city ").toLowerCase().replace(/\d[\d,.:]*/g, " n ").split(/[^a-zø']+/).filter(Boolean);
  const sh = SUMS.map((s) => { const w = norm(HTML.get(S.skyCityFile(s.city.id)), s.city.name), set = new Set(); for (let i = 0; i + 8 <= w.length; i++) set.add(w.slice(i, i + 8).join(" ")); return [s.city.name, set]; });
  let worst = { j: 0 };
  for (let i = 0; i < sh.length; i++) for (let k = i + 1; k < sh.length; k++) {
    let c = 0; for (const x of sh[i][1]) if (sh[k][1].has(x)) c++;
    const j = c / (sh[i][1].size + sh[k][1].size - c);
    if (j > worst.j) worst = { j, pair: `${sh[i][0]} / ${sh[k][0]}` };
    assert.ok(j < 0.5, `${sh[i][0]} / ${sh[k][0]}: ${(j * 100).toFixed(1)} percent`);
  }
  t.diagnostic(`worst pair ${worst.pair}: ${(worst.j * 100).toFixed(1)} percent of 8-word sequences shared (Jaccard)`);
});

test("the WebPage helper gives the section 7 properties", () => {
  const w = webPageLd({ title: "T", description: "D", file: "iss-today/index.html", dataTime: "2026-10-06T00:01:36Z", trail: [{ name: "ISS today", file: "iss-today/index.html" }] });
  assert.deepEqual(Object.keys(w), ["@context", "@type", "name", "description", "url", "inLanguage", "dateModified", "isPartOf", "breadcrumb"]);
  assert.equal(w.breadcrumb.itemListElement.length, 2);
});
