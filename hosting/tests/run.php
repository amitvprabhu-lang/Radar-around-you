<?php
// Tests for hosting/lib.php. Run with: php hosting/tests/run.php   (exit code 0 means all passed)
// No network is used: the HTTP function is replaced by one that serves from memory or from a folder.
error_reporting(E_ALL);
require __DIR__ . '/../lib.php';

$GLOBALS['passed'] = 0; $GLOBALS['failed'] = [];
function ok($cond, string $name): void { if ($cond) { $GLOBALS['passed']++; } else { $GLOBALS['failed'][] = $name; fwrite(STDERR, "FAIL: $name\n"); } }
function same($a, $b, string $name): void { ok($a === $b, $name . ' (got ' . json_encode($a) . ', wanted ' . json_encode($b) . ')'); }
function tmpdir(): string { $d = sys_get_temp_dir() . '/radar-test-' . bin2hex(random_bytes(4)); mkdir($d); return $d; }
function rrmdir(string $d): void { foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) { $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname()); } rmdir($d); }
function files(string $d): array { $o = []; if (!is_dir($d)) return $o; foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)) as $f) { $o[] = substr($f->getPathname(), strlen($d) + 1); } sort($o); return $o; }

const BASE = 'https://data.example/data/';
function manifest(array $feeds, string $at = '2026-10-05T03:00:00Z'): string { return json_encode(['schema' => 1, 'pipeline' => 1, 'generatedAt' => $at, 'pollSec' => 300, 'feeds' => $feeds, 'static' => []]); }
function feed(string $id, string $ver, array $files, array $sizes = []): array { $f = []; foreach ($files as $n => $_) { $f[$n] = "$id/$ver/$n"; } return ['version' => $ver, 'files' => $f, 'sizes' => $sizes]; }
// a fake server: map of path => body (or int status), plus a request log
function server(array $map, array &$log): callable { return function ($url) use ($map, &$log) { $log[] = $url; $p = substr($url, strlen(BASE)); if (!isset($map[$p])) return ['status' => 404, 'body' => '', 'error' => '']; if (is_int($map[$p])) return ['status' => $map[$p], 'body' => '', 'error' => '']; return ['status' => 200, 'body' => $map[$p], 'error' => '']; }; }

// ---- safe paths
ob_start();  // the library logs what it does; the test output shows only results
ok(radar_safe_path('launches/20261005T025703Z/launches.json'), 'a normal path is safe');
ok(radar_safe_path('satellites/20261005T025703Z/swarm.bin'), 'a binary path is safe');
foreach (['quakes', 'events', 'aurora', 'kp', 'clouds', 'planes', 'satellites', 'catalogue', 'storms', 'fires', 'spaceweather', 'closeapproaches', 'launches'] as $id) { ok(radar_safe_path($id . '/20261005T025703Z/' . $id . '.json'), "the real feed name '$id' is accepted"); }
foreach (['../etc/passwd', '/etc/passwd', 'a/../b', 'launches/20261005T025703Z/../x.json', 'launches/2026/launches.json', 'launches/20261005T025703Z/.htaccess', 'launches/20261005T025703Z/a/b.json', 'Launches/20261005T025703Z/x.json', 'launches/20261005T025703Z/x y.json', "launches/20261005T025703Z/x.php\0.json", '_state/20261005T025703Z/x.json', 'launches/20261005T025703Z/'] as $bad) {
    ok(!radar_safe_path($bad), 'unsafe path rejected: ' . json_encode($bad));
}

// ---- manifest reading
ok(radar_parse_manifest(manifest([])) !== null, 'an empty but valid manifest parses');
foreach (['', 'nope', '[]', '{"schema":2,"feeds":{}}', '{"schema":1}', '{"schema":1,"feeds":"x"}'] as $bad) { ok(radar_parse_manifest($bad) === null, 'invalid manifest rejected: ' . $bad); }
$m = radar_parse_manifest(manifest(['a' => feed('quakes', '20261005T030000Z', ['quakes.json' => 1], ['quakes.json' => 5]), 'b' => ['version' => null, 'files' => []], 'c' => ['version' => '20261005T030000Z', 'files' => ['x.json' => '../../evil']]]));
same(radar_wanted($m), ['quakes/20261005T030000Z/quakes.json' => 5], 'only safe paths from feeds with files are wanted');

