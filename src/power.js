// Low-power drawing for devices whose WebGL runs in software (no graphics card, or one the browser will not use).
// There every frame costs about a second of processor time, so the app draws on demand: at once and continuously for a few seconds
// after any input, view change, data change or camera move, and otherwise one frame every few seconds. The page then goes idle
// between frames. The choice depends only on what the device measures: the renderer's own name, or slow frames. Pure logic here;
// main.js wires it to the frame loop. Everything takes its inputs as arguments, so the tests drive it without a browser.

// Renderer names that mean software drawing: Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Microsoft Basic Render
// Driver, and any that says Software.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
export const isSoftwareRenderer = (name) => typeof name === "string" && SOFTWARE.test(name);

// The renderer's name: the unmasked one where the browser gives it, else the plain RENDERER string. Never throws.
export function rendererName(gl) {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const unmasked = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return String(unmasked || gl.getParameter(gl.RENDERER) || "");
  } catch { return ""; }
}

export const SLOW_FRAME_MS = 100;  // a median frame slower than this (under 10 frames a second) counts as slow
export const FRAME_SAMPLES = 8;    // frames measured before deciding on speed alone

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The decision. Returns { on, reason } once it can say, or null while it still needs frames.
export function decideLowPower({ renderer = "", frameTimes = [], slowMs = SLOW_FRAME_MS, samples = FRAME_SAMPLES } = {}) {
  if (isSoftwareRenderer(renderer)) return { on: true, reason: `software renderer (${renderer})` };
  if (frameTimes.length < samples) return null;
  const m = median(frameTimes.slice(0, samples));
  return m > slowMs ? { on: true, reason: `slow frames (median ${Math.round(m)} ms)` } : { on: false, reason: `frames fast enough (median ${Math.round(m)} ms)` };
}

export const IDLE_DRAW_MS = 3000;   // one frame this often when nothing happens
export const TICK_MS = 1000;        // the clock and the other text on screen still change every second
export const AWAKE_MS = 4000;       // continuous drawing for this long after anything happens (covers the camera flights)

// The draw schedule in low-power mode. wake(now, ms) asks for continuous drawing until now + ms (for input and camera moves, which
// animate); requestDraw() asks for one frame at once (for a resize or new data, which change the picture once); shouldDraw(now) says
// whether this frame draws; drew(now) records that it did; nextDelay(now) is how long to wait before the next frame (0: the next
// animation frame). Off (full speed), every frame draws and no frame waits.
export function createDrawGate({ on = false, idleDrawMs = IDLE_DRAW_MS, tickMs = TICK_MS } = {}) {
  let low = on, awakeUntil = 0, lastDraw = -Infinity, draws = 0, dirty = false;
  return {
    get on() { return low; },
    get draws() { return draws; },
    setOn(v) { low = !!v; },
    wake(now, ms = AWAKE_MS) { awakeUntil = Math.max(awakeUntil, now + ms); },
    requestDraw() { dirty = true; },
    awake(now) { return !low || now < awakeUntil; },
    shouldDraw(now) { return !low || dirty || now < awakeUntil || now - lastDraw >= idleDrawMs; },
    drew(now) { lastDraw = now; draws++; dirty = false; },
    nextDelay(now) {
      if (!low || dirty || now < awakeUntil) return 0;
      return Math.max(0, Math.min(tickMs, lastDraw + idleDrawMs - now));
    },
  };
}
