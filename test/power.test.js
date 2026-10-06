import test from "node:test";
import assert from "node:assert/strict";
import { isSoftwareRenderer, rendererName, decideLowPower, createDrawGate, keepsDrawing, replayMoving, IDLE_DRAW_MS, TICK_MS, AWAKE_MS } from "../src/power.js";
import { needsEarlyPoll } from "../src/live.js";

test("software renderers are recognised by name, real graphics cards are not", () => {
  for (const n of [
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "Google SwiftShader", "llvmpipe (LLVM 15.0.7, 256 bits)", "softpipe", "Microsoft Basic Render Driver", "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)", "Some Software Rasterizer",
  ]) assert.equal(isSoftwareRenderer(n), true, n);
  for (const n of ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", "Adreno (TM) 640", "Mali-G78", "Apple GPU", "WebKit WebGL", "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "", null, undefined, 42]) {
    assert.equal(isSoftwareRenderer(n), false, String(n));
  }
});

// The software names the mode answers to, pinned: a change to the list must change this test.
const SOFTWARE_NAMES = [
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)",
  "Google SwiftShader", "llvmpipe (LLVM 15.0.7, 256 bits)", "softpipe", "Microsoft Basic Render Driver",
  "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", "Some Software Rasterizer",
];
const GPU_NAMES = ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", "Adreno (TM) 640", "Mali-G78", "Apple GPU", "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "NVIDIA GeForce RTX 3060/PCIe/SSE2"];

test("rendererName reads RENDERER first and asks the debug extension only for the masked placeholder", () => {
  const gl = ({ plain, ext = true, unmasked = null, asked = [] }) => ({ RENDERER: 0x1f01, asked, getExtension: (e) => { asked.push(e); return e === "WEBGL_debug_renderer_info" && ext ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null; }, getParameter: (p) => (p === 0x9246 ? unmasked : p === 0x1f01 ? plain : null) });
  // Firefox gives the real name in RENDERER and warns about the extension: it must not be asked
  const ff = gl({ plain: "llvmpipe (LLVM 15)", unmasked: "x" });
  assert.equal(rendererName(ff), "llvmpipe (LLVM 15)");
  assert.deepEqual(ff.asked, []);
  // Chrome and Safari mask RENDERER: the extension gives the real name
  assert.equal(rendererName(gl({ plain: "WebKit WebGL", unmasked: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))" })), "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))");
  // no extension, or a masked answer: the placeholder comes back, which means full speed
  assert.equal(rendererName(gl({ plain: "WebKit WebGL", ext: false })), "WebKit WebGL");
  assert.equal(rendererName(gl({ plain: "WebKit WebGL", unmasked: "" })), "WebKit WebGL");
  assert.equal(rendererName({ getParameter() { throw new Error("lost"); }, getExtension() { throw new Error("lost"); } }), "");
});

test("low power only for software renderer names; every GPU, unknown, masked or missing name means full speed", () => {
  for (const n of SOFTWARE_NAMES) assert.deepEqual(decideLowPower({ renderer: n }), { on: true, reason: `software renderer (${n})` }, n);
  for (const n of [...GPU_NAMES, "WebKit WebGL", "Mozilla", "", "something new"]) assert.equal(decideLowPower({ renderer: n }).on, false, n);
  assert.equal(decideLowPower().on, false, "no name at all");
  assert.equal(decideLowPower({}).reason, "renderer not named: full speed");
  // frame times are not an input any more: slow frames on a GPU never switch it on
  assert.equal(decideLowPower({ renderer: "Mali-G78", frameTimes: Array(20).fill(900) }).on, false);
});

test("the renderer-name list itself", () => {
  for (const n of SOFTWARE_NAMES) assert.equal(isSoftwareRenderer(n), true, n);
  for (const n of [...GPU_NAMES, "", null, undefined, 42]) assert.equal(isSoftwareRenderer(n), false, String(n));
});

test("keep drawing while something moves by itself, and not otherwise", () => {
  assert.equal(keepsDrawing({}), false);
  for (const k of ["timeSpedUp", "lens", "sensor", "pointerDown", "following", "cameraMoving", "skyTurning", "globeReplay", "underReplay"]) assert.equal(keepsDrawing({ [k]: true }), true, k);
});

