# Design: four live pages from the hazard feeds

Status: written on 2026-10-06 after the owner said "Yes, dynamic pages would be a good idea" (in answer to a list of candidates). The choice of pages and the content are mine and are listed for the owner's review. Anything marked NOT CONFIRMED has not been checked.

## 1. What is built

Four pages that rebuild whenever their feed changes, in the same way as the satellite count page: GitHub builds them into the data branch's `pages/` folder after each collection, `hosting/pull.php --pages-dest` copies them to the site, and `site/build.mjs` writes a snapshot copy at deploy time so a redeploy never 404s them.

| URL | Feed (collector name) | Answers |
| --- | --- | --- |
| `/earthquakes-today/` | `quakes` (USGS) | How many earthquakes in the last 24 hours, the biggest, where, how the count splits by magnitude and by region |
| `/aurora-tonight/` | `kp`, `spaceweather`, `aurora` (NOAA SWPC) | What the Kp index is now and over the last three days, solar wind speed and magnetic field now, what the aurora oval grid says, what that means for the reader's latitude |
| `/asteroid-close-approaches/` | `closeapproaches` (NASA JPL close approach data) | Which known objects pass within a set distance in the coming days, with distance in lunar distances, speed and size class |
| `/tropical-storms-now/` | `storms` (NOAA NHC) | Which tropical storms and hurricanes are active, their wind, pressure, position, movement and the forecast track |

Not built, on purpose: a fires page (needs reverse geocoding of grid cells; the nearest named place would be a guess), a launches page (the launch data licence is NOT CONFIRMED, see `docs/launch-licences.md`), a planes page (coverage is only six cities).

## 2. Rules every page follows

- Everything printed comes from the feed: counts, maxima, lists, times. The only typed text is method, caveats and definitions, and each of those is checked against the code and the source record in `docs/`.
- Answer-first lead with the data time: "As of <date>, <time> UTC, ...". The data time is the feed's own timestamp (`generated`, `updated`, or the newest record), not the build time, so the page never claims to be fresher than its data.
- Staleness: each page has a maximum age for its feed (quakes 3 hours, space weather and kp 6 hours, storms 12 hours, close approaches 48 hours). A feed older than that is not published as "now": the page build fails for that page with a clear message, the other pages are unaffected and the previous copy stays on the site. A test covers a stale feed.
- Plausibility guard per page (the pattern of `assertPlausible` in `site/satcount.mjs`): for example quakes must have at least one event and magnitudes within -2 to 10, Kp within 0 to 9, a close approach distance above zero and below a stated maximum. A broken feed never publishes nonsense.
- No safety advice beyond what the source says. The earthquake page does not say "safe" or predict anything; the aurora page says the Kp-to-latitude rule only as far as `docs/hazard-sources.md` supports it; the storm page links to the NHC for official advisories and says the page is not a warning service.
- Same shell and house style as the count page (`renderPage`, structured data BreadcrumbList plus WebPage with `dateModified` = the data time, a visible FAQ without FAQPage markup, a sources section, canonical, robots, no hidden text, no em dashes or emoji). The first screen of each page has one chart or table that matters (hourly quake counts, the Kp bars, the approach table, the storm table).
- Each page links to the matching guide, the count page where relevant, the live app and the other live pages; the app's About sheet and `llms.txt` list them.
- Every page has at least one chart or table made by a pure function and tested on its own: a bar chart of Kp per three hours (colour not the only cue: values printed), a column chart of earthquakes per hour, a size band table, a map of the quake epicentres reusing `site/svgmap.mjs` with the app's coast data (points rounded and deduplicated), a storm track map likewise.

## 3. Content of each page

