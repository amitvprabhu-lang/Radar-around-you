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
    Feed("clouds", "Cloud forecast", "MET Norway",
         "https://api.met.no/weatherapi/locationforecast/2.0/compact",
         "https://api.met.no/doc/TermsOfService",
         "Terms: \"don't repeat requests until the time indicated in the Expires response header\" and use If-Modified-Since. Measured: Expires about 30 minutes after the request.",
         "Terms: attribution required as in CC BY 4.0; requests must identify the application in the User-Agent; browsers \"should not contact the API directly\".",
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
HALT_COOL_OFF_S = 21600    # after a policy halt, wait this long before one probe; a human is told on every halted run
KEEP_VERSIONS = 3
CITIES_FALLBACK_NOTE = "A city that fails keeps its last good data."
