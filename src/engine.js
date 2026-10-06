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

// A 1 by 2 pixel PNG, red above blue, for checking that createImageBitmap really turns a picture upside down when asked.
const FLIP_TEST_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAADUlEQVR4nGP4zwAC/wEIAAH/2ZC7NQAAAABJRU5ErkJggg==";
// The options that make an ImageBitmap hold exactly what WebGL takes from an <img> as three.js uploads it: turned upside down
// (WebGL ignores its flip setting for ImageBitmaps), not premultiplied and with no colour conversion (three.js asks for none).
export const BITMAP_OPTIONS = { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" };
// What matters is how the bitmap lands in a WebGL texture, so the check uploads the decoded test picture the way three.js uploads
// the real maps (flipY off, no premultiplying, no colour conversion) and reads it back through a framebuffer. readPixels returns
// the bottom row of the texture first; an <img> uploaded with flipY puts the picture's bottom row (blue) there, so the bitmap must
// too: blue first, then red. Anything else, or any error, means this browser keeps the old <img> path.
export const uprightPixels = (px) => !!px && px.length >= 8 && px[2] > 200 && px[0] < 50 && px[1] < 50 && px[4] > 200 && px[6] < 50 && px[5] < 50;
// The decision, given a function that does the upload and read-back (and may throw or reject): true only for the expected pixels.
export async function decideBitmapPath(readBack) {
  try { return uprightPixels(await readBack()); } catch { return false; }
}
export function readBackBitmap(renderer, bmp) {
  const gl = renderer.getContext();
  const tex = gl.createTexture(), fb = gl.createFramebuffer();
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("test framebuffer incomplete");
    const px = new Uint8Array(8);
    gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    renderer.resetState();  // three.js caches bindings and pixel-store settings; they were changed behind its back
  }
}
let bitmapCheck = null, bitmapCheckFor = null;
function bitmapsUploadUpright(renderer) {
  if (!renderer) return Promise.resolve(false);
  if (bitmapCheckFor !== renderer) {
    bitmapCheckFor = renderer;
    bitmapCheck = decideBitmapPath(async () => {
      if (typeof createImageBitmap !== "function") throw new Error("no createImageBitmap");
      const bytes = Uint8Array.from(atob(FLIP_TEST_PNG), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }), BITMAP_OPTIONS);
      try { return await readBackBitmap(renderer, bmp); } finally { if (bmp.close) bmp.close(); }
    });
  }
  return bitmapCheck;
}

// Textures whose bitmap was released after the upload, leaving the same picture as an <img> (see releaseAfterUpload).
const released = new Set();

// Once a bitmap texture is on the graphics card, its decoded bitmap (8 MB for a 2k map) is closed and texture.image becomes the
// same picture as an <img>, which holds only the compressed bytes until something draws it, so the page keeps no second full-size
// copy of every map. three.js reads texture.image again only to upload it again: after a lost WebGL context is restored
// (flipForReupload below) or when needsUpdate is set, which nothing in the app does for these maps. An <img> that has not loaded
// does not keep the bitmap for long: the swap happens when it loads (and never if it fails). Called by three.js through
// texture.onUpdate, once.
export function releaseAfterUpload(t, img, registry = released) {
  t.onUpdate = null;
  if (img && !img.complete && typeof img.addEventListener === "function") {
    img.addEventListener("load", () => releaseAfterUpload(t, img, registry), { once: true });
    return false;
  }
  if (!img || !img.complete || !(img.naturalWidth > 0)) return false;
  const bmp = t.image;
  t.image = img;
  if (bmp && typeof bmp.close === "function") bmp.close();
  registry.add(t);
  return true;
}
// After a context loss three.js uploads every texture again from texture.image. A released texture now holds an <img> the right way
// up, so it must be uploaded with the flip that the <img> path uses. Called when the WebGL context is lost (boot.js).
export function flipForReupload(registry = released) {
  for (const t of registry) t.flipY = true;
}

// The picture as an ImageBitmap, decoded off the main thread. Uploading an <img> made the browser decode it again on the main
// thread at the first frame (about half a second per 2k texture on a throttled phone profile). Null when this browser cannot do it
// exactly as the <img> path would, and then the <img> path is used.
// The <img> made from the same bytes is in userData.image, the right way up, for code that draws the picture on a canvas (the sky
// glow sample): a canvas samples an <img> and an upside-down bitmap a little differently, so the <img> keeps those numbers exactly
// as they were. keepImage decodes it now, for a picture that will be drawn at once.
// The request asks for low priority, so it never competes with the data files (the live manifest above all) for the connection.
async function loadBitmapTexture(url, keepImage, renderer) {
  if (!(await bitmapsUploadUpright(renderer))) return null;
  try {
    const res = await fetch(url, { priority: "low" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob, BITMAP_OPTIONS);
    const t = new THREE.Texture(bmp);
    t.flipY = false;  // already upside down, as WebGL would have turned it
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    const img = new Image();
    const src = URL.createObjectURL(blob);
    const loaded = new Promise((resolve) => { const done = () => { URL.revokeObjectURL(src); resolve(); }; img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true }); });
    img.src = src;
    if (keepImage) { await loaded; await img.decode().catch(() => {}); }
    t.userData.image = img;
    t.onUpdate = () => releaseAfterUpload(t, img);
    return t;
  } catch { return null; }
}

// renderer: the WebGLRenderer the texture is for; the bitmap path is used only after it has passed the upload check above.
export async function loadTexture(url, { wrapS = THREE.ClampToEdgeWrapping, anisotropy = 1, mip = true, keepImage = false, renderer = null } = {}) {
  const t = (await loadBitmapTexture(url, keepImage, renderer)) || (await new THREE.TextureLoader().loadAsync(url));
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

