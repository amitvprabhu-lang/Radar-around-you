import copy
import json
import unittest
from datetime import timedelta

from .. import validate as V
from .helpers import NOW, fx, fxj


class Quakes(unittest.TestCase):
    def test_real_feed(self):
        data, rep = V.quakes(fx("usgs_week_60.geojson"), NOW)
        self.assertGreaterEqual(len(data["events"]), 55)
        e = data["events"][0]
        self.assertEqual(set(e), {"id", "mag", "place", "time", "lat", "lon", "depth", "status", "felt", "url"})
        self.assertRegex(e["time"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertRegex(data["generated"], r"^2026-10-04T")

    def test_rejects_garbage(self):
        for bad in (b"not json", b"[]", json.dumps({"type": "FeatureCollection"}).encode(), json.dumps({"type": "Other", "features": []}).encode()):
            with self.assertRaises(V.ValidationError):
                V.quakes(bad, NOW)

    def test_too_few_events(self):
        d = fxj("usgs_week_60.geojson")
        d["features"] = d["features"][:10]
        with self.assertRaisesRegex(V.ValidationError, "only 10 usable"):
            V.quakes(json.dumps(d).encode(), NOW)

    def test_a_few_bad_items_are_dropped_and_counted(self):
        d = fxj("usgs_week_60.geojson")
        d["features"][0]["properties"]["mag"] = "big"
        d["features"][1]["geometry"]["coordinates"] = [500, 0, 1]
        data, rep = V.quakes(json.dumps(d).encode(), NOW)
        self.assertEqual(rep["dropped"], 2)
        self.assertEqual(len(data["events"]), 58)

    def test_too_many_bad_items_reject_the_feed(self):
        d = fxj("usgs_week_60.geojson")
        for f in d["features"][:20]:
            f["properties"]["mag"] = None
        with self.assertRaisesRegex(V.ValidationError, "invalid"):
            V.quakes(json.dumps(d).encode(), NOW)

    def test_future_events_are_rejected(self):
        with self.assertRaisesRegex(V.ValidationError, "future"):
            V.quakes(fx("usgs_week_60.geojson"), NOW - timedelta(days=3))


class Gdacs(unittest.TestCase):
    def pages(self):
        return [fxj("gdacs_orange_red.json"), fxj("gdacs_green.json")]

    def test_real_answers(self):
        evs, rep = V.gdacs(self.pages(), NOW)
        self.assertTrue(evs)
        self.assertTrue(all(e["alert"] in V.ALERTS for e in evs))
        self.assertEqual(evs, sorted(evs, key=lambda e: -V.ALERTS[e["alert"]]), "most severe first")
        self.assertEqual(set(evs[0]), {"id", "type", "name", "alert", "country", "from", "to", "current", "lat", "lon", "severity", "url"})

    def test_old_ended_events_are_left_out_but_current_ones_stay(self):
        evs, _ = V.gdacs(self.pages(), NOW)
        for e in evs:
            self.assertTrue(e["current"] or V.parse_iso(e["to"]) >= NOW - timedelta(days=7), e["name"])
        self.assertTrue(any(e["current"] and e["alert"] == "Orange" for e in evs), "the current drought is kept")

    def test_recently_ended_red_and_orange_events_are_kept_inside_the_window(self):
        raw = self.pages()[0]["features"]
        ended = [f for f in raw if f["properties"]["iscurrent"] != "true"]
        latest = max(V.parse_iso(f["properties"]["todate"]) for f in ended)
        evs, _ = V.gdacs(self.pages(), latest + timedelta(days=2))
        self.assertTrue(any(not e["current"] and e["alert"] in ("Orange", "Red") for e in evs))
        evs2, _ = V.gdacs(self.pages(), latest + timedelta(days=30))
        self.assertFalse(any(not e["current"] and e["alert"] in ("Orange", "Red") for e in evs2))

    def test_duplicates_keep_the_latest_modification(self):
        p = fxj("gdacs_green.json")
        a, b = copy.deepcopy(p["features"][0]), copy.deepcopy(p["features"][0])
        a["properties"]["datemodified"], b["properties"]["datemodified"] = "2026-10-01T00:00:00", "2026-10-04T00:00:00"
        a["properties"]["name"], b["properties"]["name"] = "old name", "new name"
        evs, _ = V.gdacs([{"features": [a, b]}], NOW)
        self.assertEqual([e["name"] for e in evs], ["new name"])

    def test_bad_items_are_dropped(self):
        p = fxj("gdacs_green.json")
        p["features"][0]["properties"]["eventtype"] = "ZZ"
        p["features"][1]["geometry"] = {"type": "Polygon", "coordinates": []}
        evs, rep = V.gdacs([p], NOW)
        self.assertEqual(rep["dropped"], 2)
        self.assertEqual(len(evs), 8)

    def test_a_page_that_is_not_a_feature_collection_is_an_error(self):
        with self.assertRaises(V.ValidationError):
            V.gdacs([{"nope": 1}], NOW)

    def test_output_is_bounded(self):
        f = fxj("gdacs_green.json")["features"][0]
        many = []
        for i in range(400):
            g = copy.deepcopy(f)
            g["properties"]["eventid"] = 100000 + i
            many.append(g)
        evs, _ = V.gdacs([{"features": many}], NOW)
        self.assertEqual(len(evs), V.GDACS_MAX_EVENTS)


class Aurora(unittest.TestCase):
    def test_real_grid(self):
        meta, grid = V.aurora(fx("ovation_latest.json.gz"))
        self.assertEqual(len(grid), 360 * 181)
        self.assertGreater(sum(1 for v in grid if v), 1000)
        self.assertLessEqual(max(grid), 100)
        self.assertRegex(meta["observation"], r"^2026-10-04T")
        # the grid is stored row by row from latitude -90, column by longitude 0 to 359
        d = json.loads(fx("ovation_latest.json.gz"))
        lon, lat, val = next(c for c in d["coordinates"] if c[2] > 0)
        self.assertEqual(grid[(int(lat) + 90) * 360 + int(lon) % 360], int(val))

    def test_rejections(self):
        d = json.loads(fx("ovation_latest.json.gz"))
        cases = {}
        t = copy.deepcopy(d); t["coordinates"] = t["coordinates"][:1000]; cases["truncated"] = t
        t = copy.deepcopy(d); t["coordinates"][5][2] = 400; cases["value out of range"] = t
        t = copy.deepcopy(d); t["coordinates"] = [[c[0], c[1], 0] for c in t["coordinates"]]; cases["all zero"] = t
        t = copy.deepcopy(d); del t["Observation Time"]; cases["missing time"] = t
        t = copy.deepcopy(d); t["coordinates"][3] = [1, 2]; cases["short point"] = t
        for name, bad in cases.items():
            with self.subTest(name), self.assertRaises(V.ValidationError):
                V.aurora(json.dumps(bad).encode())
        with self.assertRaises(V.ValidationError):
            V.aurora(b"{")


class Kp(unittest.TestCase):
    def test_real(self):
        rows = V.kp(fx("kp.json"))
        self.assertEqual(len(rows), 16)
        self.assertEqual(set(rows[0]), {"t", "kp"})

    def test_rejections(self):
        d = fxj("kp.json")
        with self.assertRaises(V.ValidationError):
            V.kp(json.dumps(d[:5]).encode())
        d[-1]["Kp"] = 12
        with self.assertRaises(V.ValidationError):
            V.kp(json.dumps(d).encode())
        with self.assertRaises(V.ValidationError):
            V.kp(b'{"a": 1}')


class Clouds(unittest.TestCase):
    def test_real(self):
        c = V.clouds(fx("met_pune.json"))
        self.assertEqual(len(c["hours"]), 36)
        self.assertTrue(all(0 <= h["cloud"] <= 100 for h in c["hours"]))
        self.assertRegex(c["updated"], r"^2026-10-04T")

    def test_rejections(self):
        d = fxj("met_pune.json")
        short = copy.deepcopy(d); short["properties"]["timeseries"] = short["properties"]["timeseries"][:10]
        bad = copy.deepcopy(d); bad["properties"]["timeseries"][3]["data"]["instant"]["details"]["cloud_area_fraction"] = 140
        for x in (short, bad, {"properties": {}}):
            with self.assertRaises(V.ValidationError):
                V.clouds(json.dumps(x).encode())


class Planes(unittest.TestCase):
    def test_real(self):
        p = V.planes(fx("planes_pune_80.json"))
        raw = fxj("planes_pune_80.json")["ac"]
        self.assertTrue(p["aircraft"])
        self.assertLessEqual(len(p["aircraft"]), len(raw))
        self.assertTrue(all(a["altFt"] >= 500 for a in p["aircraft"]))
        self.assertTrue(all(a["call"] == "" or V.AIRLINE_CALLSIGN.match(a["call"]) for a in p["aircraft"]))
        self.assertRegex(p["time"], r"^2026-10-0\dT")

    def test_ground_and_unplaced_aircraft_are_dropped(self):
        d = {"now": 1791137923000, "ac": [{"alt_baro": "ground", "lat": 1, "lon": 1}, {"alt_baro": 30000, "lat": 1}, {"alt_baro": 30000, "lat": 1, "lon": 2, "flight": "AIC101  "},
                                         {"alt_baro": 30000, "lat": 99, "lon": 2}]}
        p = V.planes(json.dumps(d).encode())
        self.assertEqual([a["call"] for a in p["aircraft"]], ["AIC101"])

    def test_rejections(self):
        for bad in (b"{", b'{"ac": 1, "now": 1791137923000}', b'{"ac": []}'):
            with self.assertRaises(V.ValidationError):
                V.planes(bad)


if __name__ == "__main__":
    unittest.main()
