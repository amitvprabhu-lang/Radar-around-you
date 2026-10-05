"""Star details for the app: distance, spectral type and luminosity from the HYG database, and which stars have known planets
from the NASA Exoplanet Archive, both matched to the app's star catalogue on the Hipparcos number.

Sources (read 2026-10-05, see docs/star-sources.md):
  HYG v4.4, https://codeberg.org/astronexus/hyg, licence CC BY-SA 4.0. Its readme: `dist` is the distance in parsecs and a value
  of 100000 or more means missing or dubious parallax; `spect` the spectral type; `lum` the luminosity as a multiple of the Sun's;
  `absmag` the absolute visual magnitude.
  NASA Exoplanet Archive, table pscomppars (Planetary Systems Composite Parameters), TAP service. `hip_name` is the star's Hipparcos
  name and `sy_pnum` the number of confirmed planets in the system.

Duplicates: one Hipparcos number can appear under several names or rows. Rules, all tested: a Hipparcos number used twice in HYG
keeps the row with a usable distance (then the lower id); archive names such as "HIP 28393 A" and "HIP 28393 B" are one entry,
Hipparcos 28393; a planet listed twice counts once.

A star's details are used only if HYG's position and magnitude agree with the catalogue's. A disagreement is reported and the star
is left without details, never silently accepted.

usage: python3 -m pipeline.stardetails [--hyg raw3/hyg_v44_extract.csv] [--hosts raw3/exoplanet-hosts.csv] [--stars raw/stars6.json] [--out public]
"""
import argparse
import csv
import io
import json
import math
import os
import re
import sys

HYG_CREDIT = "Star distances, types and luminosities: HYG database v4.4 (astronexus), CC BY-SA 4.0"
HOSTS_CREDIT = "This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program."
HYG_URL = "https://codeberg.org/astronexus/hyg"
HOSTS_URL = "https://exoplanetarchive.ipac.caltech.edu/docs/pscp_about.html"
MISSING_DIST_PC = 100000      # from the HYG readme: this value or more means missing or dubious
MAX_SEP_DEG = 0.05            # OURS: how far apart HYG and the catalogue may put a star (the largest difference found among 5,041 stars was 0.005)
MAX_DMAG = 0.3                # OURS: and how far apart their magnitudes may be (the largest found was 0.04)
MAX_DIST_PC = 5000            # OURS: a distance beyond this for a naked-eye star is treated as a bad value
HYG_COLUMNS = ("id", "hip", "ra", "dec", "dist", "mag", "absmag", "spect", "ci", "lum")


def _float(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def read_hyg(text):
    """HYG rows by Hipparcos number. Returns (rows, duplicates_dropped)."""
    rows, dups = {}, 0
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in HYG_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"HYG file lacks columns {missing}")
    for r in reader:
        if not r["hip"].strip().isdigit():
            continue
        hip = int(r["hip"])
        row = {"id": int(r["id"]), "ra": _float(r["ra"]), "dec": _float(r["dec"]), "dist": _float(r["dist"]), "mag": _float(r["mag"]),
               "absmag": _float(r["absmag"]), "spect": r["spect"].strip() or None, "lum": _float(r["lum"])}
        if hip in rows:
            dups += 1
            if _prefer(row, rows[hip]):
                rows[hip] = row
        else:
            rows[hip] = row
    return rows, dups


def _prefer(new, old):
    """Of two HYG rows for one Hipparcos number, the one with a usable distance; if both or neither have one, the lower id."""
    n, o = usable_dist(new["dist"]), usable_dist(old["dist"])
    return n and not o if n != o else new["id"] < old["id"]


def usable_dist(d):
    return d is not None and 0 < d < MISSING_DIST_PC


def read_hosts(text):
    """Stars with confirmed planets by Hipparcos number: {hip: {names: [...], year: [min, max], methods: [...], dist: pc or None}}.
    Returns (hosts, rows_read, duplicate_rows)."""
    hosts, n, dup_rows = {}, 0, 0
    for r in csv.DictReader(io.StringIO(text)):
        m = re.fullmatch(r"HIP\s+(\d+)(?:\s+[A-Za-z])?", (r.get("hip_name") or "").strip())
        if not m:
            continue
        n += 1
        h = hosts.setdefault(int(m.group(1)), {"names": set(), "years": [], "methods": set(), "dists": []})
        name = (r.get("pl_name") or "").strip()
        if not name:
            continue
        if name in h["names"]:
            dup_rows += 1
            continue
        h["names"].add(name)
        y = _float(r.get("disc_year"))
        if y:
            h["years"].append(int(y))
        if (r.get("discoverymethod") or "").strip():
            h["methods"].add(r["discoverymethod"].strip())
        d = _float(r.get("sy_dist"))
        if d:
            h["dists"].append(d)
    out = {}
    for hip, h in hosts.items():
        if h["names"]:
            out[hip] = {"names": sorted(h["names"]), "year": [min(h["years"]), max(h["years"])] if h["years"] else None,
                        "methods": sorted(h["methods"]), "dist": sum(h["dists"]) / len(h["dists"]) if h["dists"] else None}
    return out, n, dup_rows


