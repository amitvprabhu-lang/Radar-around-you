// Shared start-up: loads data and textures, creates the renderer and the clock.
import * as THREE from "three";
import "./engine.js";
import { loadCore, loadLater, expandSwarm, TEXTURES } from "./data.js";
import { loadTexture, tierFor, TIER_SETTINGS, flipForReupload } from "./engine.js";
import { makeYield } from "./schedule.js";

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

// The textures the globe draws on its first frame; they are sent to the graphics card before it (the Moon's waits for the sky view).
export const FIRST_FRAME_TEXTURES = ["day", "night", "water", "relief", "clouds"];

// yieldFn lets the browser paint and handle input between the steps, so no single step holds the page for long.
export async function boot({ canvas, quality = "auto", onProgress = () => {}, yieldFn = makeYield() }) {
  const tier = tierFor(quality);
  const tset = TIER_SETTINGS[tier];
  // The texture downloads start first: they run on the network while the main thread sets up WebGL, which takes seconds on a slow
  // phone. The data files start after it, as before: loadCore gives the live manifest 2.5 s before it falls back to the bundled
  // snapshot, and a main thread blocked by the WebGL set-up inside that window made the timer win even when the manifest had
  // arrived (seen in e2e-live.mjs on a cold browser, 2026-10-06).
  const texPromises = Object.entries(TEXTURES).map(([k, f]) => loadTexture(f, { wrapS: THREE.RepeatWrapping, keepImage: k === "night" }).then((t) => [k, f, t]));
  // if WebGL fails below, these are never awaited; their own failures must not be reported as unhandled
  texPromises.forEach((p) => p.catch(() => {}));
  await yieldFn();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tset.antialias, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x03050a, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tset.pixelRatio));
  // three.js uploads every texture again after a lost context is restored; released bitmap textures then hold an <img> (engine.js)
  canvas.addEventListener("webglcontextlost", () => flipForReupload());
  await yieldFn();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const core = await loadCore(onProgress);
  const tex = {};
  await Promise.all(texPromises.map((p) => p.then(([k, f, t]) => { t.anisotropy = aniso; tex[k] = t; core.onTexture(f); })));
  await yieldFn();
  const D = { ...core, swarm: expandSwarm(core), later: null };
  D.quakes.events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  // one texture per task: each upload (and its mipmaps) is a large copy that would otherwise all land in the first frame
  for (const k of FIRST_FRAME_TEXTURES) { await yieldFn(); renderer.initTexture(tex[k]); }
  const clock = makeClock(Date.parse(D.meta.taken));
  return { THREE, renderer, D, tex, clock, tier, settings: { tier }, aniso };
}

export function startLater(app, cb) {
  return loadLater(app.D.live).then((later) => { app.D.later = later; if (cb) cb(later); return later; });
}
