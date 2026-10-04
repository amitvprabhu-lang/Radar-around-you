import email.utils
import gzip
import json
import os
import unittest
from datetime import timedelta
from unittest import mock

from .. import config, feeds, net, runner
from ..runner import FeedFailure, Runner
from .helpers import NOW, Clock, FakeNet, fx, fxj, resp, workdir

QUAKES = "https://earthquake.usgs.gov/"
GD_OR = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Orange;Red"
GD_GREEN = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green"
MET = "https://api.met.no/"
ADSB = "https://api.adsb.lol/"
SWPC_AURORA = "https://services.swpc.noaa.gov/json/ovation"
SWPC_KP = "https://services.swpc.noaa.gov/products/noaa-planetary"


def http_date(dt):
    return email.utils.format_datetime(dt, usegmt=True)


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp, self.data, self.base = workdir()
        self.addCleanup(self._tmp.cleanup)
        self.clock, self.net, self.sleeps = Clock(), FakeNet(), []
        self.runner = Runner(self.data, self.base, "test@example.com", feeds.BUILDERS, clock=self.clock, fetch=self.net,
                             sleep=self.sleeps.append, log=lambda *a: None)

    def run_(self, only, force=False):
        return self.runner.run(only=set(only) if only else None, force=force)

    def manifest(self):
        with open(os.path.join(self.data, "manifest.json")) as f:
            return json.load(f)

    def state(self):
        with open(os.path.join(self.data, "_state", "state.json")) as f:
            return json.load(f)

    def path(self, rel):
        return os.path.join(self.data, rel)

    def jread(self, rel):
        with open(self.path(rel), encoding="utf-8") as f:
            return json.load(f)

    def bread(self, rel):
        with open(self.path(rel), "rb") as f:
            return f.read()

    def versions(self, feed):
        d = self.path(feed)
        return sorted(os.listdir(d)) if os.path.isdir(d) else []


