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
