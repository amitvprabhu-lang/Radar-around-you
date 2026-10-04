// Procedural 3D models. They are approximations built from simple shapes, not scans of the real craft.
// Convention for every model: nose or forward direction is +Z, up is +Y, units are metres.
import * as THREE from "three";

const matCache = new Map();
function mat(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}
const std = (color, metalness = 0.35, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

const M = {
  gold: () => mat("gold", () => std(0xd9a441, 0.75, 0.38, { emissive: 0x2a1c05 })),
  foil: () => mat("foil", () => std(0xc9b27a, 0.7, 0.4, { emissive: 0x1d1608 })),
  white: () => mat("white", () => std(0xe8ebf0, 0.25, 0.55, { emissive: 0x15171b })),
  grey: () => mat("grey", () => std(0x8b929c, 0.5, 0.5, { emissive: 0x0e1013 })),
  dark: () => mat("dark", () => std(0x2b2f36, 0.5, 0.6)),
  panel: () => mat("panel", () => std(0x1d3a7a, 0.55, 0.28, { emissive: 0x08162f, side: THREE.DoubleSide })),
  panelGold: () => mat("panelGold", () => std(0xb8872c, 0.6, 0.35, { emissive: 0x221506, side: THREE.DoubleSide })),
  radiator: () => mat("radiator", () => std(0xf2f4f7, 0.2, 0.6, { emissive: 0x181a1e, side: THREE.DoubleSide })),
  debris: () => mat("debris", () => std(0x6d6760, 0.5, 0.75, { emissive: 0x0d0c0b, flatShading: true })),
  rocket: () => mat("rocket", () => std(0xd8dade, 0.3, 0.55, { emissive: 0x141517 })),
  engine: () => mat("engine", () => std(0x9aa1ab, 0.6, 0.4, { emissive: 0x0f1012 })),
  glass: () => mat("glass", () => std(0x16202c, 0.8, 0.2)),
};

const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
};
const cyl = (r, len, m, axis = "z", x = 0, y = 0, z = 0, seg = 16) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === "z") g.rotateX(Math.PI / 2);
  else if (axis === "x") g.rotateZ(Math.PI / 2);
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
};

// ---------------------------------------------------------------- satellites

export function issModel() {
  const g = new THREE.Group();
  // main truss runs along X
  g.add(box(109, 2.2, 2.2, M.grey()));
  // pressurised modules along Z
  g.add(cyl(2.2, 28, M.white(), "z", 0, -3.2, 2));
  g.add(cyl(2.0, 14, M.white(), "z", 0, -3.2, 20));
  g.add(cyl(2.2, 10, M.white(), "z", 0, -3.2, -16));
  g.add(cyl(1.7, 12, M.white(), "x", 0, -3.2, 8));
  g.add(cyl(1.4, 9, M.foil(), "z", 0, -3.2, -25));
  // four solar array wings (pairs at each end)
  for (const sx of [-1, 1]) {
    for (const px of [38, 50]) {
      for (const sz of [-1, 1]) {
        g.add(box(11, 0.15, 35, M.panelGold(), sx * px, 0, sz * 19));
      }
      g.add(cyl(0.5, 4, M.grey(), "z", sx * px, 0, 0));
    }
  }
  // radiators
  for (const sx of [-1, 1]) g.add(box(3, 0.1, 22, M.radiator(), sx * 22, -1.2, 14));
  g.userData.size = 109;
  return g;
}

export function starlinkModel() {
  const g = new THREE.Group();
  g.add(box(2.8, 0.2, 1.4, M.white()));
  const arm = box(0.25, 0.25, 2, M.grey(), 0, 0, 0);
  g.add(arm);
  g.add(box(2.8, 0.03, 8.8, M.panel(), 0, 0.15, 5.5));
  g.userData.size = 9;
  return g;
}

