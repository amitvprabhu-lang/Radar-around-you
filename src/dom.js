// Small DOM and formatting helpers.
export const $ = (id) => document.getElementById(id);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.500 11-6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6.500A1.500 1.500 0 006.500 20h11a1.500 1.500 0 001.500-1.500V12"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
  bell: '<path d="M6 16.500V11a6 6 0 0112 0v5.500l1.500 2h-15z"/><path d="M10 21h4"/>',
  follow: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.800"/><path d="M12 2.500V6M12 18v3.500M2.500 12H6M18 12h3.500"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  plane: '<path d="M12 2l1.800 7.500L21 13v2l-7.200-1.700L13 19l2.500 1.800V22L12 21l-3.500 1v-1.200L11 19l-.8-5.700L3 15v-2l7.200-3.500z"/>',
  down: '<path d="M12 3v14M6 12l6 6 6-6"/>',
  wave: '<path d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',
  link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1"/>',
  cal: '<rect x="4" y="5.500" width="16" height="14.500" rx="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4"/>',
};
export function icon(name, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = PATHS[name] || "";
  return s;
}

// ---- formatting ----
const dtf = (opts) => (d, tz) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).format(d);
export const fmtTime = dtf({ hour: "2-digit", minute: "2-digit" });
export const fmtDayTime = dtf({ weekday: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDate = dtf({ day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = dtf({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtUtc = (d) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d) + " UTC";
export const num = (n) => Math.round(n).toLocaleString("en-GB");
export const kmText = (km) => (km < 10 ? km.toFixed(1) : num(km)) + " km";
export const degText = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
export const latLonText = (lat, lon) => `${degText(lat, "N", "S")} ${degText(lon, "E", "W")}`;
export function ageText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}
export function durText(sec) {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const hr = Math.floor(m / 60);
  return `${hr} h ${m % 60} min`;
}
export function daysAgoText(d) {
  if (d == null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365.25)} years ago`;
}

export const safeStore = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be unavailable */ } },
};
