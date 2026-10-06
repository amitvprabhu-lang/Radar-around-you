import test from "node:test";
import assert from "node:assert/strict";
import { flippedPixels, BITMAP_OPTIONS, releaseAfterUpload, flipForReupload } from "../src/engine.js";

// The decoding itself needs a browser (e2e.mjs compares every texture texel by texel with the old upload); these are the pure parts.
test("the bitmap options match what three.js asks WebGL for when it uploads an <img>", () => {
  // flipY true by default for an <img> (WebGL ignores it for bitmaps, so the bitmap is turned when decoded),
  // premultiplyAlpha false, and no colour conversion for a texture with no colour space
  assert.deepEqual(BITMAP_OPTIONS, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
});

test("the flip check accepts only the test picture turned upside down", () => {
  const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
  assert.equal(flippedPixels([...blue, ...red]), true, "blue on top after the flip");
  assert.equal(flippedPixels([...red, ...blue]), false, "the picture as it was: the browser ignored the option");
  assert.equal(flippedPixels([...blue, ...blue]), false);
  assert.equal(flippedPixels([0, 0, 0, 0, 0, 0, 0, 0]), false, "an empty canvas (a failed draw)");
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

test("releaseAfterUpload keeps the bitmap while the <img> has not loaded or failed", () => {
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