// ---- a first sync, an unchanged sync, and a changed feed
$dest = tmpdir(); $log = []; $V1 = '20261005T030000Z'; $V2 = '20261005T031000Z';
$files1 = ["quakes/$V1/quakes.json" => '{"a":1}', "kp/$V1/kp.json" => '[1,2]'];
$m1 = manifest(['quakes' => feed('quakes', $V1, ['quakes.json' => 1], ['quakes.json' => 7]), 'kp' => feed('kp', $V1, ['kp.json' => 1], ['kp.json' => 5])]);
$r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m1] + $files1, $log));
ok($r['ok'] && $r['fetched'] === 2, 'first sync fetches both files');
same(files($dest . '/live'), ["kp/$V1/kp.json", 'manifest.json', "quakes/$V1/quakes.json"], 'first sync writes the files and the manifest');
same(file_get_contents($dest . '/live/manifest.json'), $m1, 'the manifest on disk is the one fetched');
$log = []; $r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m1] + $files1, $log));
ok($r['ok'] && $r['fetched'] === 0, 'a second sync with no change fetches nothing');
same($log, [BASE . 'manifest.json'], 'and asks only for the manifest');
$files2 = $files1 + ["quakes/$V2/quakes.json" => '{"a":22}'];
$m2 = manifest(['quakes' => feed('quakes', $V2, ['quakes.json' => 1], ['quakes.json' => 8]), 'kp' => feed('kp', $V1, ['kp.json' => 1], ['kp.json' => 5])], '2026-10-05T03:10:00Z');
$log = []; $r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m2] + $files2, $log));
ok($r['ok'] && $r['fetched'] === 1 && $r['removed'] === 0, 'a changed feed fetches only that feed and keeps the old version for one more run');
ok(is_file($dest . "/live/quakes/$V1/quakes.json") && is_file($dest . "/live/quakes/$V2/quakes.json"), 'both quake versions are on disk');
$r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m2] + $files2, $log));
ok($r['ok'] && $r['removed'] === 1, 'one run later the old version is removed');
ok(!is_file($dest . "/live/quakes/$V1/quakes.json") && !is_dir($dest . "/live/quakes/$V1"), 'its folder is gone too');
ok(is_file($dest . "/live/kp/$V1/kp.json"), 'an unchanged feed is untouched');

// ---- a redeploy of the site wipes live/ (found on the real host on 2026-10-05): the next sync restores everything by itself
$before = files($dest . '/live');
rrmdir($dest . '/live');
ok(!is_dir($dest . '/live'), 'the redeploy removed the whole live folder');
$log = []; $r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m2] + $files2, $log));
ok($r['ok'] && $r['fetched'] === 2, 'the next sync fetches every file the manifest names, although the remote manifest did not change');
same(files($dest . '/live'), ["kp/$V1/kp.json", 'manifest.json', "quakes/$V2/quakes.json"], 'and the folder is back with the current data');
same(file_get_contents($dest . '/live/manifest.json'), $m2, 'with the current manifest');
same(files($dest . '/live'), $before, 'the restored folder is exactly what was there before the wipe');
// wiped again while a file cannot be fetched: no manifest is written, so visitors never meet a manifest that points at missing data
rrmdir($dest . '/live');
$log = []; $r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m2, "kp/$V1/kp.json" => 500, "quakes/$V2/quakes.json" => '{"a":22}'], $log));
ok(!$r['ok'] && $r['reason'] === 'files', 'a failed file after a wipe is reported');
ok(!is_file($dest . '/live/manifest.json'), 'and no manifest is written until every file is in place');
$log = []; $r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $m2] + $files2, $log));
ok($r['ok'] && $r['fetched'] === 1 && is_file($dest . '/live/manifest.json'), 'the following run fetches only what is still missing and then writes the manifest');
rrmdir($dest);

