// The text section on the home page: plain, visible answers to the questions people bring to the app, placed below the first screen
// and over the fixed 3D app, so the first screen stays exactly as it is. Only the content-site build adds it (wrapApp in build.mjs);
// the app bundle and template.html do not change. Every statement is traced in docs/home-sources.md. No hidden text, no counts that
// go stale (the count page has them), no FAQ markup, and no wording copied from the About page or the count page.
import { esc, href } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";

export const HOME_ID = "about-home";
// The satellites by country hub is built on its own branch; the section links it only when the build has the page.
export const COUNTRY_HUB_FILE = "satellites-by-country/index.html";
const go = (to) => { const [file, frag] = to.split("#"); return href("index.html", file) + (frag ? `#${frag}` : ""); };
const a = (to, text) => `<a href="${go(to)}">${esc(text)}</a>`;

// The questions, in order. Exported so the tests check the headings against one list.
export const HOME_QUESTIONS = [
  "Where is the International Space Station right now?",
  "Which satellites are above me?",
  "What is in the sky tonight?",
  "What is happening under my feet and around me?",
  "How many satellites are in orbit?",
  "Is it free, and where does the data come from?",
];

export function homeTextHtml({ countryHub = false } = {}) {
  const [iss, above, tonight, around, count, free] = HOME_QUESTIONS.map(esc);
  const hub = countryHub ? `, and ${a(COUNTRY_HUB_FILE, "satellites by country")} ranks their owners as the catalogue records them` : "";
  return `<section id="${HOME_ID}" class="home-text" aria-label="About this app">
<div class="home-inner">
<p class="home-back"><a href="#top">Back to the globe</a></p>
<p class="home-lead">The globe above is Radar Around You: a free 3D view of what is over a place you choose, what its sky holds tonight, and what is happening under and around it.</p>
<h2>${iss}</h2>
<p>Search for ISS and the globe turns to the station, drawing its orbit and the patch of Earth it can see. Its card gives its height, speed and the age of the orbit data, which comes from CelesTrak; positions are worked out on your device. For the ISS, other bright objects and satellites launched in the last 30 days, pass times come from SGP4, the model that kind of orbit data is made for. Other satellites use a faster, rougher approximation.</p>
<h2>${above}</h2>
<p>Choose a place: any town or city of about 15,000 people or more, or your device's own position, which never leaves the device. A tile at the top then says how many satellites are above that place now, and the Sky view draws them across your horizon, flashing when sunlit. Tap one for its name, how high it is, which way to face and how far away it is. Starlink strings, lines of satellites from one recent launch, have their own sheet saying when one can be seen from your place.</p>
<h2>${tonight}</h2>
<p>The Tonight button gives one verdict for your place from the Moon, the dark hours, the chance of aurora and, in the six cities that have one, the cloud forecast. Below it is a timeline of visible ISS and satellite passes, Starlink strings, planets and meteor showers near their peak, each with Show me, which turns the Sky view to it, and Remind me, a calendar entry. The Sky view is a first-person sky for any place, with the Moon and its phase, the planets, the officially named stars, the constellation figures and a slider through the night. A sky calendar looks 90 days ahead at Moon phases, eclipses, planet events and meteor showers.</p>
<h2>${around}</h2>
<p>The Under view slices the Earth open from an earthquake to you, through crust, mantle and core, and sends the P and S waves on their way to you: a teaching model fed by earthquakes from the U.S. Geological Survey. The Around you list gathers the storms, fires, hazards, quakes and aurora near your place, most serious first, each with its source and an "as of" time. Hurricanes come with the National Hurricane Center's forecast track and cone, and the aurora screen shows NOAA's Kp index and your chance of seeing it. A fire detection is a heat signal seen from orbit, not a confirmed wildfire. Aircraft appear over six cities only (Pune, New York, London, Tromso, Tokyo and Sydney), as 3D airliners in the sky. Before you rely on any of this, read ${a("about/index.html#limits", "what the app does not do")}.</p>
<h2>${count}</h2>
<p>That question has its own page, ${a(SATCOUNT_FILE, "How many satellites are in orbit?")}, which counts the active satellites in our feed and is rebuilt after each data collection. The "tracked objects" tile in the app is a different number: it counts everything in the feed, debris included${hub}.</p>
<h2>${free}</h2>
<p>It is free to use, and its code is open source under the MIT licence. The data comes from public agencies and projects: CelesTrak for orbits, the U.S. Geological Survey for earthquakes, NOAA for space weather and hurricanes, NASA FIRMS for fires, GDACS for floods and volcanoes, MET Norway for cloud forecasts, adsb.lol for aircraft and The Space Devs for launches. Every card names its source, and the Data status screen shows when each feed was last updated. The ${a("about/index.html", "About page")} lists every source, and ${a("methods/index.html", "How we know")} sets out the checks behind the reference pages.</p>
<nav class="home-links" aria-label="More pages">
<ul>
<li>${a("guides/index.html", "Guides to the data")}</li>
<li>${a("about/index.html", "About Radar Around You")}</li>
<li>${a(SATCOUNT_FILE, "How many satellites are in orbit")}</li>${countryHub ? `\n<li>${a(COUNTRY_HUB_FILE, "Satellites by country")}</li>` : ""}
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
// The read-more link: hidden on phones (they reach the text from the About sheet); from 700px to 899px wide the bottom of the screen is
// the full-width tab bar with the layer chips above it, so the link sits at the right end of the place chip row, which is empty there;
// from 900px the tab bar is a centred pill and the bottom left is free, so the link sits there, level with the tab bar.
// Red light mode tints the app through a veil inside #app; the text sits above #app, so it gets the same veil of its own.
export const HOME_TEXT_CSS = `
  html { overflow-y: auto; scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; }
  body { height: auto; }
  #app * { overscroll-behavior: contain; }
  .home-spacer { height: 100vh; pointer-events: none; }
  .home-text { position: relative; z-index: 2; background: var(--ink-2); border-top: 1px solid var(--line-2); color: var(--text); font: 400 17px/1.65 var(--f-body);
    padding: 28px max(16px, env(safe-area-inset-right, 0px)) calc(56px + var(--safe-b)) max(16px, env(safe-area-inset-left, 0px)); user-select: text; -webkit-user-select: text; }
  .home-inner { max-width: 70ch; margin: 0 auto; }
  .home-text h2 { margin: 36px 0 10px; font: 700 24px/1.25 var(--f-display); letter-spacing: -.01em; }
  .home-text p { margin: 0 0 14px; }
  .home-text a { color: var(--ion); text-underline-offset: 3px; }
  .home-lead { font-size: 18px; color: var(--text); }
  .home-back { margin-bottom: 20px; font: 500 14px/1.4 var(--f-body); }
  .home-links ul { display: flex; flex-wrap: wrap; gap: 10px 22px; margin: 36px 0 0; padding: 18px 0 0; border-top: 1px solid var(--line); list-style: none; font-size: 15px; }
  .home-more { display: none; z-index: 1; height: 36px; padding: 0 14px; border-radius: 18px; align-items: center; font: 500 13px/1 var(--f-body); color: var(--text); text-decoration: none; white-space: nowrap;
    background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(1.25); -webkit-backdrop-filter: blur(16px) saturate(1.25); }
  @media (min-width: 700px) { .home-more { display: inline-flex; position: fixed; top: calc(62px + var(--safe-t)); right: 16px; } }
  @media (min-width: 900px) { .home-more { top: auto; right: auto; left: 16px; bottom: calc(21px + var(--safe-b)); } }
  body:has(#loader) .home-more, body:has(#sheet:not([hidden])) .home-more, body:has(#searchPanel:not([hidden])) .home-more { visibility: hidden; }
  #sheet .overview a { color: var(--ion); }
  html.night .home-text::after, html.night .home-more::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(255, 24, 0); mix-blend-mode: multiply; pointer-events: none; }
`;

// What wrapApp adds: the style block (it lands in <head> after the template's own styles, so it wins) and, at the end of the page,
// a one-screen spacer, the section and the read-more link. The spacer carries id="top" so "Back to the globe" scrolls to the start.
export const HOME_STYLE = `<style id="home-text-css">${HOME_TEXT_CSS}</style>\n`;
export const homeBodyHtml = ({ countryHub = false } = {}) =>
  `<div id="top" class="home-spacer" aria-hidden="true"></div>\n${homeTextHtml({ countryHub })}\n<a class="home-more" href="#${HOME_ID}">What is this? Read more</a>\n`;
