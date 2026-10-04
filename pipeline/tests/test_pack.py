import copy
import glob
import hashlib
import json
import os
import struct
import unittest
from datetime import datetime, timezone

from .. import catalogue as C
from .. import pack as P
from .helpers import fxj

REF = int(datetime(2026, 10, 4, 14, 19, 25, tzinfo=timezone.utc).timestamp() * 1000)
TAKEN = "2026-10-04T14:19:25Z"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def sample():
    deb = fxj("gp_debris_groups.json")
    return [fxj("gp_active_300.json")] + [deb[g] for g in sorted(deb)], fxj("gp_stations_6.json"), fxj("gp_visual_30.json"), fxj("catalogue_sample.json")


def pack(sources=None):
    s, st, vis, cat = sample()
    return P.pack_satellites(sources or s, st, vis, cat, REF, TAKEN)


class Layout(unittest.TestCase):
    def test_file_sizes_agree_with_the_object_count(self):
        files, meta, _ = pack()
        n = meta["count"]
        self.assertEqual(len(files["swarm.bin"]), n * 8 + n * 12, "two float32 and six uint16 per object")
        self.assertEqual(len(files["ids.bin"]), n * 4)
        self.assertEqual(len(files["details.bin"]), n * 8)
        self.assertEqual(len(files["names.txt"].decode().split("\n")), n)
        self.assertEqual(sum(meta["kinds"].values()), n)

    def test_the_stations_come_first_in_the_exact_orbit_set(self):
        files, meta, _ = pack()
        rows = json.loads(files["precise.json"])["rows"]
        self.assertEqual(json.loads(files["precise.json"])["cols"][:2], ["id", "epoch"])
        ids = [r[0] for r in rows]
        packed = set(struct.unpack(f"<{meta['count']}I", files["ids.bin"]))
        stations = [r["NORAD_CAT_ID"] for r in fxj("gp_stations_6.json") if r["NORAD_CAT_ID"] in packed]
        self.assertGreaterEqual(len(stations), 4)
        self.assertEqual(ids[:len(stations)], stations, "stations first, in the station list's order; one that is not in the packed set is left out")
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(meta["preciseCount"], len(rows))
        self.assertIn(25544, ids)

    def test_new_launch_indexes_point_at_objects_launched_in_the_last_30_days(self):
        files, meta, _ = pack()
        for i in meta["newIdx"]:
            day = struct.unpack_from("<H", files["details.bin"], i * 8 + 4)[0]
            launched = datetime(1957, 10, 4, tzinfo=timezone.utc).timestamp() + (day - 1) * 86400
            self.assertLess((REF / 1000 - launched) / 86400, 31)
            self.assertGreater(day, 0)

    def test_an_object_missing_from_the_catalogue_still_packs_with_unknown_details(self):
        s, st, vis, cat = sample()
        gone = s[0][0]["NORAD_CAT_ID"]
        cat = copy.deepcopy(cat)
        cat["objects"].pop(str(gone), None)
        files, meta, _ = P.pack_satellites(s, st, vis, cat, REF, TAKEN)
        ids = struct.unpack(f"<{meta['count']}I", files["ids.bin"])
        row = files["details.bin"][ids.index(gone) * 8:(ids.index(gone) + 1) * 8]
        self.assertEqual(struct.unpack("<BBBBHBB", row)[:6], (0, 0, 0, 3, 0, 0))

    def test_owner_and_site_names_are_looked_up_from_the_catalogue_tables(self):
        _, meta, _ = pack()
        self.assertEqual(len(meta["owners"]), len(meta["ownerCodes"]))
        self.assertEqual(len(meta["sites"]), len(meta["siteCodes"]))
        cat = fxj("catalogue_sample.json")
        for code, name in zip(meta["ownerCodes"], meta["owners"]):
            self.assertEqual(name, cat["owners"].get(code, code))


class Gate(unittest.TestCase):
    def bad(self, mutate):
        s, st, vis, cat = sample()
        rec = copy.deepcopy(s[0][0])
        mutate(rec)
        rec["NORAD_CAT_ID"] = 999001
        return pack([s[0] + [rec]] + s[1:])[1]["health"]

    def test_each_kind_of_bad_record_is_dropped_and_counted_by_reason(self):
        cases = {
            "missing field": lambda r: r.pop("BSTAR"),
            "eccentricity out of range": lambda r: r.update(ECCENTRICITY=0.995),
            "mean motion out of range": lambda r: r.update(MEAN_MOTION=0),
            "inclination out of range": lambda r: r.update(INCLINATION=181),
            "angle out of range": lambda r: r.update(MEAN_ANOMALY=361),
            "epoch in the future": lambda r: r.update(EPOCH="2026-10-06T00:00:00.000000"),
            "element set older than 90 days": lambda r: r.update(EPOCH="2026-06-01T00:00:00.000000"),
            "unreadable epoch": lambda r: r.update(EPOCH="yesterday"),
        }
        base = pack()[1]["health"]["recordsRead"]
        for reason, mutate in cases.items():
            with self.subTest(reason):
                h = self.bad(mutate)
                self.assertEqual(h["invalidDropped"], {reason: 1})
                self.assertEqual(h["recordsRead"], base + 1)

    def test_duplicates_keep_the_newest_element_set(self):
        s, st, vis, cat = sample()
        rec = s[0][0]
        older = copy.deepcopy(rec)
        older["EPOCH"] = "2026-10-01T00:00:00.000000"
        older["MEAN_MOTION"] = rec["MEAN_MOTION"] + 0.5
        files, meta, _ = P.pack_satellites([s[0] + [older]] + s[1:], st, vis, cat, REF, TAKEN)
        self.assertEqual(meta["health"]["duplicatesDropped"], 1)
        n = meta["count"]
        ids = struct.unpack(f"<{n}I", files["ids.bin"])
        i = ids.index(rec["NORAD_CAT_ID"])
        epoch_min, motion = struct.unpack_from("<ff", files["swarm.bin"], i * 8)
        self.assertAlmostEqual(motion, rec["MEAN_MOTION"] * 2 * 3.141592653589793 / 1440, places=5, msg="the newer record won")

    def test_element_age_is_recorded_in_four_hour_steps(self):
        files, meta, _ = pack()
        ages = [files["details.bin"][i * 8 + 7] for i in range(meta["count"])]
        self.assertTrue(all(0 <= a <= 255 for a in ages))
        self.assertEqual(max(ages), round(meta["health"]["ageHours"]["max"] / 4))


