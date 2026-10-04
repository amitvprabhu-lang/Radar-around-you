// Pure maths and logic for the Radar Around You prototype.
// No browser APIs and no library imports, so every function can be unit tested in Node.

export const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371.0;
const EARTH_EQ_RADIUS_KM = 6378.137;
const KNOT_KMH = 1.852;

export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => {
  const x = norm360(a);
  return x > 180 ? x - 360 : x;
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Time ----------

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Greenwich mean sidereal time in degrees (IAU 1982 expression, as in Meeus ch. 12).
export function gmstDeg(date) {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return norm360(g);
}

// ---------- Coordinates ----------

// Equatorial (RA, Dec in degrees) to horizontal coordinates for an observer. No refraction.
export function raDecToAltAz(raDeg, decDeg, latDeg, lonDeg, date) {
  const lst = norm360(gmstDeg(date) + lonDeg);
  const ha = norm360(lst - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const y = -Math.sin(ha) * Math.cos(dec);
  const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha);
  const az = norm360(Math.atan2(y, x) / DEG);
  return { alt: alt / DEG, az };
}

// Low-precision Sun position (Astronomical Almanac formula, good to about 0.01 deg).
export function sunRaDec(date) {
  const n = julianDate(date) - 2451545.0;
  const L = norm360(280.46 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG;
  return { ra, dec };
}

export function sunAltAz(latDeg, lonDeg, date) {
  const s = sunRaDec(date);
  return raDecToAltAz(s.ra, s.dec, latDeg, lonDeg, date);
}

// Unit vector from Earth's centre towards the Sun in the same inertial (true-of-date-ish) frame
// that SGP4 uses. Accuracy of a few hundredths of a degree is plenty for a shadow test.
export function sunUnitVectorEci(date) {
  const s = sunRaDec(date);
  const ra = s.ra * DEG;
  const dec = s.dec * DEG;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
}

// Sub-solar point (where the Sun is directly overhead), used to light the globe.
export function subsolarPoint(date) {
  const s = sunRaDec(date);
  return { lat: s.dec, lon: norm180(s.ra - gmstDeg(date)) };
}

// ---------- Distances on the Earth ----------

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / DEG);
}

export function destinationPoint(latDeg, lonDeg, bearing, distKm) {
  const d = distKm / EARTH_RADIUS_KM;
  const b = bearing * DEG;
  const p1 = latDeg * DEG;
  const l1 = lonDeg * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: norm180(l2 / DEG) };
}

// Move a plane along its last known track at its last known ground speed.
export function extrapolatePlane(plane, seconds) {
  const km = (plane.gsKt * KNOT_KMH * seconds) / 3600;
  if (km <= 0) return { lat: plane.lat, lon: plane.lon };
  return destinationPoint(plane.lat, plane.lon, plane.track, km);
}

// Elevation and azimuth of an object at (lat, lon, height above sea level) seen from an observer,
// using a spherical Earth. Good enough for planes within a few hundred kilometres.
export function lookAngle(obsLat, obsLon, tgtLat, tgtLon, tgtHeightKm) {
  const dist = haversineKm(obsLat, obsLon, tgtLat, tgtLon);
  const az = bearingDeg(obsLat, obsLon, tgtLat, tgtLon);
  const theta = dist / EARTH_RADIUS_KM;
  const R = EARTH_RADIUS_KM;
  const r = R + tgtHeightKm;
  // Triangle: Earth centre, observer, target.
  const horiz = r * Math.sin(theta);
  const vert = r * Math.cos(theta) - R;
  const el = Math.atan2(vert, horiz) / DEG;
  return { az, el, distKm: dist };
}

// ---------- Satellites ----------

// Cylindrical Earth-shadow test. posKm is an ECI position, sunUnit the Sun direction in ECI.
export function isSunlit(posKm, sunUnit) {
  const dot = posKm.x * sunUnit.x + posKm.y * sunUnit.y + posKm.z * sunUnit.z;
  if (dot > 0) return true;
  const px = posKm.x - dot * sunUnit.x;
  const py = posKm.y - dot * sunUnit.y;
  const pz = posKm.z - dot * sunUnit.z;
  return Math.sqrt(px * px + py * py + pz * pz) > EARTH_EQ_RADIUS_KM;
}

