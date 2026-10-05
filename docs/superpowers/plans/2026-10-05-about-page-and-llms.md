# About Page, Richer Home Page and llms.txt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site explain itself in plain, visible, crawlable text: an `/about/` page, a richer home page (noscript text, structured data) and an `/llms.txt` file, so search engines and AI tools can understand what Radar Around You does.

**Architecture:** A pure page module (`site/pages-about.mjs`) joins the existing page list; `site/build.mjs` gets a richer `wrapApp` and writes `llms.txt` (only when the site is indexable) from a pure generator (`site/llms.mjs`) that reads the built pages' own titles and descriptions. The 3D app is untouched except two data links in `src/guidelinks.js`.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, no new npm packages.

**Spec:** `docs/superpowers/specs/2026-10-05-about-page-and-llms-design.md` (read it first).

**Starting state:** this plan runs on the branch `feature/satellite-count` AFTER the satellite count plan (`docs/superpowers/plans/2026-10-05-satellite-count-page.md`) Tasks 1 to 7. So `site/pages-satcount.mjs` (exporting `SATCOUNT_FILE`) exists, `buildPages` already takes `satcount` and `updated`, `NAV` already has a "Satellite count" entry, and `test/site.test.js` already expects the satellite page.

## Global Constraints

- No em dashes or en dashes and no emoji anywhere (code, comments, docs, page text, commit messages). Plain, human tone. In test code write dash checks with `\u2013` and `\u2014` escapes so the source has no dash characters.
- Never state a guess as a fact. Every statement on the About page must be traceable to `README.md` or a source record; `docs/about-sources.md` (Task 4) maps them. Do not add any claim that is not in the text below.
- No hidden or visually hidden text anywhere in the new page (no `hidden`, `display:none`, `aria-hidden`, `sr-only`).
- No volatile numbers on the About page (counts of objects, tests, pages). The only comma-grouped number allowed is `15,000` (the size of towns the place search covers, from the README).
- No FAQPage markup (Google reports the FAQ rich result is no longer shown). The About page's structured data is `AboutPage` with no `dateModified`.
- `llms.txt` is written only when the site is indexable (never in a `SITE_NOINDEX=1` build), like the sitemap.
- No account names, server addresses, tokens or email addresses in any committed file.
- Tests first (TDD): write the test, watch it fail, then write the code. Run the whole unit suite before each commit.
- Commit locally; do NOT `git push`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not run the browser suites in Tasks 1 to 3 (they run in Task 4, one at a time, on a quiet machine; `e2e:site` needs `SITE_URL=https://zeninnov8.com SITE_NOINDEX=1`).

## File Structure

| File | Responsibility |
| --- | --- |
| `site/pages-about.mjs` (create) | Pure: the About page object. Exports `ABOUT_FILE`, `aboutPage()`. |
| `site/llms.mjs` (create) | Pure: `buildLlmsTxt({ pages, url, name, summary })`. |
| `site/build.mjs` (modify) | Richer `wrapApp` (feature list, WebSite markup, longer noscript); write `llms.txt` when indexable; export `APP_FEATURES`. |
| `site/pages.mjs`, `site/layout.mjs` (modify) | Add the page and its nav entry. |
| `src/guidelinks.js` (modify, data only) | Two links in the app's About sheet. |
| `test/pages-about.test.js`, `test/llms.test.js` (create) | Unit tests. |
| `test/site.test.js` (modify) | Page count, nav, home page, llms.txt build tests. |
| `e2e-site.mjs` (modify) | Two raw-host checks. |
| `docs/about-sources.md` (create), `docs/handoff.md`, `CLAUDE.md`, `README.md` (modify) | Records. |

---

### Task 1: The About page

**Files:**
- Create: `test/pages-about.test.js`
- Create: `site/pages-about.mjs`

**Interfaces:**
- Consumes: `esc`, `table`, `sources`, `SITE`, `href` from `site/layout.mjs`; `SATCOUNT_FILE` from `site/pages-satcount.mjs`.
- Produces: `ABOUT_FILE` (`"about/index.html"`), `aboutPage() -> page object` (same shape as the pages in `site/pages-guides.mjs`: `file, crumbTitle, title, description, h1, kicker, lead, cta, body, jsonld`).

- [ ] **Step 1: Write the failing test**

