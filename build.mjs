// Bundles src/<entry> with esbuild (three.js tree-shaken) and writes a self-contained page to dist/.
// usage: node build2.mjs [entry] [template] [out]
import fs from "node:fs";
import * as esbuild from "esbuild";

const b64 = process.argv.includes("--b64");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const entry = args[0] || "src/main.js";
const template = args[1] || "template.html";
const out = args[2] || (b64 ? "dist/radar-b64.html" : "dist/radar.html");
const result = await esbuild.build({
  entryPoints: [entry], bundle: true, minify: true, format: "iife", target: "es2020", write: false, legalComments: "none", charset: "utf8",
  define: { "process.env.NODE_ENV": '"production"', __B64__: b64 ? "true" : "false" },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = fs.readFileSync(template, "utf8").replace("__APP__", () => js);
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0), "KB html;", (js.length / 1024).toFixed(0), "KB script");
