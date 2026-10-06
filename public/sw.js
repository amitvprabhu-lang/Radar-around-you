// Service worker for Radar Around You: lets the app open without a connection and load faster on a return visit.
//
// Rules (kept simple on purpose; a wrong cache is worse than no cache for live data):
//  - The live data folder (/live/) is always asked of the network first. Only if the network fails is the last copy used, and the
//    page's own freshness labels still say how old it is, because they read the manifest's times, not the cache's.
//  - The page itself (a navigation) is network first, so a new release is picked up at once, with the cached copy as the fallback.
//  - The app's script on the real site, app.<hash>.js (build.mjs --external-script), is named after its content, so a stored copy is
//    always right for its name: it is served from the cache when there, fetched once otherwise, and when a new one is stored the older
//    app scripts are dropped from the cache. A failed download is passed on as a failure, so the page shows its reload message.
//  - Other files from this site (bundled data, textures, icons) are served from the cache and refreshed in the background.
//  - Nothing from another site is touched, and only successful answers are stored.
// VERSION is the cache's name; changing it empties the cache for every returning visitor. The app script rule above did not need
// that: the entries stored by the earlier worker stay valid, and any change to this file is enough for browsers to install it.
const VERSION = "radar-v1";
const LIVE = "/live/";
const APP_SCRIPT = /\/app\.[0-9a-f]{10}\.js$/;

function strategyFor(url, mode, method, selfOrigin) {
  if (method !== "GET") return "ignore";
  const u = new URL(url);
  if (u.origin !== selfOrigin) return "ignore";
  if (u.pathname.includes(LIVE)) return "network-first";
  if (mode === "navigate") return "network-first";
  if (APP_SCRIPT.test(u.pathname) && !u.search) return "cache-first";
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

async function cacheFirst(request, cache) {
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    await cache.put(request, res.clone());
    for (const k of await cache.keys()) {
      const u = typeof k === "string" ? k : k.url;
      if (u !== request.url && APP_SCRIPT.test(new URL(u).pathname)) await cache.delete(k);
    }
  }
  return res;
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
    event.respondWith(caches.open(VERSION).then((cache) => (s === "network-first" ? networkFirst(r, cache) : s === "cache-first" ? cacheFirst(r, cache) : staleWhileRevalidate(r, cache))));
  });
}
