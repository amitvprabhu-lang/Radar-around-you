"""Build the place search index (public/places.json) from the GeoNames cities15000 dump.

The readme at https://download.geonames.org/export/dump/readme.txt (read 2026-10-04) says the files are licensed under
Creative Commons Attribution 4.0, are tab-delimited UTF-8, and that cities15000 holds "all cities with a population >
15000 or capitals". The column order used below is the one that readme lists. The app shows a GeoNames credit wherever
this index is used.

usage: python3 -m pipeline.places [--zip cities15000.zip] [--out public/places.json]
"""
import argparse
import io
import json
import os
import sys
import zipfile
from datetime import date

from . import net

DUMP_URL = "https://download.geonames.org/export/dump/cities15000.zip"
DOC_URL = "https://download.geonames.org/export/dump/readme.txt"
LICENCE = "Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/)"
CREDIT = "Place names and time zones: GeoNames (geonames.org), CC BY 4.0"
MEMBER = "cities15000.txt"

# Column positions in the geoname table (readme: geonameid, name, asciiname, alternatenames, latitude, longitude,
# feature class, feature code, country code, cc2, admin1..4, population, elevation, dem, timezone, modification date)
ID, NAME, ASCII, LAT, LON, COUNTRY, POP, TZ = 0, 1, 2, 4, 5, 8, 14, 17
MIN_FIELDS = 19


def parse(text):
    """Rows from the dump as (id, name, ascii, country, lat, lon, tz, population). Malformed rows are skipped and counted."""
    rows, skipped = [], 0
    for line in text.splitlines():
        f = line.split("\t")
        try:
            if len(f) < MIN_FIELDS:
                raise ValueError("short row")
            lat, lon = float(f[LAT]), float(f[LON])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("coordinates out of range")
            if not f[TZ] or not f[NAME] or len(f[COUNTRY]) != 2:
                raise ValueError("missing field")
            rows.append((int(f[ID]), f[NAME], f[ASCII] or f[NAME], f[COUNTRY], lat, lon, f[TZ], int(f[POP] or 0)))
        except ValueError:
            skipped += 1
    return rows, skipped


def pack(rows, built):
    """Largest places first, so the first match for a search is usually the one people mean. Zones are stored once."""
    ordered = sorted(rows, key=lambda r: (-r[7], r[0]))
    zones = sorted({r[6] for r in ordered})
    zi = {z: i for i, z in enumerate(zones)}
    return {
        "source": "GeoNames cities15000", "doc": DOC_URL, "licence": LICENCE, "credit": CREDIT, "built": built,
        "fields": ["geonameid", "name", "ascii", "country", "lat", "lon", "tzIndex", "population"],
        "tz": zones,
        "p": [[r[0], r[1], r[2] if r[2] != r[1] else "", r[3], round(r[4], 4), round(r[5], 4), zi[r[6]], r[7]] for r in ordered],
    }


def read_zip(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return z.read(MEMBER).decode("utf8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zip", help="use a local copy of cities15000.zip instead of downloading it")
    ap.add_argument("--out", default="public/places.json")
    ap.add_argument("--contact", default=os.environ.get("CONTACT_EMAIL"))
    a = ap.parse_args(argv)
    if a.zip:
        with open(a.zip, "rb") as f:
            blob = f.read()
    else:
        if not a.contact:
            print("A contact address is required for the download: set CONTACT_EMAIL or pass --contact.", file=sys.stderr)
            return 2
        r = net.fetch(DUMP_URL, headers={"User-Agent": net.user_agent(a.contact)}, max_bytes=20_000_000)
        if r.status != 200:
            print(f"GeoNames answered HTTP {r.status}", file=sys.stderr)
            return 1
        blob = r.body
    rows, skipped = parse(read_zip(blob))
    if len(rows) < 5000:  # the real file has tens of thousands, so a small count means a bad download
        print(f"Only {len(rows)} usable rows ({skipped} skipped); refusing to write.", file=sys.stderr)
        return 1
    doc = pack(rows, date.today().isoformat())
    with open(a.out, "w", encoding="utf8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{a.out}: {len(rows)} places, {len(doc['tz'])} time zones, {skipped} rows skipped, {os.path.getsize(a.out) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
