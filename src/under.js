// The "Under" view: the Earth cut open along the plane through an earthquake and the viewer, with layers
// and seismic waves. Wave speeds are constants (P 8.0 km/s, S 4.5 km/s) and the paths are straight lines:
// a teaching simplification, not a travel-time model.
import * as THREE from "three";
import {
  DEG, EARTH_RADIUS_KM, clamp, sliceBasis, latLonToUnit, waveTravelSec, waveSurfaceReachKm, chordKm, P_WAVE_KM_S, S_WAVE_KM_S, haversineKm,
} from "./core.js";
import * as S from "./shaders.js";
import { latLonVec, glowTexture, TIER_SETTINGS, ribbonMaterial, dynLine } from "./engine.js";
import { buildStarfield } from "./stars.js";

const R_KM = EARTH_RADIUS_KM;
export const LAYERS = [
  { name: "Crust", fromKm: 0, toKm: 35 },
  { name: "Mantle", fromKm: 35, toKm: 2891 },
  { name: "Outer core", fromKm: 2891, toKm: 5150 },
  { name: "Inner core", fromKm: 5150, toKm: 6371 },
];
export function layerAtDepth(depthKm) {
  return LAYERS.find((l) => depthKm >= l.fromKm && depthKm < l.toKm) || LAYERS[0];
}