Create `test/pages-about.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { aboutPage, ABOUT_FILE } from "../site/pages-about.mjs";
import { renderPage, SITE } from "../site/layout.mjs";

const page = aboutPage();
const html = renderPage(page, { noindex: false });
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const words = (text.match(/\b[\w'-]+\b/g) || []).length;

test("the page has its own address, one h1, and sane title and description lengths", () => {
  assert.equal(ABOUT_FILE, "about/index.html");
  assert.equal(page.file, ABOUT_FILE);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(page.h1, "What is Radar Around You?");
  assert.ok(page.title.length >= 15 && page.title.length <= 85, String(page.title.length));
  assert.ok(page.description.length >= 60 && page.description.length <= 320, String(page.description.length));
});

test("it is rich in plain text and has every section", () => {
  assert.ok(words >= 700, `only ${words} words`);
  for (const id of ["what", "features", "data", "fresh", "limits", "privacy", "free", "method", "faq", "sources"]) assert.ok(html.includes(` id="${id}"`), id);
  for (const q of ["What can you do with it?", "Where does the data come from?", "How fresh is the data?", "What does it not do?", "Does it know where I am?", "Is it free?"]) assert.ok(html.includes(`>${q}<`), q);
});

test("every data source is named, and the sources with a verified address are linked", () => {
  for (const name of ["U.S. Geological Survey", "GDACS", "NOAA National Hurricane Center", "NOAA Space Weather Prediction Center", "NASA FIRMS", "CelesTrak", "adsb.lol", "MET Norway", "The Space Devs", "NASA JPL", "IAU", "HYG", "NASA Exoplanet Archive", "GeoNames", "astronomy-engine"]) {
    assert.ok(text.includes(name), name);
  }
  for (const url of ["https://api.adsb.lol", "https://thespacedevs.com/llapi", "https://www.gdacs.org/About/overview.aspx", "https://codeberg.org/astronexus/hyg", "https://celestrak.org/"]) assert.ok(html.includes(`href="${url}"`), url);
});

test("it links to the guides and reference pages that explain each feature", () => {
  for (const to of ["../guides/aurora/", "../guides/storms/", "../guides/earthquakes/", "../guides/fires/", "../guides/asteroids/", "../guides/satellites/", "../moon-phases/", "../eclipses/", "../planets/", "../meteor-showers/", "../constellations/", "../stars/", "../sky/", "../methods/", "../how-many-satellites-in-orbit/", "../"]) {
    assert.ok(html.includes(`href="${to}"`), to);
  }
});

test("privacy, limits and the free licence are stated", () => {
  assert.match(text, /never leaves the device/);
  assert.match(text, /never recorded or sent/);
  assert.match(text, /not an emergency warning service/);
  assert.match(text, /Sky Lens is new and has not yet been tested on a real phone/);
  assert.match(text, /heat signal, not a confirmed wildfire/);
  assert.match(text, /MIT licence/);
  assert.match(text, /Pune, New York, London, Troms\u00f8?[a-z]*, Tokyo and Sydney|Pune, New York, London, Tromso, Tokyo and Sydney/);
});

test("the structured data is an AboutPage with no invented date, and there is no FAQ markup", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  const about = ld.find((o) => o["@type"] === "AboutPage");
  assert.ok(about, "AboutPage present");
  assert.equal(about.url, `${SITE.url}/about/`);
  assert.equal(about.about["@type"], "WebApplication");
  assert.equal(about.dateModified, undefined);
  assert.ok(!ld.some((o) => o["@type"] === "FAQPage"));
});

test("there is no hidden text and no volatile number, and the house style holds", () => {
  assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), "no hidden text markup");
  const bigNumbers = (text.match(/\b\d{1,3}(?:,\d{3})+\b/g) || []).filter((n) => n !== "15,000");
  assert.deepEqual(bigNumbers, [], "no comma-grouped counts other than 15,000");
  assert.ok(!/[\u2013\u2014]/.test(html), "no en or em dashes");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), "no emoji");
  assert.ok(!/<script[^>]+src=/.test(html) && !/<img /.test(html));
});

test("the FAQ is visible text with the questions as headings", () => {
  const faq = html.slice(html.indexOf('id="faq"'), html.indexOf('id="sources"'));
  const questions = [...faq.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(questions, ["What is Radar Around You?", "Is it free?", "Where does the data come from?", "Does it work for my town?", "Does it know where I am?", "Is it a forecast or a warning service?"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/pages-about.test.js`
Expected: FAIL with `Cannot find module '.../site/pages-about.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/pages-about.mjs`:

```js
// The About page: what the site is and what it does, in plain visible text for people, search engines and AI tools. Every statement
// comes from README.md or a source record and is traced in docs/about-sources.md. No hidden text, no volatile numbers (counts change;
// the page points to where they are shown instead), no FAQ markup.
import { esc, table, sources, SITE, href } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";

export const ABOUT_FILE = "about/index.html";
const go = (to) => href(ABOUT_FILE, to);
const a = (to, text) => `<a href="${go(to)}">${esc(text)}</a>`;
const ext = (url, text) => `<a href="${esc(url)}" rel="noopener">${esc(text)}</a>`;

const DESCRIPTION = "Radar Around You is a free live 3D view of the satellites, aircraft, sky, earthquakes, aurora, storms and fires around you. What it does, where its data comes from and what it does not do.";

export function aboutPage() {
  const body = `
<h2 id="what">What is Radar Around You?</h2>
<p>Radar Around You is a free tool that shows what is above you (satellites, the International Space Station and aircraft), what is in tonight's sky (stars, constellations, the Moon, planets and passes), what is under your feet (earthquakes, shown cut open through the Earth) and what is happening around you (storms, fires, aurora and other hazards). Everything is drawn in 3D, and every object can be tapped for details or searched for by name. It is a free project, and it works for any place on Earth.</p>
<p><a class="cta" href="${go("index.html")}">Open the live app</a></p>

<h2 id="features">What can you do with it?</h2>
<h3>Above you</h3>
<ul>
<li><strong>The globe.</strong> A 3D Earth with satellites, the International Space Station, earthquakes, storms, fires and aurora drawn on it. Tap any object for details, or search for a satellite, earthquake, star or place by name.</li>
<li><strong>Satellites and the ISS.</strong> Pass times for the ISS, other bright objects and satellites launched in the last 30 days come from SGP4, the model designed for NORAD element sets; every other satellite uses a faster approximation. Read ${a("guides/satellites/index.html", "how to spot the ISS and satellites")}, or see ${a(SATCOUNT_FILE, "how many satellites are in orbit")}.</li>
<li><strong>Starlink strings.</strong> It finds satellites from one recent launch that are still travelling in a line, and says when one can be seen from your place.</li>
<li><strong>Aircraft.</strong> Aircraft above six cities (listed under limits below), drawn as 3D airliners in the sky view.</li>
</ul>
<h3>In tonight's sky</h3>
<ul>
<li><strong>The sky view.</strong> A first-person 3D sky above any place you choose, with the Moon and its phase, planets, stars, constellations and satellites. A time slider moves through tonight.</li>
<li><strong>Tonight.</strong> One verdict for your place built from cloud cover, the Moon, the dark hours and the chance of aurora, with a timeline of what to look for: satellite and ISS passes, Starlink strings, planets and meteor showers near their peak.</li>
<li><strong>Stars and constellations.</strong> Tap a named star for its official IAU name, its constellation, its brightness and colour, and when it rises, is highest and sets for your place. Constellation figures and boundaries can be drawn in the sky. Browse ${a("constellations/index.html", "the 88 constellations")} and ${a("stars/index.html", "the stars with official names")}.</li>
<li><strong>The sky calendar.</strong> The next 90 days from your place: Moon phases, eclipses, planet events, meteor showers and the seasons, calculated with the astronomy-engine library. See the reference pages for ${a("moon-phases/index.html", "Moon phases")}, ${a("eclipses/index.html", "eclipses")}, ${a("planets/index.html", "planets")}, ${a("meteor-showers/index.html", "meteor showers")} and ${a("sky/index.html", "six city sky guides")}.</li>
<li><strong>Sky Lens.</strong> In the sky view, the Camera button puts the phone's rear camera behind the sky so that stars and satellites sit over the real sky. The picture stays on the device.</li>
</ul>
<h3>Under your feet</h3>
<ul>
<li><strong>The Under view.</strong> The Earth cut open through an earthquake and you, showing the crust, mantle and core, with the P and S waves travelling to you. Read ${a("guides/earthquakes/index.html", "how to read earthquake data")}.</li>
</ul>
<h3>Around you</h3>
<ul>
<li><strong>Storms, fires, quakes and aurora near you.</strong> The storms, fires, hazards, quakes and aurora near your place, most serious first, each with its source and an "as of" time. It links things only by distance and time and never claims that one caused another. Guides: ${a("guides/aurora/index.html", "aurora")}, ${a("guides/storms/index.html", "hurricanes")}, ${a("guides/fires/index.html", "fire detections")} and ${a("guides/asteroids/index.html", "asteroid close approaches")}.</li>
<li><strong>Rocket launches.</strong> Upcoming launches from The Space Devs, worded to match how exact the planned time is: a month or a quarter is never given a clock time.</li>
</ul>
<h3>Tools</h3>
<ul>
<li><strong>Share cards.</strong> A picture and a text version of an earthquake, a satellite pass, a Starlink string or the Tonight verdict, ready to share.</li>
<li><strong>Links and night use.</strong> Any screen and place can be shared or bookmarked as a link. A red light mode leaves only red light on the screen, for use at night.</li>
</ul>

