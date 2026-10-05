"""The feed registry: what is fetched, from where, how often, and what each source says about itself.

Every cadence and rule quoted below comes from a source page read on READ_ON (its URL is in `doc`), or was measured
from the source's own HTTP headers on that day, or is marked OURS. Nothing here is from memory.
"""
from dataclasses import dataclass

READ_ON = "2026-10-04"
CITIES_FILE = "cities.json"      # in the baseline folder: the places the app has full data for
SCHEDULER_STEP_S = 600           # OURS: the scheduler is meant to run about every 10 minutes (GitHub's minimum is 5)


@dataclass(frozen=True)
class Feed:
    id: str
    label: str
    source: str       # who publishes it
    url: str          # what we fetch
    doc: str          # the page that states the cadence and terms
    says: str         # what that page, or the response headers, say about update frequency
    licence: str      # what the page says about licence or reuse
    credit: str       # the credit line the app shows
    refresh_s: int    # OURS: how often we ask
    stale_s: int      # OURS: age at which the app calls the data stale
    halt_group: str = ""  # sources whose policy says stop at the first non-200 answer


FEEDS = {f.id: f for f in [
    Feed("quakes", "Earthquakes", "U.S. Geological Survey",
         "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
         "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
         "Feed page: \"Updated every minute.\" Response headers: cache-control max-age=60.",
         "USGS Copyrights and Credits page: \"USGS-authored or produced data and information are considered to be in the U.S. Public Domain\"; credit is requested.",
         "Earthquakes: U.S. Geological Survey", 600, 2400),
    Feed("events", "Storms, floods, fires and volcanoes", "GDACS (Global Disaster Alert and Coordination System)",
         "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH",
         "https://www.gdacs.org/feed_reference.aspx",
         "Feed reference page: its popular feeds are \"updated every 6 minutes\". The cadence of the API we call is not stated on the page.",
         "Terms of use page: a disclaimer only (results are model output, \"may require further validation\", \"should not be used for decision making\" alone). A reuse licence is not stated on the page.",
         "Hazards: GDACS", 900, 3600),
    Feed("aurora", "Aurora forecast", "NOAA Space Weather Prediction Center",
         "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
         "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast",
         "Product page: \"a 30 to 90 minute forecast\". The refresh interval is not stated on the page; response headers: cache-control max-age=60.",
         "Not stated on the pages read.",
         "Aurora: NOAA Space Weather Prediction Center", 900, 3600),
    Feed("kp", "Geomagnetic activity (Kp)", "NOAA Space Weather Prediction Center",
         "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
         "https://www.spaceweather.gov/content/data-access",
         "The refresh interval is not stated on the page; response headers: cache-control max-age=60.",
         "Not stated on the pages read.",
         "Kp: NOAA Space Weather Prediction Center", 1800, 10800),
    Feed("spaceweather", "Solar wind and geomagnetic alerts", "NOAA Space Weather Prediction Center",
         "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
         "https://www.swpc.noaa.gov/content/data-access",
         "Rows are one minute apart. Response headers measured 2026-10-04 on rtsw_mag_1m.json and alerts.json: cache-control max-age=60. The page read does not state a refresh interval.",
         "NWS disclaimer page (weather.gov/disclaimer): NWS web page information is \"in the public domain, unless specifically noted otherwise\" and may be used if you do not claim it is your own, imply NOAA/NWS endorsement, or modify it and present it as official.",
         "Solar wind and alerts: NOAA Space Weather Prediction Center", 600, 3600),
    Feed("storms", "Tropical storms (Atlantic and Pacific)", "NOAA National Hurricane Center",
         "https://www.nhc.noaa.gov/CurrentStorms.json",
         "https://www.nhc.noaa.gov/gis/",
         "The GIS page lists the feeds. Response headers measured 2026-10-04: cache-control max-age=300. Advisories come about every six hours. Its KML says the official forecast track in KML format is an experimental product.",
         "NWS disclaimer page: public domain with the three conditions quoted for the space weather feed.",
         "Storms: NOAA National Hurricane Center", 900, 28800),
    Feed("fires", "Active fire detections", "NASA FIRMS (LANCE)",
         "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
         "https://www.earthdata.nasa.gov/earth-observation-data/near-real-time/firms/active-fire-data",
         "The LANCE page says near real-time users usually need data \"within three hours\"; the FIRMS pages themselves returned no text when read, so the latency for fire files is not confirmed from a primary page. Measured 2026-10-04: the 24 hour files were last modified within an hour of the request.",
         "LANCE page: \"NASA supports full and open sharing of data\"; third parties are asked to acknowledge LANCE (text in the credit below); the information is provided \"as is\".",
         "Fires: NASA FIRMS (LANCE), VIIRS 375 m", 3600, 14400),
    Feed("closeapproaches", "Asteroid close approaches", "NASA/JPL CNEOS (SBDB Close-Approach Data API)",
         "https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&sort=date&fullname=true",
         "https://ssd-api.jpl.nasa.gov/doc/cad.html",
         "The page describes \"current close-approach data\" and sets its defaults to \"NEO Earth close-approaches less than 0.05 au in the next 60 days sorted by date\". It states no refresh interval; every 6 hours is our choice. It asks users to check the payload's signature version (we require 1.5).",
         "Not stated on the page read.",
         "Asteroid close approaches: NASA/JPL CNEOS", 21600, 86400),
    Feed("launches", "Rocket launches", "The Space Devs (Launch Library 2)",
         "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=30&mode=normal&hide_recent_previous=true",
         "https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md",
         "The Space Devs FAQ: free access to Launch Library 2 is \"limited to 15 calls per hour\" and users are \"heavily\" encouraged to cache the output and avoid having user clients query the APIs directly. The API's api-throttle endpoint reported 15 requests per 3600 seconds on 2026-10-05. It states no refresh interval for the data; once an hour is our choice and uses a quarter of the allowance.",
         "The Space Devs FAQ terms of use: \"You are free to use the data in any way, shape, or form\"; accuracy of all the information is not guaranteed; \"Attribution is not mandatory, but is encouraged and appreciated\". Images carry their own licences (some are non-commercial), so none are used.",
         "Launches: The Space Devs (Launch Library 2)", 3600, 14400, "ll2"),
    Feed("clouds", "Cloud forecast", "MET Norway",
         "https://api.met.no/weatherapi/locationforecast/2.0/compact",
         "https://api.met.no/doc/TermsOfService",
         "Terms: \"don't repeat requests until the time indicated in the Expires response header\" and use If-Modified-Since. Measured: Expires about 30 minutes after the request.",
         "Attribution required as in CC BY 4.0; requests must identify the application in the User-Agent; browsers \"should not contact the API directly\".",
         "Weather: MET Norway", 3600, 14400),
    Feed("planes", "Aircraft", "adsb.lol",
         "https://api.adsb.lol/v2/point",
         "https://www.adsb.lol/docs/open-data/api/",
         "Refresh interval and rate limits are not stated on the pages read.",
         "Pages read: \"License: ODbL 1.0\". Its attribution and share-alike conditions need reading before a public launch.",
         "Aircraft: adsb.lol (ODbL 1.0)", 600, 2400),
    Feed("satellites", "Satellite orbits", "CelesTrak",
         "https://celestrak.org/NORAD/elements/gp.php",
         "https://celestrak.org/usage-policy.php",
         "Usage policy: \"For GP data, updates are once every 2 hours.\" Stop at the first non-200 answer and tell a human; repeating gets the address firewalled.",
         "Usage policy page read; it asks users to follow it and to cache. No licence text on that page.",
         "Orbits: CelesTrak", 7200, 21600, halt_group="celestrak"),
    Feed("catalogue", "Satellite catalogue", "CelesTrak",
         "https://celestrak.org/satcat/records.php",
         "https://celestrak.org/usage-policy.php",
         "The catalogue refresh interval is not stated on the pages read. Larger lists are rate limited, so this is fetched once a day.",
         "Usage policy page read; no licence text on that page.",
         "Catalogue: CelesTrak", 86400, 259200, halt_group="celestrak"),
]}