export function satelliteModel(seed = 0) {
  const g = new THREE.Group();
  const big = seed % 3;
  const bus = big === 0 ? 1.8 : big === 1 ? 1.2 : 2.6;
  g.add(box(bus, bus, bus * 1.4, seed % 2 ? M.gold() : M.foil()));
  const span = bus * (big === 2 ? 4.6 : 3.2);
  for (const sx of [-1, 1]) {
    g.add(box(span, 0.06, bus * 1.1, M.panel(), sx * (bus * 0.5 + span / 2 + 0.2), 0, 0));
    g.add(cyl(0.05, 0.4, M.grey(), "x", sx * (bus * 0.5 + 0.1), 0, 0, 8));
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(bus * 0.55, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M.white());
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, bus * 0.2, bus * 0.9);
  g.add(dish);
  g.userData.size = span * 2;
  return g;
}

export function rocketBodyModel() {
  const g = new THREE.Group();
  g.add(cyl(1.7, 10, M.rocket(), "z", 0, 0, 0, 20));
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 16, 1, true), M.engine());
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.z = -6.1;
  g.add(nozzle);
  g.add(cyl(1.72, 0.5, M.dark(), "z", 0, 0, 3.4, 20));
  g.userData.size = 12;
  return g;
}

export function debrisModel(seed = 1) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.attributes.position;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.6 + rnd() * 0.9), p.getY(i) * (0.4 + rnd() * 0.9), p.getZ(i) * (0.5 + rnd() * 0.9));
  geo.computeVertexNormals();
  const a = new THREE.Mesh(geo, M.debris());
  a.scale.set(0.8, 0.5, 1.1);
  g.add(a);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(geo, M.debris());
    b.scale.setScalar(0.2 + rnd() * 0.3);
    b.position.set((rnd() - 0.5) * 3, (rnd() - 0.5) * 2, (rnd() - 0.5) * 3);
    g.add(b);
  }
  g.userData.size = 3;
  return g;
}

// ---------------------------------------------------------------- aircraft

const aircraftVariants = {
  narrow: { len: 38, rad: 2.0, span: 34, chord: 6.5, tip: 1.6, sweep: 6.5, engines: 2, engR: 1.05, tail: 7, stab: 12 },
  wide: { len: 64, rad: 3.1, span: 62, chord: 10, tip: 2.4, sweep: 11, engines: 2, engR: 1.65, tail: 12, stab: 20 },
  jumbo: { len: 72, rad: 3.6, span: 68, chord: 12, tip: 2.8, sweep: 13, engines: 4, engR: 1.4, tail: 13, stab: 22 },
  regional: { len: 29, rad: 1.6, span: 28, chord: 4.6, tip: 1.3, sweep: 3.5, engines: 2, engR: 0.8, tail: 5, stab: 9, rearEngines: true },
  prop: { len: 22, rad: 1.4, span: 27, chord: 3.0, tip: 1.6, sweep: 0.5, engines: 2, engR: 0.5, tail: 4.5, stab: 8, prop: true },
  small: { len: 9, rad: 0.75, span: 11, chord: 1.6, tip: 1.0, sweep: 0, engines: 1, engR: 0.3, tail: 2, stab: 3.5, prop: true },
};

// Map an ICAO aircraft type code (A320, B77W...) to a model variant.
export function aircraftVariantFor(icao) {
  const t = (icao || "").toUpperCase();
  if (/^(A38|B74|A225)/.test(t)) return "jumbo";
  if (/^(B77|B78|A33|A34|A35|B76|A30|B75|A31[0-1]$|MD11|IL96|B2|C5M|C17)/.test(t) && !/^A3(18|19|20|21)/.test(t)) return /^(B75|B76)/.test(t) ? "wide" : "wide";
  if (/^(CRJ|E1|E7|E9|E19|E29|AT7|ATR|DH8|SF3|AT4)/.test(t)) return /^(AT|DH|SF)/.test(t) ? "prop" : "regional";
  if (/^(C1|C2|PA|SR2|BE|TBM|P28|DA4|M20|AA5|C72|C17[0-9]|PC1)/.test(t)) return "small";
  return "narrow";
}