def sep_deg(ra1, dec1, ra2, dec2):
    r = math.radians
    c = math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def sig(x, n=3):
    if x == 0:
        return 0
    return round(x, n - 1 - int(math.floor(math.log10(abs(x)))))


def build(hyg, hosts, features, hyg_dups=0, host_rows=0, host_dup_rows=0):
    """features: the GeoJSON features the star catalogue was packed from, in the order of stars.bin."""
    stars, planets, disagree = {}, {}, []
    counts = {"catalogue": len(features), "matched": 0, "notInHyg": 0, "noHip": 0, "noDistance": 0, "noSpectral": 0, "withPlanets": 0, "hostDistanceDiffers": 0}
    for i, f in enumerate(features):
        hip = f.get("id")
        if not isinstance(hip, int):
            counts["noHip"] += 1
            continue
        r = hyg.get(hip)
        if r is None:
            counts["notInHyg"] += 1
            continue
        ra, dec = f["geometry"]["coordinates"]
        ra = ra % 360
        if r["ra"] is None or r["dec"] is None or r["mag"] is None:
            disagree.append({"hip": hip, "why": "no position or magnitude"})
            continue
        sep, dmag = sep_deg(r["ra"] * 15, r["dec"], ra, dec), abs(r["mag"] - f["properties"]["mag"])
        if sep > MAX_SEP_DEG or dmag > MAX_DMAG:
            disagree.append({"hip": hip, "sepDeg": round(sep, 4), "dMag": round(dmag, 2)})
            continue
        counts["matched"] += 1
        dist = round(r["dist"], 2) if usable_dist(r["dist"]) and r["dist"] <= MAX_DIST_PC else None
        if dist is None:
            counts["noDistance"] += 1
        if r["spect"] is None:
            counts["noSpectral"] += 1
        # luminosity and absolute magnitude are worked out from the distance, so without a usable distance they are not real either
        # (HYG gives hip 207 a distance of 100000 pc and a luminosity of 39 million Suns)
        lum = sig(r["lum"]) if dist is not None and r["lum"] is not None and r["lum"] > 0 else None
        stars[str(i)] = [dist, r["spect"], lum, round(r["absmag"], 2) if dist is not None and r["absmag"] is not None else None]
        h = hosts.get(hip)
        if h:
            counts["withPlanets"] += 1
            planets[str(i)] = {"n": len(h["names"]), "names": h["names"], "year": h["year"], "methods": h["methods"]}
            if dist is not None and h["dist"] is not None and abs(h["dist"] - dist) / dist > 0.15:
                counts["hostDistanceDiffers"] += 1
    counts.update(hygDuplicatesDropped=hyg_dups, planetRows=host_rows, planetDuplicatesDropped=host_dup_rows)
    doc = {"hygSource": "HYG database v4.4", "hygUrl": HYG_URL, "hygLicence": "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). This data file is a derivative and carries the same licence.",
           "hygCredit": HYG_CREDIT, "planetSource": "NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)", "planetUrl": HOSTS_URL, "planetCredit": HOSTS_CREDIT,
           "fields": ["distancePc", "spectralType", "luminositySun", "absoluteMagnitude"], "counts": counts, "stars": stars, "planets": planets}
    return doc, disagree


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--hyg", default="raw3/hyg_v44_extract.csv")
    ap.add_argument("--hosts", default="raw3/exoplanet-hosts.csv")
    ap.add_argument("--stars", default="raw/stars6.json")
    ap.add_argument("--out", default="public")
    a = ap.parse_args(argv)
    with open(a.hyg, encoding="utf8") as f:
        hyg, dups = read_hyg(f.read())
    with open(a.hosts, encoding="utf8") as f:
        hosts, n, dup_rows = read_hosts(f.read())
    with open(a.stars, encoding="utf8") as f:
        features = json.load(f)["features"]
    doc, disagree = build(hyg, hosts, features, dups, n, dup_rows)
    if disagree:
        print(f"{len(disagree)} stars disagree with the catalogue; nothing written.", file=sys.stderr)
        for d in disagree[:10]:
            print("  disagree:", d, file=sys.stderr)
        return 1
    if doc["counts"]["matched"] < 0.9 * len(features):
        print(f"Only {doc['counts']['matched']} of {len(features)} stars matched; expected nearly all. Nothing written.", file=sys.stderr)
        return 1
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "stardetails.json"), "w", encoding="utf8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    c = doc["counts"]
    print(f"stardetails.json: {c['matched']} of {c['catalogue']} stars matched, {c['noDistance']} without a usable distance, {c['withPlanets']} with confirmed planets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
