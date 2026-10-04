// The orbit view: Earth seen from space, with satellites, quakes, hazards, aurora and selection overlays.
// Scene units: the Earth has radius 1. The scene is Earth-fixed, so the Sun and the stars move, not the planet.
import * as THREE from "three";
import {
  DEG, EARTH_RADIUS_KM, clamp, subsolarPoint, gmstDeg, swarmPositionFast, ecefToGeodetic, footprintRadiusKm, circlePoints,
  latLonToUnit, waveSurfaceReachKm, P_WAVE_KM_S, S_WAVE_KM_S, swarmPositionEci,
} from "./core.js";
import * as S from "./shaders.js";
import { latLonVec, vecToLatLon, eqVec, ease, glowTexture, gridTexture, polylinesToSegments, TIER_SETTINGS, ribbonMaterial, dynLine } from "./engine.js";
import { buildStarfield } from "./stars.js";
import { issModel, starlinkModel, satelliteModel, rocketBodyModel, debrisModel } from "./models.js";

const R_KM = EARTH_RADIUS_KM;
const MMI_COLORS = [[0.55, 0.9, 0.6], [0.62, 0.92, 0.45], [0.9, 0.92, 0.35], [1, 0.8, 0.25], [1, 0.55, 0.2], [1, 0.3, 0.2], [0.95, 0.15, 0.35], [0.8, 0.1, 0.55], [0.7, 0.1, 0.7], [0.6, 0.1, 0.8]];
const mmiColor = (v) => { const c = MMI_COLORS[clamp(Math.round(v) - 1, 0, 9)]; return new THREE.Color(c[0], c[1], c[2]); };

