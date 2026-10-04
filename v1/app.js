// Radar Around You: visual prototype. Browser-only code. Pure maths lives in core.js (inlined above).
window.__radarStarted = true;

const SNAP = JSON.parse(document.getElementById("snapshot").textContent);
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PLANE_LOOP_SEC = 180;
const QUAKE_RADIUS_KM = 3000;

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const safeStore = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- State ----------
const state = {
  city: SNAP.cities[0],
  lens: "arrival",
  tonightMin: 0,
  quality: safeStore.get("radar.quality", "auto"),
  follows: new Set(safeStore.get("radar.follows", [])),
  loadT: performance.now(),
  selected: null,
  replay: null,
  downloads: null,
  layers: { sats: true, starlink: true, debris: true, events: true, aurora: true },
};
const savedCity = safeStore.get("radar.city", null);
if (savedCity) state.city = SNAP.cities.find((c) => c.id === savedCity) || state.city;

// ---------- Formatting ----------
const fmt = (opts) => (d, tz) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).format(d);
const fmtTime = fmt({ hour: "2-digit", minute: "2-digit" });
const fmtDayTime = fmt({ weekday: "short", hour: "2-digit", minute: "2-digit" });
const fmtDate = fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtUtc = (d) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d) + " UTC";
const kmText = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-GB")) + " km";
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---------- Satellites ----------
const SATS = SNAP.satellites
  .map((o) => {
    let rec = null;
    try { rec = satellite.json2satrec(o); } catch { rec = null; }
    return { id: o.NORAD_CAT_ID, name: o.label || titleCase(o.OBJECT_NAME), isISS: o.label === "ISS", isStation: !!o.label, rec, trail: [] };
  })
  .filter((s) => s.rec);
const ISS = SATS.find((s) => s.isISS);

// ---------- The swarm: every active satellite plus major debris fields ----------
function b64ToArray(b64, T) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new T(bytes.buffer);
}
const SWARM = decodeSwarm(b64ToArray(SNAP.swarm.f32, Float32Array), b64ToArray(SNAP.swarm.u16, Uint16Array), SNAP.swarm.ref);
const SWARM_COLORS = ["#c8d6ff", "#73ccff", "#9fb3ff", "#ff9a70", "#ffffff"];
// Full scan every few seconds finds objects near or above the horizon; those are then updated often.
const swarmSky = { scanT: 0, cityId: null, cand: [], updT: 0, above: 0, aboveDebris: 0 };
function swarmUpdate(now, city) {
  const t = now.getTime();
  if (swarmSky.cityId !== city.id || t - swarmSky.scanT > 3000) {
    const cand = [];
    for (const s of SWARM) {
      if (s.a > 4.5 * 6378) continue;
      const look = ecefLook(city.lat, city.lon, swarmPositionEcef(s, now));
      if (look.el > -4) cand.push({ s, el: look.el, az: look.az });
    }
    swarmSky.cand = cand;
    swarmSky.scanT = t;
    swarmSky.cityId = city.id;
    swarmSky.updT = t;
  } else if (t - swarmSky.updT > 200) {
    for (const c of swarmSky.cand) {
      const look = ecefLook(city.lat, city.lon, swarmPositionEcef(c.s, now));
      c.el = look.el;
      c.az = look.az;
    }
    swarmSky.updT = t;
  }
  let above = 0;
  let deb = 0;
  for (const c of swarmSky.cand) if (c.el >= 10) { if (c.s.type === 3) deb++; else above++; }
  swarmSky.above = above;
  swarmSky.aboveDebris = deb;
  return swarmSky;
}

function satState(s, date, city) {
  const pv = satellite.propagate(s.rec, date);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const obs = { latitude: city.lat * DEG, longitude: city.lon * DEG, height: 0.05 };
  const look = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
  return {
    eci: pv.position,
    lat: geo.latitude / DEG,
    lon: geo.longitude / DEG,
    hKm: geo.height,
    el: look.elevation / DEG,
    az: look.azimuth / DEG,
    sunlit: isSunlit(pv.position, sunUnitVectorEci(date)),
  };
}

let satCache = { t: 0, list: [], cityId: null };
function satsNow(date, city) {
  if (Math.abs(date - satCache.t) < 250 && satCache.cityId === city.id) return satCache.list;
  const list = [];
  for (const s of SATS) {
    const st = satState(s, date, city);
    if (st) list.push({ s, ...st });
  }
  satCache = { t: date.getTime(), list, cityId: city.id };
  return list;
}

function computePasses(city) {
  if (!ISS) return [];
  const lookFn = (d) => {
    const st = satState(ISS, d, city);
    return st ? { el: st.el, az: st.az, sunlit: st.sunlit } : { el: -90, az: 0, sunlit: false };
  };
  const start = new Date(Date.now() - 8 * 60000);
  return findPasses(lookFn, (d) => sunAltAz(city.lat, city.lon, d).alt, start, 30, { stepSec: 20, minEl: 10 });
}

// ---------- Sky bodies (Sun, Moon, planets) ----------
const BODIES = [
  ["Sun", "Sun", "#ffe9a8"], ["Moon", "Moon", "#f1eee4"], ["Mercury", "Mercury", "#d8cbb8"], ["Venus", "Venus", "#fff5d6"],
  ["Mars", "Mars", "#ff9f7a"], ["Jupiter", "Jupiter", "#f4e3c4"], ["Saturn", "Saturn", "#efd9a0"],
];
const bodyCache = new Map();
function bodiesAt(date, city) {
  const key = city.id + ":" + Math.floor(date.getTime() / 20000);
  if (bodyCache.has(key)) return bodyCache.get(key);
  const obs = new Astro.Observer(city.lat, city.lon, 0);
  const out = {};
  for (const [name, bodyName, color] of BODIES) {
    const body = Astro.Body[bodyName];
    const eq = Astro.Equator(body, date, obs, true, true);
    const hz = Astro.Horizon(date, obs, eq.ra, eq.dec, "normal");
    let mag = null;
    try { mag = Astro.Illumination(body, date).mag; } catch { mag = null; }
    out[name] = { name, alt: hz.altitude, az: hz.azimuth, mag, color };
  }
  out.Moon.frac = Astro.Illumination(Astro.Body.Moon, date).phase_fraction;
  out.Moon.phase = Astro.MoonPhase(date);
  if (bodyCache.size > 400) bodyCache.clear();
  bodyCache.set(key, out);
  return out;
}

// ---------- Stars ----------
const STARS = SNAP.stars.map(([ra, dec, mag, bv, name]) => ({ ra, dec, mag, name, color: bv < 0 ? "#b4c6ff" : bv < 0.45 ? "#eef2ff" : bv < 0.95 ? "#fff1d8" : "#ffd6a6" }));
let starCache = { key: "", stars: [], lines: [] };
function starsAt(date, city) {
  const key = city.id + ":" + Math.floor(date.getTime() / 4000);
  if (starCache.key === key) return starCache;
  const stars = STARS.map((s) => ({ ...s, ...raDecToAltAz(s.ra, s.dec, city.lat, city.lon, date) }));
  const lines = SNAP.constellations.map((line) => line.map(([ra, dec]) => raDecToAltAz(ra, dec, city.lat, city.lon, date)));
  starCache = { key, stars, lines };
  return starCache;
}

// ---------- Aircraft ----------
function planeLoop() {
  const t = ((performance.now() - state.loadT) / 1000) % PLANE_LOOP_SEC;
  return { t, alpha: REDUCE_MOTION ? 1 : Math.min(1, t / 3, (PLANE_LOOP_SEC - t) / 3) };
}
function planesNow(city) {
  const { t } = planeLoop();
  return city.planes.aircraft.map((p) => {
    const pos = extrapolatePlane(p, (REDUCE_MOTION ? 0 : t) + (p.age || 0));
    const look = lookAngle(city.lat, city.lon, pos.lat, pos.lon, p.altFt * 0.0003048);
    const ahead = extrapolatePlane(p, (REDUCE_MOTION ? 0 : t) + (p.age || 0) + 25);
    const lookAhead = lookAngle(city.lat, city.lon, ahead.lat, ahead.lon, p.altFt * 0.0003048);
    return { p, pos, ...look, ahead: lookAhead };
  });
}

// ---------- Earthquakes ----------
function quakesNear(city) {
  return SNAP.quakes.events
    .map((q) => ({ q, distKm: haversineKm(city.lat, city.lon, q.lat, q.lon), bearing: bearingDeg(city.lat, city.lon, q.lat, q.lon) }))
    .sort((a, b) => a.distKm - b.distKm);
}

// ---------- Aurora and Kp ----------
const latestKp = SNAP.kp[SNAP.kp.length - 1];
const auroraCache = new Map();
function auroraFor(city) {
  if (!auroraCache.has(city.id)) auroraCache.set(city.id, auroraChance(SNAP.aurora.points, city.lat, city.lon));
  return auroraCache.get(city.id);
}

// ---------- Meteor showers (approximate dates, from published shower calendars) ----------
const SHOWERS = [
  { name: "Quadrantids", start: [12, 28], end: [1, 12], peak: [1, 3], zhr: 80, ra: 230, dec: 49 },
  { name: "Lyrids", start: [4, 14], end: [4, 30], peak: [4, 22], zhr: 18, ra: 271, dec: 34 },
  { name: "Eta Aquariids", start: [4, 19], end: [5, 28], peak: [5, 6], zhr: 50, ra: 338, dec: -1 },
  { name: "Delta Aquariids", start: [7, 12], end: [8, 23], peak: [7, 30], zhr: 25, ra: 340, dec: -16 },
  { name: "Perseids", start: [7, 17], end: [8, 24], peak: [8, 12], zhr: 100, ra: 48, dec: 58 },
  { name: "Draconids", start: [10, 6], end: [10, 10], peak: [10, 8], zhr: 10, ra: 262, dec: 54 },
  { name: "Southern Taurids", start: [9, 10], end: [11, 20], peak: [10, 10], zhr: 5, ra: 32, dec: 9 },
  { name: "Orionids", start: [10, 2], end: [11, 7], peak: [10, 21], zhr: 20, ra: 95, dec: 16 },
  { name: "Leonids", start: [11, 6], end: [11, 30], peak: [11, 17], zhr: 15, ra: 152, dec: 22 },
  { name: "Geminids", start: [12, 4], end: [12, 20], peak: [12, 14], zhr: 150, ra: 112, dec: 33 },
];
function showersOn(date) {
  const md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  const active = [];
  const upcoming = [];
  for (const s of SHOWERS) {
    const a = s.start[0] * 100 + s.start[1];
    const b = s.end[0] * 100 + s.end[1];
    const inRange = a <= b ? md >= a && md <= b : md >= a || md <= b;
    if (inRange) active.push(s);
    const p = s.peak[0] * 100 + s.peak[1];
    if (p > md && p - md < 40) upcoming.push(s);
  }
  return { active, upcoming };
}
const monthName = (m) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];

// ---------- Tonight planner ----------
function cloudAt(city, date) {
  const hrs = city.clouds.hours;
  let best = null;
  for (const hr of hrs) {
    const dt = Math.abs(Date.parse(hr.t) - date.getTime());
    if (dt <= 90 * 60000 && (!best || dt < best.dt)) best = { dt, cloud: hr.cloud };
  }
  return best ? best.cloud : null;
}
function tonightPlan(city) {
  const now = new Date();
  const start = new Date(Math.ceil(now.getTime() / 3600000) * 3600000);
  const aur = auroraFor(city).chance;
  const hours = [];
  for (let i = 0; i < 13; i++) {
    const t = new Date(start.getTime() + i * 3600000);
    const b = bodiesAt(t, city);
    const cloud = cloudAt(city, t);
    hours.push({ t, sunAlt: sunAltAz(city.lat, city.lon, t).alt, moonAlt: b.Moon.alt, moonFrac: b.Moon.frac, cloud: cloud ?? 50, cloudKnown: cloud != null, aurora: aur });
  }
  return { ...bestWindow(hours), hours };
}

