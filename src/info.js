// Turns raw records into the facts shown on detail cards. Pure functions, no DOM, so they can be unit tested.
import {
  EARTH_RADIUS_KM, clamp, tableName, unpackDetails, launchDateFromDay, ageDays, OBJECT_TYPES, swarmPositionEci, swarmPositionFast, gmstDeg, DEG,
  ecefToGeodetic, footprintRadiusKm, haversineKm, bearingDeg, compassPoint, waveTravelSec, P_WAVE_KM_S, S_WAVE_KM_S, airlineCode, routeProgress, swarmLook,
} from "./core.js";

export const STATUS_NAMES = ["Not known", "Operational", "Partially operational", "Backup or standby", "Spare", "Extended mission", "Not operational", "Decayed"];

// Common ICAO aircraft type codes. Anything not listed is shown as its code.
export const AIRCRAFT_NAMES = {
  A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320", A321: "Airbus A321", A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A338: "Airbus A330-800", A339: "Airbus A330-900", A343: "Airbus A340-300", A346: "Airbus A340-600",
  A359: "Airbus A350-900", A35K: "Airbus A350-1000", A388: "Airbus A380-800", A306: "Airbus A300-600", A310: "Airbus A310",
  B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9", B712: "Boeing 717",
  B744: "Boeing 747-400", B748: "Boeing 747-8", B752: "Boeing 757-200", B753: "Boeing 757-300", B762: "Boeing 767-200", B763: "Boeing 767-300", B764: "Boeing 767-400",
  B772: "Boeing 777-200", B77L: "Boeing 777-200LR", B773: "Boeing 777-300", B77W: "Boeing 777-300ER", B778: "Boeing 777-8", B779: "Boeing 777-9",
  B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  E170: "Embraer 170", E75L: "Embraer 175", E75S: "Embraer 175", E190: "Embraer 190", E195: "Embraer 195", CRJ2: "Bombardier CRJ-200", CRJ7: "Bombardier CRJ-700", CRJ9: "Bombardier CRJ-900", CRJX: "Bombardier CRJ-1000",
  DH8D: "De Havilland Dash 8 Q400", C172: "Cessna 172", C208: "Cessna 208 Caravan", PC12: "Pilatus PC-12", F100: "Fokker 100", MD11: "McDonnell Douglas MD-11",
};
export const aircraftName = (code) => (code && AIRCRAFT_NAMES[code]) || (code ? `Type ${code}` : "Type not reported");

