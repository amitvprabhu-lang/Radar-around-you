"""The satellite catalogue: who owns an object, where it was launched, what it is for.

Built once a day from CelesTrak SATCAT records and the name tables on CelesTrak's pages, and stored in compact form.
The purpose groups below are CelesTrak's own groupings, a convenience and not a statement of mission.
"""
import html
import re

# group names fetched from CelesTrak, one SATCAT request each (the same list the first build used)
GROUPS = ["weather", "resource", "sar", "sarsat", "dmc", "tdrss", "argos", "planet", "spire", "geo", "intelsat", "ses", "eutelsat", "telesat",
          "starlink", "oneweb", "qianfan", "hulianwang", "kuiper", "iridium-NEXT", "orbcomm", "globalstar", "amateur", "satnogs", "x-comm",
          "other-comm", "gnss", "gps-ops", "glo-ops", "galileo", "beidou", "sbas", "science", "geodetic", "engineering", "education",
          "military", "radar", "cubesat", "stations", "last-30-days", "fengyun-1c-debris", "iridium-33-debris", "cosmos-2251-debris"]
# debris fields that are packed into the swarm: one GP request each
DEBRIS_GROUPS = ["cosmos-1408-debris", "cosmos-2251-debris", "fengyun-1c-debris", "iridium-33-debris"]

# purpose categories, first match wins
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
P_INDEX = {g: i for i, (_, groups) in enumerate(PURPOSES) for g in groups}
ORDERED = [g for _, gs in PURPOSES for g in gs]
FIELDS = ["owner", "site", "type", "launch", "ops", "purpose"]


def name_table(page_html, header_first):
    """Code to name pairs from the first two cells of every table row (CelesTrak's source and launch-site pages)."""
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        # a line break inside a cell is a space ("European Organization for the<br>Exploitation of ..." on the source code page, 2026-10-07)
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", " ", c, flags=re.I)))).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(cells) >= 2 and cells[0] != header_first:
            out[cells[0]] = cells[1]
    return out


def build(satcat_active, group_records, owner_names, site_names, built_at):
    """satcat_active: list of SATCAT records. group_records: {group: list of SATCAT records}."""
    satcat, members = {}, {}
    for rec in satcat_active:
        satcat[rec["NORAD_CAT_ID"]] = rec
    for g, recs in group_records.items():
        members[g] = {r["NORAD_CAT_ID"] for r in recs}
        for r in recs:
            satcat.setdefault(r["NORAD_CAT_ID"], r)
    purpose = {}
    for g in ORDERED:
        for nid in members.get(g, ()):
            purpose.setdefault(nid, P_INDEX[g])  # first match in ORDERED wins
    objects = {str(nid): [r.get("OWNER"), r.get("LAUNCH_SITE"), r.get("OBJECT_TYPE"), r.get("LAUNCH_DATE"), r.get("OPS_STATUS_CODE"), purpose.get(nid, 0)]
               for nid, r in satcat.items()}
    return {"builtAt": built_at, "fields": FIELDS, "owners": owner_names, "sites": site_names, "objects": objects,
            "groups": sorted(members), "counts": {"satcatActive": len(satcat_active), "objects": len(objects)}}
