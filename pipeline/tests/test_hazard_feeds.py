import json
import struct
import unittest
from datetime import datetime, timezone
from unittest import mock

from .. import config, hazards
from ..runner import FeedFailure
from .helpers import Clock, fx, resp
from .test_runner import Base

WIND, MAG, ALERTS = (config.SWPC_URLS[k] for k in ("wind", "mag", "alerts"))
NHC = "https://www.nhc.noaa.gov/CurrentStorms.json"
TRACK = "https://www.nhc.noaa.gov/storm_graphics/api/EP182026_030adv_TRACK.kmz"
CONE = "https://www.nhc.noaa.gov/storm_graphics/api/EP182026_030adv_CONE.kmz"
LATE = datetime(2026, 10, 4, 19, 45, tzinfo=timezone.utc)  # a few minutes after the fixtures were taken


class HazardBase(Base):
    def setUp(self):
        super().setUp()
        self.clock.t = LATE


class SpaceWeather(HazardBase):
    def routes(self):
        self.net.add(WIND, resp(200, fx("swpc_wind_active_420.json"))).add(MAG, resp(200, fx("swpc_mag_active_420.json"))).add(ALERTS, resp(200, fx("swpc_alerts_sample.json")))

    def test_one_file_with_wind_field_and_alerts(self):
        self.routes()
        self.run_(["spaceweather"])
        f = self.manifest()["feeds"]["spaceweather"]
        d = self.jread(f["files"]["spaceweather.json"])
        self.assertEqual(f["status"], "ok")
        self.assertEqual(f["sourceTime"], "2026-10-04T19:28:00Z")
        self.assertGreater(len(d["points"]), 60)
        self.assertTrue(any(a["id"] == "WARK06-671" for a in d["alerts"]))
        self.assertEqual(self.net.count("https://services.swpc.noaa.gov/"), 3)

    def test_a_failed_request_keeps_the_last_good_copy(self):
        self.routes()
        self.run_(["spaceweather"])
        first = self.manifest()["feeds"]["spaceweather"]["files"]["spaceweather.json"]
        self.clock.advance(1200)
        self.net.routes.clear()
        self.net.add(WIND, resp(500)).add(MAG, resp(200, fx("swpc_mag_active_420.json"))).add(ALERTS, resp(200, fx("swpc_alerts_sample.json")))
        self.run_(["spaceweather"], force=True)
        f = self.manifest()["feeds"]["spaceweather"]
        self.assertEqual(f["files"]["spaceweather.json"], first)
        self.assertNotEqual(f["status"], "ok")

    def test_a_garbage_answer_is_not_published(self):
        self.net.add(WIND, resp(200, b"<html>maintenance</html>")).add(MAG, resp(200, fx("swpc_mag_active_420.json"))).add(ALERTS, resp(200, fx("swpc_alerts_sample.json")))
        self.run_(["spaceweather"])
        self.assertNotIn("spaceweather.json", self.manifest()["feeds"].get("spaceweather", {}).get("files", {}))


