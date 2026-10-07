# Sources for the satellites and debris by country pages

What every figure on `/satellites-and-debris-by-country/`, the 19 owner pages under `/satellites-by-country/<slug>/` and the objects
section of the five country pages rests on. Written 2026-10-07 on branch `feature/country-objects`. Design:
`docs/superpowers/specs/2026-10-07-country-objects-design.md`. The definitions shared with the satellite count page (active, orbit groups,
the CelesTrak usage policy) are in `docs/satcount-sources.md`. Anything marked NOT CONFIRMED has not been checked.

## What was read, and when (2026-10-07)
- CelesTrak SATCAT format, https://celestrak.org/satcat/satcat-format.php: the 17 CSV fields the collector reads (OBJECT_NAME, OBJECT_ID,
  NORAD_CAT_ID, OBJECT_TYPE PAY/R/B/DEB/UNK, OPS_STATUS_CODE, OWNER, LAUNCH_DATE, LAUNCH_SITE, DECAY_DATE, PERIOD minutes, INCLINATION
  degrees, APOGEE and PERIGEE km, RCS square metres, DATA_STATUS_CODE NCE/NIE/NEA, ORBIT_CENTER EA/MO/SU/MA and others or the catalogue number
  of the object it is docked to, ORBIT_TYPE ORB/LAN/IMP/DOC/R/T). The page says nothing about update frequency, licence or redistribution.
- CelesTrak SATCAT page, https://celestrak.org/satcat/: offers the raw data as `/pub/satcat.csv` and `/pub/satcat.txt`, and a statistics
  table for Earth orbit "as of October 7, 2026" (quoted below).
- CelesTrak usage policy, https://celestrak.org/usage-policy.php: "The SATCAT updates manually once or twice a day"; download data "once per
  update"; M2M software "should immediately stop querying when it receives any non-HTTP 200 responses and report the results to a human".
  It does not address republishing, credit, licence, user agents or conditional requests.
- CelesTrak source codes, https://celestrak.org/satcat/sources.php: code and description pairs, no definition of what an owner code means
  and no rule for debris. One description holds a line break ("European Organization for the<br>Exploitation of ..."), which the collector
  used to turn into "theExploitation"; `pipeline/catalogue.py` now reads a line break as a space (test in `pipeline/tests/test_satcat.py`).
- CelesTrak boxscore, https://celestrak.org/satcat/boxscore.php: per owner, payloads and "debris" on orbit, decayed and total.
- NASA Orbital Debris Program Office FAQ, https://orbitaldebris.jsc.nasa.gov/faq/: "Large orbital debris (> 10 cm) is tracked routinely by
  the U.S. Space Surveillance Network", and about 500,000 particles of 1 to 10 cm are estimated (not catalogued). The pages quote the first
  sentence, attributed. ESA's "Space debris by the numbers" page could not be read (the request returned no article text).
- The CSV itself: downloaded once on 2026-10-07 05:02 UTC for this check (6,764,885 bytes, Last-Modified Wed, 07 Oct 2026 04:04:48 GMT,
  70,953 rows, plain CRLF CSV, no quoting, served without compression). It is not in the repository.

## What each figure rests on
- **In Earth orbit** (OURS): no DECAY_DATE, and ORBIT_CENTER is EA or a catalogue number (an object docked to a station; 16 such objects on
  2026-10-07, all docked to 25544, the ISS, or 48274, the Chinese station, or one to 28358). Not decayed but centred elsewhere is counted
  separately as `away` (302 objects on 2026-10-07: SU, MO, EM, MA, EL1, EL2, SS, VE, JU) and named on the page by its centre code.
