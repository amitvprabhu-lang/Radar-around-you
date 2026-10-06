import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../template.html", import.meta.url), "utf8");

test("the web font stylesheet does not block the first paint", () => {
  const links = html.match(/<link [^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || []; // the first is the one in the head, the second the noscript one
  const head = html.slice(0, html.indexOf("<div id=\"app\""));
  assert.equal((head.match(/fonts\.googleapis\.com\/css2/g) || []).length, 1, "one stylesheet link before the app");
  // loaded as a print stylesheet (which never blocks rendering) and switched to all media once it has arrived; display=swap shows
  // the text in the fallback font until then
  assert.match(links[0], / media="print"/);
  assert.match(links[0], / onload="this\.media='all'"/);
  assert.match(links[0], /display=swap/);
  assert.ok(!/>/.test(links[0].slice(0, -1)), "no > inside the tag, so site/build.mjs still moves it into <head>");
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
});

test("the loader comes before the app's script, which stays a classic inline script at the end", () => {
  assert.ok(html.indexOf('<div id="loader"') < html.indexOf("<script>__APP__</script>"));
  assert.ok(html.trimEnd().endsWith("<script>__APP__</script>"));
});

test("without JavaScript the same font stylesheet is loaded plainly, after the head so site/build.mjs still moves the head", () => {
  const m = html.match(/<noscript><link href="([^"]+)" rel="stylesheet"><\/noscript>/);
  assert.ok(m, "a noscript fallback");
  const main = html.match(/<link href="([^"]+fonts\.googleapis[^"]+)" rel="stylesheet" media="print"/);
  assert.equal(m[1], main[1], "the same address");
  assert.ok(html.indexOf("<noscript>") > html.indexOf('<div id="app"'), "in the body, not among the head elements");
});

// Source-shape checks: the four tests below read the source text. Behaviour: the stats roles are checked in a browser by e2e.mjs
// ("the stats tiles are plain buttons and links"); the progress bar, the canvas size and the scene width only change how a value is
// read or animated, and checking that behaviourally would mean running the WebGL app under a trace (done by hand, docs/handoff.md item
// 15), which is not cheap enough for a unit test. They guard against the old spelling coming back.
test("source-shape check: the stats strip carries no list roles: its tiles are buttons and links (Lighthouse 13 flagged role=listitem on a button)", () => {
  assert.ok(html.includes('<div id="stats" class="scroller"></div>'));
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(main.includes('{ class: "stat glass", ...(typeof to === "string"'), "the tile is made without a role");
  assert.ok(!/role: "listitem"|role="list(item)?"/.test(main + html));
});

test("source-shape check: the loader's progress bar animates transform, not width, so the compositor can run it (Lighthouse: non-composited animations)", () => {
  const rule = html.match(/#loader \.progress i \{[^}]*\}/)[0];
  assert.match(rule, /transform: scaleX\(0\); transform-origin: 0 50%;/);
  assert.match(rule, /transition: transform \.25s ease;/);
  assert.ok(!/transition:[^;]*width/.test(html), "no width transition anywhere in the template");
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(main.includes("loadBar.style.transform = `scaleX(${Math.round(f * 100) / 100})`;") && !main.includes("loadBar.style.width"));
});

test("source-shape check: each frame takes the canvas size from a ResizeObserver, not from getBoundingClientRect (Lighthouse: forced reflow)", () => {
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(main.includes("const rect = canvasBox || canvas.getBoundingClientRect();"), "the frame reads the kept size, and the box only as a fallback");
  assert.match(main, /new ResizeObserver\(\(entries\) => \{ const r = entries\[entries\.length - 1\]\.contentRect; canvasBox = \{ width: r\.width, height: r\.height \}; \}\)\.observe\(canvas\);/);
  assert.ok(main.indexOf("let canvasBox = null;") < main.indexOf("function drawFrame("), "declared before the frame loop can run");
});

test("source-shape check: the globe, sky and Under scenes take the width from their last resize in every frame, not from clientWidth (forced reflow)", () => {
  for (const f of ["orbit", "sky", "under"]) {
    const s = fs.readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8");
    assert.ok(s.includes("(viewW || renderer.domElement.clientWidth) / 900"), f);
    assert.ok(!/clamp\(renderer\.domElement\.clientWidth \/ 900/.test(s), f);
    assert.match(s, /api\.resize = \(w, h\) => \{\s*viewW = w;/, `${f}: resize keeps the width`);
    assert.ok(s.indexOf("let viewW = 0;") < s.indexOf("api.update = "), `${f}: declared before update`);
  }
});