// ---- failures keep the last good copy
$dest = tmpdir(); $log = [];
radar_sync(BASE, $dest, server(['manifest.json' => $m1] + $files1, $log));
$before = file_get_contents($dest . '/manifest.json');
$r = radar_sync(BASE, $dest, server(['manifest.json' => $m2, "kp/$V1/kp.json" => '[1,2]', "quakes/$V2/quakes.json" => 500], $log));
ok(!$r['ok'] && $r['reason'] === 'files', 'a failed download fails the sync');
same(file_get_contents($dest . '/manifest.json'), $before, 'and the manifest visitors use is unchanged');
$r = radar_sync(BASE, $dest, server(['manifest.json' => 503], $log));
ok(!$r['ok'] && $r['reason'] === 'manifest', 'a manifest error fails the sync');
$r = radar_sync(BASE, $dest, server(['manifest.json' => 'garbage'], $log));
ok(!$r['ok'] && $r['reason'] === 'invalid', 'a garbage manifest fails the sync');
same(file_get_contents($dest . '/manifest.json'), $before, 'neither changes what is on disk');
$bad = manifest(['quakes' => feed('quakes', $V2, ['quakes.json' => 1], ['quakes.json' => 99])]);
$r = radar_sync(BASE, $dest, server(['manifest.json' => $bad, "quakes/$V2/quakes.json" => '{"a":22}'], $log));
ok(!$r['ok'], 'a file of the wrong size is refused');
ok(!is_file($dest . "/live/quakes/$V2/quakes.json") && !is_file($dest . "/quakes/$V2/quakes.json"), 'and not kept');
$bad = manifest(['quakes' => feed('quakes', $V2, ['quakes.json' => 1])]);
$r = radar_sync(BASE, $dest, server(['manifest.json' => $bad, "quakes/$V2/quakes.json" => '{broken'], $log));
ok(!$r['ok'], 'a JSON file that is not JSON is refused');
rrmdir($dest);

// ---- a hostile manifest cannot write outside the folder
$dest = tmpdir(); $log = [];
$evil = manifest(['quakes' => ['version' => $V1, 'files' => ['x.json' => '../../escape.json', 'y.json' => 'quakes/' . $V1 . '/y.json']]]);
$r = radar_sync(BASE, $dest . '/live', server(['manifest.json' => $evil, "quakes/$V1/y.json" => '{}', '../../escape.json' => '{}'], $log));
ok($r['ok'], 'the safe file is taken');
ok(!is_file($dest . '/escape.json') && !is_file(dirname($dest) . '/escape.json'), 'the unsafe path was never fetched or written');
ok(count(array_filter($log, function ($u) { return strpos($u, 'escape') !== false; })) === 0, 'the unsafe path was not even requested');
rrmdir($dest);

// ---- files that are not the collector's are never pruned
$dest = tmpdir(); $log = [];
mkdir($dest . '/_state'); file_put_contents($dest . '/_state/memory.json', '{}'); file_put_contents($dest . '/readme.txt', 'mine');
radar_sync(BASE, $dest, server(['manifest.json' => $m1] + $files1, $log)); radar_sync(BASE, $dest, server(['manifest.json' => $m2] + $files2, $log)); radar_sync(BASE, $dest, server(['manifest.json' => $m2] + $files2, $log));
ok(is_file($dest . '/_state/memory.json') && is_file($dest . '/readme.txt'), 'other files and folders are left alone');
rrmdir($dest);

// ---- only https is used
$r = radar_http('GET', 'http://example.org/');
ok($r['status'] === 0 && strpos($r['error'], 'https') !== false, 'a plain http address is refused');

