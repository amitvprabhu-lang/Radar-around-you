// Bundles src/<entry> with esbuild (three.js tree-shaken) and writes a self-contained page to dist/.
// usage: node build2.mjs [entry] [template] [out]
import fs from "node:fs";
import * as esbuild from "esbuild";

const b64 = process.argv.includes("--b64");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const entry = args[0] || "src/main.js";
const template = args[1] || "template.html";
const out = args[2] || (b64 ? "dist/radar-b64.html" : "dist/radar.html");
// satellite.js 7 also ships a WebAssembly variant that cannot be bundled for the browser. The app only uses its plain
// JavaScript SGP4, so anything under wasm/ is replaced with an empty module.
const stubWasm = {
  name: "stub-satellite-wasm",
  setup(b) {
    b.onResolve({ filter: /(^|\/)wasm(-build)?\// }, () => ({ path: "wasm-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
  },
};
const result = await esbuild.build({
  plugins: [stubWasm],
  entryPoints: [entry], bundle: true, minify: true, format: "iife", target: "es2020", write: false, legalComments: "none", charset: "utf8",
  // LIVE_BASE="" turns live polling off (a snapshot-only host); any other value is the folder the pipeline publishes into
  define: { "process.env.NODE_ENV": '"production"', __B64__: b64 ? "true" : "false", ...(process.env.LIVE_BASE !== undefined ? { __LIVE_BASE__: JSON.stringify(process.env.LIVE_BASE) } : {}) },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = fs.readFileSync(template, "utf8").replace("__APP__", () => js);
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0), "KB html;", (js.length / 1024).toFixed(0), "KB script");