class Golden(unittest.TestCase):
    """The packer was proven byte for byte equal to the first build on all 19,316 objects. These hashes keep it that way on a fixed sample."""
    HASHES = {"swarm.bin": "53ad98fa5175b17b", "ids.bin": "e7fe5d5c04701da5", "details.bin": "4e3c3d4bdb3608d0",
              "names.txt": "baa22fb2a367abbd", "precise.json": "dda8f72c98d8f4e2"}

    def test_output_is_unchanged(self):
        files, meta, _ = pack()
        for name, want in self.HASHES.items():
            self.assertEqual(hashlib.sha256(files[name]).hexdigest()[:16], want, name)
        self.assertEqual((meta["count"], meta["preciseCount"], len(meta["newIdx"])), (298, 7, 2))


@unittest.skipUnless(os.path.exists(os.path.join(ROOT, "raw", "celestrak_active.json")), "the raw downloads are not in the repository")
class AgainstTheFirstBuild(unittest.TestCase):
    def test_full_data_matches_the_packed_files_in_public(self):
        def L(p):
            with open(os.path.join(ROOT, p), encoding="utf-8") as f:
                return json.load(f)

        def page(p):
            with open(os.path.join(ROOT, p), encoding="utf-8", errors="ignore") as f:
                return f.read()

        snap = L("snapshot.json")
        owners = C.name_table(page("raw2/sources.html"), "Source Code")
        sites = C.name_table(page("raw2/launchsites.html"), "Launch Site Codes")
        groups = {os.path.basename(p)[:-5]: L(os.path.relpath(p, ROOT)) for p in sorted(glob.glob(os.path.join(ROOT, "raw2/groups/*.json")))}
        cat = C.build(L("raw2/satcat_active.json"), groups, owners, sites, snap["snapshotTaken"])
        srcs = [L("raw/celestrak_active.json")] + [L(os.path.relpath(p, ROOT)) for p in sorted(glob.glob(os.path.join(ROOT, "raw/deb_*.json")))]
        files, meta, _ = P.pack_satellites(srcs, L("raw/celestrak_stations.json"), L("raw/celestrak_visual.json"), cat, snap["swarm"]["ref"], snap["snapshotTaken"])
        for name, data in files.items():
            with open(os.path.join(ROOT, "public", name), "rb") as f:
                self.assertEqual(f.read(), data, name)


class CatalogueBuild(unittest.TestCase):
    def test_purpose_follows_the_first_matching_group(self):
        sat = [{"NORAD_CAT_ID": 1, "OWNER": "US", "LAUNCH_SITE": "AFETR", "OBJECT_TYPE": "PAY", "LAUNCH_DATE": "2020-01-01", "OPS_STATUS_CODE": "+"}]
        groups = {"starlink": [sat[0]], "weather": [sat[0]], "stations": []}
        cat = C.build(sat, groups, {"US": "United States"}, {"AFETR": "Cape"}, "2026-10-04T00:00:00Z")
        purpose = dict(zip(cat["fields"], cat["objects"]["1"]))["purpose"]
        self.assertEqual(C.PURPOSES[purpose][0], "Weather and climate", "weather is listed before broadband internet")

    def test_name_table_reads_code_and_name_from_the_first_two_cells(self):
        html = "<table><tr><th>Source Code</th><th>Name</th></tr><tr><td>US</td><td>United&nbsp;States</td></tr><tr><td><a>CIS</a></td><td>Former USSR</td></tr></table>"
        t = C.name_table(html, "Source Code")
        self.assertEqual(t["CIS"], "Former USSR")
        self.assertIn("US", t)
        self.assertNotIn("Source Code", t)

    def test_group_only_objects_enter_the_catalogue(self):
        a = {"NORAD_CAT_ID": 1, "OWNER": "US", "LAUNCH_SITE": "X", "OBJECT_TYPE": "PAY", "LAUNCH_DATE": "2020-01-01", "OPS_STATUS_CODE": "+"}
        b = {"NORAD_CAT_ID": 2, "OWNER": "CN", "LAUNCH_SITE": "Y", "OBJECT_TYPE": "DEB", "LAUNCH_DATE": "2007-01-11", "OPS_STATUS_CODE": "D"}
        cat = C.build([a], {"fengyun-1c-debris": [b]}, {}, {}, "2026-10-04T00:00:00Z")
        self.assertEqual(set(cat["objects"]), {"1", "2"})
        self.assertEqual(C.PURPOSES[dict(zip(cat["fields"], cat["objects"]["2"]))["purpose"]][0], "Debris")


if __name__ == "__main__":
    unittest.main()