// ---- the trigger
$cfg = ['token' => 'ghp_SECRET', 'owner' => 'amitvprabhu-lang', 'repo' => 'Radar-around-you', 'workflow' => 'live-data.yml', 'ref' => 'main'];
$seen = null;
$r = radar_trigger($cfg, function ($m, $u, $h, $b) use (&$seen) { $seen = [$m, $u, $h, $b]; return ['status' => 204, 'body' => '', 'error' => '']; });
ok($r['ok'], 'a 204 means the collector started');
same($seen[0], 'POST', 'the trigger uses POST');
same($seen[1], 'https://api.github.com/repos/amitvprabhu-lang/Radar-around-you/actions/workflows/live-data.yml/dispatches', 'the trigger address');
same(json_decode($seen[3], true), ['ref' => 'main'], 'the trigger body names the branch');
ok(in_array('Authorization: Bearer ghp_SECRET', $seen[2], true), 'the token is sent as a bearer token');
ok(in_array('X-GitHub-Api-Version: 2022-11-28', $seen[2], true) && in_array('Accept: application/vnd.github+json', $seen[2], true), 'the API version and accept headers are sent');
foreach ([401, 403, 404, 422, 500, 0] as $code) {
    $r = radar_trigger($cfg, function () use ($code) { return ['status' => $code, 'body' => 'ghp_SECRET leaked?', 'error' => $code === 0 ? 'timeout' : '']; });
    ok(!$r['ok'] && strpos($r['message'], "HTTP $code") === 0, "status $code is a failure with a plain message");
    ok(strpos($r['message'], 'SECRET') === false, "the token never appears in the message for $code");
}
foreach (['token', 'owner', 'repo', 'workflow', 'ref'] as $k) { $c = $cfg; unset($c[$k]); $r = radar_trigger($c, function () { throw new Exception('must not be called'); }); ok(!$r['ok'] && strpos($r['message'], $k) !== false, "a config without $k is refused before any request"); }
$c = $cfg; $c['repo'] = 'a/b'; $r = radar_trigger($c, function () { throw new Exception('must not be called'); }); ok(!$r['ok'], 'a repo name with a slash is refused');
$c = $cfg; $c['workflow'] = "x.yml?evil=1"; $r = radar_trigger($c, function () { throw new Exception('must not be called'); }); ok(!$r['ok'], 'a workflow name with odd characters is refused');

// ---- log trimming
$lf = sys_get_temp_dir() . '/radar-test-log-' . bin2hex(random_bytes(3)); ob_start();
for ($i = 0; $i < 350; $i++) { radar_log("line $i", $lf); }
ob_end_clean();
$lines = file($lf, FILE_IGNORE_NEW_LINES); ok(count($lines) === 300 && substr($lines[299], -8) === 'line 349' && substr($lines[0], -7) === 'line 50', 'the log keeps the last 300 lines'); unlink($lf);