<h2 id="data">Where does the data come from?</h2>
<p>Each card in the app says where its information comes from, with a link where the source has a page. These are the main sources.</p>
${table({ caption: "Sources of the data", head: ["What", "Source"], rows: [
  ["Earthquakes", `${ext("https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", "U.S. Geological Survey (USGS)")}`],
  ["Storms, floods, fires and volcanoes", `${ext("https://www.gdacs.org/About/overview.aspx", "GDACS")}, the Global Disaster Alert and Coordination System`],
  ["Tropical storms and their forecast tracks", `${ext("https://www.nhc.noaa.gov/", "NOAA National Hurricane Center")}`],
  ["Aurora, the Kp index, solar wind and geomagnetic alerts", `${ext("https://services.swpc.noaa.gov/", "NOAA Space Weather Prediction Center")}`],
  ["Active fire detections", `${ext("https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data", "NASA FIRMS")}, from three VIIRS satellites`],
  ["Satellite orbits and the catalogue", `${ext("https://celestrak.org/", "CelesTrak")}`],
  ["Aircraft above six cities", `${ext("https://api.adsb.lol", "adsb.lol")}`],
  ["Cloud forecasts for six cities", `${ext("https://api.met.no/", "MET Norway")}`],
  ["Rocket launches", `${ext("https://thespacedevs.com/llapi", "The Space Devs")} (Launch Library 2)`],
  ["Asteroid close approaches", `${ext("https://ssd-api.jpl.nasa.gov/doc/cad.html", "NASA JPL")} Close-Approach Data`],
  ["Star names and constellations", `${ext("https://www.iau.org/public/themes/constellations/", "IAU")}, the International Astronomical Union`],
  ["Star distances and details", `The ${ext("https://codeberg.org/astronexus/hyg", "HYG")} database`],
  ["Confirmed planets around stars", "NASA Exoplanet Archive"],
  ["Towns and cities for the place search", "GeoNames"],
  ["Moon phases, eclipses, planets and the seasons", "Calculated with the astronomy-engine library"],
] })}
<p>The page ${a("methods/index.html", "How we know")} lists the checks made and the things we could not confirm.</p>

<h2 id="fresh">How fresh is the data?</h2>
<p>The app can run on a bundled snapshot or on live data. A collector asks each source no more often than its published guidance allows, where the source gives any, checks the answer, and keeps the last good copy if a source fails. The clock chip in the app says LIVE only when live data is in use; otherwise it says SNAPSHOT. The Data status screen shows when each feed was last updated and whether it is fresh, retrying, stale or paused. How often a feed changes depends on its source, from every minute for earthquakes to every few hours for satellite orbits.</p>

<h2 id="limits">What does it not do?</h2>
<ul>
<li>It does not make weather or hazard forecasts of its own. For storms, fires, quakes and aurora it shows what the agencies publish, with their times.</li>
<li>It is not an emergency warning service. For safety information, follow your local authorities.</li>
<li>A fire detection is a heat signal, not a confirmed wildfire.</li>
<li>Cloud forecasts and aircraft overhead exist only for six cities: Pune, New York, London, Tromso, Tokyo and Sydney. The sky, calendar and Tonight work for any place.</li>
<li>Sky Lens is new and has not yet been tested on a real phone; it has been tested in a browser with a fake camera. Its starting field of view is a guess that you adjust by pinching.</li>
</ul>

<h2 id="privacy">Does it know where I am?</h2>
<p>You can choose to use your device's position. That position is used on the device to name your place, and it never leaves the device. The Sky Lens camera picture is shown only on the device and is never recorded or sent. You can also search for any town or city of about 15,000 people or more and use that instead.</p>

<h2 id="free">Is it free?</h2>
<p>Yes. Radar Around You is free to use, and its code is open source under the MIT licence. The code and the notes on each data source are on ${ext(SITE.repo, "GitHub")}.</p>

<h2 id="method">How is it checked?</h2>
<p>Moon phases, the seasons and solar eclipses on this site are compared with the US Naval Observatory's published tables whenever the site is built, and a page only quotes a comparison that actually ran. Every factual sentence in the guides comes from a source record that says where it was read and what could not be confirmed. See ${a("methods/index.html", "How we know")}.</p>

