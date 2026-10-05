// Live data: reads the pipeline's manifest, decides what is fresh, stale or failing, which live files the app may use,
// and when to fetch more. Everything here is plain logic with injected fetch and timers, so it can be tested without a browser.

export const LIVE_BASE = typeof __LIVE_BASE__ !== "undefined" ? __LIVE_BASE__ : "live/";

// feeds the app applies while it is open; the satellites are loaded as one group at start and need a reload to change
export const APPLIED = ["quakes", "events", "storms", "fires", "aurora", "kp", "spaceweather", "closeapproaches", "launches", "clouds", "planes"];
// the order the Data status sheet lists them in; the catalogue is a private input of the satellites and is shown last
export const FEED_ORDER = ["satellites", "quakes", "events", "storms", "fires", "aurora", "kp", "spaceweather", "closeapproaches", "launches", "clouds", "planes", "catalogue"];
const CORE = ["satellites", "quakes", "events", "aurora", "kp", "clouds", "planes"];
const RANK = { fresh: 0, failing: 1, stale: 2, none: 2, halted: 3 };
const SATELLITE_FILES = ["swarm.bin", "ids.bin", "details.bin", "names.txt", "precise.json", "satmeta.json"];

export const STATE_LABEL = { fresh: "Fresh", failing: "Last try failed", stale: "Stale", halted: "Paused by the source's rules", none: "Not fetched yet" };

export function agoText(sec) {
  if (!(sec >= 0)) return "unknown";
  if (sec < 90) return "just now";
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
}

// "Fresh" means the pipeline confirmed the data is current within the feed's own stale limit. A failed last attempt
// is shown as such while the last good copy is still inside the limit; past the limit it is stale.
export function feedState(feed, nowMs) {
  if (!feed || !feed.checkedAt) return { state: "none", ageSec: null };
  const ageSec = Math.max(0, (nowMs - Date.parse(feed.checkedAt)) / 1000);
  let state = "fresh";
  if (feed.halted) state = "halted";
  else if (ageSec > feed.staleAfterSec) state = "stale";
  else if (feed.status === "failing") state = "failing";
  return { state, ageSec };
}

export function summarize(manifest, nowMs) {
  const rows = FEED_ORDER.filter((id) => manifest.feeds[id]).map((id) => ({ id, feed: manifest.feeds[id], ...feedState(manifest.feeds[id], nowMs) }));
  const counts = { fresh: 0, failing: 0, stale: 0, none: 0, halted: 0 };
  let overall = "fresh";
  for (const r of rows) {
    if (!CORE.includes(r.id)) continue;
    counts[r.state]++;
    if (RANK[r.state] > RANK[overall]) overall = r.state;
  }
  return { rows, counts, overall, generatedAgeSec: Math.max(0, (nowMs - Date.parse(manifest.generatedAt)) / 1000) };
}

function validManifest(m) {
  return !!m && m.schema === 1 && typeof m.generatedAt === "string" && !!m.feeds && typeof m.feeds === "object";
}

export async function loadManifest(fetchFn, base = LIVE_BASE, timeoutMs = 6000) {
  if (!base) return null;
  let timer = null;
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ctl) timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchFn(base + "manifest.json", { cache: "no-store", signal: ctl ? ctl.signal : undefined });
    if (!res.ok) return null;
    const m = await res.json();
    return validManifest(m) ? m : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Which live products the app may use. A product is used only if the manifest lists every file it needs and it is newer
