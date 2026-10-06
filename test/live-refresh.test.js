// The live refresh of the launches page (site/live-pages-js.mjs, scoped re-review of 2026-10-06): when the page and the fresh data disagree on
// whether there is a next launch, the next-launch fields are left alone and the status line says to reload; when the next launch changes,
// the countdown's attributes follow it. The pure part is tested directly and the browser part is run in a sandbox with a pretend page.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { applyRefresh, launchesHeadline, liveScriptSource } from "../site/live-pages-js.mjs";
import { launchTimeEl } from "../site/pages-events.mjs";

const GEN = "2026-10-06T00:00:00Z";
const launch = (name, net, precision = "MIN", extra = {}) => ({ name, net, precision, provider: "Korea Aerospace Research Institute", status: "Go", statusName: "Go for Launch", ...extra });
const freshWith = (...launches) => launchesHeadline({ generated: GEN, launches });
const pageWith = (l) => { const f = freshWith(l); return Object.fromEntries(Object.entries(f).filter(([k]) => !["next-net", "next-precision-code", "next-status-text"].includes(k))); };
const pageWithout = { "next-name": "none in the list", "launches-30": "0", "exact-upcoming": "0" };

test("a page built with no next launch is not given a launch's fields by the refresh, and says to reload", () => {
  const r = applyRefresh(pageWithout, freshWith(launch("Nuri | NeonSat-2 to 6", "2026-10-07T03:23:00Z")));
  assert.equal(r.nextChanged, true);
  assert.equal(r.values["next-name"], "none in the list", "the lead never reads 'none in the list, planned for ... by ...'");
  assert.equal(r.values["launches-30"], "1", "the counts still update");
  assert.equal(r.countdown, null);
});

test("a page built with a next launch keeps its fields when the fresh list has none, and says to reload", () => {
  const page = pageWith(launch("Nuri | NeonSat-2 to 6", "2026-10-07T03:23:00Z"));
  const r = applyRefresh(page, freshWith(launch("Old", "2026-10-05T00:00:00Z")));
  assert.equal(r.nextChanged, true);
  assert.equal(r.values["next-name"], "Nuri | NeonSat-2 to 6", "never 'no launch is planned' beside a name");
  assert.equal(r.values["next-when"], page["next-when"]);
  assert.equal(r.values["launches-30"], "0");
  assert.equal(r.countdown, null);
});

test("when both have a next launch, every field and the countdown follow the new one", () => {
  const page = pageWith(launch("Nuri | NeonSat-2 to 6", "2026-10-07T03:23:00Z"));
  const r = applyRefresh(page, freshWith(launch("Electron | Test", "2026-10-08T10:00:00Z", "HR", { statusName: "To Be Confirmed" })));
  assert.equal(r.nextChanged, false);
  assert.equal(r.values["next-name"], "Electron | Test");
  assert.ok(r.changed.includes("next-name") && r.changed.includes("next-when"));
  assert.deepEqual(r.countdown, { "data-countdown": "2026-10-08T10:00:00Z", "data-precision": "HR", "data-status": "To Be Confirmed" });
  assert.deepEqual(applyRefresh(pageWithout, freshWith()).nextChanged, false, "none on both sides is no change");
});

