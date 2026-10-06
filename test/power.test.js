import test from "node:test";
import assert from "node:assert/strict";
import { isSoftwareRenderer, rendererName, decideLowPower, createDrawGate, SLOW_FRAME_MS, FRAME_SAMPLES, IDLE_DRAW_MS, TICK_MS, AWAKE_MS } from "../src/power.js";
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

test("rendererName prefers the unmasked name, falls back to RENDERER, and never throws", () => {
  const gl = (ext, unmasked, plain) => ({ RENDERER: 0x1f01, getExtension: (e) => (e === "WEBGL_debug_renderer_info" && ext ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null), getParameter: (p) => (p === 0x9246 ? unmasked : p === 0x1f01 ? plain : null) });
  assert.equal(rendererName(gl(true, "SwiftShader Device", "WebKit WebGL")), "SwiftShader Device");
  assert.equal(rendererName(gl(false, null, "WebKit WebGL")), "WebKit WebGL");
  assert.equal(rendererName({ getExtension() { throw new Error("lost"); } }), "");
});

test("the decision: a software name decides at once; otherwise it waits for the frames and goes by their median", () => {
  assert.deepEqual(decideLowPower({ renderer: "Google SwiftShader" }), { on: true, reason: "software renderer (Google SwiftShader)" });
  assert.equal(decideLowPower({ renderer: "Apple GPU", frameTimes: [16, 17] }), null, "not enough frames yet");
  assert.equal(decideLowPower({ renderer: "Apple GPU", frameTimes: Array(FRAME_SAMPLES).fill(16.7) }).on, false);
  assert.equal(decideLowPower({ renderer: "Apple GPU", frameTimes: Array(FRAME_SAMPLES).fill(400) }).on, true);
  // the median, so one or two slow frames (a hitch while loading) do not switch it on
  const mostlyFast = [16, 17, 16, 900, 1200, 16, 17, 16];
  assert.equal(decideLowPower({ frameTimes: mostlyFast }).on, false);
  const mostlySlow = [16, 300, 320, 900, 1200, 16, 250, 400];
  assert.equal(decideLowPower({ frameTimes: mostlySlow }).on, true);
  // the threshold is exclusive and only the first samples count
  assert.equal(decideLowPower({ frameTimes: Array(FRAME_SAMPLES).fill(SLOW_FRAME_MS) }).on, false);
  assert.equal(decideLowPower({ frameTimes: [...Array(FRAME_SAMPLES).fill(20), ...Array(50).fill(5000)] }).on, false);
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

test("the early manifest poll happens only when the app started without a manifest", () => {
  assert.equal(needsEarlyPoll(null), true);
  assert.equal(needsEarlyPoll(undefined), true);
  assert.equal(needsEarlyPoll({ generatedAt: "2026-10-06T04:50:20Z" }), false, "an old manifest fetched seconds ago is not asked for again at once");
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
