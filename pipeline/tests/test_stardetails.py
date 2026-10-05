import copy
import json
import unittest

from .. import stardetails as sd
from .helpers import fx


def t(name):
    return fx(name).decode("utf8")

HIPS = [32349, 11767, 5165, 37826, 21421, 207, 15510]   # Sirius, Polaris, Beta Phe, Pollux, Aldebaran, a star with no usable distance, HD 20794


def features():
    return json.loads(fx("stars_details_sample.json"))["features"]


def built(hyg_text=None, hosts_text=None, feats=None):
    hyg, d = sd.read_hyg(hyg_text or t("hyg_sample.csv"))
    hosts, n, dr = sd.read_hosts(hosts_text or t("exoplanet_hosts_sample.csv"))
    return sd.build(hyg, hosts, feats or features(), d, n, dr)


class HygTest(unittest.TestCase):
    def test_rows_are_read_by_hipparcos_number(self):
        rows, dups = sd.read_hyg(t("hyg_sample.csv"))
        self.assertEqual(sorted(rows), sorted(HIPS))
        self.assertEqual(dups, 0)
        self.assertAlmostEqual(rows[32349]["dist"], 2.6371)
        self.assertEqual(rows[37826]["spect"], "K0IIIvar")

    def test_a_missing_column_is_an_error(self):
        with self.assertRaises(ValueError):
            sd.read_hyg("id,hip,ra\n1,2,3\n")

    def test_rows_without_a_hipparcos_number_are_skipped(self):
        rows, _ = sd.read_hyg(t("hyg_sample.csv") + "9,,1.0,1.0,5.0,3.0,1.0,G2V,0.6,1.0\n")
        self.assertEqual(len(rows), 7)

    def test_a_number_used_twice_keeps_the_row_with_a_usable_distance(self):
        extra = "99999,32349,6.75,-16.7,100000,-1.44,1.4,A0m,0.0,40000000\n"
        rows, dups = sd.read_hyg(t("hyg_sample.csv") + extra)
        self.assertEqual(dups, 1)
        self.assertAlmostEqual(rows[32349]["dist"], 2.6371, msg="the bogus 100000 pc row loses")
        lines = t("hyg_sample.csv").strip().split("\n")
        rows, dups = sd.read_hyg("\n".join([lines[0], extra.strip()] + lines[1:]) + "\n")
        self.assertAlmostEqual(rows[32349]["dist"], 2.6371, msg="order does not matter")

    def test_two_usable_rows_keep_the_lower_id(self):
        extra = "5,32349,6.75,-16.7,3.0,-1.44,1.4,A0m,0.0,25\n"
        rows, dups = sd.read_hyg(t("hyg_sample.csv") + extra)
        self.assertEqual((dups, rows[32349]["id"]), (1, 5))


class HostsTest(unittest.TestCase):
    def test_planets_are_counted_per_star(self):
        hosts, n, dr = sd.read_hosts(t("exoplanet_hosts_sample.csv"))
        self.assertEqual((n, dr), (10, 0))
        self.assertEqual(sorted(hosts), [15510, 21421, 37826, 114189])
        self.assertEqual(hosts[15510]["names"], ["HD 20794 b", "HD 20794 d", "HD 20794 e", "HD 20794 f"])
        self.assertEqual(hosts[15510]["year"], [2011, 2025])
        self.assertEqual(hosts[37826]["methods"], ["Radial Velocity"])
        self.assertAlmostEqual(hosts[21421]["dist"], 20.4332)

    def test_components_of_one_hipparcos_entry_are_one_star(self):
        text = "pl_name,hostname,hip_name,sy_pnum,sy_dist,disc_year,discoverymethod\nX b,X,HIP 28393 A,2,10,2000,Transit\nX c,X,HIP 28393 B,2,10,2001,Transit\n"
        hosts, n, _ = sd.read_hosts(text)
        self.assertEqual(list(hosts), [28393])
        self.assertEqual(hosts[28393]["names"], ["X b", "X c"])

    def test_a_planet_listed_twice_counts_once(self):
        text = t("exoplanet_hosts_sample.csv") + "HD 62509 b,HD 62509,HIP 37826,1,10.34,2006,Radial Velocity\n"
        hosts, n, dr = sd.read_hosts(text)
        self.assertEqual((len(hosts[37826]["names"]), dr), (1, 1))

    def test_odd_names_are_ignored(self):
        text = "pl_name,hostname,hip_name,sy_pnum,sy_dist,disc_year,discoverymethod\nA b,A,,1,1,2000,x\nB b,B,TIC 5,1,1,2000,x\nC b,C,HIP abc,1,1,2000,x\n"
        self.assertEqual(sd.read_hosts(text)[0], {})