export function createUnder(ctx) {
  const { renderer, D, tex, settings } = ctx;
  const tset = TIER_SETTINGS[settings.tier];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 300);
  const uni = { time: { value: 0 }, pr: { value: 1 }, sizeScale: { value: 1 } };
  const api = { scene, camera };

  const field = buildStarfield(D, uni, { magLimit: 6.2, dark: 0.9, milky: 0.7 });
  scene.add(field.group);

  const cutN = new THREE.Vector3(0, 0, 1);
  const sunDir = new THREE.Vector3(0.3, 0.5, -0.6).normalize();
  const earthU = {
    dayTex: { value: tex.day }, nightTex: { value: tex.night }, waterTex: { value: tex.water }, reliefTex: { value: tex.relief }, cloudTex: { value: tex.clouds },
    sunDir: { value: sunDir }, cloudShadow: { value: 0 }, texel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) }, cutN: { value: cutN }, cutOn: { value: 1 },
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({ vertexShader: S.EARTH_VERT, fragmentShader: S.EARTH_FRAG, uniforms: earthU }));
  scene.add(earth);

  const sliceU = { focus2: { value: new THREE.Vector2(0.99, 0) }, rP: { value: 0 }, rS: { value: 0 }, time: uni.time, showWaves: { value: 1 }, km: { value: R_KM } };
  const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 160), new THREE.ShaderMaterial({ vertexShader: S.SLICE_VERT, fragmentShader: S.SLICE_FRAG, uniforms: sliceU, side: THREE.DoubleSide }));
  cap.matrixAutoUpdate = false;
  scene.add(cap);

  const waveU = { centre: { value: new THREE.Vector3(1, 0, 0) }, rP: { value: 0 }, rS: { value: 0 }, fade: { value: 1 }, cutN: earthU.cutN, cutOn: earthU.cutOn };
  const waves = new THREE.Mesh(new THREE.SphereGeometry(1.004, tset.sphere, tset.sphere / 2), new THREE.ShaderMaterial({
    vertexShader: S.EARTH_VERT, fragmentShader: S.WAVE_FRAG, uniforms: waveU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  waves.renderOrder = 3;
  scene.add(waves);

  const glow = glowTexture(128, [[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,230,160,0.9)"], [0.6, "rgba(255,150,60,0.25)"], [1, "rgba(255,120,40,0)"]]);
  const mkSprite = (color) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true })); s.renderOrder = 10; scene.add(s); return s; };
  const focusSprite = mkSprite(0xffffff);
  const userSprite = mkSprite(0x66ffd9);
  const pDot = mkSprite(0xffdd88), sDot = mkSprite(0xff6a88);
  const pathLine = dynLine(2, new THREE.Color(1, 1, 1), ribbonMaterial({ depthTest: false, opacity: 0.55 }));
  const depthLine = dynLine(2, new THREE.Color(1, 0.9, 0.6), ribbonMaterial({ depthTest: false, opacity: 0.9 }));
  pathLine.obj.renderOrder = 9; depthLine.obj.renderOrder = 9;
  scene.add(pathLine.obj, depthLine.obj);

  const st = { q: null, place: null, basis: null, chordKm: 0, theta: 0, tP: 0, tS: 0, focus: new THREE.Vector3(), user: new THREE.Vector3(), epi: new THREE.Vector3() };
  api.st = st;
  const replay = { tau: 0, speed: 40, live: false, paused: false, maxTau: 1700, rPkm: 0, rSkm: 0, startedAt: 0 };
  api.replay = replay;

  const cam = { yaw: 24, pitch: 22, zoom: 1 };
  let fit = 3.15;
  api.cam = cam;

  api.setQuake = (q, place, clockNow) => {
    st.q = q; st.place = place;
    const depth = Math.max(0, q.depth || 10);
    const b = sliceBasis(q.lat, q.lon, place.lat, place.lon);
    st.basis = b;
    st.theta = b.theta;
    st.surfaceKm = b.theta * R_KM;
    const bx = new THREE.Vector3(b.x.x, b.x.y, b.x.z), by = new THREE.Vector3(b.y.x, b.y.y, b.y.z), bn = new THREE.Vector3(b.n.x, b.n.y, b.n.z);
    cutN.copy(bn);
    cap.matrix.makeBasis(bx, by, bn);
    cap.matrixWorldNeedsUpdate = true;
    st.bx = bx; st.by = by; st.bn = bn;
    st.epi.copy(bx);
    st.focus.copy(bx).multiplyScalar(1 - depth / R_KM);
    st.user.copy(bx).multiplyScalar(Math.cos(b.theta)).addScaledVector(by, Math.sin(b.theta));
    st.depth = depth;
    st.chordKm = chordKm(st.surfaceKm, depth);
    st.tP = st.chordKm / P_WAVE_KM_S;
    st.tS = st.chordKm / S_WAVE_KM_S;
    sliceU.focus2.value.set(1 - depth / R_KM, 0);
    waveU.centre.value.copy(bx);
    focusSprite.position.copy(st.focus);
    userSprite.position.copy(st.user);
    const ageSec = clockNow ? (clockNow.getTime() - Date.parse(q.time)) / 1000 : -1;
    replay.live = ageSec >= 0 && ageSec < replay.maxTau;
    replay.tau = replay.live ? ageSec : 0;
    replay.speed = replay.live ? 1 : 40;
    replay.paused = false;
    pathLine.set([st.focus, st.user], () => 0.6);
    depthLine.set([st.epi.clone().multiplyScalar(1.0), st.focus], () => 0.8);
    cam.yaw = 22; cam.pitch = 24; cam.zoom = 1;
  };

  // the width from the last resize (main.js calls resize at start and on every window resize); reading clientWidth in every frame forced a
  // style pass after the previous frame's label writes (Lighthouse 13: forced reflow)
  let viewW = 0;
  api.update = (date, tSec, dtSec) => {
    uni.time.value = tSec;
    uni.pr.value = renderer.getPixelRatio();
    uni.sizeScale.value = clamp((viewW || renderer.domElement.clientWidth) / 900, 0.8, 1.35);
    if (!st.q) return;
    if (!replay.paused) {
      replay.tau += dtSec * replay.speed;
      if (replay.tau > replay.maxTau) replay.tau = replay.live ? replay.maxTau : 0;
    }
    const depth = st.depth;
    const rPkm = replay.tau * P_WAVE_KM_S, rSkm = replay.tau * S_WAVE_KM_S;
    replay.rPkm = rPkm; replay.rSkm = rSkm;
    sliceU.rP.value = rPkm; sliceU.rS.value = rSkm;
    waveU.rP.value = waveSurfaceReachKm(replay.tau, depth, P_WAVE_KM_S) / R_KM;
    waveU.rS.value = waveSurfaceReachKm(replay.tau, depth, S_WAVE_KM_S) / R_KM;
    // wave dots travelling along the straight path to the viewer
    const kP = clamp(rPkm / st.chordKm, 0, 1), kS = clamp(rSkm / st.chordKm, 0, 1);
    pDot.position.copy(st.focus).lerp(st.user, kP);
    sDot.position.copy(st.focus).lerp(st.user, kS);
    pDot.visible = replay.tau > 0 && kP < 1.0001; sDot.visible = replay.tau > 0;
    const pulse = 1 + 0.18 * Math.sin(tSec * 5);
    focusSprite.scale.setScalar(0.1 * pulse); userSprite.scale.setScalar(0.1);
    pDot.scale.setScalar(0.06); sDot.scale.setScalar(0.06);
    replay.arrivedP = replay.tau >= st.tP; replay.arrivedS = replay.tau >= st.tS;
    // camera orbit around the plane normal
    const yaw = cam.yaw * DEG, pitch = cam.pitch * DEG;
    const dir = st.bn.clone().multiplyScalar(Math.cos(pitch) * Math.cos(yaw)).addScaledVector(st.bx, Math.cos(pitch) * Math.sin(yaw)).addScaledVector(st.by, Math.sin(pitch)).normalize();
    camera.position.copy(dir).multiplyScalar(fit * cam.zoom);
    camera.up.copy(st.by);
    camera.lookAt(0, 0, 0);
    camera.near = 0.05; camera.far = 300;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  api.drag = (dx, dy) => {
    cam.yaw = clamp(cam.yaw - dx * 0.25, -70, 70);
    cam.pitch = clamp(cam.pitch + dy * 0.25, -55, 70);
  };
  api.zoom = (f) => { cam.zoom = clamp(cam.zoom * f, 0.55, 1.8); };
  // Move the picture up by px pixels (used when a card covers the lower part of the screen).
  api.setViewShift = (px, w, h) => {
    if (Math.abs(px) < 0.5) { if (camera.view && camera.view.enabled) { camera.clearViewOffset(); } return; }
    camera.setViewOffset(w, h, 0, px, w, h);
  };
  // distance at which the whole disc (radius 1, plus room for labels) fits the narrower side of the screen
  api.resize = (w, h) => {
    viewW = w;
    camera.aspect = w / h;
    camera.fov = 34;
    const half = Math.min(camera.fov / 2, (Math.atan(Math.tan((camera.fov / 2) * DEG) * (w / h)) / DEG)) * DEG;
    fit = 1.5 / Math.tan(half);
    camera.updateProjectionMatrix();
  };
  api.setReplay = (o) => Object.assign(replay, o);

  const _p = new THREE.Vector3();
  api.project = (v, w, h) => { _p.copy(v).project(camera); return { x: (_p.x * 0.5 + 0.5) * w, y: (-_p.y * 0.5 + 0.5) * h, front: _p.z < 1 && _p.z > -1 }; };

  // labels: layer names inside the disc, epicentre, focus and the viewer
  api.labelPoints = () => {
    if (!st.q) return [];
    const at = (r, deg) => st.bx.clone().multiplyScalar(r * Math.cos(deg * DEG)).addScaledVector(st.by, r * Math.sin(deg * DEG)).addScaledVector(st.bn, 0.02);
    const away = st.theta < Math.PI / 2 ? 235 : 125; // put layer names on the side away from the wave path
    return [
      { id: "crust", text: "Crust", pos: at(1.07, away), cls: "layer out" },
      { id: "mantle", text: "Mantle", pos: at(0.78, away), cls: "layer" },
      { id: "outer", text: "Outer core", pos: at(0.38, away), cls: "layer" },
      { id: "inner", text: "Inner core", pos: at(0.1, away), cls: "layer" },
      { id: "focus", text: "Focus", pos: st.focus.clone().addScaledVector(st.bn, 0.03).addScaledVector(st.bx, -0.16).addScaledVector(st.by, 0.05), cls: "focus" },
      { id: "epi", text: "Epicentre", pos: st.epi.clone().multiplyScalar(1.05), cls: "epi" },
      { id: "you", text: st.place.name, pos: st.user.clone().multiplyScalar(1.07), cls: "you" },
    ];
  };
  return api;
}
