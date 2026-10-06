// The collector workflow runs site/build-live.mjs on a bare GitHub runner. These checks keep that step from breaking again:
// on 2026-10-06 the live page build failed on every run because a module it reaches imported a package (astronomy-engine) that the runner had not installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/live-data.yml"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// every module build-live.mjs reaches through relative imports, and every bare package they import
function reach(entry) {
  const seen = new Set(), bare = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
      const spec = m[1] || m[2];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) queue.push(path.resolve(path.dirname(file), spec));
      else bare.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
  }
  return { files: [...seen], bare: [...bare] };
}

test("every package the live page build imports is a production dependency", () => {
  const { files, bare } = reach(path.join(root, "site/build-live.mjs"));
  assert.ok(files.length > 10, `only ${files.length} modules were followed, the import scan is broken`);
  for (const name of bare) {
    assert.ok(pkg.dependencies && pkg.dependencies[name], `${name} is imported by the live page build but is not in package.json dependencies (the runner installs only those)`);
  }
});

test("the workflow installs the production packages before it builds the live pages", () => {
  const install = workflow.indexOf("npm ci --omit=dev");
  const build = workflow.indexOf("site/build-live.mjs");
  assert.ok(install > -1, "the workflow has no npm ci step");
  assert.ok(build > -1 && install < build, "the install must come before the page build");
  assert.match(workflow, /npm ci --omit=dev --ignore-scripts/, "install production packages only, without running install scripts");
});

test("the alert step also fires when the install step fails", () => {
  const cond = workflow.split("\n").find((l) => /steps\.collect\.outcome == 'failure'/.test(l));
  assert.ok(cond, "no alert condition found");
  for (const id of ["collect", "packages", "pages"]) assert.ok(cond.includes(`steps.${id}.outcome == 'failure'`), `alert condition misses ${id}`);
});
