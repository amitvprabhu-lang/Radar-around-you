// Service worker for Radar Around You: lets the app open without a connection and load faster on a return visit.
//
// Rules (kept simple on purpose; a wrong cache is worse than no cache for live data):
//  - The live data folder (/live/) is always asked of the network first. Only if the network fails is the last copy used, and the
//    page's own freshness labels still say how old it is, because they read the manifest's times, not the cache's.
//  - The page itself (a navigation) is network first, so a new release is picked up at once, with the cached copy as the fallback.
//  - Other files from this site (bundled data, textures, icons) are served from the cache and refreshed in the background.
//  - Nothing from another site is touched, and only successful answers are stored.
const VERSION = "radar-v1";
const LIVE = "/live/";

function strategyFor(url, mode, method, selfOrigin) {
  if (method !== "GET") return "ignore";
  const u = new URL(url);
  if (u.origin !== selfOrigin) return "ignore";
  if (u.pathname.includes(LIVE)) return "network-first";
  if (mode === "navigate") return "network-first";
  return "stale-while-revalidate";
}

async function networkFirst(request, cache) {
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: false });
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(request, cache) {
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

if (typeof self !== "undefined" && self.addEventListener) {
  self.addEventListener("install", () => { self.skipWaiting(); });
  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
      await self.clients.claim();
    })());
  });
  self.addEventListener("fetch", (event) => {
    const r = event.request;
    const s = strategyFor(r.url, r.mode, r.method, self.location.origin);
    if (s === "ignore") return;
    event.respondWith(caches.open(VERSION).then((cache) => (s === "network-first" ? networkFirst(r, cache) : staleWhileRevalidate(r, cache))));
  });
}
