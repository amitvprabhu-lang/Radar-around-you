// The text section on the home page: plain, visible answers to the questions people bring to the app, placed below the first screen
// and over the fixed 3D app, so the first screen stays exactly as it is. Only the content-site build adds it (wrapApp in build.mjs);
// the app bundle and template.html do not change. Every statement is traced in docs/home-sources.md. No hidden text, no counts that
// go stale (the count page has them), no FAQ markup. test/site.test.js keeps any run of words shared with the About page or the count
// page under 8 words and keeps the headings different from every other page's. The section starts with the page's h1 (the only one
// once the app has loaded) and a live block: six figures that the browser fills from the live folder (site/home-strip.mjs; the HTML
// carries dashes) and a row of links to every registered live page (site/livepages.mjs).
import { esc, href } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";
import { LIVE_PAGES, RIGHT_NOW_FILE } from "./livepages.mjs";
import { STRIP_FIGURES, STRIP_DASH, STRIP_SCRIPT } from "./home-strip.mjs";

export const HOME_ID = "about-home";
// The widget gallery (site/embed.mjs, GALLERY_FILE), linked under the row of live pages; a plain string here, so this module does not
// load the gallery's code.
export const EMBED_GALLERY_FILE = "embed/index.html";
// /satellites-near-me/ (site/near-ui.mjs, NEAR_FILE), linked in the same line; a plain string for the same reason.
export const NEAR_PAGE_FILE = "satellites-near-me/index.html";
// The section links the satellites by country hub only when the build has that page.
export const COUNTRY_HUB_FILE = "satellites-by-country/index.html";
const go = (to) => { const [file, frag] = to.split("#"); return href("index.html", file) + (frag ? `#${frag}` : ""); };
const a = (to, text) => `<a href="${go(to)}">${esc(text)}</a>`;

// The questions, in order. Exported so the tests check the headings against one list. None may repeat a heading of the About page or
// the count page (test/site.test.js reads those from the built pages).
export const HOME_QUESTIONS = [
  "Where is the International Space Station right now?",
  "Which satellites are above me?",
  "What is in the sky tonight?",
  "What is happening under my feet and around me?",
  "Why are there two satellite numbers on this site?",
  "Who supplies the data, and does the app cost anything?",
];

// The page's one visible h1 once the app has loaded (the loader's h1 goes with the loader). It names the site and what it is, differs
// from the title tag and from every other page's h1 and h2 (test/site.test.js).
export const HOME_H1 = "Radar Around You: a live feed of satellites, the ISS, earthquakes, aurora and storms";
// The heading over the live figures and the row of live pages, distinct from every other heading on the site.
export const HOME_LIVE_HEADING = "Live figures from the data feeds";

// Every registered live page (site/livepages.mjs), the right-now hub first, each with its registry name as the link text. The pages
// reach the site with the server's pull job, not with the deploy, so every registered page is listed whether or not this build wrote a
// copy. A page added to the registry appears here by itself; one without a name falls back to its address in words.
export function liveLinks(pages = LIVE_PAGES) {
  const words = (file) => file.replace(/\/index\.html$/, "").split("/").pop().replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const first = pages.filter((p) => p.file === RIGHT_NOW_FILE);
  // a page marked homeRow: false (the owner pages of site/objects.mjs, which their ranking page links) is not repeated here
  return [...first, ...pages.filter((p) => p.file !== RIGHT_NOW_FILE && p.homeRow !== false)].map((p) => ({ file: p.file, name: p.name || words(p.file) }));
}

