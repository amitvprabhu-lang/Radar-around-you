# Satellite Count Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live "How many satellites are in orbit?" page at `/how-many-satellites-in-orbit/`: one defined headline number (active satellites) with breakdowns, rebuilt on GitHub after each collection and copied to the Hostinger site by `pull.php`.

**Architecture:** A pure counting module (`site/satcount.mjs`) feeds a pure page module (`site/pages-satcount.mjs`) that returns a page object for the existing `renderPage`. The same modules run at deploy time (from the bundled snapshot in `public/`) and on GitHub after each collection (`site/build-live.mjs`, output in the `data` branch under `pages/`). `hosting/pull.php` gains `--pages-dest` and copies changed files only.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, no new npm packages; PHP (nothing newer than 7.4 syntax); GitHub Actions; Playwright for the existing browser suites.

**Spec:** `docs/superpowers/specs/2026-10-05-satellite-count-page-design.md` (read it first).

## Global Constraints

Copied from the spec and the project's `CLAUDE.md`. Every task includes these.

- No em dashes and no emoji, anywhere: code comments, docs, page text, commit messages. Plain, human tone.
- Never state a guess as a fact. Mark anything unchecked NOT CONFIRMED and say how to check it.
- Aggregate counts only. No per-satellite list on the page.
- The page count is "active satellites": payloads (object type Satellite, type code 0) whose status code is 1 (Operational), 2 (Partially operational), 3 (Backup or standby), 4 (Spare) or 5 (Extended mission). It is our definition, on CelesTrak's "active" list. The page must say it does not count defunct satellites, rocket bodies or most debris.
- Orbit boundaries (working definitions): High elliptical first (eccentricity 0.25 or more); otherwise by mean altitude: Low below 2,000 km, Medium from 2,000 km up to but not including 35,586 km, Geostationary from 35,586 km up to and including 35,986 km, Beyond above 35,986 km. Mean altitude = semi-major axis minus `SWARM_EARTH_RADIUS_KM` (src/core.js).
- Plausibility bounds: the builder refuses to publish if active satellites are fewer than 5,000 or more than 60,000, or if payloads + rocket bodies + debris + unknown do not equal the number of objects in the feed.
- `hosting/` PHP uses nothing newer than PHP 7.4 syntax (the server runs 8.3.33; the Mac has 8.5.11).
- No account names, server addresses, tokens or email addresses in any committed file.
- Write the test first, watch it fail, then write the code (TDD). Run the whole affected suite before each commit.
- Browser suites (`npm run e2e`, `e2e:live`, `e2e:site`) run one at a time, never two together, on a quiet machine (see CLAUDE.md). `e2e:site` needs `SITE_URL=https://zeninnov8.com SITE_NOINDEX=1`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit locally as you go. Do NOT `git push` until Task 9, and only with the owner's go-ahead: a push redeploys the site and takes `live/` offline for about 4 minutes.
- Shell note for macOS: `sed -i` needs `sed -i ''`.

## File Structure

| File | Responsibility |
| --- | --- |
| `site/satcount.mjs` (create) | Pure: decode the feed's binary files and count. No HTML. |
| `site/pages-satcount.mjs` (create) | Pure: turn counts into a page object (text, SVG charts, FAQ, structured data). Also `SATCOUNT_FILE` and `sitemapLive`. |
| `site/build-live.mjs` (create) | Reads a collector data folder, writes `pages/` (page, sitemap, `index.json`). CLI for the workflow. |
| `test/helpers/satfixture.mjs` (create) | Builds the binary inputs from a plain list of objects, for tests. |
| `test/satcount.test.js`, `test/pages-satcount.test.js`, `test/build-live.test.js` (create) | Tests for the three modules. |
| `site/pages.mjs`, `site/build.mjs`, `site/layout.mjs` (modify) | Add the page to the site, the deploy-time build, the live sitemap, robots and the nav entry. |
| `test/site.test.js` (modify) | Update the three expectations the new page changes. |
| `hosting/lib.php`, `hosting/pull.php`, `hosting/tests/run.php` (modify) | Copy finished pages; tests. |
| `.github/workflows/live-data.yml` (modify) | Build the pages after Collect. |
| `e2e-site.mjs` (modify) | One more raw-host check. |
| `docs/satcount-sources.md` (create), `docs/handoff.md`, `CLAUDE.md`, `hosting/README.md` (modify) | Records. |

---

### Task 1: Counting module

**Files:**
- Create: `test/helpers/satfixture.mjs`
- Create: `test/satcount.test.js`
- Create: `site/satcount.mjs`

**Interfaces:**
- Produces (used by every later task):
  - `buildFixture(objects, extra?) -> { meta, details: Buffer, swarm: Buffer }`, `STANDARD` (the 13 objects below), `nAtAltitude(altKm) -> rad/min` from `test/helpers/satfixture.mjs`.
  - `countSatellites({ meta, details, swarm }, { topOwners = 10 } = {}) -> Counts`, `orbitClass(nRadPerMin, ecc) -> "low"|"medium"|"geostationary"|"highElliptical"|"beyond"`, `assertPlausible(counts, { min = 5000, max = 60000 } = {})`, `ORBIT_ORDER`, `ORBIT_LABELS`, `ACTIVE_STATUSES` from `site/satcount.mjs`.
  - `Counts` shape: `{ taken, objects, types: { payload, rocketBody, debris, unknown }, active, starlink, starlinkShare, last30, statusRows: [{ name, count }], owners: [{ name, count }], ownersOther, purposes: [{ name, count }], orbits: [{ key, label, count }], launchYears: [{ year, count }], unknownYear }`.
- Consumes: `unpackDetails`, `launchDateFromDay`, `launchDayFromIso`, `swarmFromRad`, `SWARM_EARTH_RADIUS_KM` from `src/core.js`; `STATUS_NAMES` from `src/info.js`.
- File layouts (already verified in `pipeline/pack.py` and `src/core.js`): `details.bin` is 8 bytes per object: owner u8 (1-based index into `meta.owners`, 0 = none), site u8, purpose u8 (index into `meta.purposes`), type u8 (0 payload, 1 rocket body, 2 debris, 3 unknown), launchDay u16 little endian (days since 1957-10-04, 0 = none), status u8 (0 not known, 1 operational, 2 partial, 3 backup, 4 spare, 5 extended, 6 not operational, 7 decayed), 1 reserved byte. `swarm.bin` is `count` float32 pairs (epoch offset, mean motion in rad/min) then `count` records of six uint16 (eccentricity as ecc*65535 first, display kind sixth; kind 1 means the name contains STARLINK).

- [ ] **Step 1: Write the test fixture helper**

Create `test/helpers/satfixture.mjs`:

```js
// Builds the three inputs the counting code reads (details.bin, swarm.bin and the meta) from a plain list of objects, so a test can
// state exactly what is in the sky. Layouts: details are 8 bytes per object; swarm is `count` float32 pairs (epoch offset, mean
// motion in radians per minute) followed by `count` records of six uint16 (eccentricity first, display kind sixth).
import { SWARM_EARTH_RADIUS_KM, launchDayFromIso } from "../../src/core.js";

export const MU = 398600.4418;  // km^3/s^2, the constant src/core.js uses
export const nAtAltitude = (altKm) => 60 * Math.sqrt(MU / (SWARM_EARTH_RADIUS_KM + altKm) ** 3);  // radians per minute, circular orbit

const D = launchDayFromIso;
// 13 objects with known answers. Active payloads (type 0, status 1 to 5): indexes 0, 1, 2, 3, 4, 5 and 12.
export const STANDARD = [
  /* 0  */ { type: 0, status: 1, owner: 1, purpose: 9, launchDay: D("2024-03-01"), alt: 550, kind: 1 },
  /* 1  */ { type: 0, status: 1, owner: 1, purpose: 9, launchDay: D("2025-05-05"), alt: 550, kind: 1 },
  /* 2  */ { type: 0, status: 2, owner: 2, purpose: 4, launchDay: D("2020-01-01"), alt: 700 },
  /* 3  */ { type: 0, status: 3, owner: 2, purpose: 10, launchDay: D("2019-06-01"), alt: 35786 },
  /* 4  */ { type: 0, status: 5, owner: 3, purpose: 7, launchDay: D("2018-01-01"), alt: 20200 },
  /* 5  */ { type: 0, status: 4, owner: 0, purpose: 0, launchDay: 0, alt: 800 },
  /* 6  */ { type: 0, status: 6, owner: 1, purpose: 0, launchDay: D("2010-01-01"), alt: 600 },
  /* 7  */ { type: 0, status: 0, owner: 1, purpose: 0, launchDay: D("2011-01-01"), alt: 600 },
  /* 8  */ { type: 1, status: 0, alt: 600 },
  /* 9  */ { type: 2, status: 0, purpose: 18, alt: 700 },
  /* 10 */ { type: 2, status: 0, purpose: 18, alt: 700 },
  /* 11 */ { type: 3, status: 0, alt: 700 },
  /* 12 */ { type: 0, status: 1, owner: 3, purpose: 7, launchDay: D("2022-02-02"), alt: 26000, ecc: 0.7 },
];

export function buildFixture(objects, extra = {}) {
  const count = objects.length;
  const details = Buffer.alloc(count * 8);
  const swarm = Buffer.alloc(count * 8 + count * 12);
  objects.forEach((o, i) => {
    details.writeUInt8(o.owner || 0, i * 8);
    details.writeUInt8(0, i * 8 + 1);
    details.writeUInt8(o.purpose || 0, i * 8 + 2);
    details.writeUInt8(o.type, i * 8 + 3);
    details.writeUInt16LE(o.launchDay || 0, i * 8 + 4);
    details.writeUInt8(o.status || 0, i * 8 + 6);
    swarm.writeFloatLE(0, i * 8);
    swarm.writeFloatLE(o.n === undefined ? nAtAltitude(o.alt === undefined ? 500 : o.alt) : o.n, i * 8 + 4);
    swarm.writeUInt16LE(Math.round((o.ecc || 0) * 65535), count * 8 + i * 12);
    swarm.writeUInt16LE(o.kind || 0, count * 8 + i * 12 + 10);
  });
  const meta = {
    ref: 0, taken: "2026-10-05T08:14:54Z", count,
    owners: ["Alpha", "Beta", "Gamma"], ownerCodes: ["A", "B", "G"],
    purposes: ["Unspecified", "Space station", "Search and rescue", "Weather and climate", "Earth observation", "Data relay", "Navigation",
      "Science", "Geodesy", "Broadband internet", "Communications", "Amateur radio", "Military", "Radar", "Engineering test", "Education",
      "CubeSat", "Geostationary", "Debris"],
    kinds: {}, newIdx: [], ...extra,
  };
  return { meta, details, swarm };
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/satcount.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { countSatellites, orbitClass, assertPlausible, ACTIVE_STATUSES, ORBIT_ORDER } from "../site/satcount.mjs";
import { buildFixture, STANDARD, nAtAltitude } from "./helpers/satfixture.mjs";

const fx = () => buildFixture(STANDARD, { newIdx: [1, 6, 8] });

test("the standard fixture is counted exactly", () => {
  const c = countSatellites(fx());
  assert.equal(c.taken, "2026-10-05T08:14:54Z");
  assert.equal(c.objects, 13);
  assert.deepEqual(c.types, { payload: 9, rocketBody: 1, debris: 2, unknown: 1 });
  assert.equal(c.active, 7);
  assert.equal(c.starlink, 2);
  assert.equal(c.starlinkShare, 2 / 7);
  assert.equal(c.last30, 1, "only object 1 of the 30 day list is an active payload");
  assert.deepEqual(c.statusRows, [
    { name: "Not known", count: 1 }, { name: "Operational", count: 3 }, { name: "Partially operational", count: 1 },
    { name: "Backup or standby", count: 1 }, { name: "Spare", count: 1 }, { name: "Extended mission", count: 1 },
    { name: "Not operational", count: 1 },
  ]);
  assert.deepEqual(c.owners, [{ name: "Alpha", count: 2 }, { name: "Beta", count: 2 }, { name: "Gamma", count: 2 }, { name: "Not recorded", count: 1 }]);
  assert.equal(c.ownersOther, 0);
  assert.deepEqual(c.purposes, [
    { name: "Broadband internet", count: 2 }, { name: "Science", count: 2 }, { name: "Communications", count: 1 },
    { name: "Earth observation", count: 1 }, { name: "Unspecified", count: 1 },
  ]);
  assert.deepEqual(c.orbits.map((o) => [o.key, o.count]), [["low", 4], ["medium", 1], ["geostationary", 1], ["highElliptical", 1], ["beyond", 0]]);
  assert.deepEqual(c.launchYears, [{ year: 2018, count: 1 }, { year: 2019, count: 1 }, { year: 2020, count: 1 }, { year: 2022, count: 1 }, { year: 2024, count: 1 }, { year: 2025, count: 1 }]);
  assert.equal(c.unknownYear, 1);
});

test("only the top owners are listed and the rest are summed", () => {
  const c = countSatellites(fx(), { topOwners: 2 });
  assert.deepEqual(c.owners, [{ name: "Alpha", count: 2 }, { name: "Beta", count: 2 }]);
  assert.equal(c.ownersOther, 3);
});

test("the active statuses are exactly operational, partial, backup, spare and extended", () => {
  assert.deepEqual(ACTIVE_STATUSES, [1, 2, 3, 4, 5]);
  assert.deepEqual(ORBIT_ORDER, ["low", "medium", "geostationary", "highElliptical", "beyond"]);
});

test("orbit classes change exactly at the stated altitudes and at eccentricity 0.25", () => {
  assert.equal(orbitClass(nAtAltitude(1999), 0), "low");
  assert.equal(orbitClass(nAtAltitude(2001), 0), "medium");
  assert.equal(orbitClass(nAtAltitude(35585), 0), "medium");
  assert.equal(orbitClass(nAtAltitude(35587), 0), "geostationary");
  assert.equal(orbitClass(nAtAltitude(35985), 0), "geostationary");
  assert.equal(orbitClass(nAtAltitude(35987), 0), "beyond");
  assert.equal(orbitClass(nAtAltitude(500), 0.25), "highElliptical");
  assert.equal(orbitClass(nAtAltitude(500), 0.2499), "low");
});

test("a feed with no objects counts as zero, and a one object feed works", () => {
  const empty = countSatellites(buildFixture([]));
  assert.equal(empty.active, 0);
  assert.equal(empty.starlinkShare, 0);
  assert.deepEqual(empty.owners, []);
  const one = countSatellites(buildFixture([{ type: 0, status: 1, owner: 1, purpose: 4, launchDay: 1, alt: 500 }]));
  assert.equal(one.active, 1);
  assert.deepEqual(one.launchYears, [{ year: 1957, count: 1 }]);
});

test("files of the wrong size are refused with a message that names the file", () => {
  const f = fx();
  assert.throws(() => countSatellites({ ...f, details: f.details.subarray(0, f.details.length - 1) }), /details\.bin has \d+ bytes, expected 104/);
  assert.throws(() => countSatellites({ ...f, swarm: f.swarm.subarray(0, f.swarm.length - 1) }), /swarm\.bin has \d+ bytes, expected 260/);
});

test("the plausibility check accepts sane counts and refuses silly ones", () => {
  const c = countSatellites(fx());
  assert.doesNotThrow(() => assertPlausible(c, { min: 5, max: 100 }));
  assert.throws(() => assertPlausible(c, { min: 8, max: 100 }), /7 active satellites is implausible/);
  assert.throws(() => assertPlausible(c, { min: 1, max: 6 }), /implausible/);
  assert.throws(() => assertPlausible({ ...c, types: { ...c.types, payload: c.types.payload + 1 } }, { min: 5, max: 100 }), /add up to 14 but the feed has 13/);
});

test("the bundled snapshot counts consistently", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const meta = JSON.parse(fs.readFileSync(root + "meta.json", "utf8"));
  const c = countSatellites({ meta, details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") });
  const sum = (rows) => rows.reduce((s, r) => s + r.count, 0);
  assert.equal(c.objects, meta.count);
  assert.equal(c.types.payload + c.types.rocketBody + c.types.debris + c.types.unknown, meta.count);
  assert.ok(c.active > 5000 && c.active <= c.types.payload, `active ${c.active}`);
  assert.equal(sum(c.orbits), c.active);
  assert.equal(sum(c.purposes), c.active);
  assert.equal(sum(c.owners) + c.ownersOther, c.active);
  assert.equal(sum(c.launchYears) + c.unknownYear, c.active);
  assert.equal(sum(c.statusRows), c.types.payload);
  assert.ok(c.starlink > 0 && c.starlink <= meta.kinds["1"]);
  assert.doesNotThrow(() => assertPlausible(c));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/satcount.test.js`
