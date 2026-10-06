// The real launches, GDACS and NHC storm feeds of 6 October 2026 (the data branch, collected 2026-10-06 about 01:40 UTC, saved in
// test/fixtures/events/live-20261006) and small hand-made feeds with known answers, in the shapes the collector writes
// (pipeline/hazards.py, launches; pipeline/validate.py, gdacs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVENTS_DIR = fileURLToPath(new URL("../fixtures/events/live-20261006/", import.meta.url));
export const EVENTS_NOW = new Date("2026-10-06T01:45:00Z");
export const eventsManifest = () => JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, "manifest.json"), "utf8"));
export const eventsJson = (feed, name) => JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, eventsManifest().feeds[feed].files[name]), "utf8"));
export const realLaunches = () => eventsJson("launches", "launches.json");
export const realEvents = () => eventsJson("events", "events.json");
export const realStorms = () => eventsJson("storms", "storms.json");
export const EVENTS_TIME = () => eventsManifest().feeds.events.sourceTime;

const GEN = "2026-10-06T00:00:00Z";
const L = (id, name, net, precision, extra = {}) => ({
  id, name, net, windowStart: net, windowEnd: net, precision, precisionName: { SEC: "Second", MIN: "Minute", HR: "Hour", M: "Month", Q4: "Quarter 4", D: "Day" }[precision] || "",
  status: "Go", statusName: "Go for Launch", statusNote: "", provider: "SpaceX", rocket: "Falcon 9 Block 5", mission: name.split(" | ")[1] || "", missionType: "Communications", orbit: "Low Earth Orbit",
  pad: "Space Launch Complex 40", location: "Cape Canaveral SFS, FL, USA", country: "US", lat: 28.56, lon: -80.58, webcast: false, videos: [], liveNow: false, probability: null, updated: GEN, ...extra,
});
// six launches: two SpaceX from Florida (one tomorrow to the minute), one Rocket Lab with no pad position, one Chinese launch only to the
// month, one in December, and one whose time has passed
export const launchesDoc = (extra = {}) => ({
  generated: GEN, total: 321, duplicatesDropped: 0,
  launches: [
    L("p1", "Falcon 9 Block 5 | Starlink Group 9-9", "2026-10-05T22:00:00Z", "MIN", { statusName: "Launch Successful" }),
    L("a1", "Falcon 9 Block 5 | Starlink Group 10-1", "2026-10-06T20:15:00Z", "MIN"),
    L("a2", "Electron | <b>Test & Go</b>", "2026-10-09T03:00:00Z", "HR", { provider: "Rocket Lab", rocket: "Electron", pad: "Launch Complex 1B", location: "Mahia, New Zealand", country: "NZ", lat: null, lon: null }),
    L("a3", "Long March 12 | Unknown Payload", "2026-10-31T00:00:00Z", "M", { provider: "China Aerospace Science and Technology Corporation", statusName: "To Be Determined", pad: "Commercial LC-2", location: "Wenchang Space Launch Site", country: "CN", lat: 19.6, lon: 110.95 }),
    L("a4", "Falcon 9 Block 5 | Transporter-20", "2026-10-12T18:00:00Z", "SEC", { pad: "Space Launch Complex 4E", location: "Vandenberg SFB, CA, USA", lat: 34.632, lon: -120.611 }),
    L("a5", "Ariane 6 | Something", "2026-12-31T00:00:00Z", "Q4", { provider: "Arianespace", country: "GF", lat: 5.24, lon: -52.77 }),
  ],
  ...extra,
});

const E = (id, type, alert, current, from, to, extra = {}) => ({ id, type, name: `${type} event ${id}`, alert, country: "Indonesia", from, to, current, lat: -5, lon: 110, severity: "x", url: `https://www.gdacs.org/report.aspx?eventid=${id}`, ...extra });
export const EV_TIME = "2026-10-06T00:30:00Z";
// one Red cyclone that NHC also lists (left out), one Orange flood, Green fires, one with no country, one earthquake, one ended long ago
export const eventsList = () => [
  E("1", "TC", "Red", true, "2026-10-01T00:00:00", "2026-10-06T00:00:00", { name: "Tropical Cyclone ALPHA-26", lat: 25.1, lon: -70.4, severity: "Tropical Storm (maximum wind speed of 120 km/h)" }),
  E("2", "FL", "Orange", true, "2026-10-03T00:00:00", "2026-10-07T00:00:00", { name: "Flood in <Somewhere> & co", country: "Bangladesh, India, " }),
  E("3", "WF", "Green", true, "2026-10-05T00:00:00", "2026-10-05T12:00:00"),
  E("4", "WF", "Green", true, "2026-10-05T00:00:00", "2026-10-05T12:00:00"),
  E("5", "WF", "Green", false, "2026-10-01T00:00:00", "2026-10-02T00:00:00", { country: "" }),
  E("6", "EQ", "Green", true, "2026-10-05T00:00:00", "2026-10-05T00:00:00"),
  E("7", "DR", "Orange", false, "2026-06-01T00:00:00", "2026-09-20T00:00:00"),
  E("8", "VO", "Green", true, "2026-10-04T00:00:00", "2026-10-06T00:00:00", { name: "Volcano Kanlaon", country: "Philippines", lat: 10.4, lon: 123.1 }),
];
export const stormsNow = { generated: "2026-10-06T00:20:00Z", storms: [{ name: "Alpha", lat: 25.3, lon: -70.0, windKt: 50 }] };