- **Kinds**: a payload with status `+ P B S X` is an active satellite (the count page's definition, statuses 1 to 5); any other payload,
  including no status, is inactive; R/B, DEB and UNK are the catalogue's types, shown as rocket bodies, debris and unknown.
- **Owner**: the catalogue's OWNER code, named with the source code table the catalogue feed already downloads. The pages never rename or
  merge owners. "To Be Determined" is an owner code, not a place, and has no page.
- **What a debris owner means**: SATCAT does not say. Measured on 2026-10-07: every one of the 12,527 debris objects in Earth orbit has a
  payload of the same launch (the first 8 characters of the international designator) somewhere in the catalogue, and 11,701 of them
  (93.4 percent) carry the same owner as a payload of that launch. The pages state this share (recomputed every day as
  `debrisOwnerCheck`) and say the owner records where a piece came from, not who or what broke it up. They make no claim about causes.
- **Re-entries and launches of the last 12 months**: DECAY_DATE and LAUNCH_DATE on or after the source time minus 365 days.
- **No public orbit data**: DATA_STATUS_CODE NEA. 801 objects in Earth orbit on 2026-10-07, the same number as the "Restricted" column of
  CelesTrak's statistics table; that NEA is what CelesTrak calls restricted is NOT CONFIRMED (only the totals match).
- **Orbit groups on owner pages**: perigee and apogee from the catalogue; eccentricity = (apogee - perigee) / (2a) with a = Earth radius
  (`SWARM_EARTH_RADIUS_KM`, as the count page) + the mean height; then `ORBIT_BOUNDS` of `site/satcount.mjs`. Objects without heights are
  counted as "No heights in the catalogue". The count page derives the same groups from mean motion; the two can differ for an object
  near a boundary (NOT CONFIRMED by how much).
- **Largest debris groups**: debris grouped by launch; "most common name" is the most frequent OBJECT_NAME in the group; the satellites
  listed are those of the same launch still in orbit under the same owner (a decayed or another owner's payload is not listed).
- **Notable objects**: oldest launch date still in orbit, newest launch, largest RCS, highest apogee, from the owner's own rows.
- **Static tables** (OURS): an owner with at most 60 objects has every object in the page; otherwise the 25 most recently launched
  satellites and the 25 largest pieces of debris by RCS (rocket bodies when there is no debris; 50 satellites when there is neither),
  objects without an RCS last. 20,697 of the objects not decayed have no RCS in the CSV on 2026-10-07, so the size order covers only the
  rest. Everything else is in the owner's detail file, which the "Show all" button loads.

## Freshness: which number moves when
| Number | Source | Refresh |
| --- | --- | --- |
| Active satellites in the orbit data (headline of the count page; "orbit data" lines here) | satellites feed (CelesTrak GP active list) | collector every 2 hours (GP updates every 2 hours, usage policy) |
| Active and inactive satellites, rocket bodies, debris, unknown, totals, re-entries, every object row | satcat feed (`/pub/satcat.csv`) | collector once a day; CelesTrak updates it "once or twice a day", so these move daily, not every 10 minutes (the pages say so) |
| Owner names | catalogue feed (source code table) | once a day |

The pages are rebuilt by `site/build-live.mjs` when either feed has a new version and keep their bytes otherwise; the lead time, JSON-LD
dateModified and sitemap lastmod are the later of the two data times, never the build time. So an owner page changes when the satellites
feed changes (its "orbit data" time and number), about every 2 hours, and IndexNow is asked about it at most once in 6 hours
(`RADAR_INDEXNOW_EVERY`). A catalogue more than 72 hours old (`OBJECTS_MAX_AGE_HOURS`, the feed's staleAfterSec) skips the ranking and the
owner pages (their previous copy stays) and the country pages are rebuilt without the section, with a printed warning. Satellite data more
than 30 hours old (`FAST_MAX_AGE_HOURS`) is left out of the "orbit data" lines.

## Accuracy checks (2026-10-07, real data)
- **Against CelesTrak's own statistics** (the SATCAT page, Earth orbit, "Total" column): Active 17,193, Dead 2,908, Rocket Bodies 2,299,
  Debris 12,527, Unknown 55, All 34,982. Our counts from the CSV of 04:04:48 UTC: active 17,193, inactive 2,908, rocket bodies 2,299, debris
  12,527, unknown 55, total 34,982. Identical. (The table also splits each row into Tracked, Restricted and Lost; we do not use that split.)
- **Against CelesTrak's boxscore** (not decayed, any orbit centre; its "debris" column is rocket bodies, debris and unknown together):
  payloads / debris / all on orbit: US 13,855 / 4,680 / 18,535; PRC 1,632 / 4,537 / 6,169; CIS 1,712 / 4,955 / 6,667; UK 724 / 1 / 725;
  JPN 248 / 90 / 338; IND 122 / 78 / 200; FR 129 / 517 / 646; ESA 114 / 19 / 133. Our counts from the same CSV, with the same rules,
  are identical for all eight. All owners: 20,265 payloads, 15,019 debris, 35,284 on orbit, also identical (35,284 = 34,982 in Earth
  orbit + 302 away).
- **Against the satellites feed** (`site/satcountry.mjs` counts, the published data of 2026-10-07, satmeta taken 04:20:22 UTC, 16 minutes
  after the CSV): 16,614 active in the orbit data against 17,193 active in the catalogue, 579 fewer. Of those 579: 460 have DATA_STATUS_CODE
  NEA (no public orbit data, so they cannot be in a feed built from orbits); 72 are in the satellites feed but typed unknown with no status,
  because the satellites feed joins its orbits to the catalogue feed's copy of 2026-10-06 08:30 UTC, which did not know them yet; 47 are not
  in the satellites feed at all (not in CelesTrak's GP active list, or dropped by `pipeline/pack.py` for an element set older than 90 days;
  which of the two is NOT CONFIRMED). No satellite was active in the orbit data but not in the catalogue. Per owner the orbit data is lower
  for 18 owners: US by 455, TBD 69, JPN 15, FR 6, GER 6, SING 6, PRC 5, ISRA 4, IT 3, CIS 2 and by 1 for UK, IND, ESA, CA, SES, INDO, SVN,
  FRIT. The pages show the catalogue's count in every table (so rows add up and match CelesTrak's totals) and the orbit data's count
  beside it with its own time and the difference; the ranking page explains the difference with these computed numbers.
- **Top 10 owners by objects in Earth orbit** (catalogue of 2026-10-07 04:04 UTC; active / inactive / rocket bodies / debris / unknown /
  total): US 12,973 / 805 / 682 / 3,895 / 1 / 18,356; CIS 383 / 1,293 / 1,038 / 3,894 / 7 / 6,615; PRC 1,543 / 75 / 281 / 4,225 / 26 / 6,150;
  UK 698 / 26 / 1 / 0 / 0 / 725; FR 76 / 53 / 160 / 350 / 1 / 640; JPN 149 / 87 / 46 / 35 / 1 / 318; TBD 181 / 16 / 0 / 0 / 17 / 214;
  IND 78 / 40 / 42 / 36 / 0 / 196; ITSO 36 / 64 / 0 / 49 / 0 / 149; ESA 69 / 30 / 8 / 11 / 0 / 118.
- **The owner pages chosen** (at least 30 objects in Earth orbit, not TBD; 25 owners met the rule, 24 with TBD left out): US, CIS, PRC,
  UK, JPN (the five country pages) and FR 640, IND 196, ITSO 149, ESA 118, GER 98, IT 95, GLOB 85, CA 81, SKOR 72, SES 68, ORB 66, SPN 63,
  EUTE 62, TURK 44, AUS 43, ROC 35, SEAL 34, ARGN 33, O3B 33. Next below the rule: FIN 28, NOR 28.

## Sizes (2026-10-07, real data)
- `summary.json` 24,799 bytes (130 owners, 106 with objects in Earth orbit); 50 owner files (`o-<code>.json`, owners with 10 or more objects
  in Earth orbit); the whole version 3,067,192 bytes. Largest: `o-us.json` 1,590,200 bytes (276,846 gzipped), `o-cis.json` 577,550,
  `o-prc.json` 529,814. Git stores them compressed, so the data branch grows by roughly the gzipped size per kept version (the collector
  keeps 3 versions of each feed); the pull job fetches a new version once a day.
- Built pages: ranking 64,504 bytes, United States country page 264,951 (was about 240 KB), owner pages 35 to 45 KB.

## How alike the owner pages are
`test/objects.test.js` measures shared 8-word sequences between the 19 new owner pages (main content, numbers made "n", every owner name and
phrase made "owner", the measure of `test/pages-country.test.js`). On the fixture (2026-10-07): worst Jaccard 46.3 percent and worst
containment 66.0 percent (SES and EUTELSAT, two owners whose objects are all geostationary satellites); the test limits are 50 percent and
71 percent. On the real catalogue of the same day: worst Jaccard 39.7 percent (SES and EUTELSAT), worst containment 60.2 percent (India and
ESA). The remaining overlap is the page layout, the table headings and the sentence frames around the numbers; object names that contain
the owner's name ("SES-4", "EUTELSAT 5") count as shared after the normalisation, so the measure is on the strict side.

## NOT CONFIRMED
- **Republishing terms.** Neither the SATCAT pages nor the usage policy grant or refuse republishing counts or per-object details. The
  catalogue originates with the U.S. Space Force (the SATCAT page names 18 SDS); whether Space-Track's user agreement or CelesTrak's
  practice limits republishing per-object rows (name, designator, dates, heights, RCS) is NOT CONFIRMED. These pages publish per-object
  rows on the owner's instruction. Asking CelesTrak (and checking Space-Track's terms) is the open action; until then no Dataset markup is
  used (as for the other live pages, `site/liveseo.mjs`).
- **What the owner code means** for an object (operator, registering state, launching state); SATCAT's pages do not define it. The pages
  say "as the catalogue records it".
- **What a debris owner means**: only the measured share above; no CelesTrak rule was found.
- **Completeness of the public catalogue**: classified objects that are left out entirely, and how CelesTrak's Tracked, Restricted and
  Lost split is made, are not documented on the pages read.
- **CelesTrak's update time**: the source time is the CSV's Last-Modified header; that it is the catalogue's own update time (and not, say,
  a copy time) is NOT CONFIRMED, though it matched the "current as of" time on the SATCAT page on 2026-10-07.
- **Whether the server compresses the JSON detail files** (Hostinger) when the browser loads them: not checked.
- **Rankings**: whether these pages will rank for the target queries is unknown.
