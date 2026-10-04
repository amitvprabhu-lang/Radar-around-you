# Radar Around You (prototype v2)

A free, global, real-time 3D tool that shows what is above you (satellites, the ISS, aircraft), in the sky tonight (stars, Moon, planets, aurora), under your feet (earthquakes cut open through the Earth) and around you (storms, fires, floods). Everything is drawn in 3D, and every object can be tapped for details or searched for by name.

This is a standalone project.

## What is in the prototype

- **Globe**: photoreal Earth with real NASA cloud imagery, 19,316 tracked objects moving on the GPU, quakes, hazards, aurora oval, new launches pulsing gold. Tap anything for details. Search flies the globe to a satellite or earthquake and shows its footprint, orbit and shaking map.
- **Sky**: first-person 3D sky above a chosen place. Gradient sky from the Sun's altitude, Milky Way, constellations, Moon with phase, planets, satellites that flash when sunlit, 3D airliners with contrails and navigation lights, aurora curtains. Dark-sky toggle, "Tonight" time slider, best-time planner, Guide me arrow, phone-sensor look-around.
- **Under**: the Earth cut open through an earthquake and you, with crust, mantle and core, and P and S waves travelling to you.
- **Feed**: newest quakes, newest launches, aircraft above you, tonight and space weather, each with a Replay or Show action.
- **Tonight** ("Will I see it tonight?"): one verdict for your place (cloud, Moon, dark window, aurora chance) and a timeline of what to look for: visible satellite and ISS passes, Starlink strings, planets, meteor showers near their peak. Each item has Show me (jumps the Sky view to that time and turns to it) and Remind me (a calendar link).
- **Starlink strings**: satellites from one recent launch that are still in a line. Found by comparing exact SGP4 positions of every satellite from the same launch. The home screen shows how many there are; the sheet says when one can be seen from your place.
- **Exact passes**: the ISS, other bright objects and everything launched in the last 30 days use SGP4 (about 200 objects, `public/precise.json`). Pass times on their cards come from SGP4. Everything else uses the fast swarm model.
- **Stars and constellations**: tap a named star for its official IAU name, Bayer designation (for example α Canis Majoris), constellation and its meaning, brightness and rank, colour, and when it rises, is highest and sets for your place. Tap a constellation name in the sky (turn on Star lines) for its IAU name, meaning, pronunciation, size, brightest star, best month, how it sits over your place and what planets are inside it, with its boundary and figure drawn in the sky. A Boundaries chip draws all 88 IAU boundaries. The Guide button lists every constellation, with the ones above the horizon first. Search finds stars and constellations by name or meaning. 331 stars carry IAU names; distances and spectral types are not shown yet because no source with a licence we can use has been chosen.
- **Any place**: search any town or city (GeoNames, about 34,000 places of 15,000 people or more), or use your device's exact position, which is named for the largest place within 25 km and never leaves the device. The sky, calendar, Tonight and the screens below work for any place. Cloud forecasts and aircraft overhead exist only for the six cities the collector fetches for.
- **Aurora**: Kp now with NOAA's geomagnetic storm scale in NOAA's own words, the NOAA warnings in force, your chance of aurora from NOAA's 30 to 90 minute forecast, and the last six hours of solar wind speed and magnetic field (Bz) drawn from live spacecraft data.
- **Storms**: every storm NHC is tracking, with its position, wind in knots, km/h and mph, pressure, movement, a map with NHC's forecast track and cone of uncertainty (the cone's own caveat is quoted), Saffir-Simpson category, and distance to you. Cyclones outside NHC's areas are listed from GDACS with a warning that its wind figure is one number for the whole storm.
- **Fires**: heat detections from three VIIRS satellites in the last 24 hours (about 190,000), grouped in 0.25 degree cells and drawn on the globe, with counts within 25, 50 and 100 km of you and the strongest clusters worldwide. A detection is a heat signal, not a confirmed wildfire.
- **Around you**: the storms, fires, hazards, quakes and aurora that are near your place, most serious first. Each has its source and "as of" time. It links things only by distance and time and never claims one caused another; nothing in it is predicted by this app.
- **Phone and night use**: deep links (`#sky`, `#aurora`, `#storms`, `#fires`, `#calendar`, `#tonight`, `#place=pune&sky`, `#place=pos_-12.05_-77.04`) so any screen and place can be shared or bookmarked; a Red light mode that leaves only red light on the screen; the screen stays on in the Sky view where the browser allows it; the app can be installed to a home screen and opens offline (a service worker keeps the page and bundled data, and always asks the network first for live data). The installable and offline parts are tested with the worker's real code against fake caches, but have not been tried on a real phone.
- **Share cards**: a 1080 by 1350 picture and a text version for an earthquake, a satellite pass, a Starlink string or Tonight. Saved through the viewer's download permission when the host gives it, else the phone's share sheet, else press and hold.
- **Sky calendar**: the next 90 days from your place: Moon phases, lunar and solar eclipses (with whether you can see them), oppositions and greatest elongations of the planets, close pairings of two naked-eye planets, equinoxes and solstices, and meteor shower peaks with the Moon's phase and how high the radiant gets from your latitude. Times come from the astronomy-engine library; Moon phases, seasons and solar eclipses are tested against the US Naval Observatory's published tables for 2026 and 2027 (99 phases to the minute). The home screen shows the next notable event. Lunar eclipses and planet events are checked for consistency only, because the USNO API has no table for them.
- **Sources on every card**: each card says where its information comes from, with a link where the source has a page (USGS event page, GDACS report, CelesTrak, adsb.lol), and a quake card says whether USGS has reviewed it. The clock chip says LIVE only when live data is in use; otherwise SNAPSHOT.
- **Data health**: the pipeline drops duplicates (keeps the newest epoch), rejects invalid records, stores each object's element age, and reports counts in the About sheet.

