// Sky Lens: the phone's rear camera behind the sky view, so the stars, constellations and satellites sit over the real sky.
// The camera picture stays on the device: it is shown in a video element and never recorded, stored or sent anywhere.
// The sky is drawn on top with a screen blend, so its dark parts let the camera show through and its bright parts add to it.
// Everything that touches the browser is passed in, so the logic can be tested with fakes.

export const LENS_DEFAULT_FOV = 60;  // OURS: a guess at the vertical field of view of a phone camera held upright. Cameras differ; the person pinches to match.

// What this browser can do. The camera needs a secure page (https); the orientation sensors are checked separately when they are asked for.
export function lensSupport(win = globalThis) {
  const camera = !!(win.navigator && win.navigator.mediaDevices && typeof win.navigator.mediaDevices.getUserMedia === "function");
  const secure = win.isSecureContext !== false;
  const reason = !secure ? "insecure" : !camera ? "no-camera-api" : null;
  return { camera, secure, ok: !reason, reason };
}

// A sentence for what went wrong, from the error the browser gave or from our own reason.
export function explainLensError(e) {
  const name = typeof e === "string" ? e : e && e.name;
  switch (name) {
    case "motion": return "Motion sensors are needed to know where the phone points. Allow motion access and try again.";
    case "insecure": return "The camera only works on a secure (https) page.";
    case "no-camera-api": return "This browser cannot open the camera.";
    case "NotAllowedError": case "PermissionDeniedError": return "Camera access was refused. You can allow it in the browser's settings for this site.";
    case "NotFoundError": case "OverconstrainedError": return "No camera was found.";
    case "NotReadableError": case "AbortError": return "The camera is busy or could not start. Close other apps that use it and try again.";
    case "SecurityError": return "The browser blocked camera use here.";
    default: return "The camera could not be started.";
  }
}

export function createLens({ video, ensureSensors, setLook, onChange = () => {}, win = globalThis, doc = globalThis.document }) {
  let stream = null, starting = false;
  const state = { active: false };

  const onHidden = () => { if (doc && doc.hidden) stop("hidden"); };

  function stop(why = "stopped") {
    if (stream) { for (const t of stream.getTracks()) { try { t.onended = null; t.stop(); } catch { /* already stopped */ } } }
    stream = null;
    if (video) { try { video.pause && video.pause(); } catch { /* not playing */ } video.srcObject = null; }
    if (doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", onHidden);
    const was = state.active;
    state.active = false;
    if (was) { setLook(false); onChange(false, why); }
  }

  async function start() {
    if (state.active) return { ok: true };
    if (starting) return { ok: false, reason: "busy" };
    const sup = lensSupport(win);
    if (!sup.ok) return { ok: false, reason: sup.reason, message: explainLensError(sup.reason) };
    starting = true;
    try {
      if (!(await ensureSensors())) return { ok: false, reason: "motion", message: explainLensError("motion") };
      let s;
      try {
        s = await win.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        return { ok: false, reason: (e && e.name) || "error", message: explainLensError(e) };
      }
      stream = s;
      for (const t of s.getTracks()) t.onended = () => stop("ended");  // the camera was taken away, for example by another app
      video.srcObject = s;
      video.muted = true;
      try { await video.play(); } catch { /* autoplay can be refused until the picture is shown; the stream still runs */ }
      state.active = true;
      setLook(true);
      if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onHidden);
      onChange(true, "started");
      return { ok: true };
    } finally {
      starting = false;
    }
  }

  return { start, stop, get active() { return state.active; } };
}
