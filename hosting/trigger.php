<?php
// Asks GitHub to run the collector now. Run by cron every 10 minutes:
//   php /home/USER/radar-tools/trigger.php --config=/home/USER/radar-tools/radar-config.php
// The config file (see radar-config.example.php) holds a GitHub token and lives outside the website's public folder.
require __DIR__ . '/lib.php';
$o = getopt('', ['config:', 'log::']);
$log = isset($o['log']) && $o['log'] !== false ? $o['log'] : null;
if (empty($o['config']) || !is_file($o['config'])) {
    radar_log('no config file at ' . ($o['config'] ?? '(none given)'), $log);
    exit(2);
}
$cfg = include $o['config'];
$r = radar_trigger(is_array($cfg) ? $cfg : []);
radar_log($r['message'], $log);  // the message never contains the token
exit($r['ok'] ? 0 : 1);
