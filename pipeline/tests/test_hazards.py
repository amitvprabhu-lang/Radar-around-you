import json
import struct
import unittest
from datetime import datetime, timezone

from .. import hazards
from ..validate import ValidationError
from .helpers import fx, fxj

UTC = timezone.utc
NOW = datetime(2026, 10, 4, 19, 45, tzinfo=UTC)  # a few minutes after the fixtures were taken


class SolarWindTest(unittest.TestCase):
    def test_real_rows_become_five_minute_points(self):
        d = hazards.solar_wind(fx("swpc_wind_active_420.json"), fx("swpc_mag_active_420.json"), NOW)
        pts = d["points"]
        self.assertGreater(len(pts), 60)
        self.assertEqual(d["bucketMin"], 5)
        ts = [p["t"] for p in pts]
        self.assertEqual(ts, sorted(ts))
        self.assertEqual(len(ts), len(set(ts)))
        last = pts[-1]
        self.assertTrue(100 <= last["speed"] <= 3000)
        self.assertTrue(-200 <= last["bz"] <= 200)
        self.assertEqual(d["spacecraft"], ["SOLAR1"])
        self.assertEqual(d["updated"], "2026-10-04T19:28:00Z")

    def test_inactive_spacecraft_rows_are_ignored(self):
        wind = fxj("swpc_wind_active_420.json")
        mag = fxj("swpc_mag_active_420.json")
        for r in wind + mag:
            if not r["active"]:
                r["proton_speed"] = 999.0
                r["bz_gsm"] = -99.0
        d = hazards.solar_wind(json.dumps(wind), json.dumps(mag), NOW)
        self.assertTrue(all(p["speed"] != 999.0 for p in d["points"]))
        self.assertTrue(all(p["bz"] != -99.0 for p in d["points"]))

    def test_old_or_thin_or_broken_answers_are_refused(self):
        w, m = fx("swpc_wind_active_420.json"), fx("swpc_mag_active_420.json")
        with self.assertRaises(ValidationError):
            hazards.solar_wind(w, m, datetime(2026, 10, 4, 23, 0, tzinfo=UTC))  # newest row is over 90 minutes old
        with self.assertRaises(ValidationError):
            hazards.solar_wind(json.dumps(fxj("swpc_wind_active_420.json")[:5]), m, NOW)
        with self.assertRaises(ValidationError):
            hazards.solar_wind(b"not json", m, NOW)
        with self.assertRaises(ValidationError):
            hazards.solar_wind(b"[]", m, NOW)

    def test_values_outside_physical_limits_are_dropped_not_kept(self):
        wind = fxj("swpc_wind_active_420.json")
        wind[0]["proton_speed"] = 99999.0
        d = hazards.solar_wind(json.dumps(wind), fx("swpc_mag_active_420.json"), NOW)
        self.assertTrue(all(p["speed"] is None or p["speed"] < 3000 for p in d["points"]))


