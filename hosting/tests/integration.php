<?php
// Copies a folder of real collector output through the puller as if it were the GitHub data branch, then checks every file arrived byte for byte.
//   php hosting/tests/integration.php /path/to/collector-output /path/to/empty-destination
require __DIR__ . '/../lib.php';
[$src, $dest] = [$argv[1] ?? '', $argv[2] ?? ''];
if (!is_dir($src) || $dest === '') { fwrite(STDERR, "usage: php integration.php SOURCE_DIR DEST_DIR\n"); exit(2); }
$base = 'https://data.example/';
$http = function ($url) use ($src, $base) {
    $rel = substr($url, strlen($base));
    $f = $src . '/' . $rel;
    return is_file($f) && strpos($rel, '..') === false ? ['status' => 200, 'body' => file_get_contents($f), 'error' => ''] : ['status' => 404, 'body' => '', 'error' => ''];
};
$r = radar_sync($base, $dest, $http);
$r2 = radar_sync($base, $dest, $http);   // a second run must change nothing
$m = radar_parse_manifest(file_get_contents($src . '/manifest.json'));
$bad = 0; $n = 0;
foreach (radar_wanted($m) as $path => $size) {
    $n++;
    if (!is_file("$dest/$path") || hash_file('sha256', "$dest/$path") !== hash_file('sha256', "$src/$path")) { $bad++; echo "MISMATCH $path\n"; }
}
foreach (array_keys($m['feeds']) as $id) { if (empty($m['feeds'][$id]['files'])) continue; }
$identicalManifest = hash_file('sha256', "$dest/manifest.json") === hash_file('sha256', "$src/manifest.json");
echo "files: $n, mismatches: $bad, first sync ok: " . var_export($r['ok'], true) . " (fetched {$r['fetched']}), second sync fetched: {$r2['fetched']}, manifest identical: " . var_export($identicalManifest, true) . "\n";
exit($r['ok'] && $r2['ok'] && $r2['fetched'] === 0 && $bad === 0 && $identicalManifest ? 0 : 1);