Expected: FAIL with `Cannot find module '.../site/satcount.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `site/satcount.mjs`:

```js
// Counts what is in the satellite feed. Pure functions over the feed's binary files: no HTML, so every number can be tested on its own.
// The feed is CelesTrak's "active" list plus a few debris clouds (see docs/satcount-sources.md), so "active satellites" is the number
// it can honestly give. File layouts are documented in test/helpers/satfixture.mjs and pipeline/pack.py.
import { unpackDetails, launchDateFromDay, swarmFromRad, SWARM_EARTH_RADIUS_KM } from "../src/core.js";
import { STATUS_NAMES } from "../src/info.js";

// status codes 1 to 5: operational, partially operational, backup or standby, spare, extended mission. OURS: the definition of "active".
export const ACTIVE_STATUSES = [1, 2, 3, 4, 5];
const ACTIVE = new Set(ACTIVE_STATUSES);
const TYPE_KEYS = ["payload", "rocketBody", "debris", "unknown"];

export const ORBIT_ORDER = ["low", "medium", "geostationary", "highElliptical", "beyond"];
export const ORBIT_LABELS = {
  low: "Low Earth orbit (below 2,000 km)",
  medium: "Medium Earth orbit (2,000 to 35,585 km)",
  geostationary: "Geostationary belt (35,586 to 35,986 km)",
  highElliptical: "High elliptical (eccentricity 0.25 or more)",
  beyond: "Beyond the geostationary belt",
};

// OURS: working definitions, not a cited standard. High elliptical is checked first; the mean altitude is the semi-major axis minus the
// equatorial radius the swarm decoder uses.
export function orbitClass(nRadPerMin, ecc) {
  if (ecc >= 0.25) return "highElliptical";
  const alt = swarmFromRad(0, nRadPerMin, 0, 0, 0, 0, 0).a - SWARM_EARTH_RADIUS_KM;
  if (alt < 2000) return "low";
  if (alt < 35586) return "medium";
  if (alt <= 35986) return "geostationary";
  return "beyond";
}

