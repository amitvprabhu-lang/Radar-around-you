// Bundles src/<entry> with esbuild (three.js tree-shaken) and writes the page to dist/.
// usage: node build.mjs [entry] [template] [out] [--b64] [--site-pages] [--external-script]
//
// Two ways to put the bundle into the page:
//  - inline (the default, used by npm run build, build:snapshot, build:sitepages and every harness-based browser suite): one
//    self-contained file, the bundle inside <script> at the end of template.html, exactly as before the external mode existed;
//  - external (--external-script, used only by npm run build:hosting for the real site): the bundle is written next to the page as
//    app.<first 10 hex digits of its sha256>.js and the page's head names it with <script src defer>, so the page itself is small,
//    the browser starts the download while it parses the page, and a returning visitor keeps the script in its cache until the
//    bundle changes (a new bundle gets a new name). Everything else (the critical CSS, the loader, #app, the noscript blocks) stays
//    inline. A tiny inline script before it shows a message with a reload link if the script cannot be downloaded.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// The external script's file name: content-addressed, so a cached copy is always the right bytes for the name.
export const APP_SCRIPT_RE = /^app\.[0-9a-f]{10}\.js$/;
export const appScriptName = (js) => `app.${crypto.createHash("sha256").update(js, "utf8").digest("hex").slice(0, 10)}.js`;
// the external script named in a built page (null for an inline page)
export function appScriptOf(html) {
  const m = html.match(/<script src="(app\.[0-9a-f]{10}\.js)" defer\b/);
  return m ? m[1] : null;
}

// What the visitor sees when the external script cannot be used. Attempt 0 is the <script defer> in the head; attempt 1 is one retry.
// fail(n): attempt n did not give a running script: the download failed (network error, blocked, a 404 because an old cached page
// names a script a later deploy removed) or the file arrived but would not run (a window "error" from that file before its "load",
// for example a syntax error, or an html page served at its address). The first failure removes the file from the service worker's
// cache and fetches it once more with "?r=<time>" (a new address, so neither the browser's cache nor the worker's cache-first rule
// answers it; the worker leaves such requests alone). A second failure replaces the loader with a message and a reload link, in the
// same #nogl element the app uses when WebGL fails, so the home page's text section offers its read-more link and scrollbar as it
// does then. The retry happens in the page, never by reloading it, so it cannot loop; the reload link is the visitor's choice.
// slow: 30 seconds after the page started, if the app has not set window.__radarStarted and the loader is still there, the loader's
// small status line gets a hint with a reload link; the app overwrites that line with its own progress if it is still starting.
// Kept small, no imports, and only textContent (no HTML strings).
export function appLoadGuard(win, doc, file, cacheName, waitMs) {
  var cur = 0, settled = [];
  win.setTimeout(function () { if (!win.__radarStarted) show(true); }, waitMs);
  if (win.addEventListener) win.addEventListener("error", function (e) {
    var f = e && typeof e.filename === "string" ? e.filename : "";
    if (f.indexOf(file) >= 0) fail(f.indexOf("?r=") >= 0 ? 1 : 0);
  });
  function link() {
    var a = doc.createElement("a");
    a.href = win.location.href; a.textContent = "reload the page";
    a.onclick = function () { win.location.reload(); return false; };
    return a;
  }
  function show(slow) {
    var loader = doc.getElementById("loader");
    if (!loader) { if (!slow && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { show(false); }); return; }
    if (doc.getElementById("nogl")) return;
    if (slow) {
      var t = doc.getElementById("loadText");
      if (t) { t.textContent = "Still loading. If nothing changes, "; t.appendChild(link()); t.appendChild(doc.createTextNode(".")); }
      return;
    }
    var box = doc.createElement("div"), h = doc.createElement("h1"), p = doc.createElement("p");
    box.id = "nogl"; h.textContent = "The app could not load";
    p.textContent = "Its script could not be loaded. Check the connection, then ";
    p.appendChild(link()); p.appendChild(doc.createTextNode("."));
    box.appendChild(h); box.appendChild(p);
    loader.replaceChildren(box);
  }
  function ok(n) { settled[n] = true; }
  function fail(n) {
    if (n !== cur || settled[n]) return;
    settled[n] = true;
    try { if (win.caches) win.caches.open(cacheName).then(function (c) { return c.delete(new URL(file, win.location.href).href); }).catch(function () {}); } catch (e) { /* no cache to clean */ }
    if (n > 0) return show(false);
    cur = 1;
    var s = doc.createElement("script");
    s.src = file + "?r=" + Date.now();
    s.onload = function () { ok(1); };
    s.onerror = function () { fail(1); };
    doc.head.appendChild(s);
  }
  return { ok: ok, fail: fail };
}
export const APP_SLOW_MS = 30000;
// the service worker's cache name (VERSION in public/sw.js; test/app-script.test.js keeps them equal)
export const SW_CACHE = "radar-v1";
export const appGuardScript = (file) => `<script id="app-guard">window.__radarLoad = (${appLoadGuard.toString()})(window, document, ${JSON.stringify(file)}, ${JSON.stringify(SW_CACHE)}, ${APP_SLOW_MS});</script>`;
export const appScriptTag = (file) => `<script src="${file}" defer onload="__radarLoad.ok(0)" onerror="__radarLoad.fail(0)"></script>`;

