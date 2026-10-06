// How each sky page is read, snapshotted, rendered and shown on the /right-now/ hub: the entries site/liveregistry.mjs adds for the sky
// family (SKY_PAGES in site/sky.mjs). Reading the repository's own files (cities, stars) goes through site/sky-data.mjs.
import { SKY_PAGES, SKY_MAX_AGE_HOURS, summariseCity, summariseHub, summariseIss, hm, whenLocal } from "./sky.mjs";
import { cityPage, skyHubPage, issPage, SKY_SRC } from "./pages-sky.mjs";
import { skyStatic, skySnapshotInputs } from "./sky-data.mjs";
import { isoZ, parseTime } from "./hazard.mjs";

// A page with nothing to show is skipped, not failed (the registry's convention).
const skip = (msg) => Object.assign(new Error(msg), { skip: true });
// precise.json from the satellites feed, or null when the feed or the file is missing (the city pages then leave the passes out)
const preciseOf = (rd) => { if (!rd.has("satellites")) return null; try { return rd.json("satellites", "precise.json"); } catch { return null; } };
const dayHour = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));
const latLon = (p) => `${Math.abs(p.lat).toFixed(1)}° ${p.lat >= 0 ? "N" : "S"}, ${Math.abs(p.lon).toFixed(1)}° ${p.lon >= 0 ? "E" : "W"}`;

// The row of the /right-now/ hub for tonight's best window in Pune (the design, section 3) and the one for the ISS position.
function puneRow(s, { missing = {} } = {}) {
  const page = SKY_PAGES.find((p) => p.key === "sky-pune");
  const b = s && s.strip.best;
  const value = !s ? null : s.night.kind === "midnightSun" ? "The Sun does not set tonight" : b ? `Best window ${whenLocal(b.start, s.night.start, s.tz)} to ${whenLocal(b.end, s.night.start, s.tz)} local time${b.cloud !== null ? `, ${b.cloud}% cloud` : ""}` : "No best window tonight";
  return {
    key: page.key, file: page.file, label: page.name, short: "Pune's sky tonight", value, dataTime: s ? s.dataTime : null, guide: null, stale: !!(s && s.stale),
    // the other sky pages, linked from the hub under the table (every live page is linked from the hub)
    linksLabel: "Tonight's sky, from the same forecast and calculations", links: SKY_PAGES.filter((p) => p.key !== "iss" && p.key !== page.key).map((p) => ({ file: p.file, label: p.key === "sky-hub" ? "all six cities" : p.name.replace("Tonight's sky in ", "") })),
    said: !s ? null : b ? `a best viewing window tonight in Pune from ${hm(b.start, s.tz)} to ${hm(b.end, s.tz)} local time` : "no best viewing window tonight in Pune",
    reason: value === null ? missing[page.key] || "not available in this build" : null, timeText: s ? `${dayHour(s.dataTime)} (MET Norway forecast)` : "",
    limit: `the cloud forecast of the sky pages ${SKY_MAX_AGE_HOURS.clouds} hours`, timeNote: "For tonight's sky, the time is MET Norway's forecast time for the city.", source: SKY_SRC.met,
    notableRule: "a best viewing window tonight in Pune", notable: s && b ? `Tonight's best viewing window in Pune is ${hm(b.start, s.tz)} to ${hm(b.end, s.tz)} local time${b.cloud !== null ? `, with ${b.cloud} percent cloud in MET Norway's forecast` : ""}.` : null,
  };
}
function issRow(s, { missing = {} } = {}) {
  const page = SKY_PAGES.find((p) => p.key === "iss");
  const value = s ? `At ${latLon(s.position)}, ${Math.round(s.position.hKm)} km up` : null;
  return {
    key: page.key, file: page.file, label: page.name, short: "the ISS", value, said: s ? `the ISS at ${latLon(s.position)}` : null, dataTime: s ? s.dataTime : null, guide: page.guide, stale: !!(s && s.stale),
    reason: value === null ? missing[page.key] || "not available in this build" : null, timeText: s ? `${dayHour(s.dataTime)} (satellite data)` : "",
    limit: `the ISS page ${SKY_MAX_AGE_HOURS.satellites} hours`, timeNote: "For the ISS, the time is the satellite data time.", source: SKY_SRC.celestrak, notableRule: null, notable: null,
  };
}

const cityOf = (id) => skyStatic().cities.find((c) => c.id === id);
export const SKY_BUILDERS = Object.fromEntries(SKY_PAGES.map((p) => {
  if (p.key === "sky-hub") return [p.key, {
    read: (rd, o) => summariseHub(skyStatic().cities, { clouds: rd.json("clouds", "clouds.json"), precise: preciseOf(rd), sky: skyStatic().sky, now: o.now }),
    snapshot: (h, o) => { const x = skySnapshotInputs(); return x.clouds && summariseHub(skyStatic().cities.filter((c) => x.clouds.cities[c.id]), { clouds: x.clouds, precise: x.precise, sky: skyStatic().sky, now: o.now, allowStale: true }); },
  }];
  if (p.key === "iss") return [p.key, {
    read: (rd, o) => {
      const precise = preciseOf(rd);
      if (!precise) throw skip("the satellite data has no precise.json");
      const taken = rd.json("satellites", "satmeta.json").taken;
      return summariseIss(precise, { dataTime: isoZ(parseTime(taken)), now: o.now, cities: skyStatic().cities, places: o.places });
    },
    snapshot: (h, o) => { const x = skySnapshotInputs(); return x.precise && h.satellites && summariseIss(x.precise, { dataTime: isoZ(parseTime(h.satellites.meta.taken)), now: o.now, cities: skyStatic().cities, places: h.places || null, allowStale: true }); },
    hubRow: issRow,
  }];
  return [p.key, {
    read: (rd, o) => summariseCity(cityOf(p.city), { clouds: rd.json("clouds", "clouds.json"), precise: preciseOf(rd), sky: skyStatic().sky, now: o.now }),
    snapshot: (h, o) => { const x = skySnapshotInputs(); return x.clouds && x.clouds.cities[p.city] ? summariseCity(cityOf(p.city), { clouds: x.clouds, precise: x.precise, sky: skyStatic().sky, now: o.now, allowStale: true }) : null; },
    ...(p.city === "pune" ? { hubRow: puneRow } : {}),
  }];
}));

export const SKY_RENDER = Object.fromEntries(SKY_PAGES.map((p) => [p.key,
  p.key === "sky-hub" ? (h, o = {}) => skyHubPage(h.summaries, h.findings, { built: o.built || [], cities: h.cities, missing: h.missing })
    : p.key === "iss" ? (s, o = {}) => issPage(s, { built: o.built || [], cities: s.passes.map((x) => x.city), coast: o.coast || [] })
    : (s, o = {}) => cityPage(s, { built: o.built || [] }),
]));