// ---------- Downloads capability (Share my sky) ----------
if (window.claude && typeof window.claude.use === "function") {
  window.claude.use("downloads").then((d) => { state.downloads = d; renderCard(); }).catch(() => {});
}

// =====================================================================
// Globe (three.js)
// =====================================================================
const TEX = { day: "__TEX_DAY__", night: "__TEX_NIGHT__" };
function latLonToVec(lat, lon, r) {
  const la = lat * DEG;
  const lo = lon * DEG;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}
function tier() {
  if (state.quality !== "auto") return state.quality;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (cores >= 8 && mem >= 6) return "high";
  if (cores <= 4 && mem <= 2) return "low";
  return "medium";
}
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, { high: 2, medium: 1.5, low: 1 }[tier()]);

const G = { ok: false };
function initGlobe() {
  const canvas = $("globe");
  try {
    G.renderer = new THREE.WebGLRenderer({ canvas, antialias: tier() !== "low", preserveDrawingBuffer: true, powerPreference: "high-performance" });
  } catch {
    G.ok = false;
    return;
  }
  G.ok = true;
  G.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  G.renderer.setClearColor(0x04060c, 1);
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  G.view = { lat: state.city.lat * 0.3, lon: state.city.lon - 75, dist: 6.6 };
  G.vel = { lat: 0, lon: 0 };
  G.time = { value: 0 };

  const loader = new THREE.TextureLoader();
  const dayTex = loader.load(TEX.day);
  const nightTex = loader.load(TEX.night);
  for (const t of [dayTex, nightTex]) { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; }
  const seg = tier() === "low" ? [64, 40] : [128, 80];
  G.sunDir = { value: new THREE.Vector3(1, 0, 0) };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, seg[0], seg[1]),
    new THREE.ShaderMaterial({
      uniforms: { dayTex: { value: dayTex }, nightTex: { value: nightTex }, sunDir: G.sunDir },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vViewN;
        void main(){ vUv = uv; vN = normalize(position); vViewN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D dayTex; uniform sampler2D nightTex; uniform vec3 sunDir;
        varying vec2 vUv; varying vec3 vN; varying vec3 vViewN;
        void main(){
          float d = dot(normalize(vN), normalize(sunDir));
          float dayMix = smoothstep(-0.10, 0.20, d);
          vec3 day = texture2D(dayTex, vUv).rgb * vec3(0.72, 0.78, 0.9);
          vec3 night = texture2D(nightTex, vUv).rgb;
          night = pow(night, vec3(1.35)) * vec3(1.35, 1.05, 0.72) * 1.7 + vec3(0.006, 0.010, 0.024);
          vec3 col = mix(night, day, dayMix);
          float dusk = smoothstep(-0.22, 0.0, d) * (1.0 - smoothstep(0.0, 0.22, d));
          col += vec3(0.95, 0.48, 0.22) * dusk * 0.10;
          float rim = pow(1.0 - max(dot(normalize(vViewN), vec3(0.0,0.0,1.0)), 0.0), 3.0);
          col += vec3(0.32, 0.56, 1.0) * rim * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  G.scene.add(earth);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.075, 64, 40),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vN; void main(){ float i = pow(max(0.68 - dot(vN, vec3(0.0,0.0,1.0)), 0.0), 3.2); gl_FragColor = vec4(vec3(0.38,0.62,1.0) * i * 1.6, i); }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }),
  );
  G.scene.add(atmo);

  // Background stars in their true positions for the moment the page opened.
  {
    const gmst = gmstDeg(new Date());
    const pos = [];
    const col = [];
    const size = [];
    for (const s of STARS) {
      const lon = norm180(s.ra - gmst);
      const v = latLonToVec(s.dec, lon, 60);
      pos.push(v.x, v.y, v.z);
      const c = new THREE.Color(s.color);
      col.push(c.r, c.g, c.b);
      size.push(Math.max(1.2, 4.2 - s.mag * 0.7));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    G.stars = new THREE.Points(geo, pointMaterial(`gl_PointSize = size * pr;`, `float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vColor * a, a);`));
    G.scene.add(G.stars);
  }

  // Aurora oval from NOAA OVATION (snapshot).
  {
    const pos = [];
    const prob = [];
    for (const [lon, lat, p] of SNAP.aurora.points) {
      if (p < 3) continue;
      const v = latLonToVec(lat, lon > 180 ? lon - 360 : lon, 1.012);
      pos.push(v.x, v.y, v.z);
      prob.push(p);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("prob", new THREE.Float32BufferAttribute(prob, 1));
    G.aurora = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { time: G.time, pr: { value: pixelRatio() } },
        vertexShader: `attribute float prob; uniform float time; uniform float pr; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = (3.0 + prob * 0.07) * pr * (2.6 / -mv.z);
            vA = prob / 100.0 * (0.55 + 0.45 * sin(time * 1.6 + position.x * 11.0 + position.z * 9.0));
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
            float a = vA * (1.0 - d * 2.0) * 0.9; vec3 c = mix(vec3(0.30, 1.0, 0.62), vec3(0.78, 0.50, 1.0), smoothstep(0.35, 0.85, vA));
            gl_FragColor = vec4(c * a, a); }`,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }),
    );
    G.scene.add(G.aurora);
  }

  // World events (GDACS) and earthquakes (USGS).
  {
    const items = [];
    for (const e of SNAP.events) {
      if (e.type === "EQ") continue;
      const kind = { WF: 0, TC: 1, FL: 2, VO: 4, DR: 2 }[e.type] ?? 2;
      items.push({ kind, lat: e.lat, lon: e.lon, size: e.type === "TC" ? 46 : e.type === "WF" ? 14 : 22, ref: { kind: "event", e } });
    }
    for (const q of SNAP.quakes.events) {
      if (q.mag < 4) continue;
      items.push({ kind: 3, lat: q.lat, lon: q.lon, size: 16 + (q.mag - 4) * 12, ref: { kind: "quake", q } });
    }
    G.items = items;
    const pos = [];
    const kind = [];
    const size = [];
    const phase = [];
    items.forEach((it, i) => {
      const v = latLonToVec(it.lat, it.lon, 1.006);
      it.v = v;
      pos.push(v.x, v.y, v.z);
      kind.push(it.kind);
      size.push(it.size);
      phase.push((i * 0.6180339) % 1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("kind", new THREE.Float32BufferAttribute(kind, 1));
    geo.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1));
    G.events = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { time: G.time, pr: { value: pixelRatio() } },
        vertexShader: `attribute float kind; attribute float size; attribute float phase; uniform float pr;
          varying float vKind; varying float vPhase;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vKind = kind; vPhase = phase;
            gl_PointSize = size * pr * clamp(3.4 / -mv.z, 0.75, 1.5); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float time; varying float vKind; varying float vPhase;
          void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
            vec3 c; float a;
            if (vKind < 0.5) { c = vec3(1.0, 0.62, 0.34); a = smoothstep(0.5, 0.05, d) * (0.65 + 0.35 * sin(time * 6.0 + vPhase * 40.0)); }
            else if (vKind < 1.5) { float ang = atan(p.y, p.x); float arms = 0.5 + 0.5 * sin(ang * 2.0 + d * 22.0 - time * 2.4);
              c = vec3(0.68, 0.86, 1.0); a = smoothstep(0.5, 0.08, d) * (0.25 + 0.75 * arms) + smoothstep(0.08, 0.0, d); }
            else if (vKind < 2.5) { c = vec3(0.45, 0.68, 1.0); a = smoothstep(0.5, 0.0, d) * (0.6 + 0.3 * sin(time * 1.5 + vPhase * 10.0)); }
            else { float r = fract(time * 0.33 + vPhase) * 0.5; c = vec3(1.0, 0.72, 0.43);
              a = smoothstep(0.045, 0.0, abs(d - r)) * (1.0 - r * 2.0) + smoothstep(0.09, 0.0, d); }
            gl_FragColor = vec4(c * a, a); }`,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }),
    );
    G.scene.add(G.events);
  }

  // The swarm: positions are computed on the graphics chip from orbital elements every frame.
  {
    const n = SWARM.length;
    const el1 = new Float32Array(n * 4);
    const el2 = new Float32Array(n * 4);
    const el3 = new Float32Array(n * 3);
    SWARM.forEach((s, k) => {
      el1.set([(s.epochMs - SNAP.swarm.ref) / 60000, s.n, s.e, s.i], k * 4);
      el2.set([s.raan, s.argp, s.ma, s.type], k * 4);
      el3.set([s.a / 6371, s.raanDot, s.argpDot], k * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("el1", new THREE.Float32BufferAttribute(el1, 4));
    geo.setAttribute("el2", new THREE.Float32BufferAttribute(el2, 4));
    geo.setAttribute("el3", new THREE.Float32BufferAttribute(el3, 3));
    G.swarmU = { tMin: { value: 0 }, gmst: { value: 0 }, obs: { value: new THREE.Vector3(1, 0, 0) }, show: { value: new THREE.Vector4(1, 1, 1, 1) }, pr: { value: pixelRatio() }, time: G.time };
    G.swarm = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: G.swarmU,
      vertexShader: `attribute vec4 el1; attribute vec4 el2; attribute vec3 el3;
        uniform float tMin; uniform float gmst; uniform vec3 obs; uniform vec4 show; uniform float pr;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float dt = tMin - el1.x;
          float e = el1.z;
          float M = mod(el2.z + el1.y * dt, 6.28318530718);
          float raan = el2.x + el3.y * dt;
          float argp = el2.y + el3.z * dt;
          float E = M;
          for (int k = 0; k < 5; k++) { E = E - (E - e * sin(E) - M) / (1.0 - e * cos(E)); }
          float xp = el3.x * (cos(E) - e);
          float yp = el3.x * sqrt(1.0 - e * e) * sin(E);
          float cO = cos(raan), sO = sin(raan), cw = cos(argp), sw = sin(argp), ci = cos(el1.w), si = sin(el1.w);
          float x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
          float y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
          float z = sw * si * xp + cw * si * yp;
          float ex = x * cos(gmst) + y * sin(gmst);
          float ey = -x * sin(gmst) + y * cos(gmst);
          vec3 p = vec3(ex, z, -ey);
          float t = el2.w;
          float vis = t < 0.5 ? show.x : t < 1.5 ? show.y : t < 2.5 ? show.x : t < 3.5 ? show.z : 1.0;
          vis *= step(el3.x, 4.5);
          vec3 d = p - obs;
          float above = step(0.1736, dot(normalize(d), normalize(obs)));
          vec3 base = t < 0.5 ? vec3(0.80, 0.86, 1.0) : t < 1.5 ? vec3(0.42, 0.78, 1.0) : t < 2.5 ? vec3(0.62, 0.70, 1.0) : t < 3.5 ? vec3(1.0, 0.55, 0.40) : vec3(1.0);
          vColor = mix(base, vec3(0.50, 1.0, 0.84), above);
          vAlpha = vis * (t > 3.5 ? 1.0 : 0.62 + 0.38 * above);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = (t > 3.5 ? 6.0 : t > 2.5 ? 1.9 : 2.3) + above * 2.4;
          gl_PointSize = size * pr * clamp(6.0 / -mv.z, 0.7, 1.8) * vis;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * vAlpha; gl_FragColor = vec4(vColor * a, a); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    G.swarm.frustumCulled = false;
    G.scene.add(G.swarm);
    G.issPath = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7cd4ff, transparent: true, opacity: 0.55 }));
    G.scene.add(G.issPath);
  }

  // Glowing coastlines (Natural Earth 1:50m via world-atlas), brighter on the night side.
  {
    const c = b64ToArray(SNAP.coast.i16, Int16Array);
    const segs = [];
    let prev = null;
    for (let k = 0; k < c.length; k += 2) {
      if (c[k] === 32767) { prev = null; continue; }
      const v = latLonToVec(c[k] / 100, c[k + 1] / 100, 1.0016);
      if (prev) segs.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
      prev = v;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    G.coast = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
      uniforms: { sunDir: G.sunDir },
      vertexShader: `varying float vDay; uniform vec3 sunDir; void main(){ vDay = dot(normalize(position), normalize(sunDir)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vDay; void main(){ float a = mix(0.62, 0.16, smoothstep(-0.1, 0.25, vDay)); gl_FragColor = vec4(vec3(0.38, 0.80, 1.0) * a, a); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    G.scene.add(G.coast);
  }

  // Your beam: a cone of light over your place, roughly the patch of sky where satellites are above 10 degrees.
  {
    const H = 0.34;
    const geo = new THREE.CylinderGeometry(0.3, 0.006, H, 72, 1, true);
    geo.translate(0, H / 2, 0);
    G.beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { time: G.time },
      vertexShader: `varying float vH; varying float vAng; void main(){ vH = position.y / ${H.toFixed(2)}; vAng = atan(position.z, position.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float time; varying float vH; varying float vAng;
        void main(){
          float fade = 1.0 - vH;
          float rings = smoothstep(0.045, 0.0, abs(fract(vH * 3.0 - time * 0.45) - 0.5)) * 0.55;
          float sweep = smoothstep(0.08, 0.0, fract(vAng / 6.2831853 - time * 0.16)) * 0.45;
          float edge = pow(fade, 0.6);
          float a = edge * (0.55 + rings * 1.8 + sweep * 1.6);
          gl_FragColor = vec4(vec3(0.55, 1.0, 0.88) * a, a);
        }`,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    G.scene.add(G.beam);
    G.footprint = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7cf0d8, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    G.scene.add(G.footprint);
  }

  // The visitor's place.
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    G.you = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { time: G.time, pr: { value: pixelRatio() } },
        vertexShader: `uniform float pr; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 46.0 * pr * clamp(3.0 / -mv.z, 0.7, 1.3); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float time; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float r = fract(time * 0.5) * 0.5; float ring = smoothstep(0.04, 0.0, abs(d - r)) * (1.0 - r * 2.0);
          float core = smoothstep(0.07, 0.03, d); vec3 c = vec3(0.49, 0.83, 1.0); float a = max(ring, core);
          gl_FragColor = vec4(c * a, a); }`,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false,
      }),
    );
    G.scene.add(G.you);
  }
  placeYou();
  bindGlobeControls(canvas);
}

function pointMaterial(sizeLine, fragBody) {
  return new THREE.ShaderMaterial({
    uniforms: { pr: { value: pixelRatio() } },
    vertexShader: `attribute float size; attribute vec3 color; uniform float pr; varying vec3 vColor;
      void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); ${sizeLine} gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vColor; void main(){ ${fragBody} }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

function placeYou() {
  if (!G.ok) return;
  const c = state.city;
  const v = latLonToVec(c.lat, c.lon, 1.004);
  G.you.geometry.attributes.position.setXYZ(0, v.x, v.y, v.z);
  G.you.geometry.attributes.position.needsUpdate = true;
  const n = latLonToVec(c.lat, c.lon, 1).normalize();
  G.beam.position.copy(n);
  G.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const ring = [];
  for (let b = 0; b < 360; b += 4) { const p = destinationPoint(c.lat, c.lon, b, 1665); ring.push(latLonToVec(p.lat, p.lon, 1.003)); }
  G.footprint.geometry.dispose();
  G.footprint.geometry = new THREE.BufferGeometry().setFromPoints(ring);
  G.swarmU.obs.value.copy(latLonToVec(c.lat, c.lon, 1));
}

function updateIssPath() {
  if (!G.ok || !ISS) return;
  const pts = [];
  const now = Date.now();
  for (let m = -20; m <= 95; m += 1) {
    const st = satState(ISS, new Date(now + m * 60000), state.city);
    if (st) pts.push(latLonToVec(st.lat, st.lon, 1 + st.hKm / 6371));
  }
  G.issPath.geometry.dispose();
  G.issPath.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

// Camera distance that fits the whole Earth across the narrower screen side, with a little margin.
function worldDist() {
  const c = $("globe");
  const aspect = (c.clientWidth || 390) / (c.clientHeight || 844);
  const t = Math.tan((38 / 2) * DEG);
  if (aspect >= 0.9) return clamp(1.45 / t, 3.6, 6);
  return clamp(1.3 / (aspect * t), 2.6, 9);
}
let fly = null;
function flyTo(lat, lon, dist, ms, onDone) {
  if (!G.ok) { if (onDone) onDone(); return; }
  if (REDUCE_MOTION || ms <= 0) {
    Object.assign(G.view, { lat, lon, dist });
    fly = null;
    if (onDone) onDone();
    return;
  }
  const from = { ...G.view };
  const dLon = norm180(lon - from.lon);
  fly = { from, to: { lat, lon: from.lon + dLon, dist }, t0: performance.now(), ms, onDone };
}
// The home view: the whole Earth, seen from slightly south of the visitor so their beam stands out.
function heroView() {
  return { lat: clamp(state.city.lat - 24, -70, 70), lon: state.city.lon, dist: worldDist() };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function bindGlobeControls(canvas) {
  let drag = null;
  let pinch = null;
  const pts = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0 };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: G.view.dist };
    }
    fly = null;
    G.idleT = performance.now();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      G.view.dist = clamp(pinch.dist * (pinch.d / d), 1.45, 8);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.18 * (G.view.dist - 0.9);
    G.view.lon -= dx * k;
    G.view.lat = clamp(G.view.lat + dy * k, -80, 80);
    G.vel = { lon: -dx * k, lat: dy * k };
    G.idleT = performance.now();
  });
  const end = (e) => {
    if (drag && drag.moved < 6 && pts.size === 1) pickAt(e.clientX, e.clientY);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) drag = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    G.view.dist = clamp(G.view.dist * (1 + Math.sign(e.deltaY) * 0.08), 1.45, 8);
  }, { passive: false });
}

function pickAt(x, y) {
  if (state.lens !== "world" || !G.items) return;
  const rect = $("globe").getBoundingClientRect();
  const camDir = G.camera.position.clone().normalize();
  let best = null;
  for (const it of G.items) {
    if (it.v.clone().normalize().dot(camDir) < 0.15) continue;
    const p = it.v.clone().project(G.camera);
    const sx = rect.left + ((p.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - p.y) / 2) * rect.height;
    const d = Math.hypot(sx - x, sy - y);
    if (d < 30 && (!best || d < best.d)) best = { d, it };
  }
  state.selected = best ? best.it.ref : null;
  renderCard();
}

function renderGlobe(now, t) {
  if (!G.ok) return;
  const canvas = $("globe");
  const w = canvas.clientWidth;
  const hh = canvas.clientHeight;
  const pr = pixelRatio();
  if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(hh * pr)) {
    G.renderer.setPixelRatio(pr);
    G.renderer.setSize(w, hh, false);
    G.camera.aspect = w / hh;
  }
  // Shift the picture so the globe sits in the space between the headline and the card.
  const { top: ft } = freeArea(w, hh);
  const rPx = (hh / 2) / (G.view.dist * Math.tan(19 * DEG)) * 1.12;
  const portrait = w / hh < 0.9;
  const shift = state.lens === "world" && portrait ? Math.round(hh / 2 - (ft + 6 + rPx)) : 0;
  if (G.shift !== shift || G.camera.aspect !== w / hh) {
    G.shift = shift;
    G.camera.aspect = w / hh;
    if (shift) G.camera.setViewOffset(w, hh, 0, shift, w, hh); else G.camera.clearViewOffset();
    G.camera.updateProjectionMatrix();
  }
  G.time.value = REDUCE_MOTION ? 0 : t / 1000;
  const ss = subsolarPoint(now);
  G.sunDir.value.copy(latLonToVec(ss.lat, ss.lon, 1)).normalize();

  if (fly) {
    const k = clamp((performance.now() - fly.t0) / fly.ms, 0, 1);
    const e = ease(k);
    G.view.lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
    G.view.lon = fly.from.lon + (fly.to.lon - fly.from.lon) * e;
    G.view.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e;
    if (k >= 1) { const done = fly.onDone; fly = null; if (done) done(); }
  } else if (Math.abs(G.vel.lon) + Math.abs(G.vel.lat) > 0.001) {
    G.view.lon += G.vel.lon;
    G.view.lat = clamp(G.view.lat + G.vel.lat, -80, 80);
    G.vel.lon *= 0.93;
    G.vel.lat *= 0.93;
  } else if (!REDUCE_MOTION && state.lens === "world" && performance.now() - (G.idleT || 0) > 6000) {
    G.view.lon += 0.02;
  }
  const cp = latLonToVec(G.view.lat, G.view.lon, G.view.dist);
  G.camera.position.copy(cp);
  G.camera.up.set(0, 1, 0);
  G.camera.lookAt(0, 0, 0);

  const showWorld = state.lens === "world";
  G.you.visible = latLonToVec(state.city.lat, state.city.lon, 1).dot(cp.clone().normalize()) > 0.05;
  G.events.visible = showWorld && state.layers.events;
  G.issPath.visible = showWorld;

  G.swarmU.tMin.value = (now.getTime() - SNAP.swarm.ref) / 60000;
  G.swarmU.gmst.value = gmstDeg(now) * DEG;
  G.swarmU.show.value.set(state.layers.sats ? 1 : 0, state.layers.starlink ? 1 : 0, state.layers.debris ? 1 : 0, 1);
  G.aurora.visible = state.layers.aurora;
  const list = satsNow(now, state.city);
  G.renderer.render(G.scene, G.camera);
  updateGlobeLabels(list);
}

const labelEls = new Map();
function setLabel(id, text, x, y, show, cls = "") {
  let el = labelEls.get(id);
  if (!el) {
    el = h("div", { class: "tag " + cls });
    $("labels").append(el);
    labelEls.set(id, el);
  }
  if (!show) { el.hidden = true; return; }
  el.hidden = false;
  if (el.textContent !== text) el.textContent = text;
  el.style.left = x + "px";
  el.style.top = y + "px";
}
function hideLabels() { for (const el of labelEls.values()) el.hidden = true; }

function updateGlobeLabels(list) {
  if (state.lens !== "world" && state.lens !== "arrival") { hideLabels(); return; }
  const rect = $("globe").getBoundingClientRect();
  const camDir = G.camera.position.clone().normalize();
  const place = (v) => {
    const vis = v.clone().normalize().dot(camDir) > 0.12;
    const p = v.clone().project(G.camera);
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, vis };
  };
  const you = place(latLonToVec(state.city.lat, state.city.lon, 1.004));
  setLabel("you", `You · ${state.city.name}`, you.x, you.y, you.vis && state.lens !== "under", "you");
  const iss = list.find((x) => x.s.isISS);
  if (iss && state.lens === "world") {
    const p = place(latLonToVec(iss.lat, iss.lon, 1 + iss.hKm / 6371));
    setLabel("iss", `ISS · ${Math.round(iss.hKm)} km up`, p.x, p.y, p.vis);
  } else setLabel("iss", "", 0, 0, false);
  if (state.selected && state.lens === "world") {
    const s = state.selected.kind === "event" ? state.selected.e : state.selected.q;
    const p = place(latLonToVec(s.lat, s.lon, 1.006));
    setLabel("sel", state.selected.kind === "event" ? s.name : `M${s.mag.toFixed(1)}`, p.x, p.y, p.vis);
  } else setLabel("sel", "", 0, 0, false);
}

// 2D fallback when WebGL is not available.
const NIGHT_IMG = new Image();
NIGHT_IMG.src = TEX.night;
function renderWorld2D(ctx, w, hh) {
  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, w, hh);
  const mw = w;
  const mh = w / 2;
  const top = (hh - mh) / 2;
  if (NIGHT_IMG.complete) ctx.drawImage(NIGHT_IMG, 0, top, mw, mh);
  const toXY = (lat, lon) => ({ x: ((lon + 180) / 360) * mw, y: top + ((90 - lat) / 180) * mh });
  for (const e of SNAP.events) {
    if (e.type === "EQ") continue;
    const p = toXY(e.lat, e.lon);
    ctx.fillStyle = e.type === "WF" ? "#ff9e57" : e.type === "TC" ? "#a8d6ff" : "#6fa8ff";
    ctx.beginPath(); ctx.arc(p.x, p.y, e.type === "TC" ? 5 : 2.5, 0, Math.PI * 2); ctx.fill();
  }
  const y = toXY(state.city.lat, state.city.lon);
  ctx.strokeStyle = "#7cd4ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(y.x, y.y, 6, 0, Math.PI * 2); ctx.stroke();
}

// =====================================================================
// Sky dome, Under section and Guide me (2D canvas)
// =====================================================================
const sky = $("sky");
const sctx = sky.getContext("2d");
function sizeCanvas(canvas, ctx) {
  const pr = pixelRatio();
  const w = canvas.clientWidth;
  const hh = canvas.clientHeight;
  if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(hh * pr)) {
    canvas.width = Math.round(w * pr);
    canvas.height = Math.round(hh * pr);
  }
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  return { w, h: hh };
}
function freeArea(w, hh) {
  const top = Math.min(hh * 0.42, $("headline").getBoundingClientRect().bottom + 30);
  const bottom = Math.max(top + 160, $("card").getBoundingClientRect().top - 14);
  return { top, bottom };
}
function domeGeometry(w, hh) {
  const { top, bottom } = freeArea(w, hh);
  const r = Math.max(110, Math.min(w / 2 - 30, (bottom - top) / 2 - 8, 300));
  const cy = Math.max(top + r, (top + bottom) / 2);
  return { cx: w / 2, cy, r, bottom };
}

function skyGradient(ctx, cx, cy, r, sunAlt, sunAz) {
  let inner;
  let outer;
  if (sunAlt > 0) { inner = "#2d5f9e"; outer = "#86b6e4"; }
  else if (sunAlt > -6) { inner = "#16244e"; outer = "#4a4d7a"; }
  else if (sunAlt > -12) { inner = "#0c1534"; outer = "#1c2752"; }
  else if (sunAlt > -18) { inner = "#080e24"; outer = "#121b3d"; }
  else { inner = "#060a1a"; outer = "#0e1631"; }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  if (sunAlt > -14 && sunAlt < 4) {
    const p = projectSky(0, sunAz, cx, cy, r);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 0.9);
    const k = 1 - Math.abs(sunAlt + 4) / 12;
    glow.addColorStop(0, `rgba(255,150,90,${0.38 * k})`);
    glow.addColorStop(1, "rgba(255,150,90,0)");
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = glow; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); ctx.restore();
  }
}

function domeFrame(ctx, cx, cy, r) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(150,175,255,0.10)";
  ctx.setLineDash([2, 5]);
  for (const alt of [30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, (r * (90 - alt)) / 90, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(150,175,255,0.38)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  for (let az = 0; az < 360; az += 10) {
    const a = projectSky(0, az, cx, cy, r);
    const b = projectSky(az % 90 === 0 ? -5 : -2.5, az, cx, cy, r);
    ctx.strokeStyle = az % 90 === 0 ? "rgba(233,237,248,.7)" : "rgba(150,175,255,.35)";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.fillStyle = "#e9edf8";
  ctx.font = "600 12px 'Instrument Sans', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
    const p = projectSky(-10, az, cx, cy, r);
    ctx.fillText(label, p.x, p.y);
  }
  ctx.fillStyle = "rgba(149,161,194,.8)";
  ctx.font = "400 10px 'IBM Plex Mono', monospace";
  ctx.fillText("60°", cx + 4, cy - (r * 30) / 90 + 8);
  ctx.fillText("30°", cx + 4, cy - (r * 60) / 90 + 8);
}

function drawStars(ctx, cx, cy, r, date, sunAlt, t) {
  const dark = clamp((-sunAlt - 4) / 10, 0, 1);
  if (dark <= 0) return;
  const { stars, lines } = starsAt(date, state.city);
  ctx.strokeStyle = `rgba(150,175,255,${0.16 * dark})`;
  ctx.lineWidth = 0.8;
  for (const line of lines) {
    ctx.beginPath();
    let pen = false;
    for (const p of line) {
      if (p.alt < 0) { pen = false; continue; }
      const q = projectSky(p.alt, p.az, cx, cy, r);
      if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      pen = true;
    }
    ctx.stroke();
  }
  stars.forEach((s, i) => {
    if (s.alt < 0) return;
    const q = projectSky(s.alt, s.az, cx, cy, r);
    const tw = REDUCE_MOTION ? 1 : 0.82 + 0.18 * Math.sin(t * 0.0021 + i * 1.7);
    const rad = Math.max(0.55, 2.5 - s.mag * 0.42);
    ctx.globalAlpha = dark * tw * clamp(1.15 - s.mag * 0.17, 0.25, 1);
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill();
    if (s.name && s.alt > 8) {
      ctx.globalAlpha = dark * 0.75;
      ctx.fillStyle = "#95a1c2";
      ctx.font = "400 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      labels.place(ctx, s.name, q.x + 5, q.y - 5);
    }
  });
  ctx.globalAlpha = 1;
}

function drawMoon(ctx, x, y, rad, frac, phase) {
  ctx.save();
  ctx.fillStyle = "#1b2140";
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f3efe2";
  const waxing = phase < 180;
  ctx.beginPath();
  ctx.arc(x, y, rad, -Math.PI / 2, Math.PI / 2, !waxing);
  const k = Math.abs(1 - 2 * frac);
  ctx.ellipse(x, y, rad * k, rad, 0, Math.PI / 2, -Math.PI / 2, frac > 0.5 ? !waxing : waxing);
  ctx.fill();
  const g = ctx.createRadialGradient(x, y, rad, x, y, rad * 3.2);
  g.addColorStop(0, `rgba(243,239,226,${0.18 * frac + 0.04})`);
  g.addColorStop(1, "rgba(243,239,226,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, rad * 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBodies(ctx, cx, cy, r, date) {
  const b = bodiesAt(date, state.city);
  const label = (text, x, y, color) => {
    ctx.fillStyle = color;
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    labels.place(ctx, text, x + 9, y, { force: true });
  };
  if (b.Sun.alt > -1) {
    const p = projectSky(b.Sun.alt, b.Sun.az, cx, cy, r);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 34);
    g.addColorStop(0, "rgba(255,240,190,.95)");
    g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, Math.PI * 2); ctx.fill();
    label("Sun", p.x + 6, p.y, "#ffe9a8");
  }
  for (const name of ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]) {
    const o = b[name];
    if (o.alt < 0) continue;
    const p = projectSky(o.alt, o.az, cx, cy, r);
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
    label(name, p.x, p.y, o.color);
  }
  if (b.Moon.alt > -1) {
    const p = projectSky(b.Moon.alt, b.Moon.az, cx, cy, r);
    drawMoon(ctx, p.x, p.y, 9, b.Moon.frac, b.Moon.phase);
    label(`Moon ${Math.round(b.Moon.frac * 100)}%`, p.x + 4, p.y, "#f1eee4");
  }
  return b;
}

// Simple label placer: skips a label that would overlap one already drawn or leave the screen.
const labels = {
  boxes: [], w: 0, h: 0,
  reset(w, hh) { this.boxes.length = 0; this.w = w; this.h = hh; },
  place(ctx, text, x, y, opts = {}) {
    const tw = ctx.measureText(text).width;
    const hgt = 12;
    let lx = x;
    if (lx + tw > this.w - 6) lx = x - tw - 18;
    if (lx < 6) return false;
    const box = { x: lx - 2, y: y - hgt / 2 - 2, w: tw + 4, h: hgt + 4 };
    if (!opts.force && this.boxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) return false;
    this.boxes.push(box);
    ctx.fillText(text, lx, y);
    return true;
  },
};
const planeTrails = new Map();
let trailTick = 0;
function drawPlanes(ctx, cx, cy, r, sweepAng, t) {
  const planes = planesNow(state.city);
  const { alpha } = planeLoop();
  const sample = t - trailTick > 450;
  if (sample) trailTick = t;
  const named = [];
  let visible = 0;
  for (const pl of planes) {
    if (pl.el < 0) continue;
    visible++;
    const p = projectSky(pl.el, pl.az, cx, cy, r);
    const q = projectSky(Math.max(0, pl.ahead.el), pl.ahead.az, cx, cy, r);
    let trail = planeTrails.get(pl.p.hex);
    if (!trail) { trail = []; planeTrails.set(pl.p.hex, trail); }
    if (sample) { trail.push({ x: p.x, y: p.y }); if (trail.length > 14) trail.shift(); }
    if (trail.length > 1) {
      ctx.lineWidth = 1.2;
      for (let i = 1; i < trail.length; i++) {
        ctx.strokeStyle = `rgba(124,212,255,${(i / trail.length) * 0.35 * alpha})`;
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
    }
    let boost = 0;
    if (sweepAng != null) {
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const behind = (sweepAng - ang + Math.PI * 4) % (Math.PI * 2);
      boost = behind < 0.9 ? 1 - behind / 0.9 : 0;
    }
    const heading = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(heading);
    ctx.fillStyle = `rgba(${150 + 105 * boost},${220 + 35 * boost},255,${(0.75 + 0.25 * boost) * alpha})`;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4.2); ctx.lineTo(-2.6, 0); ctx.lineTo(-5, -4.2); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (pl.p.call) named.push({ pl, p });
  }
  named.sort((a, b) => a.pl.distKm - b.pl.distKm);
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let shown = 0;
  for (const { pl, p } of named) {
    if (shown >= 5) break;
    ctx.fillStyle = `rgba(233,237,248,${0.85 * alpha})`;
    if (labels.place(ctx, `${pl.p.call} ${Math.round(pl.p.altFt / 100) * 100} ft`, p.x + 9, p.y + 9)) shown++;
  }
  return { visible, total: planes.length };
}

function drawSatellites(ctx, cx, cy, r, date, sunAlt, t, opts = {}) {
  const list = satsNow(date, state.city);
  const dark = sunAlt < -6;
  const sample = opts.trails && t - (drawSatellites.last || 0) > 900;
  if (sample) drawSatellites.last = t;
  let up = 0;
  for (const st of list) {
    if (st.el < 0) { st.s.trail.length = 0; continue; }
    up++;
    const p = projectSky(st.el, st.az, cx, cy, r);
    if (sample) { st.s.trail.push({ x: p.x, y: p.y }); if (st.s.trail.length > 24) st.s.trail.shift(); }
    const lit = st.sunlit && dark;
    if (opts.trails && st.s.trail.length > 1) {
      ctx.strokeStyle = st.s.isISS ? "rgba(124,212,255,.55)" : "rgba(233,237,248,.18)";
      ctx.lineWidth = st.s.isISS ? 1.6 : 0.8;
      ctx.beginPath();
      st.s.trail.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    }
    if (st.s.isISS || st.s.isStation) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
      g.addColorStop(0, lit ? "rgba(124,212,255,.9)" : "rgba(124,212,255,.45)");
      g.addColorStop(1, "rgba(124,212,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e9f8ff";
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      labels.place(ctx, st.s.name, p.x + 10, p.y - 8, { force: true });
    } else {
      ctx.fillStyle = lit ? "rgba(240,246,255,.95)" : "rgba(200,212,240,.45)";
      ctx.beginPath(); ctx.arc(p.x, p.y, lit ? 1.9 : 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  return up;
}

let PASSES = [];
let passesCity = null;
function passesFor(city) {
  if (passesCity !== city.id) { PASSES = computePasses(city); passesCity = city.id; }
  const now = Date.now();
  const upcoming = PASSES.filter((p) => p.set.getTime() > now);
  return { next: upcoming[0] || null, nextVisible: upcoming.find((p) => p.visible) || null, all: upcoming };
}

function drawPassPath(ctx, cx, cy, r, pass) {
  if (!pass) return;
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = "rgba(124,212,255,.75)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  pass.track.forEach((s, i) => {
    const p = projectSky(s.el, s.az, cx, cy, r);
    if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  const first = pass.track[0];
  const last = pass.track[pass.track.length - 1];
  const a = projectSky(first.el, first.az, cx, cy, r);
  const z = projectSky(last.el, last.az, cx, cy, r);
  const m = projectSky(pass.max.el, pass.max.az, cx, cy, r);
  const prev = pass.track[Math.max(0, pass.track.length - 3)];
  const pp = projectSky(prev.el, prev.az, cx, cy, r);
  const ang = Math.atan2(z.y - pp.y, z.x - pp.x);
  ctx.fillStyle = "rgba(124,212,255,.9)";
  ctx.translate(z.x, z.y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, 4); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.restore();
  const pr = pixelRatio();
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.fillStyle = "#7cd4ff";
  ctx.font = "500 10.5px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText(`ISS ${fmtTime(pass.rise, state.city.tz)}`, a.x + 6, a.y - 10);
  ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillText(`peak ${Math.round(pass.max.el)}°`, m.x + 8, m.y + 12);
}

function drawSwarmDome(ctx, cx, cy, r, date) {
  const sw = swarmUpdate(date, state.city);
  for (const c of sw.cand) {
    if (c.el < 0) continue;
    if (c.s.type === 3 && !state.layers.debris) continue;
    const p = projectSky(c.el, c.az, cx, cy, r);
    ctx.fillStyle = SWARM_COLORS[c.s.type] || "#c8d6ff";
    ctx.globalAlpha = c.s.type === 3 ? 0.55 : 0.5;
    ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
}

function drawSweep(ctx, cx, cy, r, t) {
  if (REDUCE_MOTION || typeof ctx.createConicGradient !== "function") return null;
  const ang = ((t / 6500) % 1) * Math.PI * 2;
  const g = ctx.createConicGradient(ang - 0.9, cx, cy);
  g.addColorStop(0, "rgba(124,212,255,0)");
  g.addColorStop(0.14, "rgba(124,212,255,0.16)");
  g.addColorStop(0.1433, "rgba(124,212,255,0)");
  g.addColorStop(1, "rgba(124,212,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(124,212,255,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); ctx.stroke();
  return ang;
}

function drawAurora(ctx, cx, cy, r, t, chance, at) {
  if (!chance || !at) return;
  const az = bearingDeg(state.city.lat, state.city.lon, at.lat, at.lon);
  const strength = clamp(chance / 60, 0.15, 1);
  const top = 12 + 40 * strength;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const base = projectSky(6, az, cx, cy, r);
  const arc = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, r * 0.95);
  arc.addColorStop(0, `rgba(70,255,150,${0.30 * strength})`);
  arc.addColorStop(0.5, `rgba(70,255,150,${0.10 * strength})`);
  arc.addColorStop(1, "rgba(70,255,150,0)");
  ctx.fillStyle = arc;
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  for (let d = -55; d <= 55; d += 2.2) {
    const wobble = REDUCE_MOTION ? 0 : Math.sin(t * 0.0012 + d * 0.31) * 6 + Math.sin(t * 0.0021 + d * 0.13) * 4;
    const fade = 1 - Math.abs(d) / 60;
    const a = projectSky(0, az + d, cx, cy, r);
    const b = projectSky(clamp(top + wobble, 4, 70), az + d + wobble * 0.3, cx, cy, r);
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    const k = strength * fade * (REDUCE_MOTION ? 0.8 : 0.65 + 0.35 * Math.sin(t * 0.003 + d));
    g.addColorStop(0, `rgba(80,255,160,${0.55 * k})`);
    g.addColorStop(0.55, `rgba(120,255,190,${0.26 * k})`);
    g.addColorStop(1, `rgba(190,120,255,${0.16 * k})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

const meteors = [];
function drawShowers(ctx, cx, cy, r, date, sunAlt, t) {
  const { active } = showersOn(date);
  const dark = sunAlt < -12;
  for (const s of active) {
    const p = raDecToAltAz(s.ra, s.dec, state.city.lat, state.city.lon, date);
    if (p.alt < 0) continue;
    const q = projectSky(p.alt, p.az, cx, cy, r);
    ctx.strokeStyle = "rgba(147,239,198,.75)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(q.x + Math.cos(a) * 4, q.y + Math.sin(a) * 4); ctx.lineTo(q.x + Math.cos(a) * 9, q.y + Math.sin(a) * 9); ctx.stroke();
    }
    ctx.fillStyle = "#93efc6";
    ctx.font = "500 10.5px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    labels.place(ctx, s.name, q.x + 12, q.y + 2, { force: true });
    if (dark && !REDUCE_MOTION && Math.random() < 0.004 + s.zhr / 9000) {
      const ang = Math.random() * Math.PI * 2;
      const d0 = 20 + Math.random() * 60;
      meteors.push({ x: q.x + Math.cos(ang) * d0, y: q.y + Math.sin(ang) * d0, ang, len: 40 + Math.random() * 50, t0: t });
    }
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    const k = (t - m.t0) / 700;
    if (k > 1) { meteors.splice(i, 1); continue; }
    const head = m.len * k;
    const x1 = m.x + Math.cos(m.ang) * head;
    const y1 = m.y + Math.sin(m.ang) * head;
    const g = ctx.createLinearGradient(m.x, m.y, x1, y1);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, `rgba(255,255,255,${0.9 * (1 - k)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(x1, y1); ctx.stroke();
  }
}

function renderSky(now, t) {
  const { w, h: hh } = sizeCanvas(sky, sctx);
  sctx.clearRect(0, 0, w, hh);
  sctx.fillStyle = "#04060c";
  sctx.fillRect(0, 0, w, hh);
  if (state.lens === "under") return renderUnder(sctx, w, hh, now, t);
  if (!G.ok && (state.lens === "world" || state.lens === "arrival")) return renderWorld2D(sctx, w, hh);
  const date = state.lens === "tonight" ? new Date(now.getTime() + state.tonightMin * 60000) : now;
  const { cx, cy, r, bottom } = domeGeometry(w, hh);
  labels.reset(w, hh);
  const sun = sunAltAz(state.city.lat, state.city.lon, date);
  skyGradient(sctx, cx, cy, r, sun.alt, sun.az);
  sctx.save();
  sctx.beginPath(); sctx.arc(cx, cy, r, 0, Math.PI * 2); sctx.clip();
  drawStars(sctx, cx, cy, r, date, sun.alt, t);
  sctx.restore();
  domeFrame(sctx, cx, cy, r);
  if (state.lens === "tonight") {
    const a = auroraFor(state.city);
    drawAurora(sctx, cx, cy, r, t, a.chance, a.at);
    drawShowers(sctx, cx, cy, r, date, sun.alt, t);
    drawBodies(sctx, cx, cy, r, date);
    drawSatellites(sctx, cx, cy, r, date, sun.alt, t, { trails: false });
  } else {
    const sweep = drawSweep(sctx, cx, cy, r, t);
    drawSwarmDome(sctx, cx, cy, r, date);
    drawBodies(sctx, cx, cy, r, date);
    drawPassPath(sctx, cx, cy, r, passesFor(state.city).nextVisible || passesFor(state.city).next);
    const pc = drawPlanes(sctx, cx, cy, r, sweep, t);
    const up = drawSatellites(sctx, cx, cy, r, date, sun.alt, t, { trails: true });
    live.planes = pc.total;
    live.planesUp = pc.visible;
    live.sats = up;
  }
  if (cy + r + 30 < bottom + 10) {
    sctx.fillStyle = "rgba(149,161,194,.75)";
    sctx.font = "400 10.5px 'IBM Plex Mono', monospace";
    sctx.textAlign = "center";
    sctx.fillText("Looking straight up · north at the top", cx, cy + r + 30);
  }
}

// ---------- Under: the ground beneath you ----------
function renderUnder(ctx, w, hh, now, t) {
  const { top, bottom } = freeArea(w, hh);
  const W = Math.min(w - 36, 560);
  const x0 = (w - W) / 2;
  const cx = w / 2;
  const groundY = top + 40;
  const depthH = Math.max(120, bottom - groundY - 34);
  const kmX = (km) => cx + (km / QUAKE_RADIUS_KM) * (W / 2);
  const kmY = (km) => groundY + Math.sqrt(Math.max(0, km) / 700) * depthH;
  const bend = (x) => groundY + Math.pow((x - cx) / (W / 2), 2) * 10;
  const g = ctx.createLinearGradient(0, groundY, 0, groundY + depthH);
  g.addColorStop(0, "#3b2417");
  g.addColorStop(0.22, "#2b1812");
  g.addColorStop(0.6, "#1d0f0e");
  g.addColorStop(1, "#2a0f08");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, bend(x0));
  for (let x = x0; x <= x0 + W; x += 6) ctx.lineTo(x, bend(x));
  ctx.lineTo(x0 + W, groundY + depthH);
  ctx.lineTo(x0, groundY + depthH);
  ctx.closePath();
  ctx.fill();
  const heat = ctx.createRadialGradient(cx, groundY + depthH * 1.25, 0, cx, groundY + depthH * 1.25, depthH * 0.9);
  heat.addColorStop(0, "rgba(255,120,50,.22)");
  heat.addColorStop(1, "rgba(255,120,50,0)");
  ctx.fillStyle = heat;
  ctx.fillRect(x0, groundY, W, depthH);
  ctx.strokeStyle = "rgba(255,180,110,.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = x0; x <= x0 + W; x += 6) (x === x0 ? ctx.moveTo(x, bend(x)) : ctx.lineTo(x, bend(x)));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,180,110,.12)";
  ctx.setLineDash([3, 5]);
  ctx.font = "400 10px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(255,200,150,.6)";
  ctx.textAlign = "left";
  for (const d of [10, 35, 100, 300, 700]) {
    const y = kmY(d);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + W, y); ctx.stroke();
    ctx.fillText(d === 35 ? "35 km · crust" : `${d} km`, x0 + 4, y - 4);
  }
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(149,161,194,.8)";
  for (const km of [-3000, -2000, -1000, 1000, 2000, 3000]) {
    const x = kmX(km);
    ctx.fillText(`${Math.abs(km / 1000)}k km`, x, groundY - 12);
  }
  ctx.textAlign = "left";
  ctx.fillText("◂ west", x0, groundY - 30);
  ctx.textAlign = "right";
  ctx.fillText("east ▸", x0 + W, groundY - 30);
  ctx.textAlign = "center";

  const near = quakesNear(state.city).filter((x) => x.distKm <= QUAKE_RADIUS_KM);
  const nowMs = now.getTime();
  const span = 7 * 86400000;
  let cutoff = Infinity;
  if (state.replay) {
    const k = (performance.now() - state.replay.t0) / 9000;
    if (k >= 1) state.replay = null;
    else cutoff = nowMs - span + k * span;
    if (state.replay) {
      ctx.fillStyle = "#ffb46e";
      ctx.font = "500 12px 'IBM Plex Mono', monospace";
      ctx.fillText(`Replay · ${fmtDate(new Date(cutoff), state.city.tz)}`, cx, kmY(700) + 20);
    }
  }
  for (const x of near) {
    const qt = Date.parse(x.q.time);
    if (qt > cutoff) continue;
    const dx = Math.sin(x.bearing * DEG) * x.distKm;
    const px = kmX(dx);
    const py = kmY(Math.min(700, x.q.depth));
    const ageH = (nowMs - qt) / 3600000;
    const fresh = clamp(1 - ageH / 168, 0.3, 1);
    const rad = 2.5 + Math.max(0, x.q.mag - 2.5) * 2.4;
    ctx.strokeStyle = `rgba(255,180,110,${0.18 * fresh})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, bend(px)); ctx.lineTo(px, py); ctx.stroke();
    const glow = ctx.createRadialGradient(px, py, 0, px, py, rad * 3);
    glow.addColorStop(0, `rgba(255,190,120,${0.9 * fresh})`);
    glow.addColorStop(1, "rgba(255,150,80,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(px, py, rad * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,214,170,${fresh})`;
    ctx.beginPath(); ctx.arc(px, py, rad * 0.6, 0, Math.PI * 2); ctx.fill();
    if (!REDUCE_MOTION) {
      let local;
      if (state.replay) {
        const appearAt = state.replay.t0 + ((qt - (nowMs - span)) / span) * 9000;
        local = (performance.now() - appearAt) / 1600;
      } else {
        local = (t / 2600 + (qt % 997) / 997) % 1;
      }
      if (local >= 0 && local < 1) {
        ctx.strokeStyle = `rgba(255,190,120,${(1 - local) * 0.6 * fresh})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(px, py, rad + local * 26, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  // You
  ctx.fillStyle = "#ffb46e";
  ctx.beginPath(); ctx.moveTo(cx, groundY - 2); ctx.lineTo(cx - 6, groundY - 13); ctx.lineTo(cx + 6, groundY - 13); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e9edf8";
  ctx.font = "600 12px 'Instrument Sans', sans-serif";
  ctx.fillText(`You · ${state.city.name}`, cx, groundY - 30);
  if (!near.length) {
    ctx.fillStyle = "rgba(233,237,248,.8)";
    ctx.font = "400 12.5px 'Instrument Sans', sans-serif";
    ctx.fillText("No M2.5+ earthquakes within 3,000 km this week", cx, kmY(330));
  }
  live.quakesNear = near.length;
}

// ---------- Guide me ----------
let guide = null;
function openGuide(target) {
  const wrap = h("div", { class: "guide", role: "dialog", "aria-modal": "true", "aria-label": "Guide me" });
  const canvas = h("canvas", { "aria-hidden": "true" });
  const say = h("div", { class: "guide-say", "aria-live": "polite" });
  const close = h("button", { class: "chip", type: "button", text: "Close", onclick: closeGuide });
  const left = h("button", { class: "btn", type: "button", text: "Turn left", onclick: () => turn(-15) });
  const right = h("button", { class: "btn", type: "button", text: "Turn right", onclick: () => turn(15) });
  wrap.append(canvas, h("div", { class: "guide-top" }, say, close), h("div", { class: "guide-bottom" }, left, right));
  document.body.append(wrap);
  document.body.dataset.lensBefore = document.body.dataset.lens;
  const now = new Date();
  const tAlt = target.getAltAz(now);
  guide = { wrap, canvas, ctx: canvas.getContext("2d"), say, target, heading: norm360(tAlt.az - 70), lastSay: "" };
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (drag == null) return;
    const dx = e.clientX - drag;
    drag = e.clientX;
    guide.heading = norm360(guide.heading - (dx * 90) / canvas.clientWidth);
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  close.focus();
  function turn(d) { guide.heading = norm360(guide.heading + d); }
}
function closeGuide() {
  if (!guide) return;
  guide.wrap.remove();
  guide = null;
}
function renderGuide(now, t) {
  const g = guide;
  const { w, h: hh } = sizeCanvas(g.canvas, g.ctx);
  const ctx = g.ctx;
  const horizon = hh * 0.8;
  const pxPerDeg = (horizon - hh * 0.16) / 90;
  const fov = 90;
  const sun = sunAltAz(state.city.lat, state.city.lon, now);
  const grad = ctx.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, sun.alt > 0 ? "#2d5f9e" : "#060a1a");
  grad.addColorStop(1, sun.alt > 0 ? "#8bbbe6" : sun.alt > -12 ? "#2a2f5c" : "#121b3d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, horizon);
  const dark = clamp((-sun.alt - 4) / 10, 0, 1);
  if (dark > 0) {
    const { stars } = starsAt(now, state.city);
    stars.forEach((st, i) => {
      if (st.alt < 0) return;
      const dAz = norm180(st.az - g.heading);
      if (Math.abs(dAz) > 50) return;
      const x = w / 2 + (dAz / fov) * w;
      const y = horizon - st.alt * pxPerDeg;
      ctx.globalAlpha = dark * clamp(1.15 - st.mag * 0.17, 0.25, 1) * (REDUCE_MOTION ? 1 : 0.85 + 0.15 * Math.sin(t * 0.002 + i));
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, 2.6 - st.mag * 0.45), 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  const glow = ctx.createLinearGradient(0, horizon - 60, 0, horizon);
  glow.addColorStop(0, "rgba(124,212,255,0)");
  glow.addColorStop(1, "rgba(124,212,255,0.10)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - 60, w, 60);
  ctx.fillStyle = "#070910";
  ctx.fillRect(0, horizon, w, hh - horizon);
  const toXY = (alt, az) => {
    const dAz = norm180(az - g.heading);
    return { x: w / 2 + (dAz / fov) * w, y: horizon - alt * pxPerDeg, dAz };
  };
  ctx.strokeStyle = "rgba(150,175,255,.14)";
  ctx.lineWidth = 1;
  for (const alt of [30, 60]) {
    const y = horizon - alt * pxPerDeg;
    ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(149,161,194,.7)"; ctx.font = "400 10px 'IBM Plex Mono', monospace"; ctx.textAlign = "left";
    ctx.fillText(`${alt}° up`, 10, y - 5);
  }
  ctx.strokeStyle = "rgba(233,237,248,.6)";
  ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(w, horizon); ctx.stroke();
  ctx.textAlign = "center";
  for (let az = Math.floor((g.heading - 60) / 5) * 5; az <= g.heading + 60; az += 5) {
    const p = toXY(0, az);
    const major = norm360(az) % 45 === 0;
    ctx.strokeStyle = major ? "rgba(233,237,248,.8)" : "rgba(150,175,255,.4)";
    ctx.beginPath(); ctx.moveTo(p.x, horizon); ctx.lineTo(p.x, horizon + (major ? 12 : 6)); ctx.stroke();
    if (major) { ctx.fillStyle = "#e9edf8"; ctx.font = "600 12px 'Instrument Sans', sans-serif"; ctx.fillText(compassPoint(az), p.x, horizon + 26); }
  }
  ctx.fillStyle = "rgba(149,161,194,.85)";
  ctx.font = "400 11px 'IBM Plex Mono', monospace";
  ctx.fillText(`Facing ${compassPoint(g.heading)} · ${Math.round(g.heading)}°`, w / 2, horizon + 48);
  const b = bodiesAt(now, state.city);
  for (const name of ["Moon", "Venus", "Jupiter", "Saturn", "Mars"]) {
    const o = b[name];
    if (o.alt < 0) continue;
    const p = toXY(o.alt, o.az);
    if (Math.abs(p.dAz) > 55) continue;
    if (name === "Moon") drawMoon(ctx, p.x, p.y, 10, o.frac, o.phase);
    else { ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(233,237,248,.75)"; ctx.font = "500 11px 'IBM Plex Mono', monospace"; ctx.textAlign = "left";
    ctx.fillText(name, p.x + 12, p.y + 4);
  }
  if (g.target.track) {
    ctx.strokeStyle = "rgba(124,212,255,.7)";
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let pen = false;
    for (const s of g.target.track) {
      const p = toXY(s.el, s.az);
      if (Math.abs(p.dAz) > 60) { pen = false; continue; }
      if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const tgt = g.target.getAltAz(now);
  const p = toXY(tgt.alt, tgt.az);
  const instr = guideInstruction(g.heading, tgt.az, tgt.alt);
  const facing = Math.abs(instr.turn) < 8;
  if (Math.abs(p.dAz) <= 48) {
    const pulse = REDUCE_MOTION ? 0.5 : (t / 1400) % 1;
    ctx.strokeStyle = `rgba(124,212,255,${facing ? 0.95 : 0.7})`;
    ctx.lineWidth = facing ? 2.4 : 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#e9f8ff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7cd4ff"; ctx.font = "600 13px 'Instrument Sans', sans-serif"; ctx.textAlign = "left";
    ctx.fillText(g.target.name, p.x + 18, p.y - 14);
  } else {
    const right = instr.turn > 0;
    const ax = right ? w - 34 : 34;
    const ay = horizon - Math.max(10, tgt.alt) * pxPerDeg;
    ctx.fillStyle = "#7cd4ff";
    ctx.beginPath();
    if (right) { ctx.moveTo(ax + 16, ay); ctx.lineTo(ax - 6, ay - 14); ctx.lineTo(ax - 6, ay + 14); }
    else { ctx.moveTo(ax - 16, ay); ctx.lineTo(ax + 6, ay - 14); ctx.lineTo(ax + 6, ay + 14); }
    ctx.closePath(); ctx.fill();
  }
  const text = facing ? `You are facing the ${g.target.name}. Look ${tgt.alt < 15 ? "just above the horizon" : `${Math.round(tgt.alt)}° up`}.` : instr.text;
  if (text !== g.lastSay) {
    g.say.replaceChildren(text, h("small", { text: `${g.target.when || ""}Preview: drag to turn. On the real site your phone's compass does this.` }));
    g.lastSay = text;
  }
}

// =====================================================================
// Text: headline, card, sheets
// =====================================================================
const live = { planes: 0, planesUp: 0, sats: 0, quakesNear: 0 };
function setHeadline(parts, sub) {
  const h1 = $("headline");
  h1.replaceChildren(...parts.map((p) => (typeof p === "object" && p !== null ? h("em", { text: String(p.em) }) : String(p))));
  $("subline").textContent = sub || "";
}
let headlineKey = "";
function updateHeadline() {
  const c = state.city;
  let key;
  let parts;
  let sub;
  if (state.lens === "arrival") {
    key = "arrival" + c.id;
    parts = [`Flying to ${c.name}`];
    sub = "Satellites, aircraft, the night sky and earthquakes around you";
  } else if (state.lens === "above") {
    const sw = swarmUpdate(new Date(), c);
    key = `above${c.id}${c.planes.aircraft.length}${sw.above}`;
    parts = [{ em: sw.above }, " satellites and ", { em: c.planes.aircraft.length }, ` aircraft above ${c.name} right now`];
    sub = `Bright ones glow, most are too faint to see. Aircraft replay the ${fmtUtc(new Date(c.planes.time))} snapshot.`;
  } else if (state.lens === "tonight") {
    const plan = tonightPlan(c);
    const wtxt = plan.best ? `${fmtTime(plan.best.start, c.tz)} to ${fmtTime(plan.best.endExclusive, c.tz)}` : "no clear window";
    key = `tonight${c.id}${wtxt}`;
    parts = [`Best time to look up over ${c.name}: `, { em: wtxt }];
    sub = "Drag the time slider to watch the night move.";
  } else if (state.lens === "under") {
    const n = quakesNear(c).filter((x) => x.distKm <= QUAKE_RADIUS_KM).length;
    key = `under${c.id}${n}`;
    parts = [{ em: n }, ` earthquakes within 3,000 km of ${c.name} this week`];
    sub = "Distance and depth to scale. USGS, magnitude 2.5 and above.";
  } else {
    const sw = swarmUpdate(new Date(), c);
    key = `world${c.id}${sw.above}`;
    parts = [{ em: sw.above }, ` satellites are above ${c.name} right now`];
    sub = "Your beam marks the patch of sky you can see. Tap a storm, fire or quake for details.";
  }
  if (key !== headlineKey) { headlineKey = key; setHeadline(parts, sub); }
}

const shown = new Map();
function tweenNumber(el, target) {
  const from = shown.get(el.id) ?? 0;
  if (from === target) return;
  shown.set(el.id, target);
  if (REDUCE_MOTION) { el.textContent = target.toLocaleString("en-GB"); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = Math.round(from + (target - from) * ease(k)).toLocaleString("en-GB");
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const quakes24 = SNAP.quakes.events.filter((q) => Date.parse(SNAP.quakes.generated) - Date.parse(q.time) <= 86400000).length;
function updateStats() {
  if (state.lens !== "world") return;
  const sw = swarmUpdate(new Date(), state.city);
  tweenNumber($("stOrbit"), SNAP.swarm.count);
  tweenNumber($("stAbove"), sw.above);
  tweenNumber($("stQuakes"), quakes24);
  const kp = latestKp.kp;
  $("stKp").textContent = String(kp);
  $("stKp").classList.toggle("hot", kp >= 5);
  $("stKpS").textContent = kp >= 5 ? `G${Math.min(5, Math.floor(kp) - 4)} storm` : kp >= 4 ? "active" : "quiet";
}
const CHIPS = [
  ["sats", "Satellites", "#c8d6ff"], ["starlink", "Starlink", "#73ccff"], ["debris", "Debris", "#ff9a70"],
  ["events", "Storms, fires, quakes", "#ffb46e"], ["aurora", "Aurora", "#93efc6"],
];
function renderChips() {
  const wrap = $("chips");
  wrap.replaceChildren(...CHIPS.map(([key, label, color]) => {
    const b = h("button", { class: "chip-toggle", type: "button", "aria-pressed": String(state.layers[key]) }, h("i", { "aria-hidden": "true" }), label);
    b.style.setProperty("--dot", color);
    b.addEventListener("click", () => { state.layers[key] = !state.layers[key]; renderChips(); });
    return b;
  }));
}

function updatePlaceMeta() {
  const c = state.city;
  const now = new Date();
  const sun = sunAltAz(c.lat, c.lon, now).alt;
  const part = sun > 0 ? "daytime" : sun > -6 ? "twilight" : sun > -18 ? "getting dark" : "night";
  $("placeName").textContent = c.name;
  $("placeMeta").textContent = `${fmtTime(now, c.tz)} local · ${part}`;
}

function btn(label, onclick, primary = false) {
  return h("button", { class: "btn" + (primary ? " primary" : ""), type: "button", onclick }, label);
}
function linkBtn(label, href, primary = false) {
  return h("a", { class: "btn" + (primary ? " primary" : ""), href, target: "_blank", rel: "noopener" }, label);
}
function cardHead(kicker, src) {
  return h("div", { class: "card-head" }, h("span", { class: "card-kicker", text: kicker }), h("span", { class: "card-src", text: src }));
}

function shareButton() {
  if (!state.downloads) return null;
  return btn("Share my sky", shareSky);
}

function renderCard() {
  const card = $("card");
  const c = state.city;
  const now = new Date();
  const kids = [];
  if (state.lens === "arrival") {
    kids.push(cardHead("Radar Around You", "Prototype"), h("h2", { text: `Live view of everything above, under and around ${c.name}` }),
      h("p", { class: "detail", text: `Every dot is a real satellite or piece of debris, ${SNAP.swarm.count.toLocaleString("en-GB")} in all, moving live.` }),
      h("div", { class: "actions" }, btn("Skip to my sky", () => setLens("above"), true)));
  } else if (state.lens === "above") {
    const { next, nextVisible } = passesFor(c);
    const pass = nextVisible || next;
    kids.push(cardHead("Next ISS pass", "CelesTrak orbits · computed live"));
    if (pass) {
      const inProgress = pass.rise.getTime() <= now.getTime();
      const title = nextVisible
        ? `${inProgress ? "Visible now" : "Visible"} ${fmtDayTime(pass.rise, c.tz)}, look ${compassPoint(pass.max.az)}`
        : `Passes over at ${fmtDayTime(pass.rise, c.tz)}, but in daylight or Earth's shadow`;
      kids.push(h("h2", { text: title }));
      kids.push(h("p", { class: "detail mono", text: `Rises ${compassPoint(pass.riseAz)} · peaks ${Math.round(pass.max.el)}° ${compassPoint(pass.max.az)} · ${formatDuration(pass.set - pass.rise)}${inProgress ? "" : ` · starts in ${formatDuration(pass.rise - now)}`}` }));
      const issTarget = {
        name: "ISS",
        track: pass.track,
        when: `Peak at ${fmtTime(pass.max.time, c.tz)}. `,
        getAltAz: (d) => {
          if (d >= pass.rise && d <= pass.set) { const st = satState(ISS, d, c); return { alt: st.el, az: st.az }; }
          return { alt: pass.max.el, az: pass.max.az };
        },
      };
      kids.push(h("div", { class: "actions" },
        btn("Guide me", () => openGuide(issTarget), true),
        linkBtn("Remind me", googleCalendarUrl({ title: `Look up: the ISS passes over ${c.name}`, start: new Date(pass.rise.getTime() - 5 * 60000), end: pass.set, details: `Rises ${compassPoint(pass.riseAz)}, peaks ${Math.round(pass.max.el)}° ${compassPoint(pass.max.az)}. From the Radar Around You prototype.`, location: c.name })),
        shareButton()));
    } else {
      kids.push(h("h2", { text: "No ISS pass above 10° in the next 30 hours" }), h("div", { class: "actions" }, shareButton()));
    }
    kids.push(h("p", { class: "note", text: `Aircraft as seen by adsb.lol volunteer receivers (${c.planes.aircraft.length} near ${c.name}). Coverage is thinner in some regions, so some aircraft may be missing.` }));
  } else if (state.lens === "tonight") {
    const plan = tonightPlan(c);
    const b = bodiesAt(now, c);
    const aur = auroraFor(c);
    const { active, upcoming } = showersOn(now);
    kids.push(cardHead("Best time tonight", "MET Norway · NOAA"));
    if (plan.best) {
      const clouds = plan.hours.filter((x) => x.t >= plan.best.start && x.t <= plan.best.end);
      const avgCloud = Math.round(clouds.reduce((a, x) => a + x.cloud, 0) / clouds.length);
      kids.push(h("h2", { text: `Go out ${fmtTime(plan.best.start, c.tz)} to ${fmtTime(plan.best.endExclusive, c.tz)}` }));
      kids.push(h("p", { class: "detail mono", text: `Cloud ${avgCloud}% · Moon ${Math.round(b.Moon.frac * 100)}% lit · aurora ${aur.chance}% (Kp ${latestKp.kp})` }));
    } else {
      const reason = plan.hours.every((x) => x.sunAlt > -6) ? "the Sun stays up" : plan.hours.some((x) => x.sunAlt < -6 && x.cloud > 70) ? "clouds" : "twilight and moonlight";
      kids.push(h("h2", { text: `No good window in the next 12 hours (${reason})` }));
      kids.push(h("p", { class: "detail mono", text: `Moon ${Math.round(b.Moon.frac * 100)}% lit · aurora ${aur.chance}% (Kp ${latestKp.kp})` }));
    }
    const tl = h("div", { class: "timeline", role: "img", "aria-label": "Viewing quality for the next 12 hours" });
    for (const s of plan.scored) {
      const inBest = plan.best && s.t >= plan.best.start && s.t <= plan.best.end;
      const slot = h("div", { class: "slot" + (inBest ? " best" : ""), title: `${fmtTime(s.t, c.tz)} · score ${s.score}${s.cloudKnown ? ` · cloud ${Math.round(s.cloud)}%` : ""}` });
      slot.style.background = s.score > 0 ? `rgba(147,239,198,${0.15 + (s.score / 100) * 0.75})` : s.sunAlt > -6 ? "rgba(255,210,122,.18)" : "rgba(150,175,255,.13)";
      tl.append(slot);
    }
    const s0 = plan.scored[0].t;
    const sN = plan.scored[plan.scored.length - 1].t;
    kids.push(tl, h("div", { class: "timeline-labels" }, h("span", { text: fmtTime(s0, c.tz) }), h("span", { text: "next 12 hours" }), h("span", { text: fmtTime(sN, c.tz) })),
      h("p", { class: "note", text: "Green means good viewing. Grey means cloud or bright Moon. Amber means daylight." }));
    const out = h("output", { id: "tonightOut", for: "tonightRange", text: fmtTime(new Date(now.getTime() + state.tonightMin * 60000), c.tz) });
    const range = h("input", { id: "tonightRange", type: "range", min: "0", max: "720", step: "10", value: String(state.tonightMin), "aria-label": "Show the sky at this time" });
    range.addEventListener("input", () => {
      state.tonightMin = Number(range.value);
      out.textContent = fmtTime(new Date(Date.now() + state.tonightMin * 60000), c.tz);
    });
    kids.push(h("div", { class: "slider-row" }, h("label", { for: "tonightRange", class: "note", text: "Sky at" }), range, out));
    const showersText = active.length
      ? `Active meteor showers: ${active.map((s) => s.name).join(", ")}.`
      : "";
    const upText = upcoming.length ? ` Next peak: ${upcoming[0].name}, ${upcoming[0].peak[1]} ${monthName(upcoming[0].peak[0])}.` : "";
    if (showersText || upText) kids.push(h("p", { class: "note", text: `${showersText}${upText} Streaks in the sky show the expected rate as an illustration. Dates approximate.` }));
    const brightest = ["Moon", "Venus", "Jupiter", "Saturn", "Mars"].map((n) => bodiesAt(new Date(now.getTime() + state.tonightMin * 60000), c)[n]).find((o) => o.alt > 5);
    kids.push(h("div", { class: "actions" },
      plan.best ? linkBtn("Remind me", googleCalendarUrl({ title: `Stargazing window over ${c.name}`, start: plan.best.start, end: plan.best.endExclusive, details: "Best viewing window from the Radar Around You prototype.", location: c.name }), true) : null,
      brightest ? btn(`Guide me to ${brightest.name === "Moon" ? "the Moon" : brightest.name}`, () => openGuide({ name: brightest.name, getAltAz: (d) => { const o = bodiesAt(d, c)[brightest.name]; return { alt: o.alt, az: o.az }; } }), !plan.best) : null,
      shareButton()));
  } else if (state.lens === "under") {
    const list = quakesNear(c);
    const within = list.filter((x) => x.distKm <= QUAKE_RADIUS_KM);
    const nearest = list[0];
    kids.push(cardHead("Under you", `USGS · ${formatAge(now - Date.parse(SNAP.quakes.generated))} snapshot`));
    if (nearest) {
      const q = nearest.q;
      kids.push(h("h2", { text: `Nearest: M${q.mag.toFixed(1)}, ${kmText(nearest.distKm)} ${compassPoint(nearest.bearing)}, ${formatAge(now - Date.parse(q.time))}` }));
      kids.push(h("p", { class: "detail", text: `${q.place}. Depth ${Math.round(q.depth)} km. ${q.status === "reviewed" ? "Reviewed by a seismologist." : "Automatic location, may change."}` }));
      const strongest = within.slice().sort((a, b) => b.q.mag - a.q.mag)[0];
      if (strongest && strongest.q.id !== q.id) kids.push(h("p", { class: "detail mono", text: `Strongest within 3,000 km: M${strongest.q.mag.toFixed(1)}, ${kmText(strongest.distKm)} ${compassPoint(strongest.bearing)}` }));
      kids.push(h("div", { class: "actions" },
        btn("Replay the week", () => { state.replay = { t0: performance.now() }; }, true),
        q.url ? linkBtn("Did you feel it?", q.url + "/tellus") : null,
        linkBtn("Earthquake safety", "https://www.ready.gov/earthquakes")));
    }
    kids.push(h("p", { class: "note", text: "Information only. This is not an earthquake warning service." }));
  } else {
    if (state.selected) kids.push(cardHead("Around the world", "GDACS · USGS · NOAA"));
    const sel = state.selected;
    if (sel && sel.kind === "event") {
      const e = sel.e;
      const fid = `${e.type}:${e.name}:${e.from}`;
      const typeName = { WF: "Wildfire", TC: "Tropical cyclone", FL: "Flood", VO: "Volcano", DR: "Drought" }[e.type] || "Event";
      kids.push(h("h2", { text: e.name }), h("p", { class: "detail mono", text: `${typeName} · ${e.country || "location in report"} · since ${fmtDate(new Date(e.from + "Z"), "UTC")} UTC` }));
      if (e.severity) kids.push(h("p", { class: "detail", text: e.severity }));
      kids.push(h("p", { class: "note", text: `GDACS alert level ${e.alert}. Green means a low humanitarian impact is expected.` }));
      kids.push(h("div", { class: "actions" },
        e.url ? linkBtn("Official source", e.url, true) : null,
        btn(state.follows.has(fid) ? "Following" : "Follow", () => {
          if (state.follows.has(fid)) state.follows.delete(fid); else state.follows.add(fid);
          safeStore.set("radar.follows", [...state.follows]);
          renderCard();
        })));
    } else if (sel && sel.kind === "quake") {
      const q = sel.q;
      kids.push(h("h2", { text: `M${q.mag.toFixed(1)} earthquake` }), h("p", { class: "detail", text: `${q.place}. ${formatAge(now - Date.parse(q.time))}, depth ${Math.round(q.depth)} km.` }),
        h("div", { class: "actions" }, q.url ? linkBtn("Official source", q.url, true) : null));
    } else {
      const sw = swarmUpdate(now, c);
      const bright = satsNow(now, c).filter((x) => x.el > 10).length;
      const { next, nextVisible } = passesFor(c);
      const pass = nextVisible || next;
      const count = (t) => SNAP.events.filter((e) => e.type === t).length;
      card.dataset.kicker = "";
      kids.length = 0;
      kids.push(cardHead("Above you right now", "live orbits"));
      kids.push(h("h2", { text: `${sw.above} satellites, ${bright} of them bright, and ${c.planes.aircraft.length} aircraft nearby` }));
      kids.push(h("p", { class: "detail mono", text: pass ? `ISS ${nextVisible ? "visible" : "overhead"} ${fmtDayTime(pass.rise, c.tz)} · peaks ${Math.round(pass.max.el)}° ${compassPoint(pass.max.az)}` : "No ISS pass in the next 30 hours" }));
      kids.push(h("p", { class: "note", text: `On Earth now: ${count("TC")} tropical cyclones, ${count("WF")} wildfires, ${count("FL")} floods (GDACS). Tap any marker for the official source.` }));
      kids.push(h("div", { class: "actions" },
        btn("Dive into my sky", diveIn, true),
        btn("Tonight", () => setLens("tonight")),
        btn("World events", openEventsSheet)));
    }
  }
  card.replaceChildren(...kids.filter(Boolean));
}

// ---------- Sheets ----------
function openSheet(title, ...content) {
  const layer = $("layer");
  const close = h("button", { class: "btn close", type: "button", text: "Close", onclick: () => layer.replaceChildren() });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h3", { text: title }), ...content, close);
  const back = h("div", { class: "sheet-backdrop", onclick: (e) => { if (e.target === back) layer.replaceChildren(); } }, sheet);
  layer.replaceChildren(back);
  close.focus();
}
function openPlaces() {
  const now = new Date();
  openSheet("Choose a place",
    h("p", { text: "This prototype has real data for six sample places. The finished site uses your own location." }),
    h("ul", {}, SNAP.cities.map((c) => h("li", {}, h("button", { type: "button", onclick: () => { $("layer").replaceChildren(); setCity(c); } },
      h("span", { text: `${c.name}, ${c.country}` }), h("span", { class: "r", text: `${fmtTime(now, c.tz)} · ${c.planes.aircraft.length} aircraft` }))))));
}
function openEventsSheet() {
  const items = SNAP.events.filter((e) => e.type !== "EQ").sort((a, b) => (a.type === "TC" ? -1 : 0) - (b.type === "TC" ? -1 : 0));
  openSheet("Active events", h("p", { text: "From GDACS, the UN and European Commission disaster alert system. Information only, not official warnings." }),
    h("ul", {}, items.map((e) => h("li", {}, h("a", { href: e.url, target: "_blank", rel: "noopener" }, h("span", { text: e.name }), h("span", { class: "r", text: e.country || e.type }))))));
}
function openList() {
  const c = state.city;
  const now = new Date();
  const items = [];
  if (state.lens === "under") {
    for (const x of quakesNear(c).slice(0, 25)) items.push([`M${x.q.mag.toFixed(1)} · ${x.q.place}`, `${kmText(x.distKm)} ${compassPoint(x.bearing)} · ${formatAge(now - Date.parse(x.q.time))}`]);
  } else if (state.lens === "world" || state.lens === "arrival") {
    for (const e of SNAP.events.filter((e) => e.type !== "EQ").slice(0, 40)) items.push([e.name, e.country || e.type]);
  } else {
    const b = bodiesAt(now, c);
    for (const n of ["Moon", "Venus", "Jupiter", "Saturn", "Mars", "Mercury"]) if (b[n].alt > 0) items.push([n, `${Math.round(b[n].alt)}° up, ${compassPoint(b[n].az)}`]);
    for (const st of satsNow(now, c).filter((x) => x.el > 0).sort((a, b) => b.el - a.el)) items.push([st.s.name, `${Math.round(st.el)}° up, ${compassPoint(st.az)}${st.sunlit && sunAltAz(c.lat, c.lon, now).alt < -6 ? ", sunlit" : ""}`]);
    for (const pl of planesNow(c).sort((a, b) => a.distKm - b.distKm).slice(0, 30)) items.push([pl.p.call || "Aircraft", `${kmText(pl.distKm)} ${compassPoint(pl.az)} · ${Math.round(pl.p.altFt / 100) * 100} ft`]);
  }
  openSheet("List view", h("p", { text: "Everything on screen as text." }), h("ul", {}, items.map(([a, b]) => h("li", {}, h("button", { type: "button" }, h("span", { text: a }), h("span", { class: "r", text: b }))))));
}
function openAbout() {
  const c = state.city;
  const qBtn = (q, label) => btn(label + (state.quality === q ? " (on)" : ""), () => { state.quality = q; safeStore.set("radar.quality", q); location.reload(); });
  openSheet("Sources and notes",
    h("p", { text: "A visual prototype. Satellite, Sun, Moon, planet and star positions are calculated live on your device. Everything else is a real data snapshot." }),
    h("dl", {},
      h("dt", { text: "Satellites" }), h("dd", { text: `CelesTrak orbital data (OMM), fetched ${fmtUtc(new Date(SNAP.snapshotTaken))}. Positions computed live with satellite.js.` }),
      h("dt", { text: "Aircraft" }), h("dd", { text: `adsb.lol (ODbL 1.0), snapshot ${fmtUtc(new Date(c.planes.time))}, replayed by speed and heading. Only airline call signs are named.` }),
      h("dt", { text: "Earthquakes" }), h("dd", { text: `USGS, magnitude 2.5+ past 7 days, generated ${fmtUtc(new Date(SNAP.quakes.generated))}. Public domain.` }),
      h("dt", { text: "Aurora" }), h("dd", { text: `NOAA SWPC OVATION, ${fmtUtc(new Date(SNAP.aurora.observation))}; Kp ${latestKp.kp} at ${fmtUtc(new Date(latestKp.t + "Z"))}. The local chance is a rough estimate.` }),
      h("dt", { text: "World events" }), h("dd", { text: "GDACS (UN and European Commission), current events at snapshot time." }),
      h("dt", { text: "Cloud forecast" }), h("dd", { text: `Data from MET Norway (CC BY 4.0), updated ${fmtUtc(new Date(c.clouds.updated))}.` }),
      h("dt", { text: "Sky" }), h("dd", { text: "Stars and constellation lines from the d3-celestial data set; Sun, Moon and planets from astronomy-engine. Earth images based on NASA Blue Marble and Black Marble." }),
      h("dt", { text: "Not a warning service" }), h("dd", { text: "Nothing here is an official alert. Follow your local authorities in an emergency." }),
      h("dt", { text: "Prototype limits" }), h("dd", { text: "Guide me uses drag instead of the phone compass, places are fixed samples, and aircraft replay a snapshot. Meteor shower dates are approximate." })),
    h("p", { text: `Display quality: ${tier()}${state.quality === "auto" ? " (automatic)" : ""}` }),
    h("div", { class: "actions" }, qBtn("auto", "Automatic"), qBtn("high", "High"), qBtn("low", "Low")));
}

// ---------- Share ----------
let toastTimer = null;
function toast(text) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status", text });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}
async function shareSky() {
  if (!state.downloads) return;
  const src = state.lens === "world" && G.ok ? $("globe") : $("sky");
  const out = document.createElement("canvas");
  out.width = 1080;
  out.height = 1350;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, 1080, 1350);
  const scale = Math.max(1080 / src.width, 1100 / src.height);
  const sw = src.width * scale;
  const sh = src.height * scale;
  ctx.drawImage(src, (1080 - sw) / 2, 140 + (1100 - sh) / 2, sw, sh);
  const c = state.city;
  ctx.fillStyle = "#e9edf8";
  ctx.font = "700 58px Syne, sans-serif";
  ctx.fillText(state.lens === "under" ? `Under ${c.name}` : state.lens === "world" ? "Around the world" : `Above ${c.name}`, 56, 96);
  ctx.font = "400 30px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#95a1c2";
  ctx.fillText(`${fmtDate(new Date(), c.tz)} · ${$("headline").textContent.slice(0, 60)}`, 56, 140);
  ctx.fillStyle = "rgba(4,6,12,.75)";
  ctx.fillRect(0, 1270, 1080, 80);
  ctx.fillStyle = "#95a1c2";
  ctx.font = "400 22px 'IBM Plex Mono', monospace";
  ctx.fillText("Radar Around You · prototype · CelesTrak, adsb.lol, USGS, NOAA, GDACS, MET Norway", 56, 1318);
  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  try {
    await state.downloads.save({ filename: `sky-over-${c.id}.png`, data: blob });
    toast("Image saved");
  } catch (e) {
    if (e && e.code === "declined") toast("Not saved");
    else if (e && (e.code === "unavailable" || e.code === "not_granted")) { state.downloads = null; renderCard(); toast("Saving is not available here"); }
    else toast("Could not save the image");
  }
}

// =====================================================================
// Lens switching and the main loop
// =====================================================================
function setLens(lens) {
  state.lens = lens;
  state.selected = null;
  document.body.dataset.lens = lens;
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.lens === lens));
  const globeView = (lens === "world" || lens === "arrival") && G.ok;
  $("globe").classList.toggle("is-hidden", !globeView);
  $("sky").classList.toggle("is-hidden", globeView);
  $("stats").hidden = lens !== "world";
  $("chips").hidden = lens !== "world" || !G.ok;
  if (!globeView) hideLabels();
  if (lens === "world" && G.ok) { updateIssPath(); if (!fly) { const v = heroView(); flyTo(v.lat, v.lon, v.dist, 1400); } updateStats(); }
  headlineKey = "";
  updateHeadline();
  renderCard();
}
function arrivalDone() {
  if (state.lens === "arrival") setLens("world");
}
// Fly down into the beam, then switch to the sky dome.
function diveIn() {
  if (!G.ok || REDUCE_MOTION) { setLens("above"); return; }
  flyTo(state.city.lat, state.city.lon, 1.35, 1300, () => setLens("above"));
}
function setCity(c) {
  state.city = c;
  safeStore.set("radar.city", c.id);
  planeTrails.clear();
  for (const s of SATS) s.trail.length = 0;
  placeYou();
  updatePlaceMeta();
  if (state.lens === "world" || state.lens === "arrival") { updateIssPath(); const v = heroView(); flyTo(v.lat, v.lon, v.dist, 1600); }
  updateStats();
  headlineKey = "";
  updateHeadline();
  renderCard();
}

for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => setLens(t.dataset.lens));
$("placeBtn").addEventListener("click", openPlaces);
$("aboutBtn").addEventListener("click", openAbout);
$("listBtn").addEventListener("click", openList);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (guide) closeGuide(); else $("layer").replaceChildren(); }
});

let lastSlow = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const now = new Date();
  try {
    if (guide) { renderGuide(now, t); return; }
    if ((state.lens === "world" || state.lens === "arrival") && G.ok) renderGlobe(now, t);
    else renderSky(now, t);
    if (t - lastSlow > 1000) {
      lastSlow = t;
      updateHeadline();
      updatePlaceMeta();
      updateStats();
    }
  } catch (err) {
    console.error(err);
  }
}

initGlobe();
renderChips();
document.body.dataset.lens = "arrival";
updatePlaceMeta();
if (G.ok) {
  setLens("arrival");
  G.view = { lat: state.city.lat * 0.2 + 10, lon: state.city.lon - 95, dist: worldDist() * 1.9 };
  const v = heroView();
  flyTo(v.lat, v.lon, v.dist, REDUCE_MOTION ? 0 : 3600, arrivalDone);
} else {
  setLens("above");
}
setInterval(() => { if (state.lens !== "tonight" && !guide) renderCard(); }, 30000);
requestAnimationFrame(frame);