class BuildTest(unittest.TestCase):
    def test_details_are_attached_to_the_catalogue_index(self):
        doc, bad = built()
        self.assertEqual(bad, [])
        c = doc["counts"]
        self.assertEqual((c["catalogue"], c["matched"], c["withPlanets"], c["noDistance"]), (7, 7, 3, 1))
        sirius = doc["stars"]["0"]
        self.assertEqual(sirius[0], 2.64)
        self.assertEqual(sirius[1], "A0m...")
        self.assertAlmostEqual(sirius[2], 22.8)
        self.assertAlmostEqual(sirius[3], 1.45)

    def test_a_star_with_no_usable_distance_has_no_luminosity_or_absolute_magnitude(self):
        doc, _ = built()
        i = str(HIPS.index(207))
        self.assertEqual(doc["stars"][i], [None, "G8III", None, None])

    def test_planets_are_listed_for_the_host_only(self):
        doc, _ = built()
        pollux, aldebaran, hd20794 = doc["planets"][str(HIPS.index(37826))], doc["planets"][str(HIPS.index(21421))], doc["planets"][str(HIPS.index(15510))]
        self.assertEqual((pollux["n"], pollux["names"]), (1, ["HD 62509 b"]))
        self.assertEqual(aldebaran["names"], ["alf Tau b"])
        self.assertEqual((hd20794["n"], hd20794["year"]), (4, [2011, 2025]))
        self.assertNotIn("0", doc["planets"])
        self.assertEqual(doc["counts"]["hostDistanceDiffers"], 0, "HYG and the archive agree on every host's distance")

    def test_two_sources_that_disagree_on_a_distance_are_counted(self):
        text = t("exoplanet_hosts_sample.csv").replace("20.43320000", "40.0")
        doc, _ = built(hosts_text=text)
        self.assertEqual(doc["counts"]["hostDistanceDiffers"], 1)

    def test_a_star_whose_position_disagrees_is_reported_and_left_out(self):
        feats = copy.deepcopy(features())
        feats[0]["geometry"]["coordinates"][0] += 2
        doc, bad = built(feats=feats)
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0]["hip"], 32349)
        self.assertNotIn("0", doc["stars"])

    def test_a_star_whose_magnitude_disagrees_is_reported(self):
        feats = copy.deepcopy(features())
        feats[1]["properties"]["mag"] = 5.0
        _, bad = built(feats=feats)
        self.assertEqual([b["hip"] for b in bad], [11767])

    def test_stars_missing_from_hyg_or_without_a_number_are_counted(self):
        feats = copy.deepcopy(features())
        feats.append({"type": "Feature", "id": 55203, "properties": {"mag": 5.0}, "geometry": {"type": "Point", "coordinates": [10, 10]}})
        feats.append({"type": "Feature", "properties": {"mag": 5.0}, "geometry": {"type": "Point", "coordinates": [10, 10]}})
        doc, _ = built(feats=feats)
        self.assertEqual((doc["counts"]["notInHyg"], doc["counts"]["noHip"]), (1, 1))

    def test_a_distance_beyond_the_sanity_limit_is_dropped(self):
        text = t("hyg_sample.csv").replace("2.6371", "9000.0")
        doc, _ = built(hyg_text=text)
        self.assertIsNone(doc["stars"]["0"][0])
        self.assertIsNone(doc["stars"]["0"][2])

    def test_the_document_carries_both_credits_and_the_share_alike_licence(self):
        doc, _ = built()
        self.assertIn("CC BY-SA 4.0", doc["hygCredit"])
        self.assertIn("Share", doc["hygLicence"])
        self.assertTrue(doc["planetCredit"].startswith("This research has made use of the NASA Exoplanet Archive"))

    def test_significant_figures(self):
        self.assertEqual(sd.sig(13912.3), 13900)
        self.assertEqual(sd.sig(0.628637), 0.629)
        self.assertEqual(sd.sig(22.824), 22.8)


class MainTest(unittest.TestCase):
    def test_the_real_extract_matches_nearly_every_catalogue_star(self):
        import os
        if not (os.path.exists("raw3/hyg_v44_extract.csv") and os.path.exists("raw/stars6.json")):
            self.skipTest("the real source files are not in this checkout")
        hyg, dups = sd.read_hyg(open("raw3/hyg_v44_extract.csv", encoding="utf8").read())
        hosts, n, dr = sd.read_hosts(open("raw3/exoplanet-hosts.csv", encoding="utf8").read())
        feats = json.load(open("raw/stars6.json", encoding="utf8"))["features"]
        doc, bad = sd.build(hyg, hosts, feats, dups, n, dr)
        self.assertEqual(bad, [])
        c = doc["counts"]
        self.assertEqual((c["matched"], c["notInHyg"]), (5041, 3))
        self.assertEqual(c["hostDistanceDiffers"], 0)
        # no luminosity without a distance anywhere in the real data
        self.assertTrue(all(v[2] is None for v in doc["stars"].values() if v[0] is None))
        # one entry per Hipparcos number: no catalogue star appears twice in the planet list and every planet name is unique
        names = [nm for p in doc["planets"].values() for nm in p["names"]]
        self.assertEqual(len(names), len(set(names)))


if __name__ == "__main__":
    unittest.main()
