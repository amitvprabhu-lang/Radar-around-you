import test from "node:test";
import assert from "node:assert/strict";
import { createWakeLock } from "../src/wake.js";

function fakes({ visible = true, fail = null } = {}) {
  const log = [];
  const listeners = {};
  const doc = { visibilityState: visible ? "visible" : "hidden", addEventListener: (t, f) => { listeners[t] = f; } };
  const nav = { wakeLock: { request: async (kind) => {
    log.push("request:" + kind);
    if (fail) throw Object.assign(new Error("no"), { name: fail });
    const rel = [];
    return { released: false, addEventListener: (t, f) => rel.push(f), release: async function () { this.released = true; log.push("release"); rel.forEach((f) => f()); }, fire() { rel.forEach((f) => f()); } };
  } } };
  return { nav, doc, log, listeners };
}

test("it asks for a screen lock when wanted and releases it when not", async () => {
  const f = fakes();
  const w = createWakeLock(f);
  assert.equal(w.supported, true);
  await w.want(true);
  assert.deepEqual(f.log, ["request:screen"]);
  assert.equal(w.state().active, true);
  await w.want(true);
  assert.deepEqual(f.log, ["request:screen"], "no second request while one is held");
  await w.want(false);
  assert.deepEqual(f.log, ["request:screen", "release"]);
  assert.equal(w.state().active, false);
});

test("a hidden page does not ask, and the lock comes back when the page is visible again", async () => {
  const f = fakes({ visible: false });
  const w = createWakeLock(f);
  await w.want(true);
  assert.deepEqual(f.log, []);
  f.doc.visibilityState = "visible";
  f.listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(f.log, ["request:screen"]);
  assert.equal(w.state().active, true);
});

test("when the browser releases the lock (page hidden) it is asked for again on return", async () => {
  const f = fakes();
  let sentinel;
  const orig = f.nav.wakeLock.request;
  f.nav.wakeLock.request = async (k) => (sentinel = await orig(k));
  const w = createWakeLock(f);
  await w.want(true);
  sentinel.fire();  // the browser released it
  assert.equal(w.state().active, false);
  f.listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.log.filter((x) => x === "request:screen").length, 2);
});

test("a refusal is recorded, not thrown, and an unsupported browser is a no-op", async () => {
  const f = fakes({ fail: "NotAllowedError" });
  const w = createWakeLock(f);
  await w.want(true);
  assert.deepEqual([w.state().active, w.state().error], [false, "NotAllowedError"]);
  const none = createWakeLock({ nav: {}, doc: {} });
  assert.equal(none.supported, false);
  await none.want(true);
  await none.want(false);
  assert.equal(none.state().active, false);
});

test("stopping while a request is in flight releases the lock that arrives", async () => {
  const f = fakes();
  const w = createWakeLock(f);
  const pending = w.want(true);
  await w.want(false);
  await pending;
  assert.equal(w.state().active, false);
  assert.ok(f.log.includes("release"));
});