const wingGeoCache = new Map();
function wingGeometry(v) {
  const key = [v.span, v.chord, v.tip, v.sweep].join();
  if (wingGeoCache.has(key)) return wingGeoCache.get(key);
  const half = v.span / 2;
  const s = new THREE.Shape();
  s.moveTo(0, v.chord / 2);
  s.lineTo(half, v.chord / 2 - v.sweep - 0.2);
  s.lineTo(half, v.chord / 2 - v.sweep - 0.2 - v.tip);
  s.lineTo(0, -v.chord / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: v.rad * 0.12 + 0.12, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape x stays span, shape y becomes forward (-z after rotation) so flip below
  g.scale(1, 1, -1);
  g.translate(0, 0, 0);
  wingGeoCache.set(key, g);
  return g;
}

const fuselageCache = new Map();
function fuselageGeometry(v) {
  const key = v.len + ":" + v.rad;
  if (fuselageCache.has(key)) return fuselageCache.get(key);
  const L = v.len, r = v.rad;
  const pts = [];
  // profile along the length, from tail (z = -L/2) to nose (z = +L/2); Lathe wants (radius, y)
  const prof = [[0.05, 0], [0.22, 0.04], [0.48, 0.16], [0.75, 0.34], [0.93, 0.5], [1, 0.62], [1, 0.8], [0.9, 0.92], [0.6, 0.975], [0.22, 0.998], [0, 1]];
  for (const [rr, t] of prof) pts.push(new THREE.Vector2(rr * r, (t - 0.5) * L));
  const g = new THREE.LatheGeometry(pts, 18);
  g.rotateX(Math.PI / 2);
  fuselageCache.set(key, g);
  return g;
}

function navLight(color, size = 0.35) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color }));
  return m;
}

