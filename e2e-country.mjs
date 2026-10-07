// Browser check of the satellites and debris pages (site/pages-objects.mjs and the section of the country pages): the ranking's search box
// and sortable columns, an owner page's "Show all" with its paged and filtered table, the refusal of a detail file from another data
// version, no console errors, and no sideways scrolling at 360 px. The pages are built by site/build-live.mjs from the committed fixtures
// (the satcat feed of test/fixtures/satcat and the country satellite fixture) and served with the built site (dist/site) and the fixture's
// live folder at https://radar.test/, as a host serves raw files.
// usage: npm run e2e:country (it builds the site first, with LIVE_SNAPSHOT=0). E2E_SHOTS=<folder> saves screenshots at 360 and 1200 px.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./harness.mjs";
import { buildLive } from "./site/build-live.mjs";
import { RANKING_FILE, NEW_OWNER_PAGES, STATIC_ALL_MAX } from "./site/objects.mjs";
import { OBJ_PAGE_SIZE } from "./site/objects-js.mjs";
import { urlPath } from "./site/layout.mjs";
import { objectsDataDir, satcatSummary, OBJECTS_NOW, TEST_OBJECT_BOUNDS } from "./test/helpers/satcatfixture.mjs";

const site = fileURLToPath(new URL("./dist/site/", import.meta.url));
if (!fs.existsSync(site + "index.html")) { console.error("dist/site/index.html is missing; run npm run build:hosting first"); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-country-"));
const data = objectsDataDir({ dir: path.join(tmp, "live") }), pages = path.join(tmp, "pages");
const built = buildLive({ dataDir: data, outDir: pages, now: OBJECTS_NOW, noindex: false, bounds: { min: 5, max: 1000 }, objectBounds: TEST_OBJECT_BOUNDS });
if (built.failed.length) { console.error("the live build failed:", JSON.stringify(built.failed)); process.exit(2); }
const summary = satcatSummary();
const owners = summary.owners.filter((o) => o.total > 0);
const big = NEW_OWNER_PAGES.map((p) => ({ p, o: summary.owners.find((x) => x.code === p.code) })).find((x) => x.o.total > STATIC_ALL_MAX);
const shots = process.env.E2E_SHOTS || "";

const MIME = { ".json": "application/json", ".bin": "application/octet-stream", ".html": "text/html", ".txt": "text/plain", ".xml": "application/xml", ".js": "text/javascript", ".png": "image/png" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail); };
// override: a function (relative path) -> { status, body } | null, to answer some files differently
async function serve(ctx, override = () => null) {
  await ctx.route("https://radar.test/**", (route) => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const o = override(rel);
    if (o) return route.fulfill({ status: o.status, headers: { "content-type": "application/json" }, body: o.body || "" });
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const from = rel.startsWith("live/") ? path.join(data, rel.slice(5)) : fs.existsSync(path.join(pages, rel)) ? path.join(pages, rel) : path.join(site, rel);
    if (!fs.existsSync(from) || fs.statSync(from).isDirectory()) return route.fulfill({ status: 404, headers: { "content-type": "text/html" }, body: "<html><body>Not found</body></html>" });
    return route.fulfill({ status: 200, headers: { "content-type": MIME[path.extname(from)] || "application/octet-stream" }, body: fs.readFileSync(from) });
  });
}
async function open(browser, file, { width = 1200, height = 900, override } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: "block", ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await serve(ctx, override);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Service Worker registration blocked|status of 404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  await page.goto(`https://radar.test/${urlPath(file)}`, { waitUntil: "load", timeout: 60000 });
  return { ctx, page, errors };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const visibleRows = (page) => page.evaluate(() => [...document.querySelectorAll("#owners-table tbody tr")].filter((r) => !r.hidden).map((r) => r.cells[0].textContent));
const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name), fullPage: false }); } };

const browser = await launch();

