import io
import json
import os
import tempfile
import unittest
import zipfile

from .. import places
from .helpers import fx


class PlacesTest(unittest.TestCase):
    def sample(self):
        return fx("geonames_cities_sample.txt").decode("utf8")

    def test_parse_reads_real_rows(self):
        rows, skipped = places.parse(self.sample())
        self.assertEqual(skipped, 0)
        by = {r[1]: r for r in rows}
        pune = by["Pune"]
        self.assertEqual((pune[0], pune[3], pune[6]), (1259229, "IN", "Asia/Kolkata"))
        self.assertAlmostEqual(pune[4], 18.5, delta=0.1)
        self.assertAlmostEqual(pune[5], 73.9, delta=0.1)
        self.assertEqual(by["Parbhani"][7], 307170)

    def test_malformed_rows_are_skipped_and_counted(self):
        good = self.sample().splitlines()[0]
        bad = [
            "short\tline",
            "\t".join(["1", "Bad", "Bad", "", "abc", "10", "P", "PPL", "XX", "", "", "", "", "", "20000", "", "0", "Etc/UTC", "2020-01-01"]),
            "\t".join(["2", "NoTz", "NoTz", "", "10", "10", "P", "PPL", "XX", "", "", "", "", "", "20000", "", "0", "", "2020-01-01"]),
            "\t".join(["3", "OffMap", "OffMap", "", "95", "10", "P", "PPL", "XX", "", "", "", "", "", "20000", "", "0", "Etc/UTC", "2020-01-01"]),
            "\t".join(["4", "BadCountry", "BadCountry", "", "10", "10", "P", "PPL", "XXX", "", "", "", "", "", "20000", "", "0", "Etc/UTC", "2020-01-01"]),
        ]
        rows, skipped = places.parse("\n".join([good] + bad))
        self.assertEqual(len(rows), 1)
        self.assertEqual(skipped, len(bad))

    def test_pack_orders_by_population_and_shares_zones(self):
        rows, _ = places.parse(self.sample())
        doc = places.pack(rows, "2026-10-04")
        pops = [p[7] for p in doc["p"]]
        self.assertEqual(pops, sorted(pops, reverse=True))
        self.assertEqual(len(doc["tz"]), len(set(doc["tz"])))
        for p in doc["p"]:
            self.assertEqual(len(p), len(doc["fields"]))
            self.assertIn(doc["tz"][p[6]], {r[6] for r in rows})
        self.assertIn("CC BY 4.0", doc["credit"])
        # the ascii name is only stored when it differs from the name
        reyk = next(p for p in doc["p"] if p[1] == "Reykjavík")
        self.assertEqual(reyk[2], "Reykjavik")
        pune = next(p for p in doc["p"] if p[1] == "Pune")
        self.assertEqual(pune[2], "")

    def test_main_writes_a_file_from_a_local_zip_and_refuses_a_tiny_one(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr(places.MEMBER, self.sample())
        with tempfile.TemporaryDirectory() as d:
            zp, out = os.path.join(d, "c.zip"), os.path.join(d, "places.json")
            with open(zp, "wb") as f:
                f.write(buf.getvalue())
            # ten rows is below the sanity floor, so nothing is written
            self.assertEqual(places.main(["--zip", zp, "--out", out]), 1)
            self.assertFalse(os.path.exists(out))
            old = places.parse
            try:
                places.parse = lambda text: ([(i, f"P{i}", f"P{i}", "IN", 10.0, 20.0, "Asia/Kolkata", 20000 - i) for i in range(6000)], 0)
                self.assertEqual(places.main(["--zip", zp, "--out", out]), 0)
            finally:
                places.parse = old
            with open(out, encoding="utf8") as f:
                doc = json.load(f)
            self.assertEqual(len(doc["p"]), 6000)

    def test_download_needs_a_contact(self):
        env = os.environ.pop("CONTACT_EMAIL", None)
        try:
            self.assertEqual(places.main(["--out", os.devnull]), 2)
        finally:
            if env is not None:
                os.environ["CONTACT_EMAIL"] = env


if __name__ == "__main__":
    unittest.main()
