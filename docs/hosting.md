# Hosting on Hostinger Business Web Hosting

What is checked and what is not, so nobody has to guess later. Read on 2026-10-05 from Hostinger's own documentation:
`docs.hostinger.com/node.js/creating-an-app` and `docs.hostinger.com/node.js/github`.

## What Hostinger's Web Apps feature does (from its documentation)
- Plan requirement: "A plan that supports Node.js apps in the panel: Business Web Hosting, or Cloud Startup / Professional / Enterprise / Enterprise Plus." Each plan includes a limited number of Web Apps.
- GitHub deployment works with public and private repositories. Every push to the connected branch triggers a deployment; only one deployment runs at a time per site and further pushes queue up.
- Settings: framework preset (or "Other"), branch, Node.js version (18, 20, 22 default, or 24), build command from `package.json` scripts, package manager (npm default), output directory (required for static front ends), environment variables (injected into build and runtime, kept across deployments).
- Static front ends are served from `~/domains/<domain>/public_html`. Hostinger generates an `.htaccess` there and says it is regenerated on every redeploy and should not be edited by hand.

## What this project needs
- Build command: `npm run build:hosting` (runs `npm run build`, then `npm run site`). Tested from a clean clone of the repository: install about 2 seconds, build about 2 seconds, 111 pages, 8.6 MB.
- Output directory: `dist/site`.
- Environment variable: `SITE_URL`, the final address with no trailing slash, for example `https://example.org`. Without it the canonical links and sitemap use a guess at a GitHub Pages address.
- Node.js 22 (the version the project was built and tested with).

## Steps (the exact button names in hPanel were not checked)
1. Add the new domain as a website in the same plan. Do not use the aaxonix.com site.
2. Turn on a free HTTPS certificate for it. The camera, motion sensors and app install need `https://`.
3. Create a Web App for that website from GitHub: pick this repository and the `main` branch, set the build command, output directory and `SITE_URL` as above.
4. Open the site and check the pages: `/`, `/moon-phases/`, `/constellations/cru/`, `/sitemap.xml`.

## Not yet known
- Whether a redeploy clears the extra folders in `public_html`, where the live data would sit. Test: put a file in `public_html/live/`, redeploy, see if it is still there. If it is cleared, the live data must be served from somewhere a redeploy does not touch.
- Whether the generated `.htaccess` lets the manifest and `.webmanifest` files be served with the right type, and whether `live/manifest.json` can be kept from being cached for long. The app works without these; the risk is stale live data.
- Python: Hostinger support (an assistant answer pasted in the project chat on 2026-10-05) says Business Web Hosting does not support Python, even a plain script run by cron; cron itself is unlimited and supports custom commands, best used for PHP. So the collector runs on GitHub and two PHP cron jobs connect it to the site: see `hosting/README.md`.
- Plan limits on CPU and memory shared by all websites on the account.
