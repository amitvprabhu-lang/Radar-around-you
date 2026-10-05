# Design: the "How many satellites are in orbit?" page

Status: approved by the owner in conversation on 2026-10-05, written down here for review. Nothing in this document is built yet. Anything marked NOT CONFIRMED has not been checked.

## 1. Why this page, and why not launches

The owner asked for live-data pages that could help the site rank in search. The first proposal was a rocket launches pilot. The owner then supplied Ubersuggest exports for a competitor, orbitalradar.com (estimates, not measurements; the export lists are subsets: the top 600 pages and the top 2,000 keywords). What those exports showed:

- One page, "how many satellites are in orbit", holds about 77% of the estimated visits in the top-600 list (64,352 of 83,207). The top 5 pages hold 86% and the top 20 hold 94%. 425 of the 600 pages have 5 or fewer estimated visits.
- That page holds position 1 for 102 phrasings of the same question, each with an estimated monthly search volume of roughly 6,600 to 8,100 for the largest ones.
- The competitor's launch-related keywords (82 of them) account for about 3% of the keyword traffic. Its many city, entity and launch pages are not where the traffic comes from.
- Its home page has about 7,300 backlinks and the winning page 63. Links to the site are very likely a large part of its lead and cannot be copied with on-page work.

Our own app already shows a similar number ("19,314 objects in orbit"). So the pilot is a live page that answers the question with a clearly defined number plus breakdowns computed from our own catalogue. The launches page is deferred (section 10).

Correction made the same day, before any code was written: the satellite feed is not the full catalogue. `pipeline/feeds.py` fetches CelesTrak's "active", "stations" and "visual" GP lists, and `pipeline/catalogue.py` adds four named debris clouds. The bundled snapshot shows the effect: of 19,316 objects, 16,632 are payloads, 4 are rocket bodies, 2,677 are debris and 3 are of unknown type, and only 2 objects have the status "Not operational". So the feed can honestly give the count of active satellites, and it cannot give a count of all satellites, all rocket bodies or all debris. An earlier draft of this spec promised those counts. They are removed. A fuller count would need a larger data source (for example the full CelesTrak or Space-Track catalogue), which is a later phase and raises its own reuse question (section 9).

What is not known: whether this page will rank. The competitor already holds position 1 for the query family and has a large link lead. No effect on search is possible while the site is on the test domain with noindex.

## 2. Scope

In scope: one new page at `/how-many-satellites-in-orbit/`, the code that builds it, a way to keep it fresh, tests, the source record, and the handoff and instruction updates.

Out of scope: the launches page, per-country or per-operator pages, an Atom or RSS feed, IndexNow, translations, a widget or public data feed, and any change to the 3D app.

## 3. The page

Title: "How many satellites are in orbit? Live count, 5 October 2026" (the date is the data date, written out in words). The meta description states the active count.

One headline number, defined in plain words on the page:

**Active satellites.** Payloads (object type Satellite) in the feed whose recorded status is Operational, Partially operational, Backup or standby, Spare or Extended mission. This is our definition, not CelesTrak's, and the feed is CelesTrak's "active" list, so the number is the count of active satellites that list holds. A table gives the count for each individual status and for payloads with no status recorded, so a reader who wants a different definition can add them up.

A "What this count does not include" section says plainly that the page does not count defunct satellites, rocket bodies or most debris, because the data behind it is the active list. It states that the feed holds four named debris clouds that are not the total debris population and are not presented as one. It points to the app for the objects the app shows.

Breakdowns, each as inline SVG with a title and description plus a text table as its alternative:

- top 10 owners (country or organisation, as recorded)
- orbit type: Low, Medium, Geostationary, High elliptical, and "not classified" for objects without usable orbit data
- purpose (internet, Earth observation, communications, navigation and so on, as recorded)
- launch year (a column per year, showing the growth)
- launched in the last 30 days, and the Starlink share

Text: an answer-first opening sentence (the active count, its definition and the data time in the first sentence, so a search snippet or an AI answer can quote it), headings written as the questions people ask, a short answer paragraph for each common phrasing of the question, a "How we count" section with the definitions above, a visible "Data as of" time, a "Page updated" time (when the page was last rebuilt, which only happens when the satellites data changes), a credit to CelesTrak and a link to its pages, and a short visible FAQ that repeats the key numbers as text. A link into the 3D app and to the satellites guide.

Rules for every number on the page:

- All numbers come from one computation, so the title, the headline, the FAQ and the charts cannot disagree. Tests enforce this.
- No per-satellite list. Aggregate counts only.
- Orbit boundaries are our working definitions: Low is a mean altitude below 2,000 km, Medium is 2,000 km up to but not including 35,586 km, Geostationary is 35,586 km up to 35,986 km, High elliptical is an eccentricity of 0.25 or more, and anything above 35,986 km that is not high elliptical is shown as "Beyond geostationary". Classification order: High elliptical is checked first (an object with an eccentricity of 0.25 or more is High elliptical whatever its altitude), then the altitude bands. The mean altitude is the semi-major axis, worked out from the object's mean motion, minus `SWARM_EARTH_RADIUS_KM` from `src/core.js` (the constant the swarm decoder already uses). These boundaries are NOT CONFIRMED against a cited standard; before the page calls them standard terms the source record (section 9) must cite one, or the page must say "our definition".
- The Starlink share counts objects whose name contains "STARLINK", as the app does. "Launched in the last 30 days" means launched within 30 days before the data build date, as the app's "new in orbit" list does.

Structured data: BreadcrumbList and WebPage, with `dateModified` equal to the visible "Page updated" time (never a launch or event date, as Google's publication dates guidance asks). FAQ markup is NOT added until Google's current structured data documentation has been read and the page qualifies. No Dataset markup, because the data's reuse terms are unclear.

## 4. How it is built: two units

- `site/satcount.mjs` (pure): takes the decoded catalogue and returns plain numbers. Reuses `unpackDetails`, `OBJECT_TYPES`, `launchDateFromDay`, `STATUS_NAMES` and the swarm decoder from `src/core.js`, `src/info.js` and `src/data.js`. No HTML.
- `site/pages-satcount.mjs` (pure): takes those numbers and the data and page times and returns a page object in the shape the other site pages use, so `renderPage` supplies the shared layout, navigation, canonical link and robots tag.

## 5. How it stays fresh

One code path, two places it runs:

1. **After each collection, on GitHub.** A new step in `.github/workflows/live-data.yml` runs `node site/build-live.mjs --data live --out pages`. It rebuilds the page only when the satellites feed's version has changed since the previous build (the previous `pages/index.json` is restored with the collector's memory), otherwise it keeps the existing page. Output goes into the `data` branch under `pages/`: the page, `sitemap-live.xml` and `pages/index.json` (each file's path, hash and the time its content last changed). The step needs Node set up in the workflow (the workflow has Python only today).
2. **At every deploy.** `npm run build:hosting` also builds the same page from the satellite data bundled in the repository, labelled with that snapshot's date, so the address never returns 404 after a redeploy. It makes no network call.

Delivery: `hosting/pull.php` and `hosting/lib.php` gain an optional `--pages-dest=<site root>`. It reads `pages/index.json`, downloads only files whose hash changed, writes each to a temporary name and renames it into place. It accepts only `.html` and `.xml` files under `pages/`, refuses any path containing `..`, and caps file sizes. The existing pull cron job (set up through hPanel, Websites, a regular site, Advanced, Cron Jobs) gets the new option added to its command.

Settings: GitHub repository variables `SITE_URL` and `SITE_NOINDEX`, set to the same values as Hostinger's, so the page's canonical address and robots tag are right. The step fails if `SITE_URL` is missing. The test domain stays noindex. When the final domain is chosen, both places must be changed (recorded in the handoff note).

Sitemap: while the site is noindex there is no sitemap and robots.txt disallows everything, as today. When it is not noindex, `sitemap-live.xml` lists the page with an accurate `lastmod` (the time the content last changed, which only moves when the satellites version changes, because Google uses `lastmod` only if it is consistently accurate), and robots.txt names both sitemaps. The main `sitemap.xml` does not list the live page.

## 6. Safety rails

- The builder refuses to write the page and the workflow step fails if the active satellite count is implausible (fewer than 5,000 or more than 60,000) or if payloads plus rocket bodies plus debris plus unknowns do not equal the number of objects in the feed.
- A failed build leaves the previous page on the site, because the pull only copies files that changed.
- If the collector is halted by a source's usage policy, the page keeps its last good numbers and shows the true "Data as of" time.
- The delay between a source updating and the page changing is about 10 to 20 minutes plus the satellites feed's own 2 hour refresh (`refreshSec` 7200 in the manifest).

## 7. Integration with the existing site

- A navigation entry in `site/layout.mjs`, a link from the satellites guide, and the sitemap handling in section 5.
- `site/build.mjs` writes the deploy-time page and adds it to the file list used for duplicate-page checks.
- Nothing in `src/` (the 3D app) changes.

## 8. Tests (written before the code)

- `test/satcount.test.js`: a small hand-built catalogue with known answers. Payload, rocket body, debris and unknown sum to the number of objects in the feed; status mapping matches the recorded CelesTrak codes; orbit boundaries at their exact edges; "last 30 days" on the boundary day; empty and tiny inputs.
- Against the real bundled snapshot: the counter's totals agree with the feed's own totals (19,316 objects, 16,632 payloads and 2,677 debris pieces in the bundled snapshot).
- An independent check by hand: compare the active satellite count with one independent published count (CelesTrak's own statistics page or the UCS Satellite Database), and record the date and result in the source record. Until that is done the page says "our count" and accuracy is NOT CONFIRMED.
- `test/pages-satcount.test.js` and additions to `test/site.test.js`: the number in the title, headline, FAQ and structured data is identical; internal links resolve; no em dashes or emoji; structured data parses; charts have text alternatives; no external requests; canonical and robots tags follow `SITE_NOINDEX`; the page is under a size cap.
- PHP tests in `hosting/tests/run.php`: a path with `..` is rejected, unchanged files are skipped, writes are atomic, a half-failed pull keeps the old file. PHP is installed on the Mac (8.5.11) and `npm run test:hosting` passed 92 on 2026-10-05.
- `e2e-site.mjs`: one more check that the page loads raw as a web host serves it, in standards mode, as UTF-8, with the right canonical and robots tags.
- Before any push: `npm test`, `npm run test:pipeline`, `npm run test:hosting`, `npm run e2e`, `npm run e2e:live` and `npm run e2e:site` (with `SITE_URL` and `SITE_NOINDEX` set as in the handoff note). One at a time, never two browser suites together.

## 9. Sources and what is not confirmed

A new `docs/satcount-sources.md` records, in the style of `docs/star-sources.md`, what was read, when, and what is NOT CONFIRMED. Known entries so far:

- CelesTrak usage policy (read 2026-10-05): covers request frequency and caching only. It says nothing about republishing, credit, commercial use or derived statistics. This is silence, not permission. Mitigations: aggregate counts only, no per-satellite list, a visible credit and link to CelesTrak. NOT CONFIRMED whether this is acceptable.
- Status codes: from `docs/feature-sources.md` (CelesTrak status codes page). Which codes count as "active" is our definition.
- Orbit boundaries: our working definitions (section 3). NOT CONFIRMED against a cited standard.
- The competitor figures in section 1 are Ubersuggest estimates supplied by the owner.
- Scope of the feed: CelesTrak's active, stations and visual lists plus four debris clouds (read from the collector's code on 2026-10-05). It is not the full catalogue.

## 10. Rollout and measuring

1. Build and test locally, then push. The page appears on the test domain, still noindex.
2. Verify on the live test domain with `curl` and a screenshot and compare the numbers.
3. Indexing changes only when the owner chooses the final domain: then drop noindex, update both `SITE_URL` settings, and submit the sitemap in Google Search Console.
4. Measuring cannot start until the final domain is indexed. Track the query family "how many satellites in orbit" and its variants weekly in Search Console (the Search Console connector failed to connect earlier, so it would be fixed or read by hand). Success markers are the author's guesses, not benchmarks: indexed within two weeks, impressions within four, top 10 for at least one variant within twelve. If none appears, review the page before building more. Do not judge it before about three months.

Search and answer engines: pages are indexable and quotable by design (answer-first sentence, question headings, tables, visible dates, structured data that matches the text). Google documents no special markup or files for its AI features. At launch the owner decides which crawlers `robots.txt` should name (search and answer crawlers such as OAI-SearchBot and Claude-SearchBot versus training crawlers such as GPTBot and ClaudeBot); the default `Allow: /` admits all of them. `llms.txt` is not added (no evidence that search engines or assistants read it for ordinary sites).

Later, not in this pilot: IndexNow and Bing Webmaster Tools, the full-catalogue counts, the launches page (with light at the pad, Earth-shadow height, launch times in six cities and distance from the visitor's place, as designed in conversation), per-country satellite pages, an Atom feed, IndexNow.

## 11. Risks

| Risk | Handling |
| --- | --- |
| The competitor holds position 1 and has a large link lead | Cannot be fixed on the page. Success markers above are modest and judged after three months. |
| CelesTrak reuse terms are unclear | Aggregate counts only, a credit, a source record. Consider asking CelesTrak directly. |
| The feed is CelesTrak's active list, not the full catalogue | The page says so in "What this count does not include" and does not publish counts for rocket bodies, debris or defunct satellites. |
| Our "active" and orbit definitions differ from others | Defined openly on the page, with the per-status table so readers can recompute. |
| The pull or the workflow fails silently | The page shows the true data time; the builder's plausibility checks fail the step loudly. |
| `hosting/lib.php` line 41 uses `$http_response_header`, deprecated in PHP 8.5 | Works silently on the server's PHP 8.3.33. Low priority; fix with a version check when the host moves to 8.4 or later. |
| Two places hold the site address (Hostinger and GitHub variables) | Written into the handoff note's final domain step. |

## 12. Open items for the owner

- Choosing the final domain gates all measuring.
- Whether to ask CelesTrak about reuse.
- Whether to fix the Search Console connector before launch.
