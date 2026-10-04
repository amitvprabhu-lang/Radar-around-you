// Builds the preview package in preview/: the page plus its data files, with binary files as base64 text (.bin.txt),
// for hosts that only serve standard web file types. Usage: npm run preview
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

execFileSync("node", ["build.mjs", "--b64"], { stdio: "inherit" });
const out = "preview";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync("dist/radar-b64.html", path.join(out, "radar.html"));
const SKIP = new Set(["tex/clouds1k.webp"]); // not used by the page
let n = 0, bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const rel = path.relative("public", p);
    if (SKIP.has(rel)) continue;
    const dest = path.join(out, rel.endsWith(".bin") ? rel + ".txt" : rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (rel.endsWith(".bin")) fs.writeFileSync(dest, fs.readFileSync(p).toString("base64")); else fs.copyFileSync(p, dest);
    n++; bytes += fs.statSync(dest).size;
  }
})("public");
console.log(`preview/: radar.html plus ${n} data files, ${(bytes / 1024).toFixed(0)} KB of data`);