// than the bundled snapshot (otherwise an old live copy could replace newer bundled data).
export function resolveSources(manifest, baselineTakenMs, base = LIVE_BASE) {
  const out = { satellites: null, quakes: null, events: null, storms: null, fires: null, aurora: null, kp: null, spaceweather: null, closeapproaches: null, launches: null, clouds: null, planes: null };
  if (!validManifest(manifest)) return out;
  const pick = (id, names) => {
    const f = manifest.feeds[id];
    if (!f || !f.files || !f.version || !(Date.parse(f.fetchedAt) > baselineTakenMs)) return null;
    const paths = {};
    for (const n of names) {
      if (typeof f.files[n] !== "string") return null;
      paths[n] = base + f.files[n];
    }
    return { paths, version: f.version, fetchedAt: f.fetchedAt };
  };
  out.satellites = pick("satellites", SATELLITE_FILES);
  out.quakes = pick("quakes", ["quakes.json"]);
  out.events = pick("events", ["events.json"]);
  out.aurora = pick("aurora", ["aurora.bin", "aurora.json"]);
  out.kp = pick("kp", ["kp.json"]);
  out.clouds = pick("clouds", ["clouds.json"]);
  out.planes = pick("planes", ["planes.json"]);
  // these three have no bundled copy: without a live source the app simply has no storm, fire or solar wind data to show
  out.storms = pick("storms", ["storms.json"]);
  out.fires = pick("fires", ["fires.bin", "fires.json"]);
  out.spaceweather = pick("spaceweather", ["spaceweather.json"]);
  out.closeapproaches = pick("closeapproaches", ["closeapproaches.json"]);
  out.launches = pick("launches", ["launches.json"]);
  return out;
}

// Put the live cloud forecast and aircraft onto the bundled place records, in place so other references stay valid.
export function overlayCities(cities, clouds, planes) {
  const changed = new Set();
  for (const c of cities) {
    const cl = clouds && clouds.cities && clouds.cities[c.id];
    if (cl && Array.isArray(cl.hours)) { c.clouds = { updated: cl.updated, hours: cl.hours }; changed.add(c.id); }
    const pl = planes && planes.cities && planes.cities[c.id];
    if (pl && Array.isArray(pl.aircraft)) { c.planes = { time: pl.time, aircraft: pl.aircraft }; changed.add(c.id); }
  }
  return changed;
}

export function pollDelayMs(manifest, failures) {
  const base = Math.min(3600, Math.max(60, (manifest && manifest.pollSec) || 300)) * 1000;
  return Math.min(30 * 60000, base * 2 ** Math.min(failures, 4));
}

// The poller. `loadFeed(id, source)` fetches and decodes a feed; `apply(id, data)` puts it into the app.
export function createLive({ base = LIVE_BASE, fetchFn, baselineTakenMs, manifest = null, loaded = {}, loadFeed, apply, onState = () => {}, onSatellites = () => {}, now = Date.now, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } }) {  // wrapped: browsers reject setTimeout called as a method of another object
  let stopped = true, busy = false, failures = 0, timer = null, lastPollAt = null, offline = !manifest, notified = null;
  const errors = {};
  const versions = { ...loaded };

  async function poll() {
    if (busy || stopped) return;
    busy = true;
    try {
      const m = await loadManifest(fetchFn, base);
      lastPollAt = now();
      if (!m) {
        failures++; offline = true;
      } else {
        failures = 0; offline = false; manifest = m;
        const src = resolveSources(m, baselineTakenMs, base);
        for (const id of APPLIED) {
          const s = src[id];
          if (!s || s.version === versions[id]) continue;
          try {
            apply(id, await loadFeed(id, s));
            versions[id] = s.version;
            delete errors[id];
          } catch (e) {
            errors[id] = String((e && e.message) || e);  // one feed failing to load never blocks the others
          }
        }
        const sat = src.satellites;
        if (sat && sat.version !== versions.satellites && sat.version !== notified) {
          notified = sat.version;
          onSatellites(sat.version);
        }
      }
    } finally {
      busy = false;
      onState();
      schedule();
    }
  }

  function schedule() {
    if (stopped) return;
    timers.clear(timer);
    timer = timers.set(poll, pollDelayMs(manifest, failures));
  }

  return {
    start() { stopped = false; schedule(); },
    stop() { stopped = true; timers.clear(timer); },
    pollNow: poll,
    state() { return { manifest, offline, failures, lastPollAt, errors: { ...errors }, versions: { ...versions }, satellitesWaiting: notified && notified !== versions.satellites ? notified : null }; },
  };
}
