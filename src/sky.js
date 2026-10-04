// The ground view: a first-person 3D sky above a place. Scene frame: +X east, +Y up, -Z north. The camera sits at the origin.
import * as THREE from "three";
import * as Astro from "astronomy-engine";
import {
  DEG, EARTH_RADIUS_KM, clamp, norm180, sunAltAz, subsolarPoint, gmstDeg, altAzToVector, vectorToAltAz, equatorialToHorizonBasis, applyBasis,
  skyColors, limitingMagnitude, extrapolatePlane, lookAngle, destinationPoint, latLonToUnit, observerEcef, swarmPositionFast, swarmLook,
  findPasses, auroraFromGrid, haversineKm, bearingDeg, raDecToAltAz,
} from "./core.js";
import * as S from "./shaders.js";
import { glowTexture, ribbonMaterial, dynLine } from "./engine.js";
import { buildStarfield } from "./stars.js";
import { airlinerModel, aircraftVariantFor, updateAircraftLights } from "./models.js";

const SKY_R = 50;
const PLANE_R = 40;
const PLANE_LOOP_SEC = 180;
const R_KM = EARTH_RADIUS_KM;
const PLANETS = [["Mercury", [0.85, 0.8, 0.72]], ["Venus", [1, 0.96, 0.84]], ["Mars", [1, 0.62, 0.48]], ["Jupiter", [0.98, 0.9, 0.77]], ["Saturn", [0.94, 0.85, 0.63]]];
const TAIL_COLORS = [0x2a6bd6, 0xc8102e, 0x0b7a53, 0xf2a900, 0x6a2c91, 0x111111, 0xe4572e, 0x00a3a3];

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const vec = (v, r = 1) => new THREE.Vector3(v.x * r, v.y * r, v.z * r);
const altAzVec = (alt, az, r = 1) => vec(altAzToVector(alt, az), r);

