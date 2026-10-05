# Sources for the home page text

Each statement in the text section of the home page (`<section id="about-home">`, written by `site/home-text.mjs` and added only by the content-site build) comes from the place named here, read from this repository on 2026-10-05. A statement that cannot be traced is left out. When a feature changes, update the matching sentence. The wording is original: it does not reuse the About page's sentences or the count page's text, and each of those pages answers its own question.

## Statements and where they come from
| Statement in the section | Source |
| --- | --- |
| A free 3D view of what is over a place you choose, what its sky holds tonight, and what is happening under and around it | README.md, opening paragraph; `docs/about-sources.md`, first row |
| Search for ISS and the globe turns to the station, drawing its orbit and the patch of Earth it can see | README.md, Globe ("Search flies the globe to a satellite or earthquake and shows its footprint, orbit"); `e2e.mjs` checks that searching "iss" puts ISS (ZARYA) first and that selecting it draws the footprint, track and orbit |
| Its card gives its height, speed and the age of the orbit data | `e2e.mjs` ("ISS card shows live height and speed"); README.md, Honest limits ("the age of the element set, which each card shows") |
| The orbit data comes from CelesTrak; positions are worked out on your device | README.md, Data sources and Live data table; the app's About sheet and satellite cards ("Positions are computed on your device", `src/panels.js`) |
| For the ISS, other bright objects and satellites launched in the last 30 days, pass times come from SGP4, the model that kind of orbit data is made for; other satellites use a faster, rougher approximation | README.md, Exact passes and Honest limits (about 200 objects use SGP4, everything else the fast two-body model); `docs/feature-sources.md`, section 3 (Spacetrack Report No. 3: SGP4 is the model for NORAD element sets); `docs/about-sources.md`, same statement |
| Choose any town or city of about 15,000 people or more, or your device's own position, which never leaves the device | README.md, Any place; `docs/about-sources.md` |
| A tile at the top says how many satellites are above that place now | `src/main.js`, stats strip (`"above"` tile, label "above <place> now", which opens the Sky view) |
| The Sky view draws them across your horizon, flashing when sunlit | README.md, Sky ("satellites that flash when sunlit") |
| Tap one for its name, how high it is, which way to face and how far away it is | `src/panels.js`, satellite card ("From <place>": degrees up, compass point, distance in km) |
| Starlink strings, lines of satellites from one recent launch, have their own sheet saying when one can be seen from your place | README.md, Starlink strings |
| Tonight: one verdict from the Moon, the dark hours, the chance of aurora and, in the six cities that have one, the cloud forecast | README.md, Tonight and Any place (cloud forecasts exist only for six cities); `src/tonight.js` ("Cloud forecast not available for this place" elsewhere) |
| A timeline of visible ISS and satellite passes, Starlink strings, planets and meteor showers near their peak, each with Show me (turns the Sky view to it) and Remind me (a calendar entry) | README.md, Tonight |
| The Sky view: first-person sky for any place, Moon and phase, planets, officially named stars, constellation figures, a slider through the night | README.md, Sky and Stars and constellations (IAU names) |
| A sky calendar looks 90 days ahead at Moon phases, eclipses, planet events and meteor showers | README.md, Sky calendar |
| The Under view: the Earth sliced open from an earthquake to you, crust, mantle and core, P and S waves; a teaching model | README.md, Under and Honest limits ("This is a teaching model") |
| Earthquakes from the U.S. Geological Survey | README.md, Live data table |
| Around you: storms, fires, hazards, quakes and aurora near your place, most serious first, each with its source and an "as of" time | README.md, Around you |
| Hurricanes come with the National Hurricane Center's forecast track and cone | README.md, Storms |
| The aurora screen shows NOAA's Kp index and your chance of seeing it | README.md, Aurora |
| A fire detection is a heat signal seen from orbit, not a confirmed wildfire | README.md, Fires (heat detections from three VIIRS satellites; "not a confirmed wildfire") |
| Aircraft appear over six cities only (Pune, New York, London, Tromso, Tokyo and Sydney), as 3D airliners in the sky | README.md, Sky and Any place; `docs/about-sources.md` |
| "What the app does not do" links to the About page's limits (`about/#limits`) | The safety line ("not an emergency warning service") is on the About page; the section links to it instead of repeating it |
| The count page counts the active satellites in our feed and is rebuilt after each data collection | README.md, Content site ("built from a data folder after each collection"); `docs/satcount-sources.md` (active = payload with status 1 to 5, our definition) |
| The app's "tracked objects" tile counts everything in the feed, debris included | `src/main.js` stats strip (label "tracked objects", value `D.meta.count`); `docs/handoff.md`, queued item 2; `docs/satcount-sources.md` (the feed holds payloads, rocket bodies and debris) |
| Satellites by country ranks their owners as the catalogue records them (shown only when the build has that page) | `docs/handoff.md`, queued item 1 (a hub page with a ranked table of owners, worded "as the catalogue records it"). NOT CONFIRMED on this branch: the hub is built on another branch, so this build does not link it; `site/build.mjs` adds the link only when `satellites-by-country/index.html` is among the built pages. Re-read the hub page's wording when the branches meet |
| Free to use; the code is open source under the MIT licence | `LICENSE`; README.md, Licence; `docs/about-sources.md` |
| The named sources: CelesTrak (orbits), USGS (earthquakes), NOAA (space weather and hurricanes), NASA FIRMS (fires), GDACS (floods and volcanoes), MET Norway (cloud forecasts), adsb.lol (aircraft), The Space Devs (launches) | README.md, Live data table and feature bullets; `docs/about-sources.md`, source list |
| Every card names its source; the Data status screen shows when each feed was last updated | README.md, Sources on every card and "What the app does with it"; `docs/about-sources.md` |
| The About page lists every source; How we know sets out the checks behind the reference pages | `site/pages-about.mjs` (sources table); `site/pages-guides.mjs` (methods page) |

