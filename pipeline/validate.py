"""Check each feed's structure and ranges, and reshape it into the file the app reads.

A validator either returns clean data or raises ValidationError. The runner then keeps the last good copy.
The bounds below are sanity limits chosen by us (OURS), not rules from the sources.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from . import config


class ValidationError(Exception):
    pass


def iso_from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text):
    """Accepts '2026-10-04T12:36:47', with or without a Z or an offset; no zone means UTC."""
    t = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _json(body, what):
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError) as e:
        raise ValidationError(f"{what}: not valid JSON ({e})") from e


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


# ---------------------------------------------------------------- USGS earthquakes
QUAKES_MIN_EVENTS = 20     # OURS: a week of magnitude 2.5+ quakes is far above this; fewer means a broken answer
MAX_INVALID_FRACTION = 0.2  # OURS


def quakes(body, now):
    d = _json(body, "quakes")
    if not isinstance(d, dict) or d.get("type") != "FeatureCollection" or not isinstance(d.get("features"), list):
        raise ValidationError("quakes: not a GeoJSON FeatureCollection")
    meta = d.get("metadata") or {}
    out, bad = [], 0
    for f in d["features"]:
        try:
            p, g = f["properties"], f["geometry"]["coordinates"]
            lon, lat, depth = g[0], g[1], g[2]
            if not (isinstance(f.get("id"), str) and _num(p.get("mag"), -2, 10) and _num(lat, -90, 90) and _num(lon, -180, 180)
                    and _num(depth if depth is not None else 0, -10, 1000) and _num(p.get("time"), 1e11, 4e12)):
                raise ValueError("out of range")
            out.append({"id": f["id"], "mag": p["mag"], "place": p.get("place") or "", "time": iso_from_ms(p["time"]),
                        "lat": round(lat, 3), "lon": round(lon, 3), "depth": round(depth or 0, 1),
                        "status": p.get("status") or "", "felt": p.get("felt") or 0, "url": p.get("url") or ""})
        except (KeyError, TypeError, IndexError, ValueError):
            bad += 1
    total = len(d["features"])
    if len(out) < QUAKES_MIN_EVENTS:
        raise ValidationError(f"quakes: only {len(out)} usable events (need at least {QUAKES_MIN_EVENTS})")
    if bad > total * MAX_INVALID_FRACTION:
        raise ValidationError(f"quakes: {bad} of {total} events were invalid")
    newest = max(e["time"] for e in out)
    if parse_iso(newest) > now + timedelta(hours=1):
        raise ValidationError("quakes: newest event is in the future")
    generated = iso_from_ms(meta["generated"]) if _num(meta.get("generated"), 1e11, 4e12) else iso(now)
    return {"generated": generated, "events": out}, {"dropped": bad}


# ---------------------------------------------------------------- GDACS hazards
ALERTS = {"Green": 0, "Orange": 1, "Red": 2}
GDACS_MAX_EVENTS = 300  # OURS: bounds the file size


def gdacs(pages, now):
    types = set(config.GDACS_TYPES.split(";"))
    best, bad = {}, 0
    for page in pages:
        if not isinstance(page, dict) or not isinstance(page.get("features"), list):
            raise ValidationError("events: a page is not a GeoJSON FeatureCollection")
        for f in page["features"]:
            try:
                p, g = f["properties"], f["geometry"]
                if g.get("type") != "Point":
                    raise ValueError("not a point")
                lon, lat = g["coordinates"][:2]
                if p["eventtype"] not in types or p["alertlevel"] not in ALERTS or not (_num(lat, -90, 90) and _num(lon, -180, 180)):
                    raise ValueError("unknown type, alert or position")
                to = parse_iso(p["todate"])
                current = str(p.get("iscurrent")).lower() == "true"
                if not current and to < now - timedelta(days=config.GDACS_RECENT_DAYS):
                    continue  # an old, ended event
                key = (p["eventtype"], p["eventid"])
                mod = p.get("datemodified") or ""
                if key in best and best[key][0] >= mod:
                    continue
                best[key] = (mod, {
                    "id": f"{p['eventtype']}{p['eventid']}", "type": p["eventtype"], "name": p["name"], "alert": p["alertlevel"],
                    "country": p.get("country") or "", "from": p["fromdate"], "to": p["todate"], "current": current,
                    "lat": round(lat, 3), "lon": round(lon, 3),
                    "severity": (p.get("severitydata") or {}).get("severitytext", "").strip(),
                    "url": (p.get("url") or {}).get("report", ""),
                })
            except (KeyError, TypeError, ValueError, IndexError):
                bad += 1
    events = sorted((v[1] for v in best.values()), key=lambda e: e["from"], reverse=True)
    events.sort(key=lambda e: -ALERTS[e["alert"]])  # stable: Red first, then Orange, then Green, newest first within each
    newest_modified = max((v[0] for v in best.values() if v[0]), default=None)
    return events[:GDACS_MAX_EVENTS], {"dropped": bad, "modified": newest_modified}


# ---------------------------------------------------------------- NOAA aurora grid and Kp
AURORA_GRID = (360, 181)


def aurora(body):
    d = _json(body, "aurora")
    try:
        obs, fc, coords = d["Observation Time"], d["Forecast Time"], d["coordinates"]
        parse_iso(obs), parse_iso(fc)
    except (KeyError, TypeError, ValueError) as e:
        raise ValidationError(f"aurora: missing or unreadable fields ({e})") from e
    need = AURORA_GRID[0] * AURORA_GRID[1]
    if not isinstance(coords, list) or len(coords) < need * 0.9:
        raise ValidationError(f"aurora: {len(coords) if isinstance(coords, list) else 'no'} grid points, expected about {need}")
    grid = bytearray(need)
    for c in coords:
        try:
            lon, lat, p = c
        except (TypeError, ValueError):
            raise ValidationError("aurora: a grid point is not [longitude, latitude, value]")
        if not (_num(lon, 0, 360) and _num(lat, -90, 90) and _num(p, 0, 100)):
            raise ValidationError("aurora: a grid point is out of range")
        lo, la = int(lon) % 360, int(lat) + 90
        if 0 <= la < 181:
            grid[la * 360 + lo] = max(0, min(255, int(p)))
    if not any(grid):
        raise ValidationError("aurora: the whole grid is zero")
    return {"observation": obs, "forecast": fc}, bytes(grid)


def kp(body):
    d = _json(body, "kp")
    if not isinstance(d, list) or len(d) < 8:
        raise ValidationError("kp: too few rows")
    rows = []
    for r in d[-16:]:
        try:
            parse_iso(r["time_tag"])
            if not _num(r["Kp"], 0, 9):
                raise ValueError("Kp out of range")
            rows.append({"t": r["time_tag"], "kp": r["Kp"]})
        except (KeyError, TypeError, ValueError) as e:
            raise ValidationError(f"kp: bad row ({e})") from e
    return rows


# ---------------------------------------------------------------- MET Norway cloud forecast
def clouds(body):
    d = _json(body, "clouds")
    try:
        series = d["properties"]["timeseries"]
        updated = d["properties"]["meta"]["updated_at"]
        parse_iso(updated)
    except (KeyError, TypeError, ValueError) as e:
        raise ValidationError(f"clouds: unexpected structure ({e})") from e
    if len(series) < 24:
        raise ValidationError(f"clouds: only {len(series)} forecast steps")
    hours = []
    for t in series[:36]:
        try:
            det = t["data"]["instant"]["details"]
            c, tmp = det.get("cloud_area_fraction", 0), det.get("air_temperature", 0)
            if not (_num(c, 0, 100) and _num(tmp, -90, 70)):
                raise ValueError("cloud or temperature out of range")
            hours.append({"t": t["time"], "cloud": round(c, 1), "temp": round(tmp, 1)})
        except (KeyError, TypeError, ValueError) as e:
            raise ValidationError(f"clouds: bad step ({e})") from e
    return {"updated": updated, "hours": hours}


# ---------------------------------------------------------------- adsb.lol aircraft
AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}[0-9][0-9A-Z]{0,4}$")


def planes(body):
    d = _json(body, "planes")
    if not isinstance(d, dict) or not isinstance(d.get("ac"), list) or not _num(d.get("now"), 1e11, 4e12):
        raise ValidationError("planes: unexpected structure")
    out = []
    for a in d["ac"]:
        alt = a.get("alt_baro")
        if not isinstance(alt, (int, float)) or isinstance(alt, bool) or alt < 500:
            continue  # on the ground or no altitude
        if not (_num(a.get("lat"), -90, 90) and _num(a.get("lon"), -180, 180)):
            continue
        call = (a.get("flight") or "").strip()
        out.append({"hex": a.get("hex"), "call": call if AIRLINE_CALLSIGN.match(call) else "", "type": a.get("t") or "",
                    "lat": round(a["lat"], 4), "lon": round(a["lon"], 4), "altFt": int(alt), "gsKt": round(a.get("gs") or 0, 1),
                    "track": round(a.get("track") or 0, 1), "age": round(a.get("seen_pos") or 0, 1)})
    return {"time": iso_from_ms(d["now"]), "aircraft": out}
