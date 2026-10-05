# Design: satellites by country (hub and five country pages)

Status: written on 2026-10-05 after the owner's standing goal "finish everything and deploy". The owner asked for this earlier ("these pages should have dynamic and useful data"); the design choices below are mine and are listed for the owner's review. Anything marked NOT CONFIRMED has not been checked.

## 1. What is built

One hub page and five country pages, all generated from the same collector feed as the satellite count page and refreshed on the same schedule (GitHub builds them into the data branch's `pages/` folder, `hosting/pull.php --pages-dest` copies them to the site).

| URL | Page |
| --- | --- |
| `/satellites-by-country/` | Hub: every owner in the catalogue ranked by active satellites, the concentration of the fleet, how to read it |
| `/satellites-by-country/united-states/` | Owner "United States" |
| `/satellites-by-country/china/` | Owner "People's Republic of China" |
| `/satellites-by-country/united-kingdom/` | Owner "United Kingdom" |
| `/satellites-by-country/cis-former-ussr/` | Owner "Commonwealth of Independent States (former USSR)" |
| `/satellites-by-country/japan/` | Owner "Japan" |

Why five and why these (from the bundled snapshot of 2026-10-04): only owners with at least 100 active satellites get a page: the United States 12,530, China 1,541, the United Kingdom 697, the CIS 381, Japan 134. The next owner has 112 but is "To Be Determined", which is not a place; Italy has 78. A competitor's country pages brought about 3% of its estimated visits, concentrated in a few pages (Ubersuggest estimates supplied by the owner), so thin pages for small fleets are not worth building. The list is fixed in code (`COUNTRY_PAGES`), not computed per run, so the set of URLs never changes between collections. A page is skipped, with a clear message, only if its owner is missing from the feed or has under 50 active satellites (a guard against a broken feed, not a content rule).

"Owner" is the catalogue's word. CelesTrak's owner field mixes countries and organisations, and the Russian fleet is recorded as "Commonwealth of Independent States (former USSR)". The pages say "as the catalogue records it" and never split or rename an owner.

## 2. Content of a country page (all from the feed, nothing typed in)

- Answer-first lead: "As of <date>, <time> UTC, the catalogue records N active satellites for <the page's phrase, such as the United States>, X percent of the catalogue's active satellites." (Changed in the review round on 2026-10-05: the page's own phrase, and "the catalogue's" because the total is our count, not the world's.) Our definition of active is the one in `docs/satcount-sources.md` (payloads with status operational, partial, backup, spare or extended).
- Table: this owner against the whole catalogue by orbit class (count and percent of its own fleet, against the catalogue's percent), using the shared `ORBIT_BOUNDS`.
- Purposes (top eight and "all others"), launch years (column chart), launched in the last 30 days, Starlink count and share of this owner's active satellites (shown when above zero).
- A static SVG map of where these satellites are at the build time. Positions come from each satellite's orbit elements with the same propagation the app uses for its swarm (`decodeSwarm` and `swarmPositionEcef` in `src/core.js`), so they are approximate; the caption says so and gives the time. Coastlines come from `public/coast.bin` (the app's own coast data). Plain equirectangular, no JavaScript, an `<svg>` with `role="img"`, a `<title>`, a `<desc>` and a visible text summary (the busiest 30 degree latitude band and the share of satellites inside it, computed).
- A visible link row to the hub, the count page and the other country pages; a "How this was counted" section; a visible FAQ (no FAQPage markup, the rich result is no longer shown); sources.
- Structured data: the shell's BreadcrumbList plus `WebPage` with `dateModified` (the build time). No Dataset markup.

## 3. Content of the hub

- Lead: the number of owners with at least one active satellite and the leader's share.
- Full ranked table of owners (rank, owner as recorded, active satellites, share of all active, Starlink count), with links on the five owners that have pages.
- Concentration paragraph computed from the numbers: the top owner's share, the top three's share.
- "How to read this" (owners are countries and organisations; the CIS code; "To Be Determined"), method, visible FAQ, sources.

## 4. Where the code goes

- `site/satcountry.mjs` (pure): `COUNTRY_PAGES`, `countOwners({meta, details, swarm}, { now })` returning per-owner aggregates for every owner (active, starlink, orbit counts, purposes, launch years, last30) in one pass, plus `ownerPositions(...)` returning `[lat, lon]` pairs for a named owner's active satellites.
- `site/svgmap.mjs` (pure): `worldMapSvg({ coast, points, id, title, desc })`, one `<path>` for the coastlines and one for the points.
- `site/pages-country.mjs`: `hubPage(...)`, `countryPage(...)`, the file names (`COUNTRY_FILES`) and `sitemapLive` updated to list every live URL.
- `site/build-live.mjs`: builds the hub and the pages beside the count page, `GENERATOR_FILES` gains the new modules, the sitemap lists all seven live URLs, `index.json` lists every file. `public/coast.bin` is read from the repository (the workflow checks the repository out).
- `site/build.mjs`: the deploy-time snapshot copy also writes the seven pages from `public/` (as it does for the count page), so a redeploy never 404s them.
- `hosting/lib.php`: `radar_safe_page_path` allows exactly: `how-many-satellites-in-orbit/index.html`, `sitemap-live.xml`, `satellites-by-country/index.html` and `satellites-by-country/<slug>/index.html` for exactly the five slugs `united-states`, `china`, `united-kingdom`, `cis-former-ussr` and `japan`, still with `\z`. (The first version allowed any lowercase slug; the review round on 2026-10-05 narrowed it to the five.) The slug list is defined once in JS (`COUNTRY_PAGES`) and a unit test reads `lib.php` to check the two lists match; adding a country page means changing both and re-copying `lib.php` to the server. Tests cover the new positives and negatives. **The owner must copy the new `lib.php` to the server again** (one paste, the same command as before).
- `site/llms.mjs` and the nav: the hub appears in `llms.txt` (a fixed note, like the count page) and in the nav as "By country".
- Docs: `docs/satcountry-sources.md` (what each number and the map rest on, and what is NOT CONFIRMED), `docs/handoff.md`, `README.md`, `CLAUDE.md`.

## 5. Truthfulness rules

- Every number is computed from the feed; no country fact is typed in. The only typed text is method and caveats, each checked against `docs/satcount-sources.md` and the code.
- No claim about why a fleet is large, who built a satellite, or what a satellite is for beyond the catalogue's purpose field.
- The CIS page never says "Russia". The Taiwan, Korea and other owners keep the catalogue's names on the hub.
- Map positions are labelled approximate and time-stamped. No accuracy figure is stated unless measured in the tests.

## 6. Not in scope

Per-organisation pages, a page per small country, a rolling history of counts, any change to the 3D app, comparisons across dates.

## 7. Risks

| Risk | Handling |
| --- | --- |
| Thin or near-duplicate country pages | Only five owners with real fleets; each page has its own numbers, comparison table and map; the generator test checks the pages differ in more than the owner name |
| Map file too large | One path for points rounded to 0.1 degree and deduplicated; a test asserts each page stays under 400 KB |
| A broken feed publishes nonsense | The existing `assertPlausible` runs first; the guard skips an owner with under 50 active satellites and the run reports it |
| The server keeps the old `lib.php` | The old script refuses the new paths and logs it; the count page keeps working. The handoff says to re-copy `lib.php` |

## 8. Changes after review (2026-10-05)

An independent review asked for these, and they are built:
- Titles of all seven live pages are 60 characters or fewer (country pages: "<short name> satellites: live count, <date>"; hub: "Satellites by country: live ranking, <date>"; count page: "How many satellites are in orbit? As of <date>") and descriptions 160 or fewer, tested on the longest date.
- The map's band and hemisphere sentences use only satellites at least 1 degree from the equator, and say how many sit within 1 degree (and how many of those are geostationary), because the approximate model cannot place them north or south.
- The shared method text is in one place, "How these numbers are made" on the hub (`#method`); each country page has a short, specific "How this was counted" and links there. The hub gained an orbit group table so the orbit definitions describe something it shows.
- Country pages gained name families (the first word of the catalogue name, OUR grouping, from names.txt), the names of active satellites launched in the last 30 days, and the oldest and newest active satellites by name. The FAQ is three questions chosen and answered from the owner's own numbers. A test measures the shared 8-word sequences between every pair of country pages (numbers and owner names made alike) and keeps it under half.
- The generator hash also covers `src/core.js`, `src/data.js` and `src/info.js`.