## Numbers in the section
Only fixed figures that describe how the app works: satellites launched in the last 30 days (SGP4), the 90-day calendar, places of about 15,000 people or more. No object counts, percentages or dates, because they go stale; the count page shows its own numbers with their data time. `test/site.test.js` fails if any other number appears.

## Layout (for the owner to review)
- The section sits below the first screen, over the fixed app, as the design chose (`docs/superpowers/specs/2026-10-05-home-page-text-design.md`). The first screen is unchanged; `e2e-site.mjs` compares the stats strip, tab bar, canvas, top bar and layer chips with a build that has no section.
- "What is this? Read more" is a fixed link: hidden below 700px wide (phones reach the text from the About sheet's "What is this site? Read the overview"); from 700px to 899px at the right end of the place chip row, because the bottom of the screen there is the full-width tab bar with the layer chips above it; from 900px at the bottom left, level with the centred tab bar. Measured in Chromium on the built site on 2026-10-05: at 1280x800 the link box is x 16 to 195, y 743 to 779, the tab bar x 420 to 860, y 732 to 790, the layer chips x 608 to 1280, y 670 to 710; at 1440x900 the link is x 16 to 195, y 843 to 879, the tab bar x 500 to 940, the chips from x 768; at 768x1024 the link is x 573 to 752, y 62 to 98, beside the place and Tonight chips (which end near x 297). Widths depend on the font, so they move a little with the web fonts loaded (the tests block them).
- The link hides while the loader, a sheet or the search is open (CSS `:has`; a browser without `:has` simply keeps showing it).

## NOT CONFIRMED
- How the scrolling page behaves on real phones (the address bar hiding and showing as the page scrolls, iOS rubber banding). Tested only in Chromium with phone emulation. Touch on the app does not scroll the page (`touch-action: none`), so on a phone the text is reached from the About sheet link or a shared `#about-home` link.
- A mouse wheel over the app's controls (the tab bar, top bar, chips) rather than the globe scrolls the page towards the text; only the canvas keeps the wheel for zooming. Seen in Chromium on 2026-10-05. This may be useful or surprising; the owner may want to review it.
- Whether search engines rank text placed below a full-screen app. Nothing about search can be measured until the page is indexed.
- No personal name is used, and nothing about cookies, analytics, accounts or ads is claimed: none of it is recorded in the repository.
