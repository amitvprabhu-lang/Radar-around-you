// Helpers for the asteroid close-approach list (NASA/JPL Close-Approach Data API, via pipeline/hazards.py).

// Diameter from absolute magnitude H and a reflectivity (albedo): D = 1329 / sqrt(albedo) * 10^(-H/5) kilometres. With H = 22 and an
// albedo of 0.13 this gives about 147 m, which is what NASA's CNEOS FAQ says ("smaller than about 150 m ... H = 22.0 with assumed
// albedo of 13%"). Real sizes depend on the object's actual reflectivity, which is unknown for most of these.
export const ASSUMED_ALBEDO = 0.13;
export const diameterM = (h, albedo = ASSUMED_ALBEDO) => (h == null || !isFinite(h) ? null : (1329 / Math.sqrt(albedo)) * Math.pow(10, -h / 5) * 1000);

export function sizeText(h) {
  const d = diameterM(h);
  if (d == null) return "size not known";
  const r = d < 10 ? Math.round(d * 10) / 10 : d < 100 ? Math.round(d / 5) * 5 : d < 1000 ? Math.round(d / 10) * 10 : Math.round(d / 100) * 100;
  return `about ${r.toLocaleString("en-GB")} m`;
}

// JPL's time uncertainty is written "3_19:55" (3 days 19 h 55 min), "13:02" (13 h 2 min) or "< 00:01" (under a minute).
export function sigmaText(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (t.startsWith("<")) return "under 1 minute";
  const m = t.match(/^(?:(\d+)_)?(\d+):(\d\d)$/);
  if (!m) return null;
  const [d, hh, mm] = [Number(m[1] || 0), Number(m[2]), Number(m[3])];
  return [d ? `${d} day${d === 1 ? "" : "s"}` : null, hh ? `${hh} h` : null, mm ? `${mm} min` : null].filter(Boolean).join(" ") || "under 1 minute";
}

export const lunarText = (ld) => (ld < 1 ? `${ld.toFixed(2)} times the Moon's distance (closer than the Moon)` : `${ld.toFixed(ld < 10 ? 1 : 0)} times the Moon's distance`);
export const kmCompact = (km) => (km >= 1e6 ? `${(km / 1e6).toFixed(1)} million km` : `${Math.round(km / 1000).toLocaleString("en-GB")} thousand km`);

// "in 3 days" for the future and "6 h ago" for the past, from the signed difference (event time minus now) in milliseconds.
export function whenFromNow(diffMs) {
  const a = Math.abs(diffMs), m = Math.round(a / 60000);
  if (m < 1) return "now";
  const span = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  return diffMs > 0 ? `in ${span}` : `${span} ago`;
}