// The page from the template and the bundle. Inline: the template with the bundle in place of __APP__ (</script escaped), byte for
// byte as before. External: the template without its script element, and the guard and the script tag in the head, just before the
// template's <style> (site/build.mjs's asDocument keeps them in <head>).
export function assemble(template, js, { external = false } = {}) {
  if (!external) return { html: template.replace("__APP__", () => js.replace(/<\/script/gi, "<\\/script")), script: null };
  const slot = "<script>__APP__</script>\n";
  const at = template.indexOf("<style>");
  if (!template.includes(slot) || at < 0) throw new Error("build: the template needs <style> and a <script>__APP__</script> line for --external-script");
  const file = appScriptName(js);
  const html = template.slice(0, at) + appGuardScript(file) + "\n" + appScriptTag(file) + "\n" + template.slice(at).replace(slot, "");
  return { html, script: { file, js } };
}

// satellite.js 7 also ships a WebAssembly variant that cannot be bundled for the browser. The app only uses its plain
// JavaScript SGP4, so anything under wasm/ is replaced with an empty module.
export const stubWasm = {
  name: "stub-satellite-wasm",
  setup(b) {
    b.onResolve({ filter: /(^|\/)wasm(-build)?\// }, () => ({ path: "wasm-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

// Builds the page (and, in external mode, the script next to it). Older app.*.js files in the page's folder are removed first, so only
// the current one is there to be copied.
export async function buildApp({ entry = "src/main.js", template = "template.html", out, b64 = false, sitePages = false, external = false, liveBase = process.env.LIVE_BASE } = {}) {
  const esbuild = await import("esbuild");
  out = out || (b64 ? "dist/radar-b64.html" : "dist/radar.html");
  const result = await esbuild.build({
    plugins: [stubWasm],
    entryPoints: [entry], bundle: true, minify: true, format: "iife", target: "es2020", write: false, legalComments: "none",
    // the external file is pure ASCII (every other character escaped), so a response decoded with the wrong character set cannot change a
    // string or a regular expression in it (the first deployment failed that way); the inline page keeps UTF-8 as before (+230 bytes, 0.02%)
    charset: external ? "ascii" : "utf8",
    // LIVE_BASE="" turns live polling off (a snapshot-only host); any other value is the folder the pipeline publishes into
    define: { "process.env.NODE_ENV": '"production"', __B64__: b64 ? "true" : "false", __SITE_PAGES__: sitePages ? "true" : "false", ...(liveBase !== undefined ? { __LIVE_BASE__: JSON.stringify(liveBase) } : {}) },
  });
  const js = result.outputFiles[0].text;
  const { html, script } = assemble(fs.readFileSync(template, "utf8"), js, { external });
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  if (external) {
    for (const f of fs.readdirSync(dir)) if (APP_SCRIPT_RE.test(f) && f !== script.file) fs.rmSync(path.join(dir, f), { force: true });
    fs.writeFileSync(path.join(dir, script.file), script.js);
  }
  fs.writeFileSync(out, html);
  return { out, html, js, script: script && { file: script.file, path: path.join(dir, script.file), bytes: Buffer.byteLength(script.js) } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const b64 = process.argv.includes("--b64");
  // --site-pages: the build for the real site, where the content pages sit next to the app; it adds links to them in the About screen
  const sitePages = process.argv.includes("--site-pages");
  const external = process.argv.includes("--external-script");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const r = await buildApp({ entry: args[0] || "src/main.js", template: args[1] || "template.html", out: args[2], b64, sitePages, external });
  if (r.script) console.log(r.out, (r.html.length / 1024).toFixed(0), "KB html;", r.script.path, (r.script.bytes / 1024).toFixed(0), "KB script (external)");
  else console.log(r.out, (r.html.length / 1024).toFixed(0), "KB html;", (r.js.length / 1024).toFixed(0), "KB script");
}
