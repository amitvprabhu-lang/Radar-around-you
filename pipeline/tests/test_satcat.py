"""The satcat feed: the whole catalogue counted by owner and kind (pipeline/satcat.py and the satcat builder in pipeline/feeds.py).

The fixture satcat_sample.csv.gz is a trim of the real https://celestrak.org/pub/satcat.csv of 2026-10-07 (rule in fixtures/README.md).
The JavaScript tests read what this feed publishes for that fixture from test/fixtures/satcat/; a test here checks those files are exactly
what the code makes, so the two sides cannot drift. To write them again after a deliberate change:
  python3 -m pipeline.tests.test_satcat --write
"""
import gzip
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from .. import config, feeds, satcat as SC
from .helpers import fx, fxj, resp
from .test_policy import seed_catalogue
from .test_runner import Base, http_date

URL = "https://celestrak.org/pub/satcat.csv"
SOURCE_TIME = "2026-10-07T04:04:48Z"
JS_FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test", "fixtures", "satcat")
CSV = fx("satcat_sample.csv.gz").decode("utf-8")
OWNERS = fxj("catalogue_sample.json")["owners"]


def sample(min_objects=100):
    return SC.summarise(CSV, SOURCE_TIME, OWNERS, min_objects=min_objects)


def row(**kw):
    base = {f: "" for f in SC.FIELDS}
    base.update({"OBJECT_NAME": "TEST", "OBJECT_ID": "2020-001A", "NORAD_CAT_ID": "1", "OBJECT_TYPE": "PAY", "OPS_STATUS_CODE": "+", "OWNER": "US",
                 "LAUNCH_DATE": "2020-01-01", "ORBIT_CENTER": "EA", "ORBIT_TYPE": "ORB", "PERIOD": "95.5", "INCLINATION": "53.0", "APOGEE": "550",
                 "PERIGEE": "540", "RCS": ""})
    base.update({k: str(v) for k, v in kw.items()})
    return base


def csv_of(rows, header=SC.FIELDS):
    lines = [",".join(header)] + [",".join(r.get(f, "") for f in header) for r in rows]
    return "\r\n".join(lines) + "\r\n"


