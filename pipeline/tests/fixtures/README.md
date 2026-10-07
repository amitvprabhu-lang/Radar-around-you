# Test fixtures

Real responses fetched on 2026-10-04 and trimmed (never edited). They let the validators and the runner be tested against what
the sources actually send.

| File | Source | Trim |
|---|---|---|
| usgs_week_60.geojson | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson | first 60 events |
| gdacs_orange_red.json | https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Orange;Red | the one current event, the 6 most recently ended, the 4 oldest |
| gdacs_green.json | same, alertlevel=Green | first 10 |
| ovation_latest.json.gz | https://services.swpc.noaa.gov/json/ovation_aurora_latest.json | whole file, gzipped |
| kp.json | https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json | whole file |
| met_pune.json | https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=18.5204&lon=73.8567 | whole file |
| planes_pune_80.json | adsb.lol v2/point near Pune | whole answer (26 aircraft) |
| gp_active_300.json, gp_stations_6.json, gp_visual_30.json, gp_debris_groups.json | CelesTrak GP JSON | stations, visual, a random 260 of the active list, 10 per debris group |
| catalogue_sample.json | CelesTrak SATCAT records and name tables, built with pipeline/catalogue.py | the objects above only |
| geonames_cities_sample.txt | https://download.geonames.org/export/dump/cities15000.zip (cities15000.txt) | 10 rows: eight larger cities by name, plus the first three rows of the file (GeoNames data, CC BY 4.0) |
| swpc_wind_active_420.json, swpc_mag_active_420.json | https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json and rtsw_mag_1m.json | the newest 420 rows from the spacecraft flagged active plus the 30 newest from the others, kept in the source's order (newest first) |
| swpc_alerts_sample.json | https://services.swpc.noaa.gov/products/alerts.json | 40 of the 72 messages: the geomagnetic warnings, alerts and watches, one electron and one proton message |
| nhc_current_storms.json | https://www.nhc.noaa.gov/CurrentStorms.json | whole file (two storms) |
| nhc_ep182026_030_track.kmz, nhc_ep182026_030_cone.kmz | the forecastTrack and trackCone kmzFile links inside nhc_current_storms.json for Rachel, advisory 30 | whole files |
| firms_snpp_500.csv, firms_noaa20_300.csv | https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv and noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv | the header and the first 500 and 300 rows |
| nhc_ep152026_track.kmz, nhc_ep152026_cone.kmz | the forecastTrack and trackCone kmzFile links for Nolo, advisory 56 (a storm that crosses the dateline) | whole files |
| iau_csn_sample.txt | https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt | the header, the first 30 rows, and Sirius, Mebsuta (blank component column), Geminga (pulsar, no magnitude) and Castor (multiple star) |
| stars_sample.json | the app's star catalogue source (raw/stars6.json, Hipparcos numbers as ids) | the features for the stars named in the sample above plus the first 10, in catalogue order |
| satcat_sample.csv.gz | https://celestrak.org/pub/satcat.csv, downloaded once on 2026-10-07 (Last-Modified 04:04:48 UTC) | gzipped; for each of the 24 owners with a page, up to 7 objects in Earth orbit of each kind (debris largest radar cross-section first, the rest newest launch first), filled up to 35 objects by catalogue number (110 for US, PRC and CIS, 75 for IND, so some pages have more than 60 objects), plus their two latest and one earliest re-entered objects; 12 TBD, 10 BEL, 8 NATO, 6 FIN; every docked object and every IND and PRC object around another body. Rows are unchanged and in catalogue order. `test/fixtures/satcat/` is what the collector publishes for it (`python3 -m pipeline.tests.test_satcat --write`). |
| jpl_cad_60d.json | https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&sort=date&fullname=true | whole answer (31 close approaches, requested 2026-10-04) |