## Commands

```
npm ci                  # install (three, astronomy-engine, satellite.js, esbuild)
npm test                # 185 unit tests for the app, no browser needed
npm run test:pipeline   # 125 tests for the data pipeline (Python, standard library only)
npm run build           # bundles src/ into one page: dist/radar.html (live mode: it looks for a live/ folder)
npm run build:snapshot  # the same page with live polling switched off: dist/radar-snapshot.html
npm run e2e             # 258 browser checks on the snapshot build, phone and desktop windows (needs Playwright, see below)
npm run e2e:live        # 76 browser checks of live mode: new publishes, stale, failing, paused and offline states, and the aurora, storm and fire screens
npm run pipeline -- --data live --baseline public   # one collector run (needs CONTACT_EMAIL, see Live data)
npm run data            # repacks raw/ and raw2/ into the bundled snapshot in public/ (needs python3)
```

The page loads its data from `public/` with relative URLs, so any static host works. To try it locally, serve `dist/radar.html` and `public/` from the same folder root.

`harness.mjs` serves the built page and `public/` inside Chromium through Playwright routes, because the sandbox proxy blocks localhost. It expects Playwright at `/opt/node-tools/node_modules/playwright`, which is specific to the build sandbox. Change that one path on another machine.

## Live data

The app can run on bundled data (a snapshot taken on 4 Oct 2026) or on data that a collector keeps fresh. The collector is the `pipeline/` folder. It fetches each source on its own schedule, checks it, keeps the last good copy if anything goes wrong, and writes plain static files plus a `manifest.json` that says what is current and how fresh. The page reads that manifest, uses the live files, and keeps polling while it is open.

**What is live, and how often it is asked** (each interval is tied in `pipeline/config.py` to the source page or response headers it came from, or marked as our own choice):

| Feed | Source | We ask | The source says |
|---|---|---|---|
| Earthquakes | USGS | every 10 min | feed page: "Updated every minute" |
| Storms, floods, fires, volcanoes | GDACS | every 15 min | feed page: "updated every 6 minutes" |
| Aurora forecast | NOAA SWPC | every 15 min | a 30 to 90 minute forecast; refresh interval not stated |
| Kp | NOAA SWPC | every 30 min | refresh interval not stated |
| Solar wind, magnetic field, geomagnetic alerts | NOAA SWPC | every 10 min | one-minute rows; response headers `max-age=60` |
| Tropical storms with forecast track and cone | NOAA NHC | every 15 min | response headers `max-age=300`; advisories about every 6 hours |
| Active fire detections (3 VIIRS satellites) | NASA FIRMS (LANCE) | every 60 min | LANCE says near real-time users usually need data "within three hours"; not confirmed on a FIRMS page |
| Cloud forecast per place | MET Norway | every 60 min | do not repeat before the `Expires` header (about 30 min) |
| Aircraft per place | adsb.lol | every 10 min | rate limits not stated |
| Satellite orbits | CelesTrak | every 2 hours | "updates are once every 2 hours" |
| Satellite catalogue | CelesTrak | once a day | not stated |

Not live yet, and listed as such in the app's Data status sheet: stars, coastlines, textures and the cloud image, flight routes and airlines, and the shaking maps for individual quakes.

