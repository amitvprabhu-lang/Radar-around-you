import test from "node:test";
import assert from "node:assert/strict";
import { uprightPixels, decideBitmapPath, BITMAP_OPTIONS, releaseAfterUpload, flipForReupload } from "../src/engine.js";

// The decoding itself needs a browser (e2e.mjs compares every texture texel by texel with the old upload); these are the pure parts.
test("the bitmap options match what three.js asks WebGL for when it uploads an <img>", () => {
  // flipY true by default for an <img> (WebGL ignores it for bitmaps, so the bitmap is turned when decoded),
  // premultiplyAlpha false, and no colour conversion for a texture with no colour space
  assert.deepEqual(BITMAP_OPTIONS, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
});

test("the bitmap path is chosen only when the WebGL read-back shows the picture the way the <img> upload puts it", async () => {
  const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
  // readPixels gives the texture's bottom row first; the <img> path puts the picture's bottom row (blue) there
  assert.equal(await decideBitmapPath(() => [...blue, ...red]), true, "correct");
  assert.equal(await decideBitmapPath(async () => new Uint8Array([...blue, ...red])), true, "correct, from a typed array and a promise");
  assert.equal(await decideBitmapPath(() => [...red, ...blue]), false, "flipped: the browser uploads bitmaps the other way up");
  assert.equal(await decideBitmapPath(() => { throw new Error("no WebGL"); }), false, "throws");
  assert.equal(await decideBitmapPath(async () => { throw new Error("decode failed"); }), false, "rejects");
  assert.equal(await decideBitmapPath(() => [0, 0, 0, 0, 0, 0, 0, 0]), false, "an empty read-back");
  assert.equal(await decideBitmapPath(() => null), false);
  assert.equal(await decideBitmapPath(() => [...blue, ...blue]), false);
  assert.equal(uprightPixels([...blue]), false, "too short");
});

test("releaseAfterUpload swaps a loaded <img> in for the bitmap, closes the bitmap and remembers the texture, once", () => {
  let closed = 0;
  const bmp = { close: () => { closed++; } };
  const img = { complete: true, naturalWidth: 2048 };
  const t = { image: bmp, onUpdate: () => {} };
  const reg = new Set();
  assert.equal(releaseAfterUpload(t, img, reg), true);
  assert.equal(t.image, img);
  assert.equal(closed, 1);
  assert.equal(t.onUpdate, null, "three.js calls onUpdate after every upload; it must act only after the first");
  assert.ok(reg.has(t));
});

test("releaseAfterUpload waits for an <img> still loading and releases the bitmap when it loads", () => {
  let closed = 0, listener = null;
  const bmp = { close: () => { closed++; } };
  const img = { complete: false, naturalWidth: 0, addEventListener: (type, fn, opts) => { assert.equal(type, "load"); assert.deepEqual(opts, { once: true }); listener = fn; } };
  const t = { image: bmp, onUpdate: () => {} };
  const reg = new Set();
  assert.equal(releaseAfterUpload(t, img, reg), false);
  assert.equal(t.image, bmp);
  assert.equal(closed, 0);
  assert.equal(typeof listener, "function", "it waits for the load");
  img.complete = true; img.naturalWidth = 2048;
  listener();
  assert.equal(t.image, img);
  assert.equal(closed, 1);
  assert.ok(reg.has(t));
});

test("releaseAfterUpload keeps the bitmap when the <img> failed or there is none", () => {
  for (const img of [{ complete: false, naturalWidth: 0 }, { complete: true, naturalWidth: 0 }, null]) {
    let closed = 0;
    const bmp = { close: () => { closed++; } };
    const t = { image: bmp, onUpdate: () => {} };
    const reg = new Set();
    assert.equal(releaseAfterUpload(t, img, reg), false);
    assert.equal(t.image, bmp);
    assert.equal(closed, 0);
    assert.equal(reg.size, 0);
    assert.equal(t.onUpdate, null);
  }
});

test("flipForReupload turns on the <img> flip for released textures only", () => {
  const a = { flipY: false }, b = { flipY: false };
  const reg = new Set([a]);
  flipForReupload(reg);
  assert.equal(a.flipY, true);
  assert.equal(b.flipY, false);
});
