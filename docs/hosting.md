# Hosting on Hostinger Business Web Hosting

What is checked and what is not, so nobody has to guess later. Read on 2026-10-05 from Hostinger's own documentation:
`docs.hostinger.com/node.js/creating-an-app` and `docs.hostinger.com/node.js/github`.

## What Hostinger's Web Apps feature does (from its documentation)
- Plan requirement: "A plan that supports Node.js apps in the panel: Business Web Hosting, or Cloud Startup / Professional / Enterprise / Enterprise Plus." Each plan includes a limited number of Web Apps.
- GitHub deployment works with public and private repositories. Every push to the connected branch triggers a deployment; only one deployment runs at a time per site and further pushes queue up.
- Settings: framework preset (or "Other"), branch, Node.js version (18, 20, 22 default, or 24), build command from `package.json` scripts, package manager (npm default), output directory (required for static front ends), environment variables (injected into build and runtime, kept across deployments).
- Static front ends are served from `~/domains/<domain>/public_html`. Hostinger generates an `.htaccess` there and says it is regenerated on every redeploy and should not be edited by hand.

## What this project needs
- Build command: `npm run build:hosting` (runs `npm run build`, then `npm run site`). Tested from a clean clone of the repository: install about 2 seconds, build about 2 seconds, 111 pages, 8.6 MB (at that time; on 2026-10-05 after the About page `npm run site` printed 113 pages: 112 static pages plus the app as `index.html`).
- Output directory: `dist/site`.
- Environment variable: `SITE_URL`, the final address, for example `https://example.org`. Without it the canonical links and sitemap use a guess at a GitHub Pages address. The build stops with a message if the value is not a plain `https` address in lowercase (no spaces, login, query or fragment); trailing slashes are removed. This guards against a typing slip such as a stray character in front of `https`, which would otherwise put wrong canonical links on every page without any error.
- Environment variable: `SITE_NOINDEX`, set to `1` only for a temporary address that must not be indexed (see "Testing on a temporary address" below). Leave it out or set `0` for an indexable site; zeninnov8.com is built with `0` since 2026-10-05. Only `1` turns it on and only `0` or nothing turns it off; any other value stops the build with a message, so a typo cannot quietly decide this.
- Node.js 22 (the version the project was built and tested with).

## Steps (the exact button names in hPanel were not checked)
1. Add the new domain as a website in the same plan. Do not use the aaxonix.com site.
2. Turn on a free HTTPS certificate for it. The camera, motion sensors and app install need `https://`.
3. Create a Web App for that website from GitHub: pick this repository and the `main` branch, set the build command, output directory and `SITE_URL` as above.
4. Open the site and check the pages: `/`, `/moon-phases/`, `/constellations/cru/`, `/sitemap.xml`.

## Testing on a temporary address
The first test site is `https://zeninnov8.com`, at the root of that domain, to be replaced by a new domain once the test succeeds. Set these two environment variables on the Web App:

| Variable | Value while testing | Value at launch |
| --- | --- | --- |
| `SITE_URL` | `https://zeninnov8.com` | the final address, no trailing slash |
| `SITE_NOINDEX` | `0` (since 2026-10-05, indexable) | `0` or not set |