// a pretend page and window for the whole script: the refresh runs at once, fetch answers from a pretend live folder
function runPage({ page, launches }) {
  const el = (attrs = {}, text = "") => ({ attrs: { ...attrs }, textContent: text, classList: { add() {} }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild() {} });
  const keys = Object.entries(page).map(([k, v]) => el({ "data-live-key": k }, v));
  const countdown = el({ "data-countdown": "2026-10-07T03:23:00Z", "data-precision": "MIN", "data-status": "Go for Launch" });
  const status = el({ "data-live-status": "" });
  const body = el({ "data-live-v": "1", "data-live-page": "launches", "data-live-base": "live/", "data-live-time": "2026-10-06T00:00:00Z" });
  const document = {
    body, head: { appendChild() {} }, createElement: () => el(),
    querySelector: (q) => (q === "[data-live-status]" ? status : null),
    querySelectorAll: (q) => (q === "[data-live-key]" ? keys : q === "[data-countdown]" ? [countdown] : []),
  };
  const now = Date.now(), iso = new Date(now - 60e3).toISOString();
  const files = { "live/manifest.json": { feeds: { launches: { version: "N", sourceTime: iso, files: { "launches.json": "launches/N/launches.json" } } } }, "live/launches/N/launches.json": { generated: iso, launches } };
  const pending = [];
  const window = {
    fetch: (u) => Promise.resolve({ ok: !!files[u], status: files[u] ? 200 : 404, json: () => Promise.resolve(files[u]) }),
    setTimeout: (f) => pending.push(f), setInterval: () => 0,
  };
  vm.runInNewContext(liveScriptSource(), { document, window, Intl, Date, Math, JSON, Promise, Object, Array, String, Number, isFinite, isNaN });
  return { keys, countdown, status, run: async () => { for (const f of pending.splice(0)) f(); for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); } };
}

test("in the browser part: a refresh with a different next launch moves the countdown's time, precision and status", async () => {
  const later = new Date(Date.now() + 5 * 86400e3).toISOString();
  const p = runPage({ page: pageWith(launch("Nuri | NeonSat-2 to 6", "2026-10-07T03:23:00Z")), launches: [launch("Electron | Test", later, "SEC", { statusName: "To Be Confirmed" })] });
  await p.run();
  assert.equal(p.countdown.getAttribute("data-countdown"), new Date(later).toISOString());
  assert.equal(p.countdown.getAttribute("data-precision"), "SEC");
  assert.equal(p.countdown.getAttribute("data-status"), "To Be Confirmed");
  assert.equal(p.keys.find((k) => k.getAttribute("data-live-key") === "next-name").textContent, "Electron | Test");
  assert.match(p.status.textContent, /^Updated in place/);
});

test("in the browser part: a page built with no next launch keeps its words and the status line says to reload", async () => {
  const p = runPage({ page: pageWithout, launches: [launch("Nuri | NeonSat-2 to 6", new Date(Date.now() + 86400e3).toISOString())] });
  await p.run();
  assert.equal(p.keys.find((k) => k.getAttribute("data-live-key") === "next-name").textContent, "none in the list");
  assert.match(p.status.textContent, /The next launch changed: reload for the full update\./);
  assert.equal(p.countdown.getAttribute("data-countdown"), "2026-10-07T03:23:00Z", "the countdown is not moved");
});

test("a launch known only to the year or half year has no placeholder day in its machine-readable time", () => {
  assert.equal(launchTimeEl({ net: "2027-06-30T00:00:00Z", precision: "", precisionName: "Year", when: "2027, day not set" }), '<time datetime="2027" data-sort="2027-06-30T00:00:00Z">2027, day not set</time>');
  assert.equal(launchTimeEl({ net: "2027-03-31T00:00:00Z", precision: "", precisionName: "1st Half", when: "the first half of 2027, day not set" }), '<time datetime="2027" data-sort="2027-03-31T00:00:00Z">the first half of 2027, day not set</time>');
  assert.equal(launchTimeEl({ net: "2027-03-31T00:00:00Z", precision: "", precisionName: "Day", when: "31 March 2027, time not set" }), '<time datetime="2027-03-31" data-sort="2027-03-31T00:00:00Z">31 March 2027, time not set</time>');
  assert.equal(launchTimeEl({ net: "2027-03-31T00:00:00Z", precision: "X", precisionName: "Decade", when: "2027, not an exact date" }), '<span data-sort="2027-03-31T00:00:00Z">2027, not an exact date</span>', "an unknown precision gets no machine-readable time at all");
});
