// The app page's two build modes (build.mjs): inline (the default, one self-contained file, byte for byte as before the external mode
// existed) and external (--external-script, the production site only: the bundle in app.<hash>.js next to the page, named in the head
// with defer, and a small guard that shows a reload message when the script cannot be downloaded).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assemble, buildApp, appScriptName, appScriptOf, appLoadGuard, APP_GUARD_SCRIPT, APP_SCRIPT_RE, APP_SLOW_MS, appScriptTag } from "../build.mjs";
import { wrapApp, asDocument, build as buildSite } from "../site/build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const TEMPLATE = fs.readFileSync(path.join(root, "template.html"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "appscript-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sha10 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
const oldRecipe = (template, js) => template.replace("__APP__", () => js.replace(/<\/script/gi, "<\\/script"));
const FAKE_JS = 'var a="</script>";console.log(a)';

test("the inline page is the template with the bundle in place of __APP__, exactly as the build always made it", () => {
  const r = assemble(TEMPLATE, FAKE_JS);
  assert.equal(r.script, null);
  assert.equal(r.html, oldRecipe(TEMPLATE, FAKE_JS));
  assert.ok(r.html.includes('<script>var a="<\\/script>";console.log(a)</script>'), "</script inside the bundle is escaped");
  assert.equal(appScriptOf(r.html), null, "names no external script");
  // a $ pattern in the bundle is not read as a replacement pattern
  assert.ok(assemble(TEMPLATE, "x='$&$1'").html.includes("<script>x='$&$1'</script>"));
});

test("the external page names app.<first 10 hex of the bundle's sha256>.js in its head with defer, and carries no bundle", () => {
  const r = assemble(TEMPLATE, FAKE_JS, { external: true });
  assert.equal(r.script.file, `app.${sha10(FAKE_JS)}.js`);
  assert.equal(r.script.file, appScriptName(FAKE_JS));
  assert.match(r.script.file, APP_SCRIPT_RE);
  assert.equal(r.script.js, FAKE_JS, "the file holds the bundle as esbuild wrote it, without the HTML escaping");
  assert.notEqual(appScriptName(FAKE_JS + " "), r.script.file, "another bundle, another name");
  const h = r.html;
  assert.ok(!h.includes(FAKE_JS) && !h.includes("__APP__") && !h.includes("<script>__APP__</script>"));
  assert.equal(appScriptOf(h), r.script.file);
  const tag = `<script src="${r.script.file}" defer onload="__radarLoad.ok()" onerror="__radarLoad.fail()"></script>`;
  assert.equal(appScriptTag(r.script.file), tag);
  assert.equal(h.split(tag).length - 1, 1);
  // in the head part of the fragment: after the lead links, before the template's <style>, the loader and #app; the guard first
  const at = (s) => h.indexOf(s);
  assert.ok(at('<link rel="manifest"') < at('<script id="app-guard">') && at('<script id="app-guard">') < at(tag) && at(tag) < at("<style>") && at("<style>") < at('<div id="app"') && at('<div id="app"') < at('<div id="loader"'));
  // everything else of the template is unchanged: removing the two tags and putting the inline script back gives the inline page
  const back = h.replace(APP_GUARD_SCRIPT + "\n" + tag + "\n", "").replace(/<\/noscript>\n$/, `</noscript>\n<script>${FAKE_JS.replace(/<\/script/gi, "<\\/script")}</script>\n`);
  assert.equal(back, oldRecipe(TEMPLATE, FAKE_JS));
  assert.ok(h.endsWith("</noscript>\n"), "the page still ends with the font noscript block and a newline");
  assert.throws(() => assemble("<title>x</title><div id=\"app\"></div>", FAKE_JS, { external: true }), /needs <style> and a <script>__APP__<\/script>/);
});