export function createOrbit(ctx) {
  const { renderer, D, tex, settings, clock } = ctx;
  const meta = D.meta;
  const tier = settings.tier;
  const tset = TIER_SETTINGS[tier];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 600);
  const uni = { time: { value: 0 }, pr: { value: 1 }, sizeScale: { value: 1 } };
  const sunDir = new THREE.Vector3(1, 0, 0);
  const api = { scene, camera, sunDir };

  // ------------------------------------------------------------------ the sky behind the Earth
  const field = buildStarfield(D, uni, { magLimit: 6.2, dark: 0.95, milky: 0.8 });
  const celestial = field.group;
  scene.add(celestial);
  api.milkyWay = field.milky;
  api.constellations = field.lines;

  // ------------------------------------------------------------------ Earth
  const earthU = {
    dayTex: { value: tex.day }, nightTex: { value: tex.night }, waterTex: { value: tex.water }, reliefTex: { value: tex.relief }, cloudTex: { value: tex.clouds },
    sunDir: { value: sunDir }, cloudShadow: { value: 1 }, texel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) },
    cutN: { value: new THREE.Vector3(0, 0, 1) }, cutOn: { value: 0 },
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({ vertexShader: S.EARTH_VERT, fragmentShader: S.EARTH_FRAG, uniforms: earthU }));
  scene.add(earth);
  api.earth = earth;
  api.earthU = earthU;

  const cloudU = { cloudTex: earthU.cloudTex, sunDir: { value: sunDir }, cutN: earthU.cutN, cutOn: earthU.cutOn };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({
    vertexShader: S.CLOUD_VERT, fragmentShader: S.CLOUD_FRAG, uniforms: cloudU, transparent: true, depthWrite: false,
  }));
  clouds.renderOrder = 1;
  scene.add(clouds);
  api.clouds = clouds;

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.28, 64, 32), new THREE.ShaderMaterial({
    vertexShader: S.ATMO_VERT, fragmentShader: S.ATMO_FRAG, uniforms: { sunDir: { value: sunDir } },
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
  }));
  atmo.renderOrder = 3;
  scene.add(atmo);

  // aurora oval from the NOAA grid (probability per degree), drawn as a glowing shell
  const auroraTex = gridTexture(D.aurora, 360, 181);
  const auroraU = { gridTex: { value: auroraTex }, time: uni.time, sunDir: { value: sunDir }, strength: { value: 1.5 } };
  const aurora = new THREE.Mesh(new THREE.SphereGeometry(1.014, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({
    vertexShader: S.EARTH_VERT, fragmentShader: S.AURORA_SHELL_FRAG, uniforms: auroraU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  aurora.renderOrder = 2;
  scene.add(aurora);
  api.aurora = aurora;

  // coastlines, faint, mostly useful on the night side
  {
    const polys = D.coast.map((line) => line.map(([lat, lon]) => latLonVec(lat, lon, 1.0016)));
    const g = polylinesToSegments(polys, new THREE.Color(0.55, 0.75, 1), 0.2);
    const coast = new THREE.LineSegments(g, ribbonMaterial({ cull: 1, opacity: 1 }));
    coast.renderOrder = 2;
    scene.add(coast);
    api.coast = coast;
  }

  // Sun glare
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff }));
  sunSprite.scale.setScalar(14);
  scene.add(sunSprite);

  // lights for the 3D models
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
  const fill = new THREE.DirectionalLight(0x4d78c8, 0.45);
  const amb = new THREE.AmbientLight(0x4a5470, 0.7);
  scene.add(sunLight, fill, amb);

  // ------------------------------------------------------------------ satellite swarm
  const N = D.swarm.length;
  const swarmU = {
    tMin: { value: 0 }, gmst: { value: 0 }, obs: { value: new THREE.Vector3(1, 0, 0) }, show: { value: new THREE.Vector4(1, 1, 1, 1) },
    pr: uni.pr, sizeScale: uni.sizeScale, selIdx: { value: -1 },
  };
  const swarmGeo = new THREE.BufferGeometry();
  {
    const el1 = new Float32Array(N * 4), el2 = new Float32Array(N * 4), el3 = new Float32Array(N * 3), idx = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const s = D.swarm[k];
      el1.set([(s.epochMs - meta.ref) / 60000, s.n, s.e, s.i], k * 4);
      el2.set([s.raan, s.argp, s.ma, s.type], k * 4);
      el3.set([s.a / R_KM, s.raanDot, s.argpDot], k * 3);
      idx[k] = k;
    }
    swarmGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    swarmGeo.setAttribute("el1", new THREE.BufferAttribute(el1, 4));
    swarmGeo.setAttribute("el2", new THREE.BufferAttribute(el2, 4));
    swarmGeo.setAttribute("el3", new THREE.BufferAttribute(el3, 3));
    swarmGeo.setAttribute("aIdx", new THREE.BufferAttribute(idx, 1));
  }
  const swarm = new THREE.Points(swarmGeo, new THREE.ShaderMaterial({
    vertexShader: S.SWARM_VERT, fragmentShader: S.SWARM_FRAG, uniforms: swarmU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  swarm.frustumCulled = false;
  swarm.renderOrder = 4;
  scene.add(swarm);
  api.swarm = swarm;
  api.swarmGeo = swarmGeo;

  // objects launched in the last 30 days get a gold pulse
  const newIdx = meta.newIdx || [];
  const newU = { ...swarmU, show: { value: new THREE.Vector4(1, 1, 1, 1) }, sizeScale: { value: 7 }, time: uni.time, selIdx: { value: -1 } };
  const newPoints = (() => {
    const g = new THREE.BufferGeometry();
    const sub = (name, size) => {
      const src = swarmGeo.attributes[name].array, out = new Float32Array(newIdx.length * size);
      newIdx.forEach((k, i) => out.set(src.subarray(k * size, k * size + size), i * size));
      g.setAttribute(name, new THREE.BufferAttribute(out, size));
    };
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(newIdx.length * 3), 3));
    sub("el1", 4); sub("el2", 4); sub("el3", 3); sub("aIdx", 1);
    const p = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: S.SWARM_VERT, fragmentShader: S.NEW_FRAG, uniforms: newU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    p.frustumCulled = false;
    p.renderOrder = 5;
    return p;
  })();
  scene.add(newPoints);
  api.newPoints = newPoints;

  // ------------------------------------------------------------------ quakes and hazards
  const markerItems = [];
  const markerGeo = new THREE.BufferGeometry();
  const markerU = { time: uni.time, pr: uni.pr, sizeScale: uni.sizeScale, showQH: { value: new THREE.Vector2(1, 1) } };
  let markers = null;
  function buildMarkers() {
    const nowMs = clock.now().getTime();
    const pos = [], kind = [], size = [], phase = [];
    markerItems.length = 0;
    const add = (item, lat, lon, k, sz) => {
      const v = latLonVec(lat, lon, 1.004);
      pos.push(v.x, v.y, v.z); kind.push(k); size.push(sz); phase.push(Math.random());
      markerItems.push(item);
    };
    for (const q of D.quakes.events) {
      const age = nowMs - Date.parse(q.time);
      add({ kind: "quake", q }, q.lat, q.lon, age < 3 * 3600e3 ? 4 : 3, clamp(7 + (q.mag - 2) * 8, 8, 56));
    }
    for (const e of D.events) {
      if (e.type === "EQ" || e.type === "DR") continue;
      const k = e.type === "TC" ? 1 : e.type === "FL" ? 2 : 0;
      add({ kind: "event", e }, e.lat, e.lon, k, k === 1 ? 34 : k === 2 ? 22 : 14);
    }
    markerGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    markerGeo.setAttribute("kind", new THREE.BufferAttribute(new Float32Array(kind), 1));
    markerGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(size), 1));
    markerGeo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(phase), 1));
    if (!markers) {
      markers = new THREE.Points(markerGeo, new THREE.ShaderMaterial({ vertexShader: S.MARKER_VERT, fragmentShader: S.MARKER_FRAG, uniforms: markerU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      markers.frustumCulled = false;
      markers.renderOrder = 6;
      scene.add(markers);
      api.markers = markers;
    }
  }
  buildMarkers();
  // after a live update of D.quakes or D.events
  api.refreshMarkers = buildMarkers;
  // after D.aurora was overwritten in place with a new grid
  api.refreshAurora = () => { auroraTex.needsUpdate = true; };


  // ------------------------------------------------------------------ fire detections and storm tracks (live feeds; absent in a snapshot)
  const fireU = { pr: uni.pr, sizeScale: uni.sizeScale };
  const fireGeo = new THREE.BufferGeometry();
  const fireMesh = new THREE.Points(fireGeo, new THREE.ShaderMaterial({ vertexShader: S.FIRE_VERT, fragmentShader: S.FIRE_FRAG, uniforms: fireU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  fireMesh.frustumCulled = false;
  fireMesh.renderOrder = 5;
  fireMesh.visible = false;
  scene.add(fireMesh);
  api.fires = fireMesh;
  // after D.hazards.fires was set or replaced: one point per cell, sized by fire radiative power (log scale) and brightest when newest
  api.refreshFires = () => {
    const f = D.hazards && D.hazards.fires;
    if (!f || !f.n) { fireMesh.userData.has = false; fireMesh.visible = false; return; }
    const pos = new Float32Array(f.n * 3), power = new Float32Array(f.n), fresh = new Float32Array(f.n), tmp = new THREE.Vector3();
    for (let i = 0; i < f.n; i++) {
      latLonVec(f.lat[i], f.lon[i], 1.003, tmp);
      pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
      power[i] = clamp(Math.log10(f.frp[i] + 1) / 3, 0, 1);
      fresh[i] = clamp(1 - f.minutesOld[i] / 1440, 0, 1);
    }
    fireGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    fireGeo.setAttribute("power", new THREE.BufferAttribute(power, 1));
    fireGeo.setAttribute("fresh", new THREE.BufferAttribute(fresh, 1));
    fireGeo.computeBoundingSphere();
    fireMesh.userData.has = true;
    fireMesh.visible = !!api.layers.fires;
  };

  const stormGroup = new THREE.Group();
  stormGroup.renderOrder = 5;
  scene.add(stormGroup);
  api.stormLines = stormGroup;
  const arc = (a, b, steps, r) => {  // points along the great circle from a to b, kept on the sphere
    const va = latLonVec(a[1], a[0], r), vb = latLonVec(b[1], b[0], r), out = [];
    for (let i = 0; i <= steps; i++) out.push(va.clone().lerp(vb, i / steps).normalize().multiplyScalar(r));
    return out;
  };
  api.refreshStorms = () => {
    for (const c of [...stormGroup.children]) { stormGroup.remove(c); c.geometry.dispose(); }
    const st = D.hazards && D.hazards.storms;
    if (!st) return;
    const tracks = [], cones = [];
    for (const s of st.storms) {
      const pts = [[s.lon, s.lat], ...s.track.map((p) => [p.lon, p.lat])];
      const line = [];
      for (let i = 0; i + 1 < pts.length; i++) line.push(...arc(pts[i], pts[i + 1], 8, 1.007));
      if (line.length) tracks.push(line);
      for (const ring of s.cone) {
        const loop = [];
        for (let i = 0; i < ring.length; i++) loop.push(...arc(ring[i], ring[(i + 1) % ring.length], 2, 1.006));
        cones.push(loop);
      }
    }
    const mk = (polys, color, alpha) => { const m = new THREE.LineSegments(polylinesToSegments(polys, color, alpha), ribbonMaterial({ cull: 1, opacity: 1 })); m.renderOrder = 5; stormGroup.add(m); };
    if (cones.length) mk(cones, new THREE.Color(0.45, 0.72, 1), 0.7);
    if (tracks.length) mk(tracks, new THREE.Color(1, 0.95, 0.85), 0.95);
    stormGroup.visible = !!api.layers.hazards;
  };

  // you are here
  const youGeo = new THREE.BufferGeometry();
  youGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const you = new THREE.Points(youGeo, new THREE.ShaderMaterial({
    vertexShader: S.YOU_VERT, fragmentShader: S.YOU_FRAG, uniforms: { time: uni.time, tint: { value: new THREE.Vector3(0.55, 1, 0.85) }, pr: uni.pr, sizeScale: uni.sizeScale },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  you.frustumCulled = false;
  you.renderOrder = 7;
  scene.add(you);
  let observer = null;
  api.setObserver = (city) => {
    observer = city;
    const v = latLonVec(city.lat, city.lon, 1.005);
    youGeo.attributes.position.setXYZ(0, v.x, v.y, v.z);
    youGeo.attributes.position.needsUpdate = true;
    swarmU.obs.value.copy(latLonVec(city.lat, city.lon, 1));
    newU.obs.value.copy(swarmU.obs.value);
  };

  // selection highlight (gold ring on whatever is selected)
  const selGeo = new THREE.BufferGeometry();
  selGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  selGeo.setAttribute("kind", new THREE.BufferAttribute(new Float32Array([4]), 1));
  selGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array([46]), 1));
  selGeo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array([0]), 1));
  const selPoint = new THREE.Points(selGeo, new THREE.ShaderMaterial({ vertexShader: S.MARKER_VERT, fragmentShader: S.MARKER_FRAG, uniforms: markerU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  selPoint.frustumCulled = false;
  selPoint.renderOrder = 8;
  selPoint.visible = false;
  scene.add(selPoint);

  // ------------------------------------------------------------------ overlays for the selected object
  const overlays = new THREE.Group();
  scene.add(overlays);
  const footLine = dynLine(97, new THREE.Color(0.55, 1, 0.86), ribbonMaterial({ cull: 1, opacity: 1 }));
  const trackLines = [dynLine(260, new THREE.Color(0.6, 0.8, 1), ribbonMaterial({ cull: 1 })), dynLine(260, new THREE.Color(0.6, 0.8, 1), ribbonMaterial({ cull: 1 }))];
  const orbitLine = dynLine(361, new THREE.Color(0.55, 1, 0.86), ribbonMaterial({ vertex: S.RIBBON_VERT, opacity: 1 }));
  const tether = dynLine(2, new THREE.Color(0.9, 1, 0.9), ribbonMaterial({ opacity: 0.8 }));
  const orbitGroup = new THREE.Group(); // the orbit ring is fixed in space, so it turns with the stars
  orbitGroup.add(orbitLine.obj);
  overlays.add(footLine.obj, trackLines[0].obj, trackLines[1].obj, tether.obj);
  scene.add(orbitGroup);
  const beamGeo = new THREE.BufferGeometry();
  const BEAM_N = 48;
  {
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((BEAM_N + 1) * 3), 3));
    const col = new Float32Array((BEAM_N + 1) * 3), al = new Float32Array(BEAM_N + 1);
    for (let i = 0; i <= BEAM_N; i++) { col.set([0.45, 1, 0.8], i * 3); al[i] = i === 0 ? 0.35 : 0.05; }
    beamGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    beamGeo.setAttribute("alpha", new THREE.BufferAttribute(al, 1));
    const idxs = [];
    for (let i = 1; i <= BEAM_N; i++) idxs.push(0, i, i === BEAM_N ? 1 : i + 1);
    beamGeo.setIndex(idxs);
  }
  const beam = new THREE.Mesh(beamGeo, ribbonMaterial({ fragment: S.BEAM_FRAG, side: THREE.DoubleSide, opacity: 1 }));
  beam.frustumCulled = false;
  beam.visible = false;
  overlays.add(beam);

  const models = { iss: issModel(), starlink: starlinkModel(), rocket: rocketBodyModel(), debris: debrisModel(3), sats: [satelliteModel(0), satelliteModel(1), satelliteModel(2)] };
  const modelHolder = new THREE.Group();
  modelHolder.visible = false;
  scene.add(modelHolder);
  let activeModel = null;

  // quake overlays
  const quakeGroup = new THREE.Group();
  scene.add(quakeGroup);
  let contourObj = null;
  const waveU = { centre: { value: new THREE.Vector3(1, 0, 0) }, rP: { value: 0 }, rS: { value: 0 }, fade: { value: 0 }, cutN: earthU.cutN, cutOn: earthU.cutOn };
  const waves = new THREE.Mesh(new THREE.SphereGeometry(1.0045, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({
    vertexShader: S.EARTH_VERT, fragmentShader: S.WAVE_FRAG, uniforms: waveU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  waves.renderOrder = 6;
  waves.visible = false;
  scene.add(waves);

  // ------------------------------------------------------------------ selection
  const sel = { item: null, lastFoot: 0, lastTrack: 0, lastOrbit: 0, alt: 0, lat: 0, lon: 0 };
  const replay = { active: false, q: null, tau: 0, speed: 1, live: false, paused: false, startedAt: 0, maxTau: 1700 };
  api.sel = sel;
  api.replay = replay;

  function satPosEcef(idx, date) {
    return swarmPositionFast(D.swarm[idx], date.getTime(), gmstDeg(date) * DEG);
  }

  function modelFor(idx) {
    const s = D.swarm[idx];
    const name = D.later ? D.later.names[idx] : "";
    if (/^ISS/.test(name)) return models.iss;
    if (s.type === 1) return models.starlink;
    if (s.type === 3) return models.debris;
    const id = D.later ? D.later.ids[idx] : idx;
    if (D.later) {
      const t = D.later.details[idx * 8 + 3];
      if (t === 1) return models.rocket;
      if (t === 2) return models.debris;
    }
    return models.sats[id % 3];
  }

  function clearSelection() {
    sel.item = null;
    footLine.clear(); trackLines[0].clear(); trackLines[1].clear(); orbitLine.clear(); tether.clear();
    beam.visible = false; modelHolder.visible = false; selPoint.visible = false;
    swarmU.selIdx.value = -1;
    waves.visible = false; replay.active = false;
    if (contourObj) { quakeGroup.remove(contourObj); contourObj.geometry.dispose(); contourObj = null; }
    earthU.cutOn.value = 0;
  }

  function select(item) {
    clearSelection();
    if (!item) return;
    sel.item = item;
    if (item.kind === "sat") {
      swarmU.selIdx.value = item.idx;
      sel.lastFoot = sel.lastTrack = sel.lastOrbit = 0;
      selPoint.visible = false;
      beam.visible = true;
      const m = modelFor(item.idx);
      if (activeModel) modelHolder.remove(activeModel);
      activeModel = m;
      modelHolder.add(m);
      updateSatOverlays(clock.now(), true);
    } else if (item.kind === "quake" || item.kind === "event") {
      const o = item.kind === "quake" ? item.q : item.e;
      const v = latLonVec(o.lat, o.lon, 1.006);
      selGeo.attributes.position.setXYZ(0, v.x, v.y, v.z);
      selGeo.attributes.position.needsUpdate = true;
      selPoint.visible = true;
      if (item.kind === "quake") startQuake(item.q);
    }
  }

  // ---- satellite overlays
  function updateSatOverlays(date, force = false) {
    if (!sel.item || sel.item.kind !== "sat") return;
    const idx = sel.item.idx;
    const t = date.getTime();
    const p = satPosEcef(idx, date);
    const g = ecefToGeodetic(p.x, p.y, p.z);
    sel.alt = g.hKm; sel.lat = g.lat; sel.lon = g.lon;
    const scenePos = new THREE.Vector3(p.x / R_KM, p.z / R_KM, -p.y / R_KM);
    sel.pos = scenePos;
    if (force || t - sel.lastFoot > 200) {
      sel.lastFoot = t;
      const radius = footprintRadiusKm(Math.min(g.hKm, 60000), 0);
      const ring = circlePoints(g.lat, g.lon, radius, BEAM_N).map((c) => latLonVec(c.lat, c.lon, 1.0025));
      footLine.set([...ring, ring[0]], () => 0.8);
      const bp = beamGeo.attributes.position;
      bp.setXYZ(0, scenePos.x, scenePos.y, scenePos.z);
      ring.forEach((v, i) => bp.setXYZ(i + 1, v.x, v.y, v.z));
      bp.needsUpdate = true;
      const down = latLonVec(g.lat, g.lon, 1.002);
      tether.set([scenePos, down], () => 0.7);
      sel.footprintKm = radius;
    }
    if (force || t - sel.lastTrack > 20000) {
      sel.lastTrack = t;
      const span = Math.min(110, (2 * Math.PI) / D.swarm[idx].n);
      const before = [], after = [];
      for (let m = -span * 0.5; m <= span * 0.5; m += 1) {
        const d2 = new Date(t + m * 60000);
        const q = satPosEcef(idx, d2);
        const gg = ecefToGeodetic(q.x, q.y, q.z);
        const v = latLonVec(gg.lat, gg.lon, 1.0022);
        (m <= 0 ? before : after).push(v);
      }
      // split at the date line
      const split = (arr) => {
        const out = [[]];
        for (let i = 0; i < arr.length; i++) {
          if (i && arr[i].distanceTo(arr[i - 1]) > 0.2) out.push([]);
          out[out.length - 1].push(arr[i]);
        }
        return out.sort((a, b) => b.length - a.length)[0];
      };
      trackLines[0].set(split(before), (i, n) => 0.1 + 0.6 * (i / n));
      trackLines[1].set(split(after), (i, n) => 0.7 - 0.6 * (i / n));
    }
    if (force || t - sel.lastOrbit > 120000) {
      sel.lastOrbit = t;
      const s = D.swarm[idx];
      const period = (2 * Math.PI) / s.n; // minutes
      const pts = [];
      for (let k = 0; k <= 180; k++) {
        const e = swarmPositionEci(s, t + (k / 180) * period * 60000);
        pts.push(new THREE.Vector3(e.x / R_KM, e.z / R_KM, -e.y / R_KM));
      }
      orbitLine.set(pts, () => 0.5);
    }
    // turn the orbit ring with the stars: scene-ECI rotation about Y by -gmst
    orbitGroup.rotation.y = -(gmstDeg(date) * DEG);
  }

  // ---- quake overlays and wave replay
  function startQuake(q, opts = {}) {
    const imp = D.later && D.later.impact ? D.later.impact[q.id] : null;
    if (contourObj) { quakeGroup.remove(contourObj); contourObj.geometry.dispose(); contourObj = null; }
    if (imp && imp.contours && imp.contours.length) {
      const polys = [];
      const colors = [];
      for (const c of imp.contours) polys.push(c.p.map(([lon, lat]) => latLonVec(lat, lon, 1.003)));
      const g = polylinesToSegments(polys, new THREE.Color(1, 0.6, 0.3), 1);
      const col = g.attributes.color.array;
      let k = 0;
      imp.contours.forEach((c, ci) => {
        const cc = mmiColor(c.v);
        for (let i = 0; i + 1 < c.p.length; i++) for (let j = 0; j < 2; j++) { col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b; k++; }
      });
      contourObj = new THREE.LineSegments(g, ribbonMaterial({ cull: 1, opacity: 1 }));
      contourObj.renderOrder = 5;
      quakeGroup.add(contourObj);
    }
    replay.active = true;
    api.autoFrame = true;
    replay.q = q;
    replay.paused = false;
    const ageSec = (clock.now().getTime() - Date.parse(q.time)) / 1000;
    replay.live = ageSec >= 0 && ageSec < replay.maxTau && !opts.forceReplay;
    replay.speed = replay.live ? 1 : (opts.speed || 40);
    replay.tau = replay.live ? ageSec : 0;
    replay.startedAt = performance.now();
    const c = latLonUnit3(q.lat, q.lon);
    waveU.centre.value.copy(c);
    waves.visible = true;
    waveU.fade.value = 1;
  }
  const latLonUnit3 = (lat, lon) => { const u = latLonToUnit(lat, lon); return new THREE.Vector3(u.x, u.y, u.z); };
  api.startQuake = (q, opts) => { if (!sel.item || sel.item.q !== q) select({ kind: "quake", q }); startQuake(q, opts); };
  api.setReplay = (o) => { Object.assign(replay, o); };

  function updateReplay(dtSec) {
    if (!replay.active || !replay.q) return;
    if (!replay.paused) {
      replay.tau += dtSec * replay.speed;
      if (replay.tau > replay.maxTau) {
        if (replay.live) { replay.tau = replay.maxTau; } else { replay.tau = 0; }
      }
    }
    const depth = Math.max(0, replay.q.depth || 10);
    const rP = waveSurfaceReachKm(replay.tau, depth, P_WAVE_KM_S) / R_KM;
    const rS = waveSurfaceReachKm(replay.tau, depth, S_WAVE_KM_S) / R_KM;
    waveU.rP.value = rP;
    waveU.rS.value = rS;
    replay.rPkm = rP * R_KM; replay.rSkm = rS * R_KM;
  }

  // ------------------------------------------------------------------ camera
  const cam = { mode: "globe", lat: 18, lon: 40, dist: 3.4, fAz: 0.9, fEl: 0.38, fD: 0.011, followIdx: -1 };
  let blend = null;
  let lastPose = { pos: new THREE.Vector3(0, 0, 4), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  const vel = { lat: 0, lon: 0 };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  // distance at which the whole globe fits the narrower side of the screen, with a little margin
  const aspectDist = () => {
    const halfV = (camera.fov / 2) * DEG;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    return clamp(1 / Math.sin(Math.min(halfV, halfH) / 1.12), 2.6, 9);
  };
  api.heroDist = aspectDist;
  api.cam = cam;
  api.idle = { since: performance.now(), auto: true };

  function desiredPose(out, date) {
    if (cam.mode === "follow" && cam.followIdx >= 0) {
      const p = satPosEcef(cam.followIdx, date);
      const p2 = satPosEcef(cam.followIdx, new Date(date.getTime() + 8000));
      const pos = _a.set(p.x / R_KM, p.z / R_KM, -p.y / R_KM);
      const R = pos.clone().normalize();
      const V = _b.set(p2.x / R_KM, p2.z / R_KM, -p2.y / R_KM).sub(pos).normalize();
      const T = V.sub(R.clone().multiplyScalar(V.dot(R))).normalize();
      const C = new THREE.Vector3().crossVectors(R, T);
      const off = T.clone().multiplyScalar(Math.cos(cam.fEl) * Math.cos(cam.fAz)).add(C.multiplyScalar(Math.cos(cam.fEl) * Math.sin(cam.fAz))).add(R.clone().multiplyScalar(Math.sin(cam.fEl))).multiplyScalar(cam.fD);
      out.target.copy(pos);
      out.pos.copy(pos).add(off);
      out.up.copy(R);
      out.satPos = pos.clone(); out.satT = T.clone(); out.satR = R.clone();
    } else {
      latLonVec(clamp(cam.lat, -86, 86), cam.lon, cam.dist, out.pos);
      out.target.set(0, 0, 0);
      out.up.set(0, 1, 0);
    }
    return out;
  }

  function startBlend(ms, bump = 0) {
    blend = { from: { pos: camera.position.clone(), target: lastPose.target.clone(), up: camera.up.clone() }, t0: performance.now(), dur: ms, bump };
  }

  api.autoFrame = false;
  api.flyTo = (lat, lon, dist, ms = 1900) => {
    const from = camera.position.clone();
    cam.mode = "globe"; cam.followIdx = -1;
    cam.lat = lat; cam.lon = lon; cam.dist = dist;
    const to = latLonVec(lat, lon, dist);
    const ang = from.angleTo(to);
    startBlend(Math.max(ms * 0.55, ms * clamp(ang / 2, 0.35, 1.25)), clamp(ang * 0.9, 0, 1.4));
    vel.lat = vel.lon = 0;
    api.idle.since = performance.now();
  };
  api.follow = (idx, ms = 2200) => {
    cam.mode = "follow"; cam.followIdx = idx;
    cam.fD = cam.fD || 0.011;
    startBlend(ms, 0.2);
  };
  api.unfollow = (ms = 1500) => {
    if (cam.mode !== "follow") return;
    const g = sel.lat !== undefined ? { lat: sel.lat, lon: sel.lon } : { lat: cam.lat, lon: cam.lon };
    api.flyTo(g.lat, g.lon, 2.6, ms);
  };
  api.select = select;
  api.clearSelection = clearSelection;

  api.drag = (dx, dy, dt) => {
    blend = null;
    api.autoFrame = false;
    api.idle.since = performance.now();
    if (cam.mode === "follow") {
      cam.fAz -= dx * 0.006; cam.fEl = clamp(cam.fEl + dy * 0.006, -1.3, 1.45);
      return;
    }
    const perPx = clamp(((cam.dist - 1) * (34 * DEG)) / Math.max(1, renderer.domElement.clientHeight), 0.00005, 0.02);
    const dLon = (-dx * perPx) / Math.max(0.25, Math.cos(cam.lat * DEG));
    const dLat = dy * perPx;
    cam.lon += dLon / DEG; cam.lat = clamp(cam.lat + dLat / DEG, -85, 85);
    if (dt > 0) { vel.lon = dLon / DEG / dt; vel.lat = dLat / DEG / dt; }
  };
  api.dragEnd = () => { vel.lon = clamp(vel.lon, -240, 240); vel.lat = clamp(vel.lat, -160, 160); };
  api.zoom = (factor) => {
    blend = null;
    api.autoFrame = false;
    api.idle.since = performance.now();
    if (cam.mode === "follow") cam.fD = clamp(cam.fD * factor, 0.0035, 0.3);
    else cam.dist = clamp(1 + (cam.dist - 1) * factor, 1.12, 12);
  };

  function applyCamera(dtSec, date) {
    // inertia
    if (cam.mode === "globe" && !blend) {
      if (Math.abs(vel.lon) > 0.02 || Math.abs(vel.lat) > 0.02) {
        cam.lon += vel.lon * dtSec; cam.lat = clamp(cam.lat + vel.lat * dtSec, -85, 85);
        const k = Math.exp(-dtSec * 3.2);
        vel.lon *= k; vel.lat *= k;
      } else if (api.idle.auto && performance.now() - api.idle.since > 7000 && !sel.item) {
        cam.lon += 1.6 * dtSec;
      }
    }
    const to = desiredPose({ pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3() }, date);
    let pos = to.pos, target = to.target, up = to.up;
    if (blend) {
      const k = Math.min(1, (performance.now() - blend.t0) / blend.dur);
      const e = ease(k);
      const f = blend.from;
      const da = f.pos.clone().normalize(), db = to.pos.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(da, db);
      const qi = new THREE.Quaternion().slerp(q, e);
      const ra = f.pos.length(), rb = to.pos.length();
      const r = Math.exp(Math.log(ra) * (1 - e) + Math.log(rb) * e) * (1 + blend.bump * Math.sin(Math.PI * e));
      pos = da.applyQuaternion(qi).multiplyScalar(r);
      target = f.target.clone().lerp(to.target, e);
      up = f.up.clone().lerp(to.up, e).normalize();
      if (k >= 1) blend = null;
    }
    camera.position.copy(pos);
    camera.up.copy(up);
    camera.lookAt(target);
    lastPose = { pos: pos.clone(), target: target.clone(), up: up.clone() };
    const dist = pos.length();
    const nearToTarget = pos.distanceTo(target);
    camera.near = cam.mode === "follow" ? clamp(Math.min(nearToTarget * 0.12, (dist - 1) * 0.1), 0.0003, 0.05) : clamp((dist - 1) * 0.08, 0.002, 0.6);
    camera.far = 600;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    api.satPose = to.satPos ? to : null;
  }

  // ------------------------------------------------------------------ per frame
  let lastMarkerRefresh = 0;
  api.layers = { sats: true, starlink: true, debris: true, quakes: true, hazards: true, fires: true, aurora: true, clouds: true, coast: true, constellations: false };
  api.setLayers = (l) => {
    Object.assign(api.layers, l);
    const L = api.layers;
    swarmU.show.value.set(L.sats ? 1 : 0, L.starlink ? 1 : 0, L.debris ? 1 : 0, 1);
    clouds.visible = L.clouds; aurora.visible = L.aurora; api.coast.visible = L.coast; api.constellations.visible = L.constellations;
    markerU.showQH.value.set(L.quakes ? 1 : 0, L.hazards ? 1 : 0);
    markers.visible = L.quakes || L.hazards;
    fireMesh.visible = !!L.fires && !!fireMesh.userData.has; stormGroup.visible = !!L.hazards;
  };
  api.refreshFires();
  api.refreshStorms();
  api.setLayers({});

  let lastT = performance.now();
  api.update = (date, tSec, dtSec) => {
    uni.time.value = tSec;
    uni.pr.value = renderer.getPixelRatio();
    const sub = subsolarPoint(date);
    const su = latLonToUnit(sub.lat, sub.lon);
    sunDir.set(su.x, su.y, su.z);
    sunSprite.position.copy(sunDir).multiplyScalar(60);
    sunLight.position.copy(sunDir).multiplyScalar(10);
    fill.position.copy(sunDir).multiplyScalar(-10);
    celestial.rotation.y = -(gmstDeg(date) * DEG);
    swarmU.tMin.value = (date.getTime() - meta.ref) / 60000;
    swarmU.gmst.value = gmstDeg(date) * DEG;
    newU.show.value.set(1, 1, 1, 1);
    uni.sizeScale.value = clamp(renderer.domElement.clientWidth / 900, 0.8, 1.35) * (tier === "low" ? 1.1 : 1);
    updateReplay(dtSec);
    // while a quake replays, pull the camera back so the expanding wave fronts stay in view
    if (api.autoFrame && replay.active && cam.mode === "globe" && !blend && sel.item && sel.item.kind === "quake") {
      const target = clamp(1.9 + ((replay.rPkm || 0) / R_KM) * 2.6, 1.9, 5.2);
      cam.dist += (target - cam.dist) * Math.min(1, dtSec * 1.8);
    }
    if (sel.item && sel.item.kind === "sat") updateSatOverlays(date);
    applyCamera(dtSec, date);
    // 3D model of the selected satellite appears when the camera is close
    if (sel.item && sel.item.kind === "sat" && sel.pos && activeModel) {
      const camDist = camera.position.distanceTo(sel.pos);
      const show = camDist < 0.6;
      modelHolder.visible = show;
      swarmU.selIdx.value = show && camDist < 0.08 ? -1 : sel.item.idx;
      if (show) {
        const size = activeModel.userData.size || 10;
        const wanted = clamp(camDist * 0.22, 0.0006, 0.08);
        activeModel.scale.setScalar(wanted / size);
        modelHolder.position.copy(sel.pos);
        const pose = api.satPose;
        const R = sel.pos.clone().normalize();
        const p2 = satPosEcef(sel.item.idx, new Date(date.getTime() + 8000));
        const V = new THREE.Vector3(p2.x / R_KM, p2.z / R_KM, -p2.y / R_KM).sub(sel.pos).normalize();
        const T = V.sub(R.clone().multiplyScalar(V.dot(R))).normalize();
        modelHolder.up.copy(R);
        modelHolder.lookAt(sel.pos.clone().add(T));
        // ISS truss runs across the flight path: model X axis is across track, which matches lookAt's +Z along track
      }
    }
    if (clock.now().getTime() - lastMarkerRefresh > 30000) { lastMarkerRefresh = clock.now().getTime(); buildMarkers(); }
    waves.visible = replay.active && !api.underMode;
    waveU.fade.value = replay.active ? 1 : 0;
    lastT = performance.now();
  };

  // ------------------------------------------------------------------ projection and picking
  const _p = new THREE.Vector3();
  api.project = (v, w, h) => {
    _p.copy(v).project(camera);
    return { x: (_p.x * 0.5 + 0.5) * w, y: (-_p.y * 0.5 + 0.5) * h, z: _p.z, front: _p.z < 1 && _p.z > -1 };
  };
  // Is a point on or above the Earth visible (not hidden behind the globe)?
  const hiddenByEarth = (p) => {
    const c = camera.position;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = clamp(-(c.x * dx + c.y * dy + c.z * dz) / len2, 0, 1);
    const qx = c.x + dx * t, qy = c.y + dy * t, qz = c.z + dz * t;
    return qx * qx + qy * qy + qz * qz < 0.9985 && t > 0 && t < 1;
  };
  api.hiddenByEarth = hiddenByEarth;

  api.pick = (px, py, w, h, date) => {
    let best = null;
    const consider = (item, x, y, bias, radius) => {
      const d = Math.hypot(x - px, y - py) - bias;
      if (d < radius && (!best || d < best.d)) best = { item, d };
    };
    const L = api.layers;
    if (markers.visible) {
      const pa = markerGeo.attributes.position.array;
      for (let i = 0; i < markerItems.length; i++) {
        const it = markerItems[i];
        if (it.kind === "quake" ? !L.quakes : !L.hazards) continue;
        _a.set(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
        if (hiddenByEarth(_a)) continue;
        const s = api.project(_a, w, h);
        if (!s.front) continue;
        const r = it.kind === "quake" ? 10 + it.q.mag * 2.2 : 16;
        consider(it, s.x, s.y, 4, Math.max(18, r));
      }
    }
    const t = date.getTime(), g = gmstDeg(date) * DEG;
    const show = swarmU.show.value;
    for (let k = 0; k < N; k++) {
      const s = D.swarm[k];
      if (s.a > 7.2 * R_KM) continue;
      const ty = s.type;
      const vis = ty === 1 ? show.y : ty === 3 ? show.z : show.x;
      if (!vis) continue;
      const p = swarmPositionFast(s, t, g);
      _b.set(p.x / R_KM, p.z / R_KM, -p.y / R_KM);
      if (hiddenByEarth(_b)) continue;
      const sc = api.project(_b, w, h);
      if (!sc.front) continue;
      const dx = sc.x - px, dy = sc.y - py;
      if (Math.abs(dx) > 26 || Math.abs(dy) > 26) continue;
      consider({ kind: "sat", idx: k }, sc.x, sc.y, ty === 4 ? 10 : ty === 0 ? 3 : 0, 24);
    }
    return best ? best.item : null;
  };

  // names for labels (screen positions are computed by the UI)
  api.labelPoints = (date) => {
    const out = [];
    if (observer) out.push({ id: "you", text: observer.name, pos: latLonVec(observer.lat, observer.lon, 1.01), cls: "you" });
    if (sel.item && sel.item.kind === "sat" && sel.pos && !modelHolder.visible) out.push({ id: "sel", pos: sel.pos.clone(), cls: "sel", item: sel.item });
    if (sel.item && (sel.item.kind === "quake" || sel.item.kind === "event")) {
      const o = sel.item.kind === "quake" ? sel.item.q : sel.item.e;
      out.push({ id: "sel", pos: latLonVec(o.lat, o.lon, 1.01), cls: "sel", item: sel.item });
    }
    return out;
  };

  // position of a swarm object right now, as scene vector
  api.satScenePos = (idx, date) => { const p = satPosEcef(idx, date); return new THREE.Vector3(p.x / R_KM, p.z / R_KM, -p.y / R_KM); };
  api.satGeo = (idx, date) => { const p = satPosEcef(idx, date); return ecefToGeodetic(p.x, p.y, p.z); };

  // Move the picture up by px pixels (used when a card covers the lower part of the screen).
  api.setViewShift = (px, w, h) => {
    if (Math.abs(px) < 0.5) { if (camera.view && camera.view.enabled) { camera.clearViewOffset(); } return; }
    camera.setViewOffset(w, h, 0, px, w, h);
  };
  api.resize = (w, h) => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  api.dispose = () => {};
  api.latLonOfCamera = () => vecToLatLon(camera.position);
  api.setHighTexture = (t) => { earthU.dayTex.value = t; };
  return api;
}