class Summarise(unittest.TestCase):
    def test_kinds_follow_the_active_definition_of_the_count_page(self):
        rows = [row(NORAD_CAT_ID=i + 1, OPS_STATUS_CODE=s) for i, s in enumerate(["+", "P", "B", "S", "X", "-", "", "?"])]
        rows += [row(NORAD_CAT_ID=20, OBJECT_TYPE="R/B", OPS_STATUS_CODE=""), row(NORAD_CAT_ID=21, OBJECT_TYPE="DEB"), row(NORAD_CAT_ID=22, OBJECT_TYPE="UNK")]
        _, s = SC.summarise(csv_of(rows), SOURCE_TIME, {"US": "United States"}, min_objects=1)
        us = s["owners"][0]
        self.assertEqual((us["act"], us["inact"], us["rb"], us["deb"], us["unk"], us["total"]), (5, 3, 1, 1, 1, 11))
        self.assertEqual(us["name"], "United States")

    def test_earth_orbit_means_not_decayed_and_centred_on_earth_or_docked(self):
        rows = [row(NORAD_CAT_ID=1), row(NORAD_CAT_ID=2, DECAY_DATE="2024-01-01"), row(NORAD_CAT_ID=3, ORBIT_CENTER="MO"),
                row(NORAD_CAT_ID=4, ORBIT_CENTER="25544", ORBIT_TYPE="DOC"), row(NORAD_CAT_ID=5, ORBIT_CENTER="SU"), row(NORAD_CAT_ID=6, ORBIT_CENTER="MO", DECAY_DATE="2020-02-02")]
        _, s = SC.summarise(csv_of(rows), SOURCE_TIME, {}, min_objects=1)
        us = s["owners"][0]
        self.assertEqual(us["total"], 2, "the plain orbit and the docked object")
        self.assertEqual(us["away"], {"MO": 1, "SU": 1})
        self.assertEqual(us["decayed"], 2, "decayed objects count wherever they were")
        self.assertEqual(us["name"], "US", "an owner missing from the name table keeps its code")

    def test_the_year_counts_are_relative_to_the_source_time(self):
        rows = [row(NORAD_CAT_ID=1, LAUNCH_DATE="2025-10-07"), row(NORAD_CAT_ID=2, LAUNCH_DATE="2025-10-06"),
                row(NORAD_CAT_ID=3, DECAY_DATE="2025-10-07"), row(NORAD_CAT_ID=4, DECAY_DATE="2025-10-06")]
        _, s = SC.summarise(csv_of(rows), SOURCE_TIME, {}, min_objects=1)
        self.assertEqual((s["owners"][0]["new365"], s["owners"][0]["dec365"]), (1, 1))

    def test_no_elements_and_the_debris_owner_check(self):
        rows = [row(NORAD_CAT_ID=1, DATA_STATUS_CODE="NEA"), row(NORAD_CAT_ID=2, OPS_STATUS_CODE="-", DATA_STATUS_CODE="NEA"),
                row(NORAD_CAT_ID=3, OBJECT_TYPE="DEB", OBJECT_ID="2020-001C"), row(NORAD_CAT_ID=4, OBJECT_TYPE="DEB", OBJECT_ID="2020-001D", OWNER="PRC"),
                row(NORAD_CAT_ID=5, OBJECT_TYPE="DEB", OBJECT_ID="2021-009B", OWNER="PRC")]
        _, s = SC.summarise(csv_of(rows), SOURCE_TIME, {}, min_objects=1)
        self.assertEqual((s["totals"]["noElements"], s["totals"]["actNoElements"]), (2, 1))
        self.assertEqual(s["debrisOwnerCheck"], {"checked": 2, "sameAsPayload": 1}, "debris of a launch without a payload in the catalogue is not checked")

    def test_detail_files_hold_every_object_of_owners_with_enough(self):
        rows = [row(NORAD_CAT_ID=i + 1, RCS="1.23456") for i in range(SC.DETAIL_MIN)] + [row(NORAD_CAT_ID=100 + i, OWNER="O3B") for i in range(SC.DETAIL_MIN - 1)]
        files, s = SC.summarise(csv_of(rows), SOURCE_TIME, {}, min_objects=1)
        self.assertEqual(sorted(files), ["o-us.json", "summary.json"])
        d = json.loads(files["o-us.json"])
        self.assertEqual((d["owner"], d["count"], d["sourceTime"], d["fields"]), ("US", SC.DETAIL_MIN, SOURCE_TIME, SC.ROW_FIELDS))
        self.assertEqual(d["rows"][0], [1, "TEST", "2020-001A", "P", "+", "2020-01-01", 95.5, 53.0, 550, 540, 1.2346, ""])
        self.assertIsNone(next(o for o in s["owners"] if o["code"] == "O3B")["file"])

    def test_file_names_are_safe_and_never_clash(self):
        taken = set()
        self.assertEqual(SC.file_name("O3B", taken), "o-o3b.json")
        self.assertEqual(SC.file_name("o3b", taken), "o-o3b2.json")
        self.assertEqual(SC.file_name("A/B C", taken), "o-abc.json")
        self.assertEqual(SC.file_name("///", taken), "o-x.json")

    def test_guards(self):
        with self.assertRaisesRegex(SC.SatcatError, "header lacks"):
            SC.summarise(csv_of([row()], header=SC.FIELDS[:-1]), SOURCE_TIME, {}, min_objects=1)
        with self.assertRaisesRegex(SC.SatcatError, "implausible"):
            SC.summarise(csv_of([row()]), SOURCE_TIME, {}, min_objects=2)
        bad = [row(NORAD_CAT_ID=i + 1) for i in range(98)] + [row(NORAD_CAT_ID="x"), row(NORAD_CAT_ID=200, OBJECT_TYPE="SAT")]
        with self.assertRaisesRegex(SC.SatcatError, "2 of 100 rows"):
            SC.summarise(csv_of(bad), SOURCE_TIME, {}, min_objects=1)
        _, s = SC.summarise(csv_of(bad[:98] + [row(NORAD_CAT_ID=300), row(NORAD_CAT_ID=301)] + bad[-1:]), SOURCE_TIME, {}, min_objects=1)
        self.assertEqual(s["badRows"], 1, "one bad row in 101 is within the limit and is counted")

    def test_the_sample_adds_up(self):
        files, s = sample()
        t = s["totals"]
        self.assertEqual(t["act"] + t["inact"] + t["rb"] + t["deb"] + t["unk"], t["total"])
        self.assertEqual(sum(o["total"] for o in s["owners"]), t["total"])
        for o in s["owners"]:
            if o["file"]:
                self.assertEqual(json.loads(files[o["file"]])["count"], o["total"], o["code"])
        self.assertLess(len(files["summary.json"]), 60_000, "the summary stays under the 60 KB target")

    def test_the_javascript_fixture_is_what_this_code_makes(self):
        files, _ = sample()
        have = sorted(os.listdir(JS_FIXTURE))
        self.assertEqual(have, sorted(files), "run python3 -m pipeline.tests.test_satcat --write after a deliberate change")
        for name, data in files.items():
            with open(os.path.join(JS_FIXTURE, name), "rb") as f:
                self.assertEqual(f.read(), data, name)