class AlertsTest(unittest.TestCase):
    def setUp(self):
        self.items = hazards.space_alerts(fx("swpc_alerts_sample.json"), NOW)

    def test_only_geomagnetic_messages_are_kept_newest_first(self):
        self.assertTrue(self.items)
        self.assertTrue(all(i["code"][:4] in ("WARK", "ALTK", "SUMK", "WATA") for i in self.items))
        issued = [i["issued"] for i in self.items]
        self.assertEqual(issued, sorted(issued, reverse=True))
        self.assertFalse(any(i["code"].startswith(("ALTEF", "WARPX")) for i in self.items))

    def test_a_warning_carries_its_level_and_window(self):
        w = next(i for i in self.items if i["id"] == "WARK06-671")
        self.assertEqual((w["kind"], w["kp"], w["cancel"], w["extended"]), ("warning", 6, False, False))
        self.assertEqual((w["from"], w["until"]), ("2026-10-04T18:47:00Z", "2026-10-04T23:59:00Z"))

    def test_extended_warning_uses_the_new_end_time(self):
        w = next(i for i in self.items if i["id"] == "WARK04-5425")
        self.assertTrue(w["extended"])
        self.assertEqual(w["until"], "2026-10-05T03:00:00Z")
        self.assertIn("poleward of 65 degrees Geomagnetic Latitude", w["impact"])

    def test_an_extended_warning_names_the_serial_it_replaces(self):
        w = next(i for i in self.items if i["id"] == "WARK04-5425")
        self.assertEqual(w["supersedes"], 5424)
        self.assertIsNone(next(i for i in self.items if i["id"] == "WARK06-671")["supersedes"])

    def test_alert_has_the_time_the_threshold_was_reached(self):
        a = next(i for i in self.items if i["id"] == "ALTK05-2052")
        self.assertEqual((a["kind"], a["kp"], a["reached"]), ("alert", 5, "2026-10-04T18:39:00Z"))

    def test_watches_carry_the_storm_scale(self):
        old = hazards.space_alerts(fx("swpc_alerts_sample.json"), datetime(2026, 10, 2, 0, 0, tzinfo=UTC))
        watch = next(i for i in old if i["code"] == "WATA20")
        self.assertEqual((watch["kind"], watch["g"]), ("watch", 1))

    def test_old_messages_are_dropped_and_a_cancel_is_marked(self):
        far = hazards.space_alerts(fx("swpc_alerts_sample.json"), datetime(2026, 9, 10, 0, 0, tzinfo=UTC))
        cancel = next(i for i in far if i["code"] == "WATA30")
        self.assertTrue(cancel["cancel"])
        self.assertEqual(hazards.space_alerts(fx("swpc_alerts_sample.json"), datetime(2026, 12, 1, tzinfo=UTC)), [])

    def test_bad_input_is_refused(self):
        with self.assertRaises(ValidationError):
            hazards.space_alerts(b"{}", NOW)
        with self.assertRaises(ValidationError):
            hazards.space_alerts(json.dumps([{"message": "no code here"}]), NOW)


