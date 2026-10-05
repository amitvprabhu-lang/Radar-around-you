# Design: live pages from the hazard feeds (five pages and a hub)

Status: written on 2026-10-06 after the owner said "Yes, dynamic pages would be a good idea" (in answer to a list of candidates). The choice of pages and the content are mine and are listed for the owner's review. Anything marked NOT CONFIRMED has not been checked.

## 1. What is built

Five pages and one hub (the owner asked on 2026-10-06 for "all dynamic, easily indexable pages which add value to the internet and the users"; see section 2a) that rebuild whenever their feed changes, in the same way as the satellite count page: GitHub builds them into the data branch's `pages/` folder after each collection, `hosting/pull.php --pages-dest` copies them to the site, and `site/build.mjs` writes a snapshot copy at deploy time so a redeploy never 404s them.

| URL | Feed (collector name) | Answers |
| --- | --- | --- |
| `/earthquakes-today/` | `quakes` (USGS) | How many earthquakes in the last 24 hours, the biggest, where, how the count splits by magnitude and by region |
| `/aurora-tonight/` | `kp`, `spaceweather`, `aurora` (NOAA SWPC) | What the Kp index is now and over the last three days, solar wind speed and magnetic field now, what the aurora oval grid says, what that means for the reader's latitude |
| `/asteroid-close-approaches/` | `closeapproaches` (NASA JPL close approach data) | Which known objects pass within a set distance in the coming days, with distance in lunar distances, speed and size class |
| `/tropical-storms-now/` | `storms` (NOAA NHC) | Which tropical storms and hurricanes are active, their wind, pressure, position, movement and the forecast track |
| `/wildfires-today/` | `fires` (NASA FIRMS) | How many satellite fire detections in the last 24 hours, by detecting satellite, where the densest cells are (grid cell centres, and the nearest named place from our own place list within a stated distance, or none), a map of the detection density |
| `/right-now/` | all of the above plus the satellite count | A hub: one headline number per live page with its data time and a link, so a reader or a crawler finds every live page from one place |

Not built, on purpose: a launches page (the launch data licence is NOT CONFIRMED, see `docs/launch-licences.md`), a planes page (coverage is only six cities).

## 2. Rules every page follows