// Find passes of a satellite over an observer.
// lookFn(date) must return { el, az, sunlit } for the satellite (el and az in degrees).
// sunAltFn(date) returns the Sun's altitude at the observer in degrees.
// A pass is "visible" when, at some moment above minEl, the satellite is sunlit and the sky is dark
// (Sun below -6 degrees, civil twilight or darker).
export function findPasses(lookFn, sunAltFn, start, hours, opts = {}) {
  const step = (opts.stepSec || 30) * 1000;
  const minEl = opts.minEl ?? 10;
  const end = start.getTime() + hours * 3600000;
  const passes = [];
  let cur = null;
  let prevAbove = false;
  for (let t = start.getTime(); t <= end; t += step) {
    const d = new Date(t);
    const look = lookFn(d);
    const above = look.el >= minEl;
    if (above) {
      const dark = sunAltFn(d) < -6;
      if (!cur) cur = { rise: d, riseAz: look.az, max: { time: d, el: look.el, az: look.az }, visible: false, track: [] };
      if (look.el > cur.max.el) cur.max = { time: d, el: look.el, az: look.az };
      if (look.sunlit && dark) cur.visible = true;
      cur.track.push({ time: d, el: look.el, az: look.az, lit: look.sunlit && dark });
    } else if (prevAbove && cur) {
      cur.set = new Date(t - step);
      cur.setAz = cur.track[cur.track.length - 1].az;
      passes.push(cur);
      cur = null;
    }
    prevAbove = above;
  }
  if (cur) {
    cur.set = new Date(end);
    cur.setAz = cur.track[cur.track.length - 1].az;
    cur.truncated = true;
    passes.push(cur);
  }
  return passes;
}

// ---------- Fast orbit model for the satellite swarm ----------
// Two-body orbit with the main J2 drift of the node and perigee. It is far cheaper than SGP4,
// so thousands of objects can move every frame (the same formula runs in the globe shader).
// Accuracy is tens to a few hundred kilometres over a day or two: fine for a visual swarm,
// not for pass predictions (those use full SGP4 via satellite.js).
const MU_KM3_S2 = 398600.4418;
const J2 = 1.08262668e-3;
export const SWARM_EARTH_RADIUS_KM = EARTH_EQ_RADIUS_KM;

// Angles in radians, n in radians per minute.
export function swarmFromRad(epochMs, n, e, i, raan, argp, ma) {
  const nSec = n / 60;
  const a = Math.cbrt(MU_KM3_S2 / (nSec * nSec));
  const p = a * (1 - e * e);
  const k = 0.75 * n * J2 * (EARTH_EQ_RADIUS_KM / p) ** 2;
  return { epochMs, n, a, e, i, raan, argp, ma, raanDot: -2 * k * Math.cos(i), argpDot: k * (5 * Math.cos(i) ** 2 - 1) };
}

// el: { epochMs, nRevDay, ecc, inclDeg, raanDeg, argpDeg, maDeg }
export function swarmElements(el) {
  return swarmFromRad(el.epochMs, (el.nRevDay * 2 * Math.PI) / 1440, el.ecc, el.inclDeg * DEG, el.raanDeg * DEG, el.argpDeg * DEG, el.maDeg * DEG);
}

// Unpack the compact swarm arrays written by build_snapshot.py.
export function decodeSwarm(f32, u16, refMs) {
  const out = [];
  const TWO_PI = 2 * Math.PI;
  for (let k = 0; k < f32.length / 2; k++) {
    const b = 6 * k;
    const el = swarmFromRad(refMs + f32[2 * k] * 60000, f32[2 * k + 1], u16[b] / 65535, (u16[b + 1] / 65535) * Math.PI,
      (u16[b + 2] / 65535) * TWO_PI, (u16[b + 3] / 65535) * TWO_PI, (u16[b + 4] / 65535) * TWO_PI);
    el.type = u16[b + 5];
    out.push(el);
  }
  return out;
}

// Earth-fixed position in km (x through lon 0, z through the North Pole).
export function swarmPositionEcef(s, date) {
  const dt = (date.getTime() - s.epochMs) / 60000;
  const M = s.ma + s.n * dt;
  const raan = s.raan + s.raanDot * dt;
  const argp = s.argp + s.argpDot * dt;
  let E = M;
  for (let k = 0; k < 5; k++) E = E - (E - s.e * Math.sin(E) - M) / (1 - s.e * Math.cos(E));
  const xp = s.a * (Math.cos(E) - s.e);
  const yp = s.a * Math.sqrt(1 - s.e * s.e) * Math.sin(E);
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(s.i), si = Math.sin(s.i);
  const x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  const g = gmstDeg(date) * DEG;
  return { x: x * Math.cos(g) + y * Math.sin(g), y: -x * Math.sin(g) + y * Math.cos(g), z };
}