class StormsTest(unittest.TestCase):
    ISSUED = datetime(2026, 10, 4, 15, 0, tzinfo=UTC)

    def kmz(self, url):
        if "TRACK" in url:
            return fx("nhc_ep182026_030_track.kmz")
        if "CONE" in url:
            return fx("nhc_ep182026_030_cone.kmz")
        raise ValidationError("unexpected url " + url)

    def test_track_points_use_the_synoptic_base_and_match_the_kml_text(self):
        pts = hazards.storm_track(fx("nhc_ep182026_030_track.kmz"), self.ISSUED)
        self.assertEqual([p["hours"] for p in pts], [12, 24, 36, 48, 60, 72, 96, 120])
        self.assertEqual(pts[-1]["valid"], "2026-10-09T12:00:00Z")  # 120 h after the 12 UTC base, which is 5 AM MST on Oct 9
        self.assertEqual((pts[-1]["lat"], pts[-1]["lon"], pts[-1]["windKt"]), (22.8, -127.5, 45))

    def test_a_time_that_disagrees_with_the_kml_text_is_refused(self):
        with self.assertRaises(ValidationError):
            hazards.storm_track(fx("nhc_ep182026_030_track.kmz"), datetime(2026, 10, 4, 21, 0, tzinfo=UTC))  # wrong base

    def test_a_storm_crossing_the_dateline_is_wrapped_into_range(self):
        # Nolo, advisory 56, 2026-10-04: NHC's track runs to -210 and its cone to 181.8 degrees of longitude
        pts = hazards.storm_track(fx("nhc_ep152026_track.kmz"), self.ISSUED)
        self.assertTrue(all(-180 <= p["lon"] < 180 for p in pts))
        self.assertTrue(any(p["lon"] > 140 for p in pts))  # the later points are now west of the dateline, near 150 E
        rings = hazards.storm_cone(fx("nhc_ep152026_cone.kmz"))
        self.assertTrue(all(-180 <= lo < 180 for ring in rings for lo, la in ring))

    def test_cone_is_a_thinned_ring(self):
        rings = hazards.storm_cone(fx("nhc_ep182026_030_cone.kmz"))
        self.assertEqual(len(rings), 1)
        self.assertGreater(len(rings[0]), 20)
        self.assertLess(len(rings[0]), 2000)
        self.assertTrue(all(-180 <= lo <= 180 and -90 <= la <= 90 for lo, la in rings[0]))

    def test_storms_keep_nhc_units_and_add_kmh(self):
        d = hazards.nhc_storms(fx("nhc_current_storms.json"), self.kmz, NOW)
        names = [s["name"] for s in d["storms"]]
        self.assertEqual(names, ["Rachel", "Nolo"])
        r = d["storms"][0]
        self.assertEqual((r["classText"], r["windKt"], r["windKmh"], r["pressureMb"], r["basin"]), ("Hurricane", 90, 167, 965, "Eastern Pacific"))
        self.assertEqual(d["storms"][1]["basin"], "Central Pacific")  # id ep152026 but binNumber CP2, near the dateline
        self.assertEqual(r["issued"], "2026-10-04T15:00:00Z")
        self.assertGreater(len(r["track"]), 5)

    def test_a_storm_whose_track_cannot_be_read_is_kept_without_it(self):
        def bad(url):
            raise ValidationError("storm track: not a readable KMZ")
        d = hazards.nhc_storms(fx("nhc_current_storms.json"), bad, NOW)
        self.assertEqual(len(d["storms"]), 2)
        self.assertEqual(d["storms"][0]["track"], [])
        self.assertTrue(d["storms"][0]["extras"])

    def test_empty_season_is_valid_and_garbage_is_not(self):
        self.assertEqual(hazards.nhc_storms(json.dumps({"activeStorms": []}), self.kmz, NOW)["storms"], [])
        with self.assertRaises(ValidationError):
            hazards.nhc_storms(b"{}", self.kmz, NOW)
        bad = fxj("nhc_current_storms.json")
        bad["activeStorms"][0]["intensity"] = "9000"
        with self.assertRaises(ValidationError):
            hazards.nhc_storms(json.dumps(bad), self.kmz, NOW)


class FiresTest(unittest.TestCase):
    NOW = datetime(2026, 10, 4, 19, 45, tzinfo=UTC)

    def build(self, *names):
        # the fixtures are short, so the minimum is lowered for them only
        old = hazards.FIRE_MIN_ROWS
        hazards.FIRE_MIN_ROWS = 100
        try:
            return hazards.fires([fx(n) for n in names], self.NOW)
        finally:
            hazards.FIRE_MIN_ROWS = old

    def test_cells_round_trip_and_counts_add_up(self):
        blob, s = self.build("firms_snpp_500.csv", "firms_noaa20_300.csv")
        self.assertEqual(len(blob), hazards.FIRE_REC.size * s["cells"])
        total = 0
        for i in range(s["cells"]):
            li, lo, n, frp, mins = hazards.FIRE_REC.unpack_from(blob, i * hazards.FIRE_REC.size)
            self.assertTrue(0 <= li < 720 and 0 <= lo < 1440 and n >= 1 and frp >= 0 and mins >= 0)
            total += n
        self.assertEqual(total, s["detections"])
        self.assertEqual(s["rows"], 800)
        self.assertEqual(s["detections"] + s["lowConfidenceLeftOut"], 800)
        self.assertEqual(set(s["bySatellite"]), {"N", "N20"})

    def test_each_satellite_code_comes_from_its_own_file(self):
        # the app names the codes N, N20 and N21 as Suomi NPP, NOAA-20 and NOAA-21 on this basis
        self.assertEqual(self.build("firms_snpp_500.csv")[1]["bySatellite"], {"N": 500 - self.build("firms_snpp_500.csv")[1]["lowConfidenceLeftOut"]})
        self.assertEqual(set(self.build("firms_noaa20_300.csv")[1]["bySatellite"]), {"N20"})

    def test_a_known_detection_lands_in_the_right_cell(self):
        blob, s = self.build("firms_noaa20_300.csv")
        # first row of the file: -32.93597, 18.75689
        li, lo = int((-32.93597 + 90) / 0.25), int((18.75689 + 180) / 0.25)
        cells = {struct.unpack_from("<HH", blob, i * hazards.FIRE_REC.size) for i in range(s["cells"])}
        self.assertIn((li, lo), cells)

    def test_low_confidence_is_left_out_and_counted(self):
        csvb = fx("firms_noaa20_300.csv").decode().splitlines()
        row = csvb[1].split(",")
        row[8] = "low"
        csvb[1] = ",".join(row)
        old = hazards.FIRE_MIN_ROWS
        hazards.FIRE_MIN_ROWS = 100
        try:
            _, s = hazards.fires(["\n".join(csvb).encode()], self.NOW)
        finally:
            hazards.FIRE_MIN_ROWS = old
        self.assertEqual(s["lowConfidenceLeftOut"], 1)
        self.assertEqual(s["detections"], 299)

    def test_a_thin_or_malformed_file_is_refused(self):
        with self.assertRaises(ValidationError):
            hazards.fires([fx("firms_noaa20_300.csv")], self.NOW)  # fewer than FIRE_MIN_ROWS
        with self.assertRaises(ValidationError):
            hazards.fires([b"a,b,c\n1,2,3\n"], self.NOW)
        with self.assertRaises(ValidationError):
            self.build_stale()

    def build_stale(self):
        old = hazards.FIRE_MIN_ROWS
        hazards.FIRE_MIN_ROWS = 100
        try:
            return hazards.fires([fx("firms_noaa20_300.csv")], datetime(2026, 10, 9, tzinfo=UTC))  # every row is over 48 hours old
        finally:
            hazards.FIRE_MIN_ROWS = old


