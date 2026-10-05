# Radar Around You: instructions for Claude Code

A free, global, real-time 3D web tool: satellites and the ISS above you, the sky tonight, quakes under you, hazards around you. Personal side project, budget about 500 rupees a month, aiming to be the most helpful astronomy resource and to rank in search. Read `docs/handoff.md` first: it holds the current state, what is done, what is open and what is unverified.

## How the owner wants work done (standing rules)
- Plain, human tone. No em dashes and no emoji, in chat, code comments, docs and commit messages.
- Never state a guess as a fact. Flag any number you are not sure of and say how to verify it. Never invent sources, URLs, function names or API syntax; if unsure, say so and check the current documentation.
- Data must come from the source feeds, not from model memory. Every figure shown to users needs a verified source recorded in `docs/` (see `docs/star-sources.md` for the pattern: what was read, when, and what is NOT CONFIRMED).
- Ask a clarifying question instead of assuming, and state the plan before building.
- Code follows best practice, is unit tested and regression tested, and must not break other code. Run the whole test set before committing.
- Push only after the browser tests pass. Commit messages end with the attribution lines the harness gives.
- Never ask for, accept or store passwords. Tokens and secrets never go in the repository (`hosting/radar-config.php` is ignored on purpose). The GitHub token for the server must be fine-grained, one repository, Actions read and write only.

## Commands
| Command | What it does | Last known result |
| --- | --- | --- |
| `npm test` | unit tests (`test/*.test.js`) | 324 pass (macOS, Node 24, 2026-10-05) |
| `npm run test:pipeline` | Python collector tests | 175 run, 3 skipped, none failed (macOS). The 3 skipped need raw downloads that are not in the repository (`raw/`, `raw2/` are ignored). The cloud note said 177; why the counts differ is NOT CONFIRMED. |
| `npm run test:hosting` | PHP checks for the server scripts (needs `php`) | 131 pass (macOS with PHP 8.5.11 from Homebrew on 2026-10-05; 92 passed before the pages option was added, on the cloud and the Mac, and 125 before the page paths were narrowed to the two live files). On PHP 8.5 it prints a deprecation notice for `$http_response_header` in `hosting/lib.php` line 41; the server runs PHP 8.3.33 where it is silent. |
| `npm run e2e` | snapshot build in Chromium, phone and desktop | 286 pass, no console errors (macOS, Chromium 153) |
| `npm run e2e:live` | live-mode states in Chromium | 112 pass. One run on the same code failed 9 checks (the page stayed on the snapshot) and the rerun passed; not diagnosed. |
| `npm run e2e:site` | the built content site served raw, as a web host serves it | 17 pass (macOS, 2026-10-05) with only `SITE_URL=https://zeninnov8.com` set (the production setting, indexable since 2026-10-05) and 17 with `SITE_NOINDEX=1` added (the noindex build). Without `SITE_URL` the canonical check fails, because the default address has a path. |
| `npm run build:hosting` | what Hostinger runs: app plus content site into `dist/site` | |

First time on a machine: `npm ci`, then `npx playwright install chromium` (the harness uses the project's own Playwright and falls back to the cloud container's copy). The browser suites take roughly 10 to 15 minutes each on a software renderer. Delete old output before a run, never run two suites at once, and close other heavy programs first: on this Mac a load average above about 10 made pages take over 60 seconds to start and failed the suite at its 60 second waits. Test pages must be closed when their checks are done, because open pages keep drawing and starve the next one.

## Working here
- Local folder is `/Users/Amit/Radar Near You/Radar-around-you`. The space in the name is why paths in scripts must come from `fileURLToPath`, not `new URL(...).pathname` (fixed in the files that had it).
- `gh` is logged in on the owner's Mac (HTTPS, scopes repo, workflow, read:org, gist). It can start and read Actions runs. Commits in this repository use the owner's GitHub no-reply address as author, set for this repository only.
- Browser-pane and Chrome sessions are not the same login as `gh`: being signed in to GitHub in a browser does not let git push.

## Layout
`src/` app (three.js, bundled by esbuild); `site/` content-page generator (`SITE_URL`, `SITE_NOINDEX`); `pipeline/` Python collector; `hosting/` PHP glue for Hostinger (`pull.php`, `trigger.php`); `test/`, `e2e*.mjs`, `harness.mjs` tests; `docs/` source verification records and hosting notes; `public/` data files the app loads. `site/satcount.mjs`, `site/pages-satcount.mjs` and `site/build-live.mjs` make the live satellite count page (see `docs/superpowers/specs/2026-10-05-satellite-count-page-design.md`); GitHub builds it into the data branch's pages/ folder and `hosting/pull.php --pages-dest` copies it to the site. `site/pages-about.mjs` and `site/llms.mjs` make the About page and llms.txt; every statement on the About page is traced in `docs/about-sources.md`.
