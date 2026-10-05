# Design: original text on the home page

Status: written on 2026-10-05 after the owner's standing goal "finish everything and deploy". The owner asked for original, crawlable text on the home page that can rank for its own searches (not copied from anyone); the layout choices below are mine and are listed for the owner's review. Anything marked NOT CONFIRMED has not been checked.

## 1. Problem

The home page is the 3D app: `html, body { overflow: hidden }` and `#app { position: fixed; inset: 0 }`, so it cannot scroll and holds about 100 words of text outside scripts (the title, a description, structured data and a `<noscript>` paragraph). Search engines render the page and see an app shell. The owner wants the home page itself to carry real text for its own searches ("live satellite tracker", "satellites above me", "ISS location", "what is in the sky tonight") and a short pointer to the live count page.

## 2. Choice of layout

Rejected: hidden or visually hidden text (it breaks the house rule of no hidden text and is a search guideline risk); a collapsed section that opens on a tap (hidden at load); moving the app from `position: fixed` into the page flow (it would touch every overlay and the iOS viewport behaviour).

Chosen: leave the app exactly as it is and add a visible text section that sits below the first screen, in the document, over the fixed app. The first screen is unchanged; scrolling the page brings up an opaque text section that covers the app, like a sheet. Everything is added by the content-site builder (`site/build.mjs`, `wrapApp`), so the app bundle and the `npm run e2e` snapshot suites are untouched, except one small change in the app's About sheet.

How it works:
- A transparent spacer one screen tall (`pointer-events: none`) followed by `<section id="about-home">`, `position: relative` with a higher `z-index` than `#app` and an opaque background. The document scrolls (`html { overflow-y: auto }`, the scrollbar hidden, since the wheel and touch on the globe are the app's), the app stays fixed beneath.
- The globe keeps its gestures: the canvas already prevents wheel scrolling and has `touch-action: none`. Sheets inside the app scroll on their own, so `#app * { overscroll-behavior: contain }` stops them from scrolling the page behind.
- Users reach the text by a visible link, "What is this? Read more", fixed at the bottom left on wide screens, and by a link at the top of the app's About sheet (which also closes the sheet). Page Down, the space bar and the End key work too. A "Back to the globe" link at the top of the section scrolls to the top.
- Crawlers see the section in the HTML as visible, rendered text.

## 3. The text

About 500 to 700 words, original, in plain language, as `<h2>` questions with short answers, each statement traced in a new `docs/home-sources.md` to `README.md`, `docs/feature-sources.md`, `docs/about-sources.md` or the code. No volatile numbers (the count page has them), no statement that `docs/about-sources.md` does not already allow:

1. Where is the International Space Station right now? What the app shows for the ISS and how pass times are worked out, as far as the README says.
2. Which satellites are above me? Pick a place, the app lists what is overhead and shows it on the globe.
3. What is in the sky tonight? Moon, planets, bright stars and constellations, bright passes.
4. What is happening under my feet and around me? Earthquakes, aurora, storms, fires, and aircraft over six cities.
5. How many satellites are in orbit? Two sentences and a link to `/how-many-satellites-in-orbit/` (it counts active satellites; the app's tile counts every tracked object) and to `/satellites-by-country/`.
6. Is it free, and where does the data come from? Free, no ads, the named sources, a link to `/about/`.
7. A visible row of links to the guides, the About page, the count page and the country pages.

It must not repeat the About page's wording or the count page's text: each page answers its own question and links to the others.

## 4. Structured data and the rest

The existing `WebApplication` and `WebSite` JSON-LD stay. No FAQPage markup. The `<noscript>` paragraph stays (users without JavaScript still get the description and links). The section's headings do not duplicate the page title.

## 5. Tests

- Unit (`test/site.test.js`): the built home page contains `#about-home`, the headings, a minimum length, no hidden-text markup (`display:none`, `hidden`, `visually-hidden`, `font-size:0` on the section), the links resolve to built pages, house style (no em dashes, no emoji), no volatile numbers, the noscript block still ends with `</noscript>\n`.
- `e2e-site.mjs` (the raw built site in Chromium): on a phone-sized and a desktop-sized page: the section exists below the first screen and is not visible at load (its top is at or below the viewport height); the read-more link scrolls it into view (`scrollY` greater than zero, the section top within the viewport); "Back to the globe" returns `scrollY` to 0; a wheel event on the canvas still zooms and leaves `scrollY` at 0; the About sheet's link closes the sheet and scrolls.
- The existing `e2e`, `e2e:live` and `e2e:site` suites must stay green.

## 6. Risks

| Risk | Handling |
| --- | --- |
| The document scroll disturbs the globe on a phone | Touch on the canvas and the app is `touch-action: none` and the spacer ignores pointer events; the browser tests above check the wheel and the position |
| Overlays or sheets chain scrolling into the page | `overscroll-behavior: contain` on everything inside `#app` |
| A statement overstates the app | Every statement is traced in `docs/home-sources.md`; a reviewer checks them against the README and the code, as was done for the About page |
| The page was fast and full-screen and is now taller | Nothing is added to the app's own render path; the text is static HTML. The cost is one more block of HTML (about 5 KB) |
| Two pages compete for one query | The home page answers its own queries and links to the count page instead of repeating it |
