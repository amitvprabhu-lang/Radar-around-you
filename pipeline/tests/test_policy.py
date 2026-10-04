import gzip
import json
import os
import unittest
from datetime import timedelta
from unittest import mock

from .. import config, feeds, net, runner
from ..catalogue import GROUPS
from ..runner import Runner
from .helpers import Clock, FakeNet, fx, fxj, resp, workdir
from .test_runner import Base

GP = "https://celestrak.org/NORAD/elements/gp.php?GROUP="
SATCAT = "https://celestrak.org/satcat/records.php?GROUP="


def seed_catalogue(data):
    d = os.path.join(data, "_state")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "catalogue.json.gz"), "wb") as f:
        f.write(gzip.compress(fx("catalogue_sample.json")))
    with open(os.path.join(d, "debris.json.gz"), "wb") as f:
        f.write(gzip.compress(fx("gp_debris_groups.json")))


class Satellites(Base):
    def setUp(self):
        super().setUp()
        for patch in (mock.patch.object(feeds, "GP_MIN_ACTIVE", 100),):
            patch.start()
            self.addCleanup(patch.stop)
        seed_catalogue(self.data)
        self.net.add(GP + "active", resp(200, fx("gp_active_300.json"))).add(GP + "stations", resp(200, fx("gp_stations_6.json"))).add(GP + "visual", resp(200, fx("gp_visual_30.json")))

    def test_a_run_publishes_every_packed_file_from_one_version(self):
        s = self.run_(["satellites"])
        self.assertEqual(s["ok"], ["satellites"])
        f = self.manifest()["feeds"]["satellites"]
        self.assertEqual(set(f["files"]), {"swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json", "satmeta.json"})
        self.assertEqual({p.split("/")[1] for p in f["files"].values()}, {f["version"]}, "all files share one version folder, so a reader never mixes two builds")
        meta = self.jread(f["files"]["satmeta.json"])
        self.assertEqual(len(self.bread(f["files"]["ids.bin"])), meta["count"] * 4)
        self.assertEqual(meta["ref"], int(self.clock().timestamp() * 1000))
        self.assertEqual(f["count"], meta["count"])
        self.assertIn("exact orbits", f["note"])

    def test_the_three_groups_are_asked_for_once_each_with_a_pause(self):
        self.run_(["satellites"])
        self.assertEqual([c[0] for c in self.net.calls], [GP + "active&FORMAT=json", GP + "stations&FORMAT=json", GP + "visual&FORMAT=json"])
        self.assertEqual(self.sleeps, [feeds.PAUSE_S, feeds.PAUSE_S])

    def test_without_the_catalogue_it_fails_clearly(self):
        os.remove(os.path.join(self.data, "_state", "catalogue.json.gz"))
        s = self.run_(["satellites"])
        self.assertIn("catalogue has not been built", s["failed"]["satellites"])
        self.assertEqual(self.net.calls, [], "nothing is requested when the inputs are not ready")

    def test_a_much_smaller_answer_is_rejected_and_the_last_copy_kept(self):
        self.run_(["satellites"])
        good = self.manifest()["feeds"]["satellites"]["files"]
        small = fxj("gp_active_300.json")[:120]
        self.net.routes.clear()
        self.net.add(GP + "active", resp(200, json.dumps(small))).add(GP + "stations", resp(200, fx("gp_stations_6.json"))).add(GP + "visual", resp(200, fx("gp_visual_30.json")))
        self.clock.advance(8000)
        s = self.run_(["satellites"])
        self.assertIn("fell from", s["failed"]["satellites"])
        self.assertEqual(self.manifest()["feeds"]["satellites"]["files"], good)

    def test_too_few_records_is_rejected(self):
        self.net.routes.clear()
        self.net.add(GP + "active", resp(200, json.dumps(fxj("gp_active_300.json")[:50]))).add(GP + "stations", resp(200, fx("gp_stations_6.json"))).add(GP + "visual", resp(200, fx("gp_visual_30.json")))
        s = self.run_(["satellites"])
        self.assertIn("expected at least 100", s["failed"]["satellites"])