// The live block: the strip of six figures (dashes in the HTML; the inline script in site/home-strip.mjs fills them in the browser from
// the site's live folder) and the row of live pages. The labels and the explanation are in the HTML; only the values and the status line
// come from the script.
export function homeLiveHtml(pages = LIVE_PAGES) {
  const figures = STRIP_FIGURES.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd data-fig="${key}">${STRIP_DASH}</dd></div>`).join("\n");
  return `<div class="home-live">
<h2 id="home-live">${esc(HOME_LIVE_HEADING)}</h2>
<div id="home-strip" class="home-strip">
<dl>
${figures}
</dl>
<p class="home-strip-note">These figures load from the site's live data in your browser.</p>
<p class="home-strip-status" aria-live="polite"></p>
</div>
<p>Each page below is rebuilt when its own feed has new data and states the time of its own data. When a feed is too old or fails a check, the page keeps its previous copy.</p>
<nav class="home-live-links" aria-label="Live pages">
<ul>
${liveLinks(pages).map((p) => `<li>${a(p.file, p.name)}</li>`).join("\n")}
</ul>
</nav>
<p class="home-embed">Five of these views also come as ${a(EMBED_GALLERY_FILE, "live widgets for your own website")}, and ${a(NEAR_PAGE_FILE, "satellites near you")} shows which satellites pass over a place you choose in the next 24 hours.</p>
</div>`;
}

export function homeTextHtml({ countryHub = false } = {}) {
  const [iss, above, tonight, around, count, free] = HOME_QUESTIONS.map(esc);
  // the hub ranks owners by their active satellites, so its clause sits in the sentence about active satellites
  const hub = countryHub ? `, and ${a(COUNTRY_HUB_FILE, "satellites by country")} ranks the owners of those active satellites as the catalogue records them` : "";
  return `<section id="${HOME_ID}" class="home-text" tabindex="-1" aria-labelledby="home-h1">
<div class="home-inner">
<p class="home-back"><a href="#top">Back to the globe</a></p>
<h1 id="home-h1">${esc(HOME_H1)}</h1>
<p class="home-lead">The globe above is a free 3D view of what is over, under and around a place you choose.</p>
${homeLiveHtml()}
<h2>${iss}</h2>
<p>Search for ISS and the globe turns to the station, drawing its orbit and the patch of Earth it can see. Its card gives its height, speed and the age of the orbit data, which comes from CelesTrak; positions are worked out on your device. Pass predictions for the station, the brightest objects and anything launched within the past 30 days use SGP4, the model built for this kind of orbit data. Everything else uses a quicker, rougher model.</p>
<h2>${above}</h2>
<p>Choose where you are: search the place list, which reaches down to towns of roughly 15,000 inhabitants, or let the app use your device's position, which stays on the device. A tile at the top then counts the tracked objects (satellites, rocket bodies and debris) 10 degrees or more above the horizon there right now, and the Sky view draws them across your sky, flashing when sunlit. Tap one for its name, how high it is, which way to face and how far away it is.</p>
<h2>${tonight}</h2>
<p>The Tonight button gives one verdict for your place from the Moon, the dark hours, the chance of aurora and, in the six cities that have one, the cloud forecast. Below it, a timeline shows what to watch for and when: passes of the ISS and other satellites, Starlink strings, planets, and meteor showers close to their peak, each with Show me and Remind me buttons. The Sky view is a first-person sky for any place, with the Moon and its phase, the planets, the officially named stars, the constellation figures and a slider through the night. A sky calendar looks 90 days ahead at Moon phases, eclipses, planet events and meteor showers.</p>
<h2>${around}</h2>
<p>The Under view slices the Earth open from an earthquake to you, through crust, mantle and core, and sends the P and S waves on their way to you: a teaching model fed by earthquakes from the U.S. Geological Survey. The Around you list ranks what is near your place by how serious it is, from storms and fires to quakes, disaster alerts and aurora, and every entry names where it came from and when that was current. Hurricanes carry the National Hurricane Center's track and cone; aurora carries NOAA's Kp index and your chance of seeing it. Fire points are heat signals picked up from orbit, not confirmed wildfires. Aircraft appear over six cities only (Pune, Tokyo, Sydney, London, New York and Tromso), drawn in the sky as 3D airliners. Before you rely on any of this, read ${a("about/index.html#limits", "what the app does not do")}.</p>
<h2>${count}</h2>
<p>The page ${a(SATCOUNT_FILE, "How many satellites are in orbit?")} counts only the active satellites in our feed and is rebuilt when new satellite data arrives${hub}. The "tracked objects" tile in the app gives a larger number, because it counts everything the feed holds, rocket bodies and debris included.</p>
<h2>${free}</h2>
<p>Using the app costs nothing, and its code is published on GitHub for anyone to read and reuse, under the MIT licence. The data comes from public agencies and projects: CelesTrak for orbits, the U.S. Geological Survey for earthquakes, NOAA for space weather and hurricanes, NASA FIRMS for fires, GDACS for floods and volcanoes, MET Norway for cloud forecasts, adsb.lol for aircraft and The Space Devs for launches. Every card names its source, and the Data status screen tells you how recently each feed was confirmed current. The ${a("about/index.html", "About page")} lists every source, and ${a("methods/index.html", "How we know")} sets out the checks behind the reference pages.</p>
<!-- the count page and the country hub are not repeated here: the row of live pages above links them -->
<nav class="home-links" aria-label="More pages">
<ul>
<li>${a("guides/index.html", "Guides to the data")}</li>
<li>${a("about/index.html", "About Radar Around You")}</li>
<li>${a("methods/index.html", "How we know")}</li>
</ul>
</nav>
</div>
</section>`;
}

// Overrides for the template's full-screen rules, for the content-site build only. The template says html, body { overflow: hidden };
// here the document scrolls (with no visible scrollbar, so the first screen keeps its exact width) while the app stays fixed beneath.
// The globe keeps the wheel and touch: its canvas cancels wheel scrolling and the app is touch-action: none. Sheets and lists inside
// the app scroll on their own and must not drag the page behind them, hence overscroll-behavior: contain.
// The template's body is overflow: hidden with overscroll-behavior: none, which makes it a scroll container that stops the wheel from
// passing on to the page, so a wheel over the section would not scroll; overflow: visible on body here lets it through.
// The read-more link: hidden on phones (they reach the text from the About sheet); from 700px to 899px wide the bottom of the screen is
// the full-width tab bar with the layer chips above it, so the link sits at the right end of the place chip row, which is empty there;
// from 900px the tab bar is a centred pill and the bottom left is free, so the link sits there, level with the tab bar. It hides while
// the app is loading (the loader still has its .orb) or a sheet or the search is open.
// When the app cannot start, the link and a scrollbar are the way to the text, at every width: WebGL failed (src/main.js puts #nogl in
// the loader) or JavaScript is off (then the noscript block's div is parsed as an element; with scripting on it is plain text).
// Red light mode tints the app through a veil inside #app; the text sits above #app, so it gets the same veil of its own.
// Printing shows the text only.
export const HOME_TEXT_CSS = `
  html { overflow-y: auto; scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; }
  body { height: auto; overflow: visible; }
  #app * { overscroll-behavior: contain; }
  .home-spacer { height: 100vh; pointer-events: none; }
  .home-top:focus, .home-text:focus { outline: none; }
  .home-text { position: relative; z-index: 2; background: var(--ink-2); border-top: 1px solid var(--line-2); color: var(--text); font: 400 17px/1.65 var(--f-body);
    padding: 28px max(16px, env(safe-area-inset-right, 0px)) calc(56px + var(--safe-b)) max(16px, env(safe-area-inset-left, 0px)); user-select: text; -webkit-user-select: text; }
  .home-inner { max-width: 70ch; margin: 0 auto; }
  .home-text h1 { margin: 0 0 14px; font: 700 clamp(26px, 5vw, 34px)/1.15 var(--f-display); letter-spacing: -.015em; text-wrap: balance; }
  .home-text h2 { margin: 36px 0 10px; font: 700 24px/1.25 var(--f-display); letter-spacing: -.01em; }
  .home-strip dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 10px; margin: 0 0 12px; }
  .home-strip dl > div { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; }
  .home-strip dl > div:last-child { grid-column: 1 / -1; }
  .home-strip dt { font: 500 13px/1.35 var(--f-body); color: var(--muted); }
  .home-strip dd { margin: 4px 0 0; font: 600 20px/1.3 var(--f-display); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .home-strip-note, .home-strip-status { font-size: 14px; color: var(--muted); }
  .home-live-links ul { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; list-style: none; font-size: 15px; }
  .home-text p { margin: 0 0 14px; }
  .home-text a { color: var(--ion); text-underline-offset: 3px; }
  .home-lead { font-size: 18px; color: var(--text); }
  .home-back { margin-bottom: 20px; font: 500 14px/1.4 var(--f-body); }
  .home-links ul { display: flex; flex-wrap: wrap; gap: 10px 22px; margin: 36px 0 0; padding: 18px 0 0; border-top: 1px solid var(--line); list-style: none; font-size: 15px; }
  .home-more { display: none; z-index: 1; height: 36px; padding: 0 14px; border-radius: 18px; align-items: center; font: 500 13px/1 var(--f-body); color: var(--text); text-decoration: none; white-space: nowrap;
    background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(1.25); -webkit-backdrop-filter: blur(16px) saturate(1.25); }
  @media (min-width: 700px) { .home-more { display: inline-flex; position: fixed; top: calc(62px + var(--safe-t)); right: 16px; } }
  @media (min-width: 900px) { .home-more { top: auto; right: auto; left: 16px; bottom: calc(21px + var(--safe-b)); } }
  body:has(#loader > .orb):not(:has(noscript > div)) .home-more, body:has(#sheet:not([hidden])) .home-more, body:has(#searchPanel:not([hidden])) .home-more { visibility: hidden; }
  body:has(#nogl) .home-more, body:has(noscript > div) .home-more { display: inline-flex; position: fixed; top: auto; right: auto; left: 16px; bottom: calc(16px + var(--safe-b)); }
  html:has(#nogl), html:has(noscript > div) { scrollbar-width: thin; }
  #sheet .overview a { color: var(--ion); }
  html.night .home-text::after, html.night .home-more::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(255, 24, 0); mix-blend-mode: multiply; pointer-events: none; }
  @media print { html { overflow: visible; } #app, .home-spacer, .home-more { display: none !important; } .home-text { position: static; border: 0; } }
`;

// What wrapApp adds: the style block (it lands in <head> after the template's own styles, so it wins); just before the app, a focus
// target for the top of the page and the read-more link, so the link comes first in the tab order; and at the end of the page a
// one-screen spacer, the section and a small script.
export const HOME_STYLE = `<style id="home-text-css">${HOME_TEXT_CSS}</style>\n`;
export const HOME_PRE_APP = `<span id="top" class="home-top" tabindex="-1"></span>\n<a class="home-more" href="#${HOME_ID}">What is this? Read more</a>\n`;
// The script. Focus moving into the app (Tab, Shift+Tab, a click) brings the first screen back, so focus is never left under the opaque
// section. "Back to the globe" returns focus to the top target. The wheel: with the document scrollable, a wheel over the app's controls
// (tab bar, top bar, chips) would scroll the page towards the text, so a wheel on #app is cancelled unless an element between the
// target and #app can still scroll that way (a sheet, the search results, a card), so those scroll as before. The canvas has its own
// listener that zooms. With the page already scrolled down, a wheel up over the app's controls scrolls it back (over the globe the
// wheel zooms instead). Ctrl with the wheel is the browser's own zoom and is left alone, and so is everything when 3D could not start.
// Wheel events over the section itself never reach #app and scroll the page as usual.
export const HOME_SCRIPT = `<script id="home-wheel">(function () {
  var app = document.getElementById("app"), mark = document.getElementById("top"); if (!app) return;
  app.addEventListener("focusin", function () { if (window.scrollY) window.scrollTo(0, 0); });
  document.addEventListener("click", function (e) { if (mark && e.target.closest && e.target.closest('a[href="#top"]')) setTimeout(function () { mark.focus({ preventScroll: true }); }, 0); });
  app.addEventListener("wheel", function (e) {
    if (e.ctrlKey || document.getElementById("nogl")) return;
    var x = Math.abs(e.deltaX) > Math.abs(e.deltaY), d = x ? e.deltaX : e.deltaY;
    if (!x && d < 0 && window.scrollY > 0) return;
    for (var el = e.target; el && el !== app; el = el.parentElement) {
      var o = getComputedStyle(el)[x ? "overflowX" : "overflowY"], pos = x ? el.scrollLeft : el.scrollTop, max = x ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      if ((o === "auto" || o === "scroll") && max > 0 && (d < 0 ? pos > 0 : pos < max - 1)) return;
    }
    e.preventDefault();
  }, { passive: false });
})();</script>\n`;
// The strip's script (site/home-strip.mjs) follows the wheel script, after the section, so the strip exists when it runs.
export const homeBodyHtml = ({ countryHub = false } = {}) =>
  `<div class="home-spacer" aria-hidden="true"></div>\n${homeTextHtml({ countryHub })}\n${HOME_SCRIPT}${STRIP_SCRIPT}`;
