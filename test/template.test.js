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
