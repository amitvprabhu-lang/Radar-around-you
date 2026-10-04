# Feature sources for Radar Around You

Research date: 4 October 2026. Written for the owner of the project, to answer two questions for every feature:

- A. Which other sources could improve or back up the feature?
- B. Which authoritative references let a person check the facts, constants and tables the feature uses today?

## How to read this file

- A URL is listed only if I opened it in this session and it loaded. Pages that failed are in the last section, "Could not verify".
- For each source I record only what the page said about licence, terms, limits, cost, attribution and update frequency. If the page did not say, the text is "not stated on the page I opened".
- The fetch tool returns a short model-written summary of a page, not the raw page. The quotes below are as the tool returned them. Re-read the page before you quote it in public.
- Where the fetch tool failed but the site answered a direct download, I read the raw file instead and say so. This applies to the IMO 2027 calendar PDF (read after the IMO site showed a maintenance page), the NOAA aurora JSON, the USNO and JPL Horizons API answers, and the Wikipedia source text for the aircraft table.
- Figures I am not sure of are marked "approximately" and need checking against the primary source.
- Prices, limits and terms change. Anything here may have changed since my knowledge cutoff and since the day I opened the page.
- Verdict words for our own values: MATCHES, DIFFERS, COULD NOT CONFIRM.
- Numbers labelled "my check" come from small scripts I ran against the project code (read only) and a public source. The scripts are not in the repository.

## Summary

Differences found in our own tables and comments (item 1 was corrected in `src/tonight.js` on 4 Oct 2026 after I re-read Table 5 of the IMO PDF myself; the "ours" columns below describe the table as it was before that fix):

1. `SHOWERS` in `src/tonight.js`. Southern Taurids DIFFER from the IMO working list on every field (peak, rate, radiant, start of activity). Draconids and Perseids rates differ. Seven peak dates are one day earlier than the IMO 2027 table, which the IMO says is accurate only for 2027. Ursids, Northern Taurids and Alpha Capricornids are not in our table.
2. `LAUNCH_SITES` in `src/core.js`. 21 of 22 pins are within about 13 km of every source value I found. Dombarovsky (`DLS`) is 7 to 39 km from the source points, because the sources disagree. The land site `SMTS` (Shahrud) has no entry.
3. `AIRCRAFT_NAMES` in `src/info.js`. 53 of 55 names agree with the Wikipedia list of type designators. `CRJ7` is listed there as "Canadair Regional Jet 550", ours says CRJ-700. `C172` is not covered by that list. `B77L` also covers the 777 freighter, which our label would call a 777-200LR.
4. `src/core.js` comment on the Sun formula says "good to about 0.01 deg". The USNO page for the same kind of formula says "about 1 arcminute" (approximately 0.017 deg). My check against astronomy-engine gave 0.005 deg, so the comment is plausible but not what the USNO states.
5. Wave model. The constants P 8.0 and S 4.5 km/s are upper-mantle values, which is consistent with the sources. The straight-line constant-speed travel times are not close to a real Earth model: for 57.4 degrees and a 200 km deep source, the TauP documentation (PREM) gives P 566.77 s and S 1028.61 s, our model gives about 753 s and 1339 s (about 33 percent and about 30 percent slower, my check).
6. Crust thickness of 35 km is a continental figure. The page I opened says oceanic crust is 5 to 10 km.
7. Aurora. The NOAA grid is a short-lead forecast (the page ties the lead time to solar wind travel from L1), but `buildTonight` applies one grid to the whole night.
8. Route lookups. `api.adsb.lol/api/0/route/<callsign>` answered with a redirect to a static file whose URL ends in `#deprecated`.
9. Rules of the sources that affect the design: MET Norway says browsers should not call its API directly. CelesTrak refreshes GP data every 2 hours. SWPC pages have moved to spaceweather.gov. CelesTrak ran out of 5-digit catalogue numbers on 2026-07-11.

Things that MATCH: the -6 degree twilight rule, Moon phases and rise and set, planet positions and magnitudes (one Saturn exception of about 0.13), Sun altitude, sidereal time, the NOAA aurora grid shape, SATCAT status codes and object types, Earth radius, core boundary depths, galactic pole constants (one 0.0012 degree difference).

Top 5 additions for about 500 rupees a month (reasons in the ranking section):

1. A small relay and cache (Cloudflare Worker with a cron trigger).
2. CelesTrak Supplemental GP for Starlink, ISS and the Chinese station, and grouping trains by launch designator.
3. Refresh `SHOWERS` from the IMO working list.
4. Real light-pollution data (VIIRS annual nighttime lights or the published world atlas) in place of the 2k texture average.
5. More hazard sources behind the relay: NASA FIRMS, NHC storm feeds, NASA EONET.

## Source terms that would stop, or may stop, a free public website

Based only on what the opened pages say.

| Source | What the page says | Effect |
|---|---|---|
| RainViewer API | "This API is available for personal and educational use only." | Likely blocks a public site unless they agree. |
| FlightAware AeroAPI | Personal tier allows distribution of derivative works "for personal or academic purposes only". Standard tier is "$100/month" minimum. | Personal tier does not fit a public site. Standard is far over budget. |
| ADS-B Exchange | Enterprise products need "minimum annual commitments". A "low-cost API" for "personal and non-commercial use" exists, price not stated. | Enterprise is out. Community API unclear. |
| Open-Meteo free tier | "You may only use the free API services for non-commercial purposes." 600 per minute, 5,000 per hour, under 10,000 per day. Commercial use needs a paid plan. Plan prices not stated on the page I opened. | Fine for a free site with no ads or sales, if cached. Becomes a problem if the site earns money. |
| 7Timer | Free to use or redistribute "as long as you are not using them for commercial purpose". | Same as above. |
| ESA Hipparcos and Tycho | "CC BY-NC 3.0 IGO" and "Credit: ESA". | Non-commercial only. Adding ads or a paid tier would conflict. |
| MET Norway | Mobile apps and browsers "should not contact the API directly, but instead use a local proxy". 20 requests per second per application. Identifying User-Agent, or Origin or Referer. | Direct browser calls from the public site are against the stated terms. Use the relay. |
| EMSC SeismicPortal | Data are CC BY 4.0, but "Commercial reproduction or transmission... requires prior written permission". | Fine for free and non-commercial use with credit. Ask before any commercial step. |
| OpenStreetMap Nominatim | Maximum 1 request per second, results must be cached, no heavy use. | Fine for a few lookups, not for per-visitor geocoding. |
| Space-Track | Account needed. 30 requests per minute and 300 per hour. Redistribution of basic SSA data is approved "conditioned on appropriate citation". | Usable behind the relay, never from the browser. |
| N2YO API | Key required. Transaction limits by type (TLE 1,000, positions 1,000, visual passes 100, radio passes 100, above 100). Time window not stated. API terms not stated. | Keep the key off the browser. Cross-check only. |
| Launch Library 2 | "15 non-authenticated requests per hour". | Needs the relay and a cache. |

Could not tell from any page I could open: airplanes.live, OpenSky terms, Heavens-Above reuse terms, Smithsonian GVP terms, IMO terms of use.

---

## 1. Will I see it tonight (`src/tonight.js`, `src/plan.js`)

### What it uses now

- Dark window: Sun more than 6 degrees below the horizon, found from our own low-precision Sun formula.
- Hourly cloud: MET Norway Locationforecast, field `cloud_area_fraction`.
- Moon phase and planets: astronomy-engine.
- Aurora chance: NOAA SWPC OVATION grid, plus the Kp forecast.
- Meteor showers: hard-coded `SHOWERS`, shown within 3 days of the peak (an editorial rule).

