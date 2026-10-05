// Page shell for the content site: head metadata, structured data, navigation, footer and the small shared stylesheet.
// Links between pages are relative, so the site works under any base path. Canonical URLs and the sitemap use SITE_URL.

// OURS: the address canonical links and the sitemap use when SITE_URL is not set. It is a guess at a GitHub Pages address.
export const DEFAULT_SITE_URL = "https://amitvprabhu-lang.github.io/Radar-around-you";

// The address the site is published at, from SITE_URL. A wrong value would put wrong canonical links on every page without any
// error (for example a stray character typed in front of https), so anything that is not a plain https address stops the build:
// lowercase scheme and host, no spaces, no login, no query and no fragment. Trailing slashes are removed.
export function siteUrlFromEnv(value) {
  const v = (value === undefined || value === null ? "" : String(value).trim()).replace(/\/+$/, "");
  if (v === "") return DEFAULT_SITE_URL;
  let u = null;
  try { u = new URL(v); } catch { /* reported below */ }
  const ok = u && u.protocol === "https:" && u.host && !u.username && !u.password && !u.search && !u.hash && !/\s/.test(v) && v.startsWith(`https://${u.host}`);
  if (!ok) throw new Error(`site: SITE_URL must be an https address in lowercase such as https://example.org (no spaces, login, query or fragment), got "${v}"`);
  return v;
}

// Whether to tell search engines to stay away, for a temporary test address that must not be indexed.
// Only "1" turns it on and only "0" or nothing turns it off. Anything else is a typo, and a typo must not decide this quietly.
export function noindexFromEnv(value) {
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (v === "" || v === "0") return false;
  if (v === "1") return true;
  throw new Error(`site: SITE_NOINDEX must be 1 or 0 (or not set), got "${v}"`);
}

export const ROBOTS_CONTENT = { index: "index,follow,max-image-preview:large", noindex: "noindex,nofollow" };
export const robotsMeta = (noindex) => `<meta name="robots" content="${noindex ? ROBOTS_CONTENT.noindex : ROBOTS_CONTENT.index}">`;

export const SITE = {
  name: "Radar Around You",
  // Set SITE_URL when the domain is chosen. Until then canonical links use DEFAULT_SITE_URL, which is an assumption.
  url: siteUrlFromEnv(process.env.SITE_URL),
  repo: "https://github.com/amitvprabhu-lang/Radar-around-you",
  // set SITE_NOINDEX=1 while the site is on a temporary address; remove it when the real domain goes live
  noindex: noindexFromEnv(process.env.SITE_NOINDEX),
};

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "moon-phases/index.html" -> "moon-phases/"; "index.html" -> ""
export const urlPath = (file) => file.replace(/index\.html$/, "");

// relative link from one page file to another page file (or to a folder with a trailing slash)
export function href(fromFile, toFile) {
  const from = fromFile.split("/").slice(0, -1);
  const toDirs = urlPath(toFile).split("/");
  const last = toDirs.pop();  // "" for a folder, or a file name
  let i = 0;
  while (i < from.length && i < toDirs.length && from[i] === toDirs[i]) i++;
  const ups = from.length - i;
  const rest = toDirs.slice(i).concat(last ? [last] : []);
  const out = "../".repeat(ups) + rest.join("/") + (last === "" && rest.length ? "/" : "");
  return out || "./";
}

export const NAV = [
  ["", "Live app"],
  ["moon-phases/", "Moon phases"],
  ["eclipses/", "Eclipses"],
  ["meteor-showers/", "Meteor showers"],
  ["planets/", "Planets"],
  ["how-many-satellites-in-orbit/", "Satellite count"],
  ["sky/", "Sky by city"],
  ["guides/", "Guides"],
  ["methods/", "How we know"],
];