**What the app does with it.** New quakes, hazards, aurora, Kp, cloud forecasts and aircraft appear without a reload. New satellite orbits change the numbering of every object, so the app shows a "Reload" prompt instead of swapping them in. Every feed has a stale limit; the Data tile at the start of the stats strip, the dot on the clock and the Data status sheet show fresh, retrying, stale or paused states, when each feed was last confirmed current, what its source says about itself, and its credit. If the data folder cannot be reached the page keeps what it has and says so. If a live file fails at start the bundled copy is used for it.

**How the collector behaves.** Every request carries an identifying User-Agent with your contact address. A failed or invalid answer never replaces good data. Repeated failures back off, up to 8 times the normal interval. CelesTrak's policy says to stop at the first non-200 answer and tell a person, so on one it stops, makes no retry and does not follow redirects, waits 6 hours (our choice) and then tries once; the run exits with code 2 so a scheduler shows a failed job. Output files are written under a version folder named for the fetch time, and each feed's files share one version, so a reader can never mix two builds.

**Running it.**

```
export CONTACT_EMAIL=you@example.com     # sent to the sources in the User-Agent
npm run pipeline -- --data live --baseline public
```

Serve `dist/radar.html`, `public/` and `live/` from one folder root and open the page. `npm run pipeline -- --list` prints each feed with what its source says.

**Scheduling.** `.github/workflows/live-data.yml` runs the collector about every 10 minutes and publishes its output to a `data` branch of the repository as a single commit. It needs a repository secret named `CONTACT_EMAIL`. `.github/workflows/ci.yml` runs the unit tests on every push. Both were written from GitHub's documentation and have not been run yet.

**Serving it is not decided.** The page needs `live/` next to it. Two ways exist: serve the `data` branch next to the page (for example with GitHub Pages), or copy the folder to any static host. Neither has been tried. The bundled preview on claude.ai cannot reach any feed, so it is built with live polling off and shows the snapshot, and the Data tile says so.

**Not tested here.** The build sandbox's connection to CelesTrak is reset mid-request, so a live download of element sets and the daily catalogue build have not been run against the real service. The satellite path was tested at full size with the real 7 MB download served through the real runner, and the CelesTrak behaviour (one request, no retry, halt on any refusal) is tested with a fake network. The first scheduled run will be the first real one.

## Layout

```
src/        the app: core.js (all the maths), sgp4.js (exact orbits), trains.js (Starlink strings), tonight.js (the
            Tonight plan), share.js (share cards), live.js (reads the manifest, polls, freshness), data.js, boot.js,
            orbit.js, sky.js, under.js, models.js, stars.js, shaders.js, info.js, plan.js, panels.js, dom.js,
            engine.js, main.js
pipeline/   the collector: config.py (feed registry), net.py, validate.py, pack.py, catalogue.py, feeds.py,
            runner.py, run.py, and tests/ with real trimmed responses as fixtures
.github/    the scheduler and test workflows
test/       unit tests, checked against satellite.js, astronomy-engine and the real packed data
            (test/fixtures/gp-sample.json holds five real CelesTrak element sets, so the tests need no downloads)
public/     packed data and textures that the page fetches (about 2.6 MB raw)
template.html   page shell and all CSS
build.mjs   esbuild bundler
e2e.mjs, e2e-live.mjs, harness.mjs, smoke/   browser tests and debugging scripts
build_data.py, fetch_*.py, build_snapshot.py   data pipeline (inputs live in raw/ and raw2/, which are git-ignored and not in the repository; the fetch scripts read your contact address from the CONTACT_EMAIL environment variable and put it in the User-Agent header, as the data providers ask)
docs/       research reports, the technical plan, screenshots from the latest end-to-end run
v1/         the first prototype, kept for reference
```

## Measured on 4 Oct 2026 (re-measure before quoting)

- Page (HTML, CSS and JavaScript): about 1,005 KB raw, about 241 KB with Brotli. three.js is about 726 KB of that after tree-shaking. The growth since the first prototype is our new code plus satellite.js; I did not measure them separately.
- `precise.json` (exact orbits): about 25 KB raw, about 7 KB with Brotli, fetched after the first picture.
- First picture: about 1.3 MB with Brotli (page plus the satellite file and the 2k Earth textures).
- Everything loaded after the first frame (names, details, shaking maps, routes): about 100 KB with Brotli.
- A 4k Earth map (about 480 KB) is fetched only when someone zooms in on a device that is not in low-quality mode and not on data saver.
- Per-frame JavaScript work in a desktop browser: satellite positions cost almost nothing on the CPU (they are computed in the vertex shader). The catalogue scan for "what is above me" costs about 1.5 ms per frame while it runs, spread over a few frames every 2.5 s. A tap on the globe costs about 9 ms. These are desktop numbers; a low-end phone will be slower.