// Observer position in km on the WGS84 ellipsoid (geodetic latitude), at sea level.
// Using the true Earth shape here matters: a sphere would move the observer by about 20 km,
// which shifts the direction to a low satellite overhead by more than a degree.
export function observerEcef(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const N = EARTH_EQ_RADIUS_KM / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return { x: N * Math.cos(la) * Math.cos(lo), y: N * Math.cos(la) * Math.sin(lo), z: N * (1 - e2) * Math.sin(la) };
}

// Elevation and azimuth of an Earth-fixed position seen from an observer (local ellipsoid normal as "up").
export function ecefLook(obsLat, obsLon, pos) {
  const o = observerEcef(obsLat, obsLon);
  const dx = pos.x - o.x, dy = pos.y - o.y, dz = pos.z - o.z;
  const la = obsLat * DEG, lo = obsLon * DEG;
  const east = -Math.sin(lo) * dx + Math.cos(lo) * dy;
  const north = -Math.sin(la) * Math.cos(lo) * dx - Math.sin(la) * Math.sin(lo) * dy + Math.cos(la) * dz;
  const up = Math.cos(la) * Math.cos(lo) * dx + Math.cos(la) * Math.sin(lo) * dy + Math.sin(la) * dz;
  return { el: Math.atan2(up, Math.hypot(east, north)) / DEG, az: norm360(Math.atan2(east, north) / DEG) };
}

// ---------- Sky projection ----------

// Azimuthal equidistant "looking up" projection: zenith at the centre, horizon on the circle.
// North is up and east is to the LEFT, the way sky charts are drawn when you lie on your back.
// rotation (degrees) turns the chart so a different direction is at the top.
export function projectSky(altDeg, azDeg, cx, cy, radius, rotation = 0) {
  const r = (radius * (90 - altDeg)) / 90;
  const a = (azDeg - rotation) * DEG;
  return { x: cx - r * Math.sin(a), y: cy - r * Math.cos(a), r };
}

// Horizon "panorama" used by Guide me: azimuth runs left to right around the heading,
// altitude runs bottom to top. Returns null when the point is outside the field of view.
export function projectPanorama(altDeg, azDeg, headingDeg, width, height, fovDeg = 90) {
  const dAz = norm180(azDeg - headingDeg);
  if (Math.abs(dAz) > fovDeg / 2 + 10) return null;
  const x = width / 2 + (dAz / fovDeg) * width;
  const y = height - (clamp(altDeg, -5, 90) / 90) * height;
  return { x, y, dAz };
}

// Plain-language direction for Guide me.
export function guideInstruction(headingDeg, targetAz, targetAlt) {
  const turn = norm180(targetAz - headingDeg);
  const dir = Math.abs(turn) < 8 ? "Facing it" : turn > 0 ? `Turn right ${Math.round(turn)}°` : `Turn left ${Math.round(-turn)}°`;
  const up = targetAlt < 15 ? "low above the horizon" : targetAlt < 45 ? "about halfway up" : targetAlt < 75 ? "high in the sky" : "almost overhead";
  return { turn, text: `${dir}, then look ${up} (${Math.round(targetAlt)}° up)` };
}

export function compassPoint(azDeg) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(norm360(azDeg) / 22.5) % 16];
}

// ---------- Aurora ----------

// grid: array of [lon(0..359), lat(-90..90), probability%] points (only non-zero points).
// Returns the strongest probability within maxKm, reduced linearly with distance, as a rough
// "might be visible from here" figure. This is a prototype heuristic, labelled as an estimate.
export function auroraChance(grid, lat, lon, maxKm = 900) {
  let best = 0;
  let bestAt = null;
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    if (Math.abs(p[1] - lat) > maxKm / 100) continue;
    const plon = p[0] > 180 ? p[0] - 360 : p[0];
    const d = haversineKm(lat, lon, p[1], plon);
    if (d > maxKm) continue;
    const v = p[2] * (1 - d / (maxKm * 1.25));
    if (v > best) {
      best = v;
      bestAt = { lat: p[1], lon: plon, prob: p[2], distKm: d };
    }
  }
  return { chance: Math.round(best), at: bestAt };
}

