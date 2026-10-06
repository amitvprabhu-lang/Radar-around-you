// Low-power drawing for devices whose WebGL runs in software (no graphics card, or one the browser will not use).
// There every frame costs about a second of processor time, so the app draws on demand: at once and continuously for a few seconds
// after any input, view change, data change or camera move, and otherwise one frame every few seconds. The page then goes idle
// between frames. The choice depends only on the renderer's own name, read once when the WebGL context is made: a real graphics
// card always runs at full speed, and so does any renderer whose name is hidden or unknown. Pure logic here; main.js wires it to
// the frame loop. Everything takes its inputs as arguments, so the tests drive it without a browser.

// Renderer names that mean software drawing: Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Microsoft Basic Render
// Driver, and any that says Software.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
export const isSoftwareRenderer = (name) => typeof name === "string" && SOFTWARE.test(name);

// The names Chrome and Safari give in RENDERER when they hide the real one; only then is the debug extension asked.
const MASKED = /^(webkit webgl|mozilla|)$/i;

// The renderer's name. RENDERER is read first: Firefox already gives the real name there and warns that the debug extension is
// deprecated, so the extension is asked only when RENDERER is the masked placeholder. A masked or missing name comes back as is (and
// then means full speed). Never throws.
export function rendererName(gl) {
  let plain = "";
  try { plain = String(gl.getParameter(gl.RENDERER) || ""); } catch { /* lost context: unknown */ }
  if (!MASKED.test(plain.trim())) return plain;
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const unmasked = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return unmasked ? String(unmasked) : plain;
  } catch { return plain; }
}

// The decision, once: low power only for a software renderer; any other name, a masked one or none means full speed.
export function decideLowPower({ renderer = "" } = {}) {
  return isSoftwareRenderer(renderer) ? { on: true, reason: `software renderer (${renderer})` } : { on: false, reason: renderer ? `graphics card (${renderer})` : "renderer not named: full speed" };
}

// Whether a quake replay is still moving: not paused, and not a live replay that has reached its end and stopped there.
export const replayMoving = (r) => !!r && !r.paused && !(r.live && r.tau >= r.maxTau);
// Whether something on screen moves by itself, so low-power drawing must stay continuous.
export function keepsDrawing(s) {
  return !!(s.timeSpedUp || s.lens || s.sensor || s.pointerDown || s.following || s.cameraMoving || s.skyTurning || s.globeReplay || s.underReplay);
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