<h2 id="faq">Frequently asked questions</h2>
<h3>What is Radar Around You?</h3>
<p>A free live 3D view of what is above, around and under you: satellites and the ISS, aircraft, tonight's sky, earthquakes, aurora, storms and fires, for any place on Earth.</p>
<h3>Is it free?</h3>
<p>Yes. The code is open source under the MIT licence.</p>
<h3>Where does the data come from?</h3>
<p>From named agencies and projects such as USGS, NOAA, NASA, CelesTrak, MET Norway and The Space Devs. The table above lists each source, and each card in the app names its own.</p>
<h3>Does it work for my town?</h3>
<p>The sky view, calendar and Tonight work for any town or city of about 15,000 people or more, or for your device's position. Cloud forecasts and aircraft overhead exist only for six cities.</p>
<h3>Does it know where I am?</h3>
<p>You can choose to use your device's position, and that position never leaves your device.</p>
<h3>Is it a forecast or a warning service?</h3>
<p>No. It makes no weather or hazard forecasts of its own: for storms, fires, quakes and aurora it shows what the agencies publish, with their times. It is not an emergency warning service.</p>
${sources([
  { title: "Radar Around You on GitHub", url: SITE.repo, note: "The code, the licence and the notes on each data source" },
  { title: "CelesTrak", url: "https://celestrak.org/", note: "Satellite orbital element sets and catalogue" },
  { title: "US Naval Observatory, Astronomical Applications API", url: "https://aa.usno.navy.mil/data/api", note: "The published tables our calendar results are compared with" },
])}`;

  return {
    file: ABOUT_FILE, crumbTitle: "About",
    title: "What Radar Around You is and does: live sky, satellites, quakes and aurora",
    description: DESCRIPTION,
    h1: "What is Radar Around You?", kicker: "About",
    lead: "A free live 3D view of what is above, around and under you: satellites and the ISS, aircraft, tonight's sky, earthquakes, aurora, storms and fires, for any place on Earth.",
    cta: { label: "Open the live app", query: "" },
    body,
    jsonld: [{ "@context": "https://schema.org", "@type": "AboutPage", name: "What Radar Around You is and does", description: DESCRIPTION, url: `${SITE.url}/about/`, about: { "@type": "WebApplication", name: SITE.name, url: `${SITE.url}/` } }],
  };
}
```

Note: the page repeats the "Open the live app" call to action once in the body (`class="cta"`) and once through `page.cta`; the shell prints `page.cta` only if set, so to avoid a duplicate link, delete the `cta` property from the returned object if the rendered page shows two "Open the live app" buttons. The test does not depend on it.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pages-about.test.js`
Expected: all PASS. If the `Tromso` regex test fails, the page text contains the plain `Tromso` (no diacritic); the test accepts both.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: 0 failed (the page is not in the site build yet).

- [ ] **Step 6: Commit**

```bash
git add site/pages-about.mjs test/pages-about.test.js
git commit -m "Add the About page

A visible, plain-text page on what the site is and does: features grouped as above you,
tonight's sky, under your feet, around you and tools, a table of named data sources, how
fresh the data is, what it does not do, privacy, the free licence, how it is checked and
a visible FAQ. No hidden text, no volatile numbers, AboutPage structured data with no
invented date.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the page in, and enrich the home page

**Files:**
- Modify: `site/pages.mjs`, `site/layout.mjs`, `site/build.mjs`, `src/guidelinks.js`
- Modify: `test/site.test.js`

**Interfaces:**
- Consumes: `aboutPage` (Task 1).
- Produces: `APP_FEATURES` (array of 6 strings) exported from `site/build.mjs`; `wrapApp` output has a longer `<noscript>` block, `featureList` in the `WebApplication` markup and a second JSON-LD block of type `WebSite`; `NAV` has `["about/", "About"]`; `GUIDE_LINKS` has two new entries in a group `"About"`.

- [ ] **Step 1: Update and add tests in `test/site.test.js` (they fail until the code changes)**

1. Import: add `import { APP_FEATURES } from "../site/build.mjs";` by extending the existing import from `../site/build.mjs` (add `APP_FEATURES` to that import list).
2. In the test `the site has the expected pages and no duplicates` change the expectation to one more page and update its comment: replace `... + 6 + 1 + 1);` with `... + 6 + 1 + 1 + 1);` and the comment's tail `methods, satellite count` with `methods, satellite count, about`.
3. In the test `every link the app shows to the content pages has a page, and the list has no repeats`, after the existing `for (const nav of [...])` loop add:

```js
  for (const must of ["about/", "how-many-satellites-in-orbit/"]) assert.ok(GUIDE_LINKS.some((l) => l.href === must), `${must} is linked from the app's About sheet`);
```

4. In `the app page gains search metadata and nothing else changes`, after the existing noscript link assertion add:

```js
  const noscript = [...h.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)][0][0];
  for (const f of APP_FEATURES) assert.ok(noscript.includes(f), `noscript lists: ${f}`);
  assert.ok(noscript.includes('href="about/"'), "noscript links to the About page");
  assert.ok(noscript.length > 1400, `noscript is a real description (${noscript.length} characters)`);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  assert.deepEqual(ld.find((o) => o["@type"] === "WebApplication").featureList, APP_FEATURES);
  const site = ld.find((o) => o["@type"] === "WebSite");
  assert.ok(site && site.name === SITE.name && site.url === `${SITE.url}/`);
```

5. Add this new test at the end of the file:

```js
test("the About page is built, is in the main sitemap and the navigation, and carries the right robots tag", () => {
  assert.ok(pageFiles.includes("about/index.html"));
  const xml = fs.readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  assert.ok(xml.includes(`<loc>${SITE.url}/about/</loc>`));
  assert.ok(read("about/index.html").includes('<meta name="robots" content="index,follow,max-image-preview:large">'));
  assert.ok(read("moon-phases/index.html").includes('href="../about/"'), "every page's navigation links to About");
  assert.ok(read("index.html").includes('href="about/"'));
});
```

Run `node --test test/site.test.js` and confirm the changed and new tests FAIL (page count, app links, noscript, About page) before continuing.

- [ ] **Step 2: Add the page to `buildPages` (`site/pages.mjs`)**

Add the import `import { aboutPage } from "./pages-about.mjs";` and in the returned list change `guidesIndex(guides), ...guides, methodsPage(checks),` to `guidesIndex(guides), ...guides, methodsPage(checks), aboutPage(),`.

- [ ] **Step 3: Add the navigation entry (`site/layout.mjs`)**

In `NAV`, after the first entry `["", "Live app"],` add:

```js
  ["about/", "About"],
