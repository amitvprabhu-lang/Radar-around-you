import test from "node:test";
import assert from "node:assert/strict";
import { lensSupport, explainLensError, createLens, LENS_DEFAULT_FOV } from "../src/lens.js";

const track = () => ({ stopped: false, onended: null, stop() { this.stopped = true; } });
const fakeStream = (n = 1) => { const tracks = Array.from({ length: n }, track); return { tracks, getTracks: () => tracks }; };
const fakeVideo = () => ({ srcObject: null, muted: false, played: 0, paused: 0, async play() { this.played++; }, pause() { this.paused++; } });
const fakeDoc = () => { const l = new Map(); return { hidden: false, addEventListener: (t, f) => l.set(t, f), removeEventListener: (t) => l.delete(t), has: (t) => l.has(t), fire: (t) => l.get(t) && l.get(t)() }; };
function rig({ sensors = true, gum, support = {} } = {}) {
  const calls = { look: [], change: [], gum: [] };
  const stream = fakeStream();
  const win = { isSecureContext: true, navigator: { mediaDevices: { getUserMedia: async (c) => { calls.gum.push(c); if (gum) throw gum; return stream; } } }, ...support };
  const doc = fakeDoc(), video = fakeVideo();
  const lens = createLens({ video, win, doc, ensureSensors: async () => sensors, setLook: (on) => calls.look.push(on), onChange: (on, why) => calls.change.push([on, why]) });
  return { lens, calls, stream, video, doc, win };
}

test("support: needs a secure page and the camera interface", () => {
  assert.deepEqual(lensSupport({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } }), { camera: true, secure: true, ok: true, reason: null });
  assert.equal(lensSupport({ isSecureContext: false, navigator: { mediaDevices: { getUserMedia() {} } } }).reason, "insecure");
  assert.equal(lensSupport({ isSecureContext: true, navigator: {} }).reason, "no-camera-api");
  assert.equal(lensSupport({ isSecureContext: true }).ok, false);
  assert.equal(lensSupport({ navigator: { mediaDevices: { getUserMedia() {} } } }).ok, true, "a page that does not say is not treated as insecure");
});

test("every failure has a plain sentence, and none blames the person", () => {
  for (const n of ["motion", "insecure", "no-camera-api", "NotAllowedError", "PermissionDeniedError", "NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError", "SecurityError", "weird", undefined]) {
    const t = explainLensError(typeof n === "string" ? { name: n } : n);
    assert.ok(typeof t === "string" && t.length >= 15, String(n));
    assert.doesNotMatch(t, /—|error:|undefined/i);
  }
  assert.match(explainLensError({ name: "NotAllowedError" }), /refused/);
  assert.match(explainLensError("motion"), /Motion sensors/);
  assert.match(explainLensError(null), /could not be started/);
});

test("starting asks for the rear camera, no sound, after the sensors, then shows the picture", async () => {
  const r = rig();
  const out = await r.lens.start();
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(r.calls.gum, [{ video: { facingMode: { ideal: "environment" } }, audio: false }]);
  assert.equal(r.video.srcObject, r.stream);
  assert.equal(r.video.muted, true);
  assert.equal(r.video.played, 1);
  assert.equal(r.lens.active, true);
  assert.deepEqual(r.calls.look, [true]);
  assert.deepEqual(r.calls.change, [[true, "started"]]);
  assert.equal(r.doc.has("visibilitychange"), true);
});

test("stopping releases the camera and restores the sky", async () => {
  const r = rig();
  await r.lens.start();
  r.lens.stop();
  assert.ok(r.stream.tracks.every((t) => t.stopped));
  assert.equal(r.video.srcObject, null);
  assert.equal(r.lens.active, false);
  assert.deepEqual(r.calls.look, [true, false]);
  assert.deepEqual(r.calls.change.at(-1), [false, "stopped"]);
  assert.equal(r.doc.has("visibilitychange"), false);
  r.lens.stop();
  assert.equal(r.calls.look.length, 2, "stopping twice changes nothing");
});

test("without the motion sensors the camera is never opened", async () => {
  const r = rig({ sensors: false });
  const out = await r.lens.start();
  assert.equal(out.ok, false);
  assert.equal(out.reason, "motion");
  assert.match(out.message, /Motion sensors/);
  assert.equal(r.calls.gum.length, 0);
  assert.equal(r.lens.active, false);
  assert.deepEqual(r.calls.look, []);
});

test("a refused or missing camera leaves nothing on", async () => {
  for (const [name, re] of [["NotAllowedError", /refused/], ["NotFoundError", /No camera/], ["NotReadableError", /busy/]]) {
    const r = rig({ gum: Object.assign(new Error("x"), { name }) });
    const out = await r.lens.start();
    assert.equal(out.ok, false); assert.equal(out.reason, name); assert.match(out.message, re);
    assert.equal(r.lens.active, false); assert.deepEqual(r.calls.look, []); assert.equal(r.video.srcObject, null);
  }
});

test("an insecure page or a browser without a camera interface is told so before anything is asked", async () => {
  const a = rig({ support: { isSecureContext: false } });
  assert.equal((await a.lens.start()).reason, "insecure");
  const b = rig({ support: { navigator: {} } });
  assert.equal((await b.lens.start()).reason, "no-camera-api");
  assert.equal(a.calls.gum.length + b.calls.gum.length, 0);
});

test("the camera stops when the page goes out of view, and does not start again by itself", async () => {
  const r = rig();
  await r.lens.start();
  r.doc.hidden = true; r.doc.fire("visibilitychange");
  assert.equal(r.lens.active, false);
  assert.ok(r.stream.tracks.every((t) => t.stopped));
  assert.deepEqual(r.calls.change.at(-1), [false, "hidden"]);
  r.doc.hidden = false; r.doc.fire("visibilitychange");
  assert.equal(r.lens.active, false);
});

test("when another app takes the camera the lens turns itself off", async () => {
  const r = rig();
  await r.lens.start();
  r.stream.tracks[0].onended();
  assert.equal(r.lens.active, false);
  assert.deepEqual(r.calls.change.at(-1), [false, "ended"]);
  assert.deepEqual(r.calls.look, [true, false]);
});

test("a second tap while it is starting does nothing", async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.lens.start(), r.lens.start()]);
  assert.equal([a, b].filter((x) => x.ok).length + [a, b].filter((x) => x.reason === "busy").length, 2);
  assert.equal(r.calls.gum.length, 1);
  assert.equal((await r.lens.start()).ok, true, "starting when already on is fine");
  assert.equal(r.calls.gum.length, 1);
});

test("the default field of view is a stated guess in a sensible range", () => {
  assert.ok(LENS_DEFAULT_FOV >= 25 && LENS_DEFAULT_FOV <= 100, "inside the zoom limits of the sky view");
});
