<?php
// Copies the collector's finished data from GitHub into the site's live/ folder. Run by cron every 10 minutes:
//   php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live --pages-dest=/home/USER/domains/YOURDOMAIN/public_html
// Optional: --base=https://.../  (default: the data branch of the Radar-around-you repository)  --log=/home/USER/radar-tools/pull.log
//           --pages-dest=<the site's public folder>  also copies the finished pages (the satellite count page, the satellites by country pages and their sitemap).
//           With --pages-dest, the pages that changed are then pinged to IndexNow (at most once every 6 hours each; the throttle state is
//           indexnow.json next to the log, so this needs --log). --no-indexnow turns the pings off. The exit code never depends on them.
require __DIR__ . '/lib.php';
$o = getopt('', ['dest:', 'base::', 'log::', 'pages-dest::', 'no-indexnow']);
if (empty($o['dest'])) {
    fwrite(STDERR, "usage: php pull.php --dest=/path/to/live [--pages-dest=/path/to/site] [--base=https://...] [--log=/path/pull.log] [--no-indexnow]\n");
    exit(2);
}
$base = isset($o['base']) && $o['base'] !== false ? $o['base'] : RADAR_DEFAULT_BASE;
$logFile = isset($o['log']) && $o['log'] !== false ? $o['log'] : null;
$r = radar_sync($base, $o['dest'], null, $logFile);
$ok = $r['ok'];
if (isset($o['pages-dest']) && $o['pages-dest'] !== false && $o['pages-dest'] !== '') {
    $p = radar_sync_pages($base, $o['pages-dest'], null, $logFile);
    $ok = $ok && $p['ok'];
    radar_pull_indexnow($p, $o['pages-dest'], $logFile, isset($o['no-indexnow']));  // logs one line; its result never changes $ok
}
exit($ok ? 0 : 1);