// ---------- Best time tonight ----------

// hours: [{ t: Date, sunAlt, moonAlt, moonFrac (0..1), cloud (0..100), aurora (0..100) }]
// Each hour gets a 0..100 viewing score; the best run of consecutive good hours is returned.
export function scoreHour(h) {
  if (h.sunAlt > -6) return 0;
  const darkness = h.sunAlt <= -18 ? 1 : (-6 - h.sunAlt) / 12;
  const moonGlare = h.moonAlt > 0 ? h.moonFrac * 0.45 : 0;
  const clear = 1 - clamp(h.cloud, 0, 100) / 100;
  const auroraBonus = clamp(h.aurora || 0, 0, 100) / 200;
  return Math.round(100 * clamp(clear * (darkness - moonGlare + auroraBonus), 0, 1));
}

export function bestWindow(hours, threshold = 45) {
  const scored = hours.map((h) => ({ ...h, score: scoreHour(h) }));
  let best = null;
  let run = null;
  for (const h of scored) {
    if (h.score >= threshold) {
      if (!run) run = { start: h.t, end: h.t, total: 0, n: 0, peak: h };
      run.end = h.t;
      run.total += h.score;
      run.n += 1;
      if (h.score > run.peak.score) run.peak = h;
    } else if (run) {
      if (!best || run.total > best.total) best = run;
      run = null;
    }
  }
  if (run && (!best || run.total > best.total)) best = run;
  if (best) best = { ...best, endExclusive: new Date(best.end.getTime() + 3600000), avg: Math.round(best.total / best.n) };
  return { scored, best };
}

// ---------- Reminders ----------

const pad = (n) => String(n).padStart(2, "0");
export function utcStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

// Google Calendar "add event" link (works as a plain external link inside the prototype).
export function googleCalendarUrl({ title, start, end, details, location }) {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: details || "",
    location: location || "",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ---------- Formatting ----------

export function formatDuration(ms) {
  if (ms < 60000) return "under a minute";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function formatAge(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// =====================================================================
// Version 2 additions
// =====================================================================

// ---------- Earth shape ----------

// Earth-fixed position (km) to geodetic latitude, longitude (degrees) and height (km) on WGS84.
export function ecefToGeodetic(x, y, z) {
  const a = EARTH_EQ_RADIUS_KM;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const sin = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * sin * sin);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - (e2 * N) / (N + h)));
  }
  return { lat: lat / DEG, lon: lon / DEG, hKm: h };
}

// Radius (km) of the circle on the ground from which a satellite at height hKm is seen
// at least minElDeg above the horizon. Spherical Earth.
export function footprintRadiusKm(hKm, minElDeg = 0) {
  const R = EARTH_RADIUS_KM;
  const el = minElDeg * DEG;
  const lambda = Math.acos(clamp((R / (R + hKm)) * Math.cos(el), -1, 1)) - el;
  return R * lambda;
}

// Points of a circle of radius radiusKm around a place, as [{lat, lon}].
export function circlePoints(latDeg, lonDeg, radiusKm, n = 72) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(destinationPoint(latDeg, lonDeg, (i / n) * 360, radiusKm));
  return out;
}