function readSwarm(buf, count) {
  if (buf.length !== count * 20) throw new Error(`satcount: swarm.bin has ${buf.length} bytes, expected ${count * 20} for ${count} objects`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { f32: new Float32Array(ab, 0, count * 2), u16: new Uint16Array(ab, count * 8, count * 6) };
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

export function countSatellites({ meta, details, swarm }, { topOwners = 10 } = {}) {
  const count = meta.count;
  if (details.length !== count * 8) throw new Error(`satcount: details.bin has ${details.length} bytes, expected ${count * 8} for ${count} objects`);
  const { f32, u16 } = readSwarm(swarm, count);
  const types = { payload: 0, rocketBody: 0, debris: 0, unknown: 0 };
  const statusCounts = new Array(STATUS_NAMES.length).fill(0);
  const owners = new Map(), purposes = new Map(), years = new Map();
  const orbitCounts = Object.fromEntries(ORBIT_ORDER.map((k) => [k, 0]));
  const isActive = new Array(count).fill(false);
  let active = 0, starlink = 0, unknownYear = 0;
  for (let i = 0; i < count; i++) {
    const d = unpackDetails(details, i);
    types[TYPE_KEYS[d.type] || "unknown"]++;
    if (d.type !== 0) continue;
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    if (!ACTIVE.has(d.status)) continue;
    isActive[i] = true;
    active++;
    if (u16[i * 6 + 5] === 1) starlink++;
    orbitCounts[orbitClass(f32[i * 2 + 1], u16[i * 6] / 65535)]++;
    bump(owners, d.owner ? meta.owners[d.owner - 1] || "Not recorded" : "Not recorded");
    bump(purposes, meta.purposes[d.purpose] || "Unspecified");
    const date = launchDateFromDay(d.launchDay);
    if (date) bump(years, date.getUTCFullYear()); else unknownYear++;
  }
  let last30 = 0;
  for (const i of meta.newIdx || []) if (isActive[i]) last30++;
  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, "en");
  const rows = (map) => [...map].map(([name, n]) => ({ name, count: n })).sort(byCount);
  const ownerRows = rows(owners);
  return {
    taken: meta.taken, objects: count, types, active, starlink, starlinkShare: active ? starlink / active : 0, last30,
    statusRows: STATUS_NAMES.map((name, i) => ({ name, count: statusCounts[i] || 0 })).filter((r) => r.count > 0),
    owners: ownerRows.slice(0, topOwners), ownersOther: ownerRows.slice(topOwners).reduce((s, r) => s + r.count, 0),
    purposes: rows(purposes),
    orbits: ORBIT_ORDER.map((key) => ({ key, label: ORBIT_LABELS[key], count: orbitCounts[key] })),
    launchYears: [...years].sort((a, b) => a[0] - b[0]).map(([year, n]) => ({ year, count: n })), unknownYear,
  };
}

// Refuses numbers that cannot be right, so a broken feed never publishes a nonsense page.
export function assertPlausible(c, { min = 5000, max = 60000 } = {}) {
  const sum = c.types.payload + c.types.rocketBody + c.types.debris + c.types.unknown;
  if (sum !== c.objects) throw new Error(`satcount: the object types add up to ${sum} but the feed has ${c.objects} objects`);
  if (c.active < min || c.active > max) throw new Error(`satcount: ${c.active} active satellites is implausible (expected ${min} to ${max})`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/satcount.test.js`
Expected: all tests PASS. If the owners test fails because of the `localeCompare` tie order, the expected order in Step 2 is Alpha, Beta, Gamma, "Not recorded" (count then name).

- [ ] **Step 6: Run the whole unit suite**

Run: `npm test`
Expected: 270 earlier tests plus the new ones, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/satfixture.mjs test/satcount.test.js site/satcount.mjs
git commit -m "Count active satellites from the feed's binary files

Pure counting code with a fixture of known answers: types, statuses, owners, purposes,
orbit classes, launch years, last 30 days and the Starlink share, plus a plausibility
check that refuses nonsense totals.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The page

**Files:**
- Create: `site/pages-satcount.mjs`
- Create: `test/pages-satcount.test.js`

**Interfaces:**
- Consumes: `esc`, `table`, `sources`, `SITE`, `urlPath`, `href` from `site/layout.mjs`; `Counts` from Task 1.
- Produces: `satelliteCountPage(counts, { updated: Date }) -> page object` (same shape as the pages in `site/pages-guides.mjs`: `file, title, description, h1, kicker, lead, meta, cta, body, jsonld, crumbTitle`), `SATCOUNT_FILE` (`"how-many-satellites-in-orbit/index.html"`), `sitemapLive(lastmodIso) -> string`, `barChartSvg`, `columnChartSvg`.

- [ ] **Step 1: Write the failing tests**

Create `test/pages-satcount.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { countSatellites } from "../site/satcount.mjs";
import { satelliteCountPage, SATCOUNT_FILE, sitemapLive, barChartSvg, columnChartSvg } from "../site/pages-satcount.mjs";
import { renderPage, SITE } from "../site/layout.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";

const counts = countSatellites(buildFixture(STANDARD, { newIdx: [1, 6, 8] }));
const updated = new Date("2026-10-05T09:00:00Z");
const page = satelliteCountPage(counts, { updated });
const html = renderPage(page, { noindex: false });
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

test("the page has its own address, one h1 written as the question, and sane title and description lengths", () => {
  assert.equal(SATCOUNT_FILE, "how-many-satellites-in-orbit/index.html");
  assert.equal(page.file, SATCOUNT_FILE);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(page.h1, "How many satellites are in orbit?");
  assert.equal(page.title, "How many satellites are in orbit? Live count, 5 October 2026");
  assert.ok(page.title.length >= 15 && page.title.length <= 85);
  assert.ok(page.description.length >= 60 && page.description.length <= 320, String(page.description.length));
});

test("the answer comes first, and the same number appears in the lead, description, FAQ and structured data", () => {
  assert.match(page.lead, /^As of 5 October 2026, 08:14 UTC, there are <strong>7 active satellites<\/strong> in orbit/);
  assert.match(page.description, /^7 active satellites/);
  const faq = html.slice(html.indexOf('id="faq"'));
  assert.match(faq, /How many satellites are in orbit right now\?[\s\S]*?7 active satellites/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  const webpage = ld.find((o) => o["@type"] === "WebPage");
  assert.ok(webpage && webpage.description.startsWith("7 active satellites"));
  assert.equal(webpage.url, `${SITE.url}/how-many-satellites-in-orbit/`);
});

test("the structured date is the visible page update time, not the data time", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  assert.equal(ld.find((o) => o["@type"] === "WebPage").dateModified, "2026-10-05T09:00:00.000Z");
  assert.ok(html.includes('<time datetime="2026-10-05T09:00:00.000Z">'));
  assert.ok(html.includes('<time datetime="2026-10-05T08:14:54Z">'), "the data time is shown separately");
});

test("every section a reader or an answer engine looks for is there, with question headings", () => {
  for (const id of ["answer", "active", "who", "orbits", "purpose", "growth", "not-counted", "how", "faq", "sources"]) assert.ok(html.includes(` id="${id}"`), id);
  assert.match(html, /<h2 id="not-counted">What this count does not include<\/h2>/);
  assert.match(html, /defunct satellites, rocket bodies/);
});

test("the tables add up to the headline number", () => {
  const rowsOf = (caption) => {
    const m = html.match(new RegExp(`aria-label="${caption}"[\\s\\S]*?</table>`));
    assert.ok(m, caption);
    return [...m[0].matchAll(/<td class="num">([\d,]+)<\/td>/g)].map((x) => Number(x[1].replace(/,/g, "")));
  };
  const sum = (a) => a.reduce((s, n) => s + n, 0);
  assert.equal(sum(rowsOf("Active satellites by owner")), 7);
  assert.equal(sum(rowsOf("Active satellites by orbit")), 7);
  assert.equal(sum(rowsOf("Active satellites by purpose")), 7);
});

test("every chart is an accessible image with a title and a description, and has a text table beside it", () => {
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
  assert.ok(svgs.length >= 4);
  for (const s of svgs) {
    assert.match(s, /role="img"/);
    assert.match(s, /aria-labelledby="([a-z0-9-]+)-t \1-d"/);
    assert.match(s, /<title id="[a-z0-9-]+-t">[^<]+<\/title>/);
    assert.match(s, /<desc id="[a-z0-9-]+-d">[^<]+<\/desc>/);
  }
});

test("names from the data are escaped, and long labels are shortened in the chart but not in the table", () => {
  const evil = { ...counts, owners: [{ name: "<b>X</b> & Co", count: 5 }, { name: "A".repeat(60), count: 2 }], ownersOther: 0, active: 7 };
  const h = renderPage(satelliteCountPage(evil, { updated }), { noindex: false });
  assert.ok(!h.includes("<b>X</b>"));
  assert.ok(h.includes("&lt;b&gt;X&lt;/b&gt; &amp; Co"));
  assert.ok(h.includes("A".repeat(33) + "..."), "chart label is shortened");
  assert.ok(h.includes("A".repeat(60)), "the table keeps the full name");
});

test("the page follows the house style, loads nothing from elsewhere and stays small", () => {
  const text = textOf(html);
  assert.ok(!/[\u2013\u2014]/.test(text), "no en or em dashes");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), "no emoji");
  assert.ok(!/<script[^>]+src=/.test(html) && !/<img /.test(html) && !/<link[^>]+stylesheet/.test(html));
  assert.ok(Buffer.byteLength(html) < 120 * 1024, String(Buffer.byteLength(html)));
  assert.ok(html.includes("CelesTrak"), "the source is credited");
});

test("the live sitemap names the page with an accurate last modified time", () => {
  const xml = sitemapLive("2026-10-05T09:00:00.000Z");
  assert.ok(xml.includes(`<loc>${SITE.url}/how-many-satellites-in-orbit/</loc>`));
  assert.ok(xml.includes("<lastmod>2026-10-05T09:00:00.000Z</lastmod>"));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
});

test("the chart helpers handle one row and a zero maximum", () => {
  assert.match(barChartSvg({ id: "c", title: "t", desc: "d", rows: [{ label: "a", value: 0 }] }), /<rect /);
  assert.match(columnChartSvg({ id: "c", title: "t", desc: "d", rows: [{ label: "2020", value: 3 }] }), /<rect /);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pages-satcount.test.js`
Expected: FAIL with `Cannot find module '.../site/pages-satcount.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/pages-satcount.mjs`:

```js
// The "How many satellites are in orbit?" page. Pure: takes the counts from site/satcount.mjs and returns a page object for renderPage.
// Every figure on the page comes from the one `counts` value, so the lead, description, FAQ, tables and structured data cannot disagree.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";

export const SATCOUNT_FILE = "how-many-satellites-in-orbit/index.html";

const num = (n) => n.toLocaleString("en-GB");
const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateLong = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const timeUtc = (iso) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 3) + "..." : s);

// A sitemap with the one live page and an accurate last modified time (the time the page was last rebuilt, which only happens when the
// satellite data changes). Google uses lastmod only if it is consistently accurate.
export const sitemapLive = (lastmodIso) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(`${SITE.url}/${urlPath(SATCOUNT_FILE)}`)}</loc><lastmod>${esc(lastmodIso)}</lastmod></url>
</urlset>
`;

export function barChartSvg({ id, title, desc, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 28, labelW = 250, barMax = 340, w = labelW + barMax + 90, h = rows.length * rowH + 8;
  const body = rows.map((r, i) => {
    const y = 4 + i * rowH, bw = Math.max(2, Math.round((r.value / max) * barMax));
    return `<text x="${labelW - 8}" y="${y + 18}" text-anchor="end" fill="var(--text)" font-size="13">${esc(trunc(r.label, 36))}</text>` +
      `<rect x="${labelW}" y="${y + 4}" width="${bw}" height="16" rx="3" fill="var(--ion)"></rect>` +
      `<text x="${labelW + bw + 8}" y="${y + 18}" fill="var(--muted)" font-size="13">${num(r.value)}</text>`;
  }).join("");
  return `<svg class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${body}</svg>`;
}

export function columnChartSvg({ id, title, desc, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const colW = 38, plotH = 170, w = rows.length * colW + 20, h = plotH + 50;
  const body = rows.map((r, i) => {
    const bh = Math.max(2, Math.round((r.value / max) * plotH)), x = 10 + i * colW, y = 20 + plotH - bh;
    return `<rect x="${x + 4}" y="${y}" width="${colW - 10}" height="${bh}" rx="2" fill="var(--ion)"></rect>` +
      `<text x="${x + colW / 2 - 1}" y="${y - 4}" text-anchor="middle" fill="var(--muted)" font-size="10">${num(r.value)}</text>` +
      `<text x="${x + colW / 2 - 1}" y="${plotH + 36}" text-anchor="middle" fill="var(--text)" font-size="11">${esc(r.label)}</text>`;
  }).join("");
  return `<svg class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${body}</svg>`;
}

const CELESTRAK = { title: "CelesTrak current GP data (the active list)", url: "https://celestrak.org/NORAD/elements/", note: "Where the orbital element sets come from" };
const SATCAT = { title: "CelesTrak SATCAT format", url: "https://celestrak.org/satcat/satcat-format.php", note: "Owner, launch date, status and type for each object" };
const STATUS = { title: "CelesTrak SATCAT status codes", url: "https://celestrak.org/satcat/status.php", note: "What Operational, Partially operational and the other statuses mean" };

export function satelliteCountPage(c, { updated }) {
  const upIso = updated.toISOString();
  const active = num(c.active), date = dateLong(c.taken), time = timeUtc(c.taken);
  const top = c.owners[0];
  const share = pct(c.starlinkShare);
  const description = `${active} active satellites were in orbit on ${date}, ${share} percent of them Starlink. Counted from CelesTrak's active list, with breakdowns by owner, orbit, purpose and launch year.`;
  const url = `${SITE.url}/${urlPath(SATCOUNT_FILE)}`;

  const ownerRows = c.owners.map((o) => ({ label: o.name, value: o.count }));
  const orbitRows = c.orbits.map((o) => ({ label: o.label, value: o.count }));
  const purposeRows = c.purposes.slice(0, 10).map((p) => ({ label: p.name, value: p.count }));
  const keep = c.launchYears.slice(-15);
  const earlier = c.launchYears.slice(0, -15).reduce((s, y) => s + y.count, 0);
  const yearRows = (earlier ? [{ label: "Earlier", value: earlier }] : []).concat(keep.map((y) => ({ label: String(y.year), value: y.count })));

  const body = `
<ul class="grid">
<li><div class="card"><b>${active}</b><span>Active satellites</span></div></li>
<li><div class="card"><b>${num(c.starlink)}</b><span>Starlink satellites, ${share} percent of the active total</span></div></li>
<li><div class="card"><b>${num(c.last30)}</b><span>Active satellites launched in the 30 days before the data time</span></div></li>
</ul>

<h2 id="answer">How many satellites are in orbit?</h2>
<p>${active} satellites are active in orbit as of ${esc(date)}. That is the number of active satellites on CelesTrak's current list, using our definition of active (below). Of these, ${num(c.starlink)} belong to the Starlink network.</p>

<h2 id="active">What counts as an active satellite?</h2>
<p>We count objects the catalogue types as satellites (not rocket bodies or debris) whose recorded status is Operational, Partially operational, Backup or standby, Spare or Extended mission. This is our definition, not CelesTrak's. The table lists every status among the catalogue's satellites, so you can add them up your own way.</p>
${table({ caption: "Satellites in the feed by recorded status", head: ["Status", "Satellites"], numeric: [1], rows: c.statusRows.map((r) => [esc(r.name), num(r.count)]) })}

<h2 id="who">Which countries and operators have the most satellites?</h2>
<p>${top ? `${esc(top.name)} has the most, with ${num(top.count)} active satellites. ` : ""}Owners are shown as the catalogue records them, which mixes countries and organisations.</p>
${barChartSvg({ id: "chart-owners", title: "Active satellites by owner", desc: `The ${c.owners.length} owners with the most active satellites. ${top ? `${top.name} is highest with ${num(top.count)}.` : ""}`, rows: ownerRows })}
${table({ caption: "Active satellites by owner", head: ["Owner", "Active satellites"], numeric: [1], rows: c.owners.map((o) => [esc(o.name), num(o.count)]).concat(c.ownersOther ? [["All other owners", num(c.ownersOther)]] : []) })}

<h2 id="orbits">Where are the satellites?</h2>
<p>Most active satellites are in low Earth orbit, where the Starlink network lives. The table groups every active satellite by its orbit. These groupings are our working definitions, not a standard: a high elliptical orbit is one with an eccentricity of 0.25 or more, and the other groups use the satellite's mean altitude.</p>
${barChartSvg({ id: "chart-orbits", title: "Active satellites by orbit", desc: "Active satellites grouped into low, medium, geostationary, high elliptical and beyond-geostationary orbits.", rows: orbitRows })}
${table({ caption: "Active satellites by orbit", head: ["Orbit", "Active satellites"], numeric: [1], rows: c.orbits.map((o) => [esc(o.label), num(o.count)]) })}

<h2 id="purpose">What are the satellites for?</h2>
<p>Purposes are CelesTrak's own groupings, a convenience and not a statement of a satellite's mission. "Unspecified" means the catalogue has no grouping for that satellite.</p>
${barChartSvg({ id: "chart-purpose", title: "Active satellites by purpose", desc: "The ten most common purposes among active satellites.", rows: purposeRows })}
${table({ caption: "Active satellites by purpose", head: ["Purpose", "Active satellites"], numeric: [1], rows: c.purposes.map((p) => [esc(p.name), num(p.count)]) })}

<h2 id="growth">How fast is the number growing?</h2>
<p>The chart shows when today's active satellites were launched. It counts satellites still active now, grouped by launch year. It is not a count of launches in each year, because satellites launched earlier and since retired are not in it.</p>
${columnChartSvg({ id: "chart-years", title: "Active satellites by launch year", desc: "How many of today's active satellites were launched in each of the last fifteen years, with all earlier launches combined.", rows: yearRows })}
${table({ caption: "Active satellites by launch year", head: ["Launch year", "Active satellites"], numeric: [1], rows: yearRows.map((r) => [esc(r.label), num(r.value)]).concat(c.unknownYear ? [["Launch date not recorded", num(c.unknownYear)]] : []) })}

<h2 id="not-counted">What this count does not include</h2>
<p>This page counts active satellites only. It does not count defunct satellites, rocket bodies or most debris, because the data behind it is CelesTrak's list of active satellites. The feed also carries four named debris clouds, but those are not the total amount of debris in orbit and we do not present them as one. The count of everything tracked in orbit is much larger than the number of active satellites.</p>

<h2 id="how">How we count</h2>
<ul>
<li>Source: CelesTrak's current orbital element sets for its active list, with each object's owner, launch date, type and status from CelesTrak's satellite catalogue. The data time above is when we last read them.</li>
<li>An active satellite is a catalogue satellite with a status of Operational, Partially operational, Backup or standby, Spare or Extended mission.</li>
<li>Starlink satellites are those whose catalogue name contains STARLINK.</li>
<li>The orbit groups are our working definitions: eccentricity of 0.25 or more is high elliptical; otherwise mean altitude below 2,000 km is low, from 2,000 km up to 35,585 km is medium, 35,586 to 35,986 km is the geostationary belt, and anything higher is beyond it.</li>
<li>Other trackers use other definitions and other data, so their totals can differ from ours.</li>
</ul>

<h2 id="faq">Frequently asked questions</h2>
<h3>How many satellites are in orbit right now?</h3>
<p>As of ${esc(date)}, ${active} active satellites, on CelesTrak's active list and our definition of active.</p>
<h3>How many of them are Starlink?</h3>
<p>${num(c.starlink)}, which is ${share} percent of the active total.</p>
<h3>Which country has the most satellites?</h3>
<p>${top ? `${esc(top.name)}, with ${num(top.count)} active satellites, as the catalogue records owners.` : "The catalogue records no owners in this data."}</p>
<h3>How many satellites were launched recently?</h3>
<p>${num(c.last30)} of today's active satellites were launched in the 30 days before ${esc(date)}.</p>
<h3>Do you count space debris and rocket bodies?</h3>
<p>No. This page counts active satellites only.</p>
${sources([CELESTRAK, SATCAT, STATUS])}`;

  return {
    file: SATCOUNT_FILE, crumbTitle: "Satellite count",
    title: `How many satellites are in orbit? Live count, ${date}`, description,
    h1: "How many satellites are in orbit?", kicker: "Live count",
    lead: `As of ${esc(date)}, ${esc(time)}, there are <strong>${active} active satellites</strong> in orbit, by CelesTrak's active list and our definition of active (below). ${num(c.starlink)} of them, ${share} percent, are Starlink.`,
    meta: `Data as of <time datetime="${esc(c.taken)}">${esc(date)}, ${esc(time)}</time>. Page updated <time datetime="${esc(upIso)}">${esc(dateLong(upIso))}, ${esc(timeUtc(upIso))}</time>. Satellite data from CelesTrak.`,
    cta: { label: "See them on the live globe", query: "" },
    body,
    jsonld: [{ "@context": "https://schema.org", "@type": "WebPage", name: `How many satellites are in orbit? Live count, ${date}`, description, url, dateModified: upIso }],
  };
}
```

Note: `href` is imported for future internal links; if the linter or the reader dislikes an unused import, delete it from the import line.

- [ ] **Step 4: Run the page tests**

Run: `node --test test/pages-satcount.test.js`
Expected: all PASS. Likely fixes if one fails: the lead regex expects the exact text `As of 5 October 2026, 08:14 UTC, there are <strong>7 active satellites</strong> in orbit`; the table-sum tests read `<td class="num">` cells, so the `table()` helper's numeric columns must render with `class="num"` (they do in `site/layout.mjs`); the "A".repeat(33) check relies on `trunc(s, 36)` cutting at 33 characters plus "...".

- [ ] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: 0 failed. (The new page is not in the site build yet, so `site.test.js` is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add site/pages-satcount.mjs test/pages-satcount.test.js
git commit -m "Add the satellite count page

One headline number (active satellites) with owner, orbit, purpose and launch year
breakdowns as accessible inline charts with text tables, an answer-first lead, question
headings, a visible FAQ, an honest section on what is not counted, and structured data
whose date is the page update time.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Put the page into the site build

**Files:**
- Modify: `site/pages.mjs`, `site/layout.mjs`, `site/build.mjs`
- Modify: `test/site.test.js` (three expectations)

**Interfaces:**
- Consumes: `countSatellites`, `assertPlausible` (Task 1); `satelliteCountPage`, `SATCOUNT_FILE`, `sitemapLive` (Task 2).
- Produces: `loadSatellites() -> { meta, details, swarm }` (reads `public/meta.json`, `public/details.bin`, `public/swarm.bin`) exported from `site/build.mjs`; `build({ ..., satellites, now })` accepts both; `buildPages({ ..., satcount, updated })`; the build writes `sitemap-live.xml` when indexable; `robots()` lists both sitemaps.

- [ ] **Step 1: Update the three existing expectations in `test/site.test.js` (they will fail until the build changes)**

Add to the imports near the top of `test/site.test.js`:

```js
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
```

Replace the page count test body (comment and assertion):

```js
  // home, 5 data pages, city index and 6 cities, constellation index and 88, stars, guide index and 6 guides, methods, satellite count
  assert.equal(result.pages, 1 + 5 + 1 + cities.length + 1 + 88 + 1 + 1 + 6 + 1 + 1);
```

Replace the sitemap test (`the sitemap lists every page once and robots.txt points to it`) with:

```js
test("the sitemap lists every page once except the live page, which has its own sitemap with an accurate last modified time", () => {
  const xml = fs.readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const listed = pageFiles.filter((f) => f !== SATCOUNT_FILE);
  assert.equal(locs.length, listed.length);
  assert.equal(new Set(locs).size, locs.length);
  for (const f of listed) assert.ok(locs.includes(`${SITE.url}/${urlPath(f)}`), f);
  assert.ok(!locs.some((l) => l.includes("how-many-satellites")), "the live page is not in the main sitemap");
  const live = fs.readFileSync(path.join(outDir, "sitemap-live.xml"), "utf8");
  assert.ok(live.includes(`<loc>${SITE.url}/how-many-satellites-in-orbit/</loc>`));
  assert.match(live, /<lastmod>\d{4}-\d\d-\d\dT[\d:.]+Z<\/lastmod>/);
  const robotsTxt = fs.readFileSync(path.join(outDir, "robots.txt"), "utf8");
  assert.match(robotsTxt, new RegExp(`Sitemap: ${SITE.url}/sitemap.xml`));
  assert.match(robotsTxt, new RegExp(`Sitemap: ${SITE.url}/sitemap-live.xml`));
  assert.equal(sitemap(["index.html", "a/index.html"]).includes("<loc>" + SITE.url + "/a/</loc>"), true);
  assert.ok(robots().includes("Allow: /"));
});
```

In the test `the normal build still tells search engines to index every page...` replace the `robots` equality line with:

```js
  assert.equal(robots({ noindex: false }), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\nSitemap: ${SITE.url}/sitemap-live.xml\n`);
```

Also add this new test at the end of the file:

```js
test("a noindex build writes no sitemaps at all, as before", () => {
  const dir = path.join(tmp, "out-noindex");
  build({ outDir: dir, appFile, publicDir: null, noindex: true });
  assert.ok(!fs.existsSync(path.join(dir, "sitemap.xml")));
  assert.ok(!fs.existsSync(path.join(dir, "sitemap-live.xml")));
  assert.equal(fs.readFileSync(path.join(dir, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n");
  assert.ok(fs.readFileSync(path.join(dir, SATCOUNT_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
});
```

- [ ] **Step 2: Run the site tests to see them fail**

Run: `node --test test/site.test.js`
Expected: FAIL (page count, sitemap and robots expectations; the noindex test fails because the page is not built yet).

- [ ] **Step 3: Add the page to `buildPages`**

In `site/pages.mjs` add the import and change the function:

```js
import { satelliteCountPage } from "./pages-satcount.mjs";
```

```js
export function buildPages({ cities, consIdx, starsDoc, checks, details = null, satcount = null, updated = null }) {
  const guides = [auroraGuide(), stormGuide(), quakeGuide(), fireGuide(), asteroidGuide(), satelliteGuide()];
  return [
    moonPage(checks), seasonsPage(checks, cities), eclipsesPage(checks, cities), planetsPage(), showersPage(cities),
    citiesIndex(cities), ...cities.map((c) => cityPage(c, cities, consIdx, checks)),
    constellationsIndex(consIdx), ...consIdx.list.map((c) => constellationPage(c, consIdx, starsDoc, cities, details)),
    starsIndex(starsDoc, consIdx, details),
    guidesIndex(guides), ...guides, methodsPage(checks),
    ...(satcount ? [satelliteCountPage(satcount, { updated })] : []),
  ];
}
```

- [ ] **Step 4: Add the navigation entry**

In `site/layout.mjs`, in the `NAV` array add one entry after the Planets line:

```js
  ["how-many-satellites-in-orbit/", "Satellite count"],
```

- [ ] **Step 5: Change the build**

In `site/build.mjs`:

1. Add imports:

```js
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { SATCOUNT_FILE, sitemapLive } from "./pages-satcount.mjs";
```

2. Add after `loadCities`:

```js
// The satellite snapshot bundled with the repository (public/), used for the deploy-time copy of the satellite count page so the address
// never returns 404 after a redeploy. The live copy replaces it within minutes, built on GitHub from the collector's data.
export function loadSatellites() {
  return {
    meta: readJson("public/meta.json"),
    details: fs.readFileSync(path.join(root, "public/details.bin")),
    swarm: fs.readFileSync(path.join(root, "public/swarm.bin")),
  };
}
```

3. Replace the `robots` export with:

```js
export const robots = ({ noindex = SITE.noindex } = {}) => (noindex ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\nSitemap: ${SITE.url}/sitemap-live.xml\n`);
```

4. In the `build(...)` signature add the options `now = new Date(), satellites = loadSatellites()` (keep every existing option), then replace the line `const pages = buildPages({ cities, consIdx, starsDoc, checks, details });` with:

```js
  const satcount = countSatellites(satellites);
  assertPlausible(satcount);
  const pages = buildPages({ cities, consIdx, starsDoc, checks, details, satcount, updated: now });
```

5. Replace the line `if (!noindex) fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(files));` with:

```js
  if (!noindex) {
    fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(files.filter((f) => f !== SATCOUNT_FILE)));
    fs.writeFileSync(path.join(outDir, "sitemap-live.xml"), sitemapLive(now.toISOString()));
  }
```

- [ ] **Step 6: Run the site tests**

Run: `node --test test/site.test.js`
Expected: all PASS, including the new noindex test. If `every internal link and anchor resolves` fails for the new page, read the failure: the page only links to `index.html` (via the shell), the guides pages and external CelesTrak URLs.

- [ ] **Step 7: Run everything that does not need a browser**

Run: `npm test && npm run test:pipeline && npm run test:hosting`
Expected: 0 failed in each (hosting prints one deprecation notice on PHP 8.5; that is the known `$http_response_header` warning).

- [ ] **Step 8: Build the real site once and look at it**

Run: `npm run build:hosting` then `ls dist/site/how-many-satellites-in-orbit/ dist/site/sitemap-live.xml 2>&1; grep -c "active satellites" dist/site/how-many-satellites-in-orbit/index.html`
Expected: the page exists. With `SITE_NOINDEX=1 SITE_URL=https://zeninnov8.com npm run build:hosting` there is no `sitemap-live.xml`.

- [ ] **Step 9: Commit**

```bash
git add site/pages.mjs site/layout.mjs site/build.mjs test/site.test.js
git commit -m "Build the satellite count page into the site

The deploy-time build makes the page from the bundled snapshot so the address never
404s after a redeploy. The live page has its own sitemap with an accurate last modified
time, and robots.txt names both sitemaps. A noindex build still writes no sitemaps.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The GitHub-side builder

**Files:**
- Create: `site/build-live.mjs`
- Create: `test/build-live.test.js`

**Interfaces:**
- Consumes: `countSatellites`, `assertPlausible` (Task 1); `satelliteCountPage`, `SATCOUNT_FILE`, `sitemapLive` (Task 2); `renderPage`, `SITE` from `site/layout.mjs`.
- Produces: `buildLive({ dataDir, outDir, now = new Date(), noindex = SITE.noindex, bounds }) -> { changed: boolean, version: string }` from `site/build-live.mjs`. Writes `outDir/how-many-satellites-in-orbit/index.html`, `outDir/sitemap-live.xml` (only when not noindex), and `outDir/index.json`:
  `{ schema: 1, satellitesVersion, siteUrl, noindex, built, files: { "<path>": { sha256, size, changed } } }`. CLI: `node site/build-live.mjs --data live --out live/pages`, which exits 1 with a message if `SITE_URL` is empty or anything throws.

- [ ] **Step 1: Write the failing tests**

Create `test/build-live.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildLive } from "../site/build-live.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";

const bounds = { min: 5, max: 100 };  // the fixture is tiny; the real bounds are tested in satcount.test.js
const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bl-")); tmps.push(d); return d; };
test.after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function dataDir(version, fx = buildFixture(STANDARD, { newIdx: [1] })) {
  const dir = mk(), base = `satellites/${version}`;
  fs.mkdirSync(path.join(dir, base), { recursive: true });
  fs.writeFileSync(path.join(dir, base, "details.bin"), fx.details);
  fs.writeFileSync(path.join(dir, base, "swarm.bin"), fx.swarm);
  fs.writeFileSync(path.join(dir, base, "satmeta.json"), JSON.stringify(fx.meta));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version, files: { "details.bin": `${base}/details.bin`, "satmeta.json": `${base}/satmeta.json`, "swarm.bin": `${base}/swarm.bin` } } } }));
  return dir;
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("the first build writes the page, the live sitemap and an index whose hashes match the files", () => {
  const out = mk();
  const r = buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.deepEqual(r, { changed: true, version: "V1" });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.schema, 1);
  assert.equal(index.satellitesVersion, "V1");
  assert.deepEqual(Object.keys(index.files).sort(), [SATCOUNT_FILE, "sitemap-live.xml"]);
  for (const [p, info] of Object.entries(index.files)) {
    assert.equal(info.sha256, sha(path.join(out, p)), p);
    assert.equal(info.size, fs.statSync(path.join(out, p)).size, p);
    assert.equal(info.changed, "2026-10-05T09:00:00.000Z");
  }
  const html = fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8");
  assert.ok(html.includes("7 active satellites"));
  assert.ok(html.includes('<time datetime="2026-10-05T09:00:00.000Z">'));
});

