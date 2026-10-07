// The satellites and debris by country pages (site/objects.mjs, site/pages-objects.mjs, site/objects-family.mjs, site/objects-js.mjs and
// their part of site/build-live.mjs), on the satcat feed the collector makes from a trim of the real catalogue of 2026-10-07.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildLive } from "../site/build-live.mjs";
import { OWNER_PAGES, NEW_OWNER_PAGES, OBJECT_PAGES, RANKING_FILE, OWNER_SELECT_MIN, OWNER_PAGE_MIN, STATIC_ROWS, STATIC_ALL_MAX, OBJECTS_MAX_AGE_HOURS,
  orbitFromApsides, fastActiveByCode, summariseObjects, readDetail, ownerDetail, launchOfIntl, ORBIT_KEYS } from "../site/objects.mjs";
import { objNorm, objMatch, objKey, objCompare, objParse, objFormat, objPrepare, objSortItems, objFilterItems, objPage, objCells, objectsScript, OBJ_CONST } from "../site/objects-js.mjs";
import { COUNTRY_PAGES, HUB_FILE } from "../site/satcountry.mjs";
import { SATCOUNT_FILE, LIVE_FILES } from "../site/livepages.mjs";
import { PAGE_PATH_RE } from "../site/live-snapshot.mjs";
import { SITE, urlPath } from "../site/layout.mjs";
import { ORBIT_BOUNDS } from "../site/satcount.mjs";
import { countryFixture } from "./helpers/satfixture.mjs";
import { objectsDataDir, satcatSummary, satcatDetail, bigDetail, SATCAT_TIME, SAT_TIME_OBJ, OBJECTS_NOW, TEST_OBJECT_BOUNDS } from "./helpers/satcatfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "objt-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const opts = { noindex: false, bounds: { min: 5, max: 1000 }, objectBounds: TEST_OBJECT_BOUNDS };
const read = (out, f) => fs.readFileSync(path.join(out, f), "utf8");
const readIndex = (out) => JSON.parse(read(out, "index.json"));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const n = (t) => Number(String(t).replace(/<[^>]+>/g, "").replace(/,/g, ""));
const tableRows = (h, id) => { const t = h.match(new RegExp(`<table id="${id}">[\\s\\S]*?</table>`))[0]; return { body: [...t.slice(t.indexOf("<tbody>"), t.indexOf("</tbody>")).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1])), tr: t }; };
const captionRows = (h, caption) => { const m = h.match(new RegExp(`<caption>${caption.replace(/[()]/g, "\\$&")}</caption>[\\s\\S]*?</table>`)); assert.ok(m, caption); return [...m[0].slice(m[0].indexOf("<tbody>"), m[0].indexOf("</tbody>")).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1])); };

// one build of every page from the fixtures, shared by the page tests
const DATA = objectsDataDir({ dir: mk() });
const OUT = mk();
const R = buildLive({ dataDir: DATA, outDir: OUT, now: OBJECTS_NOW, ...opts });
const OWNER_FILES = NEW_OWNER_PAGES.map((p) => p.file);
const summary = satcatSummary();

// ---------------------------------------------------------------- the list of owner pages and the server's whitelist
test("the owner pages: unique codes and slugs, the five country pages reused, every new slug outside the five", () => {
  assert.equal(OWNER_PAGES.length, 24);
  assert.equal(new Set(OWNER_PAGES.map((p) => p.code)).size, 24);
  assert.equal(new Set(OWNER_PAGES.map((p) => p.slug)).size, 24);
  assert.deepEqual(OWNER_PAGES.filter((p) => p.country).map((p) => p.file).sort(), COUNTRY_PAGES.map((p) => p.file).sort());
  for (const p of NEW_OWNER_PAGES) {
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!COUNTRY_PAGES.some((c) => c.slug === p.slug), p.slug);
    assert.equal(p.file, `satellites-by-country/${p.slug}/index.html`);
    assert.ok(p.name && p.phrase, p.code);
  }
  assert.ok(!OWNER_PAGES.some((p) => p.code === "TBD"), "To Be Determined has no page");
  assert.deepEqual(OBJECT_PAGES.map((p) => p.file), [RANKING_FILE, ...OWNER_FILES]);
  assert.ok(OWNER_PAGE_MIN < OWNER_SELECT_MIN);
});

test("the server's allowed page list in hosting/lib.php names exactly the new owner slugs, and the build-time copy agrees", () => {
  const php = fs.readFileSync(path.join(root, "hosting/lib.php"), "utf8");
  const groups = [...php.matchAll(/satellites-by-country\/\(\?:([a-z0-9|-]+)\)\/index/g)].map((m) => m[1].split("|").sort());
  assert.equal(groups.length, 2, "the country group and the owner group");
  assert.deepEqual(groups[0], COUNTRY_PAGES.map((p) => p.slug).sort());
  assert.deepEqual(groups[1], NEW_OWNER_PAGES.map((p) => p.slug).sort());
  assert.ok(php.includes("satellites-and-debris-by-country/index\\.html"));
  for (const f of [RANKING_FILE, ...OWNER_FILES]) assert.ok(PAGE_PATH_RE.test(f), f);
  for (const bad of ["satellites-by-country/tbd/index.html", "satellites-by-country/indiax/index.html", "satellites-and-debris-by-country/india/index.html", "satellites-by-country/india/index.html\n"]) assert.ok(!PAGE_PATH_RE.test(bad), bad);
});

// ---------------------------------------------------------------- pure parts
test("orbit groups from perigee and apogee use the count page's bounds", () => {
  assert.equal(orbitFromApsides(540, 550), "low");
  assert.equal(orbitFromApsides(ORBIT_BOUNDS.lowBelow - 1, ORBIT_BOUNDS.lowBelow - 1), "low");
  assert.equal(orbitFromApsides(ORBIT_BOUNDS.lowBelow, ORBIT_BOUNDS.lowBelow), "medium");
  assert.equal(orbitFromApsides(20180, 20190), "medium");
  assert.equal(orbitFromApsides(35780, 35793), "geostationary");
  assert.equal(orbitFromApsides(36500, 36600), "beyond");
  assert.equal(orbitFromApsides(250, 35800), "highElliptical", "a transfer orbit");
  assert.equal(orbitFromApsides(null, 500), "none");
});

