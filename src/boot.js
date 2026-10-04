// Shared start-up: loads data and textures, creates the renderer and the clock.
import * as THREE from "three";
import "./engine.js";
import { loadCore, loadLater, expandSwarm, TEXTURES } from "./data.js";
import { loadTexture, tierFor, TIER_SETTINGS } from "./engine.js";

// The prototype data is a snapshot. If the visitor opens the page within 36 hours of the snapshot the clock is real time,
// otherwise it counts forward from the snapshot so the picture stays consistent with the data.
export function makeClock(snapshotMs) {
  const loadedAt = performance.now();
  const real = Date.now();
  const useReal = real >= snapshotMs - 5 * 60000 && real - snapshotMs < 36 * 3600000;
  const base = useReal ? real : snapshotMs;
  const state = { rate: 1, offsetMs: 0, simulated: !useReal, base, loadedAt, lastReal: performance.now(), acc: 0 };
  return {
    state,
    now() { return new Date(state.base + state.acc + state.offsetMs); },
    tick() { const t = performance.now(); state.acc += (t - state.lastReal) * state.rate; state.lastReal = t; },
    setRate(r) { state.rate = r; },
    reset() { state.rate = 1; state.acc = performance.now() - state.loadedAt; state.offsetMs = 0; state.lastReal = performance.now(); },
  };
}

export async function boot({ canvas, quality = "auto", onProgress = () => {} }) {
  const tier = tierFor(quality);
  const tset = TIER_SETTINGS[tier];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tset.antialias, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x03050a, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tset.pixelRatio));
  const core = await loadCore(onProgress);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = {};
  const names = Object.entries(TEXTURES);
  await Promise.all(names.map(([k, f]) => loadTexture(f, { anisotropy: aniso, wrapS: THREE.RepeatWrapping }).then((t) => { tex[k] = t; core.onTexture(f); })));
  const D = { ...core, swarm: expandSwarm(core), later: null };
  D.quakes.events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const clock = makeClock(Date.parse(D.meta.taken));
  return { THREE, renderer, D, tex, clock, tier, settings: { tier }, aniso };
}

export function startLater(app, cb) {
  return loadLater(app.D.live).then((later) => { app.D.later = later; if (cb) cb(later); return later; });
}
