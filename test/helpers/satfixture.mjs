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

const angle = (deg, full) => Math.round((((deg || 0) % (full + 1e-9)) / full) * 65535);

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
    // angles in degrees (inclination 0 to 180, the others 0 to 360), packed as the collector packs them; absent means 0 as before
    swarm.writeUInt16LE(angle(o.incl, 180), count * 8 + i * 12 + 2);
    swarm.writeUInt16LE(angle(o.raan, 360), count * 8 + i * 12 + 4);
    swarm.writeUInt16LE(angle(o.argp, 360), count * 8 + i * 12 + 6);
    swarm.writeUInt16LE(angle(o.ma, 360), count * 8 + i * 12 + 8);
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
  // names.txt: one catalogue name per object, in feed order (an object without a name gets an empty line)
  return { meta, details, swarm, names: objects.map((o) => o.name || "") };
}

// A larger feed for the country pages: the five owners that have pages, each with its own mix of orbits, purposes and launch years,
// one small owner, one owner whose only satellite is not active, two active satellites with no owner and one piece of debris.
// Active satellites: United States 130 (70 Starlink), China 90, United Kingdom 66, CIS 58, Japan 52, Italy 4, no owner 2: 402 in all.
export const COUNTRY_OWNERS = ["United States", "People's Republic of China", "United Kingdom", "Commonwealth of Independent States (former USSR)", "Japan", "Italy", "Empty Owner"];
export function countryObjects() {
  const out = [];
  const add = (owner, n, f) => { for (let j = 0; j < n; j++) out.push({ type: 0, status: 1, owner, raan: (j * 37) % 360, ma: (j * 71 + owner * 13) % 360, ...f(j) }); };
  add(1, 130, (j) => (j < 70
    ? { purpose: 9, kind: 1, alt: 550, incl: 53, launchDay: D(`${2020 + (j % 6)}-03-01`), name: `STARLINK-${1000 + j}` }
    : { purpose: [4, 7, 10][j % 3], alt: 700 + (j % 5) * 100, incl: 97.5, launchDay: D(`${2008 + (j % 18)}-05-01`), name: j % 2 ? `FLOCK 4Y-${j}` : `USA ${300 + j}` }));
  add(2, 90, (j) => ({ purpose: [4, 7, 10, 6][j % 4], alt: j % 4 === 3 ? 21500 : 600, incl: j % 4 === 3 ? 55 : 98, status: 1 + (j % 2), launchDay: D(`${2012 + (j % 14)}-06-01`), name: j % 4 === 3 ? `BEIDOU-3 M${j}` : `YAOGAN-${j}` }));
  add(3, 66, (j) => ({ purpose: 10, alt: 1200, incl: 87.9, launchDay: D(`${2020 + (j % 6)}-02-01`), name: `ONEWEB-${j}` }));
  add(4, 58, (j) => ({ purpose: [12, 6, 10][j % 3], alt: j % 3 === 1 ? 19100 : 26000, ecc: j % 3 === 2 ? 0.7 : 0, incl: 64.8, argp: 270, status: 1 + (j % 5), launchDay: j % 7 === 0 ? 0 : D(`${1995 + (j % 30)}-09-01`), name: j % 3 === 2 ? `MOLNIYA 2-${j}` : `COSMOS ${2400 + j}` }));
  add(5, 52, (j) => ({ purpose: [3, 10, 4][j % 3], alt: j % 2 ? 35786 : 650, incl: j % 2 ? 0.1 : 98, launchDay: D(`${2005 + (j % 20)}-11-01`), name: j % 2 ? `JCSAT-${j}` : `GRUS-1${j}` }));
  add(6, 4, (j) => ({ purpose: 7, alt: 500, incl: 45, launchDay: D(`${2021 + j}-01-01`) }));
  out.push({ type: 0, status: 6, owner: 7, purpose: 0, alt: 600 });
  out.push({ type: 0, status: 1, owner: 0, purpose: 0, alt: 800, incl: 30 }, { type: 0, status: 1, owner: 0, purpose: 0, alt: 800, incl: 30, ma: 180 });
  out.push({ type: 2, status: 0, purpose: 18, alt: 700 });
  return out;
}
export function countryFixture(extra = {}) {
  return buildFixture(countryObjects(), { owners: COUNTRY_OWNERS, ownerCodes: ["US", "PRC", "UK", "CIS", "JPN", "IT", "EMP"], ref: Date.parse("2026-10-05T08:14:54Z"), newIdx: [0, 1, 75, 135, 300, 401], ...extra });
}