class NameTable(unittest.TestCase):
    def test_a_line_break_in_a_name_is_a_space(self):
        from ..catalogue import name_table
        page = "<table><tr><th>Source Code</th><th>Source Description</th></tr><tr><td>EUME</td><td>European Organization for the<br>Exploitation of Meteorological Satellites (EUMETSAT)</td></tr></table>"
        self.assertEqual(name_table(page, "Source Code"), {"EUME": "European Organization for the Exploitation of Meteorological Satellites (EUMETSAT)"})


class Feed(Base):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(feeds, "SATCAT_MIN_OBJECTS", 100)
        p.start()
        self.addCleanup(p.stop)
        seed_catalogue(self.data)
        self.clock.t = datetime(2026, 10, 7, 5, 0, tzinfo=timezone.utc)  # an hour after the fixture's Last-Modified
        self.body = CSV.encode("utf-8")
        self.answer(resp(200, self.body, last_modified="Wed, 07 Oct 2026 04:04:48 GMT"))

    def answer(self, r):
        self.net.routes = [x for x in self.net.routes if x[0] != URL]
        self.net.add(URL, r)

    def test_a_run_publishes_the_summary_and_owner_files_from_one_version(self):
        s = self.run_(["satcat"])
        self.assertEqual(s["ok"], ["satcat"])
        f = self.manifest()["feeds"]["satcat"]
        self.assertIn("summary.json", f["files"])
        self.assertIn("o-us.json", f["files"])
        self.assertEqual({p.split("/")[1] for p in f["files"].values()}, {f["version"]})
        self.assertEqual(f["sourceTime"], SOURCE_TIME, "the source time is the CSV's Last-Modified")
        summary = self.jread(f["files"]["summary.json"])
        self.assertEqual(f["count"], summary["totals"]["total"])
        self.assertEqual(f["refreshSec"], 86400)
        self.assertEqual([c[0] for c in self.net.calls], [URL], "one request")
        self.assertNotIn("If-Modified-Since", self.net.calls[0][1], "no conditional request: a 304 would count as non-200 under the halt rule")
        self.assertEqual(self.sleeps, [feeds.PAUSE_S])
        self.assertTrue(self.net.calls[0][1]["User-Agent"].startswith("RadarAroundYou-pipeline/"))

    def test_the_same_catalogue_again_publishes_nothing(self):
        self.run_(["satcat"])
        before = self.manifest()["feeds"]["satcat"]
        self.clock.advance(86400)
        s = self.run_(["satcat"])
        self.assertEqual(s["unchanged"], ["satcat"])
        self.assertEqual(self.manifest()["feeds"]["satcat"]["version"], before["version"])
        self.assertEqual(self.versions("satcat"), [before["version"]])

    def test_a_changed_catalogue_publishes_a_new_version(self):
        self.run_(["satcat"])
        v1 = self.manifest()["feeds"]["satcat"]["version"]
        self.clock.advance(86400)
        changed = self.body.replace(b",+,US,", b",-,US,", 1)
        self.assertNotEqual(changed, self.body)
        self.answer(resp(200, changed, last_modified="Thu, 08 Oct 2026 04:00:00 GMT"))
        s = self.run_(["satcat"])
        self.assertEqual(s["ok"], ["satcat"])
        f = self.manifest()["feeds"]["satcat"]
        self.assertNotEqual(f["version"], v1)
        self.assertEqual(f["sourceTime"], "2026-10-08T04:00:00Z")

    def test_it_is_asked_once_a_day(self):
        self.run_(["satcat"])
        self.clock.advance(3600)
        s = self.run_(["satcat"])
        self.assertEqual(s["skipped"], ["satcat (not yet)"])
        self.assertEqual(self.net.count(URL), 1)

    def test_a_non_200_answer_halts_every_celestrak_feed(self):
        self.answer(resp(503))
        s = self.run_(["satcat"])
        self.assertEqual(list(s["halted"]), ["satcat"])
        self.assertEqual(self.net.count(URL), 1, "asked once, never repeated")
        self.assertIn("celestrak", self.state()["halts"])
        s = self.run_(["satellites", "catalogue", "satcat"], force=True)
        self.assertEqual(sorted(x.split(" ")[0] for x in s["skipped"]), ["catalogue", "satcat", "satellites"])
        self.assertEqual(config.HALT_COOL_OFF_S, 21600)

    def test_without_the_catalogue_nothing_is_asked(self):
        os.remove(os.path.join(self.data, "_state", "catalogue.json.gz"))
        s = self.run_(["satcat"])
        self.assertIn("has not been built", s["failed"]["satcat"])
        self.assertEqual(self.net.calls, [])

    def test_a_much_smaller_catalogue_is_refused_and_the_last_copy_kept(self):
        self.run_(["satcat"])
        good = self.manifest()["feeds"]["satcat"]["files"]
        self.clock.advance(86400)
        lines = CSV.split("\r\n")
        self.answer(resp(200, "\r\n".join(lines[: len(lines) // 2]).encode() + b"\r\n"))
        with mock.patch.object(feeds, "SATCAT_MIN_OBJECTS", 10):
            s = self.run_(["satcat"])
        self.assertIn("fell from", s["failed"]["satcat"])
        self.assertEqual(self.manifest()["feeds"]["satcat"]["files"], good)

    def test_too_few_objects_is_refused(self):
        with mock.patch.object(feeds, "SATCAT_MIN_OBJECTS", 15000):
            s = self.run_(["satcat"])
        self.assertIn("implausible", s["failed"]["satcat"])

    def test_a_last_modified_in_the_future_is_not_trusted(self):
        self.answer(resp(200, self.body, last_modified=http_date(self.clock() + timedelta(days=2))))
        self.run_(["satcat"])
        self.assertEqual(self.manifest()["feeds"]["satcat"]["sourceTime"], "2026-10-07T05:00:00Z", "the fetch time instead")


if __name__ == "__main__" and "--write" in sys.argv:
    files, _ = sample()
    os.makedirs(JS_FIXTURE, exist_ok=True)
    for old in os.listdir(JS_FIXTURE):
        os.remove(os.path.join(JS_FIXTURE, old))
    for name, data in files.items():
        with open(os.path.join(JS_FIXTURE, name), "wb") as f:
            f.write(data)
    print(f"wrote {len(files)} files to {os.path.normpath(JS_FIXTURE)}")
