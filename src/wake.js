// Keeps the screen on while someone looks at the sky, using the Screen Wake Lock API (navigator.wakeLock.request("screen")).
// The browser releases a lock whenever the page is hidden, so it is asked for again when the page becomes visible.
// Nothing here throws: a browser that lacks the API, or refuses, just leaves the screen to dim as usual.
export function createWakeLock({ nav = typeof navigator !== "undefined" ? navigator : {}, doc = typeof document !== "undefined" ? document : {} } = {}) {
  const supported = !!(nav.wakeLock && typeof nav.wakeLock.request === "function");
  let wanted = false, sentinel = null, busy = false, error = null;

  async function acquire() {
    if (!supported || !wanted || sentinel || busy || doc.visibilityState === "hidden") return;
    busy = true;
    try {
      const s = await nav.wakeLock.request("screen");
      if (!wanted) { try { await s.release(); } catch { /* already released */ } return; }  // asked to stop while the request was in flight
      sentinel = s; error = null;
      if (s.addEventListener) s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
    } catch (e) {
      error = String((e && e.name) || e);
    } finally {
      busy = false;
    }
  }

  if (supported && doc.addEventListener) doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") acquire(); });

  return {
    supported,
    want(on) {
      wanted = !!on;
      if (wanted) return acquire();
      const s = sentinel; sentinel = null;
      return s ? Promise.resolve(s.release()).catch(() => {}) : Promise.resolve();
    },
    state: () => ({ supported, wanted, active: !!sentinel, error }),
  };
}