```

- [ ] **Step 4: Add the two links to the app's About sheet (`src/guidelinks.js`)**

At the end of the `GUIDE_LINKS` array, after the `methods/` entry, add:

```js
  { group: "About", href: "about/", label: "What Radar Around You is and does" },
  { group: "About", href: "how-many-satellites-in-orbit/", label: "How many satellites are in orbit" },
```

Only these two lines change in `src/`. (The browser suite `e2e` reads `GUIDE_LINKS` for its About-sheet checks, so it follows automatically.)

- [ ] **Step 5: Enrich the home page (`site/build.mjs`)**

1. After the `APP_DESCRIPTION` constant add:

```js
// OURS: the short feature list the home page's noscript text and structured data share. Each line is a statement from README.md.
export const APP_FEATURES = [
  "A 3D globe of tracked satellites, the International Space Station, earthquakes, storms, fires and aurora, with details on tap",
  "A first-person sky view for any place, with the Moon, planets, stars, constellations and satellite passes",
  "A Tonight verdict for your place from cloud, the Moon, the dark hours and aurora chance, with what to look for",
  "Earthquakes shown inside a cutaway of the Earth, with the waves travelling to you",
  "Aurora, storm, fire and launch information from named agencies, each with its source and time",
  "A sky calendar for the next 90 days: Moon phases, eclipses, planets and meteor showers",
];
const APP_DETAIL = "Everything is drawn in 3D, and every object can be tapped for details or searched for by name. Each card says where its information comes from, and the data comes from agencies and projects such as USGS, NOAA, NASA and CelesTrak.";
```

2. In `wrapApp`, replace the `const ld = {...};` object so it also carries `featureList` and `inLanguage`, and add a `WebSite` object right after it:

```js
  const ld = {
    "@context": "https://schema.org", "@type": "WebApplication", name: SITE.name, url: canonical, description: APP_DESCRIPTION,
    applicationCategory: "EducationalApplication", operatingSystem: "Any device with a web browser", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, featureList: APP_FEATURES, inLanguage: "en",
  };
  const ldSite = { "@context": "https://schema.org", "@type": "WebSite", name: SITE.name, url: canonical, description: APP_DESCRIPTION, inLanguage: "en" };
```

3. In the `head` template, replace the single line `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` with two lines:

```js
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script type="application/ld+json">${JSON.stringify(ldSite).replace(/</g, "\\u003c")}</script>
```

(`asDocument`'s `HEAD_PART` already moves any number of JSON-LD blocks into the head.)

4. Replace the whole `const noscript = ...;` statement with:

```js
  const features = APP_FEATURES.map((f) => `<li>${esc(f)}</li>`).join("");
  const noscript = `<noscript><div style="max-width:720px;margin:0 auto;padding:24px 16px;font:17px/1.6 system-ui,sans-serif;color:#eaf0ff;background:#04060c"><h1>${esc(SITE.name)}</h1><p>${esc(APP_DESCRIPTION)}</p><p>${esc(APP_DETAIL)}</p><ul>${features}</ul><p>The app needs JavaScript. These pages work without it:</p><ul>${nav}<li><a href="constellations/">The 88 constellations</a></li><li><a href="stars/">Stars with official names</a></li></ul></div></noscript>\n`;
```

The statement must keep ending with `</noscript>\n` (a newline escape before the closing backtick), exactly as the old statement did: an existing test removes the noscript block together with that newline. (`nav` is the existing `NAV.filter(...)` list defined just above, which now includes About.)

- [ ] **Step 6: Run the tests**

Run: `node --test test/site.test.js`
Expected: all PASS (30 earlier site tests plus the new one). If `every internal link and anchor resolves` fails for the About page, read the failure; the page links only to pages that exist.

- [ ] **Step 7: Run everything that does not need a browser**

Run: `npm test && npm run test:pipeline && npm run test:hosting`
Expected: 0 failed in each (hosting prints the known PHP 8.5 deprecation notice only).

- [ ] **Step 8: Commit**

```bash
git add site/pages.mjs site/layout.mjs site/build.mjs src/guidelinks.js test/site.test.js
git commit -m "Put the About page in the site and enrich the home page

The About page joins the page list and the navigation. The home page's noscript text
becomes a real description with a feature list, its WebApplication markup gains a
feature list, and a WebSite block is added. The app's About sheet links to the About
page and the satellite count page (data only, nothing else in src/ changes).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: llms.txt

**Files:**
- Create: `test/llms.test.js`
- Create: `site/llms.mjs`
- Modify: `site/build.mjs` (write the file when indexable), `test/site.test.js` (two tests)

**Interfaces:**
- Consumes: `urlPath` from `site/layout.mjs`; `SATCOUNT_FILE` from `site/pages-satcount.mjs`; the page objects (`file`, `crumbTitle`, `h1`, `description`).
- Produces: `buildLlmsTxt({ pages, url, name, summary }) -> string` from `site/llms.mjs`.

- [ ] **Step 1: Write the failing unit test**

