"""Validators for the aurora, storm and fire feeds: NOAA solar wind and alerts, NHC storms, NASA FIRMS fire detections.

Each function returns clean data or raises validate.ValidationError, like the validators in validate.py. The bounds are
sanity limits chosen by us (OURS). What each source says about itself is recorded in config.py.
"""
import csv
import io
import re
import struct
import zipfile
from datetime import datetime, timedelta, timezone

from .validate import ValidationError, _json, _num, iso, parse_iso

# ---------------------------------------------------------------- NOAA SWPC real-time solar wind and magnetic field
WIND_WINDOW_H = 6      # OURS: how much history the app draws
BUCKET_MIN = 5         # OURS: one point per five minutes, the mean of the one-minute rows in it
WIND_MIN_ROWS = 30     # OURS: fewer one-minute rows than this from the active spacecraft means a broken answer
MAX_LATEST_AGE_MIN = 90  # OURS: the newest active row must be this recent


def _rows(body, what):
    d = _json(body, what)
    if not isinstance(d, list) or not d:
        raise ValidationError(f"{what}: not a list of rows")
    return d


def _bucketed(rows, fields, now):
    """Mean per five-minute bucket of the rows the source marks active, newest window only. rows have time_tag and the fields."""
    start = now - timedelta(hours=WIND_WINDOW_H)
    buckets = {}
    for r in rows:
        if r.get("active") is not True:
            continue
        try:
            t = parse_iso(r["time_tag"])
        except (KeyError, ValueError, TypeError):
            continue
        if t < start or t > now + timedelta(minutes=10):
            continue
        key = int(t.timestamp() // (BUCKET_MIN * 60)) * BUCKET_MIN * 60
        for f, lo, hi in fields:
            v = r.get(f)
            if _num(v, lo, hi):
                buckets.setdefault(key, {}).setdefault(f, []).append(v)
    return buckets


def solar_wind(wind_body, mag_body, now):
    """Speed and density from rtsw_wind_1m, total field and Bz (GSM) from rtsw_mag_1m. Only rows flagged active are used."""
    wind, mag = _rows(wind_body, "solar wind"), _rows(mag_body, "magnetic field")
    wb = _bucketed(wind, [("proton_speed", 100, 3000), ("proton_density", 0, 500)], now)
    mb = _bucketed(mag, [("bt", 0, 200), ("bz_gsm", -200, 200)], now)
    if sum(len(v.get("proton_speed", [])) for v in wb.values()) < WIND_MIN_ROWS:
        raise ValidationError("solar wind: too few usable rows from the active spacecraft")
    if sum(len(v.get("bz_gsm", [])) for v in mb.values()) < WIND_MIN_ROWS:
        raise ValidationError("magnetic field: too few usable rows from the active spacecraft")
    mean = lambda xs: round(sum(xs) / len(xs), 2)
    out = []
    for key in sorted(set(wb) | set(mb)):
        w, m = wb.get(key, {}), mb.get(key, {})
        out.append({"t": iso(datetime.fromtimestamp(key, timezone.utc)),
                    "speed": mean(w["proton_speed"]) if w.get("proton_speed") else None,
                    "density": mean(w["proton_density"]) if w.get("proton_density") else None,
                    "bt": mean(m["bt"]) if m.get("bt") else None,
                    "bz": mean(m["bz_gsm"]) if m.get("bz_gsm") else None})
    newest = max(parse_iso(r["time_tag"]) for r in wind + mag if r.get("active") is True)
    if now - newest > timedelta(minutes=MAX_LATEST_AGE_MIN):
        raise ValidationError(f"solar wind: the newest active row is {int((now - newest).total_seconds() // 60)} minutes old")
    sources = sorted({r.get("source") for r in wind + mag if r.get("active") is True and r.get("source")})
    return {"updated": iso(newest), "spacecraft": sources, "bucketMin": BUCKET_MIN, "points": out}


# ---------------------------------------------------------------- NOAA SWPC alerts, watches and warnings (geomagnetic only)
ALERT_KEEP_H = 72      # OURS
GEO_CODE = re.compile(r"^(WARK|ALTK|SUMK)(\d\d)$|^(WATA)(\d\d)$")
KIND = {"WAR": "warning", "ALT": "alert", "SUM": "summary", "WAT": "watch"}


def _swpc_time(text):
    return datetime.strptime(text.strip(), "%Y %b %d %H%M UTC").replace(tzinfo=timezone.utc)


def _field(msg, name):
    m = re.search(rf"^{name}:\s*(.+?)\s*$", msg, flags=re.M)
    return m.group(1) if m else None


def space_alerts(body, now):
    """The geomagnetic messages from the last ALERT_KEEP_H hours, newest first. Other message types are not used by the app."""
    d = _json(body, "space weather alerts")
    if not isinstance(d, list):
        raise ValidationError("space weather alerts: not a list")
    out = []
    for r in d:
        try:
            msg = r["message"].replace("\r", "")
            code = re.search(r"Space Weather Message Code:\s*(\w+)", msg).group(1)
            serial = int(re.search(r"Serial Number:\s*(\d+)", msg).group(1))
            issued = _swpc_time(re.search(r"Issue Time:\s*(.+?)\s*$", msg, flags=re.M).group(1))
        except (KeyError, AttributeError, ValueError, TypeError) as e:
            raise ValidationError(f"space weather alerts: unreadable message ({e})") from e
        if not GEO_CODE.match(code) or now - issued > timedelta(hours=ALERT_KEEP_H):
            continue
        head = next((l.strip() for l in msg.split("\n") if re.match(r"^(EXTENDED |CONTINUED |CANCEL )?(WARNING|ALERT|WATCH|SUMMARY):", l.strip())), "")
        kp = re.search(r"K-index of (\d)", head)
        g = re.search(r"Category G(\d)", head)
        item = {"id": f"{code}-{serial}", "code": code, "kind": KIND[code[:3]], "serial": serial, "issued": iso(issued), "headline": head,
                "cancel": head.startswith("CANCEL"), "extended": head.startswith("EXTENDED"), "kp": int(kp.group(1)) if kp else None,
                "g": int(g.group(1)) if g else None, "supersedes": None, "from": None, "until": None, "reached": None, "impact": None}
        for key, names in (("from", ("Valid From", "Now Valid From")), ("until", ("Valid To", "Now Valid Until")), ("reached", ("Threshold Reached",))):
            for n in names:
                v = _field(msg, n)
                if v:
                    try:
                        item[key] = iso(_swpc_time(v))
                    except ValueError:
                        pass
                    break
        ext = re.search(r"^(?:Extension to|Continuation of) Serial Number:\s*(\d+)", msg, flags=re.M)
        if ext:
            item["supersedes"] = int(ext.group(1))  # an extended warning replaces the earlier one it names
        imp = _field(msg, "Potential Impacts")
        if imp:
            item["impact"] = imp
        out.append(item)
    out.sort(key=lambda x: x["issued"], reverse=True)
    return out


# ---------------------------------------------------------------- NHC active storms
NHC_BASINS = {"al": "Atlantic", "ep": "Eastern Pacific", "cp": "Central Pacific"}
NHC_CLASS = {"TD": "Tropical depression", "TS": "Tropical storm", "HU": "Hurricane", "STD": "Subtropical depression", "STS": "Subtropical storm",
             "PTC": "Post-tropical cyclone", "PC": "Post-tropical cyclone", "TY": "Typhoon"}
ZONE_HOURS = {"UTC": 0, "GMT": 0, "AST": -4, "ADT": -3, "EST": -5, "EDT": -4, "CST": -6, "CDT": -5, "MST": -7, "MDT": -6,
              "PST": -8, "PDT": -7, "AKST": -9, "AKDT": -8, "HST": -10, "HDT": -9}
KT_TO_KMH = 1.852


def _coords(text):
    pts = []
    for tok in text.split():
        p = tok.split(",")
        lon, lat = float(p[0]), float(p[1])
        # NHC writes storms that cross the dateline with longitudes past 180 (for example -210 or 181.8), so wrap them
        if not (-360 <= lon <= 360 and -90 <= lat <= 90):
            raise ValidationError("storm geometry: a coordinate is out of range")
        pts.append([round(((lon + 180) % 360) - 180, 3), round(lat, 3)])
    return pts


def _kml(blob, what):
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = next(n for n in z.namelist() if n.endswith(".kml"))
            return z.read(name).decode("utf-8")
    except (zipfile.BadZipFile, StopIteration, KeyError) as e:
        raise ValidationError(f"{what}: not a readable KMZ ({e})") from e


def _placemarks(kml):
    return re.findall(r"<Placemark.*?</Placemark>", kml, flags=re.S)


def storm_track(kmz, issued):
    """Forecast points from the NHC track KMZ: hours ahead, position, wind in knots, and the UTC time they are valid.

    NHC counts forecast hours from the synoptic time (00, 06, 12 or 18 UTC) at or before the advisory, so an intermediate
    advisory such as 15 UTC still has its 96 hour point valid at 12 UTC four days on. The 'Valid at' line in the KML gives
    the same moment in local time; when its zone is known the two are compared and a mismatch rejects the file.
    """
    kml = _kml(kmz, "storm track")
    base = issued.replace(minute=0, second=0, microsecond=0, hour=issued.hour - issued.hour % 6)
    pts = []
    for pm in _placemarks(kml):
        m = re.search(r"(\d+) hr Forecast", pm)
        if not m or "<Point>" not in pm:
            continue
        tau = int(m.group(1))
        c = _coords(re.search(r"<coordinates>\s*(.+?)\s*</coordinates>", pm, flags=re.S).group(1))[0]
        wind = re.search(r"Maximum Wind:\s*(\d+) knots", pm)
        valid = base + timedelta(hours=tau)
        v = re.search(r"Valid at:\s*(\d+):(\d\d) (AM|PM) ([A-Z]+) (\w+) (\d+), (\d{4})", pm)
        if v and v.group(4) in ZONE_HOURS:
            hh = int(v.group(1)) % 12 + (12 if v.group(3) == "PM" else 0)
            local = datetime.strptime(f"{v.group(5)} {v.group(6)} {v.group(7)}", "%B %d %Y").replace(hour=hh, minute=int(v.group(2)), tzinfo=timezone.utc)
            if local - timedelta(hours=ZONE_HOURS[v.group(4)]) != valid:
                raise ValidationError(f"storm track: the {tau} hour point is valid at {iso(local - timedelta(hours=ZONE_HOURS[v.group(4)]))} in its own text but {iso(valid)} by the synoptic rule")
        pts.append({"hours": tau, "valid": iso(valid), "lon": c[0], "lat": c[1], "windKt": int(wind.group(1)) if wind else None})
    if not pts:
        raise ValidationError("storm track: no forecast points")
    pts.sort(key=lambda p: p["hours"])
    return pts


def storm_cone(kmz):
    """The outer ring of the NHC cone of uncertainty, thinned to about every fourth point."""
    kml = _kml(kmz, "storm cone")
    rings = []
    for pm in _placemarks(kml):
        for m in re.finditer(r"<outerBoundaryIs>.*?<coordinates>\s*(.+?)\s*</coordinates>", pm, flags=re.S):
            ring = _coords(m.group(1))
            keep = ring[::4]
            if keep[-1] != ring[-1]:
                keep.append(ring[-1])
            rings.append(keep)
    if not rings:
        raise ValidationError("storm cone: no polygon")
    return rings


def nhc_storms(index_body, fetch_kmz, now):
    """CurrentStorms.json plus the forecast track and cone of each storm. fetch_kmz(url) returns the file's bytes."""
    d = _json(index_body, "NHC storms")
    if not isinstance(d, dict) or not isinstance(d.get("activeStorms"), list):
        raise ValidationError("NHC storms: no activeStorms list")
    out = []
    for s in d["activeStorms"]:
        try:
            sid = s["id"]
            basin = sid[:2]
            lat, lon = float(s["latitudeNumeric"]), float(s["longitudeNumeric"])
            wind = int(s["intensity"])
            pres = int(s["pressure"]) if s.get("pressure") not in (None, "") else None
            issued = parse_iso(s["publicAdvisory"]["issuance"])
            updated = parse_iso(s["lastUpdate"])
        except (KeyError, TypeError, ValueError) as e:
            raise ValidationError(f"NHC storms: unreadable storm record ({e})") from e
        if basin not in NHC_BASINS or not (_num(lat, -90, 90) and _num(lon, -180, 180) and _num(wind, 0, 250)):
            raise ValidationError(f"NHC storms: {sid} is outside the expected ranges")
        if pres is not None and not _num(pres, 800, 1050):
            raise ValidationError(f"NHC storms: {sid} pressure {pres} mb is outside the expected range")
        rec = {"id": sid, "name": s["name"], "basin": NHC_BASINS[basin], "class": s["classification"], "classText": NHC_CLASS.get(s["classification"], s["classification"]),
               "lat": lat, "lon": lon, "windKt": wind, "windKmh": round(wind * KT_TO_KMH), "pressureMb": pres, "moveDeg": s.get("movementDir"), "moveKt": s.get("movementSpeed"),
               "advisory": s["publicAdvisory"].get("advNum"), "issued": iso(issued), "updated": iso(updated), "url": (s.get("forecastGraphics") or {}).get("url") or s["publicAdvisory"].get("url"),
               "discussion": (s.get("forecastDiscussion") or {}).get("url"), "track": [], "cone": [], "extras": []}
        try:
            track = (s.get("forecastTrack") or {}).get("kmzFile")
            cone = (s.get("trackCone") or {}).get("kmzFile")
            if track:
                rec["track"] = storm_track(fetch_kmz(track), issued)
            if cone:
                rec["cone"] = storm_cone(fetch_kmz(cone))
        except ValidationError as e:
            rec["extras"].append(f"forecast track not shown: {e}")
        out.append(rec)
    return {"generated": iso(now), "storms": out}


# ---------------------------------------------------------------- NASA FIRMS VIIRS active fire detections
FIRE_CELL_DEG = 0.25   # OURS: detections are grouped into cells this wide (about 28 km at the equator)
FIRE_MIN_ROWS = 2000   # OURS: a 24 hour global VIIRS file has tens of thousands of rows, so a few means a broken file
FIRE_KEEP = {"nominal", "high", "n", "h"}  # OURS: low confidence detections are left out
FIRE_LAT_N, FIRE_LON_N = int(180 / FIRE_CELL_DEG), int(360 / FIRE_CELL_DEG)
FIRE_REC = struct.Struct("<HHHfH")  # latIndex, lonIndex, detections, FRP sum in MW, minutes before the file time of the newest detection


def fires(csv_bodies, now):
    """Group detections from one or more VIIRS 24 hour CSV files into cells. Returns (binary cells, summary dict).

    A row is one detection by one satellite on one pass, not one fire: the same fire seen on two passes counts twice.
    """
    cells, total, kept, low, bad, newest = {}, 0, 0, 0, 0, None
    per_sat = {}
    for body in csv_bodies:
        reader = csv.DictReader(io.StringIO(body.decode("utf-8", errors="replace")))
        need = {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp", "satellite"}
        if not reader.fieldnames or not need <= set(reader.fieldnames):
            raise ValidationError(f"fires: the header is missing {sorted(need - set(reader.fieldnames or []))}")
        for r in reader:
            total += 1
            try:
                lat, lon, frp = float(r["latitude"]), float(r["longitude"]), float(r["frp"])
                t = datetime.strptime(r["acq_date"] + r["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
            except (ValueError, TypeError, KeyError):
                bad += 1
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= frp < 20000 and t <= now + timedelta(hours=1) and now - t < timedelta(hours=48)):
                bad += 1
                continue
            if r["confidence"].strip().lower() not in FIRE_KEEP:
                low += 1
                continue
            kept += 1
            sat = r["satellite"].strip()
            per_sat[sat] = per_sat.get(sat, 0) + 1
            li = min(FIRE_LAT_N - 1, int((lat + 90) / FIRE_CELL_DEG))
            lo = min(FIRE_LON_N - 1, int((lon + 180) / FIRE_CELL_DEG))
            c = cells.setdefault((li, lo), [0, 0.0, t])
            c[0] += 1
            c[1] += frp
            if t > c[2]:
                c[2] = t
            if newest is None or t > newest:
                newest = t
    if total < FIRE_MIN_ROWS:
        raise ValidationError(f"fires: only {total} rows, expected at least {FIRE_MIN_ROWS}")
    if bad > 0.05 * total:
        raise ValidationError(f"fires: {bad} of {total} rows were unreadable or out of range")
    if not cells:
        raise ValidationError("fires: no usable detections")
    out = bytearray()
    for (li, lo), (n, frp, t) in sorted(cells.items()):
        out += FIRE_REC.pack(li, lo, min(n, 65535), frp, min(65535, max(0, int((newest - t).total_seconds() // 60))))
    summary = {"newest": iso(newest), "cells": len(cells), "detections": kept, "lowConfidenceLeftOut": low, "rows": total, "bySatellite": per_sat,
               "cellDeg": FIRE_CELL_DEG, "record": "uint16 latIndex, uint16 lonIndex, uint16 detections, float32 frpMw, uint16 minutesBeforeNewest; little endian; lat = -90 + index * cellDeg, lon = -180 + index * cellDeg (south-west corner of the cell)"}
    return bytes(out), summary
