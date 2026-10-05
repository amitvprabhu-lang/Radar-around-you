<?php
// Copies the collector's finished data from GitHub into the site's live/ folder. Run by cron every 10 minutes:
//   php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live --pages-dest=/home/USER/domains/YOURDOMAIN/public_html
// Optional: --base=https://.../  (default: the data branch of the Radar-around-you repository)  --log=/home/USER/radar-tools/pull.log
//           --pages-dest=<the site's public folder>  also copies the finished pages (the satellite count page and its sitemap).
require __DIR__ . '/lib.php';
$o = getopt('', ['dest:', 'base::', 'log::', 'pages-dest::']);
if (empty($o['dest'])) {
    fwrite(STDERR, "usage: php pull.php --dest=/path/to/live [--pages-dest=/path/to/site] [--base=https://...] [--log=/path/pull.log]\n");
    exit(2);
}
$base = isset($o['base']) && $o['base'] !== false ? $o['base'] : RADAR_DEFAULT_BASE;
$logFile = isset($o['log']) && $o['log'] !== false ? $o['log'] : null;
$r = radar_sync($base, $o['dest'], null, $logFile);
$ok = $r['ok'];
if (isset($o['pages-dest']) && $o['pages-dest'] !== false && $o['pages-dest'] !== '') {
    $p = radar_sync_pages($base, $o['pages-dest'], null, $logFile);
    $ok = $ok && $p['ok'];
}
exit($ok ? 0 : 1);