**Earthquakes today.** Counts for the last 24 hours (all, magnitude 2.5 and above, 4.5 and above, 6 and above); the largest event with place, magnitude, depth, time and the USGS link; a table of the ten largest; counts per hour for 24 hours; counts by region (the text after the last comma of the USGS place string is a place name, not a region: group by that string only for the ten most frequent and say they are the USGS place labels, never by guesswork); a map of epicentres; how the feed is built (USGS summary feed, automatic against reviewed status counted from the feed's `status` field). Caveats from `docs/feature-sources.md`: automatic solutions can change; counts depend on the feed's magnitude floor.

**Aurora tonight.** The latest Kp and the last 72 hours as bars; solar wind speed, density, total field and Bz now and their last-six-hour range from `spaceweather`; the aurora grid summary (maximum probability and the latitude band where it is at least 10 percent, from the feed's grid, per hemisphere), and a table "what Kp means for latitude" only if `docs/hazard-sources.md` records the source for the numbers, otherwise the page links to NOAA's own explanation and prints nothing it cannot cite. Bz sign convention explained from the source. No forecast of our own: the page says "observed" for what is observed.

**Asteroid close approaches.** From the feed: the objects with close approach in the feed's window, sorted by date; distance in lunar distances and kilometres, relative speed, the absolute magnitude H with the size estimate range only if `docs/feature-sources.md` records the formula and the albedo assumption, otherwise show H only and explain it; time uncertainty (`timeSigma`) shown as the feed gives it; the nearest, the fastest, the faintest. Definitions of lunar distance and AU from the feed's `ldKm`. A sentence that "close" is astronomical and a pass inside the Moon's distance is not a collision, only if the source record supports it.

**Tropical storms now.** For each active storm: name, basin, class (the feed's own text), wind in knots and km/h, pressure, position, movement, advisory number and issue time, link to the NHC page, the forecast track as a table and a small map; if there are no active storms, the page says so with the data time and lists the most recent GDACS tropical cyclone events from the `events` feed only if present; no storm is ever described as "safe to ignore".

## 4. Where the code goes

- `site/hazard.mjs` (pure): `summariseQuakes`, `summariseSpace`, `summariseApproaches`, `summariseStorms`, each with a freshness check and a guard, plus `HAZARD_PAGES` (slug, feed names, max age, title phrase).
- `site/pages-hazard.mjs`: the four page functions and the chart helpers (reuse `barChartSvg`, `columnChartSvg` from `site/pages-satcount.mjs` and `worldMapSvg` from `site/svgmap.mjs`).
- `site/livepages.mjs`: one registry of every live page path (count, hub, five countries, four hazard pages), used by `build-live.mjs`, the sitemap, the llms notes and the PHP-sync test.
- `site/build-live.mjs`: each page is built independently; a stale or failing feed skips only its page, prints which and why, and the previous copy stays; the manifest is read for every feed; `index.json` lists every file; the generator hash covers the new modules; rebuild when the page's own feed version changes (per page versions in `index.json`), not only the satellites version, so quake pages refresh every collection while the satellite pages stay as they are.
- `hosting/lib.php`: the four slugs are added to the allowed paths (`earthquakes-today`, `aurora-tonight`, `asteroid-close-approaches`, `tropical-storms-now`, each `<slug>/index.html`), still `\z`, plus tests and the list-sync test. The owner must copy `lib.php` to the server again.
- `site/build.mjs`: deploy-time snapshot copies from `public/` (the bundled snapshot has the same feed files) with their data time in the page, so a redeploy shows the snapshot until the next pull; nav and `llms.txt` entries.
- `e2e-site.mjs`: one raw check per page (status, canonical, robots, a number, the data time).
- Docs: `docs/hazard-pages-sources.md`, `docs/handoff.md`, `README.md`, `CLAUDE.md`.

## 5. Risks

| Risk | Handling |
| --- | --- |
| A page shows old data as if current | Data time in the lead, per-feed maximum age, a stale page is not published and the old one stays |
| One broken feed stops the others | Pages are built independently; the satellite pages are untouched |
| Many near-identical pages | Four different questions, four different data shapes; no per-city or per-country templated pages |
| An overstated safety or science claim | Every typed sentence traced to `docs/hazard-sources.md` or `docs/feature-sources.md`; unsourced statements are left out and the page links to the agency |
| Collector load or cadence | No new collection: pages only read what the collector already writes |
| Search value | NOT CONFIRMED: no ranking can be measured until Search Console has data |
