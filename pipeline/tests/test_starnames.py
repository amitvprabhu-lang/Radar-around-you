import json
import os
import struct
import tempfile
import unittest

from .. import starnames
from .helpers import fx


def features():
    return json.loads(fx("stars_sample.json"))["features"]


class StarNamesTest(unittest.TestCase):
    def setUp(self):
        self.text = fx("iau_csn_sample.txt").decode("utf8")

    def test_rows_are_read_from_both_ends(self):
        updated, rows, bad = starnames.parse_csn(self.text)
        self.assertEqual(updated, "2022-04-04")
        self.assertEqual(bad, [])
        by = {r["name"]: r for r in rows}
        sirius = by["Sirius"]
        self.assertEqual((sirius["hip"], sirius["bayer"], sirius["con"], sirius["id"]), (32349, "α", "CMa", "alf"))
        self.assertAlmostEqual(sirius["ra"], 101.287, delta=0.01)
        # a blank component column shifts everything after it; Mebsuta is the real case
        mebsuta = by["Mebsuta"]
        self.assertEqual((mebsuta["hip"], mebsuta["con"], mebsuta["mag"]), (32246, "Gem", 3.06))
        # a pulsar has no magnitude and no HIP number
        self.assertEqual((by["Geminga"]["hip"], by["Geminga"]["mag"]), (None, None))

    def test_a_name_is_used_only_when_the_star_is_in_the_catalogue(self):
        _, rows, _ = starnames.parse_csn(self.text)
        matched, absent, disagree = starnames.match(rows, features())
        names = {m["name"] for m in matched}
        self.assertIn("Sirius", names)
        self.assertNotIn("Geminga", names)
        self.assertGreater(absent, 0, "faint and non-star objects in the IAU list are not in a magnitude 6 catalogue")
        self.assertEqual(disagree, [])
        mags = [m["mag"] for m in matched]
        self.assertEqual(mags, sorted(mags), "brightest first")
        sirius = next(m for m in matched if m["name"] == "Sirius")
        self.assertEqual(features()[sirius["i"]]["id"], 32349, "the index points at the same star in the catalogue")

    def test_a_star_in_the_wrong_place_is_reported_not_used(self):
        _, rows, _ = starnames.parse_csn(self.text)
        feats = features()
        i = next(k for k, f in enumerate(feats) if f["id"] == 32349)
        feats[i] = json.loads(json.dumps(feats[i]))
        feats[i]["geometry"]["coordinates"][0] += 5.0
        matched, _, disagree = starnames.match(rows, feats)
        self.assertEqual([d["name"] for d in disagree], ["Sirius"])
        self.assertNotIn("Sirius", {m["name"] for m in matched})

    def test_a_multiple_star_with_a_different_magnitude_still_matches_on_position(self):
        _, rows, _ = starnames.parse_csn(self.text)
        matched, _, disagree = starnames.match(rows, features())
        castor = next((m for m in matched if m["name"] == "Castor"), None)
        self.assertIsNotNone(castor, "Castor's component magnitude differs from the combined catalogue magnitude")
        self.assertEqual(disagree, [])

    def test_the_output_files(self):
        doc, disagree, bad = starnames.build(self.text, features())
        self.assertEqual((disagree, bad), ([], []))
        self.assertEqual(doc["counts"]["inCatalogue"], len(doc["stars"]))
        self.assertIn("CC BY", doc["credit"])
        with tempfile.TemporaryDirectory() as d:
            sf, mf = os.path.join(d, "stars.json"), os.path.join(d, "stars_in.json")
            with open(sf, "w") as f:
                json.dump({"features": features()}, f)
            with open(os.path.join(d, "meta.json"), "w") as f:
                json.dump({"keep": 1, "starNames": {"0": "old"}}, f)
            csn = os.path.join(d, "csn.txt")
            with open(csn, "w", encoding="utf8") as f:
                f.write(self.text)
            self.assertEqual(starnames.main(["--csn", csn, "--stars", sf, "--out", d]), 1, "too few matched stars to trust the file")
            # lower the floor for this run only; the sample is small
            old = starnames.build
            starnames.build = lambda t, fs: (dict(old(t, fs)[0], counts={"inCatalogue": 999, "inFile": 1, "notInCatalogue": 0}), [], [])
            try:
                self.assertEqual(starnames.main(["--csn", csn, "--stars", sf, "--out", d]), 0)
            finally:
                starnames.build = old
            with open(os.path.join(d, "starids.bin"), "rb") as f:
                ids = f.read()
            self.assertEqual(len(ids), 4 * len(features()))
            self.assertEqual([struct.unpack_from("<I", ids, 4 * k)[0] for k in range(len(features()))], [ft["id"] for ft in features()])
            with open(os.path.join(d, "meta.json")) as f:
                meta = json.load(f)
            self.assertEqual(meta["keep"], 1)
            self.assertTrue(all(k.isdigit() for k in meta["starNames"]))
            self.assertIn("Sirius", meta["starNames"].values())


@unittest.skipUnless(os.path.exists("raw/stars6.json") and os.path.exists("raw3/IAU-CSN.txt"), "needs the full raw files")
class RealFilesTest(unittest.TestCase):
    def test_every_named_star_agrees_with_the_catalogue(self):
        with open("raw3/IAU-CSN.txt", encoding="utf8") as f:
            text = f.read()
        with open("raw/stars6.json", encoding="utf8") as f:
            feats = json.load(f)["features"]
        doc, disagree, bad = starnames.build(text, feats)
        self.assertEqual((disagree, bad), ([], []))
        self.assertGreater(doc["counts"]["inCatalogue"], 300)


if __name__ == "__main__":
    unittest.main()