- Everything printed comes from the feed: counts, maxima, lists, times. The only typed text is method, caveats and definitions, and each of those is checked against the code and the source record in `docs/`.
- Answer-first lead with the data time: "As of <date>, <time> UTC, ...". The data time is the feed's own timestamp (`generated`, `updated`, or the newest record), not the build time, so the page never claims to be fresher than its data.
- Staleness: each page has a maximum age for its feed (quakes 3 hours, space weather 6 hours, kp 8 hours, storms 12 hours, close approaches 48 hours; kp was 6 hours in the first version of this design and was raised on 2026-10-06 because NOAA's newest Kp time tag was already 3.5 hours old at a collection on 2026-10-05, so 6 hours left the aurora page skipped whenever NOAA was a little late). A feed older than that is not published as "now": the page build fails for that page with a clear message, the other pages are unaffected and the previous copy stays on the site. A test covers a stale feed.
- Plausibility guard per page (the pattern of `assertPlausible` in `site/satcount.mjs`): for example quakes must have at least one event and magnitudes within -2 to 10, Kp within 0 to 9, a close approach distance above zero and below a stated maximum. A broken feed never publishes nonsense.
- No safety advice beyond what the source says. The earthquake page does not say "safe" or predict anything; the aurora page says the Kp-to-latitude rule only as far as `docs/hazard-sources.md` supports it; the storm page links to the NHC for official advisories and says the page is not a warning service.
- Same shell and house style as the count page (`renderPage`, structured data BreadcrumbList plus WebPage with `dateModified` = the data time, a visible FAQ without FAQPage markup, a sources section, canonical, robots, no hidden text, no em dashes or emoji). The first screen of each page has one chart or table that matters (hourly quake counts, the Kp bars, the approach table, the storm table).
- Each page links to the matching guide, the count page where relevant, the live app and the other live pages; the app's About sheet and `llms.txt` list them.
- Every page has at least one chart or table made by a pure function and tested on its own: a bar chart of Kp per three hours (colour not the only cue: values printed), a column chart of earthquakes per hour, a size band table, a map of the quake epicentres reusing `site/svgmap.mjs` with the app's coast data (points rounded and deduplicated), a storm track map likewise.

## 2a. Easily indexable, and of real value (owner's requirement)

- Plain server-rendered HTML that needs no JavaScript to show its numbers, tables and charts (SVG), so a crawler sees everything in the first response. A test fetches each built page raw and checks the headline number is in the HTML.
- One URL per question, a canonical address, `index,follow` when the site is indexable (and `noindex` with no sitemap entry when `SITE_NOINDEX=1`, as today).
- Every live page is in `sitemap-live.xml` with a `lastmod` equal to its data time (not the build time), and is linked from the `/right-now/` hub, the nav, `llms.txt`, the home page text section and the other live pages, so no live page is an orphan. A test asserts every live page is linked from the hub and every hub link resolves.
- Fast and small: each page under 250 KB, no external requests, no web fonts beyond the shell's.
- Value: each page gives the number, the context (the last day, the biggest, the distribution), a visual, the method and the source, and links to the official agency; none is a template filled with a city name. No page is published when its data is stale or empty (see the rules above), so the sitemap never advertises an empty page.
- Pings and Dataset markup (the owner said on 2026-10-06 "You can add Sitemap pings and Dataset markup"): see sections 2b and 2c. Submitting the sitemap in Search Console stays the owner's step (already in the handoff).

## 2b. Pings: IndexNow (checked against indexnow.org on 2026-10-06)

What the documentation says: URLs are submitted with a POST of JSON (`host`, `key`, `urlList`, optionally `keyLocation`) to an IndexNow endpoint; the key is 8 to 128 characters of letters, digits and dashes and is proved by a UTF-8 text file `<key>.txt` at the site root holding the key; a response of 200 or 202 is success, 403 invalid key, 422 URLs not matching the host, 429 too many requests. The FAQ lists Amazon, Bing, Naver, Seznam.cz, Yandex and Yep as participants (Google is not listed), says a submission to one endpoint is shared with all of them, asks sites to avoid submitting the same URL many times a day without meaningful changes and to wait at least 5 minutes between updates of one URL. Google's own sitemap ping endpoint is being retired (Google's June 2023 post "Sitemaps ping endpoint is going away", the article body was not read, so how long it was supported is NOT CONFIRMED): Google finds the sitemap through robots.txt (already done) and Search Console (the owner's step). So IndexNow is the only ping built; no Google ping exists to build.

Design:
- The key is a random 32-character hexadecimal string committed in the repository (`site/indexnow.key`, one line). It is public by design (anyone can fetch `<key>.txt`), not a secret; the repository rule against secrets is not broken because it proves ownership and gives no access. `site/build.mjs` writes `<key>.txt` into the site output when the site is indexable (and never when `SITE_NOINDEX=1`), so a redeploy keeps it.
- The submitter is `hosting/pull.php` through a new function in `hosting/lib.php`, `radar_indexnow(...)`, run after `radar_sync_pages` and only for pages that the sync actually changed. It reads `siteUrl` and `indexnowKey` from `pages/index.json` (written by `build-live.mjs`), submits only paths that pass `radar_safe_page_path`, requires that `<destRoot>/<key>.txt` exists and holds the key (proof the key belongs to this site; if not, nothing is sent), builds URLs as `siteUrl` plus the path, and POSTs once to `https://api.indexnow.org/indexnow` with `keyLocation`.
- Throttle: a state file next to the log (`indexnow.json`) holds the last submission time per path; a path is submitted at most once every 6 hours (the pages change every collection, but the FAQ asks to avoid many submissions a day), and a run with nothing due sends nothing. A 429 or any error is logged and never fails the pull; no retry loop; the next run tries again after the same throttle.
- Off switch: `pull.php --no-indexnow`, and deleting `site/indexnow.key` (the build then writes no key file and index.json carries no key, so the server sends nothing).
- Tests: payload shape, the throttle, the key-file proof, a refused path never submitted, an HTTP failure logged and not fatal, nothing sent when nothing changed, nothing sent when the site is noindex (index.json says so).
- NOT CONFIRMED: whether any engine crawls faster because of it.

## 2c. Dataset structured data (checked against Google's Dataset guidelines on 2026-10-06)

What the guidelines say: required `name` and `description` (50 to 5,000 characters); recommended `creator`, `license` (a URL that unambiguously identifies a licence version), `temporalCoverage`, `spatialCoverage`, `keywords`, `isAccessibleForFree`, `distribution` (DataDownload), `version`, `isBasedOn` is not in the list read. The guidelines do not say whether a page of summary statistics qualifies; the markup shows in Dataset Search and Google gives no guarantee of any feature. So the value is NOT CONFIRMED.

Design: a `Dataset` JSON-LD block, beside the existing BreadcrumbList and WebPage blocks, on a live page only when the source's terms are recorded as verified in `docs/hazard-sources.md` or `docs/feature-sources.md` (it must be a documented fact, the page test reads the docs table `docs/hazard-pages-sources.md` for a "terms verified" flag per feed): earthquakes (USGS), aurora and space weather (NOAA SWPC), tropical storms (NHC), fires (FIRMS), and the close approaches (NASA JPL) only if its terms are recorded. NOT on the satellite count or country pages (CelesTrak's policy is silent on derived counts). Properties: `name`, `description` (the page's lead, 50 characters or more), `url` (the page), `creator` (the site as an Organization), `isBasedOn` (the source's own dataset page URL as a CreativeWork), `dateModified` and `temporalCoverage` (an ISO 8601 interval from the data window, for example the last 24 hours to the data time), `spatialCoverage` ("Earth"), `keywords`, `isAccessibleForFree: true`. No `license` property unless `docs/hazard-pages-sources.md` records a licence URL for the derived summary (an agency's public-domain status is not a licence URL; do not invent one). No `distribution` (the pages offer no download); a machine-readable download of each page's summary is a possible later addition, not part of this build. The markup must describe what is on the page; a test checks that every number named in the markup also appears in the visible page.

## 3. Content of each page

**Earthquakes today.** Counts for the last 24 hours (all, magnitude 2.5 and above, 4.5 and above, 6 and above); the largest event with place, magnitude, depth, time and the USGS link; a table of the ten largest; counts per hour for 24 hours; counts by region (the text after the last comma of the USGS place string is a place name, not a region: group by that string only for the ten most frequent and say they are the USGS place labels, never by guesswork); a map of epicentres; how the feed is built (USGS summary feed, automatic against reviewed status counted from the feed's `status` field). Caveats from `docs/feature-sources.md`: automatic solutions can change; counts depend on the feed's magnitude floor.

**Aurora tonight.** The latest Kp and the last 72 hours as bars; solar wind speed, density, total field and Bz now and their last-six-hour range from `spaceweather`; the aurora grid summary (maximum probability and the latitude band where it is at least 10 percent, from the feed's grid, per hemisphere), and a table "what Kp means for latitude" only if `docs/hazard-sources.md` records the source for the numbers, otherwise the page links to NOAA's own explanation and prints nothing it cannot cite. Bz sign convention explained from the source. No forecast of our own: the page says "observed" for what is observed.

**Asteroid close approaches.** From the feed: the objects with close approach in the feed's window, sorted by date; distance in lunar distances and kilometres, relative speed, the absolute magnitude H with the size estimate range only if `docs/feature-sources.md` records the formula and the albedo assumption, otherwise show H only and explain it; time uncertainty (`timeSigma`) shown as the feed gives it; the nearest, the fastest, the faintest. Definitions of lunar distance and AU from the feed's `ldKm`. A sentence that "close" is astronomical and a pass inside the Moon's distance is not a collision, only if the source record supports it.

**Wildfires today.** From `fires.json` and `fires.bin`: detections in the feed's window (the feed states it: 24 hours), cells with detections, the count by detecting satellite, the data time (`newest`), how many low-confidence detections the collector left out (the feed states it), the ten densest cells with their centre coordinates and the nearest place from `public/places.json` WITH the distance in km and the rule ("nearest of the places in our list of 6,000, so it can be far from the fire; if the nearest place is more than 300 km away the page prints the coordinates only"), a density map from the cells using `site/svgmap.mjs`, definitions of a detection and of fire radiative power from the source record in `docs/hazard-sources.md`. The page never says a detection is a wildfire (a detection is a hot spot seen by a satellite; industrial heat and controlled burns count) and never reports damage or danger.

**Right now (hub).** A table of the live pages: name, one headline number computed from the same summaries (active satellites, earthquakes in 24 hours with the largest magnitude, Kp now, the next close approach and its distance in lunar distances, active tropical storms, fire detections in 24 hours), the data time of each and a link. A short lead, the method, the sources and the links to the guides. A page whose feed is stale shows "data older than N hours, page not updated" instead of a number, and is not linked as live.

**Tropical storms now.** For each active storm: name, basin, class (the feed's own text), wind in knots and km/h, pressure, position, movement, advisory number and issue time, link to the NHC page, the forecast track as a table and a small map; if there are no active storms, the page says so with the data time and lists the most recent GDACS tropical cyclone events from the `events` feed only if present; no storm is ever described as "safe to ignore".

## 4. Where the code goes

- `site/hazard.mjs` (pure): `summariseQuakes`, `summariseSpace`, `summariseApproaches`, `summariseStorms`, `summariseFires`, each with a freshness check and a guard, plus `HAZARD_PAGES` (slug, feed names, max age, title phrase).
- `site/pages-hazard.mjs`: the page functions (one for each of the five summaries, plus the `/right-now/` hub) and the chart helpers (reuse `barChartSvg`, `columnChartSvg` from `site/pages-satcount.mjs` and `worldMapSvg` from `site/svgmap.mjs`).
- `site/indexnow.mjs` (the key reading, the `<key>.txt` file) plus `radar_indexnow` in `hosting/lib.php` and the `--no-indexnow` option of `hosting/pull.php` (section 2b); `site/pages-hazard.mjs` adds the Dataset block (section 2c).
- `site/livepages.mjs`: one registry of every live page path (count, country hub, five countries, five hazard pages, the right-now hub), used by `build-live.mjs`, the sitemap, the llms notes and the PHP-sync test.
- `site/build-live.mjs`: each page is built independently; a stale or failing feed skips only its page, prints which and why, and the previous copy stays; the manifest is read for every feed; `index.json` lists every file; the generator hash covers the new modules; rebuild when the page's own feed version changes (per page versions in `index.json`), not only the satellites version, so quake pages refresh every collection while the satellite pages stay as they are.
- `hosting/lib.php`: the slugs are added to the allowed paths (`earthquakes-today`, `aurora-tonight`, `asteroid-close-approaches`, `tropical-storms-now`, `wildfires-today`, `right-now`, each `<slug>/index.html`), still `\z`, plus tests and the list-sync test. The owner must copy `lib.php` to the server again.
- `site/build.mjs`: deploy-time snapshot copies from `public/` (the bundled snapshot has the same feed files) with their data time in the page, so a redeploy shows the snapshot until the next pull; nav and `llms.txt` entries.
- `e2e-site.mjs`: one raw check per page (status, canonical, robots, a number, the data time).
- Docs: `docs/hazard-pages-sources.md`, `docs/handoff.md`, `README.md`, `CLAUDE.md`.

## 5. Risks

| Risk | Handling |
| --- | --- |
| A page shows old data as if current | Data time in the lead, per-feed maximum age, a stale page is not published and the old one stays |
| One broken feed stops the others | Pages are built independently; the satellite pages are untouched |
| Many near-identical pages | Five different questions, five different data shapes; no per-city or per-country templated pages |
| A fire cell is attached to a misleading place name | The nearest place is printed with its distance and the rule; beyond 300 km only coordinates are printed |
| An overstated safety or science claim | Every typed sentence traced to `docs/hazard-sources.md` or `docs/feature-sources.md`; unsourced statements are left out and the page links to the agency |
| Collector load or cadence | No new collection: pages only read what the collector already writes |
| Search value | NOT CONFIRMED: no ranking can be measured until Search Console has data |
| Pinging too often or from a broken build | Six-hour throttle per URL, only changed pages, key-file proof, errors never fail the pull, an off switch |
| Dataset markup that implies a licence | No `license` unless a licence URL is recorded; only for feeds whose terms are verified in the docs |