test("active satellites in the orbit data, by owner code, with the count page's definition", () => {
  const fx = countryFixture();
  const f = fastActiveByCode(fx);
  assert.equal(f.byCode.get("US"), 130);
  assert.equal(f.byCode.get("PRC"), 90);
  assert.equal(f.byCode.get(""), 2, "no owner recorded");
  assert.equal(f.total, 402);
});

test("the summary adds up, ranks owners, joins the orbit data by code and keeps both data times", () => {
  const fx = countryFixture();
  const s = summariseObjects({ summary, fast: { meta: { ...fx.meta, taken: SAT_TIME_OBJ }, details: fx.details } }, { now: OBJECTS_NOW, bounds: TEST_OBJECT_BOUNDS });
  assert.equal(s.catTime, SATCAT_TIME);
  assert.equal(s.satTime, SAT_TIME_OBJ);
  assert.equal(s.dataTime, SAT_TIME_OBJ, "the later of the two");
  assert.equal(s.owners.filter((o) => o.total > 0).reduce((x, o) => x + o.total, 0), summary.totals.total);
  assert.equal(s.owners.find((o) => o.code === "US").fast, 130);
  assert.equal(s.owners.find((o) => o.code === "IND").fast, 0);
  // an owner with active satellites only in the orbit data still gets a row
  const extra = summariseObjects({ summary, fast: { meta: { ...fx.meta, taken: SAT_TIME_OBJ, ownerCodes: ["US", "PRC", "UK", "CIS", "JPN", "NEWCO", "EMP"] }, details: fx.details } }, { now: OBJECTS_NOW, bounds: TEST_OBJECT_BOUNDS });
  assert.ok(extra.owners.some((o) => o.code === "NEWCO" && o.total === 0 && o.fast === 4));
  for (let i = 1; i < s.owners.length; i++) assert.ok(s.owners[i - 1].total >= s.owners[i].total);
  const ranks = s.owners.filter((o) => o.total > 0).map((o) => o.rank);
  assert.equal(ranks[0], 1);
  assert.deepEqual(s.debrisCheck, summary.debrisOwnerCheck);
});

test("the summary's guards: stale, future, implausible, not adding up, a code twice", () => {
  const at = (h) => new Date(Date.parse(SATCAT_TIME) + h * 3600000);
  assert.throws(() => summariseObjects({ summary }, { now: at(OBJECTS_MAX_AGE_HOURS + 1), bounds: TEST_OBJECT_BOUNDS }), (e) => e.stale === true && /more than 72 hours old/.test(e.message));
  assert.equal(summariseObjects({ summary }, { now: at(OBJECTS_MAX_AGE_HOURS + 1), bounds: TEST_OBJECT_BOUNDS, allowStale: true }).stale, true);
  assert.throws(() => summariseObjects({ summary }, { now: at(-2), bounds: TEST_OBJECT_BOUNDS }), /in the future/);
  assert.throws(() => summariseObjects({ summary }, { now: OBJECTS_NOW }), /implausible/, "the real bounds refuse the small sample");
  const bad = structuredClone(summary); bad.owners[0].deb += 1;
  assert.throws(() => summariseObjects({ summary: bad }, { now: OBJECTS_NOW, bounds: TEST_OBJECT_BOUNDS }), /add up/);
  const twice = structuredClone(summary); twice.owners[1].code = twice.owners[0].code;
  assert.throws(() => summariseObjects({ summary: twice }, { now: OBJECTS_NOW, bounds: TEST_OBJECT_BOUNDS }), /twice/);
  const s = summariseObjects({ summary }, { now: OBJECTS_NOW, bounds: TEST_OBJECT_BOUNDS });
  assert.equal(s.fast, null);
  assert.match(s.warnings[0], /no satellite data/);
});