// ---- the ranking: search and sort, at 1200 px
{
  const { ctx, page, errors } = await open(browser, RANKING_FILE);
  check("the ranking page loads with its h1 and every owner in the table", (await page.textContent("h1")) === "Satellites and space debris by country" && (await visibleRows(page)).length === owners.length, String((await visibleRows(page)).length));
  const label = await page.evaluate(() => { const i = document.getElementById("owner-search"); return i && i.labels && i.labels[0] ? i.labels[0].textContent : null; });
  check("the script adds a labelled search box", label === "Search owners by name or code", String(label));
  await page.click("#owner-search");
  await page.keyboard.type("turkey");
  let rows = await visibleRows(page);
  check("typing a name filters the rows (turkey finds Türkiye, accents ignored)", rows.length === 1 && rows[0] === "Türkiye", JSON.stringify(rows));
  check("the status line says how many match", /^1 of \d+ owners match\.$/.test(await page.textContent("#owner-count")), await page.textContent("#owner-count"));
  await page.fill("#owner-search", "prc");
  rows = await visibleRows(page);
  check("a code filters too", rows.length === 1 && rows[0] === "People's Republic of China", JSON.stringify(rows));
  await page.fill("#owner-search", "atlantis");
  check("no match leaves no row and says so", (await visibleRows(page)).length === 0 && /No owner matches/.test(await page.textContent("#owner-count")));
  await page.fill("#owner-search", "");
  check("clearing the box shows every owner again", (await visibleRows(page)).length === owners.length);
  await shot(page, "ranking-1200.png");
  // sort by debris, most first, with the mouse; then the other way with the keyboard
  await page.click('#owners-table th[data-col="5"] button');
  const deb = () => page.evaluate(() => [...document.querySelectorAll("#owners-table tbody tr")].map((r) => Number(r.cells[5].textContent.replace(/,/g, ""))));
  let d = await deb();
  check("a click on Debris sorts by debris, most first, and marks the column", d.every((x, i) => i === 0 || d[i - 1] >= x) && (await page.getAttribute('#owners-table th[data-col="5"]', "aria-sort")) === "descending", JSON.stringify(d.slice(0, 5)));
  await page.focus('#owners-table th[data-col="5"] button');
  await page.keyboard.press("Enter");
  d = await deb();
  check("Enter on the focused header sorts the other way (keyboard accessible)", d.every((x, i) => i === 0 || d[i - 1] <= x) && (await page.getAttribute('#owners-table th[data-col="5"]', "aria-sort")) === "ascending");
  await page.click('#owners-table th[data-col="0"] button');
  const names = await page.evaluate(() => [...document.querySelectorAll("#owners-table tbody tr")].map((r) => r.cells[0].textContent));
  check("sorting by owner name orders the names", names.every((x, i) => i === 0 || names[i - 1].localeCompare(x, "en") >= 0), names.slice(0, 3).join(", "));
  check("the total row stays at the foot", (await page.textContent("#owners-table tfoot td")) === "All owners");
  check("no console errors on the ranking page", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- the ranking at 360 px
{
  const { ctx, page, errors } = await open(browser, RANKING_FILE, { width: 360, height: 780 });
  check("at 360 px the ranking page does not scroll sideways (the table scrolls in its own box)", await noSideScroll(page));
  await shot(page, "ranking-360.png");
  check("no console errors on the ranking page at 360 px", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- an owner page: Show all, paging, filters
{
  const { ctx, page, errors } = await open(browser, big.p.file);
  check(`${big.p.name}: the page shows the Show all button for its ${big.o.total} objects`, (await page.textContent("#show-all")) === `Show all ${big.o.total} objects`);
  await page.click("#show-all");
  await page.waitForSelector("#all-objects-table tbody tr", { timeout: 20000 });
  const count = () => page.evaluate(() => document.querySelectorAll("#all-objects-table tbody tr").length);
  const pages = Math.ceil(big.o.total / OBJ_PAGE_SIZE);
  check("Show all loads the file and renders the first page", (await count()) === Math.min(OBJ_PAGE_SIZE, big.o.total) && (await page.textContent("#obj-page")) === `Page 1 of ${pages}, ${big.o.total} of ${big.o.total} objects`, await page.textContent("#obj-page"));
  await shot(page, "owner-show-all-1200.png");
  await page.click("text=Next page");
  check("Next page shows the rest", (await count()) === Math.min(OBJ_PAGE_SIZE, big.o.total - OBJ_PAGE_SIZE) && (await page.textContent("#obj-page")).startsWith(`Page 2 of ${pages}`), await page.textContent("#obj-page"));
  await page.selectOption("#obj-type", "D");
  const kinds = await page.evaluate(() => [...document.querySelectorAll("#all-objects-table tbody tr")].map((r) => r.cells[3].textContent));
  check("the kind filter keeps only debris and goes back to page 1", kinds.length === big.o.deb && kinds.every((k) => k === "Debris") && (await page.textContent("#obj-page")).startsWith("Page 1 of 1"), JSON.stringify(kinds.slice(0, 3)));
  await page.selectOption("#obj-type", "");
  await page.fill("#obj-search", "pslv");
  const found = await page.evaluate(() => [...document.querySelectorAll("#all-objects-table tbody tr")].map((r) => r.cells[1].textContent));
  check("the text filter finds objects by name", found.length > 0 && found.every((n) => /PSLV/.test(n)), JSON.stringify(found.slice(0, 3)));
  await page.fill("#obj-search", "");
  await page.click('#all-objects-table th[data-col="0"] button');
  const ids = await page.evaluate(() => [...document.querySelectorAll("#all-objects-table tbody tr")].map((r) => Number(r.cells[0].textContent)));
  check("the full table sorts by a clicked column", ids.every((x, i) => i === 0 || ids[i - 1] >= x), JSON.stringify(ids.slice(0, 4)));
  check("no console errors on the owner page", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- the same at 360 px
{
  const { ctx, page, errors } = await open(browser, big.p.file, { width: 360, height: 780 });
  check("at 360 px the owner page does not scroll sideways", await noSideScroll(page));
  await shot(page, "owner-360.png");
  await page.click("#show-all");
  await page.waitForSelector("#all-objects-table tbody tr", { timeout: 20000 });
  check("at 360 px the loaded full table does not make the page scroll sideways", await noSideScroll(page));
  await page.evaluate(() => document.getElementById("obj-search").scrollIntoView());
  await shot(page, "owner-show-all-360.png");
  check("no console errors at 360 px", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- a file of another data version, and a file that is gone
for (const [name, answer, want] of [
  ["a detail file from another data version is refused, with a reload message", (b) => ({ status: 200, body: JSON.stringify({ ...JSON.parse(b), sourceTime: "2026-10-08T04:01:00Z" }) }), /updated since this page was built/],
  ["a detail file that is gone (the version was replaced) gives the same reload message", () => ({ status: 404, body: "" }), /updated since this page was built/],
  ["a server error gives a try-again message and keeps the button", () => ({ status: 500, body: "" }), /could not be loaded just now/],
]) {
  const file = fs.readFileSync(path.join(data, "satcat/C1", big.o.file), "utf8");
  const { ctx, page, errors } = await open(browser, big.p.file, { override: (rel) => (rel.endsWith(`/${big.o.file}`) ? answer(file) : null) });
  await page.click("#show-all");
  await page.waitForFunction(() => { const m = document.querySelector("#all-objects p.meta"); return m && m.textContent && !/Loading/.test(m.textContent); }, null, { timeout: 20000 });
  const msg = await page.textContent("#all-objects p.meta");
  check(name, want.test(msg) && !(await page.$("#all-objects-table")) && !!(await page.$("#show-all")), msg);
  check(`${name}: no page errors`, errors.filter((e) => /pageerror/.test(e)).length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- a country page with the new section
{
  const { ctx, page, errors } = await open(browser, "satellites-by-country/china/index.html", { width: 360, height: 780 });
  check("a country page has the objects section and does not scroll sideways at 360 px", !!(await page.$("#objects")) && (await noSideScroll(page)));
  check("no console errors on the country page", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} country page checks passed`);
process.exit(bad ? 1 : 0);