test("the guard script is small, safe and has nothing that could end the element early or load anything", () => {
  assert.ok(APP_GUARD_SCRIPT.length < 2200, `${APP_GUARD_SCRIPT.length} characters`);
  const body = APP_GUARD_SCRIPT.slice('<script id="app-guard">'.length, -"</script>".length);
  assert.ok(!/<\/script|<!--/i.test(body));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\b|new Function|import\(|fetch\(|src=/.test(body), "only textContent and DOM nodes");
  assert.equal(APP_SLOW_MS, 30000);
  // it is plain JavaScript a browser runs: parse it
  assert.doesNotThrow(() => new vm.Script(body));
});

// a tiny pretend DOM, enough for the guard: elements with ids, children, textContent, and a document that can be "loading"
function fakeDom({ loader = true, readyState = "interactive" } = {}) {
  const byId = new Map(), listeners = {}, timers = [];
  const el = (tag) => {
    const e = { tagName: tag.toUpperCase(), children: [], _text: "", id: "", href: "", onclick: null,
      appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); for (const d of c.all ? c.all() : []) if (d.id) byId.set(d.id, d); return c; },
      replaceChildren(...cs) { for (const c of this.children) if (c.id) byId.delete(c.id); this.children = []; this._text = ""; cs.forEach((c) => this.appendChild(c)); },
      all() { return this.children.flatMap((c) => (c.all ? [c, ...c.all()] : [])); },
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
      set textContent(v) { this._text = v; this.children = []; },
    };
    return e;
  };
  const doc = { readyState, createElement: el, createTextNode: (t) => ({ textContent: t }), getElementById: (id) => byId.get(id) || null,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); } };
  if (loader) {
    const l = el("div"); l.id = "loader"; byId.set("loader", l);
    const small = el("small"); small.id = "loadText"; small.textContent = "Starting up"; l.appendChild(small);
  }
  const win = { location: { href: "https://radar.test/#sky", reloads: 0, reload() { this.reloads++; } },
    setTimeout: (f, ms) => { timers.push({ f, ms, live: true }); return timers.length - 1; }, clearTimeout: (i) => { if (timers[i]) timers[i].live = false; } };
  return { doc, win, timers, listeners, run: () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.f(); }) };
}
const findTag = (e, tag) => (e.children || []).flatMap((c) => [...(c.tagName === tag ? [c] : []), ...findTag(c, tag)]);

test("guard: a failed download replaces the loader with a message and a reload link in #nogl", () => {
  const d = fakeDom();
  const g = appLoadGuard(d.win, d.doc, APP_SLOW_MS);
  assert.equal(d.timers[0].ms, APP_SLOW_MS);
  g.fail();
  const loader = d.doc.getElementById("loader"), box = d.doc.getElementById("nogl");
  assert.ok(box, "#nogl, the id the home page's CSS and wheel script already treat as 'the app cannot start'");
  assert.equal(loader.children.length, 1);
  assert.equal(d.doc.getElementById("loadText"), null, "the spinning status line is gone");
  assert.equal(findTag(box, "H1")[0].textContent, "The app could not load");
  assert.equal(box.textContent, "The app could not loadIts script did not arrive. Check the connection, then reload the page.");
  const a = findTag(box, "A")[0];
  assert.equal(a.href, "https://radar.test/#sky");
  assert.equal(a.onclick(), false);
  assert.equal(d.win.location.reloads, 1, "the link reloads the page");
  d.run();
  assert.equal(d.doc.getElementById("loadText"), null, "the slow timer was cancelled");
  g.fail();
  assert.equal(loader.children.length, 1, "a second failure adds nothing");
});

test("guard: a stalled download changes only the status line after 30 s; a script that loads cancels it", () => {
  const d = fakeDom();
  appLoadGuard(d.win, d.doc, APP_SLOW_MS);
  d.run();
  const t = d.doc.getElementById("loadText");
  assert.equal(t.textContent, "Still loading. If nothing changes, reload the page.");
  assert.equal(d.doc.getElementById("nogl"), null, "the loader stays, so the app can still start if the script arrives");
  const d2 = fakeDom();
  const g2 = appLoadGuard(d2.win, d2.doc, APP_SLOW_MS);
  g2.ok(); d2.run();
  assert.equal(d2.doc.getElementById("loadText").textContent, "Starting up");
});

