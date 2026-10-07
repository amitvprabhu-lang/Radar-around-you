// Bundles the two browser scripts of /satellites-near-me/ with esbuild (a dependency already): near-page.<hash>.js (the form and the
// drawing, site/near-page.mjs) and near-calc.<hash>.js (the calculation, site/near-calc.mjs, run in a Web Worker). Each name carries the
// first 10 hex digits of the file's sha256, as the app's app.<hash>.js does, so a cached old copy can never be mistaken for a new one.
// The scripts are written next to the page by site/build.mjs; nothing on the server changes.
//
// satellite.js 7 re-exports a WebAssembly variant that cannot be bundled for the browser; the app's build.mjs replaces it with an empty
// module through an esbuild plugin (stubWasm), and so does this. Plugins need esbuild's asynchronous API while the site build is
// synchronous, so buildNear runs this file as a short child process (`node site/near-assets.mjs --emit`) and reads its JSON answer.
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
export const NEAR_SCRIPT_RE = /^near-(page|calc)\.[0-9a-f]{10}\.js$/;
export const hashName = (kind, code) => `near-${kind}.${crypto.createHash("sha256").update(code).digest("hex").slice(0, 10)}.js`;

export async function bundleNear() {
  const esbuild = await import("esbuild");
  const { stubWasm } = await import("../build.mjs");
  const one = async (kind, entry) => {
    const r = await esbuild.build({
      plugins: [stubWasm], entryPoints: [here(entry)], bundle: true, minify: true, format: "iife", target: "es2020", write: false, legalComments: "none",
      charset: "ascii", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    });
    const code = r.outputFiles[0].text;
    return { file: hashName(kind, code), code, bytes: Buffer.byteLength(code) };
  };
  return { page: await one("page", "./near-page.mjs"), calc: await one("calc", "./near-calc.mjs") };
}

let memo = null;
export function buildNear() {
  if (!memo) memo = JSON.parse(execFileSync(process.execPath, [self, "--emit"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  return memo;
}

if (process.argv[1] && path.resolve(process.argv[1]) === self && process.argv.includes("--emit")) {
  bundleNear().then((r) => process.stdout.write(JSON.stringify(r)), (e) => { console.error(e && e.message); process.exit(1); });
}