if __name__ == "__main__":
    unittest.main()


class CloseApproachTest(unittest.TestCase):
    NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)

    def test_real_answer_is_read_and_sorted(self):
        d = hazards.close_approaches(fx("jpl_cad_60d.json"), self.NOW)
        a = d["approaches"]
        self.assertEqual(len(a), 31)
        self.assertEqual([x["time"] for x in a], sorted(x["time"] for x in a))
        first = a[0]
        self.assertEqual(first["des"], "2024 SH7")
        self.assertEqual(first["name"], "2024 SH7")
        self.assertAlmostEqual(first["distAu"], 0.026949, places=5)
        self.assertEqual(first["h"], 27.31)
        self.assertEqual(first["timeSigma"], "3_19:55")
        self.assertEqual(d["version"], "1.5")

    def test_times_are_converted_from_tdb_to_utc(self):
        # JPL prints "2026-Oct-04 00:43" in TDB, rounded to the minute; the same moment in UTC is about 69 seconds earlier
        first = hazards.close_approaches(fx("jpl_cad_60d.json"), self.NOW)["approaches"][0]
        t = datetime.strptime(first["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        tdb_text = datetime(2026, 10, 4, 0, 43, tzinfo=UTC)
        self.assertLess(abs((tdb_text - t).total_seconds() - 69.184), 31, f"{t} against {tdb_text}")

    def test_distance_units(self):
        a = hazards.close_approaches(fx("jpl_cad_60d.json"), self.NOW)["approaches"]
        two = next(x for x in a if x["des"] == "2026 TF")
        self.assertEqual(two["distKm"], round(0.0134295577440828 * 149_597_870.7))
        self.assertAlmostEqual(two["distLd"], 5.23, places=2)  # 5.23 times the distance to the Moon
        self.assertLess(two["distMinAu"], two["distAu"] + 1e-9)
        self.assertGreater(two["distMaxAu"], two["distAu"] - 1e-9)

    def test_a_changed_api_version_or_field_list_is_refused(self):
        d = json.loads(fx("jpl_cad_60d.json"))
        d["signature"]["version"] = "2.0"
        with self.assertRaises(ValidationError):
            hazards.close_approaches(json.dumps(d), self.NOW)
        d = json.loads(fx("jpl_cad_60d.json"))
        i = d["fields"].index("dist")
        d["fields"][i] = "distance"
        with self.assertRaises(ValidationError):
            hazards.close_approaches(json.dumps(d), self.NOW)
        with self.assertRaises(ValidationError):
            hazards.close_approaches(b"[]", self.NOW)

    def test_values_outside_sensible_ranges_are_refused(self):
        for field, value in (("dist", "5.0"), ("v_rel", "900"), ("h", "-3"), ("jd", "2400000.5")):
            d = json.loads(fx("jpl_cad_60d.json"))
            d["data"][0][d["fields"].index(field)] = value
            with self.assertRaises(ValidationError, msg=field):
                hazards.close_approaches(json.dumps(d), self.NOW)

    def test_an_unknown_size_is_kept_as_none_and_a_wrong_count_is_refused(self):
        d = json.loads(fx("jpl_cad_60d.json"))
        d["data"][0][d["fields"].index("h")] = None
        self.assertIsNone(hazards.close_approaches(json.dumps(d), self.NOW)["approaches"][0]["h"])
        d["count"] = 99
        with self.assertRaises(ValidationError):
            hazards.close_approaches(json.dumps(d), self.NOW)


class LaunchesTest(unittest.TestCase):
    NOW = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)

    def doc(self):
        return json.loads(fx("ll2_upcoming.json"))

    def test_real_answer_is_read_sorted_and_keeps_how_exact_each_time_is(self):
        d = hazards.launches(fx("ll2_upcoming.json"), self.NOW)
        a = d["launches"]
        self.assertEqual(len(a), 8)
        self.assertEqual([x["net"] for x in a], sorted(x["net"] for x in a))
        self.assertEqual(d["total"], 470)
        self.assertEqual({x["precision"] for x in a}, {"SEC", "MIN", "HR", "M", "Q4"})
        vague = [x for x in a if x["precision"] in ("M", "Q4")]
        self.assertTrue(vague and all(x["status"] == "TBD" for x in vague))
        first = a[0]
        self.assertEqual(first["name"], "Falcon 9 Block 5 | SDA Tranche 1 Transport Layer A")
        self.assertEqual((first["provider"], first["rocket"], first["status"], first["statusName"]), ("SpaceX", "Falcon 9 Block 5", "Go", "Go for Launch"))
        self.assertAlmostEqual(first["lat"], 34.632)
        self.assertAlmostEqual(first["lon"], -120.611)
        self.assertEqual(first["country"], "US")
        self.assertIn("confirmed", first["statusNote"])

    def test_every_output_field_is_plain_data(self):
        for x in hazards.launches(fx("ll2_upcoming.json"), self.NOW)["launches"]:
            for k, v in x.items():
                self.assertTrue(v is None or isinstance(v, (str, int, float, bool)), k)
            self.assertNotIn("image", " ".join(x.keys()).lower())  # no image links: some are non-commercial licence

    def test_a_launch_without_a_pad_position_is_kept_without_one(self):
        d = self.doc()
        d["results"][0]["pad"]["latitude"] = None
        x = hazards.launches(json.dumps(d), self.NOW)["launches"][0]
        self.assertIsNone(x["lat"]); self.assertIsNone(x["lon"])
        d["results"][0]["pad"]["latitude"] = "34.5"; d["results"][0]["pad"]["longitude"] = "-120.5"
        x = hazards.launches(json.dumps(d), self.NOW)["launches"][0]
        self.assertEqual((x["lat"], x["lon"]), (34.5, -120.5))
        d["results"][0]["pad"]["latitude"] = 95
        self.assertIsNone(hazards.launches(json.dumps(d), self.NOW)["launches"][0]["lat"])

    def test_missing_optional_parts_become_none(self):
        d = self.doc()
        r = d["results"][0]
        r["mission"] = None; r["net_precision"] = None; r["webcast_live"] = None; r["probability"] = 120
        x = hazards.launches(json.dumps(d), self.NOW)["launches"][0]
        self.assertIsNone(x["mission"]); self.assertIsNone(x["precision"]); self.assertFalse(x["webcast"]); self.assertIsNone(x["probability"])
        r["probability"] = 80
        self.assertEqual(hazards.launches(json.dumps(d), self.NOW)["launches"][0]["probability"], 80)

    def test_control_characters_and_long_text_are_cleaned(self):
        d = self.doc()
        d["results"][0]["name"] = "Bad\x00name\n" + "x" * 500
        x = hazards.launches(json.dumps(d), self.NOW)["launches"]
        self.assertTrue(any("Bad name" in y["name"] and len(y["name"]) <= 200 for y in x))

    def test_broken_answers_are_rejected(self):
        for mutate, why in [
            (lambda d: d.update(results=[]), "empty"),
            (lambda d: d.update(results="x"), "not a list"),
            (lambda d: d["results"][0].update(net="soon"), "unreadable time"),
            (lambda d: d["results"][0].pop("net"), "no time"),
            (lambda d: d["results"][0].update(net="2031-01-01T00:00:00Z"), "far future"),
            (lambda d: d["results"][0].update(net="2026-09-01T00:00:00Z"), "long past"),
            (lambda d: d["results"][0].update(name=""), "no name"),
            (lambda d: d["results"][0].pop("id"), "no id"),
            (lambda d: d["results"].append("x"), "not an object"),
        ]:
            d = self.doc(); mutate(d)
            with self.assertRaises(ValidationError, msg=why):
                hazards.launches(json.dumps(d), self.NOW)
        with self.assertRaises(ValidationError):
            hazards.launches(b"[]", self.NOW)
        with self.assertRaises(ValidationError):
            hazards.launches(b"not json", self.NOW)

    def test_the_list_is_capped(self):
        d = self.doc()
        base = d["results"][0]
        d["results"] = [dict(base, id=f"id{i}", name=f"L{i}") for i in range(60)]
        self.assertEqual(len(hazards.launches(json.dumps(d), self.NOW)["launches"]), hazards.LL2_MAX_LAUNCHES)


class LaunchDuplicatesTest(unittest.TestCase):
    NOW = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)

    def doc(self):
        return json.loads(fx("ll2_upcoming.json"))

    def test_the_real_answer_has_no_duplicates(self):
        self.assertEqual(hazards.launches(fx("ll2_upcoming.json"), self.NOW)["duplicatesDropped"], 0)

    def test_the_same_id_twice_keeps_the_later_update(self):
        d = self.doc()
        older = json.loads(json.dumps(d["results"][0])); older["last_updated"] = "2026-10-01T00:00:00Z"; older["status"]["name"] = "Old status"
        d["results"].append(older)
        out = hazards.launches(json.dumps(d), self.NOW)
        self.assertEqual(out["duplicatesDropped"], 1)
        self.assertEqual(len(out["launches"]), 8)
        self.assertNotEqual(out["launches"][0]["statusName"], "Old status")
        d["results"][-1]["last_updated"] = "2026-12-01T00:00:00Z"  # now the copy is newer
        out = hazards.launches(json.dumps(d), self.NOW)
        self.assertEqual(out["launches"][0]["statusName"], "Old status")

    def test_the_same_launch_under_two_ids_is_one_launch(self):
        d = self.doc()
        twin = json.loads(json.dumps(d["results"][1])); twin["id"] = "another-id"; twin["name"] = "  " + twin["name"].upper() + "  "
        d["results"].append(twin)
        out = hazards.launches(json.dumps(d), self.NOW)
        self.assertEqual((out["duplicatesDropped"], len(out["launches"])), (1, 8))

    def test_two_different_launches_at_the_same_time_are_both_kept(self):
        d = self.doc()
        other = json.loads(json.dumps(d["results"][1])); other["id"] = "x2"; other["name"] = "Different rocket | Different mission"
        d["results"].append(other)
        out = hazards.launches(json.dumps(d), self.NOW)
        self.assertEqual((out["duplicatesDropped"], len(out["launches"])), (0, 9))