test("a quake replay moves until it is paused or a live replay has reached its end", () => {
  assert.equal(replayMoving({ tau: 10, maxTau: 1700, live: false, paused: false }), true);
  assert.equal(replayMoving({ tau: 10, maxTau: 1700, live: false, paused: true }), false, "paused");
  assert.equal(replayMoving({ tau: 1700, maxTau: 1700, live: true, paused: false }), false, "a live replay waiting at its end");
  assert.equal(replayMoving({ tau: 300, maxTau: 1700, live: true, paused: false }), true, "a live replay under way");
  assert.equal(replayMoving({ tau: 1700, maxTau: 1700, live: false, paused: false }), true, "a past quake's replay loops");
  assert.equal(replayMoving(null), false);
});

test("off (full speed): every frame draws and none waits", () => {
  const g = createDrawGate();
  for (let t = 0; t < 1000; t += 16) { assert.equal(g.shouldDraw(t), true); g.drew(t); assert.equal(g.nextDelay(t), 0); }
  assert.equal(g.awake(123), true);
});

test("low power: awake after a wake, then one draw every few seconds with a tick every second in between", () => {
  const g = createDrawGate({ on: true });
  g.wake(0);
  // awake: every frame draws, no waiting
  let t = 0;
  for (; t < AWAKE_MS; t += 100) { assert.equal(g.shouldDraw(t), true); g.drew(t); assert.equal(g.nextDelay(t), 0); }
  const lastAwakeDraw = t - 100;
  // asleep: the next frame waits for the one-second tick, and does not draw until the idle interval has passed
  t = AWAKE_MS + 1;
  assert.equal(g.awake(t), false);
  assert.equal(g.shouldDraw(t), false);
  assert.equal(g.nextDelay(t), Math.min(TICK_MS, lastAwakeDraw + IDLE_DRAW_MS - t));
  // simulate ten idle seconds the way the loop runs them, counting draws
  let draws = 0, frames = 0;
  for (t = AWAKE_MS + 1; t < AWAKE_MS + 10001;) {
    frames++;
    if (g.shouldDraw(t)) { g.drew(t); draws++; }
    t += Math.max(1, g.nextDelay(t));
  }
  assert.ok(draws >= 3 && draws <= 4, `about one draw every ${IDLE_DRAW_MS} ms (${draws})`);
  assert.ok(frames >= 9 && frames <= 13, `about one frame a second for the text (${frames})`);
  // a wake makes the next frame immediate and drawing continuous again
  g.wake(t);
  assert.equal(g.nextDelay(t), 0);
  assert.equal(g.shouldDraw(t), true);
  assert.equal(g.draws, AWAKE_MS / 100 + draws, "the awake draws plus the idle ones");
});

test("the gate can be switched on later (a slow frame rate measured after start)", () => {
  const g = createDrawGate();
  g.drew(0);
  g.setOn(true);
  assert.equal(g.on, true);
  assert.equal(g.shouldDraw(100), false);
  assert.ok(g.nextDelay(100) > 0);
});

test("the early manifest poll happens when the app started without a manifest or with feeds that fell back", () => {
  assert.equal(needsEarlyPoll(null), true);
  assert.equal(needsEarlyPoll(undefined), true);
  assert.equal(needsEarlyPoll({ generatedAt: "2026-10-06T04:50:20Z" }), false, "a complete manifest fetched seconds ago is not asked for again at once");
  assert.equal(needsEarlyPoll({ generatedAt: "2026-10-06T04:50:20Z" }, []), false);
  assert.equal(needsEarlyPoll({ generatedAt: "2026-10-06T04:50:20Z" }, ["quakes"]), true, "a feed that failed at start is retried soon");
});

test("a single draw request draws the next frame once, without waking continuous drawing", () => {
  const g = createDrawGate({ on: true });
  g.drew(0);
  assert.equal(g.shouldDraw(500), false);
  g.requestDraw();
  assert.equal(g.nextDelay(500), 0, "the frame comes at once");
  assert.equal(g.shouldDraw(500), true);
  g.drew(500);
  assert.equal(g.awake(500), false, "no period of continuous drawing");
  assert.equal(g.shouldDraw(600), false);
  assert.ok(g.nextDelay(600) > 0);
});