test("guard: a failure reported before the loader is parsed waits for DOMContentLoaded", () => {
  const d = fakeDom({ loader: false, readyState: "loading" });
  const g = appLoadGuard(d.win, d.doc, APP_SLOW_MS);
  g.fail();
  assert.equal(d.listeners.DOMContentLoaded.length, 1);
  const l = d.doc.createElement("div"); l.id = "loader";
  d.doc.getElementById = ((orig) => (id) => (id === "loader" ? l : orig(id)))(d.doc.getElementById);
  l.replaceChildren = function (...cs) { this.children = cs; };
  d.listeners.DOMContentLoaded[0]();
  assert.equal(l.children[0].id, "nogl");
});

test("buildApp: the inline default is byte for byte the old recipe and holds the bundle; external mode writes the hashed file", async () => {
  const entry = path.join(root, "src/main.js"), template = path.join(root, "template.html");
  const inline = await buildApp({ entry, template, out: path.join(tmp, "inline/radar.html"), sitePages: true });
  const html = fs.readFileSync(inline.out, "utf8");
  assert.equal(html, oldRecipe(TEMPLATE, inline.js));
  assert.ok(html.length > 500 * 1024 && html.includes("<script>") && appScriptOf(html) === null && !/src="app\./.test(html), "the bundle is inline, no external reference");
  assert.equal(inline.script, null);
  assert.deepEqual(fs.readdirSync(path.join(tmp, "inline")), ["radar.html"], "nothing else is written");

  const dir = path.join(tmp, "ext");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "app.0123456789.js"), "old");
  fs.writeFileSync(path.join(dir, "app.notes.js"), "not a build output");
  const ext = await buildApp({ entry, template, out: path.join(dir, "radar.html"), sitePages: true, external: true });
  const page = fs.readFileSync(ext.out, "utf8"), file = appScriptOf(page);
  assert.equal(ext.js, inline.js, "the same bundle in both modes");
  assert.equal(file, ext.script.file);
  const js = fs.readFileSync(path.join(dir, file), "utf8");
  assert.equal(js, inline.js);
  assert.equal(file, `app.${sha10(js)}.js`, "the name comes from the file's own bytes");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["app.notes.js", file, "radar.html"].sort(), "the older app.<hash>.js is removed, other files stay");
  assert.ok(!page.includes(js.slice(0, 2000)), "no inline bundle");
  // the production home page made from it stays small
  const home = asDocument(wrapApp(page, { noindex: false }));
  assert.ok(Buffer.byteLength(home) < 150 * 1024, `${Buffer.byteLength(home)} bytes`);
  const head = home.slice(0, home.indexOf("</head>"));
  assert.ok(head.includes(`<script src="${file}" defer `) && head.includes('<script id="app-guard">'), "both in <head>");
  // a rebuild leaves exactly one app script
  await buildApp({ entry, template, out: path.join(dir, "radar.html"), sitePages: true, external: true });
  assert.equal(fs.readdirSync(dir).filter((f) => APP_SCRIPT_RE.test(f)).length, 1);
});

test("the command line: --external-script writes the script next to the page; without it nothing but the page", () => {
  const out = path.join(tmp, "cli/page.html");
  const run = (...flags) => spawnSync(process.execPath, ["build.mjs", ...flags, "src/main.js", "template.html", out], { cwd: root, encoding: "utf8", env: { ...process.env, LIVE_BASE: "" } });
  const a = run("--external-script");
  assert.equal(a.status, 0, a.stderr);
  const file = appScriptOf(fs.readFileSync(out, "utf8"));
  assert.ok(file && fs.existsSync(path.join(tmp, "cli", file)), a.stdout);
  assert.match(a.stdout, /KB script \(external\)/);
  const b = run();
  assert.equal(b.status, 0, b.stderr);
  assert.equal(appScriptOf(fs.readFileSync(out, "utf8")), null);
  assert.ok(fs.existsSync(path.join(tmp, "cli", file)), "an inline build leaves other files alone");
});

