<?php
// Copies the collector's finished data from GitHub into the site's live/ folder. Run by cron every 10 minutes:
//   php /home/USER/radar-tools/pull.php --dest=/home/USER/domains/YOURDOMAIN/public_html/live
// Optional: --base=https://.../  (default: the data branch of the Radar-around-you repository)  --log=/home/USER/radar-tools/pull.log
require __DIR__ . '/lib.php';
$o = getopt('', ['dest:', 'base::', 'log::']);
if (empty($o['dest'])) {
    fwrite(STDERR, "usage: php pull.php --dest=/path/to/live [--base=https://...] [--log=/path/pull.log]\n");
    exit(2);
}
$r = radar_sync(isset($o['base']) && $o['base'] !== false ? $o['base'] : RADAR_DEFAULT_BASE, $o['dest'], null, isset($o['log']) && $o['log'] !== false ? $o['log'] : null);
exit($r['ok'] ? 0 : 1);
