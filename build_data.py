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
def table(path, header_first):
    t = open(path, encoding="utf-8", errors="ignore").read()
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(cells) >= 2 and cells[0] != header_first:
            out[cells[0]] = cells[1]
    return out


OWNER_NAMES = table(R2 + "sources.html", "Source Code")
SITE_NAMES = table(R2 + "launchsites.html", "Launch Site Codes")
print("owner codes", len(OWNER_NAMES), "launch sites", len(SITE_NAMES))

# SATCAT records: active payloads plus every purpose group and the debris groups
satcat = {}
for rec in load(R2 + "satcat_active.json"):
    satcat[rec["NORAD_CAT_ID"]] = rec
group_members = {}
for p in sorted(glob.glob(R2 + "groups/*.json")):
    g = os.path.basename(p)[:-5]
    try:
        recs = load(p)
    except Exception:
        continue
    group_members[g] = {r["NORAD_CAT_ID"] for r in recs}
    for r in recs:
        satcat.setdefault(r["NORAD_CAT_ID"], r)
print("satcat records", len(satcat), "groups loaded", len(group_members))

# purpose categories, first match wins. These are CelesTrak's own groupings, a convenience and not a statement of mission.
PURPOSES = [
    ("Unspecified", []),
    ("Space station", ["stations"]),
    ("Search and rescue", ["sarsat"]),
    ("Weather and climate", ["weather"]),
    ("Earth observation", ["resource", "planet", "spire", "dmc", "sar"]),
    ("Data relay", ["tdrss", "argos"]),
    ("Navigation", ["gnss", "gps-ops", "glo-ops", "galileo", "beidou", "sbas"]),
    ("Science", ["science"]),
    ("Geodesy", ["geodetic"]),
    ("Broadband internet", ["starlink", "oneweb", "qianfan", "hulianwang", "kuiper"]),
    ("Communications", ["intelsat", "ses", "eutelsat", "telesat", "iridium-NEXT", "orbcomm", "globalstar", "x-comm", "other-comm"]),
    ("Amateur radio", ["amateur", "satnogs"]),
    ("Military", ["military"]),
    ("Radar", ["radar"]),
    ("Engineering test", ["engineering"]),
    ("Education", ["education"]),
    ("CubeSat", ["cubesat"]),
    ("Geostationary", ["geo"]),
    ("Debris", ["fengyun-1c-debris", "iridium-33-debris", "cosmos-2251-debris"]),
]
P_INDEX = {}
for i, (label, groups) in enumerate(PURPOSES):
    for g in groups:
        P_INDEX[g] = i
ORDERED = [g for _, gs in PURPOSES for g in gs]


def purpose_of(nid):
    for g in ORDERED:
        if nid in group_members.get(g, ()):
            return P_INDEX[g]
    return 0


