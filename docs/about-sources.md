# Sources for the About page

Each statement on `/about/` and in the home page's description comes from the place named here, read from this repository on 2026-10-05. A statement that cannot be traced is left out. When a feature changes, update the matching sentence.

## Statements and where they come from
| Statement on the page | Source |
| --- | --- |
| Free tool; above you, in tonight's sky, under your feet, around you; everything drawn in 3D; tap any object or search by name; works for any place | README.md, opening paragraph and "What is in the prototype" (Globe, Sky, Under, Feed, Any place) |
| Globe: satellites, ISS, quakes, storms, fires, aurora; tap for details; search flies to a satellite or earthquake | README.md, Globe |
| Pass times for the ISS, other bright objects and satellites launched in the last 30 days come from SGP4 (the model designed for NORAD element sets); every other satellite uses a faster approximation | README.md, Exact passes (about 200 objects use SGP4; everything else uses the fast swarm model); `site/pages-guides.mjs` satellites guide for the model description |
| Starlink strings: satellites from one recent launch still in a line; says when one can be seen | README.md, Starlink strings |
| Aircraft above six cities, drawn as 3D airliners | README.md, Sky and Any place |
| Sky view: first-person 3D sky; Moon with phase, planets, stars, constellations, satellites; time slider | README.md, Sky |
| Tonight verdict from cloud, Moon, dark window, aurora chance; timeline of passes, Starlink strings, planets, meteor showers | README.md, Tonight |
| Stars: IAU name, constellation, brightness, colour, rise, highest and set times; constellation figures and boundaries | README.md, Stars and constellations |
| Sky calendar: next 90 days, Moon phases, eclipses, planet events, meteor showers, seasons; astronomy-engine | README.md, Sky calendar |
| Sky Lens: rear camera behind the sky; picture stays on the device | README.md, Sky Lens |
| Under view: Earth cut open, crust, mantle, core, P and S waves | README.md, Under |
| Around you: near your place, most serious first, source and "as of" time, links by distance and time only, never claims a cause | README.md, Around you |
| Launches: The Space Devs, wording matches how exact the time is, a month or quarter never gets a clock time | README.md, Launches; `docs/star-sources.md` |
| Share cards; shareable links; a red light mode that leaves only red light on the screen | README.md, Share cards and Phone and night use (the install-to-home-screen claim is NOT made: the README says it was not tried on a real phone) |
| Source list (USGS, GDACS, NHC, SWPC, NASA FIRMS, CelesTrak, adsb.lol, MET Norway, The Space Devs, JPL, IAU, HYG, NASA Exoplanet Archive, GeoNames, astronomy-engine) | README.md, "Live data" table and feature bullets; `site/pages-guides.mjs` source lists; addresses read from `docs/*.md` and `pipeline/config.py` (GeoNames and NASA Exoplanet Archive are named without a link because no address is recorded in the repository) |
| Collector asks each source no more often than its published guidance allows, where the source gives any (several sources state none), keeps the last good copy; LIVE only when live data is in use, otherwise SNAPSHOT; Data status screen shows fresh, retrying, stale or paused | README.md, "Live data" (the table says where a limit is not stated) and "Sources on every card" |
| A feed changes as often as its source does, from every minute for earthquakes to every two hours for satellite orbits | README.md, "Live data" table (USGS "Updated every minute"; CelesTrak "once every 2 hours"). No delay estimate is given on the page. |
| No weather or hazard forecasts of its own; storms, fires, quakes and aurora are what the agencies publish, with their times | `site/pages-guides.mjs` methods page ("The live app is not forecast by us"); README.md, Around you ("nothing in it is predicted by this app"). The app does calculate pass times, the Tonight verdict and the calendar; the page does not claim otherwise. |
| Fire detection is a heat signal, not a confirmed wildfire | README.md, Fires |
| Cloud forecasts and aircraft for six cities: Pune, New York, London, Tromso, Tokyo, Sydney | README.md, Any place; `snapshot.json` cities |
| Sky Lens is new and has not yet been tested on a real phone; it has been tested in a browser with a fake camera; its starting field of view is a guess | README.md, Sky Lens ("Tested in a real browser with a fake camera, not on a phone"; 60 degrees is a guess); `docs/handoff.md` open item on real-device checks |
| Its starting field of view is a guess that you adjust by pinching | README.md, Sky Lens ("Pinch to zoom until the sky matches the picture: the start value of 60 degrees is a guess") |
| Active fire detections come from three VIIRS satellites (NASA FIRMS) | README.md, Fires ("heat detections from three VIIRS satellites") |
| You can choose to use your device's position; it is used on the device to name your place and never leaves it; the camera picture is never recorded or sent | README.md, Any place and Sky Lens |
| Place search covers towns and cities of about 15,000 people or more | README.md, Any place (GeoNames) |
| Free; the code is open source under the MIT licence (data and images keep their sources' terms); code on GitHub | `LICENSE`; README.md, licence section |
| Feeds update while you watch; new quakes, hazards, aurora, Kp, cloud forecasts and aircraft appear without a reload; new satellite orbits show a Reload prompt; the app falls back to a snapshot and the clock chip says SNAPSHOT | README.md, "Live data", "What the app does with it" |
| Moon phases, seasons and solar eclipses compared with US Naval Observatory tables at build time; a page only quotes a check that ran | README.md, Content site; `site/verify.mjs` |

## Statements in the author's own words (for the owner to review)
- "It is not an emergency warning service. For safety information, follow your local authorities." The second sentence follows the fires guide's wording ("For safety information, follow your local authorities"); the first is a standard caution that is not in the README.
- "Sky Lens is new and has not yet been tested on a real phone." The README says it was tested in a browser with a fake camera, not on a phone, so this is sourced; the owner may prefer to leave the statement out until a phone test is done.
- No personal name is used on the page.

## What the page does not say
- Any count of objects, tests or pages (they change). The satellite count page shows its own numbers with their data time.
- Any delay estimate, or a per-source table of refresh intervals (they can drift). The page gives only the range "from every minute for earthquakes to every two hours for satellite orbits", sourced from the README's "Live data" table, and points to the app's Data status screen.
- Anything about cookies, analytics or accounts: not recorded in the repository, so not claimed.

## llms.txt
- `/llms.txt` follows the format described at https://llmstxt.org/ (read 2026-10-05). That page says thousands of sites publish one and that AI labs publish them for their developer documentation; it does not claim that search engines or assistants read them for ordinary sites. Google's page on AI features says no extra files or markup are needed. So it is an optional extra, written only when the site is indexable.
