"""Official star names for the app: the IAU Working Group on Star Names catalogue, matched to the app's star catalogue.

Source: the IAU Catalog of Star Names (IAU-CSN), https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt, last updated 2022-04-04 per
its own header (a newer list may exist on the IAU site). The file says "All IAU-produced products (Images, Videos, Texts) are
released under Creative Commons Attribution", and asks users to cite https://www.iau.org/public/themes/naming_stars/.

A name is used only if the star it names is in the app's catalogue (matched on the Hipparcos number) AND the file's position and
magnitude agree with the catalogue's. A disagreement is reported, never silently accepted.

usage: python3 -m pipeline.starnames [--csn raw3/IAU-CSN.txt] [--stars raw/stars6.json] [--out public]
"""
import argparse
import json
import math
import os
import re
import sys

CREDIT = "Star names: IAU Working Group on Star Names (IAU-CSN), CC BY"
SOURCE_URL = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt"
CITE_URL = "https://www.iau.org/public/themes/naming_stars/"
MAX_SEP_DEG = 0.25   # OURS: how far apart the two files may put the same star (proper motion is tiny at this size)
MAX_DMAG = 1.5       # OURS: a looser check than position. The IAU file lists the named component and the catalogue the combined light of a
                     # multiple star, so the two differ by up to about 0.7 for Castor, Algieba and Albireo; a gap this large would mean a wrong star


def parse_csn(text):
    """Rows of the IAU-CSN file as dicts. The first three fields are fixed width; the rest are whitespace separated."""
    m = re.search(r"Last updated (\d{4}-\d\d-\d\d)", text)
    updated = m.group(1) if m else None
    rows, bad = [], []
    for line in text.splitlines():
        if not line.strip() or line.startswith(("#", "$")):
            continue
        name, ascii_, desig, rest = line[:17].strip(), line[17:35].strip() or line[:17].strip(), line[35:48].strip(), line[48:].split()
        try:
            # the component and WDS columns are sometimes blank, so the fields are read from both ends: id, Bayer letter and
            # constellation come first; magnitude, band, HIP, HD, RA, Dec and date are the last seven before any notes
            d = next((k for k, t in enumerate(rest) if re.fullmatch(r"\d{4}-\d\d-\d\d", t)), None)
            if d is None or d < 9:
                raise ValueError("no date column, or too few fields")
            _id, greek, con = rest[0], rest[1], rest[2]
            mag, hip, ra, dec, date = rest[d - 6], rest[d - 4], rest[d - 2], rest[d - 1], rest[d]
            rows.append({"name": name, "ascii": ascii_, "designation": desig, "id": None if _id == "_" else _id, "bayer": None if greek == "_" else greek,
                         "con": None if con == "_" else con, "mag": None if mag == "_" else float(mag), "hip": None if hip == "_" else int(hip), "ra": float(ra), "dec": float(dec), "date": date})
        except ValueError as e:
            bad.append((line[:40], str(e)))
    return updated, rows, bad


def sep_deg(ra1, dec1, ra2, dec2):
    r = math.radians
    c = math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def match(rows, features):
    """Pair each named star with its catalogue index. features is the GeoJSON feature list the star catalogue was packed from,
    in the same order as stars.bin. Returns (matched, skipped_not_in_catalogue, disagreements)."""
    by_hip = {f["id"]: (i, f) for i, f in enumerate(features)}
    matched, absent, disagree = [], 0, []
    for r in rows:
        if r["hip"] is None or r["hip"] not in by_hip:
            absent += 1
            continue
        i, f = by_hip[r["hip"]]
        ra, dec = f["geometry"]["coordinates"]
        sep = sep_deg(r["ra"], r["dec"], ra, dec)
        dmag = abs(r["mag"] - f["properties"]["mag"]) if r["mag"] is not None else 0.0
        if sep > MAX_SEP_DEG or dmag > MAX_DMAG:
            disagree.append({"name": r["name"], "hip": r["hip"], "sepDeg": round(sep, 3), "dMag": round(dmag, 2)})
            continue
        matched.append({"i": i, "hip": r["hip"], "name": r["name"], "bayer": r["bayer"], "id": r["id"], "con": r["con"], "mag": f["properties"]["mag"], "designation": r["designation"]})
    matched.sort(key=lambda s: (s["mag"], s["i"]))
    return matched, absent, disagree


def build(csn_text, features):
    updated, rows, bad = parse_csn(csn_text)
    matched, absent, disagree = match(rows, features)
    doc = {"source": "IAU Catalog of Star Names (IAU-CSN)", "url": SOURCE_URL, "cite": CITE_URL, "credit": CREDIT, "listUpdated": updated,
           "licence": "IAU products are released under Creative Commons Attribution (statement in the file's header)",
           "counts": {"inFile": len(rows), "inCatalogue": len(matched), "notInCatalogue": absent, "disagreed": len(disagree), "unreadable": len(bad)},
           "stars": matched}
    return doc, disagree, bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--csn", default="raw3/IAU-CSN.txt")
    ap.add_argument("--stars", default="raw/stars6.json")
    ap.add_argument("--out", default="public")
    a = ap.parse_args(argv)
    with open(a.csn, encoding="utf8") as f:
        text = f.read()
    with open(a.stars, encoding="utf8") as f:
        features = json.load(f)["features"]
    doc, disagree, bad = build(text, features)
    if disagree or bad:
        print(f"{len(disagree)} stars disagree with the catalogue and {len(bad)} rows were unreadable; nothing written.", file=sys.stderr)
        for d in disagree[:10]:
            print("  disagree:", d, file=sys.stderr)
        for b in bad[:10]:
            print("  unreadable:", b, file=sys.stderr)
        return 1
    if doc["counts"]["inCatalogue"] < 200:
        print(f"Only {doc['counts']['inCatalogue']} named stars matched; expected hundreds. Nothing written.", file=sys.stderr)
        return 1
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "starnames.json"), "w", encoding="utf8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    meta_path = os.path.join(a.out, "meta.json")
    with open(meta_path, encoding="utf8") as f:
        meta = json.load(f)
    meta["starNames"] = {str(s["i"]): s["name"] for s in doc["stars"]}
    with open(meta_path, "w", encoding="utf8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{doc['counts']['inCatalogue']} named stars in the catalogue (of {doc['counts']['inFile']} names; {doc['counts']['notInCatalogue']} are fainter than the catalogue or not stars in it)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