export function airlinerModel(variantName = "narrow", tailColor = 0x2a6bd6) {
  const v = aircraftVariants[variantName] || aircraftVariants.narrow;
  const g = new THREE.Group();
  const body = new THREE.Mesh(fuselageGeometry(v), M.white());
  g.add(body);
  // cockpit windows
  g.add(box(v.rad * 1.15, v.rad * 0.22, v.rad * 0.5, M.glass(), 0, v.rad * 0.38, v.len * 0.4 + v.rad * 0.5));
  // livery stripe
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(v.rad * 1.005, v.rad * 1.005, v.len * 0.52, 18, 1, true), mat("stripe" + tailColor, () => std(tailColor, 0.2, 0.55)));
  stripe.geometry.rotateX(Math.PI / 2);
  stripe.scale.set(1, 0.16, 1);
  stripe.position.set(0, -v.rad * 0.26, 0);
  // low wings
  const wingZ = v.len * 0.02;
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(wingGeometry(v), M.white());
    w.scale.x = sx;
    w.position.set(0, -v.rad * 0.35, wingZ - (v.rear ? 0 : 0));
    // dihedral
    w.rotation.z = sx * 0.045;
    g.add(w);
  }
  // engines
  const engineXs = v.engines === 4 ? [-0.22, -0.4, 0.22, 0.4] : v.engines === 2 ? [-0.3, 0.3] : [0];
  if (v.rearEngines) {
    for (const sx of [-1, 1]) g.add(cyl(v.engR, v.len * 0.14, M.engine(), "z", sx * (v.rad + v.engR * 0.9), v.rad * 0.25, -v.len * 0.3));
  } else if (!v.prop) {
    for (const f of engineXs) {
      const x = f * v.span;
      const e = cyl(v.engR, v.engR * 3.3, M.engine(), "z", x, -v.rad * 0.78, wingZ - v.sweep * 0.3 * Math.abs(f) * 3 + v.chord * 0.15);
      g.add(e);
    }
  } else if (v.engines === 2) {
    for (const sx of [-1, 1]) {
      const x = sx * v.span * 0.22;
      g.add(cyl(v.engR, v.engR * 4.5, M.engine(), "z", x, -v.rad * 0.3, wingZ + v.chord * 0.2));
      const prop = box(v.engR * 6, v.engR * 0.15, 0.1, M.dark(), x, -v.rad * 0.3, wingZ + v.chord * 0.2 + v.engR * 2.4);
      prop.userData.spin = true;
      g.add(prop);
    }
  } else {
    g.add(cyl(v.engR, v.engR * 3, M.engine(), "z", 0, 0, v.len * 0.5));
    const prop = box(v.engR * 6, v.engR * 0.2, 0.08, M.dark(), 0, 0, v.len * 0.5 + v.engR * 1.6);
    prop.userData.spin = true;
    g.add(prop);
  }
  // tail fin, coloured by airline
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(v.tail * 0.9, 0); fin.lineTo(v.tail * 0.55, v.tail * 1.35); fin.lineTo(v.tail * 0.1, v.tail * 1.35); fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.3, bevelEnabled: false });
  finGeo.translate(0, 0, -0.15);
  finGeo.rotateY(Math.PI / 2);
  finGeo.scale(1, 1, 1);
  const tail = new THREE.Mesh(finGeo, mat("tail" + tailColor, () => std(tailColor, 0.25, 0.5, { emissive: new THREE.Color(tailColor).multiplyScalar(0.12) })));
  tail.position.set(0, v.rad * 0.55, -v.len * 0.5 + v.tail * 0.45);
  tail.rotation.y = Math.PI;
  tail.scale.set(1, 1, 1);
  g.add(tail);
  // horizontal stabilisers
  for (const sx of [-1, 1]) {
    const sg = wingGeometry({ span: v.stab, chord: v.tail * 0.55, tip: v.tail * 0.22, sweep: v.tail * 0.3, rad: 0.4 });
    const s = new THREE.Mesh(sg, M.white());
    s.scale.x = sx;
    s.position.set(0, v.rad * 0.18, -v.len * 0.5 + v.tail * 0.4);
    g.add(s);
  }
  // navigation lights: red on the left (port) wing tip, green on the right (starboard), white strobe on the tail
  const half = v.span / 2;
  const tipZ = wingZ - v.sweep - v.tip * 0.5;
  const red = navLight(0xff2a2a, 0.7), green = navLight(0x2aff6a, 0.7), strobe = navLight(0xffffff, 0.9), beacon = navLight(0xff3030, 0.7);
  // facing +Z, the aircraft's right-hand side (starboard) is -X in a right-handed frame with +Y up
  red.position.set(half, -v.rad * 0.35 + 0.6, tipZ);
  green.position.set(-half, -v.rad * 0.35 + 0.6, tipZ);
  strobe.position.set(0, v.rad * 0.55 + v.tail * 1.35, -v.len * 0.5 + v.tail * 0.2);
  beacon.position.set(0, v.rad * 1.05, 0);
  g.add(red, green, strobe, beacon);
  g.userData = { variant: variantName, size: v.span, lights: { red, green, strobe, beacon }, spinners: g.children.filter((c) => c.userData.spin) };
  return g;
}

// Blink the lights the way aircraft do: steady port/starboard lights, a double white flash, a slow red beacon.
export function updateAircraftLights(model, t) {
  const l = model.userData.lights;
  if (!l) return;
  const phase = (t % 1.1) / 1.1;
  l.strobe.visible = phase < 0.07 || (phase > 0.17 && phase < 0.24);
  l.beacon.visible = ((t * 0.8) % 1) < 0.5;
  for (const s of model.userData.spinners || []) s.rotation.z = t * 40;
}

export function disposeModel(model) {
  model.traverse((o) => { if (o.material && !matCache.has(o.material)) { /* shared materials stay cached */ } });
}
