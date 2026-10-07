# Satellites and debris by country: design

Written 2026-10-07 for branch `feature/country-objects`. Sources and what is NOT CONFIRMED: `docs/country-objects-sources.md`.

## 1. The request
A visitor searches a country and sees how many of its satellites are in orbit and how much debris, with details of the objects. The pages
must answer queries like "how many satellites does India have", "how much space debris does China have", "space debris by country", be
plain HTML a crawler reads, and stay fresh as data arrives.

## 2. Why a new feed
The satellites feed is CelesTrak's active list plus four debris clouds: about 2,700 debris objects, not the roughly 12,500 in Earth orbit.
Debris counts from it would be a large undercount. CelesTrak publishes the whole catalogue (SATCAT) as one CSV,
`https://celestrak.org/pub/satcat.csv` (6,764,885 bytes on 2026-10-07, Last-Modified 04:04:48 UTC). Its usage policy says "The SATCAT
updates manually once or twice a day", so it is read once a day.

## 3. Collector feed `satcat` (pipeline/satcat.py, pipeline/feeds.py)
- One request a day (`refresh_s` 86400, stale after 3 days), in the `celestrak` halt group: any non-200 answer halts every CelesTrak feed
  for `HALT_COOL_OFF_S` and tells a person, as the other CelesTrak feeds do. No conditional request (a 304 would count as non-200 under the
  halt rule). A pause of `PAUSE_S` before the request keeps it apart from the other CelesTrak requests of the same run.
- Unchanged: when the body's sha256 equals the last published one, the feed reports Unchanged and publishes nothing, so pages are not
  rebuilt for nothing.
- In Earth orbit (OURS, matches CelesTrak's own statistics table to the object on 2026-10-07): no DECAY_DATE, and ORBIT_CENTER is EA or a
  catalogue number (an object docked to a station). Not decayed but centred elsewhere (Moon, Sun, Mars, ...) is counted as `away`.
- Kinds: payload with status `+ P B S X` is active (the definition of `docs/satcount-sources.md`, statuses 1 to 5), any other payload is
  inactive; R/B, DEB and UNK as recorded.
- Guards (OURS): the header must have the 17 documented fields; at most 1 percent unreadable rows; 15,000 to 100,000 objects in Earth
  orbit; not more than 30 percent fewer than the last published count. A failure keeps the last good copy.
- Files (one version folder, as every feed):
  - `summary.json` (target under 60 KB): sourceTime (the CSV's Last-Modified), totals, payload status counts, the debris owner check
    (section 6), and per owner: code, name (CelesTrak's source table, via the catalogue feed), act, inact, rb, deb, unk, total, away,
    decayed, dec365 (decayed in the 365 days before the source time), new365 (launched in those days and still in orbit), noElements
    (data status NEA), file.
  - `o-<code>.json` for every owner with at least 10 objects in Earth orbit (OURS): every such object as a compact row
    `[id, name, intl, type, status, launch, period, incl, apogee, perigee, rcs, data]`. The largest (US) is about 1.4 MB before the
    server's compression; it is only fetched when a visitor asks for the full list.
- The runner, manifest schema and pull job are unchanged; the manifest gains one feed entry (additive).

## 4. Pages (site/objects.mjs, site/pages-objects.mjs, site/objects-js.mjs)
- New family `objects` in `site/livepages.mjs`, read and rendered through `site/liveregistry.mjs`, built by `site/build-live.mjs` after
  each collection like every family page. Feeds: `satcat` and `satellites`. A page is rebuilt when either version changes and is kept
  byte for byte otherwise.
- Freshest source per number: active satellites from the satellites feed (about every 2 hours, the same count as
  `/how-many-satellites-in-orbit/`, so the column adds up to that page's total); inactive satellites, rocket bodies, debris and unknown
  objects from the catalogue (about daily). Each page says both times. The catalogue's own active count is shown beside it with the
  difference, and the total in orbit is the sum of the parts shown (stated as such).
- dataTime (lead time, JSON-LD dateModified, sitemap lastmod) is the later of the two data times: it moves only when data moves.
- `/satellites-and-debris-by-country/` (new, top level): answer-first lead, "What this means", a ranked table of every owner (owner as
  recorded, code, active, inactive, rocket bodies, debris, unknown, total), each row a plain link where the owner has a page; a search box
  and sortable headers added by script (the full table is in the HTML); a stacked bar chart of the top ten; debris leaders; re-entries
  of the last 12 months; the debris owner check; method; FAQ; sources.
- Owner pages: `satellites-by-country/<slug>/` for the owners in `OWNER_PAGES` (`site/objects.mjs`), chosen on 2026-10-07 from the real
  catalogue: at least 30 objects in Earth orbit, "To Be Determined" left out (not an owner anyone looks for). That gives 24 owners. The
  five that already have country pages (United States, China, United Kingdom, CIS, Japan) keep their pages, which gain a section with
  the same content; the other 19 get new pages with new slugs that do not collide with the five. A page is skipped (previous copy kept)
  when its owner has fewer than 20 objects in a run (a guard against a broken feed, below the selection rule so the list does not flap).
- Each owner page: lead with the counts and the data time; type table with an "as of" column; orbit groups by kind (the `ORBIT_BOUNDS`
  of `site/satcount.mjs`, from perigee and apogee); objects by launch decade, satellites against the rest; the largest debris groups by
  launch with the payload of that launch; notable objects (oldest still in orbit, most recent launch, largest radar cross-section,
  highest apogee); two static tables (the 25 most recent launches, the 25 largest debris pieces by radar cross-section, then the rest by
  catalogue number); "Show all N objects", which fetches `o-<code>.json` of the same version and renders a paged, filterable table;
  what "debris of this owner" means; questions answered from the owner's own numbers; links to the owners ranked just above and below.
- The data version: the page carries the file's path (which holds the version) and its sourceTime; the script refuses a file whose
  sourceTime differs (a page from one version and a file from another) and asks the visitor to reload.
- No editorial claims: the pages never say who caused debris, never rename an owner, and say that the catalogue misses objects too
  small to track and is not exact.

## 5. Hosting
- `radar_safe_page_path` in `hosting/lib.php` gains the exact path of the ranking page and an exact alternation of the 19 new slugs. A unit
  test reads lib.php and checks the list equals `OWNER_PAGES`; `site/live-snapshot.mjs` keeps its copy of the pattern (a test checks they
  match). The owner must copy the new lib.php to the server once; until then the old file refuses the new paths, logs them, returns a
  non-zero exit code for the page part, and keeps copying every other page (tested in `hosting/tests/run.php`).
- The live data files need no change: `satcat/<version>/o-us.json` already matches `radar_safe_path`.

## 6. The debris owner check
SATCAT's owner of a debris piece is not "who caused it". The summary counts, for debris in orbit whose launch (the first 8 characters of
the international designator) also has a payload in the catalogue, how many carry the same owner as that payload. The ranking page states
the share; this is a measured fact about the data, not a rule of the catalogue.

## 7. Tests
Pipeline: parsing, kinds, Earth orbit rule, guards, unchanged, halt, sizes, fixture equality. JS: pure functions, page text rules (no em
dashes or emoji), titles and descriptions, links, similarity of owner pages, minimum content, two successive builds (changed data changes
pages and detail references together; unchanged data rewrites nothing), hosting whitelist. PHP: the new paths, the old file's refusal.
Browser (`e2e-country.mjs`): search, sort, Show all, paging, no console errors, no horizontal scroll at 360 px.