const CSS = `
:root{color-scheme:dark;--ink:#04060c;--ink2:#0a0f1c;--panel:#0d1322;--line:rgba(160,185,255,.16);--text:#eaf0ff;--muted:#9aa7c7;--dim:#7d89a8;--ion:#62e6c3;--signal:#ffd166;--alert:#ff6b7a;--violet:#a98cff;--sky:#6fb4ff}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--ion)}a:hover{color:#fff}:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:var(--panel);padding:8px 12px;z-index:9}
header.top{border-bottom:1px solid var(--line);background:var(--ink2)}
.bar{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
.brand{font-weight:700;color:var(--text);text-decoration:none;margin-right:auto;display:flex;align-items:center;gap:8px}
.brand i{width:10px;height:10px;border-radius:50%;background:var(--ion);box-shadow:0 0 10px var(--ion)}
nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:15px}
nav a{color:var(--muted);text-decoration:none;padding:4px 0}nav a:hover,nav a[aria-current]{color:var(--text)}
main{max-width:1040px;margin:0 auto;padding:28px 16px 56px}
article{max-width:760px}.wide{max-width:none}
h1{font-size:clamp(28px,5vw,42px);line-height:1.15;margin:.2em 0 .4em;text-wrap:balance}
h2{font-size:clamp(22px,3.4vw,28px);line-height:1.25;margin:2em 0 .5em;text-wrap:balance}
h3{font-size:18px;margin:1.6em 0 .4em;color:var(--muted);font-weight:600;letter-spacing:.02em}
.kicker{font:600 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ion)}
.lead{font-size:19px;color:#d6defa}
.meta{color:var(--dim);font-size:14px}
p,li{max-width:70ch}ul,ol{padding-left:1.2em}
.crumbs{font-size:14px;color:var(--dim);margin:0 0 12px}.crumbs a{color:var(--muted)}
.cta{display:inline-flex;gap:8px;align-items:center;background:var(--ion);color:#04110d;font-weight:700;padding:11px 18px;border-radius:999px;text-decoration:none;margin:6px 0}
.cta:hover{background:#8ff0d6;color:#04110d}
.note{border-left:3px solid var(--violet);background:rgba(169,140,255,.08);padding:10px 14px;border-radius:0 10px 10px 0;margin:18px 0;color:#cfd6f2}
.note.warn{border-color:var(--signal);background:rgba(255,209,102,.08)}
.tablewrap{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:15px;font-variant-numeric:tabular-nums}
caption{text-align:left;padding:10px 14px;color:var(--muted);font-size:14px}
th,td{padding:9px 14px;text-align:left;border-top:1px solid var(--line);vertical-align:top}
th{background:rgba(255,255,255,.04);color:var(--muted);font-weight:600;font-size:13px;letter-spacing:.03em;white-space:nowrap}
tbody tr:hover{background:rgba(255,255,255,.03)}
td.num{text-align:right;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin:16px 0;padding:0;list-style:none}
.card{display:block;border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--text);height:100%}
.card:hover{border-color:var(--ion)}.card b{display:block;margin-bottom:4px}.card span{color:var(--muted);font-size:15px}
.tz{margin:10px 0}.tz button{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer}
.tz button[aria-pressed=true]{border-color:var(--ion);color:var(--ion)}
.sources li{margin:.4em 0}
footer{border-top:1px solid var(--line);background:var(--ink2);color:var(--dim);font-size:14px}
footer .bar{display:block}footer p{margin:.5em 0;max-width:80ch}
@media (max-width:600px){body{font-size:16px}th,td{padding:8px 10px}}
`;

// A tiny enhancement: show every <time data-ts> in the visitor's own time zone on request, and name the next event in a table.
const SCRIPT = `
(function(){
  var times=[].slice.call(document.querySelectorAll('time[data-ts]'));
  var box=document.querySelector('.tz');
  if(box&&times.length){
    var b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed','false');b.textContent='Show times in my time zone';
    box.appendChild(b);
    var orig=times.map(function(t){return t.textContent});
    var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
    b.addEventListener('click',function(){
      var on=b.getAttribute('aria-pressed')!=='true';
      b.setAttribute('aria-pressed',String(on));
      b.textContent=on?('Showing '+(tz||'your time zone')+'. Show UTC'):'Show times in my time zone';
      times.forEach(function(t,i){
        if(!on){t.textContent=orig[i];return}
        var d=new Date(t.getAttribute('data-ts'));
        t.textContent=t.hasAttribute('data-day')?new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'}).format(d):new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(d);
      });
    });
  }
  var next=document.getElementById('next-event');
  if(next){
    var now=Date.now(),best=null;
    [].slice.call(document.querySelectorAll('[data-event]')).forEach(function(r){
      var t=Date.parse(r.getAttribute('data-event-ts'));
      if(t>=now&&(!best||t<best.t))best={t:t,name:r.getAttribute('data-event')};
    });
    if(best){
      var days=Math.round((best.t-now)/86400000);
      next.textContent='Next on this page: '+best.name+', '+(days<1?'within a day':days===1?'in about 1 day':'in about '+days+' days')+'.';
      next.hidden=false;
    }
  }
})();
`;

