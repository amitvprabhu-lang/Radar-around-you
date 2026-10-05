# Licence checklist before a public launch

Written 2026-10-05 from what this repository already records. Each statement names the file it comes from. Anything marked NOT CONFIRMED has not been checked with the owner of the data or against a primary page.

## What this is

A checklist of the licence questions that the app's Data status sheet and the research notes flag for a public launch. It covers the aircraft data, the star catalogue, the satellite data, and the other sources. It is not legal advice, and nothing here has been confirmed with the owners of the data. Re-read each source's own terms page before launch, because terms change.

The Data status sheet takes its text from `pipeline/config.py`. There the aircraft feed says its "attribution and share-alike conditions need reading before a public launch", and the star catalogue entry says "Non-commercial licence, see docs/feature-sources.md".

The code is MIT. The README's licence section says the data and images the app uses keep the terms of their sources (`README.md`, Licence).

## adsb.lol aircraft data

- Licence: the API page says "License: ODbL 1.0" (`docs/feature-sources.md`, section 7, Aircraft overhead; `pipeline/config.py`, the `planes` feed, "Pages read"). `pipeline/config.py` records the pages as read on 2026-10-04 (`READ_ON`). They were not re-read for this checklist.
- What the research notes say about ODbL 1.0: commercial use is allowed with attribution, and a database you publish must be shared under the same licence (`docs/Viral live data visualization ideas.md`, the source table). That is a research note's summary, not the licence text. NOT CONFIRMED against the licence text itself.
- Attribution: the credit line "Aircraft: adsb.lol (ODbL 1.0)" is in `pipeline/config.py` and shows in the app credits. The About page names adsb.lol, links to it and states ODbL 1.0 in its sources table.
- Share-alike: the collector's output for the aircraft feed (`planes.json`, written by `pipeline/feeds.py`) is published in the `data` branch and copied into the site's live folder (`docs/handoff.md`, live data items). Whether that counts as a published derived database under ODbL 1.0 is NOT CONFIRMED. If it does, the share-alike condition would apply to it. Ask adsb.lol, or read the licence text, before launch.
- Contact: the research notes say the owner asks production users to get in touch (`docs/Viral live data visualization ideas.md`; `docs/Live radar phase 1 technical plan.md`: "email them before launch as they ask"). The README says the same ("adsb.lol asks to be contacted for heavy use"), but `docs/feature-sources.md` says that statement was not found on any page that was opened. So the request to get in touch comes from the research notes and is NOT CONFIRMED on adsb.lol's own pages. Writing to them costs little, so write before relying on the data. A draft follows, for the site owner to send. Nothing has been sent.
- Rate limits: not stated on the pages read (`pipeline/config.py`, `says`). NOT CONFIRMED. The draft below states our actual rate, which is low.
- Route lookups use adsb.lol once at build time and are not refreshed (`pipeline/config.py`, the `routes` entry).

## Star catalogue

- The bundled star catalogue is described as Hipparcos-based with a non-commercial licence (`docs/feature-sources.md`, section 8, Sky view, which cites the ESA Hipparcos page: "CC BY-NC 3.0 IGO" and "Credit: ESA"; `README.md`, Licence).
- Provenance of the actual file (`raw/stars6.json`) is not recorded in the repository, and `docs/feature-sources.md` says it COULD NOT CONFIRM that the file is the d3-celestial data it resembles. So which licence applies to this exact file is NOT CONFIRMED.
- The site is free and, as built, shows no ads (the phase 1 plan in `docs/Live radar phase 1 technical plan.md` says "No ads in phase 1"). Keep it that way, or replace the file with one whose licence allows it, before any advertising or paid use. `docs/feature-sources.md` says adding ads or a paid tier would conflict with a non-commercial licence.
- Star details (distance, spectral type, luminosity, absolute magnitude) come from HYG v4.4, which is CC BY-SA 4.0. Because it is share-alike, `public/stardetails.json` and its source extract are offered under the same licence (`docs/star-sources.md`, HYG section; `README.md`, Star details; `raw3/HYG-NOTICE.txt`).
- The research notes say HYG redistributes Hipparcos-derived values under CC BY-SA while ESA labels Hipparcos CC BY-NC, and that the licence chain should be confirmed with the HYG maintainer before ads (`docs/Viral live data visualization ideas.md`). NOT CONFIRMED.