## Data sources

CelesTrak (orbits and the satellite catalogue), USGS (quakes, ShakeMap, PAGER), GDACS (hazards), NOAA SWPC (aurora, Kp), NASA GIBS (cloud imagery) and Blue Marble (Earth), adsb.lol (aircraft and routes), OpenFlights (airlines), MET Norway (cloud forecasts), a Hipparcos-based star catalogue.

## Honest limits

- Without a live folder the data is a snapshot taken on 4 Oct 2026. Within 36 hours of the newest orbit data the clock is real time; after that it counts forward from it.
- Aircraft move on a short looping animation from where they were when observed, not by the real time since the observation.
- The hazard list now includes Orange and Red alerts and pages through GDACS. An ended event stays listed for 7 days (our choice). GDACS says its results are model output that "should not be used for decision making" on their own.
- Satellite positions on the globe use a fast two-body orbit with J2 drift, good to tens or a few hundred kilometres over a day or two. About 200 objects (the ISS, bright objects, launches of the last 30 days) use exact SGP4 for passes and strings; everything else falls back to the fast model, and its cards say so. SGP4 itself is only as good as the age of the element set, which each card shows.
- Tonight's cloud figure is a forecast from MET Norway sampled in the snapshot, so it is stale after the snapshot day. The verdict is a simple score, not a measured seeing report.
- A meteor shower is listed only within 3 days of its peak. That limit is an editorial choice, not a published threshold. The table of dates, rates and radiants was copied by hand from Table 5 of the IMO 2027 meteor shower calendar (ten of its 39 rows). The IMO says the maximum dates are accurate only for 2027, so another year can be a day or so off.
- A Starlink "string" is a group from one launch in one orbital plane within 120 degrees of each other, visible when at least 3 are above the horizon and in sunlight. These thresholds are our own.
- Seismic waves use constant speeds (P 8.0 km/s, S 4.5 km/s) along straight lines. This is a teaching model.
- Aircraft and satellite 3D models are generic and not to scale. The Moon is drawn 3.5 times larger so its phase is visible.
- Sky glow is estimated from NASA night-light imagery, not measured.
- The cloud layer is a NASA daily composite from 3 Oct 2026 and shows swath seams.
- Phone-sensor look-around is implemented and its maths is tested with synthetic readings, but it has not been tried on a real phone.

## To verify before a public launch

- The two workflows, on the first real runs, and whether scheduled runs keep going: GitHub's documentation says scheduled workflows in a public repository are disabled after 60 days with no repository activity, and I have not checked whether the collector's own pushes count as activity.
- adsb.lol's ODbL 1.0 obligations for the aircraft data we republish, and its rate limits (not stated on the pages read).
- That MET Norway, GDACS and the NOAA files can be fetched by the collector from GitHub's runners (all but CelesTrak were fetched from the build sandbox).
- Launch site coordinates in `src/core.js` (`LAUNCH_SITES`) were written from public knowledge, not from a data feed.
- The aircraft type name table in `src/info.js` covers common types only. Check it against an official list.
- OpenFlights airline names can be out of date (for example a callsign prefix showing an old airline name).
- The meteor shower table in `src/tonight.js` against the IMO calendar for the current year (the IMO 2026 calendar could not be opened when it was checked), and the 3 day near-peak rule, which is an editorial choice.
- The Starlink string thresholds and the visible-pass wording against what people actually see.
- The limiting-magnitude and "sunlit and dark enough" rules behind pass visibility.
- Licence of the Moon texture (taken from the three.js examples).
- adsb.lol asks to be contacted for heavy use. MET Norway requires an identifying User-Agent.
- Whether Cloudflare R2 needs a card on file even for the free tier, and whether GitHub Actions scheduled runs keep going on a quiet public repository.

## Licence

The code is released under the MIT licence (see `LICENSE`). The data and images the app uses keep the terms of their sources, which are not all the same. In particular the star catalogue is Hipparcos-based and its licence is non-commercial, the Moon texture's licence still has to be confirmed, and aircraft data from adsb.lol is under ODbL 1.0. `docs/feature-sources.md` lists each source with what its own page says about reuse, and what could not be verified. Read it before using the project commercially.
