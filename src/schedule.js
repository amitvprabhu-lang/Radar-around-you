// Start-up scheduling: lets the page paint first, then does the heavy work in pieces so the main thread stays responsive.
// Every function takes its timers from an `env` object (the browser's globals by default), so the tests can drive them by hand.

// A function that returns a promise resolving in a new task, so the browser can paint and handle input in between.
// scheduler.yield() keeps the page's place at the front of the queue where the browser has it; MessageChannel is the fastest
// plain macrotask elsewhere; setTimeout(0) is the last resort (browsers clamp it to 4 ms after a few nested calls).
export function makeYield(env = globalThis) {
  if (env.scheduler && typeof env.scheduler.yield === "function") return () => env.scheduler.yield();
  if (typeof env.MessageChannel === "function") {
    const ch = new env.MessageChannel();
    const waiting = [];
    ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
    return () => new Promise((r) => { waiting.push(r); ch.port2.postMessage(0); });
  }
  return () => new Promise((r) => env.setTimeout(r, 0));
}

// Resolves after the browser has had the chance to paint what is already in the document: the next animation frame, then
// a new task (the frame callback runs just before the paint, so the task after it comes after the paint). A hidden tab
// gets no animation frames, so there it goes on at once rather than waiting until the tab is shown.
export function afterFirstPaint(env = globalThis) {
  return new Promise((resolve) => {
    const next = () => env.setTimeout(resolve, 0);
    if ((env.document && env.document.hidden) || typeof env.requestAnimationFrame !== "function") next();
    else env.requestAnimationFrame(next);
  });
}

// Runs a generator to the end in one go and returns its result: the synchronous form of a stepped computation.
export function runSteps(gen) {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

// How long a slice of sliced work may run before it yields. Well under the 50 ms that counts as a long task, and small because
// Lighthouse's simulated throttling multiplies what it measures on a fast machine by four (a 40 ms slice there becomes 160 ms).
// A yield costs well under a millisecond, so the extra slices are cheap.
export const SLICE_MS = 12;

// Runs a generator, yielding to the main thread whenever a stretch of steps has taken budgetMs or more.
// The result is the same as runSteps gives; only the timing differs.
export async function runStepsAsync(gen, { yieldFn, now = () => performance.now(), budgetMs = SLICE_MS } = {}) {
  let t0 = now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (now() - t0 >= budgetMs) { await yieldFn(); t0 = now(); }
  }
}

// Resolves when the browser is idle (requestIdleCallback), or after timeoutMs at the latest; setTimeout where idle callbacks
// do not exist (Safari).
export function whenIdle(env = globalThis, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (typeof env.requestIdleCallback === "function") env.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    else env.setTimeout(resolve, 50);
  });
}

// A queue of jobs that run one at a time, each when the browser is idle, in the order they were added. A job may be async;
// a job that throws is reported to onError and the queue goes on. add() returns a promise for that job's result.
export function createIdleQueue({ idle = () => whenIdle(), onError = () => {} } = {}) {
  let chain = Promise.resolve();
  return {
    add(job) {
      const run = chain.then(() => idle()).then(() => job());
      chain = run.catch((e) => { onError(e); });
      return run;
    },
    // resolves when every job added so far has finished
    drain() { return chain; },
  };
}
