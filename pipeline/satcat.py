"""The whole satellite catalogue (CelesTrak SATCAT, https://celestrak.org/pub/satcat.csv) counted by owner and kind, for the satellites and
debris by country pages. See docs/superpowers/specs/2026-10-07-country-objects-design.md and docs/country-objects-sources.md.

Fields, from CelesTrak's SATCAT format page (https://celestrak.org/satcat/satcat-format.php, read 2026-10-07): OBJECT_NAME, OBJECT_ID (the
international designator), NORAD_CAT_ID, OBJECT_TYPE (PAY, R/B, DEB, UNK), OPS_STATUS_CODE, OWNER, LAUNCH_DATE, LAUNCH_SITE, DECAY_DATE,
PERIOD (minutes), INCLINATION (degrees), APOGEE and PERIGEE (km), RCS (square metres), DATA_STATUS_CODE (NCE, NIE, NEA), ORBIT_CENTER (EA for
Earth, MO, SU, MA and others, or the catalogue number of the object it is docked to) and ORBIT_TYPE.

Pure functions only (no network): summarise() turns the CSV text into the published files. Also a small command line for checks by hand:
  python3 -m pipeline.satcat <satcat.csv> <out folder> --time 2026-10-07T04:04:48Z [--owners owners.json]
"""
import csv
import io
import json
import re
from datetime import datetime, timedelta, timezone

FIELDS = ["OBJECT_NAME", "OBJECT_ID", "NORAD_CAT_ID", "OBJECT_TYPE", "OPS_STATUS_CODE", "OWNER", "LAUNCH_DATE", "LAUNCH_SITE", "DECAY_DATE",
          "PERIOD", "INCLINATION", "APOGEE", "PERIGEE", "RCS", "DATA_STATUS_CODE", "ORBIT_CENTER", "ORBIT_TYPE"]
# the status codes 1 to 5 of docs/satcount-sources.md: operational, partially operational, backup, spare, extended mission (OURS: "active")
ACTIVE = {"+", "P", "B", "S", "X"}
KIND = {"PAY": "P", "R/B": "R", "DEB": "D", "UNK": "U"}
DETAIL_MIN = 10            # OURS: an owner with at least this many objects in Earth orbit gets a detail file
MAX_BAD_FRACTION = 0.01    # OURS: more unreadable rows than this and the whole answer is refused
ROW_FIELDS = ["id", "name", "intl", "type", "status", "launch", "period", "incl", "apogee", "perigee", "rcs", "data"]
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SatcatError(Exception):
    pass


def _num(text, digits):
    """A number from the CSV, rounded, or None for an empty or unreadable cell."""
    t = (text or "").strip()
    if not t:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    v = round(v, digits)
    return int(v) if digits == 0 else v


def in_earth_orbit(rec):
    """Not decayed, and centred on the Earth or docked to an object (whose catalogue number is the centre)."""
    centre = rec["ORBIT_CENTER"].strip()
    return not rec["DECAY_DATE"].strip() and (centre == "EA" or centre.isdigit())


def kind_key(rec):
    t = rec["OBJECT_TYPE"].strip()
    if t == "PAY":
        return "act" if rec["OPS_STATUS_CODE"].strip() in ACTIVE else "inact"
    return {"R/B": "rb", "DEB": "deb"}.get(t, "unk")


def file_name(code, taken):
    """o-<code>.json with the code in lower case letters and digits; a code that would clash or is empty gets a number."""
    base = re.sub(r"[^a-z0-9]", "", code.lower()) or "x"
    name, n = f"o-{base}.json", 2
    while name in taken:
        name, n = f"o-{base}{n}.json", n + 1
    taken.add(name)
    return name


def parse(text):
    """Rows of the CSV as dicts, and the number of rows that could not be read. Raises SatcatError for a wrong header."""
    reader = csv.DictReader(io.StringIO(text))
    missing = [f for f in FIELDS if f not in (reader.fieldnames or [])]
    if missing:
        raise SatcatError(f"satcat: the header lacks {', '.join(missing)}")
    rows, bad = [], 0
    for rec in reader:
        try:
            if any(rec.get(f) is None for f in FIELDS):
                raise ValueError("a short row")
            nid = int(rec["NORAD_CAT_ID"])
            ok = nid > 0 and rec["OBJECT_TYPE"].strip() in KIND and bool(rec["OWNER"].strip())
            dd = (rec["DECAY_DATE"] or "").strip()
            ok = ok and (not dd or DATE.match(dd)) and (not (rec["LAUNCH_DATE"] or "").strip() or DATE.match(rec["LAUNCH_DATE"].strip()))
        except (TypeError, ValueError, AttributeError):
            ok = False
        if not ok:
            bad += 1
            continue
        rec["NORAD_CAT_ID"] = nid
        rows.append(rec)
    return rows, bad


def detail_row(rec):
    return [rec["NORAD_CAT_ID"], rec["OBJECT_NAME"].strip(), rec["OBJECT_ID"].strip(), KIND[rec["OBJECT_TYPE"].strip()],
            rec["OPS_STATUS_CODE"].strip(), rec["LAUNCH_DATE"].strip(), _num(rec["PERIOD"], 2), _num(rec["INCLINATION"], 2),
            _num(rec["APOGEE"], 0), _num(rec["PERIGEE"], 0), _num(rec["RCS"], 4), rec["DATA_STATUS_CODE"].strip()]


