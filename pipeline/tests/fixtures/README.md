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