// Ground track: positions of an object over a time window. posFn(date) returns an
// Earth-fixed position {x, y, z} in km. The result is split wherever the track crosses
// the date line so it can be drawn as separate lines.
export function groundTrack(posFn, centre, minutesBefore, minutesAfter, stepMin = 1) {
  const segs = [];
  let cur = [];
  let prevLon = null;
  for (let m = -minutesBefore; m <= minutesAfter; m += stepMin) {
    const g = ecefToGeodetic(...Object.values(posFn(new Date(centre.getTime() + m * 60000))));
    if (prevLon !== null && Math.abs(g.lon - prevLon) > 180) {
      segs.push(cur);
      cur = [];
    }
    cur.push({ lat: g.lat, lon: g.lon, hKm: g.hKm, t: m });
    prevLon = g.lon;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// ---------- Sky helpers ----------

// Alt/az to a unit vector in the sky scene: +X east, +Y up, -Z north.
export function altAzToVector(altDeg, azDeg) {
  const a = altDeg * DEG;
  const z = azDeg * DEG;
  return { x: Math.cos(a) * Math.sin(z), y: Math.sin(a), z: -Math.cos(a) * Math.cos(z) };
}
export function vectorToAltAz(v) {
  return { alt: Math.asin(clamp(v.y, -1, 1)) / DEG, az: norm360(Math.atan2(v.x, -v.z) / DEG) };
}

// Galactic (l, b in degrees) to equatorial J2000 (RA, Dec in degrees).
export function galacticToEquatorial(lDeg, bDeg) {
  const raNGP = 192.85948 * DEG, decNGP = 27.12825 * DEG, lNCP = 122.93192 * DEG;
  const l = lDeg * DEG, b = bDeg * DEG;
  const sinDec = Math.sin(b) * Math.sin(decNGP) + Math.cos(b) * Math.cos(decNGP) * Math.cos(lNCP - l);
  const dec = Math.asin(clamp(sinDec, -1, 1));
  const y = Math.cos(b) * Math.sin(lNCP - l);
  const x = Math.sin(b) * Math.cos(decNGP) - Math.cos(b) * Math.sin(decNGP) * Math.cos(lNCP - l);
  return { ra: norm360(raNGP / DEG + Math.atan2(y, x) / DEG), dec: dec / DEG };
}

// Fraction of the Moon's disc that is lit, from the angle between the Sun and the Moon
// as seen from Earth (their directions as unit vectors).
export function litFraction(sunVec, moonVec) {
  const cos = sunVec.x * moonVec.x + sunVec.y * moonVec.y + sunVec.z * moonVec.z;
  return (1 - clamp(cos, -1, 1)) / 2;
}

// ---------- Seismic waves (simplified) ----------

export const P_WAVE_KM_S = 8.0;
export const S_WAVE_KM_S = 4.5;

// Straight-line distance from an earthquake focus (depth in km) to a point on the surface
// that is surfaceKm away along the ground.
export function chordKm(surfaceKm, depthKm) {
  const R = EARTH_RADIUS_KM;
  const r = R - depthKm;
  const theta = surfaceKm / R;
  return Math.sqrt(Math.max(0, R * R + r * r - 2 * R * r * Math.cos(theta)));
}
// Travel time in seconds along that straight line at a constant speed. Real waves curve through
// the Earth and speed up with depth, so far-away arrivals are sooner than this simple model says.
export function waveTravelSec(surfaceKm, depthKm, speedKmS) {
  return chordKm(surfaceKm, depthKm) / speedKmS;
}
// Ground distance reached on the surface by a wave front after sec seconds (inverse of the above).
export function waveSurfaceReachKm(sec, depthKm, speedKmS) {
  const R = EARTH_RADIUS_KM;
  const r = R - depthKm;
  const c = sec * speedKmS;
  if (c <= depthKm) return 0;
  const cosT = (R * R + r * r - c * c) / (2 * R * r);
  if (cosT < -1) return Math.PI * R;
  return R * Math.acos(clamp(cosT, -1, 1));
}

// ---------- Aircraft ----------

export function airlineCode(callsign) {
  const m = /^([A-Z]{3})[0-9]/.exec((callsign || "").trim().toUpperCase());
  return m ? m[1] : "";
}

// Progress (0..1) of a plane along a route made of airports [{lat, lon}, ...]. For routes with
// several legs the leg nearest to the plane is used. Returns { leg, from, to, fraction, offTrackKm }.
export function routeProgress(plane, airports) {
  let best = null;
  for (let i = 0; i + 1 < airports.length; i++) {
    const a = airports[i], b = airports[i + 1];
    const total = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const da = haversineKm(a.lat, a.lon, plane.lat, plane.lon);
    const db = haversineKm(plane.lat, plane.lon, b.lat, b.lon);
    const off = da + db - total; // zero when exactly on the great circle between a and b
    if (!best || off < best.offTrackKm) best = { leg: i, from: a, to: b, fraction: total > 0 ? clamp(da / (da + db), 0, 1) : 0, offTrackKm: off, totalKm: total };
  }
  return best;
}

// ---------- Search ----------

export const normalizeText = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9. ]+/g, " ").replace(/\s+/g, " ").trim();

// Aliases so people can type what they know. Values are matched as extra search text.
export const SATELLITE_ALIASES = {
  25544: "international space station iss zarya",
  48274: "tiangong chinese space station css tianhe",
  20580: "hubble space telescope hst",
};

