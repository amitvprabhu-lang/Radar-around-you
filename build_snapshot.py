"""Trim the raw source downloads in raw/ into one compact snapshot.json for the prototype.

Every value comes from the real files fetched on 4 Oct 2026. Nothing is invented here;
the script only filters fields and rounds numbers.
"""
import json
import re
from datetime import datetime, timezone

RAW = "raw/"

CITIES = [
    # id, display name, country, lat, lon, IANA time zone
    ("pune", "Pune", "India", 18.5204, 73.8567, "Asia/Kolkata"),
    ("newyork", "New York", "United States", 40.7128, -74.0060, "America/New_York"),
    ("london", "London", "United Kingdom", 51.5074, -0.1278, "Europe/London"),
    ("tromso", "Tromsø", "Norway", 69.6492, 18.9553, "Europe/Oslo"),
    ("tokyo", "Tokyo", "Japan", 35.6762, 139.6503, "Asia/Tokyo"),
    ("sydney", "Sydney", "Australia", -33.8688, 151.2093, "Australia/Sydney"),
]

AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}[0-9][0-9A-Z]{0,4}$")


def load(name):
    with open(RAW + name, encoding="utf-8") as f:
        return json.load(f)


def iso_from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def planes_for(city_id):
    d = load(f"planes_{city_id}.json")
    out = []
    for a in d.get("ac", []):
        alt = a.get("alt_baro")
        if not isinstance(alt, (int, float)) or alt < 500:
            continue  # on the ground or no altitude
        if a.get("lat") is None or a.get("lon") is None:
            continue
        callsign = (a.get("flight") or "").strip()
        out.append({
            "hex": a.get("hex"),
            # Only airline-style callsigns are shown by name; others stay anonymous.
            "call": callsign if AIRLINE_CALLSIGN.match(callsign) else "",
            "type": a.get("t") or "",
            "lat": round(a["lat"], 4),
            "lon": round(a["lon"], 4),
            "altFt": int(alt),
            "gsKt": round(a.get("gs") or 0, 1),
            "track": round(a.get("track") or 0, 1),
            "age": round((a.get("seen_pos") or 0), 1),
        })
    return {"time": iso_from_ms(d["now"]), "aircraft": out}


def clouds_for(city_id):
    d = load(f"met_{city_id}.json")
    series = []
    for t in d["properties"]["timeseries"][:36]:
        det = t["data"]["instant"]["details"]
        series.append({
            "t": t["time"],
            "cloud": round(det.get("cloud_area_fraction", 0), 1),
            "temp": round(det.get("air_temperature", 0), 1),
        })
    return {"updated": d["properties"]["meta"]["updated_at"], "hours": series}


def satellites():
    keep = ["OBJECT_NAME", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION",
            "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "EPHEMERIS_TYPE",
            "CLASSIFICATION_TYPE", "NORAD_CAT_ID", "ELEMENT_SET_NO", "REV_AT_EPOCH", "BSTAR",
            "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]
    seen = set()
    out = []
    stations = load("celestrak_stations.json")
    visual = load("celestrak_visual.json")
    wanted_stations = {25544: "ISS", 48274: "Tiangong"}
    for rec in stations:
        if rec["NORAD_CAT_ID"] in wanted_stations:
            r = {k: rec[k] for k in keep}
            r["label"] = wanted_stations[rec["NORAD_CAT_ID"]]
            out.append(r)
            seen.add(rec["NORAD_CAT_ID"])
    for rec in visual:
        if rec["NORAD_CAT_ID"] in seen:
            continue
        r = {k: rec[k] for k in keep}
        r["label"] = ""
        out.append(r)
        seen.add(rec["NORAD_CAT_ID"])
    return out


def quakes():
    d = load("usgs_2.5_week.geojson")
    out = []
    for f in d["features"]:
        p = f["properties"]
        lon, lat, depth = f["geometry"]["coordinates"]
        out.append({
            "id": f["id"],
            "mag": p["mag"],
            "place": p["place"] or "",
            "time": iso_from_ms(p["time"]),
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "depth": round(depth or 0, 1),
            "status": p.get("status") or "",
            "felt": p.get("felt") or 0,
            "url": p.get("url") or "",
        })
    return {"generated": iso_from_ms(d["metadata"]["generated"]), "events": out}


def aurora():
    d = load("ovation.json")
    pts = [[c[0], c[1], c[2]] for c in d["coordinates"] if c[2] >= 1]
    return {"observation": d["Observation Time"], "forecast": d["Forecast Time"], "points": pts}


def kp():
    d = load("kp.json")
    return [{"t": r["time_tag"], "kp": r["Kp"]} for r in d[-16:]]


def gdacs():
    d = load("gdacs.json")
    out = []
    for f in d["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append({
            "type": p["eventtype"],
            "name": p["name"],
            "alert": p["alertlevel"],
            "country": p.get("country") or "",
            "from": p["fromdate"],
            "to": p["todate"],
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "severity": (p.get("severitydata") or {}).get("severitytext", ""),
            "url": (p.get("url") or {}).get("report", ""),
        })
    return out