test("the same satellites version builds nothing and touches nothing", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const before = fs.readFileSync(path.join(out, "index.json"), "utf8"), mtime = fs.statSync(path.join(out, SATCOUNT_FILE)).mtimeMs;
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T10:00:00Z"), noindex: false, bounds });
  assert.deepEqual(r, { changed: false, version: "V1" });
  assert.equal(fs.readFileSync(path.join(out, "index.json"), "utf8"), before);
  assert.equal(fs.statSync(path.join(out, SATCOUNT_FILE)).mtimeMs, mtime);
});

test("a new satellites version rebuilds and moves the last modified time", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const r = buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds });
  assert.deepEqual(r, { changed: true, version: "V2" });
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.equal(index.satellitesVersion, "V2");
  assert.equal(index.files[SATCOUNT_FILE].changed, "2026-10-05T11:00:00.000Z");
  assert.ok(fs.readFileSync(path.join(out, "sitemap-live.xml"), "utf8").includes("<lastmod>2026-10-05T11:00:00.000Z</lastmod>"));
});

test("noindex builds the page with a noindex tag, writes no sitemap and removes an old one; switching modes rebuilds", () => {
  const out = mk(), dir = dataDir("V1");
  buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  assert.ok(fs.existsSync(path.join(out, "sitemap-live.xml")));
  const r = buildLive({ dataDir: dir, outDir: out, now: new Date("2026-10-05T09:30:00Z"), noindex: true, bounds });
  assert.equal(r.changed, true, "the same data in another mode is rebuilt");
  assert.ok(!fs.existsSync(path.join(out, "sitemap-live.xml")));
  assert.ok(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8").includes('<meta name="robots" content="noindex,nofollow">'));
  const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
  assert.deepEqual(Object.keys(index.files), [SATCOUNT_FILE]);
});

test("implausible numbers write nothing and keep the previous page", () => {
  const out = mk();
  buildLive({ dataDir: dataDir("V1"), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false, bounds });
  const before = fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8");
  assert.throws(() => buildLive({ dataDir: dataDir("V2"), outDir: out, now: new Date("2026-10-05T11:00:00Z"), noindex: false, bounds: { min: 8, max: 100 } }), /implausible/);
  assert.equal(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8"), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8")).satellitesVersion, "V1");
});

