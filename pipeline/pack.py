"""Pack CelesTrak element sets and the catalogue into the binary files the app reads.

This is the satellite part of the first build script, moved here unchanged so the live pipeline and the build script
cannot drift apart. test_pack.py proves the output is byte for byte what the first build produced.
"""
import json
import math
import statistics
import struct
from datetime import datetime, timezone

from .catalogue import PURPOSES

REQUIRED = ["NORAD_CAT_ID", "OBJECT_NAME", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
            "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]
STATUS = {"+": 1, "P": 2, "B": 3, "S": 4, "X": 5, "-": 6, "D": 7}
TYPE = {"PAY": 0, "R/B": 1, "DEB": 2, "UNK": 3}
STATIONS_CREWED = (25544, 48274)  # drawn as stations in the shader. A known gap: this is our list, not a feed.


def parse_epoch_ms(rec):
    return datetime.fromisoformat(rec["EPOCH"]).replace(tzinfo=timezone.utc).timestamp() * 1000


def rejection(rec, ref_ms):
    """The reason a record is unusable, or None."""
    if any(k not in rec or rec[k] is None for k in REQUIRED):
        return "missing field"
    try:
        ep = parse_epoch_ms(rec)
    except Exception:
        return "unreadable epoch"
    if not (0 <= rec["ECCENTRICITY"] < 0.99):
        return "eccentricity out of range"
    if not (0.05 < rec["MEAN_MOTION"] < 20):
        return "mean motion out of range"
    if not (0 <= rec["INCLINATION"] <= 180):
        return "inclination out of range"
    for k in ("RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY"):
        if not (0 <= rec[k] <= 360):
            return "angle out of range"
    if ep > ref_ms + 86400000:
        return "epoch in the future"
    if ref_ms - ep > 90 * 86400000:
        return "element set older than 90 days"
    return None


def launch_day(iso):
    try:
        t = datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return 0
    return max(1, round((t - datetime(1957, 10, 4, tzinfo=timezone.utc)).total_seconds() / 86400) + 1)


def _pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(p * len(values)))]