def stars():
    feats = load("stars6.json")["features"]
    names = load("starnames.json")
    out = []
    for f in feats:
        mag = f["properties"]["mag"]
        if mag > 4.6:
            continue
        ra, dec = f["geometry"]["coordinates"]
        if ra < 0:
            ra += 360
        nm = (names.get(str(f["id"])) or {}).get("name", "")
        try:
            bv = float(f["properties"].get("bv") or 0.6)
        except ValueError:
            bv = 0.6
        out.append([round(ra, 3), round(dec, 3), mag, round(bv, 2), nm if mag < 1.6 else ""])
    return out


def constellation_lines():
    out = []
    for f in load("const_lines.json")["features"]:
        for line in f["geometry"]["coordinates"]:
            pts = []
            for ra, dec in line:
                if ra < 0:
                    ra += 360
                pts.append([round(ra, 2), round(dec, 2)])
            out.append(pts)
    return out


import base64
import glob
import math
import struct


def swarm(ref_ms):
    """Pack every active satellite and the major debris fields into two binary arrays.
    f32 per object: epoch offset from ref (minutes), mean motion (rad/min)
    u16 per object: eccentricity, inclination, RAAN, argument of perigee, mean anomaly, type
    type: 0 other, 1 Starlink, 2 OneWeb, 3 debris, 4 crewed station"""
    objs = []
    for rec in load("celestrak_active.json"):
        name = rec["OBJECT_NAME"]
        t = 1 if "STARLINK" in name else 2 if "ONEWEB" in name else 4 if rec["NORAD_CAT_ID"] in (25544, 48274) else 0
        objs.append((rec, t))
    for f in sorted(glob.glob(RAW + "deb_*.json")):
        for rec in json.load(open(f, encoding="utf-8")):
            objs.append((rec, 3))
    f32 = bytearray()
    u16 = bytearray()
    counts = {}
    for rec, t in objs:
        if rec["ECCENTRICITY"] >= 0.99 or rec["MEAN_MOTION"] <= 0:
            continue
        epoch = datetime.fromisoformat(rec["EPOCH"]).replace(tzinfo=timezone.utc).timestamp() * 1000
        n = rec["MEAN_MOTION"] * 2 * math.pi / 1440
        f32 += struct.pack("<ff", (epoch - ref_ms) / 60000, n)
        q = lambda v, top: max(0, min(65535, round(v / top * 65535)))
        u16 += struct.pack("<6H", q(rec["ECCENTRICITY"], 1.0), q(math.radians(rec["INCLINATION"]), math.pi),
                           q(math.radians(rec["RA_OF_ASC_NODE"]) % (2 * math.pi), 2 * math.pi),
                           q(math.radians(rec["ARG_OF_PERICENTER"]) % (2 * math.pi), 2 * math.pi),
                           q(math.radians(rec["MEAN_ANOMALY"]) % (2 * math.pi), 2 * math.pi), t)
        counts[t] = counts.get(t, 0) + 1
    return {"ref": ref_ms, "count": len(f32) // 8, "counts": counts,
            "f32": base64.b64encode(bytes(f32)).decode(), "u16": base64.b64encode(bytes(u16)).decode()}


def coastlines():
    """Decode the land outlines from world-atlas (Natural Earth 1:50m) and thin them to ~0.2 degree steps.
    Output: int16 pairs (lat*100, lon*100) with 32767 marking the end of each line."""
    topo = load("land-50m.json")
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = bytearray()
    pts_total = 0
    for arc in topo["arcs"]:
        x = y = 0
        line = []
        for dx, dy in arc:
            x += dx
            y += dy
            lon, lat = x * sx + tx, y * sy + ty
            if not line or abs(lat - line[-1][0]) + abs(lon - line[-1][1]) > 0.2:
                line.append((lat, lon))
        if len(line) < 2:
            continue
        for lat, lon in line:
            out += struct.pack("<hh", round(lat * 100), round(lon * 100))
        out += struct.pack("<hh", 32767, 32767)
        pts_total += len(line)
    return {"points": pts_total, "i16": base64.b64encode(bytes(out)).decode()}


def main():
    snap = {
        "snapshotTaken": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cities": [],
        "satellites": satellites(),
        "quakes": quakes(),
        "aurora": aurora(),
        "kp": kp(),
        "events": gdacs(),
        "stars": stars(),
        "constellations": constellation_lines(),
    }
    ref_ms = round(datetime.now(timezone.utc).timestamp() * 1000)
    snap["swarm"] = swarm(ref_ms)
    snap["coast"] = coastlines()
    for cid, name, country, lat, lon, tz in CITIES:
        snap["cities"].append({
            "id": cid, "name": name, "country": country, "lat": lat, "lon": lon, "tz": tz,
            "planes": planes_for(cid), "clouds": clouds_for(cid),
        })
    with open("snapshot.json", "w", encoding="utf-8") as f:
        json.dump(snap, f, separators=(",", ":"), ensure_ascii=False)
    print("satellites", len(snap["satellites"]), "quakes", len(snap["quakes"]["events"]),
          "aurora pts", len(snap["aurora"]["points"]), "events", len(snap["events"]),
          "stars", len(snap["stars"]), "lines", len(snap["constellations"]),
          "swarm", snap["swarm"]["count"], snap["swarm"]["counts"], "coast pts", snap["coast"]["points"])
    for c in snap["cities"]:
        print(c["id"], "planes", len(c["planes"]["aircraft"]), "named", sum(1 for a in c["planes"]["aircraft"] if a["call"]))


if __name__ == "__main__":
    main()