Primary pages opened:
[MET Norway Locationforecast documentation](https://api.met.no/weatherapi/locationforecast/2.0/documentation),
[MET terms of service](https://api.met.no/doc/TermsOfService),
[MET licence](https://api.met.no/doc/License),
[MET data model](https://docs.api.met.no/doc/locationforecast/datamodel),
[MET FAQ](https://docs.api.met.no/doc/locationforecast/FAQ),
[astronomy-engine README](https://github.com/cosinekitty/astronomy),
[SWPC aurora 30 minute forecast](https://www.spaceweather.gov/products/aurora-30-minute-forecast),
[OVATION JSON](https://services.swpc.noaa.gov/json/ovation_aurora_latest.json),
[SWPC Kp forecast JSON](https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json).

What the pages say about MET Norway:

- Identification: "Any requests with a prohibited or missing User-Agent will receive a 403 Forbidden error." The terms ask for an application or domain name and a company email or website link. Origin or Referer headers are accepted if a User-Agent cannot be set.
- Limits: "20 requests/second per application (total, not per client)". Heavy sites are "likely to be throttled, possibly also blocked".
- Caching: cache all responses, support gzip and redirects, use If-Modified-Since. The FAQ says to "truncate the results to max 4 decimals to facilitate caching".
- Browsers: "should not contact the API directly, but instead use a local proxy". High-traffic sites "must set up a caching proxy gateway".
- Licence: NLOD 2.0 and CC BY 4.0. Credit "The Norwegian Meteorological Institute, shortened MET Norway".
- Update frequency of the forecast: not stated on the pages I opened (the Open-Meteo documentation says MET Norway data updates "every hour" in its own service).
- Data model: `cloud_area_fraction` is "total cloud cover for all heights", unit %. Low is below 2000 m, medium 2000 to 5000 m, high above 5000 m. Our saved sample (`raw/met_pune.json`) has only the total, so it came from the compact response.

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| -6 degrees means civil twilight is over | [USNO twilight definitions](https://aa.usno.navy.mil/faq/RST_defs): civil twilight ends "when the center of the Sun is geometrically 6 degrees below the horizon"; nautical 12; astronomical 18 | MATCHES. Note that -6 is bright dusk. Stars, the Milky Way and most meteors need -12 to -18. |
| Civil twilight times, Pune, 5 Oct 2026 | [USNO API](https://aa.usno.navy.mil/data/api) answer: begin 06:04, end 18:42 local (UTC+5.5) | MATCHES to the minute (my check: ours 06:04 and 18:42). |
| Moon rise and set, same place | USNO API: rise 01:11, set 14:42 | MATCHES (astronomy-engine gave 01:11 and 14:42). |
| Moon quarters, Oct and Nov 2026 | USNO API: last quarter 3 Oct 13:25, new 10 Oct 15:50, first quarter 18 Oct 16:12, full 26 Oct 04:12 (UT) | MATCHES within about a minute (first quarter 16:13 vs 16:12). |
| Planet positions and brightness | [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) for Pune on 5 Oct 2026, 00:00 and 03:00 UT | Positions MATCH within 0.007 deg. Magnitudes MATCH within about 0.05, except Saturn: engine 0.20, Horizons 0.331. |
| Accuracy of astronomy-engine | README: "Accuracy always within 1 arcminute of results from NOVAS" and tested against "NOVAS, JPL Horizons, and other reliable sources" | MATCHES what my check showed. |
| Sun altitude from our own formula | astronomy-engine, 5 places, 48 half-hour steps on 4 Oct 2026 | Largest difference 0.0053 deg. |
| Aurora grid shape (packed as 360 by 181) | OVATION JSON read directly: `Data Format` is `[Longitude, Latitude, Aurora]`, 65,160 points, longitude 0 to 359, latitude -90 to 90 | MATCHES. Values ran 0 to 64 in the file I read. |
| Meaning of the grid | SWPC: forecast lead time "is the time it takes for the solar wind to travel from the L1 observation point to Earth". "An estimate of aurora viewing probability can be derived by assuming a linear relationship to the intensity" | Our percent chance is a heuristic, not an official probability. One grid cannot describe a whole night. |
| Kp forecast file | JSON with columns `time_tag`, `kp`, `observed`, `noaa_scale`, 3-hour steps, statuses observed, estimated, predicted, covering 27 Sep to 7 Oct 2026 when I read it | Suitable for later hours of the night. |
| Shower dates, rates and radiants | IMO 2027 calendar, Table 5. See the table below | Mixed. Details below. |
| `NEAR_PEAK_DAYS = 3` | IMO text: maxima "are not known more precisely than to the nearest degree of solar longitude" (about a day) | COULD NOT CONFIRM. The 3 day limit is editorial. I did not find an equivalent threshold in the parts of the IMO calendar I read. |

#### Meteor showers: ours against the IMO working list

Source: [IMO 2027 Meteor Shower Calendar, Table 5](https://www.imo.net/ShCal27s.pdf), edited by Jürgen Rendtel, document label IMO INFO(3-26). The table caption says details "were correct according to the best information available in June 2026, with maximum dates accurate only for 2027". Radiant is RA/Dec in degrees. I could not open the IMO 2026 calendar, so peak dates below are the 2027 dates.

| Shower | Active (ours) | Active (IMO) | Peak ours | Peak IMO 2027 | ZHR ours | ZHR IMO | Radiant ours | Radiant IMO | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Quadrantids | Dec 28 to Jan 12 | same | Jan 3 | Jan 4 | 80 | 80+ | 230/+49 | 230/+49 | Peak one day earlier |
| Lyrids | Apr 14 to Apr 30 | same | Apr 22 | Apr 23 | 18 | 18 | 271/+34 | 271/+34 | Peak one day earlier |
| Eta Aquariids | Apr 19 to May 28 | same | May 6 | May 6 | 50 | 50 | 338/-1 | 338/-1 | MATCHES |
| Delta Aquariids (IMO: S. delta-Aquariids) | Jul 12 to Aug 23 | same | Jul 30 | Jul 31 | 25 | 25 | 340/-16 | 340/-16 | Peak one day earlier |
| Perseids | Jul 17 to Aug 24 | same | Aug 12 | Aug 13 | 100 | 110+ | 48/+58 | 48/+58 | Peak one day earlier, ZHR differs |
| Draconids | Oct 6 to Oct 10 | same | Oct 8 | Oct 9 | 10 | 5 | 262/+54 | 263/+56 | Peak one day earlier, ZHR differs, radiant 1 and 2 deg off |
| Southern Taurids | Sep 10 to Nov 20 | Sep 20 to Nov 20 | Oct 10 | Nov 6 | 5 | 7 | 32/+9 | 52/+15 | DIFFERS on all fields |
| Orionids | Oct 2 to Nov 7 | same | Oct 21 | Oct 22 | 20 | 20 | 95/+16 | 95/+16 | Peak one day earlier |
| Leonids | Nov 6 to Nov 30 | same | Nov 17 | Nov 18 | 15 | 15+ | 152/+22 | 152/+22 | Peak one day earlier |
| Geminids | Dec 4 to Dec 20 | same | Dec 14 | Dec 14 | 150 | 150 | 112/+33 | 112/+33 | MATCHES |

Notes:

- The one-day peak differences are consistent with year-to-year drift, since the IMO dates are for 2027. For 2026, read the IMO 2026 calendar.
- Southern Taurids: our radiant and peak look like early October values. The IMO table gives the maximum at Nov 06 and the radiant at that maximum. The [Royal Museums Greenwich guide for 2026](https://www.rmg.co.uk/stories/space-astronomy/meteor-shower-guide-2026) agrees with ours (active "10 Sep-20 Nov", peak "10 Oct", rate 5) but does not name its source. The [Wikipedia list of meteor showers](https://en.wikipedia.org/wiki/List_of_meteor_showers), which says its data come from the IMO and are "given for 2026" (last revised 1 October 2026 on the page), gives 20 Sep to 20 Nov, peak 5 Nov, rate 7. Sources disagree, the IMO is the primary one.
- The RMG page also lists different rates from ours for five showers (Quadrantids 120, Eta Aquariids 40, Perseids 150, Orionids 15, Geminids 120). Wikipedia (IMO-derived) gives Quadrantids 80, Eta Aquariids 50, Perseids 100, Draconids 5, Orionids 20, Geminids 150, which equals ours except Draconids. Rates are "based on recent observed returns" per the IMO, so they move; check the current IMO list before publishing.
- Not in our table but in the IMO Table 5: Alpha Capricornids (Jul 31, ZHR 5), Northern Taurids (Nov 13, ZHR 5), Ursids (Dec 23, ZHR 10), and 25 weaker or variable entries (Table 5 has 39 rows, 29 beyond the 10 in our table, counting the Antihelion Source, which is not a true shower).

### A. Other sources worth knowing

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [Open-Meteo docs](https://open-meteo.com/en/docs), [terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing) | Second cloud forecast, with `cloud_cover_low`, `_mid` (3 to 8 km), `_high` (above 8 km), visibility, up to 16 days. Several models, MET Norway among them | Free API for non-commercial use only. 600 per minute, 5,000 per hour, under 10,000 per day, 300,000 per month. Data under CC BY 4.0, attribution required. Free tier "carries no uptime guarantee". Paid plan prices not stated on the page I opened |
| [NWS API](https://www.weather.gov/documentation/services-web-api) | US-only forecast backup | "open data, free to use for any purpose". User-Agent required. "The rate limit is not public information" |
| [7Timer documentation](https://www.7timer.info/doc.php?lang=en) | Astronomy product with cloud cover, seeing, transparency, lifted index, from the GFS model | Free to use or redistribute if not commercial. Rate limits not stated |
| [GFZ Kp](https://kp.gfz.de/en/) and [data page](https://kp.gfz.de/en/data) | A second source of Kp, with web service example `https://kp.gfz.de/app/json/?start=...&end=...&index=C9&status=def` | CC BY 4.0, "refer to GFZ German Research Centre for Geosciences as data source". Nowcast files described as "realtime" |
| [Met Office space weather](https://weather.metoffice.gov.uk/specialist-forecasts/space-weather) | Four-day text outlook with aurora notes for both hemispheres | Crown copyright footer. No API mentioned. Specialist accounts are offered |
| [Aurorasaurus](https://www.aurorasaurus.org/) | Citizen reports of aurora, to show whether it was actually seen | Run by New Mexico Consortium with NSF and NASA support. API and terms not stated on the page I opened |
| [USNO API](https://aa.usno.navy.mil/data/api) | Official twilight, Moon and eclipse times, good as a test oracle | Endpoints `rstt/oneday`, `moon/phases/date`, `moon/phases/year`, eclipses. Limits and terms not stated. A user ID is "optional" |
| [JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | Planet and Moon positions and magnitudes, test oracle | Free use, limits, citation not stated on the page I opened |
| [IAU Meteor Data Center](https://www.ta3.sk/IAUC22DB/MDC2007/) | Official list of established, working and removed showers | No terms stated on the page I opened. Count of established showers not stated there (the IMO text says 113 as of 2026 July 3) |

---

## 2. Starlink strings (`src/trains.js`)

### What it uses now

Same-launch Starlink satellites that are still in one orbital plane, from CelesTrak GP element sets and SATCAT, propagated exactly with SGP4 in satellite.js. Launch date groups satellites. Defaults: launched within 25 days, at least 6 satellites, spread no more than 120 degrees of orbit, planes within 2 degrees.

Primary pages opened:
[CelesTrak current GP data](https://celestrak.org/NORAD/elements/),
[SATCAT format](https://celestrak.org/satcat/satcat-format.php),
[CelesTrak Supplemental GP](https://celestrak.org/NORAD/elements/supplemental/),
[CelesTrak usage policy](https://celestrak.org/usage-policy.php).

### B. Checking our values and logic

| Item | Source | Result |
|---|---|---|
| Group by launch | SATCAT OBJECT_ID is "International Designator (YYYY-NNNAAA)": year, launch of the year, piece letters | Our code groups by launch date. Two launches on one day would merge. Grouping on the `YYYY-NNN` part is exact. Our plane and spread filters limit the harm. |
| Six-digit catalogue numbers | [CelesTrak GP formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php): "We ran out of 5-digit catalog numbers on 2026-07-11" | We use JSON/OMM, which has no limit. My check: satellite.js 7.1.0 builds records and propagates for ids 99999, 100001 and 123456. Never use TLE text for new objects. |
| Starlink SupGP exists | I read `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json`: OMM JSON, `DATA_SOURCE` "SpaceX-E", first record STARLINK-38128, OBJECT_ID 2026-160A, ids from 100001 | Confirmed it works and is what the supplemental page describes: "latest Starlink ephemeris data from SpaceX's public data repository". |
| `maxAgeDays = 25` | [findstarlink](https://www.findstarlink.com/) says satellites "spread out and move to their own orbits" but gives no timeframe | COULD NOT CONFIRM. Search snippets from blogs gave 1 to 3 days, about a week, or 2 to 8 weeks to raise orbits. I did not open them. The spread test (`maxSpanDeg`) matters more than this number. |
| SGP4 accuracy for Starlink | [Preprint summary on pith.science](https://pith.science/paper/2605.19850): pooled median error "~1 km at 6 h to ~38 km (SGP4) / ~76 km (high-fid) at 7 d", against operator-updated truth | A machine-reviewed arXiv preprint, not peer reviewed. Approximately; needs checking. Shows why old element sets matter for strings. |
| SATCAT status codes and types | [Status codes](https://celestrak.org/satcat/status.php): + operational, - nonoperational, P partially operational, B backup, S spare, X extended mission, D decayed, ? unknown. Object types PAY, R/B, DEB, UNK | MATCHES the mapping in `build_data.py` and `STATUS_NAMES`. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| CelesTrak Supplemental GP (page above) | Operator-supplied ephemerides: Starlink from SpaceX, ISS from "NASA OEM Ephemeris Data", Chinese station from "CMS OEM Ephemeris Data", also GPS, GLONASS, OneWeb and others. Page claims about "an order of magnitude improvement in the error" (GPS test: 7.54 km vs 0.87 km, GLONASS: 3.30 km vs 0.20 km; Starlink figure not given) | Free. "adhere to our usage policy". Updates: CelesTrak "checks known sources of publicly available orbital data" each day. Use 2 hours per the usage policy |
| [Space-Track](https://www.space-track.org/documentation) | The government source behind GP data, SATCAT, decay data | Account required. Under 30 requests per minute and 300 per hour. Suggested GP query frequency "Once every hour", SATCAT "Once per day after 1700 (UTC)". Redistribution of basic SSA data approved "conditioned on appropriate citation" |
| [N2YO API](https://n2yo.com/api/) | TLE, positions, visual passes, radio passes, "above" list. A second predictor to compare with | Key required. Free but transaction limited (TLE 1,000, positions 1,000, visual passes 100). Window not stated. [Terms](https://www.n2yo.com/about/?a=terms) do not address the API; they say n2yo.com "is an authorized redistributor" of Space Track data |
| [Heavens-Above](https://www.heavens-above.com/) and [FAQ](https://www.heavens-above.com/FAQ.aspx) | The standard manual cross-check for pass times | FAQ: predictions only "when the sky is reasonably dark" with a "-6° sun altitude" cut-off, and "increasingly inaccurate the further you move away from the current time". Reuse and scraping terms and any API: not stated on the pages I opened |
| [findstarlink](https://www.findstarlink.com/) | Fan-made train predictions, tracks the first satellite of each chain | "NOT affiliated with SpaceX or Starlink". Data source and terms not stated |
| [Launch Library 2](https://thespacedevs.com/llapi) | Launch times to flag fresh launches before SATCAT has them | "15 non-authenticated requests per hour". Plans: "check our Patreon". Licence not stated on the page I opened |

---

## 3. Satellite and ISS passes (`src/sgp4.js`, `findPasses` in `src/core.js`)

### What it uses now

SGP4 from satellite.js on OMM records, a cylindrical Earth-shadow test for "sunlit", and a pass counts as visible when the satellite is sunlit and the Sun is below -6 degrees. Passes need at least 10 degrees elevation.

Primary pages opened:
[satellite.js README](https://github.com/shashwatak/satellite-js),
[Spacetrack Report No. 3 (PDF)](https://celestrak.org/NORAD/documentation/spacetrk.pdf),
[Revisiting Spacetrack Report #3](https://celestrak.org/publications/AIAA/2006-6753/),
[SGP4 Orbit Determination (PDF)](https://celestrak.org/publications/AIAA/2008-6770/AIAA-2008-6770.pdf),
[CelesTrak documentation index](https://celestrak.org/NORAD/documentation/).

### B. Checking our values and logic

| Item | Source | Result |
|---|---|---|
| Use SGP4 with NORAD element sets | Spacetrack Report No. 3 (Hoots and Roehrich, December 1980): "inputting NORAD element sets into a different model... will result in degraded predictions" | MATCHES. |
| SGP4 vs SDP4 boundary | Same report: near-Earth is period "less than 225 minutes", deep-space "greater than or equal 225 minutes". 225 minutes is a mean motion of about 6.4 revolutions per day (my arithmetic) | MATCHES. satellite.js picks the model itself. |
| Accuracy statement | satellite.js README: accuracy "Not stated". Vallado and Crawford, "SGP4 Orbit Determination" (the file is named AIAA-2008-6770): "we do not know the accuracy of the original TLE... there is no measure of accuracy with each TLE". [Wikipedia on SGP4](https://en.wikipedia.org/wiki/Simplified_perturbations_models): "error ~1 km at epoch" and "grows at ~1 to 3 km per day", citing Vallado 2006 | The numbers come from Wikipedia only. I could not read them in the primary report. Approximately; needs checking. |
| Visible only when the Sun is below -6 | Heavens-Above FAQ (above) | MATCHES. |
| ISS passes happen near dusk and dawn | [NASA Spot the Station](https://www.nasa.gov/spot-the-station/): "All International Space Station sightings will occur within a few hours before or after sunrise or sunset". Inclination 51.6 degrees | MATCHES our logic. |
| ISS element freshness | Same NASA page: trajectory data updated "approximately three times a week" | Supports showing element age for the ISS. |
| Minimum 10 degrees elevation | NASA page does not state a minimum | COULD NOT CONFIRM. Editorial choice. |
| Cylindrical shadow, equatorial radius 6378.137 km | [Wikipedia, Earth radius](https://en.wikipedia.org/wiki/Earth_radius): WGS-84 equatorial radius "6,378.1370 km" | Radius MATCHES. The shadow model ignores the penumbra. I did not open a reference for the shadow model. |
| Fast swarm model error | My check on the 5 fixture satellites in `test/fixtures/gp-sample.json`, swarm model against SGP4: 4 to 63 km at epoch, up to about 146 km at 48 hours | Supports the README claim ("tens or a few hundred kilometres over a day or two"). Small sample. |
| Satellite brightness | [McCants intrinsic magnitude page](https://www.mmccants.org/tles/intrmagdef.html) describes two standards: Quicksat (1000 km, full phase, brightest likely) and Molczan (1000 km, 90 degree phase, average). About 0.7 magnitude between them | The app does not compute satellite magnitude yet. Needed if you ever show "how bright". |

### A. Other sources

All of these have the same two roles: a live second opinion for checking, or better elements. Space-Track, N2YO, Heavens-Above and CelesTrak Supplemental GP are described in section 2. Also:

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [NASA Spot the Station](https://www.nasa.gov/spot-the-station/) | Official ISS sighting list for comparison | Terms and any feed not stated on the page I opened |
| [McCants satellite elements](https://www.mmccants.org/tles/index.html) | Integrated TLEs "updated daily at noon and 6-7 PM Central time", brightness work | No terms or disclaimer on the page I opened |

---

## 4. Earthquake cutaway and shake arrival (`src/under.js`, `src/core.js`, `src/info.js`)

### What it uses now

USGS GeoJSON feed, ShakeMap contours, PAGER alert and exposure, felt reports. Waves use P 8.0 km/s and S 4.5 km/s along a straight chord through the Earth. Layers: crust to 35 km, mantle to 2891 km, outer core to 5150 km, inner core to 6371 km.

Primary pages opened:
[USGS GeoJSON summary feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php),
[feeds index](https://earthquake.usgs.gov/earthquakes/feed/v1.0/),
[USGS API for the earthquake catalogue](https://earthquake.usgs.gov/fdsnws/event/1/),
[ShakeMap](https://earthquake.usgs.gov/data/shakemap/),
[PAGER](https://earthquake.usgs.gov/data/pager/),
[PAGER alert levels](https://earthquake.usgs.gov/data/pager/background.php),
[Did You Feel It](https://earthquake.usgs.gov/data/dyfi/),
[USGS reuse policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).

What the USGS pages say: summary feeds "Updated every minute" for past hour, day, 7 days and 30 days, at M1.0+, M2.5+, M4.5+, significant and all. "GeoJSON is intended to be used as a programatic interface for applications." The API "limits queries to 20000". Rate limits are not stated on the pages I opened. "USGS-authored or produced data and information are considered to be in the U.S. Public Domain", with a request that "proper credit be given" (suggested form: "Credit: U.S. Geological Survey / Department of the Interior/USGS"). Not all material on the site is public domain.

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| P 8.0 and S 4.5 km/s | Kayal (Geological Survey of India lecture notes, hosted on a [USGS site](https://escweb.wr.usgs.gov/share/mooney/SriL.II2.pdf)): apparent velocities of Pn and Sn "about 8.0 and 4.6 km/s respectively, which are the upper mantle velocities". [Wikipedia, seismic velocity structure](https://en.wikipedia.org/wiki/Seismic_velocity_structure): upper mantle P "7.5 to 8.5", S "4.5 to 5.0"; crust P "6.0 to 7.0 km/s (continental)" and S "3.5 to 4.0"; lower mantle P "10 to 13" | MATCHES as upper-mantle values. They are not whole-Earth averages. |
| Straight-line travel time | [TauP documentation](https://www.seis.sc.edu/webtaup/doc/taup_time.html) example, PREM, 200 km source, 57.4 degrees: P 566.77 s, S 1028.61 s. My code gives about 753 s and 1339 s for the same case | DIFFERS, as the README already warns. About 33 percent and 30 percent slower. At short range the real crustal speeds are lower than 8.0, so ours arrives early there. |
| Layer boundary depths | Wikipedia (structure of the Earth and seismic velocity structure): core-mantle boundary "approximately 2,890 km", inner-core boundary "approximately 5,150 km", inner core radius "about 1,220 km" | MATCHES (ours 2891 and 5150). |
| Crust to 35 km | Same pages: Moho "approximately 30 to 50 km" under continents and "5 to 10 km" under the oceans | MATCHES a continental figure only. A shallow ocean quake at 20 km is already in the mantle. `quakeInfo` labels anything under 35 km as crust. |
| PREM numbers (for example Moho at 24.4 km) | The Wikipedia PREM page did not list numbers in what I read. The EarthScope EMC page loaded but lists no model. | COULD NOT CONFIRM. I remember a 24.4 km Moho in PREM but did not verify it. |
| Earth radius 6371 km | Wikipedia: IUGG mean radius "6,371.0087714 km" | MATCHES. |
| PAGER alert levels | USGS PAGER background page: fatalities yellow 1, orange 100, red 1,000 ("Corresponding fatality thresholds... are 1, 100, and 1,000"); economic loss red "$1 billion+", orange "$100 million - $1 billion", yellow "$1 million - $100 million" | Use if you ever show colours beside our numbers. |
| PAGER exposure | Page: population affected at each intensity level "is computed" by combining the intensity map "with the Landscan population database" | Supports `exposureAtOrAbove`. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [EMSC SeismicPortal FDSN event service](https://www.seismicportal.eu/fdsn-wsevent.html), [terms](https://www.seismicportal.eu/terms.html), [real-time feed](https://www.seismicportal.eu/realtime.html) | Independent European and global catalogue, often earlier for some regions. A WebSocket sends a JSON message "when an event is inserted or updated" | CC BY 4.0, credit "EMSC-CSEM SeismicPortal". Up to 20000 events per request. Rate limits not stated. "Commercial reproduction or transmission... requires prior written permission" |
| [GEOFON (GFZ)](https://geofon.gfz.de/) | Rapid event list, FDSN services | Licence, terms, limits not stated on the page I opened. Certified "CoreTrustSeal" repository |
| [FDSN web services](https://www.fdsn.org/webservices/) | The standard (fdsnws-event, station, dataselect, availability) that makes USGS, EMSC and GEOFON queries look alike. Baseline versions 1.1 to 1.2 dated June 27, 2019 | Which agencies implement it: not stated on that page |
| [TauP](https://www.seis.sc.edu/webtaup/doc/taup_time.html) (Philip Crotwell, version 3.2.0 on the page) | Real travel times with models `iasp91`, `prem`, `ak135`, `ak135fcont`, `ak135favg`. A small table of P and S times by distance and depth could be precomputed and shipped as a file | Licence not stated on the page I opened. Source on GitHub |
| [EarthScope Earth Model Collaboration](https://data.earthscope.org/app/products/portal/emc) | Repository of Earth models in NetCDF with DOIs | Cite "EarthScope DS (2011), doi:10.17611/DP/EMC.1" or the DOI of the model used |

The old IRIS web service for travel times answered "This service has been retired" when I tried it by direct request.

---

## 5. Hazards layer (GDACS)

### What it uses now

The GDACS GeoJSON event list. In the saved snapshot of 4 Oct 2026 the event types were WF 60, EQ 35, TC 3, FL 2.

Primary pages opened:
[GDACS feed reference](https://www.gdacs.org/feed_reference.aspx),
[GDACS overview](https://www.gdacs.org/About/overview.aspx),
[GDACS alerts](https://www.gdacs.org/Alerts/default.aspx),
[GDACS terms of use](https://www.gdacs.org/About/termofuse.aspx),
[GDACS earthquake alert model](https://www.gdacs.org/Knowledge/models_eq.aspx).

What GDACS says: feeds "updated every 6 minutes". It is "A cooperation framework between the United Nations and the European Commission". The disclaimer: "this information is purely indicative and should not be used for any decision making without alternate sources". Terms: information "as is without warranty of any kind". Licence, attribution, automated access and rate limits: not stated on the pages I opened (the feed page links to an EC legal notice and copyright notice that I did not open).

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| Alert colours for earthquakes | GDACS model page: red score "2" or more, orange "1" to under 2, green 0 to 1. ShakeMap-based model is the primary one; it weights population with "10*Population(MMI IX) + Population(MMI VIII) + 0.1*Population(MMI VII)". A score under 1 "corresponds roughly" to under 10 casualties, above 2 to more than 100 | We show the colour GDACS supplies, so nothing to correct. Useful if you explain the colours. |
| Event types in the snapshot | The feed page names EQ, TC, FL in its examples. WF (wildfire) is in our data but the pages I opened do not define it | COULD NOT CONFIRM the WF definition from a GDACS page. |
| Alert levels per hazard other than earthquakes | The glossary page I tried returned 404. The alerts page shows a Level filter but no definitions | COULD NOT CONFIRM. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/area/) | Active fire detections: VIIRS S-NPP, NOAA-20, NOAA-21, MODIS, Landsat. Real-time "within 60 minutes of satellite overpass" | "free MAP_KEY" needed. "5000 transactions / 10-minute interval". `DAY_RANGE` 1 to 5. Licence not stated on the page I opened |
| [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | Natural events by category (for example wildfires, volcanoes, severe storms, landslides). Endpoints `/events`, `/events/geojson`, `/categories`, `/sources`, `/layers`, `/magnitudes` | Key, limits, cost, update behaviour not stated. "all metadata contained within EONET is subject to our disclaimer" |
| [NOAA NHC GIS data](https://www.nhc.noaa.gov/gis/) and [RSS and XML feeds](https://www.nhc.noaa.gov/aboutrss.shtml) | Active tropical cyclones by basin, shapefiles, KMZ, GRIB2 | "provided as a convenience to users. Support for these data may not always be available or timely". Terms and update times not stated. The page does not mention JSON |
| [USGS volcano API](https://volcanoes.usgs.gov/vsc/api/volcanoApi/) | List of elevated US volcanoes and status | "freely available but are designed to support USGS applications" and "No guarantee of continuing support should be assumed". Limits not stated |
| [Tsunami.gov](https://www.tsunami.gov/) | NTWC and PTWC Atom and CAP feeds | Feed terms not stated on the page I opened |
| [ReliefWeb API](https://apidoc.reliefweb.int/) | Disaster reports from humanitarian partners | Approved `appname` needed from 1 November 2025. 1000 calls per day and 1000 entries per call. Site content under CC BY 4.0, but may contain "copyrighted material owned by the original source" |
| Smithsonian Global Volcanism Program | Weekly volcanic activity reports and the Volcanoes of the World database | COULD NOT OPEN: the site answered 403 to the fetch tool and to curl. See the last section |

---

## 6. Aurora and space weather

### What it uses now

SWPC OVATION grid and Kp. Primary pages opened are listed under feature 1, plus
[SWPC data access](https://www.spaceweather.gov/content/data-access) and
[NOAA space weather scales](https://www.spaceweather.gov/noaa-scales-explanation).

The SWPC pages have moved to `spaceweather.gov` (the `swpc.noaa.gov` addresses answered with a permanent redirect). The JSON host `services.swpc.noaa.gov` still served the files on 4 Oct 2026. The data access page lists "JSON: services.swpc.noaa.gov/json" and an FTP archive. Free use, usage policy, polling guidance, attribution and update cadence are not stated on the page I opened. A Disclaimer link exists but its text was not on the page.

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| Rule `kp >= 5 and abs(latitude) >= 40` | NOAA scales: G1 is "Kp = 5", aurora "commonly visible at high latitudes (northern Michigan and Maine)". G2 (Kp 6) seen as low as New York and Idaho, "typically 55° geomagnetic lat". G3 (Kp 7) Illinois and Oregon, about 50. G4 (Kp 8, including 9-) Alabama and northern California, about 45. G5 (Kp 9) Florida and southern Texas, about 40 | DIFFERS in kind. NOAA's table is in geomagnetic latitude, our rule uses geographic latitude. The rule is loose, not wrong. |
| Frequency of storms | Same page: G1 "1700 per cycle (900 days per cycle)", G5 "4 per cycle (4 days per cycle)" | Could be quoted beside a Kp number. |
| Aurora "chance" | SWPC OVATION page (see feature 1) | Heuristic. Label it "indicative". |

### A. Other sources

GFZ Kp, Met Office space weather and Aurorasaurus are in the feature 1 table. Nothing else I opened is needed for this feature.

---

## 7. Aircraft overhead (`src/info.js`, `fetch_routes.py`)

### What it uses now

adsb.lol aircraft positions, routes from the adsb.lol route endpoint, OpenFlights airline names, and a table of 55 ICAO type codes.

Primary pages opened:
[adsb.lol home](https://www.adsb.lol/),
[adsb.lol privacy and licence](https://www.adsb.lol/privacy-license/),
[adsb.lol API page](https://www.adsb.lol/docs/open-data/api/),
[adsb.lol open data](https://www.adsb.lol/docs/open-data/),
[adsb.lol introduction](https://www.adsb.lol/docs/overview/introduction/),
[adsb.lol API docs](https://api.adsb.lol/docs) (only the title loaded).

What they say:

- API page: base URL `https://api.adsb.lol`, "The API is available to everyone", "License: ODbL 1.0".
- Privacy and licence page: data sent by feeders is released under CC0 ("waive all copyright and related or neighboring rights"). Data is provided "on an 'as is' basis". Users must indemnify adsb.lol for third-party claims arising from non-conformant use.
- Rate limits, API keys, fair use, attribution: not stated on the pages I opened. The README note that adsb.lol "asks to be contacted for heavy use" is not on any page I opened.
- Home page: "Data is provided by people like you, and is available freely via the API and the historical daily archive."

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| Route endpoint | I requested `https://api.adsb.lol/api/0/route/DLH400`. It answered with a 302 redirect to `https://vrs-standing-data.adsb.lol/routes/DL/DLH400.json#deprecated`. That file has `callsign`, `number`, `airline_code`, `airport_codes` (EDDF-KJFK), `_airport_codes_iata` (FRA-JFK) and `_airports` with name, ICAO, IATA, country, lat, lon, altitude | The old endpoint seems to be on the way out. I found no page that says so in words, only the `#deprecated` fragment. |
| Aircraft type table (55 codes) | [Wikipedia, list of aircraft type designators](https://en.wikipedia.org/wiki/List_of_aircraft_type_designators), read as source text and compared by script | 53 MATCH by name. Exceptions below. ICAO Doc 8643, the primary reference, would not open (403). |
| OpenFlights airlines | [OpenFlights data page](https://openflights.org/data): "Open Database License", must "acknowledge the source". "This data is not suitable for navigation." Routes: the third party "ceased providing updates in June 2014". Airlines and airports on GitHub are a "sporadically updated static snapshot" | MATCHES the README worry that names can be out of date. |

Type table exceptions:

- `CRJ7`: Wikipedia list shows "Canadair Regional Jet 550" (linked to the CRJ550 variant section), ours "Bombardier CRJ-700". I remember the code also covering the CRJ-700, but the list I opened does not say so. COULD NOT CONFIRM against ICAO.
- `C172`: not in that list. It covers "multi-engined and turbine aircraft", so single piston types are absent. COULD NOT CONFIRM.
- `B77L`: the list gives "Boeing 777-200LR" and "Boeing 777-200 Freighter". Our label would call a 777F a 777-200LR.
- Codes that cover several variants: `B744` (747-400, -400ER, -400M, freighters), `B748` (747-8I and -8F), `B763` (767-300, -300ER, freighter), `B772` (777-200 and -200ER), `A21N` ("A321neo/LR/XLR"), `E190` ("Embraer 190 / Lineage 1000"), `B764` (list says "767-400ER"). Our names are the common variant, which is fine for a label.

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [VRS standing data on adsb.lol](https://vrs-standing-data.adsb.lol/) with its [README](https://vrs-standing-data.adsb.lol/README.md) and [LICENSE](https://vrs-standing-data.adsb.lol/LICENSE) | Static route files per callsign, plus `airports.csv` and `routes.csv` | LICENSE is CC0 1.0. "Data is updated every hour from upstream." Upstream is [vradarserver/standing-data](https://github.com/vradarserver/standing-data), CC0-1.0, whose README mentions aircraft, airlines, airports and routes (I did not see the airline or aircraft files themselves) |
| [OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html) | Second live feed | Anonymous "400" credits per day, standard user "4,000", active feeder "8,000". Cost by area: up to 25 sq degrees 1 credit, over 400 sq degrees 4. Time resolution 10 s anonymous, 5 s signed in. OAuth2 client credentials only. Terms page returned 503, so any non-commercial rule is COULD NOT CONFIRM |
| airplanes.live | Third live feed | The [archived repository](https://github.com/airplanes-live/api-archive) says "rate limited to 1 request per second", licence Apache-2.0, marked archived on April 29, 2026. The website guide returned 403, so key and non-commercial terms are COULD NOT CONFIRM |
| [OurAirports data](https://ourairports.com/data/) | Airport names and positions | "released to the Public Domain, and comes with no guarantee of accuracy or fitness for use". "we update every night". Credit not required |
| [ADS-B Exchange data products](http://www.adsbexchange.com/data-products/) | Large global feed | Enterprise products need "minimum annual commitments". "low-cost API" for "personal and non-commercial use". Prices not stated |
| [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) | Flight status and routes | Personal: "No minimum", about "$5 free per month" (ADS-B feeders $10), personal or academic use. Standard "$100/month". Premium "$1,000/month". Flight search "$0.050/result set" |
| [tar1090-db](https://github.com/wiedehopf/tar1090-db) | Aircraft database by ICAO hex from Mictronics | Licence and update schedule not stated on the page I opened |

---

## 8. Sky view (`src/stars.js`, `src/sky.js`, `src/core.js`)

### What it uses now

A Hipparcos-based catalogue of 5,044 stars to magnitude 6 (`raw/stars6.json`), constellation lines, a Milky Way drawn from galactic coordinates, and a sky glow estimate from the NASA night-lights texture. Limiting magnitude comes from `limitingMagnitude()`.

Provenance: the repository does not record where `stars6.json` came from. Its structure (GeoJSON, feature id is a HIP number, `mag` and `bv`) matches the [d3-celestial](https://github.com/ofrohn/d3-celestial) star data. The d3-celestial README names "XHIP: An Extended Hipparcos Compilation; Anderson E., Francis C. (2012)" (VizieR V/137D) for stars, "IAU Constellation page" for lines, code released "under BSD License", and says data-specific licences are not stated. COULD NOT CONFIRM that our file is that data.

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| Astronomical darkness at -18 degrees | USNO: astronomical twilight ends when the Sun is "geometrically 18 degrees below the horizon" | MATCHES the "fully dark at -18" assumption. The start at -1.5 degrees is our own choice. |
| Limiting magnitude range | [Bortle scale, Sky and Telescope](https://www.skyandtelescope.com/astronomy-resources/light-pollution-and-astronomy-the-bortle-dark-sky-scale/) (John E. Bortle): class 1 "7.6 to 8.0 (with effort)", class 4 "6.1 to 6.5", class 6 "about 5.5", class 8 "magnitude 4.5 at best", class 9 "4.0 or less". My check of our function: 6.50 at -18 degrees with no glow, 5.00 with half glow, 3.50 with full glow, 5.30 with the Moon up | Rough MATCH. Our best case is about class 4, our worst about class 9. Truly dark skies (7.6 and above) are not modelled and the star file stops at 6. |
| Glow from the night texture | Our code averages a 16 by 8 pixel window of the 2048 by 1024 night image. That window is about 2.8 by 1.4 degrees, a few hundred km | COULD NOT CONFIRM as a measure of sky glow. It is a coarse proxy, as the README says. |
| Planet magnitudes | JPL Horizons check under feature 1 | MATCHES (Saturn about 0.13 off). |
| Galactic pole constants | [Wikipedia, galactic coordinate system](https://en.wikipedia.org/wiki/Galactic_coordinate_system): pole at "12h 51.4m" and "+27.13°" (ours 192.85948 deg = 12h 51.44m, +27.12825), north celestial pole longitude "l_NCP = 122.93314°" | MATCHES, except ours is 122.93192 and the page says 122.93314, a difference of 0.0012 degrees. Not visible on screen. |
| Sun position comment | [USNO approximate solar coordinates](https://aa.usno.navy.mil/faq/sun_approx): "accuracy of about 1 arcminute within two centuries of 2000", constants 357.529, 0.98560028, 280.459, 0.98564736, 1.915, 0.020, 23.439, 0.00000036 | Our constants (357.528, 0.9856003, 280.46, 0.9856474, 0.0000004) differ in the last digits. The comment's "0.01 deg" is tighter than the USNO statement. |
| Sidereal time | [USNO GMST formula](https://aa.usno.navy.mil/faq/GAST), accuracy "about 0.1 second of time" | MATCHES: my check on six dates from 2025 to 2040 differed by at most 0.006 s. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [ESA Hipparcos and Tycho catalogues](https://www.cosmos.esa.int/web/hipparcos/catalogues) and [VizieR I/239](https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239) | The primary star catalogue | "CC BY-NC 3.0 IGO" and "Credit: ESA". VizieR asks for the acknowledgement "This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France (DOI: 10.26093/cds/vizier)" |
| [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) | Ready-made star and Milky Way maps, up to 65536 by 32768 pixels, from Hipparcos-2 (brighter than magnitude 8.0), Tycho-2 (8.0 to 11.5) and Gaia DR2 | Credit "NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC. Constellation figures based on those developed for the IAU by Alan MacRobert of Sky and Telescope magazine" |
| [Falchi et al. 2016, World Atlas of Artificial Night Sky Brightness](https://repository.library.noaa.gov/view/noaa/15730) (record of the Science Advances paper, volume 2, issue 6, e1600377) | Published atlas of artificial sky brightness. Abstract: "more than 80% of the world and more than 99% of the U.S. and European populations live under light-polluted skies"; the Milky Way is "hidden from more than one-third of humanity" | The data set has a [GFZ data page](https://dataservices.gfz.de/10.5880/gfz.1.4.2016.001/supplement-to-the-new-world-atlas-of-artificial) which loaded but showed only the title to me. Licence, resolution and units COULD NOT CONFIRM |
| [VIIRS Nighttime Lights (Earth Observation Group)](https://eogdata.mines.edu/products/vnl/) | Annual and monthly night-light rasters, "15 arc second (~500m at the Equator)" | "Many of the VIIRS Nighttime Lights data are available under Creative Commons Attribution 4.0". "Please cite EOG as the data source". Registration need not stated |
| [lightpollutionmap.info](https://www.lightpollutionmap.info/) | Interactive viewer with VIIRS, World Atlas 2015 (Falchi) and sky quality meter data | Operator, data sources, terms, API: not stated on the page I opened |
| [NASA Black Marble](https://blackmarble.gsfc.nasa.gov/) | NASA night-lights products | The page only said "Redirecting to New Black Marble Website". Nothing else loaded |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) | Moon colour map (up to 16384 by 8192) and displacement maps | Credit "NASA's Scientific Visualization Studio". "optimized for aesthetics, not science". Licence not stated, though NASA material is generally public domain. The README worries about the Moon texture from three.js examples: the [three.js textures folder](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets) showed no README or licence note |

---

## 9. Clouds on the globe

### What it uses now

NASA GIBS imagery (a daily composite from 3 Oct 2026 in the prototype) for the globe, MET Norway for the forecast.

Primary pages opened:
[GIBS API documentation](https://nasa-gibs.github.io/gibs-api-docs/),
[GIBS access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/),
[GIBS available visualizations](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/).

What they say: WMTS at `https://gibs.earthdata.nasa.gov/wmts/epsg{code}/best/`, WMS at `https://gibs.earthdata.nasa.gov/wms/epsg{code}/best/wms.cgi?`, projections EPSG:4326, 3413, 3031 and 3857, time as `YYYY-MM-DD` or full UTC time. "NASA promotes full and open sharing of data". The requested acknowledgement is: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." Many visualizations come from the LANCE near-real-time system and are "available in GIBS within 3.5 hours of observation". Authentication and usage limits: not stated on the pages I opened. The layer catalogue on the visualizations page showed an error, so I could not list cloud layers.

### B. Checking our values

| Item | Source | Result |
|---|---|---|
| Credits line "NASA" | GIBS asks for the sentence above | DIFFERS in wording. Put the full sentence in the About panel. |
| Cloud percent from MET | MET data model: `cloud_area_fraction` in % | MATCHES. |
| Earth Data policy page | [NASA Earthdata policy page](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-information-policy) returned 403 | COULD NOT CONFIRM beyond the GIBS page's own "full and open sharing" line. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [NOAA STAR GOES imagery](https://www.star.nesdis.noaa.gov/GOES/index.php) | GOES-East and GOES-West views including "GeoColor" ("True color day / IR night") and full disk | Update cadence, download options and terms not stated on the page I opened. Maintenance notice for Sep 15 to 16, 2026 |
| [RainViewer API](https://www.rainviewer.com/api.html) | Radar tiles from "1200+ radars worldwide across 150+ countries" | "available for personal and educational use only". Credit with a link required. "We do not guarantee the availability of radar data". Satellite infrared tiles not mentioned on the page |
| Forecast backups | Open-Meteo, NWS, 7Timer | See feature 1 |

---

## 10. Launch sites (`LAUNCH_SITES` in `src/core.js`)

### What it uses now

22 hand-written points keyed by CelesTrak launch site code, rounded to 0.1 degree.

Primary pages opened:
[CelesTrak launch site codes](https://celestrak.org/satcat/launchsites.php) (42 codes, names only, "does not provide geographic coordinates", last updated 2026 Oct 01),
[Wikipedia, list of spaceports](https://en.wikipedia.org/wiki/List_of_spaceports),
[Guiana Space Centre](https://en.wikipedia.org/wiki/Guiana_Space_Centre),
[Rocket Lab Launch Complex 1](https://en.wikipedia.org/wiki/Rocket_Lab_Launch_Complex_1),
[Dombarovsky air base](https://en.wikipedia.org/wiki/Dombarovsky_(air_base)),
[Vandenberg Space Force Base](https://en.wikipedia.org/wiki/Vandenberg_Space_Force_Base),
[Baikonur Cosmodrome](https://en.wikipedia.org/wiki/Baikonur_Cosmodrome),
[Cape Canaveral Space Force Station](https://en.wikipedia.org/wiki/Cape_Canaveral_Space_Force_Station),
[Mid-Atlantic Regional Spaceport](https://en.wikipedia.org/wiki/Mid-Atlantic_Regional_Spaceport),
and OpenStreetMap Nominatim answers for Baikonur, Vandenberg and Kourou (a Dombarovsky query returned nothing). Nominatim terms: [usage policy](https://operations.osmfoundation.org/policies/nominatim/).

Both Wikipedia and OpenStreetMap are secondary and edited by volunteers. Wikipedia pages disagree with each other (for example the Vandenberg page and the spaceports list differ by about 0.08 degrees of longitude). I did not open an operator or government source. Treat this as a consistency check, not proof.

### B. Checking our values

Source values are degrees, converted by me from the degrees, minutes, seconds the pages show. "WP list" is the spaceports list, "OSM" is Nominatim. "Distance" is the great-circle distance from our pin to the nearest and farthest source point. One degree of latitude is about 111 km, so rounding to 0.1 degree alone allows up to about 8 km of error.

| Code | Ours (lat, lon) | Source values | Distance km | Verdict |
|---|---|---|---|---|
| AFETR | 28.5, -80.6 | WP list 28.467, -80.559; Cape Canaveral page 28.489, -80.578 | 2 to 5 | MATCHES |
| AFWTR | 34.7, -120.6 | WP list 34.772, -120.601; Vandenberg page 34.751, -120.520; OSM 34.709, -120.545 | 5 to 9 | MATCHES within 9 km. Not equal to any single source rounded to 0.1 (the sources themselves spread about 9 km) |
| ANDSP | 69.3, 16.0 | WP list 69.294, 16.021 | 1 | MATCHES |
| DLS | 51.1, 59.8 | WP list (Yasny) 51.207, 59.850; air base page 51.049, 59.853; ICBM base on the same page 50.803, 59.516 | 7 to 39 | DIFFERS or unclear. The air base is about 7 km away, the list point about 12 km, the ICBM base about 39 km. Needs an operator source |
| FRGUI | 5.2, -52.8 | Guiana page 5.169, -52.690; Vega complex 5.236, -52.775; Ariane 5 complex 5.239, -52.768; Soyuz complex 5.305, -52.834; OSM 5.212, -52.774 | 3 to 13 | MATCHES. The centre point and the complexes span about 0.14 degrees of latitude (about 15 km) |
| JSC | 41.0, 100.3 | WP list 40.961, 100.298 | 4 | MATCHES |
| KODAK | 57.4, -152.3 | WP list 57.435, -152.339 | 5 | MATCHES |
| KSCUT | 31.3, 131.1 | WP list 31.252, 131.079 | 6 | MATCHES |
| NSC | 34.4, 127.5 | WP list 34.426, 127.528 | 4 | MATCHES |
| PLMSC | 62.9, 40.6 | WP list 62.926, 40.578 | 3 | MATCHES |
| RLLB | -39.3, 177.9 | LC-1 page -39.261, 177.866 | 5 | MATCHES |
| SEMLS | 35.2, 53.9 | WP list 35.235, 53.921 | 4 | MATCHES |
| SRILR | 13.7, 80.2 | WP list 13.737, 80.235 | 6 | MATCHES |
| STARB | 26.0, -97.2 | WP list 25.996, -97.154 | 5 | MATCHES |
| TAISC | 38.8, 111.6 | WP list 38.849, 111.608 | 6 | MATCHES |
| TANSC | 30.4, 131.0 | WP list 30.391, 130.968 | 3 | MATCHES |
| TYMSC | 46.0, 63.3 | WP list 45.955, 63.350; Baikonur page 45.965, 63.305; Site 1 45.920, 63.342; OSM 45.918, 63.408 | 4 to 12 | MATCHES. The sources spread about 10 km. Baikonur Site 31 (45.996, 63.564) and Site 81 (46.071, 62.985) are about 45 km apart by my arithmetic |
| VOSTO | 51.9, 128.3 | WP list 51.883, 128.333 | 3 | MATCHES |
| WLPIS | 37.9, -75.5 | WP list 37.846, -75.479; spaceport page 37.843, -75.478; Pad 0A 37.834, -75.488 | 6 to 7 | MATCHES within 7 km. Latitude rounds to 37.8, ours says 37.9 |
| WSC | 19.6, 111.0 | WP list 19.614, 110.951 | 5 | MATCHES |
| XICLF | 28.2, 102.0 | WP list 28.246, 102.028 | 6 | MATCHES |
| YUN | 39.7, 124.7 | WP list 39.660, 124.705 | 4 | MATCHES |

Codes that exist in our data but have no pin: `ERAS`, `WRAS` (airspace), `JJSLA`, `SCSLA`, `YSLA`, `SEAL` (sea launch areas), all deliberate, and `SMTS` (Shahrud Missile Test Site, Iran), a land site. The list page gives Shahrud as 36.420, 55.020 (36 25 12 N, 55 01 12 E). Not added by me because I do not edit `src/`.

Pin placement note: a site code covers a whole range, not one pad. The Eastern Range (`AFETR`) spans Cape Canaveral and Kennedy. Our pin is a place marker, which is fine for a globe, but not for "distance to the pad".

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [Launch Library 2](https://thespacedevs.com/llapi) | Pads and locations. The location list I fetched (`/2.2.0/location/?mode=list`) gave names and countries but no coordinates | "15 non-authenticated requests per hour". Whether pad records carry coordinates is not stated on the page I opened |
| [CelesTrak launch site codes](https://celestrak.org/satcat/launchsites.php) | The official code list; shows which codes are sea or airspace | No coordinates. Google Maps links per site, per the page |
| [Space-Track](https://www.space-track.org/documentation) | Launch site tables | The page references them but does not show them |
| [OSM Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | An independent point per named place | "an absolute maximum of 1 request per second". Results "must be cached". Attribution needed. Heavy or geocoding-centred apps must run their own service |

---

## 11. Share cards and sharing (`src/share.js`, `actions.saveCard` in `src/main.js`)

### What it uses now

A 1080 by 1350 canvas card, `canvas.toBlob`, then `navigator.share` with a file if `navigator.canShare` allows it, otherwise a message. Reminders use a Google Calendar "add event" link.

Primary pages opened:
[MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share),
[MDN navigator.canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare),
[MDN canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).

### B. Checking our values and logic

| Item | Source | Result |
|---|---|---|
| Secure context and button click | MDN: "available only in secure contexts (HTTPS)". "It must be triggered off a UI event like a button click" | MATCHES: `saveCard` runs from a button. The code awaits `toBlob` before calling `share`. I did not test on a device whether the click still counts as a user action at that point, so test on real phones. |
| Files | MDN: "To share files, first test for and call `navigator.canShare()`" | MATCHES. |
| Support | MDN: "Limited availability. This feature is not Baseline because it does not work in some of the most widely-used browsers" | Needs a real fallback such as a download link. Our fallback message tells people to press and hold the picture. |
| Cancel | MDN: AbortError means "The user canceled the share operation or there are no share targets available" | We treat AbortError as "Cancelled". The "no share targets" case would show the same text. |
| PNG | MDN toBlob: unsupported types are exported as `image/png`. Tainted canvas gives a SecurityError | MATCHES. The card draws only local data, so no taint unless an outside image is added later. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| [Open Graph protocol](https://ogp.me/) | Link previews: required `og:title`, `og:type`, `og:image`, `og:url`; `og:image:width`, `:height` and `:alt` recommended | Open Web Foundation Agreement 0.9, "This website is Open Source" |
| [Facebook sharing webmasters](https://developers.facebook.com/docs/sharing/webmasters/) | Preview behaviour | "Images are cached based on the URL and won't be updated unless the URL changes." No exact pixel size on the page I opened |
| [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545) (September 2009, Proposed Standard) | A `.ics` file for reminders that works in every calendar app. Mentions `UID`, `DTSTAMP`, `DTSTART` and alarms (`VALARM`) | Standard document |
| Google Calendar link | We use `calendar.google.com/calendar/render?action=TEMPLATE&text&dates&details&location` | COULD NOT CONFIRM from an official page. The only descriptions I found were third-party pages in search results, which I did not open |

---

## 12. Data hygiene (build scripts, `src/sgp4.js`, `public/meta.json`)

### What it uses now

`build_data.py` rejects an element set when a required field is missing, eccentricity is outside 0 to 0.99, mean motion is outside 0.05 to 20 revolutions per day, inclination is outside 0 to 180, an angle is outside 0 to 360, the epoch is more than a day in the future, or the set is over 90 days old. Duplicates keep the newest epoch. Age is stored in 4 hour steps.

The snapshot of 4 Oct 2026 14:19 UTC reports: 19,316 records kept, median element age 10.8 hours, 90th percentile 26.4, 99th percentile 127.6, maximum 713 hours, 439 older than 3 days, 150 older than 7 days.

### B. Checking our values and logic

| Item | Source | Result |
|---|---|---|
| Refresh no faster than 2 hours | CelesTrak GP page: "CelesTrak only checks for new GP data once every 2 hours". Usage policy: GP and SupGP every 2 hours, SATCAT "updates manually once or twice a day", directory queries "not more than once per hour", space weather every 3 hours, EOP once per day | The "every few hours" cadence in the app is consistent. |
| Stop on errors | Usage policy: "M2M software should immediately stop querying when it receives any non-HTTP 200 responses". "Repeatedly ignoring them will end up sending your IP address to the firewall." The page does not give numeric thresholds. A search result snippet mentioned limits of 50 errors in 2 hours and 100 MB a day; I did not find those on the page I opened | Build the relay to back off on any non-200. Thresholds COULD NOT CONFIRM. |
| Hourly cadence for Space-Track | Space-Track documentation: GP "Once every hour", SATCAT "Once per day after 1700 (UTC)" | Different from CelesTrak, so choose one source per job. |
| Element set age guidance | None of the pages gave a hard maximum age. CelesTrak column 4 number 5: accuracy depends on sensors, orbit type and space environment, and users should "independently assess the accuracy of each specific satellite". NASA: ISS data updated about 3 times a week. Heavens-Above: predictions get worse over time. Starlink preprint: about 1 km at 6 h, about 38 km at 7 d | COULD NOT CONFIRM a standard threshold. Showing "element age" next to each time, and flagging sets older than 3 days, is reasonable. |
| 90 day rejection, other range gates | No source | Our own rules. |
| SATCAT status and type codes | CelesTrak pages (see feature 2) | MATCHES. |
| Format | CelesTrak: developers are "strongly encouraged to use the recommended OMM XML standard". Once 5-digit numbers run out, "new data will not be able to be created using the TLE format" | Staying on JSON/OMM was right. |
| Scheduled refresh on GitHub | [GitHub Actions docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): "The shortest interval you can run scheduled workflows is once every 5 minutes". The `schedule` event "can be delayed during periods of high loads". "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." | This answers the open README question: yes, a quiet public repository would stop its scheduled runs after 60 days. |
| Cloudflare R2 and card | [R2 pricing](https://developers.cloudflare.com/r2/pricing/): free 10 GB-month, 1 million Class A and 10 million Class B operations per month, egress "Free". The page does not say whether a payment method is required | COULD NOT CONFIRM. |

### A. Other sources

| Source | What it adds | Licence, terms, limits, cost as stated |
|---|---|---|
| CelesTrak SupGP | Better elements for stations and Starlink | Feature 2 |
| Space-Track | The original catalogue and decay data | Feature 2 |
| [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | A place to run a cron-triggered relay and cache | Free plan: "100,000 per day" requests, "10 milliseconds of CPU time per invocation". Paid plan: "$5 USD per month" minimum, "10 million included per month", "$0.30 per additional million". "Cloudflare does not bill for subrequests". Cron triggers allow "15 minutes of CPU time" |

---

## Ranking: top 5 additions for about 500 rupees a month

I did not check the exchange rate. 500 rupees is roughly 5 to 6 US dollars on rates I know of, so check today's rate. The only line item with a price is the Cloudflare paid plan at "$5 USD per month", which would use nearly all the budget. Everything else below is free.

1. A relay and cache (Cloudflare Worker with a cron trigger). Start on the free plan; move to the $5 plan only if the free limits bite.
   Reason: MET Norway says browsers should not call it directly and wants a caching proxy. CelesTrak refreshes every 2 hours and firewalls IPs that ignore errors. FIRMS, N2YO and Space-Track keys must stay off the browser. GitHub scheduled runs stop after 60 days of no activity in a public repository. One server fetch per source then serves every visitor. It also lets you cache Open-Meteo, USGS, SWPC and GDACS calls so they stay inside their limits.
2. CelesTrak Supplemental GP for Starlink ("SpaceX-E" source), ISS (NASA OEM) and the Chinese station (CMS OEM), plus grouping trains by launch designator (`YYYY-NNN`).
   Reason: strings and passes are answers about time and direction, which need the best elements. Free, same JSON shape, already works with six-digit ids. The designator grouping removes the "two launches on one day" mistake.
3. Refresh `SHOWERS` from the IMO working list, and update it each year from the IMO calendar.
   Reason: it is the one table whose values disagree with the primary source (Southern Taurids, Draconid and Perseid rates). Free, an hour of work, and the IMO publishes year-specific maxima.
4. Real light-pollution data in place of the 2k texture average. Options: VIIRS annual nighttime lights (CC BY 4.0, about 500 m cells) or the Falchi 2016 atlas (confirm its licence first). Precompute one number per city or per 0.1 degree cell and ship it as a small file.
   Reason: sky glow drives the limiting magnitude, the stargazing score and what the sky view shows. Free. The current estimate is a coarse average over a few hundred km.
5. More hazard sources behind the relay: NASA FIRMS (fires, free MAP_KEY, 5000 transactions per 10 minutes), NHC storm feeds, NASA EONET (volcanoes and other events). Keep GDACS as the alert layer.
   Reason: GDACS alone gives you alerts, not detections. FIRMS adds near-real-time fire points, NHC gives official storm products, EONET covers volcanoes. All free. Check each page's terms again before launch: EONET and NHC pages state no licence.

Just below the line, all free: swap per-callsign route lookups for the CC0 VRS standing data files (the old endpoint redirects with `#deprecated`); add Open-Meteo as a backup cloud forecast (non-commercial only); add EMSC and GFZ Kp as backups for quakes and Kp; precompute a real travel-time table with TauP and PREM so "arrival in N seconds" is closer to reality; show element age beside each satellite time.

## Could not verify

Pages I could not open, or opened but that did not answer the question:

- International Meteor Organization: the website (www.imo.net) returned 503 to the fetch tool and showed a maintenance page ("The International Meteor Organization website is being rebuilt") when I used curl. The only calendar it offered was the 2027 PDF, which I read. I could not open the 2026 calendar or the live working list page. So the 2026 peak dates are not verified at the IMO.
- American Meteor Society calendar: 503. NASA meteors page loaded but had no calendar.
- ICAO Doc 8643 (aircraft type designators): 403. The aircraft table was checked against Wikipedia only. `CRJ7` and `C172` are therefore open.
- Smithsonian Global Volcanism Program (volcano.si.edu): 403 to the fetch tool and to curl, for every page I tried. A search snippet said the Volcanoes database is CC BY 4.0 and that the Smithsonian invites non-commercial use. I did not open that page. A Creative Commons wiki page that did load lists the licence only as "copyright". So the licence is unresolved.
- airplanes.live API guide: 403 (a browser challenge). Key and non-commercial terms unconfirmed; only the archived GitHub README (1 request per second) was read.
- OpenSky terms of use: 503.
- Falchi atlas data licence, resolution and units: the Science page returned 403, the GFZ repository file 403, and the GFZ data page loaded but showed only a title.
- NASA Earthdata data policy and the GIBS landing page on earthdata.nasa.gov: 403.
- X (Twitter) card documentation: 402. Facebook page loaded but gave no pixel sizes.
- USGS "Feed Lifecycle Policy" page (linked from the feed pages): 404. USGS ShakeMap manual on GitHub pages: 404.
- GDACS glossary page: 404. GDACS licence and attribution: not on the terms page. The EC legal notice and copyright notice linked from GDACS: not opened.
- IRIS traveltime web service: retired. NASA Spot the Station FAQ page: 404. Heavens-Above "AboutUs": 404. Mictronics aircraft database page: 404. Jonathan McDowell's Starlink statistics page: 404.
- Space.com Starlink train article and the English Wikipedia Starlink article loaded but had no train visibility details. I could not confirm how long strings stay visible.
- Heavens-Above, N2YO, USNO, JPL Horizons, CelesTrak SATCAT and GDACS pages did not state terms for automated reuse, as noted in the tables.
- The CelesTrak usage policy page did not state numeric block thresholds. A search snippet mentioned 50 HTTP errors in 2 hours and 100 MB a day; not confirmed.
- Wikipedia PREM page did not list layer depths or velocities; PREM values such as a 24.4 km Moho are from my memory and not verified.
- Spacetrack accuracy figures (about 1 km at epoch, about 1 to 3 km a day) are from a Wikipedia page that cites Vallado 2006. I could not read them in the primary text.
- The Starlink error figures come from a preprint summary page, not the paper.
- Official page for the Google Calendar "add event" link format: none found.
- Pad-level or operator-level launch site coordinates: no operator or government source was opened. Wikipedia and OpenStreetMap only.
- adsb.lol "asks to be contacted for heavy use" (README): not found on any page I opened.
- Exchange rate for the 500 rupee budget: not checked.
- Planet and Moon checks were for one place (Pune) and one night (5 Oct 2026); twilight and rise and set times were for the same place and day. Check other latitudes before relying on them.

## Checks I ran (not saved in the repository)

| Check | Method | Result |
|---|---|---|
| Civil twilight, Moon rise and set, Moon quarters | `aa.usno.navy.mil/api/rstt/oneday` for 18.52 N, 73.86 E on 2026-10-05 and `api/moon/phases/date` from 2026-10-01 against our `sunAltAz` and astronomy-engine | Same minute, except first quarter 1 minute apart and Sun rise and set 1 minute apart (astronomy-engine 06:25 and 18:19, USNO 06:26 and 18:20) |
| Planets and Moon | `ssd.jpl.nasa.gov/api/horizons.api`, observer table, same place, 00:00 and 03:00 UT on 2026-10-05 | Positions within 0.007 deg, magnitudes within about 0.05, Saturn about 0.13 |
| Sun altitude | Our `sunAltAz` against astronomy-engine, 5 places, 48 half-hour steps | Maximum difference 0.0053 deg |
| Sidereal time | Our `gmstDeg` against the USNO formula, 6 dates 2025 to 2040 | At most 0.006 s |
| Wave travel time | Our `waveTravelSec` against the TauP PREM example | About 753 s vs 566.77 s (P), about 1339 s vs 1028.61 s (S) |
| Swarm vs SGP4 | 5 fixture satellites, 0 to 72 hours | 4 to 146 km in this sample |
| Six-digit ids | satellite.js 7.1.0 with ids 99999, 100001, 123456 | Builds and propagates |
| OVATION grid | Read the JSON file | 65,160 points, 360 by 181 |
| Launch pins | Converted source degrees, minutes, seconds and computed great-circle distances | Table in section 10 |
| Aircraft names | Parsed the Wikipedia source text and compared codes | 53 of 55 names agree |