// ---- finished pages (pages/ on the data branch, copied to the site root)
ok(radar_safe_page_path('how-many-satellites-in-orbit/index.html'), 'the satellite count page is allowed');
ok(radar_safe_page_path('sitemap-live.xml'), 'the live sitemap is allowed');
ok(radar_safe_page_path('satellites-by-country/index.html'), 'the satellites by country hub is allowed');
foreach (['united-states', 'china', 'united-kingdom', 'cis-former-ussr', 'japan'] as $slug) { ok(radar_safe_page_path("satellites-by-country/$slug/index.html"), "the country page '$slug' is allowed"); }
foreach (['earthquakes-today', 'aurora-tonight', 'asteroid-close-approaches', 'tropical-storms-now', 'wildfires-today', 'right-now'] as $slug) { ok(radar_safe_page_path("$slug/index.html"), "the live page '$slug' is allowed"); ok(!radar_safe_page_path("$slug/x/index.html"), "a nested path under '$slug' is refused"); ok(!radar_safe_page_path("$slug/index.html\n"), "a trailing newline after '$slug' is refused"); }
foreach (['about/index.html', 'x/index.html', 'moon-phases/index.html', 'how-many-satellites-in-orbit/index.html.bak', 'how-many-satellites-in-orbit/index.htm', "sitemap-live.xml\n", '../x/index.html', 'a/../b/index.html', '/etc/passwd', 'index.html', 'a/b/index.html', 'a/index.php', 'a/index.html.bak', '-a/index.html', 'A/index.html', 'sitemap.xml', 'live/manifest.json', '', "a/index.html\n", '.htaccess', 'a//index.html',
    'satellites-by-country/a/b/index.html', 'satellites-by-country/UPPER/index.html', 'satellites-by-country/x.php', 'satellites-by-country//index.html',
    'satellites-by-country/../about/index.html', 'satellites-by-country/-japan/index.html', 'satellites-by-country/japan-/index.html', 'satellites-by-country/united--states/index.html',
    'satellites-by-country/japan2/index.html', 'satellites-by-country/japan/index.html.bak', "satellites-by-country/japan/index.html\n", 'satellites-by-country/japan/', 'satellites-by-country/japan/x.html',
    'satellites-by-country/index.html.bak', 'satellites-by-country', 'satellites-by-country/', 'Satellites-by-country/japan/index.html', 'x/satellites-by-country/japan/index.html',
    'satellites-by-country/france/index.html', 'satellites-by-country/italy/index.html', 'satellites-by-country/united-states-of-america/index.html', 'satellites-by-country/chinaa/index.html', 'satellites-by-country/japan-x/index.html'] as $bad) {
    ok(!radar_safe_page_path($bad), 'unsafe page path rejected: ' . json_encode($bad));
}
$PAGE = '<!doctype html><title>t</title><p>7 active satellites</p>'; $SITEMAP = '<?xml version="1.0"?><urlset/>';
function pagesIndex(array $files): string { $f = []; foreach ($files as $p => $body) { $f[$p] = ['sha256' => hash('sha256', $body), 'size' => strlen($body), 'changed' => '2026-10-05T09:00:00.000Z']; } return json_encode(['schema' => 1, 'satellitesVersion' => 'V1', 'files' => $f]); }
$P1 = ['how-many-satellites-in-orbit/index.html' => $PAGE, 'sitemap-live.xml' => $SITEMAP];
$srv = function (array $files, array &$log) { $map = ['pages/index.json' => pagesIndex($files)]; foreach ($files as $p => $body) { $map['pages/' . $p] = $body; } return server($map, $log); };
$root = tmpdir(); $log = [];
$r = radar_sync_pages(BASE, $root, $srv($P1, $log));
ok($r['ok'] && $r['fetched'] === 2, 'the first pages sync fetches both files');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE, 'the page is written');
same(file_get_contents($root . '/sitemap-live.xml'), $SITEMAP, 'the sitemap is written');
same(array_values(array_filter(files($root), function ($f) { return strpos($f, '.tmp') !== false; })), [], 'no temporary files are left behind');
$log = []; $r = radar_sync_pages(BASE, $root, $srv($P1, $log));
ok($r['ok'] && $r['fetched'] === 0, 'a second pages sync fetches nothing');
same($log, [BASE . 'pages/index.json'], 'and asks only for the index');
$P2 = ['how-many-satellites-in-orbit/index.html' => $PAGE . '<p>newer</p>', 'sitemap-live.xml' => $SITEMAP];
$log = []; $r = radar_sync_pages(BASE, $root, $srv($P2, $log));
ok($r['ok'] && $r['fetched'] === 1, 'a changed page is fetched and an unchanged sitemap is not');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE . '<p>newer</p>', 'the newer page replaced the old one');