test("a manifest without the satellites files is refused with a clear message", () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: {} }));
  assert.throws(() => buildLive({ dataDir: dir, outDir: mk(), bounds }), /no satellites feed/);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, feeds: { satellites: { version: "V1", files: { "details.bin": "x" } } } }));
  assert.throws(() => buildLive({ dataDir: dir, outDir: mk(), bounds }), /does not name satmeta\.json/);
});

test("the real bundled snapshot passes the real plausibility bounds", () => {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const fx = { meta: JSON.parse(fs.readFileSync(root + "meta.json", "utf8")), details: fs.readFileSync(root + "details.bin"), swarm: fs.readFileSync(root + "swarm.bin") };
  const out = mk();
  const r = buildLive({ dataDir: dataDir("VREAL", fx), outDir: out, now: new Date("2026-10-05T09:00:00Z"), noindex: false });
  assert.equal(r.changed, true);
  assert.ok(/<strong>[\d,]+ active satellites<\/strong>/.test(fs.readFileSync(path.join(out, SATCOUNT_FILE), "utf8")));
});

test("the command line needs SITE_URL and says so", () => {
  const script = fileURLToPath(new URL("../site/build-live.mjs", import.meta.url));
  const env = { ...process.env }; delete env.SITE_URL;
  const r = spawnSync(process.execPath, [script, "--data", mk(), "--out", mk()], { env, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SITE_URL is required/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/build-live.test.js`
Expected: FAIL with `Cannot find module '.../site/build-live.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/build-live.mjs`:

```js
// Builds the live satellite count page from a collector data folder, for the GitHub workflow that runs after each collection.
//   node site/build-live.mjs --data live --out live/pages
// Output (in --out): how-many-satellites-in-orbit/index.html, sitemap-live.xml (only when the site is indexable) and index.json, which
// lists each file with its hash so hosting/pull.php copies only what changed. The page is rebuilt only when the satellites feed has a
// new version, so the last modified time in the sitemap moves only when the numbers can have changed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE, renderPage } from "./layout.mjs";
import { countSatellites, assertPlausible } from "./satcount.mjs";
import { satelliteCountPage, SATCOUNT_FILE, sitemapLive } from "./pages-satcount.mjs";

const NEED = ["details.bin", "satmeta.json", "swarm.bin"];
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function buildLive({ dataDir, outDir, now = new Date(), noindex = SITE.noindex, bounds } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const feed = manifest.feeds && manifest.feeds.satellites;
  if (!feed || !feed.version || !feed.files) throw new Error("build-live: the manifest has no satellites feed");
  for (const f of NEED) if (!feed.files[f]) throw new Error(`build-live: the manifest does not name ${f}`);

  const indexPath = path.join(outDir, "index.json");
  const prev = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : null;
  const pagePath = path.join(outDir, SATCOUNT_FILE);
  if (prev && prev.satellitesVersion === feed.version && prev.noindex === noindex && prev.siteUrl === SITE.url && fs.existsSync(pagePath)) {
    return { changed: false, version: feed.version };
  }

  const read = (name) => fs.readFileSync(path.join(dataDir, feed.files[name]));
  const counts = countSatellites({ meta: JSON.parse(read("satmeta.json").toString("utf8")), details: read("details.bin"), swarm: read("swarm.bin") });
  assertPlausible(counts, bounds);  // throws before anything is written, so the previous page stays

  const iso = now.toISOString();
  const files = {};
  const put = (rel, text) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const buf = Buffer.from(text, "utf8");
    fs.writeFileSync(file, buf);
    files[rel] = { sha256: sha256(buf), size: buf.length, changed: iso };
  };
  put(SATCOUNT_FILE, renderPage(satelliteCountPage(counts, { updated: now }), { noindex }));
  const sitemapPath = path.join(outDir, "sitemap-live.xml");
  if (noindex) fs.rmSync(sitemapPath, { force: true }); else put("sitemap-live.xml", sitemapLive(iso));
  fs.writeFileSync(indexPath, JSON.stringify({ schema: 1, satellitesVersion: feed.version, siteUrl: SITE.url, noindex, built: iso, files }, null, 1) + "\n");
  return { changed: true, version: feed.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    if (!process.env.SITE_URL || !process.env.SITE_URL.trim()) throw new Error("build-live: SITE_URL is required (set the repository variable SITE_URL), so the page gets the right canonical address");
    if (!arg("--data") || !arg("--out")) throw new Error("build-live: usage: node site/build-live.mjs --data <collector folder> --out <pages folder>");
    const r = buildLive({ dataDir: arg("--data"), outDir: arg("--out") });
    console.log(r.changed ? `build-live: built the satellite count page for satellites version ${r.version} (canonical base ${SITE.url}${SITE.noindex ? ", noindex" : ""})` : `build-live: satellites version ${r.version} is unchanged, nothing to do`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/build-live.test.js`
Expected: all PASS.

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
git add site/build-live.mjs test/build-live.test.js
git commit -m "Build the live satellite count page from a collector data folder

Rebuilds only when the satellites feed has a new version, refuses implausible numbers
before writing anything, writes an index of file hashes for the puller, and keeps the
sitemap and robots tag consistent with SITE_NOINDEX. The command line refuses to run
without SITE_URL.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Copy the finished pages to the site (PHP)

**Files:**
- Modify: `hosting/lib.php` (add two functions after `radar_prune`)
- Modify: `hosting/pull.php`
- Modify: `hosting/tests/run.php` (add a block before the final `ob_end_clean();` summary)

**Interfaces:**
- Consumes: `radar_http`, `radar_log`, `radar_write_atomic` (existing in `hosting/lib.php`); the `pages/index.json` shape from Task 4 (`schema`, `files` with `sha256`).
- Produces: `radar_safe_page_path(string): bool`, `radar_sync_pages(string $base, string $destRoot, ?callable $http = null, ?string $logFile = null): array` returning `['ok' => bool, 'fetched' => int, 'reason'? => string, 'failed'? => array]`; `pull.php --pages-dest=<site root>`.
- Test helpers already in `hosting/tests/run.php`: `ok($cond, $name)`, `same($a, $b, $name)`, `tmpdir()`, `files($dir)`, `server(array $map, array &$log)`, constant `BASE`.

- [ ] **Step 1: Write the failing PHP tests**

In `hosting/tests/run.php`, immediately before the final lines (`ob_end_clean();` followed by the `echo "\n" . $GLOBALS['passed']...` summary), insert:

```php
// ---- finished pages (pages/ on the data branch, copied to the site root)
ok(radar_safe_page_path('how-many-satellites-in-orbit/index.html'), 'a page folder with index.html is allowed');
ok(radar_safe_page_path('sitemap-live.xml'), 'the live sitemap is allowed');
foreach (['../x/index.html', 'a/../b/index.html', '/etc/passwd', 'index.html', 'a/b/index.html', 'a/index.php', 'a/index.html.bak', '-a/index.html', 'A/index.html', 'sitemap.xml', 'live/manifest.json', '', "a/index.html\n", '.htaccess', 'a//index.html'] as $bad) {
    ok(!radar_safe_page_path($bad), 'unsafe page path rejected: ' . json_encode($bad));
}
$PAGE = '<!doctype html><title>t</title><p>7 active satellites</p>'; $SITEMAP = '<?xml version="1.0"?><urlset/>';
function pagesIndex(array $files): string { $f = []; foreach ($files as $p => $body) { $f[$p] = ['sha256' => hash('sha256', $body), 'size' => strlen($body), 'changed' => '2026-10-05T09:00:00.000Z']; } return json_encode(['schema' => 1, 'satellitesVersion' => 'V1', 'files' => $f]); }
$P1 = ['how-many-satellites-in-orbit/index.html' => $PAGE, 'sitemap-live.xml' => $SITEMAP];
$srv = function (array $files, array &$log) { $map = ['pages/index.json' => pagesIndex($files)]; foreach ($files as $p => $body) { $map['pages/' . $p] = $body; } return server($map, $log); };
$root = tmpdir(); $log = [];
$r = radar_sync_pages(BASE, $root, $srv($P1, $log));
ok($r['ok'] && $r['fetched'] === 2, 'the first pages sync fetches both files');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE, 'the page is written');
same(file_get_contents($root . '/sitemap-live.xml'), $SITEMAP, 'the sitemap is written');
same(array_values(array_filter(files($root), function ($f) { return strpos($f, '.tmp') !== false; })), [], 'no temporary files are left behind');
$log = []; $r = radar_sync_pages(BASE, $root, $srv($P1, $log));
ok($r['ok'] && $r['fetched'] === 0, 'a second pages sync fetches nothing');
same($log, [BASE . 'pages/index.json'], 'and asks only for the index');
$P2 = ['how-many-satellites-in-orbit/index.html' => $PAGE . '<p>newer</p>', 'sitemap-live.xml' => $SITEMAP];
$log = []; $r = radar_sync_pages(BASE, $root, $srv($P2, $log));
ok($r['ok'] && $r['fetched'] === 1, 'a changed page is fetched and an unchanged sitemap is not');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE . '<p>newer</p>', 'the newer page replaced the old one');

// a download that does not match its hash keeps the old file
$tampered = server(['pages/index.json' => pagesIndex(['how-many-satellites-in-orbit/index.html' => 'good body']), 'pages/how-many-satellites-in-orbit/index.html' => 'evil body'], $log);
$r = radar_sync_pages(BASE, $root, $tampered);
ok(!$r['ok'] && $r['reason'] === 'files', 'a body that does not match the index hash is refused');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE . '<p>newer</p>', 'and the previous page is kept');

// an index that names an unsafe path writes nothing outside
$root2 = tmpdir(); $evilIdx = json_encode(['schema' => 1, 'files' => ['../evil/index.html' => ['sha256' => hash('sha256', 'x')], 'how-many-satellites-in-orbit/index.html' => ['sha256' => hash('sha256', $PAGE)]]]);
$r = radar_sync_pages(BASE, $root2, server(['pages/index.json' => $evilIdx, 'pages/how-many-satellites-in-orbit/index.html' => $PAGE, 'pages/../evil/index.html' => 'x'], $log));
ok(!$r['ok'], 'an index naming an unsafe path is reported as a failure');
ok(!is_dir(dirname($root2) . '/evil'), 'and nothing is written outside the site folder');
ok(is_file($root2 . '/how-many-satellites-in-orbit/index.html'), 'the safe page in the same index is still copied');

// no index, an invalid index and a missing site folder
$r = radar_sync_pages(BASE, tmpdir(), server([], $log));
ok(!$r['ok'] && $r['reason'] === 'index', 'a missing pages index changes nothing and says so');
$r = radar_sync_pages(BASE, tmpdir(), server(['pages/index.json' => '{"schema":2}'], $log));
ok(!$r['ok'] && $r['reason'] === 'invalid', 'an index with the wrong schema is refused');
$nope = sys_get_temp_dir() . '/radar-test-nope-' . bin2hex(random_bytes(4));
$r = radar_sync_pages(BASE, $nope, $srv($P1, $log));
ok(!$r['ok'] && $r['reason'] === 'dest' && !is_dir($nope), 'a site folder that does not exist is not created');
```

- [ ] **Step 2: Run the PHP tests to verify they fail**

Run: `npm run test:hosting 2>&1 | tail -8`
Expected: a PHP fatal error `Call to undefined function radar_safe_page_path()`.

- [ ] **Step 3: Add the functions to `hosting/lib.php`**

Insert after the `radar_prune` function (before `radar_trigger`):

```php
// ------------------------------------------------------------------ finished pages
// The collector's GitHub job also writes finished HTML pages into pages/ on the data branch, with pages/index.json listing each file and
// its sha256. Only two shapes are ever fetched or written: "<folder>/index.html" one level deep, and "sitemap-live.xml". \z (not $)
// is used so a trailing newline cannot slip through. A damaged or hostile index cannot make the script write anywhere else.
const RADAR_MAX_PAGE_BYTES = 2 * 1024 * 1024;   // OURS: the satellite count page is far smaller than this

function radar_safe_page_path(string $p): bool
{
    return (bool) preg_match('#^(?:[a-z0-9][a-z0-9-]{0,80}/index\.html|sitemap-live\.xml)\z#', $p);
}

// Copy the pages named in $base/pages/index.json into $destRoot (the site's public folder, which must already exist). Files whose hash
// already matches are skipped. Each file is written through a temporary name and renamed, so a visitor never sees half a page, and a
// download that does not match its hash is refused so the previous page stays.
function radar_sync_pages(string $base, string $destRoot, ?callable $http = null, ?string $logFile = null): array
{
    $http = $http ?: function ($u) { return radar_http('GET', $u); };
    $log = function ($m) use ($logFile) { radar_log($m, $logFile); };
    $base = rtrim($base, '/') . '/';
    $r = $http($base . 'pages/index.json');
    if ($r['status'] !== 200) {
        $log('pages index: HTTP ' . $r['status'] . ' ' . $r['error']);
        return ['ok' => false, 'reason' => 'index', 'fetched' => 0];
    }
    $d = json_decode($r['body'], true);
    if (!is_array($d) || ($d['schema'] ?? null) !== 1 || !isset($d['files']) || !is_array($d['files'])) {
        $log('pages index: not a valid index, nothing changed');
        return ['ok' => false, 'reason' => 'invalid', 'fetched' => 0];
    }
    if (!is_dir($destRoot)) {
        $log('pages: the site folder ' . $destRoot . ' does not exist, nothing written');
        return ['ok' => false, 'reason' => 'dest', 'fetched' => 0];
    }
    $fetched = 0; $failed = [];
    foreach ($d['files'] as $path => $info) {
        $path = (string) $path;
        if (!radar_safe_page_path($path) || !is_array($info) || !isset($info['sha256']) || !preg_match('/^[0-9a-f]{64}\z/', (string) $info['sha256'])) {
            $failed[] = json_encode($path) . ' (not an allowed page)';
            continue;
        }
        $file = rtrim($destRoot, '/') . '/' . $path;
        if (is_file($file) && hash_file('sha256', $file) === $info['sha256']) {
            continue;
        }
        $f = $http($base . 'pages/' . $path);
        if ($f['status'] !== 200 || $f['body'] === '' || strlen($f['body']) > RADAR_MAX_PAGE_BYTES) {
            $failed[] = $path . ' (HTTP ' . $f['status'] . ')';
            continue;
        }
        if (hash('sha256', $f['body']) !== $info['sha256']) {
            $failed[] = $path . ' (the download does not match the hash in the index)';
            continue;
        }
        if (!radar_write_atomic($file, $f['body'])) {
            $failed[] = $path . ' (could not write)';
            continue;
        }
        $fetched++;
    }
    if ($failed) {
        $log('pages: ' . count($failed) . ' not updated: ' . implode('; ', array_slice($failed, 0, 5)));
        return ['ok' => false, 'reason' => 'files', 'fetched' => $fetched, 'failed' => $failed];
    }
    $log('pages: ok, ' . $fetched . ' file(s) fetched');
    return ['ok' => true, 'fetched' => $fetched];
}
```

- [ ] **Step 4: Update `hosting/pull.php`**

Replace the whole file with:

```php
<?php
// Copies the collector's finished data from GitHub into the site's live/ folder. Run by cron every 10 minutes:
//   php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live --pages-dest=/home/USER/domains/YOURDOMAIN/public_html
// Optional: --base=https://.../  (default: the data branch of the Radar-around-you repository)  --log=/home/USER/radar-tools/pull.log
//           --pages-dest=<the site's public folder>  also copies the finished pages (the satellite count page and its sitemap).
require __DIR__ . '/lib.php';
$o = getopt('', ['dest:', 'base::', 'log::', 'pages-dest::']);
if (empty($o['dest'])) {
    fwrite(STDERR, "usage: php pull.php --dest=/path/to/live [--pages-dest=/path/to/site] [--base=https://...] [--log=/path/pull.log]\n");
    exit(2);
}
$base = isset($o['base']) && $o['base'] !== false ? $o['base'] : RADAR_DEFAULT_BASE;
$logFile = isset($o['log']) && $o['log'] !== false ? $o['log'] : null;
$r = radar_sync($base, $o['dest'], null, $logFile);
$ok = $r['ok'];
if (isset($o['pages-dest']) && $o['pages-dest'] !== false && $o['pages-dest'] !== '') {
    $p = radar_sync_pages($base, $o['pages-dest'], null, $logFile);
    $ok = $ok && $p['ok'];
}
exit($ok ? 0 : 1);
```

- [ ] **Step 5: Run the PHP tests**

Run: `npm run test:hosting 2>&1 | tail -6`
Expected: `NN passed, 0 failed` where NN is 92 plus the new checks (about 125). The PHP 8.5 deprecation notice about `$http_response_header` may still print above the summary; it is not a failure.

- [ ] **Step 6: Syntax-check for the old PHP floor**

Run: `php -l hosting/lib.php && php -l hosting/pull.php`
Expected: `No syntax errors detected` twice. Review the new code for nothing newer than PHP 7.4 (no `str_contains`, `match`, named arguments, nullsafe `?->`, typed class properties beyond 7.4): none are used above.

- [ ] **Step 7: Commit**

```bash
git add hosting/lib.php hosting/pull.php hosting/tests/run.php
git commit -m "Copy the finished pages to the site with pull.php

A new optional --pages-dest setting reads pages/index.json from the data branch and
copies only files whose hash changed, through a temporary name and a rename. Only
folder/index.html and sitemap-live.xml are accepted, a download that does not match
its hash is refused so the old page stays, and a missing site folder is never created.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The workflow step

**Files:**
- Modify: `.github/workflows/live-data.yml`

**Interfaces:**
- Consumes: `node site/build-live.mjs --data live --out live/pages` (Task 4), which needs repository variables `SITE_URL` and `SITE_NOINDEX`.
- Produces: `pages/` in the `data` branch, restored with the collector's memory on the next run (the existing "Restore" step already extracts the whole data branch into `live/`).

- [ ] **Step 1: Edit the workflow**

In `.github/workflows/live-data.yml`, insert this step between the `Collect` step and the `Publish to the data branch` step:

```yaml
      - name: Build the live pages
        id: pages
        if: steps.setup.outputs.ready == 'true'
        continue-on-error: true
        run: |
          node --version
          node site/build-live.mjs --data live --out live/pages
        env:
          SITE_URL: ${{ vars.SITE_URL }}
          SITE_NOINDEX: ${{ vars.SITE_NOINDEX }}
```

Replace the last step (`Tell a person if the collector needs attention`) with:

```yaml
      - name: Tell a person if the collector or the page build needs attention
        if: steps.collect.outcome == 'failure' || steps.pages.outcome == 'failure'
        run: |
          echo "The collector or the live page build failed. Read the Collect and Build the live pages steps above."
          exit 1
```

Also update the comment block at the top of the file by adding one line after the `CONTACT_EMAIL` paragraph:

```yaml
# Also needs two repository variables (not secrets), the same values as on the hosting: SITE_URL (the site's https address) and
# SITE_NOINDEX (1 while the site is on a temporary address). They are used to build the live satellite count page.
```

The step uses the Node that the GitHub runner image already has. That is NOT CONFIRMED: the first run prints `node --version`; if the step fails with "node: command not found", add an `actions/setup-node` step (check its current major version in its README first) before it.

- [ ] **Step 2: Check the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/live-data.yml')); print('yaml ok')"`
Expected: `yaml ok`. (If PyYAML is missing: `python3 -m pip install --user pyyaml`, or read the file carefully for indentation: every step starts with `      - name:` six spaces.)

- [ ] **Step 3: Commit (do not push)**

```bash
git add .github/workflows/live-data.yml
git commit -m "Build the live satellite count page after each collection

A new workflow step runs the page builder on the collector's output, with the site
address and noindex setting taken from repository variables. A failed build keeps the
previous page and turns the run red so a person is told.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser check, records and docs

**Files:**
- Modify: `e2e-site.mjs`
- Create: `docs/satcount-sources.md`
- Modify: `docs/handoff.md`, `CLAUDE.md`, `hosting/README.md`

- [ ] **Step 1: Add the raw-host checks to `e2e-site.mjs`**

In `e2e-site.mjs`, after the line that checks `robots.txt matches SITE_NOINDEX` and before `await browser.close();`, insert:

```js
const sat = await ctx.newPage();
await sat.goto("https://radar.test/how-many-satellites-in-orbit/", { waitUntil: "load", timeout: 60000 });
const satInfo = await sat.evaluate(() => ({
  h1: (document.querySelector("h1") || {}).innerText, charset: document.characterSet, compat: document.compatMode,
  charts: document.querySelectorAll("svg[role=img]").length, robots: (document.head.querySelector('meta[name="robots"]') || {}).content,
  canonical: (document.head.querySelector('link[rel="canonical"]') || {}).href, lead: ((document.querySelector(".lead") || {}).innerText || "").slice(0, 60),
}));
check("the satellite count page loads with its heading, four charts and an answer-first lead, in standards mode, as UTF-8",
  satInfo.h1 === "How many satellites are in orbit?" && satInfo.charts >= 4 && /^As of /.test(satInfo.lead) && satInfo.compat === "CSS1Compat" && satInfo.charset === "UTF-8", JSON.stringify(satInfo));
check("its robots tag matches SITE_NOINDEX", satInfo.robots === want, String(satInfo.robots));
check("sitemap-live.xml exists exactly when the site is indexable", process.env.SITE_NOINDEX === "1" ? !fs.existsSync(site + "sitemap-live.xml") : fs.existsSync(site + "sitemap-live.xml"));
```

- [ ] **Step 2: Write `docs/satcount-sources.md`**

Create the file with this content (replace nothing; the `Cross-check` section is completed in Task 9 Step 7):

```markdown
# Sources for the satellite count page

Everything here was read on 2026-10-05 from the place named. Anything marked NOT CONFIRMED could not be checked from a primary page. Re-read each page before relying on it.

## What the feed contains
- Read from the collector's code, `pipeline/feeds.py` (the satellites feed requests CelesTrak GP groups `active`, `stations` and `visual`) and `pipeline/catalogue.py` (SATCAT records for the purpose groups, plus four debris clouds: cosmos-1408, cosmos-2251, fengyun-1c and iridium-33). It is not the full catalogue.
- The bundled snapshot (`public/meta.json`, `details.bin`, `swarm.bin`, taken 2026-10-04) has 19,316 objects: 16,632 payloads, 4 rocket bodies, 2,677 debris and 3 unknown. Only 2 objects have the status "Not operational". So the feed gives a count of active satellites and cannot give counts of all satellites, rocket bodies or debris.

## What counts as active (OUR definition)
- The status codes are CelesTrak's, from https://celestrak.org/satcat/status.php as recorded in `docs/feature-sources.md`: + operational, - nonoperational, P partially operational, B backup, S spare, X extended mission, D decayed, ? unknown. The packed values are 1 operational, 2 partially, 3 backup, 4 spare, 5 extended, 6 not operational, 7 decayed, 0 not known.
- "Active satellite" = object type payload with status 1 to 5. This is our choice, not CelesTrak's, and the page says so.

## CelesTrak usage policy (https://celestrak.org/usage-policy.php)
- Read 2026-10-05. It covers how often data may be requested and caching ("Only download the data you need, when you are going to use it, and only download data once per update", with update frequencies listed; GP data every 2 hours).
- It does not address republishing, redistributing or building apps on the data, credit, commercial use, or statistics derived from the data. This is silence, not permission. NOT CONFIRMED whether publishing aggregate counts is acceptable. Mitigations: aggregate counts only, no per-satellite list, a visible credit and links to CelesTrak on the page. Consider asking CelesTrak directly.

## Orbit groups (OUR working definitions, NOT CONFIRMED against a cited standard)
- High elliptical: eccentricity 0.25 or more, checked first. Otherwise mean altitude (semi-major axis minus `SWARM_EARTH_RADIUS_KM`): low below 2,000 km, medium from 2,000 km up to 35,585 km, geostationary belt 35,586 to 35,986 km (the geostationary altitude is about 35,786 km, so this is plus or minus 200 km), beyond above 35,986 km.
- Before the page calls these standard terms, cite a source (for example ESA or NASA orbit class definitions) here, or keep the page's "our working definitions" wording.

## Competitor evidence (estimates)
- Ubersuggest exports supplied by the owner on 2026-10-05 for orbitalradar.com (estimated visits, a top 600 pages list and a top 2,000 keywords list). They are estimates, not measurements, and the lists are subsets. They showed one "how many satellites are in orbit" page holding about 77% of the estimated visits in the page list, and launch related keywords about 3% of the keyword traffic. See the design spec, section 1.

## Search and answer engines (read 2026-10-05, summarised)
- Google, AI features and your website: "no additional requirements" to appear in AI Overviews or AI Mode, no special markup or AI text files needed; pages must be indexed and eligible to be shown with a snippet. (https://developers.google.com/search/docs/appearance/ai-features)
- Google, sitemaps: a hint only; `lastmod` is used only if consistently and verifiably accurate; `priority` and `changefreq` are ignored. (https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- Google, publication dates: the structured date must describe the page's update, not the events on it. (https://developers.google.com/search/docs/appearance/publication-dates)
- Google, FAQPage structured data (https://developers.google.com/search/docs/appearance/structured-data/faqpage), read as a summary: the FAQ rich result is no longer shown in Search (announced May 2026; documentation removed June 2026), and was earlier limited to well-known government and health sites. So no FAQPage markup is added; the FAQ stays as visible text.
- Google, structured data general guidelines (https://developers.google.com/search/docs/appearance/structured-data/sd-policies): markup must match visible content, violations can bring a manual action, and Google does not guarantee rich results even for correct markup. The search gallery (https://developers.google.com/search/docs/appearance/structured-data/search-gallery) lists Article, Breadcrumb, Dataset, Event, Organization and Software app among others, and does not list FAQ or HowTo.
- OpenAI crawlers: OAI-SearchBot powers ChatGPT search results, GPTBot is model training only, ChatGPT-User acts for a user. (https://developers.openai.com/api/docs/bots)
- Anthropic crawlers: ClaudeBot (training), Claude-User (user questions), Claude-SearchBot (search quality). (https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- llms.txt (https://llmstxt.org/): a proposal; its page says thousands of sites publish one and AI labs publish them for developer docs, and does not claim search engines read it. Not used here.
- IndexNow (https://www.indexnow.org/documentation): pings participating engines; the page does not mention Google. Not used in this pilot.

## Cross-check against an independent count
- To be recorded in Task 9 of the implementation plan: the independent source, its figure, its date, and how our active count compares. Until then the page says "our count" and accuracy is NOT CONFIRMED.
```

- [ ] **Step 3: Update `hosting/README.md`**

In the step 4 cron list, replace the `pull.php` command line with:

```
   - `php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live --pages-dest=/home/USER/domains/YOURDOMAIN/public_html --log=/home/USER/radar-tools/pull.log`
```

and add one sentence after it: `--pages-dest` also copies the finished pages (the satellite count page and its sitemap) from the data branch's pages/ folder; leave it out and only the data files are copied.

Update the Tests section's first sentence to: `php hosting/tests/run.php` (about 125 checks, no network).

- [ ] **Step 4: Update `CLAUDE.md` and `docs/handoff.md`**

In `CLAUDE.md` Layout paragraph add: `site/satcount.mjs, site/pages-satcount.mjs and site/build-live.mjs make the live satellite count page (see docs/superpowers/specs/2026-10-05-satellite-count-page-design.md); GitHub builds it into the data branch's pages/ folder and hosting/pull.php --pages-dest copies it to the site.` In the commands table, update the unit test count to the current `npm test` count and `e2e:site` to 14 checks if Step 5 below shows 14 (use what it prints; do not guess).

In `docs/handoff.md`: replace open item 4 with a short paragraph saying the page is built and where its spec, plan and sources are, and keep the NOT CONFIRMED lines (rank, CelesTrak reuse). Add to the final domain step (item 5) that both Hostinger and the GitHub repository variables `SITE_URL` and `SITE_NOINDEX` must be changed, and that the pull cron job must carry `--pages-dest`.

- [ ] **Step 5: Run the unit tests, then the site browser suite**

Run: `npm test && npm run test:pipeline && npm run test:hosting`
Expected: 0 failed in each.

Then, with nothing else heavy running (check `uptime`; wait for the one minute load to drop below about 4): `SITE_URL=https://zeninnov8.com SITE_NOINDEX=1 npm run e2e:site`
Expected: every line `ok`, ending `14/14 site checks passed` (11 earlier plus 3 new). Then run it once without `SITE_NOINDEX=1` but with `SITE_URL` set: `SITE_URL=https://zeninnov8.com npm run e2e:site` and expect all `ok`, including `sitemap-live.xml exists exactly when the site is indexable`.

- [ ] **Step 6: House style check on every file you changed**

Run: `git diff --name-only HEAD~6 | xargs grep -nP "\x{2014}|\x{2013}" 2>/dev/null || echo "no dashes"` and `git diff HEAD~6 | grep -n "^+" | grep -inE "<hosting account username>|<server IP>|@gmail|@users\.noreply" || echo "no identifiers"`.
Expected: `no dashes` and `no identifiers`. Fix and amend any hit.

- [ ] **Step 7: Commit**

```bash
git add e2e-site.mjs docs/satcount-sources.md docs/handoff.md CLAUDE.md hosting/README.md
git commit -m "Check the satellite count page on a raw host and record its sources

Adds three raw-host checks to e2e:site, the source record for the page (what the feed
contains, our definitions, the CelesTrak policy silence, the orbit group definitions,
the competitor evidence and the search engine documents read), and the handoff, README
and instruction updates.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification before anything leaves this machine

- [ ] **Step 1: Run every suite, one at a time, on a quiet machine**

Check `uptime` first. Then, each to completion before starting the next:

1. `npm test` expecting 0 failed.
2. `npm run test:pipeline` expecting `OK (skipped=3)`.
3. `npm run test:hosting` expecting `0 failed`.
4. `npm run e2e` expecting `286/286 checks passed`, `console errors: none`, exit 0 (about 10 to 15 minutes; if it times out at a 60 second wait, the machine is loaded: stop and retry when `uptime` shows a low load, as CLAUDE.md says).
5. `npm run e2e:live` expecting `112/112 live checks passed`.
6. `SITE_URL=https://zeninnov8.com SITE_NOINDEX=1 npm run e2e:site` expecting `14/14`.

If any suite fails, stop, find the cause, fix it with a test, and start this task again. Do not push on a failure.

- [ ] **Step 2: Look at the page**

Run `SITE_URL=https://zeninnov8.com SITE_NOINDEX=1 npm run build:hosting`, then serve and view it with the browser pane or `npx --yes serve dist/site -l 4173`, opening `http://localhost:4173/how-many-satellites-in-orbit/`. Check by eye: the lead sentence, the three cards, the four charts and their tables, the "does not include" section, the FAQ, the credit. Close the browser pane afterwards (it uses CPU).

- [ ] **Step 3: Confirm the working tree is clean and the log reads well**

Run: `git status --short && git log --oneline -8`
Expected: nothing uncommitted; the new commits from Tasks 1 to 7 on top of `88f15cd`.

---

### Task 9: Release, with the owner's go-ahead at each step

These steps change things outside this machine. Ask the owner before each one that is marked ASK, and stop if they say no.

- [ ] **Step 1 (ASK): Set the two GitHub repository variables**

They must exist before the push so the first workflow run does not fail. They hold the same values as Hostinger's environment variables (`SITE_URL` and `SITE_NOINDEX`) and are not secrets. Tell the owner the exact values from `docs/handoff.md` (the Hostinger settings table) and, on their yes, run:

```bash
gh variable set SITE_URL --repo amitvprabhu-lang/Radar-around-you --body "https://zeninnov8.com"
gh variable set SITE_NOINDEX --repo amitvprabhu-lang/Radar-around-you --body "1"
gh variable list --repo amitvprabhu-lang/Radar-around-you
```

Expected: both listed with those values.

- [ ] **Step 2 (ASK): Push**

Explain that the push redeploys the site, wipes `live/` for about 4 minutes until the next pull (the new page itself is in the deploy, so it will not 404), and starts nothing else. On a yes: `git push origin main`.

- [ ] **Step 3: Watch the deployment and the first collector run**

Check the deployment finished (hPanel, Websites, `zeninnov8.com`, Deployments, shows Completed). Then check `curl -s -o /dev/null -w "%{http_code}\n" https://zeninnov8.com/how-many-satellites-in-orbit/` returns 200 and `curl -s https://zeninnov8.com/how-many-satellites-in-orbit/ | grep -o "active satellites" | head -1` finds the text. Then start a collector run (or wait for the server's trigger at the next 10 minute mark) and run `gh run list --repo amitvprabhu-lang/Radar-around-you --workflow live-data.yml --limit 3`. Open the run's "Build the live pages" step (Actions page in the browser, or `gh run view <number> --log`). Expected: `node --version` prints a version and `build-live: built the satellite count page for satellites version ...`. If it says `node: command not found`, add an `actions/setup-node` step (read that action's README for the current major first), commit, and push again with the owner's go-ahead. If it says `SITE_URL is required`, the variable is missing (Step 1).

- [ ] **Step 4: Confirm the data branch holds the pages and nothing private**

```bash
git fetch -q --depth=1 origin data && git ls-tree -r --name-only FETCH_HEAD | grep '^pages/'
git show FETCH_HEAD:pages/index.json
git archive FETCH_HEAD pages | tar -xO | grep -inE "@[a-z0-9-]+\.[a-z]{2,}|<hosting account username>" || echo "no email or account text in pages/"
```

Expected: `pages/how-many-satellites-in-orbit/index.html`, `pages/index.json`, no `pages/sitemap-live.xml` while the site is noindex; `index.json` shows `"noindex": true`, `"siteUrl": "https://zeninnov8.com"`; the last line prints `no email or account text in pages/`.

- [ ] **Step 5 (ASK): Update the server scripts and the pull cron job**

The server's copy of the scripts is a clone in `~/radar-src`. Tell the owner these three things, then do the first two with their go-ahead (they type their own SSH password; see the earlier terminal steps):

1. In an SSH session to the server: `cd ~/radar-src && git pull && cp hosting/lib.php hosting/pull.php hosting/trigger.php ~/radar-tools/ && php -l ~/radar-tools/lib.php && php -l ~/radar-tools/pull.php`. Expected: the pull succeeds and both syntax checks pass. Do this BEFORE changing the cron job, because the old cron command keeps working with the new scripts.
2. In hPanel (Websites, a regular site, Advanced, Cron Jobs), delete the old pull job and create a new Custom job, every 10 minutes (`*/10`, then every hour, day, month and weekday), with this command, replacing `USER` with the server username:
   `/usr/bin/php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/zeninnov8.com/public_html/live --pages-dest=/home/USER/domains/zeninnov8.com/public_html --log=/home/USER/radar-tools/pull.log`
   (The form has no edit button, only Delete and View Output.) Leave the trigger job alone.
3. After the next 10 minute mark, open View Output on the new job. Expected: lines ending `pages: ok, N file(s) fetched` and the usual `ok:` line.

- [ ] **Step 6: Check the live page against the data**

```bash
curl -s https://zeninnov8.com/how-many-satellites-in-orbit/ | grep -o 'Data as of <time datetime="[^"]*"' 
git fetch -q --depth=1 origin data && git show FETCH_HEAD:manifest.json | python3 -c 'import sys,json; print("satellites version:", json.load(sys.stdin)["feeds"]["satellites"]["version"])'
```

Expected: the page's data time matches the satellites version's time (a few hours old at most, because that feed refreshes every 2 hours). Look at the page once in a browser.

- [ ] **Step 7: The independent cross-check (what makes the accuracy claim)**

Search the web for one independent published count of active satellites (the UCS Satellite Database, or CelesTrak's own statistics page if it has one). Record in `docs/satcount-sources.md`, replacing the "To be recorded" line in the Cross-check section: the source name and URL, its figure and date, our active count and date, the difference, and a plain sentence on why they may differ (definitions, list scope, date). If the difference is more than about 10 percent, say so on the page's "How we count" list too (a test-covered text change) and tell the owner. Commit and push this later with the next change, not on its own (a push redeploys the site).

- [ ] **Step 8: Report to the owner**

Say what is live, what was checked and what was not: the page works and is noindex; whether it can rank is not known; CelesTrak's reuse terms are unconfirmed; measuring cannot start until the final domain is indexed. List the loose ends: `radar_safe_path` in `hosting/lib.php` uses `$` and so accepts a trailing newline in a path (the new page function uses `\z`; fixing the old one is a small separate change), the PHP 8.5 `$http_response_header` deprecation, the `setup-python` Node 20 warning, and IndexNow and the full-catalogue counts as later work.

---

## Self-Review

Spec coverage, section by section:

1. Why this page: recorded in the spec and `docs/satcount-sources.md` (Task 7).
2. Scope: nothing outside the listed files; no change to `src/` (the app).
3. The page: headline, definition, status table, "does not include", owner, orbit, purpose, launch year, last 30 days, Starlink share, answer-first lead, question headings, FAQ, credit, dates, structured data (Task 2). Orbit boundaries and classification order (Task 1). FAQ markup deliberately not added.
4. Two units: Tasks 1 and 2.
5. Freshness: GitHub builder (Task 4), workflow (Task 6), deploy-time build (Task 3), delivery (Task 5), repository variables and the `SITE_URL` failure (Tasks 4 and 9), live sitemap and robots (Task 3), rebuild only on a new satellites version (Task 4).
6. Safety rails: plausibility (Tasks 1 and 4), previous page kept on failure (Task 4 test and the pull's hash check, Task 5), stale feed keeps true data time (the page shows the feed's own `taken`).
7. Integration: nav, sitemap, build (Task 3). The spec also mentions a link from the satellites guide; this is not a task. It is a small addition: add one sentence with `href("guides/satellites/index.html", SATCOUNT_FILE)` to `satelliteGuide()` in `site/pages-guides.mjs` and a test that the guide links to the page. Add it as Step 8 of Task 3 if the owner wants it before release.
8. Tests: counting, snapshot, page, build-live, PHP, `e2e-site`, and the full run (Tasks 1, 2, 4, 5, 7, 8).
9. Sources record: Task 7. Independent cross-check: Task 9 Step 7.
10. Rollout: Task 9. Measuring is out of scope for code and stays in the spec.

Placeholder scan: no TBD or "similar to" steps; every code step carries its code. The two conditional branches (Node on the runner, the guide link) say exactly what to do in each case.

Type and name consistency: `countSatellites`, `assertPlausible`, `orbitClass`, `ORBIT_ORDER`, `ORBIT_LABELS`, `ACTIVE_STATUSES` (Task 1) are used under those names in Tasks 2, 3 and 4. `satelliteCountPage`, `SATCOUNT_FILE`, `sitemapLive`, `barChartSvg`, `columnChartSvg` (Task 2) are used under those names in Tasks 3 and 4. `buildFixture`, `STANDARD`, `nAtAltitude` (Task 1 helper) are used in Tasks 2 and 4. `loadSatellites` (Task 3), `buildLive` (Task 4), `radar_safe_page_path` and `radar_sync_pages` (Task 5) match their uses. The `pages/index.json` shape written in Task 4 (`schema`, `files[path].sha256`) is the shape read in Task 5.