# Reference data that is not live. Listed in the manifest so the Data status sheet is honest about it.
STATIC = [
    {"id": "stars", "label": "Stars and constellation lines", "note": "Fixed catalogue packed at build time (Hipparcos based). Non-commercial licence, see docs/feature-sources.md."},
    {"id": "coast", "label": "Coastlines", "note": "Natural Earth outlines via world-atlas, packed at build time."},
    {"id": "textures", "label": "Earth, Moon and cloud images", "note": "Packed at build time. The cloud image is a daily NASA GIBS composite from the build day and is not refreshed by this pipeline yet."},
    {"id": "routes", "label": "Flight routes and airlines", "note": "Looked up once at build time from adsb.lol and OpenFlights. The route endpoint is marked deprecated, so this is not refreshed."},
    {"id": "impact", "label": "Shaking maps and population exposure", "note": "Fetched once at build time for the largest quakes from USGS ShakeMap and PAGER. New quakes show no shaking map until this is made live."},
]

# OURS: choices that no source states
GDACS_TYPES = "EQ;TC;FL;VO;DR;WF"
GDACS_RECENT_DAYS = 7      # an ended event stays listed for this long after its end date
GDACS_PAGE_SIZE = 100      # the API's own maximum page size
PLANES_RADIUS_NM = 150
FIRES_FILES = [  # the three VIIRS satellites FIRMS publishes global 24 hour files for
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
]
SWPC_URLS = {
    "wind": "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
    "mag": "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
    "alerts": "https://services.swpc.noaa.gov/products/alerts.json",
}
HALT_COOL_OFF_S = 21600    # after a policy halt, wait this long before one probe; a human is told on every halted run
KEEP_VERSIONS = 3
CITIES_FALLBACK_NOTE = "A city that fails keeps its last good data."
