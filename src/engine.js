// Small shared helpers for the three scenes.
import * as THREE from "three";
import { DEG, clamp } from "./core.js";
import * as S from "./shaders.js";

// Colours in this app are written as final display values, so three.js must not convert them.
THREE.ColorManagement.enabled = false;

export const latLonVec = (lat, lon, r = 1, out = new THREE.Vector3()) => {
  const la = lat * DEG, lo = lon * DEG;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
};
export const vecToLatLon = (v) => {
  const r = v.length();
  return { lat: Math.asin(clamp(v.y / r, -1, 1)) / DEG, lon: Math.atan2(-v.z, v.x) / DEG };
};

// Equatorial (ra, dec in degrees) to the scene frame of the "celestial" group: x toward the vernal equinox,
// y toward the north celestial pole, -z toward RA 90 degrees.
export const eqVec = (raDeg, decDeg, r = 1, out = new THREE.Vector3()) => {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return out.set(r * Math.cos(dec) * Math.cos(ra), r * Math.sin(dec), -r * Math.cos(dec) * Math.sin(ra));
};

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Quality tiers decide pixel ratio, geometry detail and which extras are drawn.
export function tierFor(pref) {
  if (pref && pref !== "auto") return pref;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (cores >= 8 && mem >= 6) return "high";
  if (cores <= 4 && mem <= 2) return "low";
  return "medium";
}
export const TIER_SETTINGS = {
  high: { pixelRatio: 2, sphere: 128, antialias: true, bigTexture: true },
  medium: { pixelRatio: 1.5, sphere: 96, antialias: true, bigTexture: false },
  low: { pixelRatio: 1, sphere: 64, antialias: false, bigTexture: false },
};

export async function loadTexture(url, { wrapS = THREE.ClampToEdgeWrapping, anisotropy = 1, mip = true } = {}) {
  const t = await new THREE.TextureLoader().loadAsync(url);
  t.wrapS = wrapS;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function glowTexture(size = 128, stops = [[0, "rgba(255,255,255,1)"], [0.15, "rgba(255,240,200,0.75)"], [0.4, "rgba(255,200,120,0.18)"], [1, "rgba(255,160,60,0)"]]) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// A grid of u8 values (width x height, row 0 at the bottom) as a smooth, wrapping texture.
export function gridTexture(u8, width, height) {
  const t = new THREE.DataTexture(u8, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// Build a line list from polylines of THREE.Vector3 using the RIBBON shader attributes.
export function polylinesToSegments(polylines, color, alpha, alphaFn) {
  let n = 0;
  for (const p of polylines) n += Math.max(0, p.length - 1) * 2;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), al = new Float32Array(n);
  let k = 0;
  for (const poly of polylines) {
    for (let i = 0; i + 1 < poly.length; i++) {
      for (const [j, v] of [[i, poly[i]], [i + 1, poly[i + 1]]]) {
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        col[k * 3] = color.r; col[k * 3 + 1] = color.g; col[k * 3 + 2] = color.b;
        al[k] = alphaFn ? alphaFn(poly, j) : alpha;
        k++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(al, 1));
  return g;
}

export function disposeObject(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
  });
}

export function ribbonMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: opts.vertex || S.RIBBON_VERT, fragmentShader: opts.fragment || S.RIBBON_FRAG,
    uniforms: { opacity: { value: opts.opacity ?? 1 }, cull: { value: opts.cull ?? 0 } },
    transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true, blending: THREE.AdditiveBlending, side: opts.side || THREE.FrontSide,
  });
}

// A line whose points can be replaced every frame without reallocating.
export function dynLine(maxPoints, color, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(maxPoints), 1));
  g.setDrawRange(0, 0);
  const obj = new THREE.Line(g, material);
  obj.frustumCulled = false;
  return {
    obj,
    set(points, alphaFn = () => 1, colorFn = null) {
      const n = Math.min(points.length, maxPoints);
      const p = g.attributes.position.array, c = g.attributes.color.array, a = g.attributes.alpha.array;
      for (let i = 0; i < n; i++) {
        p[i * 3] = points[i].x; p[i * 3 + 1] = points[i].y; p[i * 3 + 2] = points[i].z;
        const col = colorFn ? colorFn(i) : color;
        c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
        a[i] = alphaFn(i, n);
      }
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.alpha.needsUpdate = true;
      g.setDrawRange(0, n);
    },
    clear() { g.setDrawRange(0, 0); },
  };
}