Create `test/llms.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildLlmsTxt } from "../site/llms.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";

const mk = (file, crumbTitle, description) => ({ file, crumbTitle, h1: crumbTitle, description });
const pages = [
  mk("about/index.html", "About", "What the site is."),
  mk("methods/index.html", "How we know", "The checks.\nOn two lines."),
  mk("moon-phases/index.html", "Moon phases", "Exact dates."), mk("eclipses/index.html", "Eclipses", "Eclipse dates."),
  mk("meteor-showers/index.html", "Meteor showers", "Showers."), mk("planets/index.html", "Planets", "Planet events."),
  mk("seasons/index.html", "Equinoxes and solstices", "Seasons."), mk("constellations/index.html", "Constellations", "88."),
  mk("stars/index.html", "Stars", "Named stars."), mk("sky/index.html", "Sky by city", "Six cities."),
  mk("guides/aurora/index.html", "Aurora", "Aurora guide."), mk("guides/storms/index.html", "Storms", "Storm guide."),
  mk("guides/index.html", "Guides", "Index of guides."),
  mk(SATCOUNT_FILE, "Satellite count", "7 active satellites on 5 October 2026."),
];
const out = buildLlmsTxt({ pages, url: "https://example.org", name: "Radar Around You", summary: "A free live view." });

test("the file follows the llms.txt layout: a name, a summary line, then groups of linked notes", () => {
  const lines = out.split("\n");
  assert.equal(lines[0], "# Radar Around You");
  assert.equal(lines[2], "> A free live view.");
  assert.deepEqual(lines.filter((l) => l.startsWith("## ")), ["## Start here", "## Sky reference", "## Guides", "## Live data"]);
  for (const l of lines.filter((l) => l.startsWith("- "))) assert.match(l, /^- \[[^\]]+\]\(https:\/\/example\.org\/[^)]*\): .+$/, l);
  assert.ok(out.endsWith("\n"));
});

test("it links the app, the About page and the guides, but not the guides index", () => {
  assert.ok(out.includes("- [The live app](https://example.org/): A free live view."));
  assert.ok(out.includes("- [About](https://example.org/about/): What the site is."));
  assert.ok(out.includes("- [Aurora](https://example.org/guides/aurora/): Aurora guide."));
  assert.ok(!out.includes("https://example.org/guides/)"), "the guides index is not listed as a guide");
});

test("a note that spans lines is joined, and the live page's note carries no volatile number", () => {
  assert.ok(out.includes("- [How we know](https://example.org/methods/): The checks. On two lines."));
  assert.ok(out.includes("- [Satellite count](https://example.org/how-many-satellites-in-orbit/): A live count of active satellites in orbit, with breakdowns by owner, orbit, purpose and launch year."));
  assert.ok(!out.includes("7 active satellites"));
});

test("a missing page is an error, so a broken list can never ship quietly", () => {
  assert.throws(() => buildLlmsTxt({ pages: pages.filter((p) => p.file !== "about/index.html"), url: "https://example.org", name: "N", summary: "S" }), /no page about\/index\.html/);
});

test("the text has no en or em dashes", () => {
  assert.ok(!/[\u2013\u2014]/.test(out));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/llms.test.js`
Expected: FAIL with `Cannot find module '.../site/llms.mjs'`.

- [ ] **Step 3: Write the generator**

Create `site/llms.mjs`:

```js
// llms.txt for the site, in the llmstxt.org layout: a name, a one line summary, then groups of links with a note each. It is built from the
// site's own page titles and descriptions, so it cannot drift from the pages. Written only when the site is indexable (see site/build.mjs).
// Nothing read says search engines or AI assistants use this file for ordinary sites; it is a small optional extra.
import { urlPath } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";

const clean = (s) => String(s).replace(/\s+/g, " ").trim();
// OURS: the live satellite page's description holds today's numbers, so this file uses a fixed note instead.
const LIVE_NOTE = "A live count of active satellites in orbit, with breakdowns by owner, orbit, purpose and launch year.";
const REFERENCE = ["moon-phases/index.html", "eclipses/index.html", "meteor-showers/index.html", "planets/index.html", "seasons/index.html", "constellations/index.html", "stars/index.html", "sky/index.html"];

export function buildLlmsTxt({ pages, url, name, summary }) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const entry = (file, note) => {
    const p = byFile.get(file);
    if (!p) throw new Error(`llms: no page ${file}`);
    return `- [${clean(p.crumbTitle || p.h1)}](${url}/${urlPath(file)}): ${clean(note || p.description)}`;
  };
  const guides = pages.map((p) => p.file).filter((f) => /^guides\/[a-z0-9-]+\/index\.html$/.test(f));
  const lines = [
    `# ${name}`, "", `> ${clean(summary)}`, "",
    `${name} is a free project. The pages below are plain HTML that works without JavaScript; the live 3D app is at ${url}/.`, "",
    "## Start here",
    `- [The live app](${url}/): ${clean(summary)}`,
    entry("about/index.html"), entry("methods/index.html"), "",
    "## Sky reference", ...REFERENCE.map((f) => entry(f)), "",
    "## Guides", ...guides.map((f) => entry(f)), "",
    "## Live data", entry(SATCOUNT_FILE, LIVE_NOTE), "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the unit test**

Run: `node --test test/llms.test.js`
Expected: all PASS.

- [ ] **Step 5: Write the failing build tests**

Add to `test/site.test.js` at the end:

```js
test("an indexable build writes llms.txt whose every link is a built page", () => {
  const txt = fs.readFileSync(path.join(outDir, "llms.txt"), "utf8");
  assert.ok(txt.startsWith("# Radar Around You\n"));
  const links = [...txt.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 15, String(links.length));
  for (const l of links) {
    if (l === `${SITE.url}/`) continue;
    assert.ok(l.startsWith(`${SITE.url}/`), l);
    assert.ok(pageFiles.includes(l.slice(SITE.url.length + 1) + "index.html"), `${l} is not a built page`);
  }
  assert.ok(!/[\u2013\u2014]/.test(txt));
});

test("a noindex build writes no llms.txt, like it writes no sitemap", () => {
  const dir = path.join(tmp, "out-noindex-llms");
  build({ outDir: dir, appFile, publicDir: null, noindex: true });
  assert.ok(!fs.existsSync(path.join(dir, "llms.txt")));
});
```

Run `node --test test/site.test.js` and confirm these two FAIL (the first for a missing `llms.txt`; the second passes vacuously until the file exists, which is fine: it guards the noindex rule).

- [ ] **Step 6: Write `llms.txt` in the build (`site/build.mjs`)**

Add `import { buildLlmsTxt } from "./llms.mjs";` and, inside the existing `if (!noindex) { ... }` block that writes the sitemaps, add:

```js
    fs.writeFileSync(path.join(outDir, "llms.txt"), buildLlmsTxt({ pages, url: SITE.url, name: SITE.name, summary: APP_DESCRIPTION }));
```

- [ ] **Step 7: Run the tests**

Run: `node --test test/llms.test.js test/site.test.js`
Expected: all PASS.

- [ ] **Step 8: Run everything that does not need a browser**

Run: `npm test && npm run test:pipeline && npm run test:hosting`
Expected: 0 failed in each.

- [ ] **Step 9: Commit**

```bash
git add site/llms.mjs test/llms.test.js site/build.mjs test/site.test.js
git commit -m "Generate llms.txt from the site's own pages

A short llmstxt.org file (name, summary, grouped links with notes) built from the page
titles and descriptions, written only when the site is indexable. A missing page is an
error so the list cannot drift. Nothing read says assistants use the file, so it is an
optional extra and says nothing volatile about the live satellite page.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Browser checks and records

**Files:**
- Modify: `e2e-site.mjs`
- Create: `docs/about-sources.md`
- Modify: `docs/handoff.md`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Add the raw-host checks to `e2e-site.mjs`**

Before `await browser.close();` (after the satellite count page checks) insert:

```js
const about = await ctx.newPage();
await about.goto("https://radar.test/about/", { waitUntil: "load", timeout: 60000 });
const aboutInfo = await about.evaluate(() => ({
  h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode,
  words: (document.body.innerText.match(/\b[\w'-]+\b/g) || []).length, robots: (document.head.querySelector('meta[name="robots"]') || {}).content,
  faq: [...document.querySelectorAll("#faq h3")].length,
}));
check("the About page loads with its heading, real text and a visible FAQ, in standards mode, as UTF-8",
  aboutInfo.h1 === "What is Radar Around You?" && aboutInfo.words >= 700 && aboutInfo.faq === 6 && aboutInfo.compat === "CSS1Compat" && aboutInfo.charset === "UTF-8", JSON.stringify(aboutInfo));
check("its robots tag matches SITE_NOINDEX", aboutInfo.robots === want, String(aboutInfo.robots));
check("llms.txt exists exactly when the site is indexable", process.env.SITE_NOINDEX === "1" ? !fs.existsSync(site + "llms.txt") : fs.existsSync(site + "llms.txt"));
```

- [ ] **Step 2: Write `docs/about-sources.md`**

Create the file with this content:

```markdown
# Sources for the About page

Each statement on `/about/` and in the home page's description comes from the place named here, read from this repository on 2026-10-05. A statement that cannot be traced is left out. When a feature changes, update the matching sentence.

## Statements and where they come from
| Statement on the page | Source |
| --- | --- |
| Free tool; above you, in tonight's sky, under your feet, around you; everything drawn in 3D; tap any object or search by name; works for any place | README.md, opening paragraph and "What is in the prototype" (Globe, Sky, Under, Feed, Any place) |
| Globe: satellites, ISS, quakes, storms, fires, aurora; tap for details; search flies to a satellite or earthquake | README.md, Globe |
| Pass times for the ISS, other bright objects and satellites launched in the last 30 days come from SGP4 (the model designed for NORAD element sets); every other satellite uses a faster approximation | README.md, Exact passes (about 200 objects use SGP4; everything else uses the fast swarm model); `site/pages-guides.mjs` satellites guide for the model description |
| Starlink strings: satellites from one recent launch still in a line; says when one can be seen | README.md, Starlink strings |
| Aircraft above six cities, drawn as 3D airliners | README.md, Sky and Any place |
| Sky view: first-person 3D sky; Moon with phase, planets, stars, constellations, satellites; time slider | README.md, Sky |
| Tonight verdict from cloud, Moon, dark window, aurora chance; timeline of passes, Starlink strings, planets, meteor showers | README.md, Tonight |
| Stars: IAU name, constellation, brightness, colour, rise, highest and set times; constellation figures and boundaries | README.md, Stars and constellations |
| Sky calendar: next 90 days, Moon phases, eclipses, planet events, meteor showers, seasons; astronomy-engine | README.md, Sky calendar |
| Sky Lens: rear camera behind the sky; picture stays on the device | README.md, Sky Lens |
| Under view: Earth cut open, crust, mantle, core, P and S waves | README.md, Under |
| Around you: near your place, most serious first, source and "as of" time, links by distance and time only, never claims a cause | README.md, Around you |
| Launches: The Space Devs, wording matches how exact the time is, a month or quarter never gets a clock time | README.md, Launches; `docs/star-sources.md` |
| Share cards; shareable links; a red light mode that leaves only red light on the screen | README.md, Share cards and Phone and night use (the install-to-home-screen claim is NOT made: the README says it was not tried on a real phone) |
| Source list (USGS, GDACS, NHC, SWPC, NASA FIRMS, CelesTrak, adsb.lol, MET Norway, The Space Devs, JPL, IAU, HYG, NASA Exoplanet Archive, GeoNames, astronomy-engine) | README.md, "Live data" table and feature bullets; `site/pages-guides.mjs` source lists; addresses read from `docs/*.md` and `pipeline/config.py` (GeoNames and NASA Exoplanet Archive are named without a link because no address is recorded in the repository) |
| Collector asks each source no more often than its published guidance allows, where the source gives any (several sources state none), keeps the last good copy; LIVE only when live data is in use, otherwise SNAPSHOT; Data status screen shows fresh, retrying, stale or paused | README.md, "Live data" (the table says where a limit is not stated) and "Sources on every card" |
| A feed changes as often as its source does, from every minute for earthquakes to every few hours for satellite orbits | README.md, "Live data" table (USGS "Updated every minute"; CelesTrak "once every 2 hours"). No delay estimate is given on the page. |
| No weather or hazard forecasts of its own; storms, fires, quakes and aurora are what the agencies publish, with their times | `site/pages-guides.mjs` methods page ("The live app is not forecast by us"); README.md, Around you ("nothing in it is predicted by this app"). The app does calculate pass times, the Tonight verdict and the calendar; the page does not claim otherwise. |
| Fire detection is a heat signal, not a confirmed wildfire | README.md, Fires |
| Cloud forecasts and aircraft for six cities: Pune, New York, London, Tromso, Tokyo, Sydney | README.md, Any place; `snapshot.json` cities |
| Sky Lens is new and has not yet been tested on a real phone; it has been tested in a browser with a fake camera; its starting field of view is a guess | README.md, Sky Lens ("Tested in a real browser with a fake camera, not on a phone"; 60 degrees is a guess); `docs/handoff.md` open item on real-device checks |
| You can choose to use your device's position; it is used on the device to name your place and never leaves it; the camera picture is never recorded or sent | README.md, Any place and Sky Lens |
| Place search covers towns and cities of about 15,000 people or more | README.md, Any place (GeoNames) |
| Free; the code is open source under the MIT licence (data and images keep their sources' terms); code on GitHub | `LICENSE`; README.md, licence section |
| Moon phases, seasons and solar eclipses compared with US Naval Observatory tables at build time; a page only quotes a check that ran | README.md, Content site; `site/verify.mjs` |

## Statements in the author's own words (for the owner to review)
- "It is not an emergency warning service. For safety information, follow your local authorities." The second sentence follows the fires guide's wording ("For safety information, follow your local authorities"); the first is a standard caution that is not in the README.
- "Sky Lens is new and has not yet been tested on a real phone." The README says it was tested in a browser with a fake camera, not on a phone, so this is sourced; the owner may prefer to leave the statement out until a phone test is done.
- No personal name is used on the page.

## What the page does not say
- Any count of objects, tests or pages (they change). The satellite count page shows its own numbers with their data time.
- Any refresh interval for a source, or any estimate of how long new data takes to arrive (they can drift). The page points to the app's Data status screen.
- Anything about cookies, analytics or accounts: not recorded in the repository, so not claimed.

## llms.txt
- `/llms.txt` follows the format described at https://llmstxt.org/ (read 2026-10-05). That page says thousands of sites publish one and that AI labs publish them for their developer documentation; it does not claim that search engines or assistants read them for ordinary sites. Google's page on AI features says no extra files or markup are needed. So it is an optional extra, written only when the site is indexable.
```

- [ ] **Step 3: Update `README.md`, `docs/handoff.md` and `CLAUDE.md`**

In `README.md`, in the "Content site (search pages)" section: change the page counts in its first paragraph to say 112 pages if (and only if) the build prints that number (run `npm run build:hosting` and read `site: N pages written`; use the printed number), mention the new About page and the satellite count page in the list of pages, and add one sentence: `An indexable build also writes llms.txt (a short summary and links in the llmstxt.org layout); a noindex build writes it no more than it writes a sitemap.` Do not change other README text.

In `docs/handoff.md` add a short paragraph under the SEO item: the About page, richer home page and `llms.txt` are built (spec `docs/superpowers/specs/2026-10-05-about-page-and-llms-design.md`, plan `docs/superpowers/plans/2026-10-05-about-page-and-llms.md`, sources `docs/about-sources.md`); the three author-worded sentences need the owner's review; at launch the owner decides which crawlers `robots.txt` names (the default `Allow: /` admits all); `llms.txt` is unproven. In `CLAUDE.md`'s Layout paragraph add: `site/pages-about.mjs and site/llms.mjs make the About page and llms.txt; every statement on the About page is traced in docs/about-sources.md.` Update the numeric test counts in `CLAUDE.md` to what the commands print now.

- [ ] **Step 4: Run the unit tests, then the site browser suite**

Run: `npm test && npm run test:pipeline && npm run test:hosting` (0 failed in each).

Then, on a quiet machine (check `uptime`; wait for the one minute load average to drop below about 4; do not touch other processes; `rm -rf dist` first):
`SITE_URL=https://zeninnov8.com SITE_NOINDEX=1 npm run e2e:site` expecting all `ok`, `17/17 site checks passed` (14 earlier plus 3 new). Then `SITE_URL=https://zeninnov8.com npm run e2e:site` expecting all `ok`, including `llms.txt exists exactly when the site is indexable`. If a run fails with a 60 second timeout waiting for the loader, that is the known load problem: wait for a quiet machine and rerun once before reporting.

- [ ] **Step 5: House style and identifier check (do not use `xargs grep -P`, it is unreliable on macOS)**

Run a Python scan over every file changed on the branch since the satellite count work began (`git diff --name-only <base>..HEAD`, with the base given in your dispatch) for U+2013, U+2014 and the emoji ranges, ignoring the one pre-existing literal-character assertion in `test/site.test.js`, and scan the ADDED lines (`git diff <base>..HEAD`) for `<hosting account username>`, an IP-like pattern and `@`. Show the output; expected: nothing found.

- [ ] **Step 6: Commit**

```bash
git add e2e-site.mjs docs/about-sources.md docs/handoff.md CLAUDE.md README.md
git commit -m "Check the About page on a raw host and record where its statements come from

Adds raw-host checks for the About page and llms.txt, a table tracing every statement on
the page to the README or a source record, and marks the three sentences in the author's
own words for the owner's review. README, handoff and instructions are updated.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

Spec coverage: About page with all sections, no hidden text, no volatile numbers, AboutPage markup without a date, no FAQPage (Task 1); richer home page noscript, `featureList`, `WebSite`, nav entry, app-sheet links (Task 2); `llms.txt` generated from page metadata, only when indexable, missing page is an error (Task 3); tests for each, `e2e:site` checks, source table with the three author-worded sentences flagged, handoff, README and instructions (Task 4). Out of scope items are untouched.

Placeholder scan: every code step carries its code; the only conditional instruction (delete `page.cta` if two buttons render) says exactly what to do.

Type and name consistency: `ABOUT_FILE`, `aboutPage` (Task 1) are used in Task 2; `APP_FEATURES` (exported in Task 2) is imported by `test/site.test.js` in the same task; `buildLlmsTxt({ pages, url, name, summary })` (Task 3) matches its call in `site/build.mjs`; `SATCOUNT_FILE` comes from the satellite count work.