// a download that does not match its hash keeps the old file
$tampered = server(['pages/index.json' => pagesIndex(['how-many-satellites-in-orbit/index.html' => 'good body']), 'pages/how-many-satellites-in-orbit/index.html' => 'evil body'], $log);
$r = radar_sync_pages(BASE, $root, $tampered);
ok(!$r['ok'] && $r['reason'] === 'files', 'a body that does not match the index hash is refused');
same(file_get_contents($root . '/how-many-satellites-in-orbit/index.html'), $PAGE . '<p>newer</p>', 'and the previous page is kept');

// an index that names an unsafe path writes nothing outside
$root2 = tmpdir(); $evilIdx = json_encode(['schema' => 1, 'files' => ['../evil/index.html' => ['sha256' => hash('sha256', 'x')], 'how-many-satellites-in-orbit/index.html' => ['sha256' => hash('sha256', $PAGE)]]]);
$r = radar_sync_pages(BASE, $root2, server(['pages/index.json' => $evilIdx, 'pages/how-many-satellites-in-orbit/index.html' => $PAGE, 'pages/../evil/index.html' => 'x'], $log));
ok(!$r['ok'], 'an index naming an unsafe path is reported as a failure');
ok(!is_dir(dirname($root2) . '/evil'), 'and nothing is written outside the site folder');
ok(is_file($root2 . '/how-many-satellites-in-orbit/index.html'), 'the safe page in the same index is still copied');

// no index, an invalid index and a missing site folder
$r = radar_sync_pages(BASE, tmpdir(), server([], $log));
ok(!$r['ok'] && $r['reason'] === 'index', 'a missing pages index changes nothing and says so');
$r = radar_sync_pages(BASE, tmpdir(), server(['pages/index.json' => '{"schema":2}'], $log));
ok(!$r['ok'] && $r['reason'] === 'invalid', 'an index with the wrong schema is refused');
$nope = sys_get_temp_dir() . '/radar-test-nope-' . bin2hex(random_bytes(4));
$r = radar_sync_pages(BASE, $nope, $srv($P1, $log));
ok(!$r['ok'] && $r['reason'] === 'dest' && !is_dir($nope), 'a site folder that does not exist is not created');

// the satellites by country pages live in nested folders that do not exist yet on the site; the sync creates them inside the site folder
$root3 = tmpdir(); $log = [];
$P3 = $P1 + ['satellites-by-country/index.html' => '<p>hub</p>', 'satellites-by-country/japan/index.html' => '<p>japan</p>', 'satellites-by-country/cis-former-ussr/index.html' => '<p>cis</p>'];
$r = radar_sync_pages(BASE, $root3, $srv($P3, $log));
ok($r['ok'] && $r['fetched'] === 5, 'the hub and the country pages are fetched with the count page and the sitemap');
same(file_get_contents($root3 . '/satellites-by-country/japan/index.html'), '<p>japan</p>', 'a country page is written into a new nested folder');
same(file_get_contents($root3 . '/satellites-by-country/index.html'), '<p>hub</p>', 'the hub is written');
same(files($root3), ['how-many-satellites-in-orbit/index.html', 'satellites-by-country/cis-former-ussr/index.html', 'satellites-by-country/index.html', 'satellites-by-country/japan/index.html', 'sitemap-live.xml'], 'nothing else is written and no temporary files are left');
$log = []; $r = radar_sync_pages(BASE, $root3, $srv($P3, $log));
ok($r['ok'] && $r['fetched'] === 0, 'a second sync of the nested pages fetches nothing');
$evil3 = $P1 + ['satellites-by-country/a/b/index.html' => 'x', 'satellites-by-country/UPPER/index.html' => 'x'];
$root4 = tmpdir(); $r = radar_sync_pages(BASE, $root4, $srv($evil3, $log));
ok(!$r['ok'] && count($r['failed']) === 2, 'deeper or uppercase country paths are refused');
ok(!is_dir($root4 . '/satellites-by-country'), 'and no folder is made for them');

ob_end_clean();
echo "\n" . $GLOBALS['passed'] . " passed, " . count($GLOBALS['failed']) . " failed\n";
exit(count($GLOBALS['failed']) ? 1 : 0);