class Policy(Base):
    """CelesTrak's usage policy: stop at the first non-200 answer, do not follow a 301 quietly, never repeat, tell a human."""

    def setUp(self):
        super().setUp()
        p = mock.patch.object(feeds, "GP_MIN_ACTIVE", 100)
        p.start()
        self.addCleanup(p.stop)
        seed_catalogue(self.data)

    def serve_ok(self):
        self.net.routes.clear()
        self.net.add(GP + "active", resp(200, fx("gp_active_300.json"))).add(GP + "stations", resp(200, fx("gp_stations_6.json"))).add(GP + "visual", resp(200, fx("gp_visual_30.json")))

    def test_a_403_halts_after_one_request_and_nothing_else_is_asked(self):
        self.net.add(GP + "active", resp(403))
        s = self.run_(["satellites"])
        self.assertEqual(list(s["halted"]), ["satellites"])
        self.assertEqual(self.net.count("https://celestrak.org"), 1, "no retry and no other group after a refusal")
        f = self.manifest()["feeds"]["satellites"]
        self.assertEqual(f["status"], "halted")
        self.assertIn("HTTP 403", f["halted"]["reason"])
        self.assertIn("usage policy", f["error"])

    def test_a_redirect_is_reported_and_not_followed(self):
        self.net.add(GP + "active", resp(301, location="https://celestrak.org/elsewhere"))
        s = self.run_(["satellites"])
        self.assertIn("HTTP 301", s["halted"]["satellites"])
        self.assertFalse(self.net.calls[0][2], "follow_redirects was off for the policy source")

    def test_the_whole_source_stays_halted_until_the_cool_off_ends(self):
        self.net.add(GP + "active", resp(500))
        self.run_(["satellites"])
        self.net.calls.clear()
        self.clock.advance(config.HALT_COOL_OFF_S - 60)
        s = self.run_(["satellites", "catalogue"], force=True)
        self.assertEqual(s["ran"], [])
        self.assertEqual(sorted(x.split(" ")[0] for x in s["skipped"]), ["catalogue", "satellites"], "both feeds of the halted source are skipped, even when forced")
        self.assertEqual(self.net.calls, [])

    def test_after_the_cool_off_one_probe_that_succeeds_clears_the_halt(self):
        self.net.add(GP + "active", resp(403))
        self.run_(["satellites"])
        self.serve_ok()
        self.clock.advance(config.HALT_COOL_OFF_S + 1)
        s = self.run_(["satellites"])
        self.assertEqual(s["ok"], ["satellites"])
        self.assertEqual(self.state()["halts"], {})
        self.assertIsNone(self.manifest()["feeds"]["satellites"]["halted"])

    def test_a_probe_that_fails_halts_again(self):
        self.net.add(GP + "active", resp(403))
        self.run_(["satellites"])
        self.clock.advance(config.HALT_COOL_OFF_S + 1)
        s = self.run_(["satellites"])
        self.assertEqual(list(s["halted"]), ["satellites"])
        self.assertEqual(self.net.count("https://celestrak.org"), 2)
        self.assertGreater(runner.parse(self.state()["halts"]["celestrak"]["until"]), self.clock())

    def test_a_dropped_connection_is_a_failure_not_a_policy_halt_and_is_not_repeated(self):
        self.net.add(GP + "active", net.FetchError("ConnectionResetError"))
        s = self.run_(["satellites"])
        self.assertIn("satellites", s["failed"])
        self.assertEqual(s["halted"], {})
        self.assertEqual(self.net.count("https://celestrak.org"), 1)

    def test_other_sources_are_not_halted_by_a_celestrak_refusal(self):
        self.net.add(GP + "active", resp(403)).add("https://services.swpc.noaa.gov/products/noaa-planetary", resp(200, fx("kp.json")))
        s = self.run_(["satellites", "kp"])
        self.assertEqual((list(s["halted"]), s["ok"]), (["satellites"], ["kp"]))


class Catalogue(Base):
    def setUp(self):
        super().setUp()
        for target, value in ((feeds, ("SATCAT_MIN_ACTIVE", 5)),):
            p = mock.patch.object(target, *value)
            p.start()
            self.addCleanup(p.stop)
        self.cat = fxj("catalogue_sample.json")

    def serve(self, fail_at=None):
        cat = self.cat
        recs = [dict(zip(["NORAD_CAT_ID"] + ["OWNER", "LAUNCH_SITE", "OBJECT_TYPE", "LAUNCH_DATE", "OPS_STATUS_CODE"], [int(k)] + v[:5])) for k, v in cat["objects"].items()]
        table = lambda d, h: "<table><tr><th>%s</th><th>Name</th></tr>%s</table>" % (h, "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in d.items()))
        self.net.routes.clear()
        self.net.add(SATCAT + "active", resp(200, json.dumps(recs)))
        for g in GROUPS:
            if g != fail_at:
                self.net.add(SATCAT + g + "&", resp(200, json.dumps(recs[:3] if g == "starlink" else [])))
        self.net.add("https://celestrak.org/satcat/sources.php", resp(200, table(cat["owners"], "Source Code")))
        self.net.add("https://celestrak.org/satcat/launchsites.php", resp(200, table(cat["sites"], "Launch Site Codes")))
        deb = fxj("gp_debris_groups.json")
        for g, recs_ in deb.items():
            self.net.add(GP + g + "&", resp(200, json.dumps(recs_)))
        if fail_at:
            self.net.add(SATCAT + fail_at + "&", resp(403))

    def test_the_daily_build_writes_private_state_and_asks_politely(self):
        self.serve()
        s = self.run_(["catalogue"])
        self.assertEqual(s["ok"], ["catalogue"])
        self.assertEqual(self.net.count("https://celestrak.org"), 1 + 44 + 2 + 4)
        self.assertEqual(self.sleeps.count(feeds.PAUSE_S), 50, "a pause before every request after the first")
        f = self.manifest()["feeds"]["catalogue"]
        self.assertEqual(f["files"], {}, "the catalogue is private state, not published for the app")
        with gzip.open(os.path.join(self.data, "_state", "catalogue.json.gz")) as g:
            built = json.load(g)
        self.assertEqual(len(built["objects"]), len(self.cat["objects"]))
        self.assertEqual(f["count"], len(built["objects"]))
        self.assertEqual(self.versions("catalogue"), [], "no version folder for a private feed")

    def test_a_refusal_part_way_halts_and_leaves_no_half_built_state(self):
        self.serve(fail_at="weather")
        s = self.run_(["catalogue"])
        self.assertIn("catalogue", s["halted"])
        self.assertFalse(os.path.exists(os.path.join(self.data, "_state", "catalogue.json.gz")))
        self.assertLess(self.net.count("https://celestrak.org"), 20)

    def test_the_daily_catalogue_then_the_satellites_run_in_one_pass(self):
        self.serve()
        self.net.add(GP + "active", resp(200, fx("gp_active_300.json"))).add(GP + "stations", resp(200, fx("gp_stations_6.json"))).add(GP + "visual", resp(200, fx("gp_visual_30.json")))
        with mock.patch.object(feeds, "GP_MIN_ACTIVE", 100):
            s = self.run_(["catalogue", "satellites"])
        self.assertEqual(s["ok"], ["catalogue", "satellites"], "the catalogue is built first, so the satellites find it")


if __name__ == "__main__":
    unittest.main()
