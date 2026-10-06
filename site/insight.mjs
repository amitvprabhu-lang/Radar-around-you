// Helpers for the "What this means" findings on the live pages (docs/superpowers/specs/2026-10-06-more-live-pages-design.md, section 8.2).
// Pure and deterministic: every finding a page prints is a sentence made by a tested function from the page's own summary, and the
// words that compare two numbers ("above", "below", "about the same as") come from the one threshold below. Shared by every live page
// family (the events pages, the sky pages and, later, the hazard pages), so the threshold and the wording are the same everywhere.

// OURS: within 15 percent of the number compared with counts as "about the same"; the pages state this in their method sections.
export const SAME_WITHIN = 0.15;
export const SAME_WITHIN_TEXT = "within 15 percent of the number it is compared with counts as about the same";

// "above", "below" or "about the same as", comparing value with reference; null when either is not a finite number.
export function direction(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return null;
  if (reference === 0) return value === 0 ? "about the same as" : value > 0 ? "above" : "below";
  const rel = (value - reference) / Math.abs(reference);
  if (Math.abs(rel) <= SAME_WITHIN + 1e-12) return "about the same as";
  return rel > 0 ? "above" : "below";
}

// "1st", "2nd", "3rd", "4th", "11th", "21st"
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

// The rank of value among values (1 is the highest when higherFirst), with how many others share it. Ties share the better rank.
export function rankOf(value, values, { higherFirst = true } = {}) {
  const list = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || !list.length) return null;
  const better = list.filter((x) => (higherFirst ? x > value : x < value)).length;
  const same = list.filter((x) => x === value).length;
  return { rank: better + 1, tiedWith: Math.max(0, same - 1), of: list.length };
}

// "the largest", "the 2nd largest", "joint 2nd largest"
export function rankPhrase(r, word = "largest") {
  if (!r) return null;
  const joint = r.tiedWith > 0 ? "the joint " : "the ";
  return r.rank === 1 ? `${joint}${word}` : `${joint}${ordinal(r.rank)} ${word}`;
}

// a share as a whole percent ("70"); "under 1" for a share above zero but under 1 percent; "0" for an empty whole
export function percentText(part, whole) {
  if (!whole) return "0";
  const p = (part / whole) * 100;
  if (p > 0 && p < 1) return "under 1";
  return String(Math.round(p));
}

// The first n rows of a list already sorted by count, and their share of total: { rows, count, total, share }.
export function topShare(rows, n, total = rows.reduce((s, r) => s + r.count, 0)) {
  const top = rows.slice(0, n);
  const count = top.reduce((s, r) => s + r.count, 0);
  return { rows: top, count, total, share: total ? count / total : 0 };
}

// mean, lowest and highest of a list of numbers; null for an empty list
export function meanAndRange(values) {
  const list = values.filter(Number.isFinite);
  if (!list.length) return null;
  return { mean: list.reduce((s, x) => s + x, 0) / list.length, min: Math.min(...list), max: Math.max(...list), n: list.length };
}

// "a", "a and b", "a, b and c"
export const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

// The change from the previous build's value: null when there is no previous value. { now, before, diff, word }
export function changeSince(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  return { now, before, diff: now - before, word: direction(now, before) };
}

// ------------------------------------------------------------------ history.json (kept beside index.json in the pages folder)
// Shape: { schema: 1, pages: { "<page key>": [{ dataTime, values: { <name>: number } }, ...] } }, oldest first, at most HISTORY_KEEP entries
// per page. site/build-live.mjs reads it, adds the headline numbers of each page it built, and writes it back; a page reads only the entry
// before its own data time, so a rebuild of the same data never compares the data with itself.
export const HISTORY_KEEP = 48;
export const HISTORY_FILE = "history.json";

// A history object from the file's text; anything unreadable is an empty history (the findings that need it are then left out).
export function readHistory(text) {
  try {
    const h = JSON.parse(text);
    if (h && typeof h === "object" && h.schema === 1 && h.pages && typeof h.pages === "object" && !Array.isArray(h.pages)) return h;
  } catch { /* an empty history */ }
  return { schema: 1, pages: {} };
}

// A new history with entry added for key: an entry with the same data time is replaced, the list is kept in data time order and cut to
// the newest `keep`. Only finite numbers are kept. The input is not changed.
export function historyAdd(history, key, { dataTime, values }, keep = HISTORY_KEEP) {
  const pages = { ...((history && history.pages) || {}) };
  const clean = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => Number.isFinite(v)).sort((a, b) => a[0].localeCompare(b[0])));
  const list = (Array.isArray(pages[key]) ? pages[key] : []).filter((e) => e && typeof e.dataTime === "string" && e.dataTime !== dataTime);
  list.push({ dataTime, values: clean });
  list.sort((a, b) => a.dataTime.localeCompare(b.dataTime));
  pages[key] = list.slice(-keep);
  return { schema: 1, pages: Object.fromEntries(Object.entries(pages).sort((a, b) => a[0].localeCompare(b[0]))) };
}

// The newest entry for key strictly before dataTime, or null.
export function previousEntry(history, key, dataTime) {
  const list = (history && history.pages && Array.isArray(history.pages[key]) ? history.pages[key] : []).filter((e) => e && typeof e.dataTime === "string" && e.dataTime < dataTime);
  return list.length ? list[list.length - 1] : null;
}