export const titleCase = (s) => (s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const quakeTimeMs = (q) => (typeof q.time === "number" ? q.time : Date.parse(q.time));

// Speed from two close positions (km/s), in the inertial frame.
export function satSpeedKmS(sw, tMs) {
  const a = swarmPositionEci(sw, tMs), b = swarmPositionEci(sw, tMs + 1000);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function satelliteInfo(D, idx, date, place) {
  const meta = D.meta, sw = D.swarm[idx];
  const later = D.later;
  const t = date.getTime();
  const p = swarmPositionFast(sw, t, gmstDeg(date) * DEG);
  const g = ecefToGeodetic(p.x, p.y, p.z);
  const info = {
    idx, noradId: later ? later.ids[idx] : null, name: later ? later.names[idx] : `Object ${idx}`,
    lat: g.lat, lon: g.lon, altKm: g.hKm, speedKmS: satSpeedKmS(sw, t), periodMin: (2 * Math.PI) / sw.n,
    inclinationDeg: sw.i / DEG, footprintKm: footprintRadiusKm(Math.min(g.hKm, 60000), 0), groupType: sw.type,
  };
  if (later) {
    const d = unpackDetails(later.details, idx);
    info.owner = tableName(meta.owners, d.owner);
    info.ownerCode = tableName(meta.ownerCodes, d.owner);
    info.siteCode = tableName(meta.siteCodes, d.site);
    info.site = tableName(meta.sites, d.site);
    info.objectType = OBJECT_TYPES[d.type] || "Unknown";
    info.purpose = meta.purposes[d.purpose] || "Unspecified";
    info.status = STATUS_NAMES[d.status] || STATUS_NAMES[0];
    info.launchDate = launchDateFromDay(d.launchDay);
    info.ageDays = d.launchDay ? ageDays(d.launchDay, t) : null;
    info.isNew = info.ageDays !== null && info.ageDays <= 30;
  }
  if (place) {
    const l = swarmLook(sw, date, place.lat, place.lon);
    info.look = { el: l.el, az: l.az, compass: compassPoint(l.az), rangeKm: l.rangeKm, sunlit: l.sunlit, above: l.el > 0 };
  }
  return info;
}

const AIRPORT_LABEL = (a) => (a ? `${a.iata || a.icao || "?"}` : "?");
export function planeInfo(D, rec) {
  const p = rec.p;
  const airlines = D.later ? D.later.airlines : {};
  const routes = D.later ? D.later.routes : {};
  const code = airlineCode(p.call);
  const al = airlines[code] || null;
  const route = routes[(p.call || "").trim()] || null;
  let progress = null;
  if (route && route.length >= 2) {
    const pr = routeProgress({ lat: rec.pos ? rec.pos.lat : p.lat, lon: rec.pos ? rec.pos.lon : p.lon }, route);
    if (pr) progress = { ...pr, from: route[pr.leg], to: route[pr.leg + 1], onTrack: pr.offTrackKm < 150 };
  }
  return {
    call: p.call, hex: p.hex, airline: al ? al.n : null, airlineCountry: al ? al.c : null, airlineCode: code,
    type: p.type, typeName: aircraftName(p.type), altFt: p.altFt, altM: Math.round(p.altFt * 0.3048), gsKt: p.gsKt, gsKmh: Math.round(p.gsKt * 1.852), track: p.track,
    route, progress, distKm: rec.distKm, slantKm: rec.slantKm, el: rec.el, az: rec.az, compass: compassPoint(rec.az),
    summary: route && route.length >= 2 ? `${AIRPORT_LABEL(route[0])} to ${AIRPORT_LABEL(route[route.length - 1])}` : null,
  };
}

export function quakeInfo(D, q, place, nowMs) {
  const imp = D.later && D.later.impact ? D.later.impact[q.id] : null;
  const t = quakeTimeMs(q);
  const depth = Math.max(0, q.depth || 0);
  const distKm = place ? haversineKm(place.lat, place.lon, q.lat, q.lon) : null;
  const info = {
    id: q.id, mag: q.mag, place: q.place, timeMs: t, ageMs: nowMs - t, depthKm: depth, lat: q.lat, lon: q.lon, felt: imp ? imp.felt : q.felt, url: q.url,
    status: q.status || null, alert: imp ? imp.alert : null, tsunami: imp ? !!imp.tsunami : null, mmi: imp ? imp.mmi : null, cdi: imp ? imp.cdi : null,
    exposure: imp && imp.exposure ? imp.exposure : null, pager: imp ? imp.pager : null, hasShakeMap: !!(imp && imp.contours && imp.contours.length), distKm,
    bearing: place ? bearingDeg(place.lat, place.lon, q.lat, q.lon) : null,
  };
  info.compass = info.bearing != null ? compassPoint(info.bearing) : null;
  if (distKm != null) {
    info.pSec = waveTravelSec(distKm, depth, P_WAVE_KM_S);
    info.sSec = waveTravelSec(distKm, depth, S_WAVE_KM_S);
    const age = info.ageMs / 1000;
    info.pReached = age >= info.pSec;
    info.sReached = age >= info.sSec;
  }
  // Which layer of the Earth the focus is in
  info.layer = depth < 35 ? "crust" : "upper mantle";
  return info;
}

// Estimated number of people at or above a shaking level (Modified Mercalli Intensity), from the PAGER exposure table.
export function exposureAtOrAbove(exposure, mmi) {
  if (!exposure) return 0;
  return exposure.mmi.reduce((s, m, i) => s + (m >= mmi ? exposure.pop[i] : 0), 0);
}

// Group the objects launched in the last 30 days by launch day, newest first.
export function recentLaunches(D, nowMs) {
  if (!D.later) return [];
  const byDay = new Map();
  for (const idx of D.meta.newIdx) {
    const d = unpackDetails(D.later.details, idx);
    if (!d.launchDay) continue;
    if (!byDay.has(d.launchDay)) byDay.set(d.launchDay, { launchDay: d.launchDay, idxs: [], site: tableName(D.meta.sites, d.site), siteCode: tableName(D.meta.siteCodes, d.site), owners: new Map() });
    const g = byDay.get(d.launchDay);
    g.idxs.push(idx);
    const o = tableName(D.meta.owners, d.owner) || "Unknown";
    g.owners.set(o, (g.owners.get(o) || 0) + 1);
  }
  return [...byDay.values()].sort((a, b) => b.launchDay - a.launchDay).map((g) => {
    const owner = [...g.owners.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const date = launchDateFromDay(g.launchDay);
    return { ...g, owner, date, ageDays: ageDays(g.launchDay, nowMs), count: g.idxs.length, first: g.idxs[g.idxs.length - 1], names: g.idxs.slice(0, 3).map((i) => D.later.names[i]) };
  });
}

// "A, B and 3 more" style lists
export function listWithMore(names, shown = 2) {
  if (names.length <= shown) return names.join(", ");
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

// Kp index at a time (the most recent value at or before the time), or null
export function kpAt(kpList, nowMs) {
  let best = null;
  for (const k of kpList) { const t = Date.parse(k.t + "Z"); if (t <= nowMs) best = k; }
  return best;
}

// Moon phase angle (0 new, 90 first quarter, 180 full, 270 last quarter, as returned by astronomy-engine's MoonPhase) to a name.
export function moonPhaseName(phaseDeg) {
  const p = ((phaseDeg % 360) + 360) % 360;
  if (p < 11.25 || p >= 348.75) return "New Moon";
  if (p < 78.75) return "Waxing crescent";
  if (p < 101.25) return "First quarter";
  if (p < 168.75) return "Waxing gibbous";
  if (p < 191.25) return "Full Moon";
  if (p < 258.75) return "Waning gibbous";
  if (p < 281.25) return "Last quarter";
  return "Waning crescent";
}

// GDACS gives one severity string per event, not per moment. For a storm it is the strongest wind in its record (NHC's
// own current wind for the same storm was lower on 2026-10-04), so the card must not present it as the current wind.
// Flood events carry "Magnitude 0", which means nothing to a reader, so it is left out.
export function hazardSeverity(e) {
  const raw = String((e && e.severity) || "").trim();
  if (!raw) return null;
  if (e.type === "TC") {
    const m = raw.match(/maximum wind speed of (\d+)\s*km\/h/i);
    return m ? { label: "Highest wind GDACS lists for this storm", value: `${m[1]} km/h`, note: "GDACS gives one figure for the whole storm, so its strength right now can be lower." } : { label: "Severity (GDACS)", value: raw, note: "" };
  }
  if (e.type === "WF") {
    const m = raw.match(/in\s+([\d,.]+)\s*ha/i);
    return m ? { label: "Burned area GDACS lists", value: `${m[1]} ha`, note: "A hectare is 10,000 square metres, about 1.4 football pitches." } : { label: "Severity (GDACS)", value: raw, note: "" };
  }
  if (e.type === "FL" && /^magnitude\s*0\s*$/i.test(raw)) return null;
  return { label: "Severity (GDACS)", value: raw, note: "" };
}
