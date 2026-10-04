// Two official scales, copied from the pages that publish them (saved in raw3/ and checked against by test/scales.test.js).
//
// NOAA Space Weather Scales, geomagnetic storms: https://www.swpc.noaa.gov/noaa-scales-explanation (read 2026-10-04)
// Saffir-Simpson Hurricane Wind Scale: https://www.nhc.noaa.gov/aboutsshws.php (read 2026-10-04)

// `aurora` is NOAA's own wording of where aurora "has been seen". geomagLat is its "typically N degrees geomagnetic latitude"
// (geomagnetic latitude is measured from the magnetic pole, not the geographic one, so it is not the same as a place's latitude).
export const GEOMAGNETIC_SCALE = [
  { g: 1, name: "Minor", kp: 5, aurora: "aurora is commonly visible at high latitudes (northern Michigan and Maine)", geomagLat: null },
  { g: 2, name: "Moderate", kp: 6, aurora: "aurora has been seen as low as New York and Idaho", geomagLat: 55 },
  { g: 3, name: "Strong", kp: 7, aurora: "aurora has been seen as low as Illinois and Oregon", geomagLat: 50 },
  { g: 4, name: "Severe", kp: 8, aurora: "aurora has been seen as low as Alabama and northern California", geomagLat: 45 },
  { g: 5, name: "Extreme", kp: 9, aurora: "aurora has been seen as low as Florida and southern Texas", geomagLat: 40 },
];
export const GEOMAGNETIC_SOURCE = "NOAA Space Weather Scales";

// G level for a Kp value. NOAA lists Kp 8 "including a 9-" under G4, so 8.67 is G4 and only 9 is G5. Below Kp 5 there is no G level.
export const gLevelForKp = (kp) => (kp == null || !isFinite(kp) ? 0 : Math.max(0, Math.min(5, Math.floor(kp + 1e-9) - 4)));
export const scaleFor = (g) => GEOMAGNETIC_SCALE.find((s) => s.g === g) || null;

// Sustained wind ranges in knots, from the NHC table. Category 3 and above are "major hurricanes" on that page.
export const SAFFIR_SIMPSON = [
  { cat: 1, minKt: 64, maxKt: 82, kmh: "119 to 153", major: false },
  { cat: 2, minKt: 83, maxKt: 95, kmh: "154 to 177", major: false },
  { cat: 3, minKt: 96, maxKt: 112, kmh: "178 to 208", major: true },
  { cat: 4, minKt: 113, maxKt: 136, kmh: "209 to 251", major: true },
  { cat: 5, minKt: 137, maxKt: Infinity, kmh: "252 or higher", major: true },
];
export const SSHWS_NOTE = "NHC says the scale is based only on maximum sustained wind speed and does not take into account storm surge, rainfall flooding or tornadoes.";
export const SSHWS_SOURCE = "NHC Saffir-Simpson Hurricane Wind Scale";

// Category 1 to 5, or 0 below hurricane strength. Wind is in whole knots, as NHC reports it.
export const categoryForKnots = (kt) => (kt == null || !isFinite(kt) ? 0 : (SAFFIR_SIMPSON.find((c) => kt >= c.minKt && kt <= c.maxKt + 0.999) || { cat: 0 }).cat);
