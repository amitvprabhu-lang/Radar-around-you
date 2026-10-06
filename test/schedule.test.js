import test from "node:test";
import assert from "node:assert/strict";
import { makeYield, afterFirstPaint, runSteps, runStepsAsync, whenIdle, createIdleQueue, SLICE_MS } from "../src/schedule.js";

// A pretend browser: timers and frames only run when the test says so, so the order of events is exact.
function fakeEnv({ hidden = false, raf = true, idle = false } = {}) {
  const timers = [], frames = [], idles = [];
  const env = {
    log: [],
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); env.log.push(`timeout:${ms}`); return timers.length; },
    document: { hidden },
    runTimers() { while (timers.length) timers.shift().fn(); },
    runFrames() { while (frames.length) frames.shift()(performance.now()); },
    runIdle() { while (idles.length) idles.shift().fn(); },
    timers, frames, idles,
  };
  if (raf) env.requestAnimationFrame = (fn) => { frames.push(fn); env.log.push("raf"); return frames.length; };
  if (idle) env.requestIdleCallback = (fn, opts) => { idles.push({ fn, opts }); env.log.push(`idle:${opts && opts.timeout}`); return idles.length; };
  return env;
}
const settle = () => new Promise((r) => setImmediate(r));

test("makeYield prefers scheduler.yield, then MessageChannel, then setTimeout", async () => {
  let used = 0;
  const y1 = makeYield({ scheduler: { yield: () => { used++; return Promise.resolve("s"); } }, MessageChannel, setTimeout });
  assert.equal(await y1(), "s");
  assert.equal(used, 1);
  // MessageChannel: resolves in a later task, in call order
  const made = [];
  class MC extends MessageChannel { constructor() { super(); made.push(this); } }
  const y2 = makeYield({ MessageChannel: MC, setTimeout });
  const order = [];
  await Promise.all([y2().then(() => order.push(1)), y2().then(() => order.push(2)), y2().then(() => order.push(3))]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(made.length, 1, "one channel serves every call");
  made.forEach((c) => c.port1.close());  // an open port would keep node running after the tests
  // neither: a zero timeout
  const env = fakeEnv();
  const y3 = makeYield(env);
  let done = false;
  y3().then(() => { done = true; });
  await settle();
  assert.equal(done, false, "waits for the timer");
  assert.deepEqual(env.log, ["timeout:0"]);
  env.runTimers(); await settle();
  assert.equal(done, true);
});

test("afterFirstPaint waits for a frame and then a new task", async () => {
  const env = fakeEnv();
  let done = false;
  afterFirstPaint(env).then(() => { done = true; });
  await settle();
  assert.equal(done, false);
  assert.deepEqual(env.log, ["raf"], "nothing runs before the frame");
  env.runTimers(); await settle();
  assert.equal(done, false, "no timer is waiting yet");
  env.runFrames(); await settle();
  assert.equal(done, false, "the frame callback runs before the paint, so it schedules a task instead of resolving");
  assert.deepEqual(env.log, ["raf", "timeout:0"]);
  env.runTimers(); await settle();
  assert.equal(done, true);
});

test("afterFirstPaint goes on at once in a hidden tab or without animation frames", async () => {
  for (const env of [fakeEnv({ hidden: true }), fakeEnv({ raf: false })]) {
    let done = false;
    afterFirstPaint(env).then(() => { done = true; });
    assert.deepEqual(env.log, ["timeout:0"]);
    env.runTimers(); await settle();
    assert.equal(done, true);
  }
});

function* counter(n, log) {
  let sum = 0;
  for (let i = 1; i <= n; i++) { sum += i; log.push(i); yield; }
  return sum;
}

test("runSteps runs a generator to the end and returns its value", () => {
  const log = [];
  assert.equal(runSteps(counter(5, log)), 15);
  assert.deepEqual(log, [1, 2, 3, 4, 5]);
});

test("runStepsAsync gives the same result and yields only when a stretch used up its budget", async () => {
  let t = 0, yields = 0;
  const now = () => t;
  const log = [];
  const gen = (function* () { for (let i = 0; i < 10; i++) { t += 15; log.push(i); yield; } return "done"; })();
  const r = await runStepsAsync(gen, { yieldFn: async () => { yields++; log.push("y"); }, now, budgetMs: 40 });
  assert.equal(r, "done");
  // 15 ms per step and a 40 ms budget: a yield after every third step
  assert.deepEqual(log, [0, 1, 2, "y", 3, 4, 5, "y", 6, 7, 8, "y", 9]);
  assert.equal(yields, 3);
});

test("the default slice is short enough to stay a short task even under Lighthouse's fourfold slowdown", async () => {
  assert.ok(SLICE_MS * 4 <= 50, String(SLICE_MS));
  let t = 0, yields = 0;
  const gen = (function* () { for (let i = 0; i < 6; i++) { t += SLICE_MS / 2; yield; } })();
  await runStepsAsync(gen, { yieldFn: async () => { yields++; }, now: () => t });
  assert.equal(yields, 3, "with no budget given, a yield after every two half-slice steps");
});

test("runStepsAsync matches runSteps on the same generator", async () => {
  const a = runSteps(counter(100, []));
  const b = await runStepsAsync(counter(100, []), { yieldFn: () => Promise.resolve(), budgetMs: 0 });
  assert.equal(a, b);
});

test("runStepsAsync passes on an error from the generator", async () => {
  const gen = (function* () { yield; throw new Error("boom"); })();
  await assert.rejects(runStepsAsync(gen, { yieldFn: () => Promise.resolve(), budgetMs: 0 }), /boom/);
});

test("whenIdle uses requestIdleCallback with the timeout, or a short timer without it", async () => {
  const env = fakeEnv({ idle: true });
  let done = false;
  whenIdle(env, 1500).then(() => { done = true; });
  assert.deepEqual(env.log, ["idle:1500"]);
  env.runIdle(); await settle();
  assert.equal(done, true);
  const env2 = fakeEnv();
  let done2 = false;
  whenIdle(env2).then(() => { done2 = true; });
  assert.deepEqual(env2.log, ["timeout:50"]);
  env2.runTimers(); await settle();
  assert.equal(done2, true);
});

test("createIdleQueue runs jobs one at a time, each after an idle wait, in order, and survives a failing job", async () => {
  const waits = [];
  const idle = () => new Promise((r) => waits.push(r));
  const errors = [];
  const q = createIdleQueue({ idle, onError: (e) => errors.push(e.message) });
  const log = [];
  const a = q.add(async () => { log.push("a1"); await settle(); log.push("a2"); return "A"; });
  const b = q.add(() => { log.push("b"); throw new Error("bad"); });
  const c = q.add(() => { log.push("c"); return "C"; });
  await settle();
  assert.deepEqual(log, [], "nothing runs before the browser is idle");
  const step = async () => { while (!waits.length) await settle(); waits.shift()(); await settle(); await settle(); };
  await step();
  assert.equal(await a, "A");
  assert.deepEqual(log, ["a1", "a2"], "the second job waits for the first to finish");
  await step();
  await assert.rejects(b, /bad/);
  await step();
  assert.equal(await c, "C");
  assert.deepEqual(log, ["a1", "a2", "b", "c"]);
  assert.deepEqual(errors, ["bad"]);
  await q.drain();
});
