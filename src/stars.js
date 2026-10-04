// Star field, Milky Way and constellation lines, shared by the orbit view and the ground view.
// Everything lives in the "celestial" frame: x toward the vernal equinox, y toward the north pole, -z toward RA 90.
import * as THREE from "three";
import * as S from "./shaders.js";
import { eqVec, polylinesToSegments, ribbonMaterial } from "./engine.js";
import { galacticToEquatorial } from "./core.js";

function starTint(bv) {
  if (bv < 0) return [0.72, 0.82, 1];
  if (bv < 0.5) return [0.93, 0.95, 1];
  if (bv < 1.0) return [1, 0.93, 0.82];
  return [1, 0.78, 0.6];
}

// uniforms: { pr, sizeScale, time } shared with the caller. Returns { group, stars, milky, lines, starUniforms, milkyUniforms }.
export function buildStarfield(D, shared, { radius = 50, magLimit = 6.2, dark = 0.9, milky = 0.5 } = {}) {
  const group = new THREE.Group();
  const ns = D.stars.n;
  const pos = new Float32Array(ns * 3), mag = new Float32Array(ns), tint = new Float32Array(ns * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < ns; i++) {
    eqVec(D.stars.ra[i], D.stars.dec[i], radius, tmp);
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    mag[i] = D.stars.mag[i];
    tint.set(starTint(D.stars.bv[i]), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
  g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  const starUniforms = { pr: shared.pr, sizeScale: shared.sizeScale, time: shared.time, magLimit: { value: magLimit }, dark: { value: dark } };
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: S.STAR_VERT, fragmentShader: S.STAR_FRAG, uniforms: starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  stars.frustumCulled = false;
  group.add(stars);

  const ax = (l, b) => { const e = galacticToEquatorial(l, b); return eqVec(e.ra, e.dec, 1); };
  const milkyUniforms = { gx: { value: ax(0, 0) }, gy: { value: ax(90, 0) }, gz: { value: ax(0, 90) }, amount: { value: milky } };
  const mw = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    vertexShader: S.MILKYWAY_VERT, fragmentShader: S.MILKYWAY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: milkyUniforms, transparent: true, blending: THREE.AdditiveBlending,
  }));
  mw.frustumCulled = false;
  mw.renderOrder = -10;
  group.add(mw);

  const polys = D.lines.map((line) => line.map(([ra, dec]) => eqVec(ra, dec, radius - 1)));
  const lg = polylinesToSegments(polys, new THREE.Color(0.45, 0.62, 1), 0.3);
  const lines = new THREE.LineSegments(lg, ribbonMaterial({ vertex: S.SKYLINE_VERT, opacity: 1 }));
  lines.frustumCulled = false;
  lines.visible = false;
  group.add(lines);
  return { group, stars, milky: mw, lines, starUniforms, milkyUniforms };
}
