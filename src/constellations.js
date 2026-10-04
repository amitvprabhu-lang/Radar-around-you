// The 88 IAU constellations (public/constellations.json, built by tools/build-constellations.mjs) and what can be worked out from them.
import * as Astro from "astronomy-engine";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function indexConstellations(doc) {
  if (!doc || !Array.isArray(doc.constellations) || doc.constellations.length !== 88) throw new Error("constellations: unexpected structure");
  const byAbbr = new Map(doc.constellations.map((c) => [c.abbr, c]));
  return { list: doc.constellations, byAbbr, credit: doc.credit, doc };
}

// Which constellation a point of the sky is in, by the IAU boundaries (astronomy-engine's Constellation). ra and dec in degrees, J2000.
export function constellationAt(raDeg, decDeg) {
  const c = Astro.Constellation((((raDeg % 360) + 360) % 360) / 15, decDeg);
  return c.symbol;
}

// The evening it is highest. A star on the meridian has the local sidereal time as its right ascension; at 21:00 local solar time that
// is the Sun's right ascension plus 9 hours (135 degrees). So the month is when the Sun's right ascension equals the object's
// minus 135 degrees. This is about the middle of the constellation and ignores the year it is computed for (the shift is under a day).
let sunRa = null;
function sunRaByDay() {
  if (sunRa) return sunRa;
  const obs = new Astro.Observer(0, 0, 0);
  sunRa = [];
  for (let d = 0; d < 366; d++) sunRa.push(Astro.Equator(Astro.Body.Sun, new Date(Date.UTC(2027, 0, 1 + d, 12)), obs, false, true).ra * 15);
  return sunRa;
}
export function bestMonth(raDeg) {
  const target = (raDeg - 135 + 720) % 360;
  let bestDay = 0, bestD = 360;
  sunRaByDay().forEach((ra, d) => { const diff = Math.abs(((ra - target + 540) % 360) - 180); if (diff < bestD) { bestD = diff; bestDay = d; } });
  const date = new Date(Date.UTC(2027, 0, 1 + bestDay));
  return { month: MONTHS[date.getUTCMonth()], day: date.getUTCDate(), monthIndex: date.getUTCMonth() };
}

// How a constellation sits in the sky of a place, from its declination range. Altitude is geometric: no refraction, no horizon obstacles.
//  - the highest any point of it gets: 90 minus the angle between the latitude and the declination (declination of the centre for "its middle")
//  - never rises: even its northernmost point stays below the horizon at the latitudes it is south of, and the mirror in the south
//  - circumpolar: its southernmost point never sets (northern latitudes), or its northernmost never sets (southern)
export function visibilityFrom(c, latDeg) {
  const maxAltCentre = 90 - Math.abs(latDeg - c.centre.dec);
  const neverRises = latDeg >= 0 ? c.decMax < latDeg - 90 : c.decMin > latDeg + 90;
  const circumpolar = latDeg >= 0 ? c.decMin > 90 - latDeg : c.decMax < -90 - latDeg;
  const partlyBelow = latDeg >= 0 ? c.decMin < latDeg - 90 : c.decMax > latDeg + 90;
  const state = neverRises ? "never" : circumpolar ? "circumpolar" : partlyBelow ? "partial" : "full";
  return { state, maxAltCentre: Math.max(-90, maxAltCentre), neverRises, circumpolar };
}
export const VISIBILITY_TEXT = {
  never: "It never rises above the horizon from here.",
  circumpolar: "From here it never sets.",
  partial: "From here only part of it ever clears the horizon.",
  full: "From here all of it clears the horizon at some time.",
};

// Which of the Moon and planets are inside the constellation at a moment (the Sun is left out: it is in one all day and the sky is bright).
export function wanderersIn(abbr, date) {
  const obs = new Astro.Observer(0, 0, 0), out = [];
  for (const body of [Astro.Body.Moon, Astro.Body.Mercury, Astro.Body.Venus, Astro.Body.Mars, Astro.Body.Jupiter, Astro.Body.Saturn, Astro.Body.Uranus, Astro.Body.Neptune]) {
    const eq = Astro.Equator(body, date, obs, false, true);
    if (Astro.Constellation(eq.ra, eq.dec).symbol === abbr) out.push(body);
  }
  return out;
}

// Which constellation each body is in, for "Mars is in Gemini" style statements.
export function wherePlanets(date) {
  const obs = new Astro.Observer(0, 0, 0), out = {};
  for (const body of [Astro.Body.Sun, Astro.Body.Moon, Astro.Body.Mercury, Astro.Body.Venus, Astro.Body.Mars, Astro.Body.Jupiter, Astro.Body.Saturn, Astro.Body.Uranus, Astro.Body.Neptune]) {
    const eq = Astro.Equator(body, date, obs, false, true);
    out[body] = Astro.Constellation(eq.ra, eq.dec).symbol;
  }
  return out;
}
