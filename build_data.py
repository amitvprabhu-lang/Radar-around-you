"""Pack every real data set used by prototype v2 into compact binary and JSON files in public/.

Inputs are the raw downloads from 4 Oct 2026 (CelesTrak, USGS, NOAA, GDACS, NASA GIBS, MET Norway,
adsb.lol, OpenFlights). Nothing here is invented: each value is copied, rounded or looked up from those files.
Run order: build_snapshot.py (earlier), then this script.
"""
import base64, glob, gzip, html, json, math, os, re, struct
import statistics
from datetime import datetime, timezone

R, R2, OUT = "raw/", "raw2/", "public/"
os.makedirs(OUT, exist_ok=True)
snap = json.load(open("snapshot.json"))
REF_MS = snap["swarm"]["ref"]


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def write(name, data, mode="wb"):
    path = OUT + name
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode) as f:
        f.write(data)
    return path


def jdump(name, obj):
    return write(name, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


# ---------------------------------------------------------------- satellites
# The packing itself lives in pipeline/ so this build and the live pipeline share one implementation.
from pipeline import catalogue as CAT, pack as PACK

OWNER_NAMES = CAT.name_table(open(R2 + "sources.html", encoding="utf-8", errors="ignore").read(), "Source Code")
SITE_NAMES = CAT.name_table(open(R2 + "launchsites.html", encoding="utf-8", errors="ignore").read(), "Launch Site Codes")
print("owner codes", len(OWNER_NAMES), "launch sites", len(SITE_NAMES))
group_records = {}
for p in sorted(glob.glob(R2 + "groups/*.json")):
    try:
        group_records[os.path.basename(p)[:-5]] = load(p)
    except Exception:
        pass
catalogue = CAT.build(load(R2 + "satcat_active.json"), group_records, OWNER_NAMES, SITE_NAMES, snap["snapshotTaken"])
print("satcat records", len(catalogue["objects"]), "groups loaded", len(group_records))

sources = [load(R + "celestrak_active.json")]
for p in sorted(glob.glob(R + "deb_*.json")):
    try:
        sources.append(load(p))
    except Exception:
        pass
files, sat_meta, report = PACK.pack_satellites(sources, load(R + "celestrak_stations.json"), load(R + "celestrak_visual.json"),
                                               catalogue, REF_MS, snap["snapshotTaken"])
for name, data in files.items():
    write(name, data)
print("swarm objects", sat_meta["count"], "kinds", sat_meta["kinds"])
print("objects launched in the last 30 days:", len(sat_meta["newIdx"]))
print("precise element sets:", sat_meta["preciseCount"])
print("data health:", sat_meta["health"])

# ---------------------------------------------------------------- stars
names_raw = load(R + "starnames.json")
feats = load(R + "stars6.json")["features"]
sb = bytearray(); named = {}
for i, f in enumerate(feats):
    ra, dec = f["geometry"]["coordinates"]
    ra = ra + 360 if ra < 0 else ra
    mag = f["properties"]["mag"]
    try: bv = float(f["properties"].get("bv") or 0.6)
    except ValueError: bv = 0.6
    sb += struct.pack("<HHBB", round(ra / 360 * 65535), round((dec + 90) / 180 * 65535), max(0, min(255, round((mag + 1.5) * 25))), max(0, min(255, round((bv + 0.4) * 100))))
    nm = (names_raw.get(str(f["id"])) or {}).get("name", "")
    if nm and mag < 2.6: named[i] = nm
write("stars.bin", bytes(sb))
jdump("lines.json", snap["constellations"])
print("stars", len(feats), "named", len(named))

# ---------------------------------------------------------------- aurora grid, quakes, events, coastlines
ov = load(R + "ovation.json")
grid = bytearray(360 * 181)
for lon, lat, p in ov["coordinates"]:
    lo = int(lon) % 360; la = int(lat) + 90
    if 0 <= la < 181: grid[la * 360 + lo] = max(0, min(255, int(p)))
write("aurora.bin", bytes(grid))
jdump("quakes.json", snap["quakes"])
jdump("events.json", snap["events"])
topo = load(R + "land-50m.json")
sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
cb = bytearray(); pts = 0
for arc in topo["arcs"]:
    x = y = 0; line = []
    for dx, dy in arc:
        x += dx; y += dy
        lon, lat = x * sx + tx, y * sy + ty
        if not line or abs(lat - line[-1][0]) + abs(lon - line[-1][1]) > 0.3:
            line.append((lat, lon))
    if len(line) < 2: continue
    for lat, lon in line: cb += struct.pack("<hh", round(lat * 100), round(lon * 100))
    cb += struct.pack("<hh", 32767, 32767); pts += len(line)
write("coast.bin", bytes(cb)); print("coast points", pts)

# ---------------------------------------------------------------- impact, routes, airlines, cities
jdump("impact.json", load(R2 + "impact.json"))
routes = load(R2 + "routes.json") if os.path.exists(R2 + "routes.json") else {}
slim_routes = {}
for cs, r in routes.items():
    ap = r.get("_airports")
    if not ap: continue
    slim_routes[cs] = [{"iata": a.get("iata") or "", "icao": a.get("icao") or "", "name": a.get("name") or "", "city": a.get("location") or "",
                        "cc": a.get("countryiso2") or "", "lat": round(a["lat"], 3), "lon": round(a["lon"], 3)} for a in ap]
jdump("routes.json", slim_routes)
codes = set()
for c in snap["cities"]:
    for a in c["planes"]["aircraft"]:
        m = re.match(r"^([A-Z]{3})[0-9]", a["call"] or "")
        if m: codes.add(m.group(1))
airlines = {}
for line in open(R2 + "airlines.dat", encoding="utf-8", errors="ignore"):
    row = next(__import__("csv").reader([line]))
    if len(row) >= 8 and row[4] in codes and row[7] == "Y" and row[4] not in airlines:
        airlines[row[4]] = {"n": row[1], "c": row[6]}
jdump("airlines.json", airlines)
print("routes", len(slim_routes), "airlines", len(airlines), "of", len(codes), "codes")
cities = []
for c in snap["cities"]:
    cities.append({"id": c["id"], "name": c["name"], "country": c["country"], "lat": c["lat"], "lon": c["lon"], "tz": c["tz"],
                   "planes": c["planes"], "clouds": c["clouds"]})
jdump("cities.json", cities)

meta = {
    "ref": REF_MS, "taken": snap["snapshotTaken"], "count": sat_meta["count"], "kinds": sat_meta["kinds"],
    "owners": sat_meta["owners"], "ownerCodes": sat_meta["ownerCodes"],
    "sites": sat_meta["sites"], "siteCodes": sat_meta["siteCodes"],
    "purposes": sat_meta["purposes"], "types": ["Satellite", "Rocket body", "Debris", "Unknown"],
    "newIdx": sat_meta["newIdx"], "starCount": len(feats), "starNames": named,
    "aurora": {"observation": ov["Observation Time"], "forecast": ov["Forecast Time"]}, "kp": snap["kp"],
    "cloudsDate": "2026-10-03", "health": sat_meta["health"], "preciseCount": sat_meta["preciseCount"],
}
jdump("meta.json", meta)

# ---------------------------------------------------------------- size report
try:
    import brotli
except Exception:
    brotli = None
rep = []
for p in sorted(glob.glob(OUT + "**/*", recursive=True)):
    if os.path.isfile(p) and not p.endswith("manifest.json"):
        b = open(p, "rb").read()
        rep.append({"file": p[len(OUT):], "raw": len(b), "gzip": len(gzip.compress(b, 9)), "brotli": len(brotli.compress(b, quality=11)) if brotli else None})
json.dump(rep, open(OUT + "manifest.json", "w"), indent=1)
tot = lambda k: sum(r[k] or 0 for r in rep)
for r in rep:
    print(f"{r['file']:<22} raw {r['raw']/1024:8.1f} KB   gzip {r['gzip']/1024:8.1f} KB   brotli {(r['brotli'] or 0)/1024:8.1f} KB")
print(f"TOTAL raw {tot('raw')/1024:.0f} KB  gzip {tot('gzip')/1024:.0f} KB  brotli {tot('brotli')/1024:.0f} KB")