## CelesTrak

- The usage policy covers how often data may be requested and cached. It says nothing about republishing, redistributing, credit, commercial use or counts derived from the data (`docs/satcount-sources.md`, CelesTrak usage policy section, read 2026-10-05).
- Whether publishing aggregate counts (the satellite count page) is acceptable is NOT CONFIRMED. Silence is not permission. Consider asking CelesTrak directly. The mitigations recorded there are aggregate counts only, a visible credit and links to CelesTrak.
- The collector follows the policy's update interval and stops on the first non-200 answer (`pipeline/config.py`, the `satellites` feed).

## Other sources

- USGS: the pages read say USGS-authored data is in the US public domain, with a request for credit; not all material on the site is public domain (`docs/feature-sources.md`, section 4, Earthquake cutaway).
- NOAA and NWS (space weather, hurricanes): the NWS disclaimer says its web page information is in the public domain unless noted, with conditions on claiming it as your own, implying endorsement, or altering it (`docs/hazard-sources.md`, first NOAA section).
- NASA FIRMS: NASA supports full and open sharing of data and asks third parties to follow its acknowledgement, which the Fires screen shows (`docs/hazard-sources.md`, FIRMS section). The data is provided "as is".
- GDACS: licence, attribution, automated access and rate limits are not stated on the pages that were opened; the feed page links to an EC legal notice and copyright notice that were not opened (`docs/feature-sources.md`, section 5, Hazards layer). NOT CONFIRMED.
- MET Norway: the pages say NLOD 2.0 and CC BY 4.0, with the credit "The Norwegian Meteorological Institute, shortened MET Norway", and ask that requests identify the application (`docs/feature-sources.md`, the cloud forecast material in section 1; `pipeline/config.py`, the `clouds` feed).
- The Space Devs (Launch Library 2): its FAQ is quoted in `docs/star-sources.md` as saying you are free to use the data in any way and asks you to refrain from forwarding it without adding value. `docs/feature-sources.md` says a licence is not stated on the API page that was opened. The free tier is limited to 15 calls per hour, and the collector asks once an hour (`pipeline/config.py`, the `launches` feed). Reading of the FAQ as a licence is NOT CONFIRMED.
- Not covered here: the Moon texture's licence is still open (`README.md`, "To verify before a public launch"). Each remaining source's record is in `docs/feature-sources.md`, `docs/hazard-sources.md` and `docs/star-sources.md`.

## Draft note to adsb.lol

For the site owner to read, change and send. Nothing has been sent, and no name or address is filled in. The rate below is from `pipeline/config.py`: the aircraft feed's `refresh_s` is 600 seconds, and the collector makes one request per city on each run (`pipeline/feeds.py`, `_per_city`), with a one second pause between cities. The collector is scheduled about every 10 minutes (`SCHEDULER_STEP_S`, and the cron line in `.github/workflows/live-data.yml`). Check these against the files again before sending, because they are settings that can change.

> Hello,
>
> I run Radar Around You, a free site that shows satellites, aircraft, earthquakes and the night sky in 3D, with no ads. It uses your API for six cities only, asking about once every 10 minutes per city (one point query with a 150 nautical mile radius per city, with a one second pause between cities), and it looked up flight routes once, at build time. It credits adsb.lol under ODbL 1.0 in the app's credits and on its About page, and it publishes the collector's per-city aircraft output as a data file. Could you confirm that this use is acceptable, whether publishing that file needs anything more from my side, and whether you would like any other credit?
>
> Thank you,
> (the owner adds their own name here)