class Publishing(Base):
    def test_first_run_publishes_a_version_and_a_manifest(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson"), etag='"v1"', expires=http_date(NOW + timedelta(seconds=60))))
        s = self.run_(["quakes"])
        self.assertEqual(s["ok"], ["quakes"])
        f = self.manifest()["feeds"]["quakes"]
        self.assertEqual(f["status"], "ok")
        self.assertEqual(f["version"], "20261004T183000Z")
        self.assertEqual(f["files"], {"quakes.json": "quakes/20261004T183000Z/quakes.json"})
        self.assertTrue(os.path.exists(self.path(f["files"]["quakes.json"])))
        self.assertEqual(f["checkedAt"], "2026-10-04T18:30:00Z")
        self.assertGreaterEqual(f["count"], 55)
        self.assertIn("Updated every minute", f["says"])
        self.assertTrue(f["licence"] and f["credit"] and f["docUrl"].startswith("https://"))
        self.assertEqual([p for p in os.listdir(self.path("quakes/20261004T183000Z")) if ".tmp" in p], [], "no temporary files are left")

    def test_the_manifest_lists_every_feed_and_the_static_data(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson")))
        self.run_(["quakes"])
        m = self.manifest()
        self.assertEqual(set(m["feeds"]), set(config.FEEDS))
        self.assertEqual(m["feeds"]["kp"]["status"], "never")
        self.assertTrue(m["static"] and all(s["label"] and s["note"] for s in m["static"]))
        self.assertEqual(m["schema"], 1)

    def test_a_feed_that_is_not_due_is_skipped_then_runs_after_its_interval(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson")))
        self.run_(["quakes"])
        s = self.run_(["quakes"])
        self.assertEqual(s["ran"], [])
        self.assertIn("quakes (not yet)", s["skipped"])
        self.assertEqual(self.net.count(QUAKES), 1)
        self.clock.advance(config.FEEDS["quakes"].refresh_s - runner.SLACK_S + 1)
        self.assertEqual(self.run_(["quakes"])["ran"], ["quakes"])
        self.assertEqual(self.net.count(QUAKES), 2)

    def test_not_modified_keeps_the_files_and_asks_with_the_etag(self):
        self.net.add(QUAKES, [resp(200, fx("usgs_week_60.geojson"), etag='"v1"', last_modified="Sun, 04 Oct 2026 18:29:00 GMT"), resp(304)])
        self.run_(["quakes"])
        v1 = self.manifest()["feeds"]["quakes"]["version"]
        self.clock.advance(700)
        s = self.run_(["quakes"])
        self.assertEqual(s["unchanged"], ["quakes"])
        sent = self.net.calls[-1][1]
        self.assertEqual(sent["If-None-Match"], '"v1"')
        self.assertEqual(sent["If-Modified-Since"], "Sun, 04 Oct 2026 18:29:00 GMT")
        f = self.manifest()["feeds"]["quakes"]
        self.assertEqual(f["version"], v1)
        self.assertEqual(f["checkedAt"], "2026-10-04T18:41:40Z", "checked again, so it is current")

    def test_every_request_identifies_the_application(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson")))
        self.run_(["quakes"])
        ua = self.net.calls[0][1]["User-Agent"]
        self.assertTrue(ua.startswith("RadarAroundYou-pipeline/") and "test@example.com" in ua)

    def test_old_versions_are_pruned_but_the_current_one_stays(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson")))
        for _ in range(6):
            self.run_(["quakes"], force=True)
            self.clock.advance(700)
        v = self.versions("quakes")
        self.assertEqual(len(v), config.KEEP_VERSIONS)
        self.assertEqual(v[-1], self.manifest()["feeds"]["quakes"]["version"])

    def test_the_aurora_feed_writes_a_grid_and_its_times(self):
        self.net.add(SWPC_AURORA, resp(200, fx("ovation_latest.json.gz"), etag='"a"'))
        self.run_(["aurora"])
        f = self.manifest()["feeds"]["aurora"]
        grid = self.bread(f["files"]["aurora.bin"])
        meta = self.jread(f["files"]["aurora.json"])
        self.assertEqual(len(grid), 360 * 181)
        self.assertRegex(meta["observation"], r"^2026-10-04T")
        self.assertEqual(f["sourceTime"], meta["observation"])

    def test_the_kp_feed_reports_the_time_of_its_newest_row(self):
        self.net.add(SWPC_KP, resp(200, fx("kp.json")))
        self.run_(["kp"])
        f = self.manifest()["feeds"]["kp"]
        rows = self.jread(f["files"]["kp.json"])
        self.assertEqual(len(rows), 16)
        self.assertEqual(f["sourceTime"], rows[-1]["t"] + "Z")


class Hazards(Base):
    def routes(self):
        self.net.add(GD_OR, resp(200, fx("gdacs_orange_red.json"))).add(GD_GREEN, resp(200, fx("gdacs_green.json")))

    def test_both_alert_levels_are_fetched_and_merged(self):
        self.routes()
        self.run_(["events"])
        evs = self.jread(self.manifest()["feeds"]["events"]["files"]["events.json"])
        self.assertEqual({"Orange", "Green"} <= {e["alert"] for e in evs}, True)
        self.assertEqual(self.net.count(GD_OR), 1)
        self.assertEqual(self.net.count(GD_GREEN), 1)
        src = self.manifest()["feeds"]["events"]["sourceTime"]
        self.assertRegex(src, r"^2026-10-0\dT\d\d:\d\d:\d\dZ$")
        self.assertLessEqual(runner.parse(src), self.clock(), "the source time is a modification time, never a future event date")

    def test_a_full_page_makes_it_read_the_next_page(self):
        page = fxj("gdacs_green.json")
        one = page["features"][0]
        full = {"features": [json.loads(json.dumps(one)) for _ in range(100)]}
        for i, f in enumerate(full["features"]):
            f["properties"]["eventid"] = 5000 + i
        self.net.add(GD_OR, resp(200, fx("gdacs_orange_red.json")))
        self.net.add(GD_GREEN, [resp(200, json.dumps(full)), resp(200, fx("gdacs_green.json"))])
        self.run_(["events"])
        self.assertEqual(self.net.count(GD_GREEN), 2, "100 results is the page limit, so the second page was read")

    def test_an_empty_answer_does_not_replace_a_good_list(self):
        self.routes()
        self.run_(["events"])
        empty = json.dumps({"type": "FeatureCollection", "features": []})
        self.net.routes.clear()
        self.net.add(GD_OR, resp(200, empty)).add(GD_GREEN, resp(200, empty))
        self.clock.advance(1000)
        s = self.run_(["events"])
        self.assertIn("events", s["failed"])
        self.assertIn("last good copy", s["failed"]["events"])


class Failures(Base):
    def good(self):
        return resp(200, fx("usgs_week_60.geojson"))

    def test_a_server_error_keeps_the_last_good_copy_and_backs_off(self):
        self.net.add(QUAKES, [self.good(), resp(500), resp(500), resp(500)])
        self.run_(["quakes"])
        good = self.manifest()["feeds"]["quakes"]
        self.clock.advance(700)
        s = self.run_(["quakes"])
        self.assertIn("quakes", s["failed"])
        f = self.manifest()["feeds"]["quakes"]
        self.assertEqual((f["status"], f["failures"]), ("failing", 1))
        self.assertEqual(f["files"], good["files"], "the last good file is still the one listed")
        self.assertEqual(f["checkedAt"], good["checkedAt"], "it was not confirmed current")
        self.assertEqual(f["nextTryAt"], "2026-10-04T18:51:40Z", "first failure waits one normal interval")

    def test_the_wait_doubles_with_each_failure_up_to_eight_times(self):
        self.net.add(QUAKES, resp(503))
        waits = []
        for _ in range(6):
            self.run_(["quakes"], force=True)
            waits.append((runner.parse(self.state()["feeds"]["quakes"]["nextTryAt"]) - self.clock()).total_seconds())
            self.clock.advance(60)
        r = config.FEEDS["quakes"].refresh_s
        self.assertEqual(waits, [r, 2 * r, 4 * r, 8 * r, 8 * r, 8 * r], "doubles, then stays at eight times the normal interval")

    def test_a_server_error_is_retried_before_it_counts_as_a_failure(self):
        self.net.add(QUAKES, [resp(500), resp(502), self.good()])
        s = self.run_(["quakes"])
        self.assertEqual(s["ok"], ["quakes"])
        self.assertEqual(self.net.count(QUAKES), 3)
        self.assertEqual(self.sleeps, [3, 6])

    def test_a_network_error_is_a_failure_after_the_retries(self):
        self.net.add(QUAKES, net.FetchError("ConnectionResetError: reset"))
        s = self.run_(["quakes"])
        self.assertIn("reset", s["failed"]["quakes"])
        self.assertEqual(self.net.count(QUAKES), 3)

    def test_garbage_with_a_200_is_not_published(self):
        self.net.add(QUAKES, [self.good(), resp(200, b"<html>maintenance</html>")])
        self.run_(["quakes"])
        before = self.manifest()["feeds"]["quakes"]["files"]
        self.clock.advance(700)
        s = self.run_(["quakes"])
        self.assertIn("quakes", s["failed"])
        self.assertEqual(self.manifest()["feeds"]["quakes"]["files"], before)
        self.assertIn("not valid JSON", self.manifest()["feeds"]["quakes"]["error"])

    def test_forbidden_and_rate_limited_answers_wait_much_longer(self):
        self.net.add(QUAKES, resp(403))
        self.run_(["quakes"])
        wait = (runner.parse(self.state()["feeds"]["quakes"]["nextTryAt"]) - self.clock()).total_seconds()
        self.assertEqual(wait, 6 * 3600)
        self.net.routes.clear()
        self.net.add(QUAKES, resp(429, retry_after="1800"))
        self.run_(["quakes"], force=True)
        wait = (runner.parse(self.state()["feeds"]["quakes"]["nextTryAt"]) - self.clock()).total_seconds()
        self.assertEqual(wait, 1800)

    def test_one_failing_feed_does_not_stop_the_others(self):
        self.net.add(QUAKES, resp(500)).add(SWPC_KP, resp(200, fx("kp.json")))
        s = self.run_(["quakes", "kp"])
        self.assertEqual((list(s["failed"]), s["ok"]), (["quakes"], ["kp"]))

    def test_an_unexpected_exception_is_contained_and_reported(self):
        self.net.add(SWPC_KP, resp(200, fx("kp.json")))
        broken = dict(feeds.BUILDERS, quakes=lambda ctx: {}["missing"])
        r = Runner(self.data, self.base, "t@example.com", broken, clock=self.clock, fetch=self.net, sleep=lambda s: None, log=lambda *a: None)
        s = r.run(only={"quakes", "kp"})
        self.assertIn("KeyError", s["failed"]["quakes"])
        self.assertEqual(s["ok"], ["kp"])

    def test_the_sources_own_expires_time_is_respected(self):
        self.net.add(QUAKES, resp(200, fx("usgs_week_60.geojson"), expires=http_date(NOW + timedelta(hours=2))))
        self.run_(["quakes"])
        self.assertEqual(self.state()["feeds"]["quakes"]["nextTryAt"], "2026-10-04T20:30:00Z")


class PerPlace(Base):
    def met(self, **extra):
        return resp(200, fx("met_pune.json"), last_modified="Sun, 04 Oct 2026 18:29:00 GMT", expires=http_date(NOW + timedelta(minutes=30)), **extra)

    def test_every_place_is_fetched_with_four_decimals_and_an_identifying_agent(self):
        self.net.add(MET, self.met())
        self.run_(["clouds"])
        urls = [c[0] for c in self.net.calls]
        self.assertIn("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=18.5204&lon=73.8567", urls)
        self.assertIn("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=51.5074&lon=-0.1278", urls)
        f = self.manifest()["feeds"]["clouds"]
        cities = self.jread(f["files"]["clouds.json"])["cities"]
        self.assertEqual(set(cities), {"pune", "london"})
        self.assertTrue(all(c["fetchedAt"] == "2026-10-04T18:30:00Z" and len(c["hours"]) == 36 for c in cities.values()))

    def test_a_place_is_not_asked_again_before_its_expires_time(self):
        self.net.add(MET, self.met())
        self.run_(["clouds"])
        self.clock.advance(600)
        s = self.run_(["clouds"], force=True)
        self.assertEqual(s["unchanged"], ["clouds"])
        self.assertEqual(self.net.count(MET), 2, "no new requests inside the Expires window")
        self.clock.advance(3600)
        self.run_(["clouds"], force=True)
        self.assertEqual(self.net.count(MET), 4)
        self.assertIn("If-Modified-Since", self.net.calls[-1][1])

    def test_a_failing_place_keeps_its_last_copy_while_the_others_refresh(self):
        self.net.add(MET, self.met())
        self.run_(["clouds"])
        first = self.jread(self.manifest()["feeds"]["clouds"]["files"]["clouds.json"])["cities"]
        self.net.routes.clear()
        self.net.add(MET + "weatherapi/locationforecast/2.0/compact?lat=18", self.met())
        self.net.add(MET + "weatherapi/locationforecast/2.0/compact?lat=51", resp(500))
        self.clock.advance(7200)
        s = self.run_(["clouds"], force=True)
        self.assertEqual(s["ok"], ["clouds"])
        f = self.manifest()["feeds"]["clouds"]
        cities = self.jread(f["files"]["clouds.json"])["cities"]
        self.assertEqual(cities["london"], first["london"], "London keeps its earlier forecast")
        self.assertNotEqual(cities["pune"]["fetchedAt"], first["pune"]["fetchedAt"])
        self.assertIn("kept the last copy for 1", f["note"])

    def test_when_every_place_fails_the_feed_fails(self):
        self.net.add(MET, resp(500))
        s = self.run_(["clouds"])
        self.assertIn("clouds", s["failed"])
        self.assertEqual(self.manifest()["feeds"]["clouds"]["status"], "failing")

    def test_a_place_removed_from_the_baseline_leaves_the_output(self):
        self.net.add(MET, self.met())
        self.run_(["clouds"])
        with open(os.path.join(self.base, "cities.json"), "w") as f:
            json.dump([{"id": "pune", "name": "Pune", "lat": 18.5204, "lon": 73.8567}], f)
        self.net.routes.clear()
        self.net.add(MET, self.met())
        self.clock.advance(7200)
        self.run_(["clouds"], force=True)
        cities = self.jread(self.manifest()["feeds"]["clouds"]["files"]["clouds.json"])["cities"]
        self.assertEqual(set(cities), {"pune"})

    def test_aircraft_are_fetched_for_every_place(self):
        self.net.add(ADSB, resp(200, fx("planes_pune_80.json")))
        self.run_(["planes"])
        self.assertIn("https://api.adsb.lol/v2/point/18.5204/73.8567/150", [c[0] for c in self.net.calls])
        f = self.manifest()["feeds"]["planes"]
        self.assertEqual(set(self.jread(f["files"]["planes.json"])["cities"]), {"pune", "london"})
        self.assertGreater(f["count"], 0)


if __name__ == "__main__":
    unittest.main()
