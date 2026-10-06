import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../template.html", import.meta.url), "utf8");

test("the web font stylesheet does not block the first paint", () => {
  const links = html.match(/<link [^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || [];
  assert.equal(links.length, 1);
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