With `SITE_NOINDEX=1` the build changes only what crawlers are told:
- every page, and the app page, carries `<meta name="robots" content="noindex,nofollow">` instead of `index,follow,max-image-preview:large`;
- `robots.txt` says `User-agent: *` and `Disallow: /`, with no `Sitemap:` line;
- `sitemap.xml` and `sitemap-live.xml` are not written, because a sitemap lists pages for search engines and would contradict the page tags (the live page's GitHub build, `site/build-live.mjs`, also writes no `sitemap-live.xml` and removes an old one);
- `llms.txt` is not written either.

The pages, links and canonical addresses are otherwise identical, and the build prints `NOINDEX IS ON` so it shows in the build log. The unit tests (`test/site.test.js`) check that a normal build is unchanged, that a noindex build has no indexable page, and that a bad value stops the build.

NOT CONFIRMED: how every search engine treats a page that is both blocked in `robots.txt` and marked noindex. My understanding is that a crawler that obeys `robots.txt` never fetches the page, so it never reads the tag, and that such an address can in rare cases still be listed by its bare address if other sites link to it. Verify this in the current documentation of each search engine you care about before relying on it. For a brand new test site that nobody links to, the practical risk is low, but it is not zero.

Notes on the Hostinger form (read from its screens on 2026-10-05): the "Set environment variables" dialog says the variables are applied during the build; the Key box accepts only uppercase letters, numbers and underscores and shows its own error otherwise; the Value box keeps what you type. The "Review build settings" screen only says "Custom" and "Added: 2", so open Change and Edit to read the real values before pressing Deploy. In the Build and output dialog the Entry file stays empty because this is a static site.

Moving to the final domain:
1. Add the new domain as a website, turn on its HTTPS certificate, create its Web App from the same repository and branch.
2. Set `SITE_URL` to the new address and do not set `SITE_NOINDEX`.
3. After the first deployment open `/robots.txt` (it should say `Allow: /` and name both sitemaps), open `/sitemap.xml` and `/sitemap-live.xml` (the live satellite count page's own sitemap, written only when the site is indexable), and view the source of any page to confirm the robots tag reads `index,follow,max-image-preview:large`.
4. If the site moves to another domain, take zeninnov8.com down, redirect it, or set its `SITE_NOINDEX=1`, so two copies of the content are not both open to search engines.

## IndexNow key (`site/indexnow.key`)
The file holds one random 32-character hexadecimal key, generated on 2026-10-06. It is public on purpose and is not a secret: the site serves it as `/<key>.txt` so a search engine that receives an IndexNow ping can check that the sender owns the site. It proves ownership and opens nothing, so committing it does not break the rule against secrets in the repository. Anyone who reads it could at most send pings for this site's own addresses, and the engines decide what to do with a ping. To change the key, replace the file with a new random key (8 to 128 letters, digits and dashes, per the IndexNow documentation read on 2026-10-06) and redeploy; to turn IndexNow off, delete the file. `site/indexnow.mjs` reads it and stops the build if the file exists but does not hold exactly one valid key.

## What the first deployment taught us
The first deployment on zeninnov8.com showed the loader ("Starting up") and never started. Cause, reproduced in a browser with the exact deployed files: the app page was a bare HTML fragment with no doctype and no character encoding, because the places it was first published (the artifact viewer and the test harness) wrap it themselves. Hostinger serves the file as `text/html` with no charset, so the browser read it as `windows-1252`, which garbled a regular expression in the script into a syntax error, and the script did not run. The site build now writes `index.html` as a complete document (doctype, `<meta charset="utf-8">`, viewport, language, and the title and search tags in `<head>`). `test/site.test.js` checks that every page does this, and `npm run e2e:site` loads the built site in Chromium served raw with no charset and an html 404 page for the missing live folder, which is how the host behaves. That test fails on the old output and passes on the new.

## Not yet known
- RESULT on 2026-10-05: a redeploy DOES clear the extra folders. A test file `public_html/live/probe.txt` was served (200) before the push, and was gone (404) 14 seconds after the push that triggered the redeploy, and still gone 20 seconds later. So `live/` is wiped on every deployment. The copy script copes without any change: `radar_sync` recreates the folder and downloads every file the manifest names that is not on disk, even when the remote manifest has not changed, and writes `manifest.json` last, so no visitor meets a manifest that points at missing data (tests in `hosting/tests/run.php`, 'a redeploy of the site wipes live/'). The live data is therefore back within one cron interval, about ten minutes, after each deployment; until then the app uses its bundled snapshot, as it does whenever `live/manifest.json` is missing (`npm run e2e:site` serves exactly that case). NOT CONFIRMED: whether a deployment also clears folders outside `public_html` (for example the folder holding the cron scripts and the token file), and whether it clears everything in `public_html` that the build does not produce; the second is my reading of this one result, not documented behaviour. Check the first after the cron scripts are uploaded and one more deployment has run.
- Observed on https://zeninnov8.com on 2026-10-05 (the generated `.htaccess`): `.json` is served as `application/json`, `.bin` as `application/octet-stream`, `sw.js` as `application/x-javascript` with `cache-control: public, max-age=604800` (seven days), and `manifest.webmanifest` as `text/plain`, not as a web app manifest type. Data files carry no cache lifetime, only ETag and Last-Modified; the app fetches the live manifest with `no-store` and the feed files sit in versioned folders. NOT CONFIRMED: whether Chrome and Safari still offer to install the app with the manifest sent as `text/plain` (test on a real phone), and whether a browser picks up a new `sw.js` promptly given the seven day lifetime.
- Python: Hostinger support (an assistant answer pasted in the project chat on 2026-10-05) says Business Web Hosting does not support Python, even a plain script run by cron; cron itself is unlimited and supports custom commands, best used for PHP. So the collector runs on GitHub and two PHP cron jobs connect it to the site: see `hosting/README.md`.
- Plan limits on CPU and memory shared by all websites on the account.