// items: [{ id, name, kind, extra? }]. Returns a function search(query, limit) -> ranked items.
export function buildSearch(items) {
  const rows = items.map((it) => {
    const name = normalizeText(it.name);
    const extra = normalizeText(it.extra || "");
    return { it, name, extra, all: `${name} ${extra}`.trim(), idText: String(it.id) };
  });
  return function search(query, limit = 8) {
    const q = normalizeText(query);
    if (!q) return [];
    const tokens = q.split(" ");
    const out = [];
    for (const r of rows) {
      let score = 0;
      if (r.idText === q) score = 100;
      else if (r.name === q) score = 95;
      else if (r.name.startsWith(q)) score = 80 - Math.min(20, r.name.length - q.length) * 0.5;
      else if (tokens.every((t) => r.all.includes(t))) {
        score = 50 + tokens.reduce((s, t) => s + (r.name.startsWith(t) || r.name.includes(" " + t) ? 4 : 0), 0) - Math.min(15, r.name.length * 0.1);
      }
      if (score > 0) out.push({ item: r.it, score });
    }
    out.sort((a, b) => b.score - a.score || (b.item.priority || 0) - (a.item.priority || 0));
    return out.slice(0, limit).map((x) => x.item);
  };
}

// "m5.9", "M 5.9", "5.9" or "mag 5.9" means a magnitude. Returns the number or null.
export function parseMagnitudeQuery(q) {
  const m = /^(?:m|mag|magnitude)?\s*([0-9](?:\.[0-9])?)$/i.exec((q || "").trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v >= 1 && v <= 9.9 ? v : null;
}

// ---------- Packed satellite details ----------

export const OBJECT_TYPES = ["Satellite", "Rocket body", "Debris", "Unknown"];

// Days since 1957-10-04 (Sputnik 1) for an ISO date string, stored in 16 bits.
export function launchDayFromIso(iso) {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return 0;
  return Math.max(1, Math.round((t - Date.UTC(1957, 9, 4)) / 86400000) + 1);
}
export function launchDateFromDay(day) {
  if (!day) return null;
  return new Date(Date.UTC(1957, 9, 4) + (day - 1) * 86400000);
}
export function ageDays(day, nowMs) {
  const d = launchDateFromDay(day);
  return d ? Math.floor((nowMs - d.getTime()) / 86400000) : null;
}

// Record layout, 8 bytes per object: owner u8, site u8, purpose u8, type u8, launchDay u16, status u8, reserved u8.
export function unpackDetails(buf, index) {
  const o = index * 8;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { owner: v.getUint8(o), site: v.getUint8(o + 1), purpose: v.getUint8(o + 2), type: v.getUint8(o + 3), launchDay: v.getUint16(o + 4, true), status: v.getUint8(o + 6) };
}

// =====================================================================
// Version 2, part 2: scene helpers
// =====================================================================

// Inertial position in km (before the Earth's rotation is applied) of a swarm object at time tMs.
export function swarmPositionEci(s, tMs) {
  const dt = (tMs - s.epochMs) / 60000;
  const M = s.ma + s.n * dt;
  const raan = s.raan + s.raanDot * dt;
  const argp = s.argp + s.argpDot * dt;
  let E = M;
  for (let k = 0; k < 5; k++) E = E - (E - s.e * Math.sin(E) - M) / (1 - s.e * Math.cos(E));
  const xp = s.a * (Math.cos(E) - s.e);
  const yp = s.a * Math.sqrt(1 - s.e * s.e) * Math.sin(E);
  const cO = Math.cos(raan), sO = Math.sin(raan), cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(s.i), si = Math.sin(s.i);
  return {
    x: (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp,
    y: (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp,
    z: sw * si * xp + cw * si * yp,
  };
}

// Same result as swarmPositionEcef but takes a precomputed GMST (radians), so thousands of objects can share it.
export function swarmPositionFast(s, tMs, gmstRad) {
  const p = swarmPositionEci(s, tMs);
  const c = Math.cos(gmstRad), sn = Math.sin(gmstRad);
  return { x: p.x * c + p.y * sn, y: -p.x * sn + p.y * c, z: p.z };
}

// Unit vector for a place in the scene frame used by the 3D views: +X through lon 0, +Y north, -Z through lon 90 E.
export function latLonToUnit(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return { x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: -Math.cos(la) * Math.sin(lo) };
}

export function centralAngleRad(lat1, lon1, lat2, lon2) {
  return haversineKm(lat1, lon1, lat2, lon2) / EARTH_RADIUS_KM;
}

// Orthonormal frame of the plane through the Earth's centre, an epicentre Q and a viewer U.
// x points at the epicentre, y points towards the viewer's side, n = x cross y is the plane normal.
export function sliceBasis(qLat, qLon, uLat, uLon) {
  const q = latLonToUnit(qLat, qLon);
  const u = latLonToUnit(uLat, uLon);
  const dot = q.x * u.x + q.y * u.y + q.z * u.z;
  let y = { x: u.x - dot * q.x, y: u.y - dot * q.y, z: u.z - dot * q.z };
  let len = Math.hypot(y.x, y.y, y.z);
  if (len < 1e-6) {
    // viewer is at (or opposite) the epicentre: any perpendicular will do, prefer one towards north
    y = { x: -q.x * q.y, y: 1 - q.y * q.y, z: -q.z * q.y };
    len = Math.hypot(y.x, y.y, y.z);
    if (len < 1e-6) { y = { x: 1, y: 0, z: 0 }; len = 1; }
  }
  y = { x: y.x / len, y: y.y / len, z: y.z / len };
  const n = { x: q.y * y.z - q.z * y.y, y: q.z * y.x - q.x * y.z, z: q.x * y.y - q.y * y.x };
  return { x: q, y, n, theta: Math.acos(clamp(dot, -1, 1)) };
}

// Approximate launch site positions (degrees), rounded to 0.1 degree, keyed by the CelesTrak launch site code.
// Written from public knowledge of the sites, not from a data feed: verify against an authoritative list
// before publishing. Sea launch areas and airspace codes are deliberately left out.
export const LAUNCH_SITES = {
  AFETR: [28.5, -80.6], AFWTR: [34.7, -120.6], ANDSP: [69.3, 16.0], DLS: [51.1, 59.8], FRGUI: [5.2, -52.8],
  JSC: [41.0, 100.3], KODAK: [57.4, -152.3], KSCUT: [31.3, 131.1], NSC: [34.4, 127.5], PLMSC: [62.9, 40.6],
  RLLB: [-39.3, 177.9], SEMLS: [35.2, 53.9], SRILR: [13.7, 80.2], STARB: [26.0, -97.2], TAISC: [38.8, 111.6],
  TANSC: [30.4, 131.0], TYMSC: [46.0, 63.3], VOSTO: [51.9, 128.3], WLPIS: [37.9, -75.5], WSC: [19.6, 111.0],
  XICLF: [28.2, 102.0], YUN: [39.7, 124.7],
};

// Owner and site indices in the packed details are 1-based; 0 means "not known".
export function tableName(table, index) {
  return index > 0 && index <= table.length ? table[index - 1] : null;
}

// ---------- Sky frame ----------

// How the scene frame of the star sphere (x toward the vernal equinox, y toward the north celestial pole,
// -z toward RA 90 degrees) maps into the observer's horizon frame (+x east, +y up, -z north).
// Returns the images of the three scene axes as {x, y, z} vectors; they form a rotation matrix by columns.
export function equatorialToHorizonBasis(latDeg, lonDeg, date) {
  const toVec = (ra, dec) => { const h = raDecToAltAz(ra, dec, latDeg, lonDeg, date); return altAzToVector(h.alt, h.az); };
  const ex = toVec(0, 0);
  const ey = toVec(0, 90);
  const r90 = toVec(90, 0);
  return { x: ex, y: ey, z: { x: -r90.x, y: -r90.y, z: -r90.z } };
}

// Horizon-frame unit vector of a star from RA/Dec using the basis above (what the GPU does).
export function applyBasis(basis, ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  const sx = Math.cos(d) * Math.cos(a), sy = Math.sin(d), sz = -Math.cos(d) * Math.sin(a);
  return { x: basis.x.x * sx + basis.y.x * sy + basis.z.x * sz, y: basis.x.y * sx + basis.y.y * sy + basis.z.y * sz, z: basis.x.z * sx + basis.y.z * sy + basis.z.z * sz };
}

// Sky colours by Sun altitude (degrees). Piecewise linear between hand-picked keyframes.
const SKY_KEYS = [
  { alt: -18, zenith: [0.004, 0.008, 0.02], horizon: [0.02, 0.03, 0.07], glow: [0.6, 0.4, 0.3], glowAmt: 0 },
  { alt: -12, zenith: [0.015, 0.03, 0.09], horizon: [0.12, 0.14, 0.28], glow: [0.9, 0.5, 0.4], glowAmt: 0.12 },
  { alt: -6, zenith: [0.05, 0.09, 0.22], horizon: [0.55, 0.35, 0.42], glow: [1.0, 0.55, 0.35], glowAmt: 0.45 },
  { alt: 0, zenith: [0.12, 0.22, 0.48], horizon: [1.0, 0.62, 0.35], glow: [1.0, 0.7, 0.4], glowAmt: 0.8 },
  { alt: 6, zenith: [0.2, 0.38, 0.72], horizon: [0.85, 0.8, 0.72], glow: [1.0, 0.85, 0.6], glowAmt: 0.9 },
  { alt: 25, zenith: [0.18, 0.4, 0.82], horizon: [0.62, 0.78, 0.95], glow: [1.0, 0.95, 0.8], glowAmt: 0.9 },
];
export function skyColors(sunAltDeg) {
  const a = clamp(sunAltDeg, SKY_KEYS[0].alt, SKY_KEYS[SKY_KEYS.length - 1].alt);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && a > SKY_KEYS[i + 1].alt) i++;
  const k0 = SKY_KEYS[i], k1 = SKY_KEYS[i + 1];
  const t = (a - k0.alt) / (k1.alt - k0.alt);
  const mix = (p, q) => p.map((v, j) => v + (q[j] - v) * t);
  return { zenith: mix(k0.zenith, k1.zenith), horizon: mix(k0.horizon, k1.horizon), glow: mix(k0.glow, k1.glow), glowAmt: k0.glowAmt + (k1.glowAmt - k0.glowAmt) * t };
}

// Faintest star (magnitude) visible to the eye given the Sun altitude and the sky glow from lights (0..1).
// Rough model: stars start to appear when the Sun is a few degrees below the horizon and the sky is
// fully dark at about -18; light pollution removes up to about 3 magnitudes. Not a measured model.
export function limitingMagnitude(sunAltDeg, lightGlow = 0, moonUp = 0) {
  const dark = clamp((-sunAltDeg - 1.5) / 16.5, 0, 1);
  const base = 0.5 + 6.0 * dark;
  return clamp(base - 3.0 * clamp(lightGlow, 0, 1) * dark - 1.2 * clamp(moonUp, 0, 1) * dark, 0, 6.5);
}

// ---------- Swarm look angles, passes, aurora grid ----------

// Elevation, azimuth and sunlit flag of a swarm object seen from an observer (fast two-body model, approximate).
export function swarmLook(s, date, obsLat, obsLon) {
  const t = date.getTime();
  const p = swarmPositionFast(s, t, gmstDeg(date) * DEG);
  const look = ecefLook(obsLat, obsLon, p);
  const eci = swarmPositionEci(s, t);
  return { el: look.el, az: look.az, sunlit: isSunlit(eci, sunUnitVectorEci(date)), rangeKm: Math.hypot(p.x - observerEcef(obsLat, obsLon).x, p.y - observerEcef(obsLat, obsLon).y, p.z - observerEcef(obsLat, obsLon).z) };
}

// Strongest aurora probability near a place, from the packed NOAA grid (u8, 360 columns of longitude 0..359,
// 181 rows of latitude -90..90, row 0 at -90). Probability is reduced linearly with distance so a faint
// oval 900 km away counts for less than one overhead. A rough "could I see it from here" figure.
export function auroraFromGrid(u8, lat, lon, maxKm = 900) {
  const dLat = Math.ceil(maxKm / 111.2);
  let best = 0, at = null;
  for (let la = Math.max(-90, Math.floor(lat) - dLat); la <= Math.min(90, Math.ceil(lat) + dLat); la++) {
    const dLonDeg = Math.min(180, maxKm / (111.2 * Math.max(0.05, Math.cos(la * DEG))));
    for (let k = -Math.ceil(dLonDeg); k <= Math.ceil(dLonDeg); k++) {
      const lo = Math.floor(lon) + k;
      const p = u8[(la + 90) * 360 + (((lo % 360) + 360) % 360)];
      if (!p) continue;
      const d = haversineKm(lat, lon, la, norm180(lo));
      if (d > maxKm) continue;
      const v = p * (1 - d / (maxKm * 1.25));
      if (v > best) { best = v; at = { lat: la, lon: norm180(lo), prob: p, distKm: d }; }
    }
  }
  const here = u8[(Math.round(clamp(lat, -90, 90)) + 90) * 360 + ((Math.round(lon) % 360) + 360) % 360];
  return { chance: Math.round(best), at, here };
}