export function createSky(ctx) {
  const { renderer, D, tex, settings, clock, swarmGeo } = ctx;
  const meta = D.meta;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 300);
  const uni = { time: { value: 0 }, pr: { value: 1 }, sizeScale: { value: 1 } };
  const api = { scene, camera };

  const view = { yaw: 180, pitch: 32, fov: 72, sensor: false };
  api.view = view;
  const opts = { darkSky: false, constellations: false, planes: true, satellites: true, showAll: false, labels: true };
  api.opts = opts;

  let place = null;
  let basis = null;

  // ------------------------------------------------------------------ sky dome, stars, Milky Way
  const skyU = {
    zenith: { value: new THREE.Vector3() }, horizon: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glowColor: { value: new THREE.Vector3(1, 0.9, 0.7) },
    glowAmt: { value: 1 }, sunAlt: { value: 0 }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, moonAmt: { value: 0 }, airglow: { value: 0 }, cityGlow: { value: new THREE.Vector3() },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ vertexShader: S.SKY_VERT, fragmentShader: S.SKY_FRAG, uniforms: skyU, side: THREE.BackSide, depthWrite: false }));
  dome.frustumCulled = false;
  dome.renderOrder = -20;
  scene.add(dome);

  const field = buildStarfield(D, uni, { radius: SKY_R, magLimit: 6.5, dark: 1, milky: 1 });
  field.group.matrixAutoUpdate = false;
  scene.add(field.group);
  api.field = field;

  // ------------------------------------------------------------------ Sun, Moon, planets
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(64, [[0, "rgba(255,255,255,1)"], [0.5, "rgba(255,250,235,1)"], [0.62, "rgba(255,230,170,0.5)"], [1, "rgba(255,200,120,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunGlow.renderOrder = 5; sunCore.renderOrder = 6;
  scene.add(sunGlow, sunCore);

  const moonGeo = new THREE.SphereGeometry(1, 48, 24);
  moonGeo.rotateY(-Math.PI / 2);
  const moonU = { moonTex: { value: tex.moon }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, exposure: { value: 1 } };
  const moon = new THREE.Mesh(moonGeo, new THREE.ShaderMaterial({ vertexShader: S.MOON_VERT, fragmentShader: S.MOON_FRAG, uniforms: moonU }));
  moon.renderOrder = 4;
  scene.add(moon);

  const MOON_ENLARGE = 3.5;
  api.moonEnlarge = MOON_ENLARGE;

  const planetGeo = new THREE.BufferGeometry();
  planetGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PLANETS.length * 3), 3));
  planetGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(PLANETS.length), 1));
  planetGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(PLANETS.length * 3), 3));
  planetGeo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(PLANETS.length), 1));
  const planetPts = new THREE.Points(planetGeo, new THREE.ShaderMaterial({ vertexShader: S.SPRITE_VERT, fragmentShader: S.SPRITE_FRAG, uniforms: { pr: uni.pr, sizeScale: uni.sizeScale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  planetPts.frustumCulled = false;
  planetPts.renderOrder = 3;
  scene.add(planetPts);

  // ------------------------------------------------------------------ satellites (positions computed on the GPU)
  const satU = {
    tMin: { value: 0 }, gmst: { value: 0 }, obs: { value: new THREE.Vector3() }, east: { value: new THREE.Vector3(1, 0, 0) }, upv: { value: new THREE.Vector3(0, 1, 0) }, north: { value: new THREE.Vector3(0, 0, 1) },
    sunE: { value: new THREE.Vector3(1, 0, 0) }, night: { value: 1 }, showAll: { value: 0 }, show: { value: new THREE.Vector4(1, 1, 1, 1) }, pr: uni.pr, sizeScale: uni.sizeScale, selIdx: { value: -1 }, time: uni.time,
  };
  const sats = new THREE.Points(swarmGeo, new THREE.ShaderMaterial({ vertexShader: S.SWARM_SKY_VERT, fragmentShader: S.SWARM_FRAG, uniforms: satU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sats.frustumCulled = false;
  sats.renderOrder = 2;
  scene.add(sats);
  api.sats = sats;

  // ------------------------------------------------------------------ ground and horizon
  const horizonU = { base: { value: new THREE.Vector3(0.02, 0.025, 0.03) }, glow: { value: new THREE.Vector3(1, 0.7, 0.4) }, glowAmt: { value: 0.3 } };
  {
    const N = 180;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(a * 5 + 1.3)) * (0.5 + 0.5 * Math.sin(a * 11 + 0.4)) + 0.18 * Math.sin(a * 37) * Math.sin(a * 23 + 2) + 0.08 * Math.sin(a * 83);
      const r = 30;
      pos.push(Math.sin(a) * r, 0, -Math.cos(a) * r, Math.sin(a) * r, Math.max(0.15, h), -Math.cos(a) * r);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const ring = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: S.HORIZON_VERT, fragmentShader: S.HORIZON_FRAG, uniforms: horizonU, side: THREE.DoubleSide }));
    ring.renderOrder = 10;
    ring.frustumCulled = false;
    scene.add(ring);
    const ground = new THREE.Mesh(new THREE.SphereGeometry(29.5, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.ShaderMaterial({ vertexShader: S.HORIZON_VERT, fragmentShader: S.HORIZON_FRAG, uniforms: horizonU, side: THREE.DoubleSide }));
    ground.renderOrder = 10;
    ground.frustumCulled = false;
    scene.add(ground);
  }

  // ------------------------------------------------------------------ aurora curtains
  const curtainGroup = new THREE.Group();
  scene.add(curtainGroup);
  function buildCurtain(az, el, widthDeg, heightDeg, count) {
    while (curtainGroup.children.length) { const c = curtainGroup.children.pop(); c.geometry.dispose(); }
    for (let layer = 0; layer < count; layer++) {
      const nu = 56, nv = 14, pos = [], uvs = [], idx = [];
      const w = widthDeg * (1 - layer * 0.18), off = (layer - (count - 1) / 2) * 7;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const wob = Math.sin(u * 9 + layer * 2) * 2.5 + Math.sin(u * 23 + layer) * 0.8;
        const p = altAzVec(clamp(el + layer * 2 + v * heightDeg + wob * (0.4 + v), -1, 89), az + off + (u - 0.5) * w, 38 - layer * 0.3);
        pos.push(p.x, p.y, p.z); uvs.push(u, v);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: S.CURTAIN_VERT, fragmentShader: S.CURTAIN_FRAG, uniforms: { time: { value: 0 }, strength: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.userData.layer = layer;
      m.renderOrder = 1;
      m.frustumCulled = false;
      curtainGroup.add(m);
    }
  }

  // ------------------------------------------------------------------ aircraft
  const sunLight = new THREE.DirectionalLight(0xfff2dd, 0);
  const moonLight = new THREE.DirectionalLight(0x9db4ff, 0);
  const ambient = new THREE.AmbientLight(0x8aa4d6, 0.2);
  scene.add(sunLight, moonLight, ambient);
  const planeGroup = new THREE.Group();
  scene.add(planeGroup);
  const contrailMat = ribbonMaterial({ opacity: 0 });
  const planeObjs = new Map();
  const PLANE_LABELS = 10;
  api.planesNow = [];
  const selRingGeo = new THREE.BufferGeometry();
  selRingGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  selRingGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array([64]), 1));
  selRingGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 0.83, 0.4]), 3));
  selRingGeo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
  const selRing = new THREE.Points(selRingGeo, new THREE.ShaderMaterial({ vertexShader: S.SPRITE_VERT, fragmentShader: S.RING_FRAG, uniforms: { pr: uni.pr, sizeScale: uni.sizeScale, time: uni.time }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  selRing.frustumCulled = false;
  selRing.renderOrder = 20;
  selRing.visible = false;
  scene.add(selRing);
  const passLine = dynLine(400, new THREE.Color(1, 0.85, 0.45), ribbonMaterial({ opacity: 1, vertex: S.SKYLINE_VERT }));
  scene.add(passLine.obj);
  passLine.obj.renderOrder = 15;

  function planeObject(p) {
    let o = planeObjs.get(p.hex);
    if (o) return o;
    const code = (p.call || "").slice(0, 3);
    const model = airlinerModel(aircraftVariantFor(p.type), TAIL_COLORS[hashString(code) % TAIL_COLORS.length]);
    planeGroup.add(model);
    o = { model, trail: null, firstSeen: null, above: false, data: p };
    planeObjs.set(p.hex, o);
    return o;
  }

  // ------------------------------------------------------------------ state: bodies, satellites scan
  const info = { sunAlt: 0, sunAz: 0, moon: null, planets: [], above: 0, aboveLit: 0, glow: 0, limitMag: 6, aurora: null, cloud: null };
  api.info = info;
  let bodiesAt = 0;
  let scan = { t: 0, list: [] };
  api.scan = scan;

  function computeBodies(date) {
    const obs = new Astro.Observer(place.lat, place.lon, 0);
    const out = [];
    for (const [name, color] of PLANETS) {
      const body = Astro.Body[name];
      const eq = Astro.Equator(body, date, obs, true, true);
      const hz = Astro.Horizon(date, obs, eq.ra, eq.dec, "normal");
      let mag = null;
      try { mag = Astro.Illumination(body, date).mag; } catch { mag = null; }
      out.push({ name, alt: hz.altitude, az: hz.azimuth, mag, color });
    }
    info.planets = out;
    const eq = Astro.Equator(Astro.Body.Moon, date, obs, true, true);
    const hz = Astro.Horizon(date, obs, eq.ra, eq.dec, "normal");
    const ill = Astro.Illumination(Astro.Body.Moon, date);
    info.moon = { alt: hz.altitude, az: hz.azimuth, frac: ill.phase_fraction, phase: Astro.MoonPhase(date), mag: ill.mag };
  }

  // The scan of all 19,000 objects is spread over several frames so it never causes a visible hitch.
  let job = null;
  function startScan(date) {
    const t = date.getTime();
    const o = observerEcef(place.lat, place.lon);
    const la = place.lat * DEG, lo = place.lon * DEG;
    const ss = subsolarPoint(date);
    const sun = latLonToUnit(ss.lat, ss.lon);
    job = {
      t, g: gmstDeg(date) * DEG, o, k: 0, list: [], above: 0, aboveLit: 0,
      E: [-Math.sin(lo), Math.cos(lo), 0],
      Nn: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
      U: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
      sx: sun.x, sy: -sun.z, sz: sun.y, // scene frame to Earth-fixed
    };
  }
  function stepScan(maxN) {
    const j = job;
    const end = Math.min(D.swarm.length, j.k + maxN);
    for (; j.k < end; j.k++) {
      const s = D.swarm[j.k];
      if (s.a > 7.2 * R_KM) continue;
      const p = swarmPositionFast(s, j.t, j.g);
      const dx = p.x - j.o.x, dy = p.y - j.o.y, dz = p.z - j.o.z;
      const up = dx * j.U[0] + dy * j.U[1] + dz * j.U[2];
      const range = Math.hypot(dx, dy, dz);
      const el = Math.asin(clamp(up / range, -1, 1)) / DEG;
      if (el < -2) continue;
      const east = dx * j.E[0] + dy * j.E[1];
      const north = dx * j.Nn[0] + dy * j.Nn[1] + dz * j.Nn[2];
      const az = (Math.atan2(east, north) / DEG + 360) % 360;
      const dp = p.x * j.sx + p.y * j.sy + p.z * j.sz;
      const lit = dp > 0 || Math.hypot(p.x - dp * j.sx, p.y - dp * j.sy, p.z - dp * j.sz) > 6378.137;
      j.list.push({ idx: j.k, el, az, lit, range });
      if (el >= 10) { j.above++; if (lit) j.aboveLit++; }
    }
    if (j.k >= D.swarm.length) {
      scan = { t: j.t, list: j.list };
      api.scan = scan;
      info.above = j.above;
      info.aboveLit = j.aboveLit;
      job = null;
    }
  }
  function scanSatellites(date) {
    if (!job) startScan(date);
    stepScan(3200);
  }

  // ------------------------------------------------------------------ place and time
  function sampleGlow(city) {
    // average night-light brightness around the place, from the night-lights texture (0..1). A rough proxy for sky glow.
    try {
      const img = tex.night.image;
      const w = img.width, h = img.height;
      const cx = ((city.lon + 180) / 360) * w, cy = ((90 - city.lat) / 180) * h;
      const c = document.createElement("canvas");
      c.width = 16; c.height = 8;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, cx - 8, cy - 4, 16, 8, 0, 0, 16, 8);
      const px = g.getImageData(0, 0, 16, 8).data;
      let sum = 0, mx = 0;
      for (let i = 0; i < px.length; i += 4) { const l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255; sum += l; mx = Math.max(mx, l); }
      return clamp(sum / (px.length / 4) * 4.5 + mx * 0.25, 0, 1);
    } catch { return 0.3; }
  }

  api.setPlace = (city) => {
    place = { ...city, lat: Number(city.lat), lon: Number(city.lon) };
    info.glow = sampleGlow(place);
    info.aurora = auroraFromGrid(D.aurora, place.lat, place.lon, 1100);
    const o = observerEcef(place.lat, place.lon);
    satU.obs.value.set(o.x / R_KM, o.z / R_KM, -o.y / R_KM);
    const la = place.lat * DEG, lo = place.lon * DEG;
    satU.east.value.set(-Math.sin(lo), 0, -Math.cos(lo));
    satU.upv.value.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    satU.north.value.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
    planeObjs.forEach((o2) => { planeGroup.remove(o2.model); if (o2.trail) scene.remove(o2.trail.obj); });
    planeObjs.clear();
    bodiesAt = 0; scan = { t: 0, list: [] }; api.scan = scan; job = null;
    // aurora curtains toward the oval
    const a = info.aurora;
    if (a && a.chance >= 3 && a.at) {
      const look = a.distKm < 60 || a.here >= a.at.prob * 0.9 ? { az: 0, el: 50 } : lookAngle(place.lat, place.lon, a.at.lat, a.at.lon, 110);
      const overhead = a.here >= 20;
      buildCurtain(overhead ? (place.lat >= 0 ? 0 : 180) : look.az, overhead ? 35 : clamp(look.el, 1, 40), overhead ? 140 : 70, 14 + a.chance * 0.35, 3);
      curtainGroup.userData.on = true;
    } else {
      while (curtainGroup.children.length) { const c = curtainGroup.children.pop(); c.geometry.dispose(); }
      curtainGroup.userData.on = false;
    }
    // first view: face the Moon if it is up, else the south (north in the southern hemisphere)
    api.faceDefault();
  };
  api.faceDefault = () => {
    view.pitch = 32; view.fov = 72;
    view.yaw = place && place.lat < 0 ? 0 : 180;
  };

  // ------------------------------------------------------------------ per frame
  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  api.frame = { moonPos: new THREE.Vector3() };

  const cloudNow = (date) => {
    const hrs = place.clouds && place.clouds.hours;
    if (!hrs) return null;
    let best = null;
    for (const hr of hrs) { const dt = Math.abs(Date.parse(hr.t) - date.getTime()); if (dt <= 90 * 60000 && (!best || dt < best.dt)) best = { dt, cloud: hr.cloud }; }
    return best ? best.cloud : null;
  };

  api.update = (date, tSec, dtSec) => {
    if (!place) return;
    uni.time.value = tSec;
    uni.pr.value = renderer.getPixelRatio();
    uni.sizeScale.value = clamp(renderer.domElement.clientWidth / 900, 0.8, 1.35);
    if (date.getTime() - bodiesAt > 20000 || date.getTime() < bodiesAt) { bodiesAt = date.getTime(); computeBodies(date); }
    const sun = sunAltAz(place.lat, place.lon, date);
    info.sunAlt = sun.alt; info.sunAz = sun.az;
    const night = clamp((-sun.alt - 3) / 12, 0, 1);
    const dayness = clamp((sun.alt + 6) / 10, 0, 1);

    // sky colours
    const c = skyColors(sun.alt);
    skyU.zenith.value.set(...c.zenith); skyU.horizon.value.set(...c.horizon); skyU.glowColor.value.set(...c.glow); skyU.glowAmt.value = c.glowAmt;
    const sd = altAzToVector(sun.alt, sun.az);
    skyU.sunDir.value.set(sd.x, sd.y, sd.z);
    skyU.sunAlt.value = sun.alt;
    const m = info.moon;
    const md = altAzToVector(m.alt, m.az);
    skyU.moonDir.value.set(md.x, md.y, md.z);
    skyU.moonAmt.value = m.alt > -3 ? m.frac : 0;
    skyU.airglow.value = night * (opts.darkSky ? 1 : 1 - info.glow);
    { const g = (opts.darkSky ? 0 : info.glow) * night * 0.5; skyU.cityGlow.value.set(0.62 * g, 0.36 * g, 0.16 * g); }

    // stars
    basis = equatorialToHorizonBasis(place.lat, place.lon, date);
    _m.makeBasis(vec(basis.x), vec(basis.y), vec(basis.z));
    field.group.matrix.copy(_m);
    field.group.matrixWorldNeedsUpdate = true;
    sunLight.position.set(sd.x * 40, sd.y * 40, sd.z * 40);
    sunLight.intensity = 2.4 * dayness * clamp((sun.alt + 3) / 8, 0, 1);
    moonLight.position.set(md.x * 40, md.y * 40, md.z * 40);
    moonLight.intensity = m.alt > 0 ? 0.9 * m.frac * (1 - dayness) : 0;
    ambient.intensity = 0.16 + 0.95 * dayness;
    const glow = opts.darkSky ? 0 : info.glow;
    const moonUp = m.alt > 0 ? m.frac * clamp(m.alt / 25, 0, 1) : 0;
    info.limitMag = limitingMagnitude(sun.alt, glow, moonUp);
    field.starUniforms.magLimit.value = info.limitMag;
    field.starUniforms.dark.value = 1;
    field.milkyUniforms.amount.value = 1.15 * clamp((-sun.alt - 10) / 8, 0, 1) * clamp(1 - 1.7 * glow, 0, 1) * (1 - 0.7 * moonUp);
    field.lines.visible = opts.constellations;
    field.lines.material.uniforms.opacity.value = clamp((-sun.alt - 4) / 8, 0, 1) * (0.9 - 0.5 * glow);

    // Sun
    sunGlow.visible = sunCore.visible = sun.alt > -8;
    const sunPos = vec(sd, 48);
    sunGlow.position.copy(sunPos); sunCore.position.copy(sunPos);
    const sunGlowScale = 10 + 12 * clamp(1 - sun.alt / 30, 0, 1);
    sunGlow.scale.setScalar(sunGlowScale); sunCore.scale.setScalar(3.2);
    sunGlow.material.opacity = clamp((sun.alt + 8) / 10, 0, 1) * 0.9;

    // Moon (drawn larger than life so its phase is visible)
    moon.visible = m.alt > -2;
    const moonPos = vec(md, 47);
    moon.position.copy(moonPos);
    moon.scale.setScalar(47 * Math.tan(0.26 * DEG) * MOON_ENLARGE);
    const pole = altAzToVector(place.lat, 0);
    const mdv = new THREE.Vector3(md.x, md.y, md.z);
    const upv = new THREE.Vector3(pole.x, pole.y, pole.z).sub(mdv.clone().multiplyScalar(mdv.dot(new THREE.Vector3(pole.x, pole.y, pole.z)))).normalize();
    moon.up.copy(upv);
    moon.lookAt(0, 0, 0);
    moonU.sunDir.value.set(sd.x, sd.y, sd.z);
    moonU.exposure.value = 1.1 * (0.55 + 0.45 * clamp((-sun.alt + 2) / 10, 0, 1));
    api.frame.moonPos.copy(moonPos);

    // planets
    {
      const pa = planetGeo.attributes;
      info.planets.forEach((p, i) => {
        const v = altAzVec(p.alt, p.az, 48);
        pa.position.setXYZ(i, v.x, v.y, v.z);
        const mag = p.mag ?? 2;
        pa.size.setX(i, clamp(8 + (2 - mag) * 3.4, 7, 30));
        pa.color.setXYZ(i, ...p.color);
        pa.alpha.setX(i, p.alt > 0 ? clamp((glow < 0.5 ? 1 : 0.8) * clamp((mag < 0 ? 1 : 0.35 + (2 - mag) * 0.2) * (night * 0.9 + 0.15), 0, 1), 0, 1) * (p.alt > -1 ? 1 : 0) : 0);
      });
      pa.position.needsUpdate = pa.size.needsUpdate = pa.color.needsUpdate = pa.alpha.needsUpdate = true;
    }

    // satellites
    satU.tMin.value = (date.getTime() - meta.ref) / 60000;
    satU.gmst.value = gmstDeg(date) * DEG;
    const su = latLonToUnit(subsolarPoint(date).lat, subsolarPoint(date).lon);
    satU.sunE.value.set(su.x, su.y, su.z);
    satU.night.value = clamp((-sun.alt - 1.5) / 6, 0, 1);
    satU.showAll.value = opts.showAll ? 1 : 0;
    sats.visible = opts.satellites;
    api.scanOnly(date);

    // aurora curtains
    if (curtainGroup.userData.on) {
      const a = info.aurora;
      const strength = clamp(a.chance / 45, 0.08, 1) * clamp((-sun.alt - 6) / 8, 0, 1) * (1 - 0.6 * glow);
      curtainGroup.children.forEach((c) => { c.material.uniforms.time.value = tSec + c.userData.layer * 3.1; c.material.uniforms.strength.value = strength * (0.8 - c.userData.layer * 0.18); });
    }

    // ground
    const dayGround = [0.34, 0.40, 0.28], nightGround = [0.008, 0.01, 0.014];
    const gcol = dayGround.map((v, i) => nightGround[i] + (v - nightGround[i]) * dayness);
    horizonU.base.value.set(...gcol);
    horizonU.glowAmt.value = night * glow * 0.9 * (opts.darkSky ? 0 : 1);
    horizonU.glow.value.set(1, 0.62, 0.32);

    // aircraft
    updatePlanes(date, tSec, dayness);
    updateCamera(dtSec);
    info.cloud = cloudNow(date);
  };

  function updatePlanes(date, tSec, dayness) {
    const aircraft = place.planes ? place.planes.aircraft : [];
    const t = tSec % PLANE_LOOP_SEC;
    const alpha = clamp(Math.min(t / 3, (PLANE_LOOP_SEC - t) / 3), 0, 1);
    const list = [];
    contrailMat.uniforms.opacity.value = dayness * 0.8 * alpha;
    planeGroup.visible = opts.planes;
    for (const p of aircraft) {
      const altKm = p.altFt * 0.0003048;
      const pos = extrapolatePlane(p, t + (p.age || 0));
      const look = lookAngle(place.lat, place.lon, pos.lat, pos.lon, altKm);
      const slant = Math.hypot(look.distKm, altKm);
      const o = planeObject(p);
      const visible = look.el > -0.2;
      o.model.visible = visible && opts.planes;
      const rec = { p, ...look, slantKm: slant, altKm, pos, o };
      if (visible) {
        const dir = altAzToVector(look.el, look.az);
        const ang = (o.model.userData.size || 35) / (slant * 1000);
        const scale = (Math.max(ang, 0.021) * PLANE_R) / (o.model.userData.size || 35);
        o.model.position.set(dir.x * PLANE_R, dir.y * PLANE_R, dir.z * PLANE_R);
        o.model.scale.setScalar(scale * (0.4 + 0.6 * alpha));
        const tr = p.track * DEG;
        const fwd = new THREE.Vector3(Math.sin(tr), 0.02, -Math.cos(tr));
        o.model.up.set(0, 1, 0);
        o.model.lookAt(o.model.position.clone().add(fwd));
        updateAircraftLights(o.model, tSec + p.hex.charCodeAt(0));
        // contrail behind aircraft that cruise high
        if (altKm > 7) {
          if (!o.trail) { o.trail = dynLine(16, new THREE.Color(0.95, 0.97, 1), contrailMat); scene.add(o.trail.obj); }
          const pts = [];
          for (let i = 0; i < 16; i++) {
            const back = destinationPoint(pos.lat, pos.lon, (p.track + 180) % 360, i * 0.9);
            const lk = lookAngle(place.lat, place.lon, back.lat, back.lon, altKm);
            pts.push(altAzVec(lk.el, lk.az, PLANE_R + 0.2));
          }
          o.trail.set(pts, (i, n) => 0.9 * (1 - i / n) * (visible ? 1 : 0));
          o.trail.obj.visible = opts.planes;
        }
      } else if (o.trail) o.trail.obj.visible = false;
      // arrival ping: the plane just rose above the horizon
      const isAbove = look.el > 1.5;
      if (isAbove && !o.above && o.firstSeen !== null && alpha > 0.9) api.onArrival && api.onArrival(rec);
      if (o.firstSeen === null) o.firstSeen = tSec;
      o.above = isAbove;
      list.push(rec);
    }
    list.sort((a, b) => a.slantKm - b.slantKm);
    api.planesNow = list;
  }

  // ------------------------------------------------------------------ camera, input
  const sensor = { alpha: 0, beta: 90, gamma: 0, orient: 0, have: false, handler: null };
  const zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  function updateCamera() {
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
    if (view.sensor && sensor.have) {
      eul.set(sensor.beta * DEG, sensor.alpha * DEG, -sensor.gamma * DEG, "YXZ");
      camera.quaternion.setFromEuler(eul).multiply(q1).multiply(q0.setFromAxisAngle(zee, -sensor.orient * DEG));
      const f = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const aa = vectorToAltAz(f);
      view.yaw = aa.az; view.pitch = aa.alt;
    } else {
      const f = altAzToVector(view.pitch, view.yaw);
      camera.up.set(0, 1, 0);
      camera.lookAt(f.x, f.y, f.z);
    }
    camera.updateMatrixWorld();
  }
  api.drag = (dx, dy) => {
    if (view.sensor) return;
    const k = view.fov / Math.max(1, renderer.domElement.clientHeight);
    view.yaw = (view.yaw - dx * k + 360) % 360;
    view.pitch = clamp(view.pitch + dy * k, -30, 89.5);
  };
  api.zoom = (factor) => { view.fov = clamp(view.fov * factor, 25, 100); };
  api.lookAt = (alt, az, ms = 900) => {
    const from = { yaw: view.yaw, pitch: view.pitch }, t0 = performance.now();
    const dYaw = norm180(az - from.yaw);
    api.anim = (now) => {
      const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      view.yaw = (from.yaw + dYaw * e + 360) % 360;
      view.pitch = from.pitch + (clamp(alt, -10, 85) - from.pitch) * e;
      if (k >= 1) api.anim = null;
    };
  };
  api.tickAnim = (now) => { if (api.anim) api.anim(now); };

  api.sensor = {
    supported: () => typeof window !== "undefined" && "DeviceOrientationEvent" in window,
    async enable() {
      try {
        if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== "granted") return false;
        }
      } catch { return false; }
      const handler = (ev) => {
        if (ev.alpha == null && ev.webkitCompassHeading == null) return;
        const alpha = ev.webkitCompassHeading != null ? 360 - ev.webkitCompassHeading : ev.alpha;
        sensor.alpha = alpha; sensor.beta = ev.beta ?? 90; sensor.gamma = ev.gamma ?? 0;
        sensor.orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        sensor.have = true;
      };
      sensor.handler = handler;
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
      view.sensor = true;
      return true;
    },
    disable() {
      if (sensor.handler) { window.removeEventListener("deviceorientationabsolute", sensor.handler, true); window.removeEventListener("deviceorientation", sensor.handler, true); }
      sensor.handler = null; sensor.have = false; view.sensor = false;
    },
    // used by tests
    _feed(alpha, beta, gamma, orient = 0) { sensor.alpha = alpha; sensor.beta = beta; sensor.gamma = gamma; sensor.orient = orient; sensor.have = true; view.sensor = true; },
  };

  // ------------------------------------------------------------------ projection, picking, labels
  const _p = new THREE.Vector3();
  api.project = (v, w, h) => {
    _p.copy(v).project(camera);
    return { x: (_p.x * 0.5 + 0.5) * w, y: (-_p.y * 0.5 + 0.5) * h, front: _p.z < 1 && _p.z > -1 };
  };
  api.dirOf = (alt, az, r = 45) => altAzVec(alt, az, r);

  api.pick = (px, py, w, h, date) => {
    let best = null;
    const consider = (item, v, bias, radius) => {
      const s = api.project(v, w, h);
      if (!s.front) return;
      const d = Math.hypot(s.x - px, s.y - py) - bias;
      if (d < radius && (!best || d < best.d)) best = { item, d };
    };
    for (const r of api.planesNow) if (r.el > -0.2 && opts.planes) consider({ kind: "plane", hex: r.p.hex, rec: r }, r.o.model.position, 6, 40);
    if (info.moon && info.moon.alt > -1) consider({ kind: "moon" }, api.frame.moonPos, 8, 40);
    for (const p of info.planets) if (p.alt > 0) consider({ kind: "planet", name: p.name }, altAzVec(p.alt, p.az, 48), 4, 30);
    if (opts.satellites) {
      const night = satU.night.value;
      for (const c of scan.list) {
        if (c.el < 0) continue;
        const stationLike = D.swarm[c.idx].type === 4;
        const shown = (c.lit && night > 0.3) || opts.showAll || (stationLike && c.lit && night > 0.1);
        if (!shown) continue;
        const t = D.swarm[c.idx].type;
        const vis = t === 1 ? satU.show.value.y : t === 3 ? satU.show.value.z : satU.show.value.x;
        if (!vis) continue;
        consider({ kind: "sat", idx: c.idx, rec: c }, altAzVec(c.el, c.az, SKY_R), stationLike ? 8 : 0, 26);
      }
    }
    if (basis) {
      const ns = meta.starNames || {};
      for (const key of Object.keys(ns)) {
        const i = Number(key);
        if (D.stars.mag[i] > info.limitMag) continue;
        const v = applyBasis(basis, D.stars.ra[i], D.stars.dec[i]);
        if (v.y < 0) continue;
        consider({ kind: "star", i, name: ns[key] }, vec(v, SKY_R), 0, 22);
      }
    }
    return best ? best.item : null;
  };

  // look angles (alt, az) of an item in the current sky
  api.altAzOf = (item, date) => {
    if (!item) return null;
    if (item.kind === "plane") { const r = api.planesNow.find((x) => x.p.hex === item.hex); return r ? { alt: r.el, az: r.az } : null; }
    if (item.kind === "sat") { const l = swarmLook(D.swarm[item.idx], date, place.lat, place.lon); return { alt: l.el, az: l.az, lit: l.sunlit }; }
    if (item.kind === "moon") return info.moon ? { alt: info.moon.alt, az: info.moon.az } : null;
    if (item.kind === "planet") { const p = info.planets.find((x) => x.name === item.name); return p ? { alt: p.alt, az: p.az } : null; }
    if (item.kind === "star") { const h = raDecToAltAz(D.stars.ra[item.i], D.stars.dec[item.i], place.lat, place.lon, date); return { alt: h.alt, az: h.az }; }
    return null;
  };

  const sel = { item: null };
  api.sel = sel;
  api.select = (item, date) => {
    sel.item = item;
    satU.selIdx.value = item && item.kind === "sat" ? item.idx : -1;
    passLine.clear();
    if (item && item.kind === "sat") {
      const s = D.swarm[item.idx];
      const passes = findPasses((d) => swarmLook(s, d, place.lat, place.lon), (d) => sunAltAz(place.lat, place.lon, d).alt, new Date(date.getTime() - 6 * 60000), 12, { stepSec: 20, minEl: 5 });
      sel.passes = passes;
      const next = passes.find((p) => p.set.getTime() > date.getTime());
      if (next) passLine.set(next.track.map((q) => altAzVec(q.el, q.az, SKY_R - 0.5)), (i, n) => 0.9);
    }
  };
  api.updateSelection = () => {
    if (!sel.item) { selRing.visible = false; return; }
    const aa = api.altAzOf(sel.item, clock.now());
    if (!aa || aa.alt < -2) { selRing.visible = false; return; }
    const v = altAzVec(aa.alt, aa.az, sel.item.kind === "plane" ? PLANE_R - 0.5 : sel.item.kind === "moon" ? 46 : 47);
    selRingGeo.attributes.position.setXYZ(0, v.x, v.y, v.z);
    selRingGeo.attributes.position.needsUpdate = true;
    selRing.visible = true;
  };

  api.labelPoints = () => {
    if (!place) return [];
    const out = [];
    const cardinals = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SW", 225], ["W", 270], ["NW", 315]];
    for (const [t, az] of cardinals) out.push({ id: "c" + t, text: t, pos: altAzVec(2.5, az, 45), cls: "cardinal" });
    if (info.moon && info.moon.alt > 0) out.push({ id: "moon", text: "Moon", pos: api.frame.moonPos.clone().add(new THREE.Vector3(0, 1.8, 0)), cls: "body", item: { kind: "moon" } });
    for (const p of info.planets) if (p.alt > 2 && (p.mag ?? 3) < 2.2 && satU.night.value > 0.15) out.push({ id: "p" + p.name, text: p.name, pos: altAzVec(p.alt, p.az, 48).add(new THREE.Vector3(0, 1.2, 0)), cls: "body", item: { kind: "planet", name: p.name } });
    if (info.sunAlt > -1) { const s = altAzVec(info.sunAlt, info.sunAz, 48); out.push({ id: "sun", text: "Sun", pos: s.add(new THREE.Vector3(0, 3.5, 0)), cls: "body" }); }
    api.planesNow.slice(0, PLANE_LABELS).forEach((r) => { if (r.el > 1 && opts.planes) out.push({ id: "pl" + r.p.hex, text: r.p.call || r.p.hex, pos: r.o.model.position.clone().add(new THREE.Vector3(0, 1.1, 0)), cls: "plane", item: { kind: "plane", hex: r.p.hex } }); });
    if (basis && opts.labels && satU.night.value > 0.1) {
      const ns = meta.starNames || {};
      const named = Object.keys(ns).map(Number).filter((i) => D.stars.mag[i] < Math.min(info.limitMag, 2.2)).sort((a, b) => D.stars.mag[a] - D.stars.mag[b]).slice(0, 16);
      for (const i of named) { const v = applyBasis(basis, D.stars.ra[i], D.stars.dec[i]); if (v.y > 0.03) out.push({ id: "s" + i, text: ns[i], pos: vec(v, SKY_R).add(new THREE.Vector3(0, 1, 0)), cls: "star", item: { kind: "star", i, name: ns[i] } }); }
    }
    if (sel.item && sel.item.kind === "sat") {
      const aa = api.altAzOf(sel.item, clock.now());
      if (aa && aa.alt > 0) out.push({ id: "sel", pos: altAzVec(aa.alt, aa.az, 47).add(new THREE.Vector3(0, 1.4, 0)), cls: "sel", item: sel.item });
    }
    return out;
  };

  api.scanOnly = (date) => { if (place && (job || date.getTime() - scan.t > 2500 || date.getTime() < scan.t)) scanSatellites(date); };
  // Move the picture up by px pixels (used when a card covers the lower part of the screen).
  api.setViewShift = (px, w, h) => {
    if (Math.abs(px) < 0.5) { if (camera.view && camera.view.enabled) { camera.clearViewOffset(); } return; }
    camera.setViewOffset(w, h, 0, px, w, h);
  };
  api.resize = (w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); };
  api.setLayers = (l) => { satU.show.value.set(l.sats ? 1 : 0, l.starlink ? 1 : 0, l.debris ? 1 : 0, 1); };
  return api;
}