class Storms(HazardBase):
    def routes(self, track=True):
        self.net.add(NHC, resp(200, fx("nhc_current_storms.json")))
        self.net.add(CONE, resp(200, fx("nhc_ep182026_030_cone.kmz")))
        self.net.add(TRACK, resp(200, fx("nhc_ep182026_030_track.kmz")) if track else resp(404))
        self.net.add("https://www.nhc.noaa.gov/storm_graphics/api/EP152026_056adv_TRACK.kmz", resp(200, fx("nhc_ep152026_track.kmz")))
        self.net.add("https://www.nhc.noaa.gov/storm_graphics/api/EP152026_056adv_CONE.kmz", resp(200, fx("nhc_ep152026_cone.kmz")))

    def test_active_storms_are_published_with_track_and_cone(self):
        self.routes()
        self.run_(["storms"])
        f = self.manifest()["feeds"]["storms"]
        d = self.jread(f["files"]["storms.json"])
        self.assertEqual([s["name"] for s in d["storms"]], ["Rachel", "Nolo"])
        r = d["storms"][0]
        self.assertEqual(len(r["track"]), 8)
        self.assertTrue(r["cone"])
        nolo = d["storms"][1]
        self.assertEqual(len(nolo["track"]), 8)  # the dateline-crossing storm is kept with its wrapped track
        self.assertEqual(nolo["extras"], [])
        self.assertEqual(f["sourceTime"], max(s["updated"] for s in d["storms"]))

    def test_a_missing_track_does_not_drop_the_storm(self):
        self.routes(track=False)
        self.run_(["storms"])
        d = self.jread(self.manifest()["feeds"]["storms"]["files"]["storms.json"])
        self.assertEqual(len(d["storms"]), 2)
        self.assertEqual(d["storms"][0]["track"], [])

    def test_a_quiet_season_publishes_an_empty_list(self):
        self.net.add(NHC, resp(200, json.dumps({"activeStorms": []})))
        self.run_(["storms"])
        f = self.manifest()["feeds"]["storms"]
        self.assertEqual(f["status"], "ok")
        self.assertEqual(self.jread(f["files"]["storms.json"])["storms"], [])


class Fires(HazardBase):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(hazards, "FIRE_MIN_ROWS", 100)  # the fixtures are short
        p.start()
        self.addCleanup(p.stop)

    def test_cells_and_a_summary_are_published(self):
        self.net.add("https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi", resp(200, fx("firms_snpp_500.csv")))
        self.net.add("https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20", resp(200, fx("firms_noaa20_300.csv")))
        self.net.add("https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21", resp(503))
        self.run_(["fires"])
        f = self.manifest()["feeds"]["fires"]
        blob = self.bread(f["files"]["fires.bin"])
        s = self.jread(f["files"]["fires.json"])
        self.assertEqual(len(blob), hazards.FIRE_REC.size * s["cells"])
        self.assertEqual(f["count"], s["cells"])
        self.assertEqual(f["sourceTime"], s["newest"])
        self.assertIn("not fetched: 1 file", f["note"])

    def test_no_file_at_all_is_a_failure(self):
        self.net.add("https://firms.modaps.eosdis.nasa.gov/", resp(503))
        self.run_(["fires"])
        f = self.manifest()["feeds"].get("fires", {})
        self.assertNotEqual(f.get("status"), "ok")


if __name__ == "__main__":
    unittest.main()


class CloseApproaches(HazardBase):
    CAD = "https://ssd-api.jpl.nasa.gov/cad.api"

    def test_the_feed_publishes_the_list_with_its_closest_object(self):
        self.net.add(self.CAD, resp(200, fx("jpl_cad_60d.json")))
        self.run_(["closeapproaches"])
        f = self.manifest()["feeds"]["closeapproaches"]
        d = self.jread(f["files"]["closeapproaches.json"])
        self.assertEqual(len(d["approaches"]), 31)
        self.assertEqual(f["count"], 31)
        self.assertIn("closest:", f["note"])
        self.assertEqual(self.net.count(self.CAD), 1)

    def test_a_changed_api_version_keeps_the_last_good_copy(self):
        self.net.add(self.CAD, resp(200, fx("jpl_cad_60d.json")))
        self.run_(["closeapproaches"])
        first = self.manifest()["feeds"]["closeapproaches"]["files"]["closeapproaches.json"]
        d = json.loads(fx("jpl_cad_60d.json"))
        d["signature"]["version"] = "9.9"
        self.clock.advance(7 * 3600)
        self.net.routes.clear()
        self.net.add(self.CAD, resp(200, json.dumps(d)))
        self.run_(["closeapproaches"], force=True)
        f = self.manifest()["feeds"]["closeapproaches"]
        self.assertEqual(f["files"]["closeapproaches.json"], first)
        self.assertNotEqual(f["status"], "ok")