# the swarm: every active satellite plus the major debris fields, with names and NORAD ids.
# Every record goes through the same gate: required fields present, values in range, epoch sane.
# Duplicate object numbers keep the record with the newest epoch.
REQUIRED = ["NORAD_CAT_ID", "OBJECT_NAME", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
            "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]
dropped = {}
duplicates = 0
records_read = 0


def parse_epoch_ms(rec):
    return datetime.fromisoformat(rec["EPOCH"]).replace(tzinfo=timezone.utc).timestamp() * 1000


def rejection(rec):
    """Return the reason a record is unusable, or None."""
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
    if ep > REF_MS + 86400000:
        return "epoch in the future"
    if REF_MS - ep > 90 * 86400000:
        return "element set older than 90 days"
    return None


best = {}
sources = [load(R + "celestrak_active.json")]
for p in sorted(glob.glob(R + "deb_*.json")):
    try:
        sources.append(load(p))
    except Exception:
        pass
for src in sources:
    for rec in src:
        records_read += 1
        why = rejection(rec)
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
print("swarm objects", len(gp))

owners_used = sorted({satcat[r["NORAD_CAT_ID"]]["OWNER"] for r in gp if r["NORAD_CAT_ID"] in satcat})
sites_used = sorted({satcat[r["NORAD_CAT_ID"]]["LAUNCH_SITE"] for r in gp if r["NORAD_CAT_ID"] in satcat})
O_IDX = {c: i + 1 for i, c in enumerate(owners_used)}  # 0 means unknown
S_IDX = {c: i + 1 for i, c in enumerate(sites_used)}
STATUS = {"+": 1, "P": 2, "B": 3, "S": 4, "X": 5, "-": 6, "D": 7}
TYPE = {"PAY": 0, "R/B": 1, "DEB": 2, "UNK": 3}
EPOCH_FMT = "%Y-%m-%dT%H:%M:%S.%f"


def launch_day(iso):
    try:
        t = datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return 0
    return max(1, round((t - datetime(1957, 10, 4, tzinfo=timezone.utc)).total_seconds() / 86400) + 1)


f32 = bytearray(); u16 = bytearray(); ids = bytearray(); det = bytearray(); names = []; ages = []
q = lambda v, top: max(0, min(65535, round(v / top * 65535)))
kinds = {}
for rec in gp:
    nid = rec["NORAD_CAT_ID"]
    sc = satcat.get(nid)
    name = rec["OBJECT_NAME"].strip()
    epoch = datetime.fromisoformat(rec["EPOCH"]).replace(tzinfo=timezone.utc).timestamp() * 1000
    n = rec["MEAN_MOTION"] * 2 * math.pi / 1440
    age_h = max(0.0, (REF_MS - epoch) / 3600000)
    ages.append(age_h)
    age_byte = min(255, round(age_h / 4))  # element-set age at the snapshot, in 4 hour steps
    f32 += struct.pack("<ff", (epoch - REF_MS) / 60000, n)
    t = 1 if ("STARLINK" in name) else 0  # only used for colouring in the shader; real category is in details
    if "STARLINK" in name: t = 1
    elif "ONEWEB" in name: t = 2
    elif sc and sc["OBJECT_TYPE"] == "DEB" or " DEB" in name: t = 3
    elif nid in (25544, 48274): t = 4
    else: t = 0
    u16 += struct.pack("<6H", q(rec["ECCENTRICITY"], 1.0), q(math.radians(rec["INCLINATION"]), math.pi),
                       q(math.radians(rec["RA_OF_ASC_NODE"]) % (2 * math.pi), 2 * math.pi),
                       q(math.radians(rec["ARG_OF_PERICENTER"]) % (2 * math.pi), 2 * math.pi),
                       q(math.radians(rec["MEAN_ANOMALY"]) % (2 * math.pi), 2 * math.pi), t)
    ids += struct.pack("<I", nid)
    names.append(name.replace("\n", " "))
    if sc:
        otype = TYPE.get(sc["OBJECT_TYPE"], 3)
        purpose = 19 - 1 if otype == 2 else purpose_of(nid)  # index 18 is Debris
        if otype == 1:
            purpose = 0
        det += struct.pack("<BBBBHBB", O_IDX.get(sc["OWNER"], 0), S_IDX.get(sc["LAUNCH_SITE"], 0), purpose, otype,
                           launch_day(sc["LAUNCH_DATE"]), STATUS.get(sc["OPS_STATUS_CODE"], 0), age_byte)
    else:
        det += struct.pack("<BBBBHBB", 0, 0, purpose_of(nid), 3, 0, 0, age_byte)
    kinds[t] = kinds.get(t, 0) + 1

write("swarm.bin", bytes(f32) + bytes(u16))
write("ids.bin", bytes(ids))
write("details.bin", bytes(det))
write("names.txt", "\n".join(names).encode("utf-8"))
new_cutoff = launch_day(datetime.fromtimestamp(REF_MS / 1000, timezone.utc).strftime("%Y-%m-%d")) - 30
new_idx = [i for i in range(len(gp)) if struct.unpack_from("<H", det, i * 8 + 4)[0] >= new_cutoff]
print("objects launched in the last 30 days:", len(new_idx), "kinds", kinds)

# Full-precision element sets for the objects that get exact SGP4 positions in the app: the stations, the brightest
# visual objects and everything launched in the last 30 days (that is where the Starlink trains are).
gp_by_id = {r["NORAD_CAT_ID"]: r for r in gp}
want = []
for src_name in ("celestrak_stations.json", "celestrak_visual.json"):
    for r in load(R + src_name):
        if r["NORAD_CAT_ID"] in gp_by_id and r["NORAD_CAT_ID"] not in want:
            want.append(r["NORAD_CAT_ID"])
for i in new_idx:
    nid = struct.unpack_from("<I", ids, i * 4)[0]
    if nid not in want:
        want.append(nid)
cols = ["id", "epoch", "n", "e", "i", "raan", "argp", "ma", "bstar", "ndot", "nddot"]
rows = [[r["NORAD_CAT_ID"], r["EPOCH"], r["MEAN_MOTION"], r["ECCENTRICITY"], r["INCLINATION"], r["RA_OF_ASC_NODE"], r["ARG_OF_PERICENTER"],
         r["MEAN_ANOMALY"], r["BSTAR"], r["MEAN_MOTION_DOT"], r["MEAN_MOTION_DDOT"]] for r in (gp_by_id[k] for k in want)]
jdump("precise.json", {"cols": cols, "rows": rows})
print("precise element sets:", len(rows))

def pct(l, p):
    l = sorted(l)
    return l[min(len(l) - 1, int(p * len(l)))]

health = {
    "recordsRead": records_read, "duplicatesDropped": duplicates, "invalidDropped": dropped, "kept": len(gp),
    "ageHours": {"median": round(statistics.median(ages), 1), "p90": round(pct(ages, 0.9), 1), "p99": round(pct(ages, 0.99), 1), "max": round(max(ages), 1)},
    "staleOver3d": sum(1 for a in ages if a > 72), "staleOver7d": sum(1 for a in ages if a > 168),
}
print("data health:", health)

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
    "ref": REF_MS, "taken": snap["snapshotTaken"], "count": len(gp), "kinds": kinds,
    "owners": [OWNER_NAMES.get(c, c) for c in owners_used], "ownerCodes": owners_used,
    "sites": [SITE_NAMES.get(c, c) for c in sites_used], "siteCodes": sites_used,
    "purposes": [p[0] for p in PURPOSES], "types": ["Satellite", "Rocket body", "Debris", "Unknown"],
    "newIdx": new_idx, "starCount": len(feats), "starNames": named,
    "aurora": {"observation": ov["Observation Time"], "forecast": ov["Forecast Time"]}, "kp": snap["kp"],
    "cloudsDate": "2026-10-03", "health": health, "preciseCount": len(rows),
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
