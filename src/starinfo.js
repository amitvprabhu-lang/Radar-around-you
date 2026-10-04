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