test("an owner's detail: checked against the summary, every object counted once, the static tables in their stated order", () => {
  const owner = summary.owners.find((o) => o.code === "PRC");
  const rows = readDetail(satcatDetail(owner.file), owner, SATCAT_TIME);
  const d = ownerDetail(rows, { catTime: SATCAT_TIME });
  assert.equal(d.count, owner.total);
  assert.equal(ORBIT_KEYS.reduce((x, k) => x + Object.values(d.orbits[k]).reduce((a, b) => a + b, 0), 0), owner.total);
  assert.equal(d.decades.reduce((x, y) => x + y.sat + y.other, 0) + d.undated, owner.total);
  assert.equal(d.debrisGroups.reduce((x, g) => x + g.count, 0), owner.deb);
  for (const g of d.debrisGroups) assert.equal(g.launch, launchOfIntl(rows.find((r) => r.type === "D" && launchOfIntl(r.intl) === g.launch).intl));
  assert.ok(d.recentSats.length <= STATIC_ROWS && d.recentSats.every((r) => r.type === "P"));
  for (let i = 1; i < d.recentSats.length; i++) assert.ok(d.recentSats[i - 1].launch >= d.recentSats[i].launch, "most recent launch first");
  assert.equal(d.second.kind, "debris");
  const rcs = d.second.rows.map((r) => (typeof r.rcs === "number" ? r.rcs : -1));
  for (let i = 1; i < rcs.length; i++) assert.ok(rcs[i - 1] >= rcs[i], "largest radar cross-section first");
  // a detail file that does not match its summary row is refused
  assert.throws(() => readDetail(satcatDetail(owner.file), { ...owner, deb: owner.deb + 1, total: owner.total + 1 }, SATCAT_TIME), new RegExp(`has ${owner.total} objects, the summary ${owner.total + 1}`));
  assert.equal(d.all, null, `more than ${STATIC_ALL_MAX} objects: no full list in the page`);
  const small = summary.owners.find((o) => o.code === "SES");
  const sd = ownerDetail(readDetail(satcatDetail(small.file), small, SATCAT_TIME), { catTime: SATCAT_TIME });
  assert.equal(sd.all.length, small.total, "a small owner has every object listed");
  assert.throws(() => readDetail(satcatDetail(owner.file), owner, "2026-10-08T00:00:00Z"), /not the summary's/);
  assert.throws(() => readDetail(satcatDetail(owner.file), { ...owner, code: "US" }, SATCAT_TIME), /not schema 1 for that owner/);
});

// ---------------------------------------------------------------- the browser script's pure parts
test("the ranking's search finds owners by the words people use (aliases are never shown)", () => {
  const h = read(OUT, RANKING_FILE);
  const rows = [...h.matchAll(/<tr data-search="([^"]*)"><td>(?:<a [^>]*>)?([^<]*)/g)].map((m) => ({ search: m[1].replace(/&#39;/g, "'"), name: m[2].replace(/&#39;/g, "'") }));
  const find = (q) => rows.filter((r) => objMatch(r.search, q)).map((r) => r.name);
  for (const [q, owner] of [["USA", "United States"], ["UK", "United Kingdom"], ["Britain", "United Kingdom"], ["Turkey", "Türkiye"], ["Russia", "Commonwealth of Independent States (former USSR)"],
    ["Russian Federation", "Commonwealth of Independent States (former USSR)"], ["Korea", "Republic of Korea"], ["China", "People's Republic of China"], ["India", "India"]]) {
    assert.ok(find(q).includes(owner), `${q} finds ${owner}: ${find(q).join(", ")}`);
  }
  assert.ok(!/russia/i.test(textOf(mainOf(h))), "the alias is in the search data only, never in the text");
});

test("counts read correctly in the singular", async () => {
  const { kindList, kindCount } = await import("../site/pages-objects.mjs");
  assert.equal(kindList({ act: 1, inact: 1, rb: 1, deb: 1, unk: 0 }), "1 active satellite, 1 inactive satellite, 1 rocket body and 1 piece of debris");
  assert.equal(kindList({ act: 2, inact: 0, rb: 3, deb: 4, unk: 1 }), "2 active satellites, 0 inactive satellites, 3 rocket bodies, 4 pieces of debris and 1 unknown object");
  assert.equal(kindCount("obj", 1), "1 object");
  for (const f of [RANKING_FILE, ...OWNER_FILES, ...COUNTRY_PAGES.map((p) => p.file)]) {
    const t = textOf(mainOf(read(OUT, f)));
    assert.ok(!/(^|[^\d,.])1 (pieces|objects|active satellites|inactive satellites|rocket bodies|unknown objects)\b/.test(t), `${f}: ${(t.match(/(^|[^\d,.])1 (pieces|objects|active satellites|inactive satellites|rocket bodies|unknown objects)\b.{0,30}/) || [])[0]}`);
  }
});

test("the WebPage breadcrumb of an owner page is the page's own: Home, the ranking, the owner", () => {
  for (const p of NEW_OWNER_PAGES) {
    const ld = [...read(OUT, p.file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
    const page = ld.find((o) => o["@type"] === "BreadcrumbList"), wp = ld.find((o) => o["@type"] === "WebPage");
    assert.deepEqual(wp.breadcrumb.itemListElement, page.itemListElement, p.slug);
  }
});

test("the search and table functions of the page script", () => {
  assert.equal(objNorm("  Türkiye  "), "turkiye");
  assert.ok(objMatch("Türkiye TURK Turkey", "turkey"));
  assert.ok(objMatch("People's Republic of China PRC China", "china prc"));
  assert.ok(!objMatch("India IND", "indonesia"));
  assert.ok(objMatch("anything", "  "), "an empty query matches every row");
  assert.equal(objKey("12,973", true), 12973);
  assert.equal(objKey("-", true), -1);
  assert.equal(objKey("Ünited", false), "united");
  assert.ok(objCompare(2, 10, "ascending") < 0 && objCompare(2, 10, "descending") > 0);
  assert.ok(objCompare("b", "a", "ascending") > 0);
  const doc = satcatDetail("o-ind.json");
  const rows = objParse(doc, { owner: "IND", time: SATCAT_TIME }, OBJ_CONST);
  assert.equal(rows.length, doc.count);
  assert.throws(() => objParse(doc, { owner: "IND", time: "2026-10-06T04:00:00Z" }, OBJ_CONST), (e) => e.reason === "version");
  assert.throws(() => objParse(doc, { owner: "US", time: SATCAT_TIME }, OBJ_CONST), (e) => e.reason === "shape");
  assert.throws(() => objParse({ schema: 2 }, { owner: "IND", time: SATCAT_TIME }, OBJ_CONST), (e) => e.reason === "shape");
  const items = objPrepare(rows, OBJ_CONST);
  assert.equal(objFilterItems(items, "", "D").length, rows.filter((r) => r.type === "D").length);
  assert.ok(objFilterItems(items, "pslv", "").length > 0 && objFilterItems(items, "pslv", "").every((it) => /PSLV/.test(it.r.name)));
  assert.equal(objFilterItems(items, String(rows[0].id), "")[0].r.id, rows[0].id);
  const byName = objSortItems(items, 1, "ascending").map((it) => it.keys[1]);
  assert.ok(byName.every((x, i) => i === 0 || byName[i - 1] <= x));
  const byRcs = objSortItems(items, 9, "descending").map((it) => it.r.rcs);
  assert.ok(byRcs.findIndex((x) => x == null) === -1 || byRcs.slice(byRcs.findIndex((x) => x == null)).every((x) => x == null), "objects without a radar cross-section come last going down");
  assert.notEqual(objSortItems(items, 0, "ascending"), items, "a sorted copy, not the same array");
  assert.deepEqual(objPage([1, 2, 3, 4, 5], 2, 2), { rows: [3, 4], page: 2, pages: 3 });
  assert.deepEqual(objPage([1, 2, 3], 9, 2), { rows: [3], page: 2, pages: 2 }, "a page past the end is the last page");
  assert.deepEqual(objPage([], 1, 50), { rows: [], page: 1, pages: 1 });
  const F = objFormat();
  const c = objCells({ id: 5, name: "VANGUARD 1", intl: "1958-002B", type: "P", status: "-", launch: "1958-03-17", perigee: 654, apogee: 3820, incl: 34.25, rcs: 0.1224 }, OBJ_CONST, F);
  assert.deepEqual(c, ["5", "VANGUARD 1", "1958-002B", "Satellite", "Not operational", "1958-03-17", "654", "3,820", "34.3", "0.122"]);
  assert.equal(objCells({ id: 6, type: "D", status: "", perigee: null, apogee: null, incl: null, rcs: null }, OBJ_CONST, F)[4], "-");
});

// A detail file as large as the United States' (18,356 objects on 2026-10-07): the steps of the full table, timed. The first version
// built new number formatters for every comparison and took 5 to 82 seconds per step on this Mac.
test("the full table of 18,000 objects: first draw, a filter keystroke and each sort stay well under 300 ms", (t) => {
  const doc = bigDetail();
  const time = (fn) => { const t0 = performance.now(); const v = fn(); return [performance.now() - t0, v]; };
  const F = objFormat(), page = (list) => objPage(list, 1, OBJ_CONST.pageSize).rows.forEach((it) => { if (!it.cells) it.cells = objCells(it.r, OBJ_CONST, F); });
  const [first, items] = time(() => { const it = objPrepare(objParse(JSON.parse(JSON.stringify(doc)), { owner: "US", time: SATCAT_TIME }, OBJ_CONST), OBJ_CONST); page(it); return it; });
  const out = [["first draw (parse, prepare, one page)", first]];
  for (const [label, fn] of [["filter, one keystroke", () => objFilterItems(items, "star", "")], ["filter, kind", () => objFilterItems(items, "", "D")],
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((col) => [`sort by column ${col}`, () => objSortItems(items, col, col % 2 ? "descending" : "ascending")])]) {
    const [ms, list] = time(() => { const l = fn(); page(l); return l; });
    assert.ok(list.length > 0, label);
    out.push([label, ms]);
  }
  t.diagnostic(out.map(([l, ms]) => `${l} ${ms.toFixed(1)} ms`).join("; "));
  // OURS: 300 ms is the reviewer's budget; measured on 2026-10-07 at 50 ms or less for every step on the real US file
  for (const [l, ms] of out) assert.ok(ms < 300, `${l}: ${ms.toFixed(0)} ms`);
});

test("the page script is plain browser code built from the tested functions", () => {
  const src = objectsScript();
  assert.ok(!/\bexport\b|\bimport\b/.test(src));
  assert.doesNotThrow(() => new Function(src.replace(/^\(function\(\)\{/, "").replace(/\}\)\(\);$/, "").replace(/objInit\(document,[\s\S]*\);\s*$/, "")));
  for (const f of ["objNorm", "objMatch", "objParse", "objPage", "objInit"]) assert.ok(src.includes(`function ${f}(`), f);
  assert.ok(src.length < 12000, `${src.length} characters`);
});

// ---------------------------------------------------------------- the built pages
test("every page of the family and the five country pages are built from the fixtures, with nothing failed", () => {
  assert.deepEqual(R.failed, []);
  for (const f of [RANKING_FILE, ...OWNER_FILES, ...COUNTRY_PAGES.map((p) => p.file)]) assert.ok(fs.existsSync(path.join(OUT, f)), f);
  const index = readIndex(OUT);
  for (const f of [RANKING_FILE, ...OWNER_FILES]) {
    const { contentKey, ...rest } = index.pages[f];
    assert.deepEqual(rest, { feeds: { satcat: "C1", satellites: "S1" }, dataTime: SAT_TIME_OBJ }, f);
    assert.match(contentKey, /^[0-9a-f]{32}$/, f);
  }
  for (const p of COUNTRY_PAGES) assert.deepEqual(index.pages[p.file].feeds, { satellites: "S1", satcat: "C1" }, p.slug);
  assert.deepEqual(index.pages[SATCOUNT_FILE].feeds, { satellites: "S1" }, "the count page does not depend on the catalogue");
  assert.deepEqual(index.pages[HUB_FILE].feeds, { satellites: "S1" }, "nor does the country hub");
  const xml = read(OUT, "sitemap-live.xml");
  for (const f of [RANKING_FILE, ...OWNER_FILES]) assert.ok(xml.includes(`<loc>${SITE.url}/${urlPath(f)}</loc><lastmod>${SAT_TIME_OBJ}</lastmod>`), f);
});

test("house style on every page: no em or en dashes, no emoji, no claim of who caused debris, no hidden text", () => {
  for (const f of [RANKING_FILE, ...OWNER_FILES, ...COUNTRY_PAGES.map((p) => p.file)]) {
    const h = read(OUT, f), t = textOf(mainOf(h));
    assert.ok(!/[\u2013\u2014]/.test(h), `${f}: a dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${f}: an emoji`);
    assert.ok(!/caused by|is responsible for creating|created the debris|blame/i.test(t), `${f}: a claim about causes`);
    assert.ok(!/ hidden|display:\s*none|visibility:\s*hidden/.test(mainOf(h).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "")), `${f}: hidden text`);
  }
  assert.ok(!/russia/i.test(read(OUT, COUNTRY_PAGES.find((p) => p.slug === "cis-former-ussr").file)), "the CIS page never says Russia");
});

test("titles name the owner and the question, under 60 characters; descriptions under 160; both unique", () => {
  const seen = new Set();
  for (const f of [RANKING_FILE, ...OWNER_FILES, ...COUNTRY_PAGES.map((p) => p.file)]) {
    const h = read(OUT, f);
    const t = h.match(/<title>([^<]*)<\/title>/)[1], d = h.match(/<meta name="description" content="([^"]*)">/)[1];
    assert.ok(t.length < 60 && /satellites and space debris/i.test(t), `${f}: ${t}`);
    assert.ok(d.length > 60 && d.length < 160, `${f}: description of ${d.length}`);
    assert.ok(!seen.has(t) && !seen.has(d), f); seen.add(t); seen.add(d);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`), f);
  }
  for (const p of NEW_OWNER_PAGES) assert.ok(read(OUT, p.file).includes(`<title>${p.name.replace(/&/g, "&amp;")} satellites and space debris: live count</title>`), p.slug);
});

test("structured data: WebPage with the data time as dateModified and a breadcrumb through the ranking", () => {
  for (const f of [RANKING_FILE, ...OWNER_FILES]) {
    const ld = [...read(OUT, f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
    const wp = ld.find((o) => o["@type"] === "WebPage"), bc = ld.find((o) => o["@type"] === "BreadcrumbList");
    assert.equal(wp.dateModified, SAT_TIME_OBJ, f);
    assert.ok(!ld.some((o) => o["@type"] === "Dataset" || o["@type"] === "FAQPage"), `${f}: no Dataset or FAQ markup (the terms are not confirmed)`);
    if (f !== RANKING_FILE) assert.deepEqual(bc.itemListElement.map((x) => x.name), ["Home", "Satellites and debris by country", NEW_OWNER_PAGES.find((p) => p.file === f).name]);
  }
});

test("the ranking: every owner with an object in orbit, rows that add up, columns that add up to the catalogue's totals", () => {
  const h = read(OUT, RANKING_FILE);
  const { body, tr } = tableRows(h, "owners-table");
  const owners = summary.owners.filter((o) => o.total > 0);
  assert.equal(body.length, owners.length);
  for (const r of body) assert.equal(n(r[2]) + n(r[3]) + n(r[4]) + n(r[5]) + n(r[6]), n(r[7]), r[1]);
  for (const [i, k] of [[2, "act"], [3, "inact"], [4, "rb"], [5, "deb"], [6, "unk"], [7, "total"]]) assert.equal(body.reduce((x, r) => x + n(r[i]), 0), summary.totals[k], k);
  const foot = [...tr.slice(tr.indexOf("<tfoot>")).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(n(foot[7]), summary.totals.total);
  // every row is searchable by name and code; rows with a page link to it, and the others are plain text
  assert.ok(/<tr data-search="[^"]*India IND India[^"]*">/.test(h));
  assert.ok(/data-search="Türkiye TURK Türkiye Turkey Turkiye"/.test(h));
  for (const p of OWNER_PAGES) assert.ok(h.includes(`href="../${urlPath(p.file)}"`), p.slug);
  assert.ok(/<tr data-search="To Be Determined TBD"><td>To Be Determined<\/td>/.test(h), "an owner without a page is not linked");
  for (const s of ['data-col="0" data-sort="text"', 'data-col="7" data-sort="num"']) assert.ok(h.includes(s), s);
  const t = textOf(mainOf(h));
  assert.ok(t.includes(`lists ${summary.totals.total.toLocaleString("en-GB")} objects in Earth orbit`));
  // what the owner of debris is: only the share measured in this data, computed, never a claim about causes or responsibility
  const c = summary.debrisOwnerCheck, share = (Math.round((c.sameAsPayload / c.checked) * 1000) / 10).toFixed(1);
  assert.ok(t.includes(`${share} percent of the ${c.checked.toLocaleString("en-GB")} pieces of debris in Earth orbit${c.checked === summary.totals.deb ? "" : " whose launch has a satellite in the catalogue"} carry the owner of a satellite from the same launch; ${c.checked - c.sameAsPayload} do not`), "the measured share");
  assert.ok(!/responsib|\bcaus(e|ed|ing)\b/i.test(t), "no word about responsibility or causes");
  assert.ok(t.includes("The catalogue does not record who or what broke a piece off"));
  // the lead names when the numbers last changed and the time of each source
  const tl = t.replace(/ ([,.;)])/g, "$1");
  assert.ok(tl.includes(`Numbers last changed 7 October 2026, 04:20 UTC (orbit data of 7 Oct, 04:20 UTC, catalogue of 7 Oct, 04:04 UTC)`), tl.slice(tl.indexOf("Numbers"), tl.indexOf("Numbers") + 120));
  assert.ok(/<th scope="col" class="num" data-col="7" data-sort="num" aria-sort="descending">/.test(h), "the default order is marked on its column");
  assert.ok(t.includes("Large orbital debris (> 10 cm) is tracked routinely by the U.S. Space Surveillance Network"));
});

test("an owner page: the kinds add up, the tables hold the stated rows, and Show all points at this version's file", () => {
  assert.ok(NEW_OWNER_PAGES.some((p) => summary.owners.find((x) => x.code === p.code).total > STATIC_ALL_MAX), "the fixture has a page with a Show all button");
  for (const p of NEW_OWNER_PAGES) {
    const h = read(OUT, p.file), o = summary.owners.find((x) => x.code === p.code);
    const kinds = captionRows(h, `Objects in Earth orbit by kind, catalogue of 7 October 2026`);
    assert.deepEqual(kinds.map((r) => n(r[1])), [o.act, o.inact, o.rb, o.deb, ...(o.unk ? [o.unk] : [])], p.slug);
    const orbits = captionRows(h, "Objects in Earth orbit by orbit group and kind");
    assert.equal(orbits.reduce((x, r) => x + n(r[1]) + n(r[2]) + n(r[3]) + n(r[4]), 0), o.total, `${p.slug}: orbits`);
    const m = h.match(/<div id="all-objects" data-src="([^"]+)" data-owner="([^"]+)" data-time="([^"]+)" data-count="([^"]+)"><\/div>/);
    if (o.total <= STATIC_ALL_MAX) {
      assert.ok(!m && textOf(h).includes(`That is all ${o.total} of them.`), `${p.slug}: every object is in the page`);
      assert.equal(captionRows(h, `Every object in Earth orbit, newest launch first (${o.total})`).length, o.total, p.slug);
      continue;
    }
    assert.ok(m, p.slug);
    assert.equal(m[1], `../../live/satcat/C1/${o.file}`);
    assert.equal(m[2], p.code);
    assert.equal(m[3], SATCAT_TIME);
    assert.equal(n(m[4]), o.total);
    const file = JSON.parse(fs.readFileSync(path.join(DATA, "satcat/C1", o.file), "utf8"));
    assert.equal(file.sourceTime, m[3], "the file the button loads is the version the page was built from");
    assert.ok(textOf(mainOf(h)).includes(`Recorded`) || textOf(mainOf(h)).includes(`under the owner "${o.name}"`), p.slug);
  }
  const india = textOf(mainOf(read(OUT, "satellites-by-country/india/index.html")));
  assert.ok(india.includes("The 25 largest pieces of debris by radar cross-section") || india.includes("largest pieces of debris by radar cross-section"));
  assert.ok(india.includes("How much space debris does India have?"));
  assert.ok(india.includes("Satellites and debris by country") || india.includes("what these numbers mean"));
});

test("the five country pages gain the objects section; the CIS page keeps the catalogue's name", () => {
  for (const p of COUNTRY_PAGES) {
    const h = read(OUT, p.file);
    assert.ok(h.includes('<h2 id="objects">Satellites, rocket bodies and debris in orbit</h2>'), p.slug);
    const o = summary.owners.find((x) => x.code === OWNER_PAGES.find((q) => q.slug === p.slug).code);
    assert.equal(h.includes('<div id="all-objects" data-src="../../live/satcat/C1/'), o.total > STATIC_ALL_MAX, p.slug);
    assert.ok(h.includes(`href="../../${urlPath(RANKING_FILE)}"`), `${p.slug} links the ranking`);
    assert.match(h, new RegExp(`<title>${p.name.replace(/[()]/g, "\\$&")} satellites and space debris: live count</title>`));
  }
});

test("links: the ranking, the hub, the owner pages and the right-now hub link each other; every link lands on a built page", () => {
  const built = new Set(Object.keys(readIndex(OUT).files));
  for (const f of [RANKING_FILE, ...OWNER_FILES]) {
    for (const m of mainOf(read(OUT, f)).matchAll(/ href="([^"#]+)/g)) {
      if (/^https?:/.test(m[1])) continue;
      const dirTo = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      const t = dirTo.replace(/\/$/, "") === "." ? "index.html" : `${dirTo.replace(/\/$/, "")}/index.html`;
      assert.ok(built.has(t) || t === "index.html", `${f}: ${m[1]} -> ${t}`);
    }
  }
  const hub = read(OUT, "right-now/index.html");
  for (const f of [RANKING_FILE, ...OWNER_FILES]) assert.ok(hub.includes(`href="../${urlPath(f)}"`), `the right-now hub links ${f}`);
  assert.ok(read(OUT, HUB_FILE).includes(`href="../${urlPath(RANKING_FILE)}"`), "the country hub links the ranking");
  assert.ok(LIVE_FILES.includes(RANKING_FILE));
});

// Shared 8-word sequences between owner pages, over the page's main content (scripts and styles removed) with numbers made "n" and every
// owner name, short name and phrase made "owner": the measure test/pages-country.test.js uses for the country pages.
function overlap(files) {
  const names = OWNER_PAGES.flatMap((p) => [p.name, p.phrase, p.phrase.charAt(0).toUpperCase() + p.phrase.slice(1)]).concat(summary.owners.map((o) => o.name)).filter(Boolean).sort((a, b) => b.length - a.length);
  const norm = (h) => {
    let t = textOf(mainOf(h));
    for (const s of names) t = t.split(s).join(" OWNER ");
    return t.toLowerCase().replace(/\d[\d,.]*(st|nd|rd|th)?/g, " n ").split(/[^a-z']+/).filter(Boolean);
  };
  const sh = files.map((f) => { const w = norm(read(OUT, f)), s = new Set(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; });
  const out = [];
  for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
    let c = 0; for (const x of sh[i]) if (sh[j].has(x)) c++;
    out.push({ pair: `${files[i]} / ${files[j]}`, jaccard: c / (sh[i].size + sh[j].size - c), containment: c / Math.min(sh[i].size, sh[j].size) });
  }
  return out;
}
const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1);

test("the owner pages are not near duplicates: under half of their 8-word sequences shared, with numbers and owner names made alike", (t) => {
  const pairs = overlap(OWNER_FILES);
  assert.equal(pairs.length, (19 * 18) / 2);
  const worst = pairs.reduce((a, b) => (b.jaccard > a.jaccard ? b : a));
  const worstC = pairs.reduce((a, b) => (b.containment > a.containment ? b : a));
  t.diagnostic(`worst pair ${worst.pair}: ${pct(worst.jaccard)} percent shared (Jaccard); worst containment ${worstC.pair}: ${pct(worstC.containment)} percent`);
  for (const p of pairs) assert.ok(p.jaccard < 0.5, `${p.pair}: ${pct(p.jaccard)} percent`);
  // OURS: the limit is the measured worst containment on the fixture, 66.0 percent on 2026-10-07 (SES and EUTELSAT), plus 5 points; on
  // the real catalogue of that day the worst was 60.2 percent (see docs/country-objects-sources.md)
  for (const p of pairs) assert.ok(p.containment < CONTAINMENT_LIMIT, `${p.pair}: ${pct(p.containment)} percent of the smaller page`);
});
const CONTAINMENT_LIMIT = 0.71;

test("every owner page carries enough computed content to stand on its own", () => {
  for (const p of NEW_OWNER_PAGES) {
    const h = read(OUT, p.file), t = textOf(mainOf(h));
    const words = t.split(" ").length, tables = (mainOf(h).match(/<table[ >]/g) || []).length, rows = (mainOf(h).match(/<tr[ >]/g) || []).length;
    // OURS: the floor for a page that answers its question with its own data (the build's guard, OWNER_PAGE_MIN objects, keeps the
    // tables at least that long on real data)
    assert.ok(words >= 700, `${p.slug}: ${words} words`);
    assert.ok(tables >= 3 && rows >= 35, `${p.slug}: ${tables} tables, ${rows} rows`);
    assert.equal((h.match(/<h3>/g) || []).length, 3, `${p.slug}: three questions`);
  }
});

// ---------------------------------------------------------------- freshness and successive builds
const snapshotOf = (out) => Object.fromEntries(Object.keys(readIndex(out).files).map((f) => [f, sha(fs.readFileSync(path.join(out, f)))]));

test("an unchanged second build writes nothing: the same bytes, the same index", () => {
  const out = mk(), dir = objectsDataDir({ dir: mk() });
  buildLive({ dataDir: dir, outDir: out, now: OBJECTS_NOW, ...opts });
  const before = snapshotOf(out), index = read(out, "index.json");
  const mtimes = Object.keys(before).map((f) => fs.statSync(path.join(out, f)).mtimeMs);
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date(OBJECTS_NOW.getTime() + 600000), ...opts });
  assert.equal(r.changed, false);
  assert.deepEqual(snapshotOf(out), before);
  assert.equal(read(out, "index.json"), index);
  assert.deepEqual(Object.keys(before).map((f) => fs.statSync(path.join(out, f)).mtimeMs), mtimes);
});

// A new catalogue a day later in which one active Indian satellite has become inactive: the summary and India's file both change.
function nextDay(name, buf) {
  const next = "2026-10-08T04:01:00Z";
  const doc = JSON.parse(buf.toString("utf8"));
  doc.sourceTime = next;
  if (name === "summary.json") {
    const ind = doc.owners.find((o) => o.code === "IND");
    ind.act--; ind.inact++; doc.totals.act--; doc.totals.inact++;
  }
  if (name === "o-ind.json") doc.rows.find((r) => r[3] === "P" && r[4] === "+")[4] = "-";
  return Buffer.from(JSON.stringify(doc));
}

test("a new catalogue rebuilds the pages that use it, with the new file version and time; the count page and the hub stay byte for byte", () => {
  const out = mk();
  buildLive({ dataDir: objectsDataDir({ dir: mk() }), outDir: out, now: OBJECTS_NOW, ...opts });
  const before = snapshotOf(out), idx1 = readIndex(out);
  const later = new Date("2026-10-08T04:30:00Z");
  const dir2 = objectsDataDir({ dir: mk(), satcatVersion: "C2", edit: nextDay });
  const r = buildLive({ dataDir: dir2, outDir: out, now: later, ...opts });
  assert.deepEqual(r.failed, []);
  const after = snapshotOf(out), idx2 = readIndex(out);
  for (const f of [RANKING_FILE, ...OWNER_FILES, ...COUNTRY_PAGES.map((p) => p.file)]) {
    assert.notEqual(after[f], before[f], `${f} changed`);
    assert.equal(idx2.pages[f].feeds.satcat, "C2", f);
    const h = read(out, f), m = h.match(/data-src="([^"]+)" data-owner="[^"]+" data-time="([^"]+)"/);
    if (m) {
      assert.ok(m[1].includes("/live/satcat/C2/"), `${f}: the button loads the new version`);
      assert.equal(m[2], "2026-10-08T04:01:00Z");
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir2, m[1].replace(/^(\.\.\/)+live\//, "")), "utf8")).sourceTime, m[2], `${f}: page and file agree`);
    }
  }
  for (const f of [SATCOUNT_FILE, HUB_FILE]) { assert.equal(after[f], before[f], f); assert.deepEqual(idx2.files[f], idx1.files[f], f); }
  assert.equal(idx2.pages[RANKING_FILE].dataTime, "2026-10-08T04:01:00Z", "the catalogue is now the newer of the two");
  const india = textOf(mainOf(read(out, "satellites-by-country/india/index.html")));
  const o = summary.owners.find((x) => x.code === "IND");
  assert.ok(india.includes(`${o.act - 1} active satellites, ${o.inact + 1} inactive satellites`), "the new numbers");
  // the same new catalogue again: nothing moves
  const r2 = buildLive({ dataDir: dir2, outDir: out, now: new Date(later.getTime() + 600000), ...opts });
  assert.equal(r2.changed, false);
  assert.deepEqual(snapshotOf(out), after);
});

test("a new satellites version with the same content leaves the objects pages' bytes and changed times as they were", () => {
  const out = mk();
  buildLive({ dataDir: objectsDataDir({ dir: mk() }), outDir: out, now: OBJECTS_NOW, ...opts });
  const idx1 = readIndex(out);
  buildLive({ dataDir: objectsDataDir({ dir: mk(), satVersion: "S2" }), outDir: out, now: new Date(OBJECTS_NOW.getTime() + 7200000), ...opts });
  const idx2 = readIndex(out);
  for (const f of [RANKING_FILE, ...OWNER_FILES]) { assert.deepEqual(idx2.files[f], idx1.files[f], f); assert.equal(idx2.pages[f].feeds.satellites, "S2"); }
});

test("a stale catalogue: the objects pages and the country pages with the section keep their previous copy, with a reason", () => {
  const out = mk(), dir = objectsDataDir({ dir: mk() });
  buildLive({ dataDir: dir, outDir: out, now: OBJECTS_NOW, ...opts });
  const before = snapshotOf(out);
  const late = new Date(Date.parse(SATCAT_TIME) + (OBJECTS_MAX_AGE_HOURS + 2) * 3600000);
  const r = buildLive({ dataDir: objectsDataDir({ dir: mk(), taken: late.toISOString().replace(/\.\d+Z$/, "Z"), satVersion: "S9" }), outDir: out, now: late, ...opts });
  assert.deepEqual(r.failed, []);
  const stale = r.stale.filter((s) => s.file === RANKING_FILE || OWNER_FILES.includes(s.file));
  assert.equal(stale.length, 1 + OWNER_FILES.length);
  for (const s of stale) { assert.match(s.reason, /satcat data from 2026-10-07T04:04:48Z is more than 72 hours old/); assert.equal(s.kept, true); }
  const after = snapshotOf(out);
  for (const f of [RANKING_FILE, ...OWNER_FILES]) assert.equal(after[f], before[f], f);
  assert.ok(r.warnings.some((w) => /no objects section for US: satcat data from/.test(w.reason)));
  for (const p of COUNTRY_PAGES) {
    assert.equal(after[p.file], before[p.file], `${p.slug}: the copy with the section stays, its title does not flip back`);
    const st = r.stale.find((x) => x.file === p.file);
    assert.ok(st && st.kept && /no objects section this run \(satcat data from .* is more than 72 hours old\); the copy with the section stays/.test(st.reason), p.slug);
    assert.deepEqual(readIndex(out).pages[p.file].feeds, { satellites: "S1", satcat: "C1" }, p.slug);
  }
  assert.notEqual(after[SATCOUNT_FILE], undefined);
  // without an earlier copy that had the section, a country page is built without it (the first runs before the catalogue arrives)
  const fresh = mk();
  const r2 = buildLive({ dataDir: objectsDataDir({ dir: mk(), taken: late.toISOString().replace(/\.\d+Z$/, "Z"), satVersion: "S9" }), outDir: fresh, now: late, ...opts });
  assert.ok(!read(fresh, COUNTRY_PAGES[0].file).includes('id="objects"') && !r2.stale.some((x) => x.file === COUNTRY_PAGES[0].file));
});

test("a broken detail file for a country keeps that country page's previous copy and fails nothing else", () => {
  const out = mk();
  buildLive({ dataDir: objectsDataDir({ dir: mk() }), outDir: out, now: OBJECTS_NOW, ...opts });
  const before = snapshotOf(out);
  const jp = summary.owners.find((o) => o.code === "JPN").file;
  const broken = objectsDataDir({ dir: mk(), satcatVersion: "C5", edit: (name, buf) => (name === jp ? Buffer.from(buf.toString("utf8").replace('"owner":"JPN"', '"owner":"XXX"')) : buf) });
  const r = buildLive({ dataDir: broken, outDir: out, now: OBJECTS_NOW, ...opts });
  const japan = COUNTRY_PAGES.find((p) => p.slug === "japan").file;
  assert.equal(snapshotOf(out)[japan], before[japan], "the Japan page keeps its copy");
  assert.ok(r.stale.some((x) => x.file === japan && x.kept));
  assert.equal(readIndex(out).pages[COUNTRY_PAGES[0].file].feeds.satcat, "C5", "the other country pages take the new catalogue");
});

test("dateModified, the sitemap time and the lead's time move only when a number on the page changes", () => {
  const out = mk();
  buildLive({ dataDir: objectsDataDir({ dir: mk() }), outDir: out, now: OBJECTS_NOW, ...opts });
  const t1 = readIndex(out).pages[RANKING_FILE].dataTime;
  // two hours later the orbit data has a new version and time but the same numbers
  const later = "2026-10-07T06:20:22Z";
  buildLive({ dataDir: objectsDataDir({ dir: mk(), satVersion: "S2", taken: later }), outDir: out, now: new Date("2026-10-07T06:30:00Z"), ...opts });
  const idx = readIndex(out), h = read(out, RANKING_FILE);
  assert.equal(idx.pages[RANKING_FILE].dataTime, t1, "the numbers did not change, so neither does the date");
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((o) => o["@type"] === "WebPage");
  assert.equal(ld.dateModified, t1);
  assert.ok(read(out, "sitemap-live.xml").includes(`<loc>${SITE.url}/${urlPath(RANKING_FILE)}</loc><lastmod>${t1}</lastmod>`));
  assert.ok(textOf(h).includes("orbit data of 7 Oct, 06:20 UTC"), "the lead still names the new orbit data time");
  // a new catalogue with a changed number moves it
  buildLive({ dataDir: objectsDataDir({ dir: mk(), satVersion: "S2", taken: later, satcatVersion: "C2", edit: nextDay }), outDir: out, now: new Date("2026-10-08T04:30:00Z"), ...opts });
  assert.equal(readIndex(out).pages[RANKING_FILE].dataTime, "2026-10-08T04:01:00Z");
});

test("an owner under the guard is skipped and keeps its previous copy; a detail file that does not match fails only that page", () => {
  const out = mk(), dir = objectsDataDir({ dir: mk() });
  buildLive({ dataDir: dir, outDir: out, now: OBJECTS_NOW, ...opts });
  const r = buildLive({ dataDir: objectsDataDir({ dir: mk(), satcatVersion: "C3" }), outDir: out, now: OBJECTS_NOW, ...opts, ownerMin: 34 });
  const sk = r.stale.filter((s) => OWNER_FILES.includes(s.file)).map((s) => s.file).sort();
  assert.deepEqual(sk, ["satellites-by-country/argentina/index.html", "satellites-by-country/o3b-networks/index.html"], "the owners with 33 objects");
  assert.ok(r.stale.every((s) => !OWNER_FILES.includes(s.file) || s.kept));
  const broken = objectsDataDir({ dir: mk(), satcatVersion: "C4", edit: (name, buf) => (name === "o-ind.json" ? Buffer.from(buf.toString("utf8").replace(/,"rows":\[\[/, ',"rows":[[1,"X","2000-001A","D","","2000-01-01",null,null,null,null,null,""],[')) : buf) });
  const r2 = buildLive({ dataDir: broken, outDir: mk(), now: OBJECTS_NOW, ...opts });
  assert.deepEqual(r2.failed.map((f) => f.files[0]), ["satellites-by-country/india/index.html"]);
  const ind = summary.owners.find((o) => o.code === "IND");
  assert.match(r2.failed[0].reason, new RegExp(`has ${ind.total + 1} objects, the summary ${ind.total}`));
});
