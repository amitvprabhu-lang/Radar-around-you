# Sources for the sky pages: tonight's sky and ISS today

What every figure and typed statement on `/tonights-sky/`, the six city pages `/tonights-sky/<city>/` (pune, newyork, london, tromso, tokyo, sydney) and `/iss-today/` rests on, what was checked against what, and what was not. Written on 2026-10-06 from the code, the collector (`pipeline/config.py`, `pipeline/feeds.py`, `pipeline/validate.py`, `pipeline/pack.py`), the real collector output on the `data` branch (read with `git show origin/data:...`: clouds read at 01:30 UTC on 2026-10-06, satellites at 00:01 UTC, saved as `test/fixtures/sky/`), and the source records already in this repository. No outside page was read for this record and no web search was made: every term below is quoted from a record already in the repository, which names when its page was read. Anything marked NOT CONFIRMED has not been checked. Design: `docs/superpowers/specs/2026-10-06-more-live-pages-design.md` (sections 1, 2, 3, 6, 7 and 8). Code: `site/sky.mjs` (summaries, freshness, guards, findings), `site/pages-sky.mjs` (pages and figures).

## One row per input

| Input | Source | What the pages use | Terms as recorded (quoted from the existing record) | Terms verified | Limit and why |
| --- | --- | --- | --- | --- | --- |
| `clouds` feed, `clouds.json` | MET Norway Locationforecast 2.0 compact (`pipeline/config.py`, `clouds`), one request per city | per city `updated` (MET's `updated_at`, the page's data time) and `hours[]` `{ t, cloud }` (cloud is "total cloud cover for all heights", unit %, `docs/feature-sources.md`, MET data model); `temp` is not used | `docs/feature-sources.md`, section on MET Norway: "Licence: NLOD 2.0 and CC BY 4.0. Credit "The Norwegian Meteorological Institute, shortened MET Norway"". `pipeline/config.py`: "Attribution required as in CC BY 4.0". `docs/launch-licences.md` repeats both. | yes (as recorded in `docs/feature-sources.md`; the licence page itself was not re-read for this record) | 6 hours from `updated` (the design's value). The collector reads it hourly and MET asks not to repeat before its Expires header (about 30 minutes). A stale or missing city skips only that city's page; the hub shows it as not updated. |
| `satellites` feed, `precise.json` and `satmeta.json` | CelesTrak GP data, packed by `pipeline/pack.py` | the ISS row (NORAD 25544: `epoch`, `n`, `e`, `i`, `raan`, `argp`, `ma`, `bstar`, `ndot`, `nddot`) and `satmeta.taken` (the satellite data time, the time the count page shows) | `docs/satcount-sources.md`, CelesTrak usage policy section; the collector's record (`pipeline/config.py`): "Usage policy page read; it asks users to follow it and to cache. No licence text on that page." | no (no licence is recorded; no Dataset markup) | Satellite data 30 hours (the design's value: CelesTrak's rules pause the feed for hours). ISS element set 7 days (the design's value); older, the city pages leave the passes out with the reason and the ISS page is skipped. On 2026-10-06 the ISS element set was from 2026-10-05 11:57 UTC, 12.1 hours old at the data time. |
| astronomy-engine (npm, MIT) | `node_modules/astronomy-engine` | Sun and Moon rise and set (`SearchRiseSet`), Moon phase angle and lit fraction (`MoonPhase`, `Illumination`), planet positions, magnitudes and constellations (`Equator`, `Horizon` with normal refraction, `Illumination`, `Constellation`) | `docs/feature-sources.md`: README "Accuracy always within 1 arcminute of results from NOVAS"; MIT licence (`site/pages-data.mjs`, `ENGINE`). | yes (MIT) | none |
| satellite.js (npm) | `node_modules/satellite.js` through `src/sgp4.js` | SGP4 positions of the ISS | `docs/feature-sources.md`, section 3 ("SGP4 from satellite.js on OMM records") | NOT CONFIRMED: its licence is not quoted in a record in `docs/` | none |
| Star catalogue `public/stars.bin` | the app's Hipparcos-based catalogue (`docs/feature-sources.md`, section 8) | stars brighter than magnitude 3.5 above the horizon, for the polar chart | `docs/launch-licences.md`: described as Hipparcos-based with a non-commercial licence; "which licence applies to this exact file is NOT CONFIRMED". | no | The site shows no ads; the same caveat as the app (`docs/launch-licences.md`). |
| Star names `public/starnames.json` | IAU Catalog of Star Names (IAU-CSN) | names of the stars on the chart and in its table | the file's own `licence` field: "IAU products are released under Creative Commons Attribution (statement in the file's header)" | yes (as recorded in the file) | none |
| Constellations `public/constellations.json` | IAU names and boundaries; stick figures from d3-celestial | names, centres and figures for the chart and the constellation table | `docs/hazard-sources.md`: the figures' "data licence is not stated", credited to the project | names yes; figures no | none |
| Places `public/places.json` | GeoNames cities15000 | the nearest place within 300 km of the ISS position and of the track ahead | `docs/hazard-sources.md`, GeoNames section: CC BY 4.0 | yes | 300 km (`PLACE_MAX_KM`, shared with the fire page) |
| Coastlines `public/coast.bin` | Natural Earth 1:50m via world-atlas (`docs/satcountry-sources.md`) | the ISS map | `docs/satcountry-sources.md`: "NOT CONFIRMED: the licence of the Natural Earth data and of the world-atlas package was not re-read" | NOT CONFIRMED | none |
| Cities `public/cities.json` | the app's six cities (`pipeline/config.py`) | names, coordinates and time zones | ours | n/a | none |
| USNO tables `test/fixtures/usno/` | U.S. Naval Observatory Astronomical Applications API, saved earlier for `site/verify.mjs` | only the tests compare with them; nothing on the pages is copied from them | see `site/pages-data.mjs` (`USNO`) | n/a | none |

