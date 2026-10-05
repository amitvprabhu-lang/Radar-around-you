// What can be said about one star from the catalogue and the astronomy library: colour, rank, and when it rises, crosses the sky and sets.
import * as Astro from "astronomy-engine";

// B-V colour index to a plain colour name. The bands are our own simple choice, not a spectral classification.
export const BV_BANDS = [[0.0, "blue-white"], [0.3, "white"], [0.6, "yellow-white"], [0.8, "yellow"], [1.4, "orange"], [Infinity, "orange-red"]];
export function colourName(bv) {
  if (bv == null || !isFinite(bv)) return null;
  return BV_BANDS.find(([top]) => bv < top)[1];
}

// 1 for the brightest star in the catalogue. Equal magnitudes share a rank.
export function magnitudeRank(mags, i) {
  let brighter = 0;
  for (let k = 0; k < mags.length; k++) if (mags[k] < mags[i] - 1e-9) brighter++;
  return brighter + 1;
}

// A star from the sky's equator and pole is above the horizon for part of the day unless it is always up or never up. No refraction.
export function dayState(decDeg, latDeg) {
  if (latDeg >= 0) return decDeg > 90 - latDeg ? "circumpolar" : decDeg < latDeg - 90 ? "never" : "normal";
  return decDeg < -90 - latDeg ? "circumpolar" : decDeg > latDeg + 90 ? "never" : "normal";
}

// Rise, highest point and set after `date`, with the library's own rise and set rule (refraction included). ra and dec in degrees, J2000.
export function starDay(raDeg, decDeg, latDeg, lonDeg, date) {
  const state = dayState(decDeg, latDeg);
  const out = { state, rise: null, transit: null, set: null, transitAlt: 90 - Math.abs(latDeg - decDeg) };
  if (state === "never") return out;
  Astro.DefineStar(Astro.Body.Star1, raDeg / 15, decDeg, 1000);  // distance is only used for parallax, which is far below what is shown here
  const obs = new Astro.Observer(latDeg, lonDeg, 0);
  const t = Astro.SearchHourAngle(Astro.Body.Star1, obs, 0, date);
  out.transit = t ? t.time.date : null;
  if (state === "normal") {
    const r = Astro.SearchRiseSet(Astro.Body.Star1, obs, +1, date, 1.2), s = Astro.SearchRiseSet(Astro.Body.Star1, obs, -1, date, 1.2);
    out.rise = r ? r.date : null; out.set = s ? s.date : null;
  }
  return out;
}

// "Bayer letter + the constellation's genitive", the usual designation, for example "α Canis Majoris".
export const bayerName = (entry, constellation) => (entry && entry.bayer && constellation ? `${entry.bayer} ${constellation.genitive}` : null);

// ---- details from public/stardetails.json (built by pipeline/stardetails.py from the HYG database and the NASA Exoplanet Archive)
// One parsec is 648000/pi astronomical units and one light-year is 63241.077 of them, which is 3.2616 light-years to the parsec.
export const LY_PER_PC = 206264.806247 / 63241.0770842;

// distance: parsecs, or null when the catalogue has none that can be trusted
export function lightYears(pc) { return pc == null || !isFinite(pc) || pc <= 0 ? null : pc * LY_PER_PC; }
const roundLy = (ly) => (ly < 10 ? ly.toFixed(1) : ly < 100 ? String(Math.round(ly)) : Number(ly.toPrecision(2)).toLocaleString("en-GB"));
export function distanceText(pc) {
  const ly = lightYears(pc);
  if (ly == null) return null;
  return `about ${roundLy(ly)} light-years (${pc < 10 ? pc.toFixed(2) : Math.round(pc).toLocaleString("en-GB")} parsecs)`;
}
// the light we see now left the star this long ago, which is its distance in light-years read as years
export function lightAgeText(pc) {
  const ly = lightYears(pc);
  return ly == null ? null : `The light you see left it about ${roundLy(ly)} years ago.`;
}
// multiple of the Sun's luminosity, as the source gives it
export function luminosityText(lum) {
  if (lum == null || !isFinite(lum) || lum <= 0) return null;
  const v = lum >= 100 ? Number(lum.toPrecision(3)).toLocaleString("en-GB") : lum >= 10 ? String(Math.round(lum)) : lum >= 1 ? lum.toFixed(1) : lum.toFixed(2);
  return `about ${v} times the Sun's`;
}
export function planetText(p) {
  if (!p || !p.n) return null;
  const names = p.names.length > 8 ? `${p.names.slice(0, 8).join(", ")} and ${p.names.length - 8} more` : p.names.join(", ");
  const when = p.year ? (p.year[0] === p.year[1] ? `found in ${p.year[0]}` : `found between ${p.year[0]} and ${p.year[1]}`) : null;
  const how = p.methods && p.methods.length ? `by ${p.methods.map((m) => m.toLowerCase()).join(" and ")}` : null;
  return `${p.n} confirmed planet${p.n === 1 ? "" : "s"}: ${names}${when || how ? ` (${[when, how].filter(Boolean).join(", ")})` : ""}`;
}
// the four numbers stored per star: [distance in parsecs, spectral type, luminosity in Suns, absolute magnitude]
export function detailsFor(doc, i) {
  if (!doc || !doc.stars) return null;
  const r = doc.stars[String(i)];
  if (!r) return null;
  return { pc: r[0], spect: r[1], lum: r[2], absMag: r[3], planets: (doc.planets && doc.planets[String(i)]) || null };
}