def _dumps(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def summarise(text, source_time, owner_names, min_objects=15000, max_objects=100000):
    """text: the CSV. source_time: an ISO time (the CSV's Last-Modified). owner_names: {code: name} from CelesTrak's source table.
    Returns (files {name: bytes}, summary dict). Raises SatcatError when a guard fails."""
    rows, bad = parse(text)
    if not rows:
        raise SatcatError("satcat: no readable rows")
    if bad > MAX_BAD_FRACTION * (len(rows) + bad):
        raise SatcatError(f"satcat: {bad} of {len(rows) + bad} rows could not be read")
    t = datetime.fromisoformat(source_time.replace("Z", "+00:00"))
    year_ago = (t - timedelta(days=365)).strftime("%Y-%m-%d")
    owners, objects = {}, {}

    def entry(code):
        if code not in owners:
            owners[code] = {"code": code, "name": owner_names.get(code, code), "act": 0, "inact": 0, "rb": 0, "deb": 0, "unk": 0, "total": 0,
                            "away": {}, "decayed": 0, "dec365": 0, "new365": 0, "noElements": 0, "actNoElements": 0, "file": None}
        return owners[code]

    status = {}
    # for the debris owner check: the owners of the payloads of each launch
    payload_owners = {}
    for rec in rows:
        if rec["OBJECT_TYPE"].strip() == "PAY":
            payload_owners.setdefault(rec["OBJECT_ID"].strip()[:8], set()).add(rec["OWNER"].strip())
    deb_checked = deb_same = 0
    for rec in rows:
        code = rec["OWNER"].strip()
        o = entry(code)
        decay = rec["DECAY_DATE"].strip()
        if decay:
            o["decayed"] += 1
            if decay >= year_ago:
                o["dec365"] += 1
            continue
        if not in_earth_orbit(rec):
            centre = rec["ORBIT_CENTER"].strip() or "?"
            o["away"][centre] = o["away"].get(centre, 0) + 1
            continue
        k = kind_key(rec)
        o[k] += 1
        o["total"] += 1
        if rec["DATA_STATUS_CODE"].strip() == "NEA":
            o["noElements"] += 1
            if k == "act":
                o["actNoElements"] += 1
        if rec["LAUNCH_DATE"].strip() >= year_ago:
            o["new365"] += 1
        if rec["OBJECT_TYPE"].strip() == "PAY":
            s = rec["OPS_STATUS_CODE"].strip()
            status[s] = status.get(s, 0) + 1
        if k == "deb" and rec["OBJECT_ID"].strip()[:8] in payload_owners:
            deb_checked += 1
            deb_same += code in payload_owners[rec["OBJECT_ID"].strip()[:8]]
        objects.setdefault(code, []).append(rec)
    total = sum(o["total"] for o in owners.values())
    if not (min_objects <= total <= max_objects):
        raise SatcatError(f"satcat: {total} objects in Earth orbit is implausible (expected {min_objects} to {max_objects})")
    keys = ["act", "inact", "rb", "deb", "unk", "total", "decayed", "dec365", "new365", "noElements", "actNoElements"]
    totals = {k: sum(o[k] for o in owners.values()) for k in keys}
    totals["away"] = sum(sum(o["away"].values()) for o in owners.values())
    ranked = sorted(owners.values(), key=lambda o: (-o["total"], -o["decayed"], o["code"]))
    files, taken = {}, set()
    for o in ranked:
        o["away"] = dict(sorted(o["away"].items()))
        if o["total"] >= DETAIL_MIN:
            o["file"] = file_name(o["code"], taken)
            recs = sorted(objects[o["code"]], key=lambda r: r["NORAD_CAT_ID"])
            files[o["file"]] = _dumps({"schema": 1, "owner": o["code"], "name": o["name"], "sourceTime": source_time, "count": len(recs),
                                       "fields": ROW_FIELDS, "rows": [detail_row(r) for r in recs]})
    summary = {"schema": 1, "sourceTime": source_time, "rows": len(rows), "badRows": bad, "detailMin": DETAIL_MIN, "totals": totals,
               "payloadStatus": dict(sorted(status.items())), "debrisOwnerCheck": {"checked": deb_checked, "sameAsPayload": deb_same},
               "owners": ranked}
    files["summary.json"] = _dumps(summary)
    return files, summary


def main(argv=None):
    import argparse
    import os
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("out")
    ap.add_argument("--time", required=True, help="the source time to record (ISO, UTC)")
    ap.add_argument("--owners", help="a JSON file of {code: name}")
    ap.add_argument("--min", type=int, default=15000, help="the lowest plausible number of objects in Earth orbit")
    a = ap.parse_args(argv)
    names = {}
    if a.owners:
        with open(a.owners, encoding="utf-8") as f:
            names = json.load(f)
    with open(a.csv, encoding="utf-8") as f:
        files, s = summarise(f.read(), a.time, names, min_objects=a.min)
    os.makedirs(a.out, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(a.out, name), "wb") as f:
            f.write(data)
    print(f"{s['totals']['total']} objects in Earth orbit, {len(s['owners'])} owners, {len(files) - 1} detail files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