def pack_satellites(sources, stations, visual, catalogue, ref_ms, taken):
    """sources: lists of GP records in priority order (the active list first, then each debris group).
    stations, visual: GP record lists, used only for the order of the exact-orbit set.
    Returns (files, meta_fragment, report)."""
    dropped, duplicates, records_read, best = {}, 0, 0, {}
    for src in sources:
        for rec in src:
            records_read += 1
            why = rejection(rec, ref_ms)
            if why:
                dropped[why] = dropped.get(why, 0) + 1
                continue
            k = rec["NORAD_CAT_ID"]
            if k in best:
                duplicates += 1
                if parse_epoch_ms(rec) <= parse_epoch_ms(best[k]):
                    continue
            best[k] = rec
    gp = list(best.values())
    objs = catalogue["objects"]

    def cat(nid):
        row = objs.get(str(nid))
        return dict(zip(catalogue["fields"], row)) if row else None

    owners_used = sorted({cat(r["NORAD_CAT_ID"])["owner"] for r in gp if cat(r["NORAD_CAT_ID"])})
    sites_used = sorted({cat(r["NORAD_CAT_ID"])["site"] for r in gp if cat(r["NORAD_CAT_ID"])})
    o_idx = {c: i + 1 for i, c in enumerate(owners_used)}  # 0 means unknown
    s_idx = {c: i + 1 for i, c in enumerate(sites_used)}

    q = lambda v, top: max(0, min(65535, round(v / top * 65535)))
    f32, u16, ids, det, names, ages, kinds = bytearray(), bytearray(), bytearray(), bytearray(), [], [], {}
    for rec in gp:
        nid = rec["NORAD_CAT_ID"]
        sc = cat(nid)
        name = rec["OBJECT_NAME"].strip()
        epoch = parse_epoch_ms(rec)
        n = rec["MEAN_MOTION"] * 2 * math.pi / 1440
        age_h = max(0.0, (ref_ms - epoch) / 3600000)
        ages.append(age_h)
        age_byte = min(255, round(age_h / 4))  # element-set age at the build time, in 4 hour steps
        f32 += struct.pack("<ff", (epoch - ref_ms) / 60000, n)
        if "STARLINK" in name: t = 1
        elif "ONEWEB" in name: t = 2
        elif sc and sc["type"] == "DEB" or " DEB" in name: t = 3
        elif nid in STATIONS_CREWED: t = 4
        else: t = 0
        u16 += struct.pack("<6H", q(rec["ECCENTRICITY"], 1.0), q(math.radians(rec["INCLINATION"]), math.pi),
                           q(math.radians(rec["RA_OF_ASC_NODE"]) % (2 * math.pi), 2 * math.pi),
                           q(math.radians(rec["ARG_OF_PERICENTER"]) % (2 * math.pi), 2 * math.pi),
                           q(math.radians(rec["MEAN_ANOMALY"]) % (2 * math.pi), 2 * math.pi), t)
        ids += struct.pack("<I", nid)
        names.append(name.replace("\n", " "))
        if sc:
            otype = TYPE.get(sc["type"], 3)
            purpose = 19 - 1 if otype == 2 else sc["purpose"]  # index 18 is Debris
            if otype == 1:
                purpose = 0
            det += struct.pack("<BBBBHBB", o_idx.get(sc["owner"], 0), s_idx.get(sc["site"], 0), purpose, otype,
                               launch_day(sc["launch"]), STATUS.get(sc["ops"], 0), age_byte)
        else:
            det += struct.pack("<BBBBHBB", 0, 0, 0, 3, 0, 0, age_byte)
        kinds[t] = kinds.get(t, 0) + 1

    ref_iso = datetime.fromtimestamp(ref_ms / 1000, timezone.utc).strftime("%Y-%m-%d")
    new_cutoff = launch_day(ref_iso) - 30
    new_idx = [i for i in range(len(gp)) if struct.unpack_from("<H", det, i * 8 + 4)[0] >= new_cutoff]

    # exact-orbit set: the stations, the brightest visual objects, then everything launched in the last 30 days
    gp_by_id = {r["NORAD_CAT_ID"]: r for r in gp}
    want = []
    for src in (stations, visual):
        for r in src:
            if r["NORAD_CAT_ID"] in gp_by_id and r["NORAD_CAT_ID"] not in want:
                want.append(r["NORAD_CAT_ID"])
    for i in new_idx:
        nid = struct.unpack_from("<I", ids, i * 4)[0]
        if nid not in want:
            want.append(nid)
    cols = ["id", "epoch", "n", "e", "i", "raan", "argp", "ma", "bstar", "ndot", "nddot"]
    rows = [[r["NORAD_CAT_ID"], r["EPOCH"], r["MEAN_MOTION"], r["ECCENTRICITY"], r["INCLINATION"], r["RA_OF_ASC_NODE"], r["ARG_OF_PERICENTER"],
             r["MEAN_ANOMALY"], r["BSTAR"], r["MEAN_MOTION_DOT"], r["MEAN_MOTION_DDOT"]] for r in (gp_by_id[k] for k in want)]

    health = {
        "recordsRead": records_read, "duplicatesDropped": duplicates, "invalidDropped": dropped, "kept": len(gp),
        "ageHours": {"median": round(statistics.median(ages), 1), "p90": round(_pct(ages, 0.9), 1), "p99": round(_pct(ages, 0.99), 1), "max": round(max(ages), 1)},
        "staleOver3d": sum(1 for a in ages if a > 72), "staleOver7d": sum(1 for a in ages if a > 168),
    }
    files = {
        "swarm.bin": bytes(f32) + bytes(u16), "ids.bin": bytes(ids), "details.bin": bytes(det),
        "names.txt": "\n".join(names).encode("utf-8"),
        "precise.json": json.dumps({"cols": cols, "rows": rows}, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
    }
    meta = {"ref": ref_ms, "taken": taken, "count": len(gp), "kinds": kinds,
            "owners": [catalogue["owners"].get(c, c) for c in owners_used], "ownerCodes": owners_used,
            "sites": [catalogue["sites"].get(c, c) for c in sites_used], "siteCodes": sites_used,
            "purposes": [p[0] for p in PURPOSES], "newIdx": new_idx, "health": health, "preciseCount": len(rows)}
    # some operators publish element sets dated slightly ahead; the reported source time never runs ahead of the build time
    epochs = [parse_epoch_ms(r) for r in gp]
    newest = max([e for e in epochs if e <= ref_ms] or epochs)
    report = {"kinds": kinds, "newest_epoch": newest, "precise": len(rows), "new": len(new_idx)}
    return files, meta, report
