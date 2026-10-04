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
- **Share cards**: a 1080 by 1350 picture and a text version for an earthquake, a satellite pass, a Starlink string or Tonight. Saved through the viewer's download permission when the host gives it, else the phone's share sheet, else press and hold.
- **Data health**: the pipeline drops duplicates (keeps the newest epoch), rejects invalid records, stores each object's element age, and reports counts in the About sheet.

## Commands

```
npm ci            # install (three, astronomy-engine, satellite.js, esbuild)
npm test          # 82 unit tests, no browser needed
npm run build     # bundles src/ into one page: dist/radar.html
npm run e2e       # 150 browser checks on a phone-sized and a desktop-sized window (needs Playwright, see below)
npm run data      # repacks raw/ and raw2/ into public/ (needs python3 with numpy, pillow, brotli)
```

The page loads its data from `public/` with relative URLs, so any static host works. To try it locally, serve `dist/radar.html` and `public/` from the same folder root.

`harness.mjs` serves the built page and `public/` inside Chromium through Playwright routes, because the sandbox proxy blocks localhost. It expects Playwright at `/opt/node-tools/node_modules/playwright`, which is specific to the build sandbox. Change that one path on another machine.

## Layout

```
src/        the app: core.js (all the maths), sgp4.js (exact orbits), trains.js (Starlink strings), tonight.js (the
            Tonight plan), share.js (share cards), data.js, boot.js, orbit.js, sky.js, under.js, models.js,
            stars.js, shaders.js, info.js, plan.js, panels.js, dom.js, engine.js, main.js
test/       unit tests, checked against satellite.js, astronomy-engine and the real packed data
            (test/fixtures/gp-sample.json holds five real CelesTrak element sets, so the tests need no downloads)
public/     packed data and textures that the page fetches (about 2.6 MB raw)
template.html   page shell and all CSS
build.mjs   esbuild bundler
e2e.mjs, harness.mjs, smoke/   browser tests and debugging scripts
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

- The data is a snapshot taken on 4 Oct 2026. Within 36 hours of the snapshot the clock is real time; after that it counts forward from the snapshot.
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