test("package.json: only build:hosting uses the external script; the harness builds and their suites stay single-file", () => {
  const s = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.match(s["build:hosting"], /^node build\.mjs --site-pages --external-script && npm run site && node site\/live-snapshot\.mjs$/);
  for (const k of ["build", "build:snapshot", "build:sitepages", "e2e", "e2e:live"]) assert.ok(!s[k].includes("--external-script"), k);
  assert.match(s["e2e:site"], /^LIVE_SNAPSHOT=0 npm run build:hosting && node e2e-site\.mjs$/, "the site suite tests the external script");
});

test("site build: copies the named script next to index.html, removes older ones, and refuses a missing or mismatched file", () => {
  const js = "console.log('app')", file = appScriptName(js);
  const app = assemble(TEMPLATE, js, { external: true }).html;
  const src = path.join(tmp, "site-src"), out = path.join(tmp, "site-out");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "radar.html"), app);
  fs.writeFileSync(path.join(src, file), js);
  fs.writeFileSync(path.join(src, "app.aaaaaaaaaa.js"), "an older build left in dist/");
  const r = buildSite({ outDir: out, appFile: path.join(src, "radar.html"), publicDir: null, noindex: false });
  assert.equal(r.appScript, file);
  assert.deepEqual(fs.readdirSync(out).filter((f) => /^app\./.test(f)), [file], "exactly the current script is published");
  assert.equal(fs.readFileSync(path.join(out, file), "utf8"), js);
  const home = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(home.indexOf(`<script src="${file}" defer`) < home.indexOf("</head>") && home.indexOf('<script id="app-guard">') < home.indexOf(`<script src="${file}"`));
  assert.ok(!home.includes("console.log('app')"));
  // the wrapApp injections are all there, in their order, and the noscript block still ends with </noscript> and a newline
  const order = ["</head>", "<body>", "<noscript><div", "</noscript>\n", '<span id="top" class="home-top"', '<a class="home-more"', '<div id="app"', '<div id="loader"', '<div class="home-spacer"', '<section id="about-home"', '<script id="home-wheel">', '<script id="home-strip-js">', "</body>"];
  for (let i = 1; i < order.length; i++) assert.ok(home.indexOf(order[i - 1]) >= 0 && home.indexOf(order[i - 1]) < home.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`);
  // a missing file, or one whose bytes do not match its name, stops the build
  fs.rmSync(path.join(src, file));
  assert.throws(() => buildSite({ outDir: path.join(tmp, "site-out2"), appFile: path.join(src, "radar.html"), publicDir: null, noindex: false }), /names app\.[0-9a-f]{10}\.js but .* is missing/);
  assert.ok(!fs.existsSync(path.join(tmp, "site-out2")), "before it writes anything");
  fs.writeFileSync(path.join(src, file), js + "// edited");
  assert.throws(() => buildSite({ outDir: path.join(tmp, "site-out3"), appFile: path.join(src, "radar.html"), publicDir: null, noindex: false }), /does not match its name/);
  // an inline app page publishes no app script
  fs.writeFileSync(path.join(src, "inline.html"), assemble(TEMPLATE, js).html);
  const r4 = buildSite({ outDir: path.join(tmp, "site-out4"), appFile: path.join(src, "inline.html"), publicDir: null, noindex: false });
  assert.equal(r4.appScript, null);
  assert.equal(fs.readdirSync(path.join(tmp, "site-out4")).filter((f) => /^app\./.test(f)).length, 0);
});

test("no app code finds its files from the script's own address, so moving the script out of the page changes no URL", () => {
  for (const f of fs.readdirSync(path.join(root, "src"))) {
    const s = fs.readFileSync(path.join(root, "src", f), "utf8");
    assert.ok(!/document\.currentScript|import\.meta\.url|import\.meta\b/.test(s), `src/${f}`);
  }
});