export function table({ caption, head, rows, numeric = [] }) {
  const cell = (c, i, tag = "td") => `<${tag}${numeric.includes(i) ? ' class="num"' : ""}>${c}</${tag}>`;
  return `<div class="tablewrap" role="region" tabindex="0" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${head.map((h, i) => cell(esc(h), i, "th")).join("")}</tr></thead><tbody>${rows.map((r) => `<tr${r.attrs || ""}>${(r.cells || r).map((c, i) => cell(c, i)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function timeTag(date, kind = "time") {
  const iso = date.toISOString();
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date);
  return kind === "day" ? `<time datetime="${iso}" data-ts="${iso}" data-day>${day}</time>` : `<time datetime="${iso}" data-ts="${iso}">${hm}</time>`;
}

export function sources(list) {
  return `<h2 id="sources">Sources</h2><ul class="sources">${list.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>${s.note ? `. ${esc(s.note)}` : ""}</li>`).join("")}</ul>`;
}

// page: { file, title, description, h1, kicker, lead, body, type, updated, crumbs, jsonld, cta }
export function renderPage(page, { noindex = SITE.noindex } = {}) {
  const here = page.file;
  const canonical = `${SITE.url}/${urlPath(here)}`;
  const crumbs = [{ name: "Home", file: "index.html" }, ...(page.crumbs || []), { name: page.crumbTitle || page.h1, file: here }];
  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE.url}/${urlPath(c.file)}` })),
  };
  const ld = [breadcrumbLd, ...(page.jsonld || [])];
  const navHtml = NAV.map(([f, label]) => {
    const target = f === "" ? "index.html" : f + "index.html";
    return `<li><a href="${href(here, target)}"${target === here ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`;
  }).join("");
  const crumbHtml = crumbs.slice(0, -1).map((c) => `<a href="${href(here, c.file)}">${esc(c.name)}</a>`).join(" / ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(canonical)}">
${robotsMeta(noindex)}
<meta property="og:type" content="${page.type === "guide" ? "article" : "website"}">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#04060c">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top"><div class="bar"><a class="brand" href="${href(here, "index.html")}"><i></i>${esc(SITE.name)}</a><nav aria-label="Main"><ul>${navHtml}</ul></nav></div></header>
<main id="main"><article class="${page.wide ? "wide" : ""}">
<p class="crumbs" aria-label="Breadcrumb">${crumbHtml}</p>
<p class="kicker">${esc(page.kicker || "")}</p>
<h1>${esc(page.h1)}</h1>
<p class="lead">${page.lead}</p>
${page.meta ? `<p class="meta">${page.meta}</p>` : ""}
${page.cta ? `<p><a class="cta" href="${href(here, "index.html")}${page.cta.query || ""}">${esc(page.cta.label)}</a></p>` : ""}
${page.body}
</article></main>
<footer><div class="bar"><p>${esc(SITE.name)} is a free tool for looking up: what is overhead, what is in tonight's sky and what the ground has just done. Satellite and quake data come from CelesTrak and the USGS. Positions of the Moon, Sun and planets are computed with the astronomy-engine library. Every number on these pages links to how it was found on <a href="${href(here, "methods/index.html")}">How we know</a>.</p><p><a href="${esc(SITE.repo)}" rel="noopener">Source code and data notes on GitHub</a>. Code under the MIT licence; data keeps its sources' terms.</p></div></footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