## What was checked against what (tests in `test/sky.test.js`, run on 2026-10-06)

| What | Checked against | Result |
| --- | --- | --- |
| Sunset and sunrise that start and end the night (`nightWindow`) | USNO rise and set tables for the six cities on 2026-06-21 and 2026-12-21 (`rstt-*.json`): 20 times (Tromsø has none on either date) | all within 1 minute (`RISE_SET_CHECK_MINUTES`); worst 0.50 minutes. USNO prints whole minutes, so up to half a minute is rounding. |
| The midnight Sun and the polar night in Tromsø | USNO: "Object continuously above the Horizon" on 2026-06-21, "continuously below" on 2026-12-21 | `nightWindow` gives `midnightSun` and `polarNight`; the pages say "the Sun does not set" and "does not rise" in words |
| Day length at the equator (latitude 0, longitude 0) on the March 2026 equinox (USNO: 20 March 14:46 UTC) | A derivation, not a table: with the declination near 0, cos H = sin(50 arcminutes), so the day is 12 h 06.7 min. The 50 arcminutes (refraction plus the Sun's half width) is the textbook convention, written from memory and NOT CONFIRMED from a page in the repository; the USNO comparison above is the evidence that the rise and set convention matches USNO's. | within 1 minute |
| Moonrise and moonset (`moonTonight`, `riseSetBetween`) | USNO tables, same 12 place-dates: 22 times; Tromsø's Moon "continuously above the Horizon" on 2026-12-21 | all within 1 minute, worst 0.51 minutes; no event and "up all night" for Tromsø in December |
| The Moon's lit percent | USNO `fracillum` for the 12 place-dates | equal to the whole percent when computed for 12:00 UTC of the date (46 and 90 percent). That USNO computes it for noon of the requested time zone (here UTC) is our inference from the match, NOT CONFIRMED from USNO's documentation. |
| The Moon's phase name | USNO `curphase`, and USNO's 2026 phase list (50 phases) | December dates: both "waxing gibbous". June dates (46 percent lit): the app's names (`moonPhaseName` in `src/info.js`) say "First quarter", USNO "Waxing Crescent". This is a difference of convention: the app names each principal phase for a 22.5 degree band around its moment; the pages keep the app's names. At each of the 50 listed phases the app's name matches, the full Moon is 99 percent lit or more, the new Moon 1 percent or less, the quarters 48 to 52 percent. |
| Planet altitudes | `raDecToAltAz` in `src/core.js` against astronomy-engine's own horizon conversion, for the five planets at the six cities | within 0.1 degree. This checks the conversion only, not the planets' positions. |
| Mercury and Venus elongation | the textbook maxima (about 28 and 47 degrees; from memory, NOT CONFIRMED from a page in the repository) | never exceeded over 2026 and 2027 |
| The ISS orbit | the element set itself: period 1440 / mean motion = 92.98 minutes; the track reaches 51.8 degrees, close to the inclination 51.63 | as expected; height 418 to 435 km |
| No ISS pass over Tromsø | geometry (`footprintRadiusKm` in `src/core.js`): from 440 km up, a satellite 10 degrees above the horizon is at most about 1,400 km away on the ground; Tromsø is further than that from latitude 51.9 | no pass at 10 degrees or more is found, as the geometry requires |
| The highest point of each ISS pass | the spherical `lookAngle` in `src/core.js` from the SGP4 position | within 1 degree for every pass over the six cities in 24 hours |
| The ground track | antimeridian split | no segment jumps more than 180 degrees of longitude; the track moves 23.3 degrees west per orbit |
| The best window | `hourSample` and `bestWindow` of the app (the page uses the same functions) | identical scores and window; the window's ends are kept inside the night |

## What was NOT checked
- Planet rise, set and position times against an independent ephemeris or almanac. The library's own accuracy statement is the only basis (README, as recorded above).
- ISS pass times against an independent predictor or an observation, and how far they drift as the element set ages. The pages say pass times are approximate and show the element set's age.
- The polar chart's star positions: they are drawn from the catalogue's fixed positions with no correction for precession (how many years that is depends on the catalogue epoch, which is NOT CONFIRMED for `stars.bin`); a chart, not a measurement.
- The cloud forecast's accuracy: it is MET Norway's forecast and the pages say so.
- The viewing score: the app's own heuristic (`scoreHour` in `src/core.js`), not a measure of seeing or transparency; the pages call it a score and never a promise.

## Typed statements and where they come from
| Statement | Source |
| --- | --- |
| The night starts at the first sunset after the forecast time, or at the forecast time when the Sun has already set, and ends at the next sunrise; the polar cases | The design, section 2; `nightWindow` in `site/sky.mjs` |
| The viewing score from 0 to 100: zero while the Sun is less than 6 degrees below the horizon, more as the sky darkens to 18 below, less for a bright Moon that is up, scaled by the clear share of the sky; the best window is the run of consecutive hours scoring 45 or more with the highest total | `scoreHour` and `bestWindow` in `src/core.js` (read from the code) |
| A planet is well placed when at least 15 degrees up in a dark sky (the Sun more than 6 degrees down) at magnitude 3 or brighter | `src/tonight.js`, the Tonight screen's planet rule |
| Lower magnitude numbers are brighter | the standard magnitude scale; the planets guide uses magnitudes the same way (`site/pages-data.mjs`) |
| A pass is listed at 10 degrees or more and is sunlit in a dark sky when sunlit while the Sun is more than 6 degrees down | `docs/feature-sources.md`, section 3 (`findPasses`, `visiblePart`) |
| MET Norway credit and licences | `docs/feature-sources.md`, MET Norway section; `docs/launch-licences.md` |
| Cloud is total cloud cover for all heights | `docs/feature-sources.md`, MET data model |
| astronomy-engine's accuracy statement | `docs/feature-sources.md` ("Accuracy always within 1 arcminute of results from NOVAS") |
| SGP4 with satellite.js from CelesTrak's element set, the same code as the live app | `src/sgp4.js`, `docs/feature-sources.md` section 3 |
| The tests' 1 minute agreement with USNO | `RISE_SET_CHECK_MINUTES` in `site/sky.mjs`, enforced by `test/sky.test.js`, printed from the same constant |
| Heights above the WGS84 ellipsoid | `ecefToGeodetic` in `src/core.js` |
| "About the same" within 15 percent | `ABOUT_SAME` in `site/sky.mjs` (the design, section 8.2) |
| The stick figures are from d3-celestial; star names from IAU-CSN | `public/constellations.json` and `public/starnames.json` (their `credit` fields) |
| The live globe is the real-time view | the app (`src/main.js` draws the ISS live) |

## Our own choices (OURS)
- Maximum ages: clouds 6 hours, satellite data 30 hours, ISS element set 7 days (the design's values).
- Guards: a city's forecast needs a parseable `updated` no more than an hour ahead, at least 24 hours, strictly increasing times and cloud from 0 to 100; the ISS element set must give a height of 300 to 500 km at its epoch and must not be dated more than a day ahead.
- The chart time is local midnight when it falls in the night, otherwise the middle of the night; stars brighter than magnitude 3.5, labels for named stars of magnitude 1.5 or brighter, figures for up to 12 constellations whose centre is at least 20 degrees up and whose brightest star is magnitude 2.5 or brighter.
- Under the midnight Sun the page uses the 12 hours around local midnight for the Moon, planets and cloud, and says nothing in them is dark; in the polar night it covers the 24 hours from the start.
- The best window's ends are clipped to the night (the app's window is whole hours).
- The ISS page's passes are for the 24 hours after the satellite data time; the city pages' passes for the night window.
