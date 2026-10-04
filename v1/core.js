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
