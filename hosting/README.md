# Keeping live data fresh on Hostinger Business Web Hosting

Hostinger's support says Business Web Hosting does not support Python, even a plain script run by cron. The collector is Python, so it runs on GitHub's machines. Two small PHP jobs, which cron does support, connect it to your site.

```
your cron (every 10 min) -- trigger.php --> GitHub starts the collector (Actions) --> data branch
your cron (every 10 min) -- pull.php -----> copies the finished files into  <your site>/live/
visitors' browsers read <your site>/live/manifest.json and the files it names
```

Why not rely on GitHub's own schedule: on 2026-10-05 the repository's every-10-minutes schedule ran twice in about five hours. Your server's cron keeps time.

## One-time setup
1. **Secret for the collector.** On GitHub: the repository, Settings, Secrets and variables, Actions, New repository secret. Name `CONTACT_EMAIL`, value a real address (CelesTrak and MET Norway ask callers to identify themselves; it is sent in a header and not published).
2. **A token that can only start the collector.** GitHub, your profile, Settings, Developer settings, Personal access tokens, Fine-grained tokens. Repository access: only `Radar-around-you`. Permission: Actions, Read and write. Nothing else. Choose an expiry and put a reminder in your calendar; when it expires the trigger log will say so.
3. **Upload three files** from this folder (`lib.php`, `pull.php`, `trigger.php`) to a folder that is not inside any website, for example `~/radar-tools/`. Copy `radar-config.example.php` to `~/radar-tools/radar-config.php` there and paste the token in. Never place the config inside `public_html`, and never commit it.
   To keep the token out of the screen, the chat and the shell history, over SSH wait for the server prompt, paste this one line, wait for "Paste the token", then paste the token (nothing shows) and press Enter. It writes the file readable only by you:
   `read -rsp "Paste the token, then press Enter: " T; echo; umask 077; printf "<?php\nreturn [\n    'token'    => '%s',\n    'owner'    => 'amitvprabhu-lang',\n    'repo'     => 'Radar-around-you',\n    'workflow' => 'live-data.yml',\n    'ref'      => 'main',\n];\n" "$T" > ~/radar-tools/radar-config.php; unset T; chmod 600 ~/radar-tools/radar-config.php; php -l ~/radar-tools/radar-config.php`
4. **Two cron jobs** (hPanel, Advanced, Cron Jobs. On the owner's account this page is under a regular site, not under the Node Web App `zeninnov8.com`, which has no such page. Use the Custom mode and the full command; times are UTC, which does not matter for every-10-minutes). Check the PHP version first with `php -v` over SSH or in hPanel; the code needs PHP 7.4 or newer and the `curl` extension or `allow_url_fopen`.
   - `php /home/USER/radar-tools/trigger.php --config=/home/USER/radar-tools/radar-config.php --log=/home/USER/radar-tools/trigger.log`
   - `php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live --pages-dest=/home/USER/domains/YOURDOMAIN/public_html --log=/home/USER/radar-tools/pull.log`
   `--pages-dest` also copies the finished pages (the satellite count page and its sitemap) from the data branch's pages/ folder; leave it out and only the data files are copied.
   Offset them by a few minutes (for example trigger at :00, :10, ... and pull at :04, :14, ...) so the pull usually finds data the collector has just published.
5. **Check:** after the first run read both logs. `trigger.log` should say "collector started". `pull.log` should say "ok" and `live/manifest.json` should exist on the site. Open the site: the Data tile should change from "Snapshot" to "Live".

## What to expect, and not
- The first collector run builds the satellite catalogue (about 50 requests to CelesTrak). It ran for real on 2026-10-05 and took 4 minutes 13 seconds; later runs restore the catalogue from the `data` branch and took about 1 minute 8 seconds.
- Data reaches visitors about 10 to 25 minutes after the source publishes it: the collector's own schedule, GitHub's 5-minute cache on raw files, your pull, and the app's 5-minute check. Fires and some others are slower at the source.
- If a pull fails halfway, the old manifest stays, so visitors never get a manifest that points at missing files. Old versions are removed one run after they stop being current.
- **Tested on 2026-10-05:** a redeploy of the Web App clears the `live/` folder (a test file was served before and was gone 14 seconds after the push). The next `pull.php` run puts everything back, because it downloads every file the manifest names that is missing; see `docs/hosting.md`.
- **Unknown until tested on your account:** whether a deployment also clears folders outside `public_html` (keep the scripts and the token file there and check after the next deployment), whether cron can run PHP at the interval you set, and how GitHub treats a workflow started every 10 minutes (it should only cost free minutes for a public repository; check GitHub's current billing page).

## Tests
`php hosting/tests/run.php` (about 125 checks, no network). `php hosting/tests/integration.php SOURCE DEST` copies a real collector output folder through the puller and compares every file. Both were run on PHP 8.3; nothing newer than PHP 7.4 syntax is used, but 7.4 itself was not available to run.
