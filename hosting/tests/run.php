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

// ---- the pages sync hands back the parsed index and the paths it actually wrote (for IndexNow), next to its old fields
$root5 = tmpdir(); $log = [];
$r = radar_sync_pages(BASE, $root5, $srv($P1, $log));
ok($r['ok'] && $r['fetched'] === 2, 'the old fields are unchanged');
same($r['changed'], ['how-many-satellites-in-orbit/index.html', 'sitemap-live.xml'], 'the first sync lists both written paths as changed');
same($r['index']['satellitesVersion'], 'V1', 'and hands back the parsed index');
$r = radar_sync_pages(BASE, $root5, $srv($P1, $log));
same($r['changed'], [], 'an unchanged sync lists nothing as changed');
$r = radar_sync_pages(BASE, $root5, $srv($P2, $log));
same($r['changed'], ['how-many-satellites-in-orbit/index.html'], 'only the page whose hash changed is listed');
$r = radar_sync_pages(BASE, $root5, server(['pages/index.json' => pagesIndex(['how-many-satellites-in-orbit/index.html' => 'v3', 'satellites-by-country/index.html' => 'hub']), 'pages/how-many-satellites-in-orbit/index.html' => 500, 'pages/satellites-by-country/index.html' => 'hub'], $log));
ok(!$r['ok'] && $r['changed'] === ['satellites-by-country/index.html'], 'when one page fails, the one that was written is still listed as changed');
$r = radar_sync_pages(BASE, $root5, server([], $log));
ok(!$r['ok'] && !isset($r['index']) && $r['changed'] === [], 'without an index nothing is listed');
rrmdir($root5);

// ---- IndexNow (docs/superpowers/specs/2026-10-06-live-hazard-pages-design.md, section 2b). No real request is ever made: $http is a fake.
const INOW_KEY = '0123456789abcdef0123456789abcdef';
const T0 = 1791280800;  // 2026-10-06T10:00:00Z
function inowIndex(array $extra = []): array { return $extra + ['schema' => 1, 'siteUrl' => 'https://example.org', 'indexnowKey' => INOW_KEY, 'noindex' => false, 'files' => []]; }
function inowSite(?string $keyText = INOW_KEY): string { $d = tmpdir(); if ($keyText !== null) { file_put_contents($d . '/' . INOW_KEY . '.txt', $keyText); } return $d; }
// a fake IndexNow endpoint: records every call and answers with $status (or throws when $status is an exception)
function inowHttp(array &$calls, $status = 200): callable { return function ($m, $u, $h, $b) use (&$calls, $status) { $calls[] = ['method' => $m, 'url' => $u, 'headers' => $h, 'body' => $b]; if ($status instanceof Throwable) { throw $status; } return ['status' => $status, 'body' => '', 'error' => $status === 0 ? 'could not connect' : '']; }; }
function inowLog(string $f): string { return is_file($f) ? (string) file_get_contents($f) : ''; }
$PAGES_CHANGED = ['how-many-satellites-in-orbit/index.html', 'satellites-by-country/index.html', 'satellites-by-country/japan/index.html', 'sitemap-live.xml'];

// the payload
$site = inowSite(); $work = tmpdir(); $state = $work . '/indexnow.json'; $lf = $work . '/pull.log'; $calls = [];
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $lf, $state, T0);
same(count($calls), 1, 'one request is sent for all due pages');
same($r['sent'], 3, 'three pages are sent');
same($calls[0]['method'], 'POST', 'IndexNow is a POST');
same($calls[0]['url'], 'https://api.indexnow.org/indexnow', 'to the shared IndexNow endpoint');
ok(in_array('Content-Type: application/json; charset=utf-8', $calls[0]['headers'], true), 'with a JSON content type in UTF-8');
$body = json_decode($calls[0]['body'], true);
same(array_keys($body), ['host', 'key', 'keyLocation', 'urlList'], 'the payload has exactly host, key, keyLocation and urlList');
same($body['host'], 'example.org', 'host is the site host');
same($body['key'], INOW_KEY, 'key is the key from the index');
same($body['keyLocation'], 'https://example.org/' . INOW_KEY . '.txt', 'keyLocation is the key file at the site root');
same($body['urlList'], ['https://example.org/how-many-satellites-in-orbit/', 'https://example.org/satellites-by-country/', 'https://example.org/satellites-by-country/japan/'], 'URLs are the page folders (count page, hub, nested country page) and the sitemap is not one of them');
ok(strpos($calls[0]['body'], '\\/') === false, 'slashes are not escaped in the body');
ok(strpos(inowLog($lf), 'indexnow: sent 3 url(s)') !== false, 'the log says how many were sent');
$st = json_decode((string) file_get_contents($state), true);
same($st, ['sent' => ['how-many-satellites-in-orbit/index.html' => T0, 'satellites-by-country/index.html' => T0, 'satellites-by-country/japan/index.html' => T0], 'pending' => []], 'the state file records when each page was sent, and nothing is pending');

// the 6-hour throttle
$calls = [];
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $lf, $state, T0);
ok(count($calls) === 0 && $r['sent'] === 0, 'the same pages again at once send nothing');
ok(substr(trim(inowLog($lf)), -21) === 'indexnow: nothing due', 'and the log says nothing is due');
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $lf, $state, T0 + 21599);
ok(count($calls) === 0, 'one second short of 6 hours still sends nothing');
$r = radar_indexnow(inowIndex(), $site, ['satellites-by-country/united-states/index.html', 'satellites-by-country/japan/index.html'], inowHttp($calls), $lf, $state, T0 + 600);
same(json_decode($calls[0]['body'], true)['urlList'], ['https://example.org/satellites-by-country/united-states/'], 'a page never sent before is sent while the others wait');
$calls = [];
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $lf, $state, T0 + 21600);
same(count($calls), 1, 'after 6 hours the pages are sent again');
same(count(json_decode($calls[0]['body'], true)['urlList']), 3, 'all three that were due');
same(json_decode((string) file_get_contents($state), true)['sent']['satellites-by-country/united-states/index.html'], T0 + 600, 'the page sent later keeps its own time');
rrmdir($site); rrmdir($work);

// the key file proves the key belongs to this site
foreach (['missing' => null, 'different' => 'ffffffffffffffffffffffffffffffff', 'with a line break' => INOW_KEY . "\n", 'empty' => ''] as $what => $text) {
    $site = inowSite($text); $work = tmpdir(); $calls = [];
    $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
    ok(count($calls) === 0 && $r['sent'] === 0, "a key file that is $what sends nothing");
    ok(strpos(inowLog($work . '/pull.log'), 'indexnow: key file missing or different, nothing sent') !== false, "and says so ($what)");
    same(json_decode((string) @file_get_contents($work . '/indexnow.json'), true), ['sent' => [], 'pending' => ['how-many-satellites-in-orbit/index.html', 'satellites-by-country/index.html', 'satellites-by-country/japan/index.html']], "and records no send time, only the pages as pending ($what)");
    rrmdir($site); rrmdir($work);
}

// refused paths are never submitted
$site = inowSite(); $work = tmpdir(); $calls = [];
$r = radar_indexnow(inowIndex(), $site, ['about/index.html', '../evil/index.html', 'satellites-by-country/france/index.html', "satellites-by-country/japan/index.html\n", 'live/manifest.json', 'index.html', 42, 'how-many-satellites-in-orbit/index.html'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
same(json_decode($calls[0]['body'], true)['urlList'], ['https://example.org/how-many-satellites-in-orbit/'], 'only the allowed page is submitted, never a refused path');
$calls = [];
$r = radar_indexnow(inowIndex(), $site, ['about/index.html', '../evil/index.html'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 99999);
ok(count($calls) === 0, 'a list of only refused paths sends nothing');
same(radar_indexnow(inowIndex(), $site, ['how-many-satellites-in-orbit/index.html', 'how-many-satellites-in-orbit/index.html'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 99999)['sent'], 1, 'a path listed twice is sent once');
rrmdir($site); rrmdir($work);

// the sitemap is never submitted, even alone
$site = inowSite(); $work = tmpdir(); $calls = [];
$r = radar_indexnow(inowIndex(), $site, ['sitemap-live.xml'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
ok(count($calls) === 0 && $r['sent'] === 0, 'a changed sitemap alone sends nothing');

// nothing changed
$r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
ok(count($calls) === 0 && $r['sent'] === 0, 'nothing changed sends nothing');
ok(strpos(inowLog($work . '/pull.log'), 'indexnow: nothing due') !== false, 'and the log says nothing is due');

// the index decides: noindex, no key, a bad key, a site address that is not a plain lowercase https host
$bads = [
    'noindex is true' => inowIndex(['noindex' => true]),
    'there is no key' => array_diff_key(inowIndex(), ['indexnowKey' => 1]),
    'the key is too short' => inowIndex(['indexnowKey' => 'abc']),
    'the key has a slash' => inowIndex(['indexnowKey' => '../../etc/passwd']),
    'the key ends in a line break' => inowIndex(['indexnowKey' => INOW_KEY . "\n"]),
    'the key is not a string' => inowIndex(['indexnowKey' => 12345678]),
    'the site is http' => inowIndex(['siteUrl' => 'http://example.org']),
    'the host is uppercase' => inowIndex(['siteUrl' => 'https://Example.org']),
    'the address has a path' => inowIndex(['siteUrl' => 'https://example.github.io/Radar-around-you']),
    'the address has a port' => inowIndex(['siteUrl' => 'https://example.org:8443']),
    'the address has a trailing slash' => inowIndex(['siteUrl' => 'https://example.org/']),
    'the address has a login' => inowIndex(['siteUrl' => 'https://a@example.org']),
    'the address ends in a line break' => inowIndex(['siteUrl' => "https://example.org\n"]),
    'there is no site address' => array_diff_key(inowIndex(), ['siteUrl' => 1]),
];
foreach ($bads as $what => $idx) {
    $calls = [];
    $r = radar_indexnow($idx, $site, $PAGES_CHANGED, inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
    ok(count($calls) === 0 && $r['sent'] === 0, "nothing is sent when $what");
    if (strpos($what, 'the key ') === 0) {
        same($r['reason'], 'badkey', "the reason is badkey when $what");
        $msg = 'indexnow: the key in the pages index is not valid, nothing sent';
        ok(substr(trim(inowLog($work . '/pull.log')), -strlen($msg)) === $msg, "and the log says the key is not valid when $what");
    }
}
ok(strpos(inowLog($work . '/pull.log'), 'indexnow: the site is noindex, nothing sent') !== false, 'the noindex case is logged');
ok(!is_file($work . '/indexnow.json'), 'and none of these records anything');
rrmdir($site); rrmdir($work);

// failures are logged, record no send time, never throw, and the next run tries again even though nothing changed since
$PENDING3 = ['how-many-satellites-in-orbit/index.html', 'satellites-by-country/index.html', 'satellites-by-country/japan/index.html'];
foreach ([429, 403, 422, 400, 500, 0, 204, 301] as $code) {
    $site = inowSite(); $work = tmpdir(); $calls = [];
    $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls, $code), $work . '/pull.log', $work . '/indexnow.json', T0);
    ok(count($calls) === 1 && $r['sent'] === 0 && $r['status'] === $code, "HTTP $code is one request and counts as not sent");
    ok(strpos(inowLog($work . '/pull.log'), "indexnow: HTTP $code") !== false, "HTTP $code is logged with its status");
    same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => [], 'pending' => $PENDING3], "HTTP $code records no send time and keeps the pages pending");
    $r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls, 202), $work . '/pull.log', $work . '/indexnow.json', T0 + 60);
    ok(count($calls) === 2 && $r['sent'] === 3, "after HTTP $code the next run sends the pending pages although nothing changed (and 202 counts as success)");
    same(json_decode($calls[1]['body'], true)['urlList'], ['https://example.org/how-many-satellites-in-orbit/', 'https://example.org/satellites-by-country/', 'https://example.org/satellites-by-country/japan/'], "the retry after HTTP $code names the same pages");
    same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => array_fill_keys($PENDING3, T0 + 60), 'pending' => []], "after the retry for HTTP $code nothing is pending");
    $r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls, 202), $work . '/pull.log', $work . '/indexnow.json', T0 + 120);
    ok(count($calls) === 2, "and the run after that sends nothing (HTTP $code)");
    rrmdir($site); rrmdir($work);
}
// a failure keeps earlier send times, and a failed retry keeps the page pending
$site = inowSite(); $work = tmpdir(); $calls = [];
radar_indexnow(inowIndex(), $site, ['satellites-by-country/index.html'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
radar_indexnow(inowIndex(), $site, [], inowHttp($calls, 429), $work . '/pull.log', $work . '/indexnow.json', T0 + 60);
same(count($calls), 1, 'with nothing changed and nothing pending no request is made');
radar_indexnow(inowIndex(), $site, ['satellites-by-country/japan/index.html'], inowHttp($calls, 429), $work . '/pull.log', $work . '/indexnow.json', T0 + 120);
radar_indexnow(inowIndex(), $site, [], inowHttp($calls, 503), $work . '/pull.log', $work . '/indexnow.json', T0 + 180);
same(count($calls), 3, 'a pending page is tried on every run while it keeps failing (no retry inside one run)');
same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => ['satellites-by-country/index.html' => T0], 'pending' => ['satellites-by-country/japan/index.html']], 'failures keep the earlier send time and the page stays pending');
rrmdir($site); rrmdir($work);
$site = inowSite(); $work = tmpdir(); $calls = [];
$threw = false;
try { $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls, new RuntimeException('network down')), $work . '/pull.log', $work . '/indexnow.json', T0); } catch (Throwable $e) { $threw = true; }
ok(!$threw && $r['sent'] === 0, 'a request that throws is caught and counts as not sent');
ok(strpos(inowLog($work . '/pull.log'), 'network down') !== false, 'and its message is logged');
same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => [], 'pending' => $PENDING3], 'and records no send time, only the pending pages');
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, function () { return 'not an array'; }, $work . '/pull.log', $work . '/indexnow.json', T0);
ok($r['sent'] === 0 && json_decode((string) file_get_contents($work . '/indexnow.json'), true)['sent'] === [], 'a nonsense answer from the HTTP function counts as not sent');
rrmdir($site); rrmdir($work);

// a corrupt or odd state file counts as empty, and is replaced by a valid one. The numeric string and the float would throttle the page if
// the integer filter were missing; the time in the future would throttle it if it were believed.
foreach (['{"sent":{"how-many-sat', 'null', '[]', '"text"', '{"sent":"x"}', '{"sent":{"how-many-satellites-in-orbit/index.html":"yesterday"}}', '{"sent":{"how-many-satellites-in-orbit/index.html":' . (T0 + 3600) . '}}',
    '{"sent":{"how-many-satellites-in-orbit/index.html":"' . (T0 - 10) . '"}}', '{"sent":{"how-many-satellites-in-orbit/index.html":' . (T0 - 10) . '.0}}', '{"pending":"x"}', '{"sent":[],"pending":{"a":{"b":1}}}'] as $bad) {
    $site = inowSite(); $work = tmpdir(); $calls = [];
    file_put_contents($work . '/indexnow.json', $bad);
    $r = radar_indexnow(inowIndex(), $site, ['how-many-satellites-in-orbit/index.html'], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
    ok(count($calls) === 1 && $r['sent'] === 1, 'a state file holding ' . $bad . ' counts as empty');
    same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => ['how-many-satellites-in-orbit/index.html' => T0], 'pending' => []], 'and is replaced by a valid one (' . $bad . ')');
    rrmdir($site); rrmdir($work);
}
// pending in a corrupt state file is lost with the rest (counts as empty): a run with nothing changed then sends nothing
foreach (['{"sent":{},"pending":["how-many-satellites-in-orbit/index.html"', '{"sent":{},"pending":"how-many-satellites-in-orbit/index.html"}'] as $bad) {
    $site = inowSite(); $work = tmpdir(); $calls = [];
    file_put_contents($work . '/indexnow.json', $bad);
    $r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
    ok(count($calls) === 0 && $r['reason'] === 'none', 'pending in a corrupt state file counts as empty: ' . $bad);
    rrmdir($site); rrmdir($work);
}
// send times and pending entries for paths outside the allowed list are dropped and never sent
$site = inowSite(); $work = tmpdir(); $calls = [];
file_put_contents($work . '/indexnow.json', json_encode(['sent' => ['about/index.html' => T0 - 10, 'how-many-satellites-in-orbit/index.html' => T0 - 30000, 'sitemap-live.xml' => T0 - 10],
    'pending' => ['about/index.html', '../evil/index.html', 'sitemap-live.xml', 42, ['x'], 'satellites-by-country/france/index.html', 'satellites-by-country/japan/index.html', 'satellites-by-country/japan/index.html']]));
$r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
same(json_decode($calls[0]['body'], true)['urlList'], ['https://example.org/satellites-by-country/japan/'], 'only the allowed pending page is sent, once');
same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => ['how-many-satellites-in-orbit/index.html' => T0 - 30000, 'satellites-by-country/japan/index.html' => T0], 'pending' => []], 'entries for paths outside the allowed list are dropped from the state');
rrmdir($site); rrmdir($work);
// a page that changed while throttled and never changed again is sent once the throttle expires
$site = inowSite(); $work = tmpdir(); $calls = [];
$H = 'satellites-by-country/index.html';
radar_indexnow(inowIndex(), $site, [$H], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0);
$r = radar_indexnow(inowIndex(), $site, [$H], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 600);
ok(count($calls) === 1 && $r['reason'] === 'none', 'a page that changes again inside 6 hours is not sent at once');
same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => [$H => T0], 'pending' => [$H]], 'but is remembered as pending, with its old send time');
radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 21599);
same(count($calls), 1, 'still nothing one second before the 6 hours are up');
$r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 21600);
ok(count($calls) === 2 && $r['sent'] === 1, 'once the throttle expires it is sent although it did not change again');
same(json_decode((string) file_get_contents($work . '/indexnow.json'), true), ['sent' => [$H => T0 + 21600], 'pending' => []], 'and leaves pending');
radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $work . '/indexnow.json', T0 + 50000);
same(count($calls), 2, 'and is not sent again without a change');
rrmdir($site); rrmdir($work);

// a state file that cannot be written: nothing is sent, so the throttle cannot fail open
$site = inowSite(); $work = tmpdir(); $ro = tmpdir(); $calls = [];
chmod($ro, 0555);
if (is_writable($ro)) {
    fwrite(STDERR, "SKIP: a read-only folder is still writable here (running as root?), so the state-not-writable checks did not run\n");
} else {
    for ($i = 0; $i < 3; $i++) { $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $work . '/pull.log', $ro . '/indexnow.json', T0 + 600 * $i); }
    ok(count($calls) === 0 && $r['sent'] === 0 && $r['reason'] === 'state', 'a state folder that cannot be written sends nothing, run after run');
    ok(strpos(inowLog($work . '/pull.log'), 'indexnow: state file not writable, nothing sent') !== false, 'and says so');
}
chmod($ro, 0755);
file_put_contents($ro . '/indexnow.json', '{"sent":{},"pending":[]}'); chmod($ro . '/indexnow.json', 0444);
if (is_writable($ro . '/indexnow.json')) {
    fwrite(STDERR, "SKIP: a read-only file is still writable here (running as root?), so the read-only state file check did not run\n");
} else {
    $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $work . '/pull.log', $ro . '/indexnow.json', T0);
    ok(count($calls) === 0 && $r['reason'] === 'state', 'a read-only state file sends nothing');
}
chmod($ro . '/indexnow.json', 0644);
$r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), $work . '/pull.log', $work . '/missing-folder/indexnow.json', T0);
ok(count($calls) === 0 && $r['reason'] === 'state', 'a state file in a folder that does not exist sends nothing');
$r = radar_indexnow(inowIndex(), $site, [], inowHttp($calls), $work . '/pull.log', $ro . '/x/indexnow.json', T0);
ok($r['reason'] === 'none', 'with nothing changed and nothing pending the state file is not needed');
rrmdir($site); rrmdir($work); rrmdir($ro);

// the real sender posts without following redirects, so a redirect answer is a failure; every other caller keeps following them
$seen = null;
$send = radar_indexnow_sender(function () use (&$seen) { $seen = func_get_args(); return ['status' => 301, 'body' => '', 'error' => '']; });
$r = $send('POST', RADAR_INDEXNOW_ENDPOINT, ['Content-Type: application/json; charset=utf-8'], '{}');
same($seen, ['POST', RADAR_INDEXNOW_ENDPOINT, ['Content-Type: application/json; charset=utf-8'], '{}', 30, false], 'the IndexNow sender passes a 30 second timeout and turns redirects off');
same($r['status'], 301, 'and hands back the answer as it is');
$params = (new ReflectionFunction('radar_http'))->getParameters();
ok(count($params) === 6 && $params[5]->getName() === 'follow' && $params[5]->getDefaultValue() === true, 'radar_http follows redirects unless told not to');

// no state file path: IndexNow is skipped, with a log line
$site = inowSite(); $work = tmpdir(); $calls = [];
ob_start(); $r = radar_indexnow(inowIndex(), $site, $PAGES_CHANGED, inowHttp($calls), null, null, T0); $out = ob_get_clean();
ok(count($calls) === 0 && $r['sent'] === 0, 'without a state file nothing is sent');
ok(strpos($out, 'indexnow: no state file') !== false, 'and the printed log says why');
same(radar_indexnow_state_file('/home/x/radar-tools/pull.log'), '/home/x/radar-tools/indexnow.json', 'the state file sits next to the log');
same(radar_indexnow_state_file(null), null, 'no log, no state file');
same(radar_indexnow_state_file(''), null, 'an empty log path, no state file');
rrmdir($site); rrmdir($work);

// what pull.php runs after the page sync
$site = inowSite(); $work = tmpdir(); $calls = [];
$pr = ['ok' => true, 'fetched' => 2, 'changed' => ['how-many-satellites-in-orbit/index.html', 'sitemap-live.xml'], 'index' => inowIndex()];
$r = radar_pull_indexnow($pr, $site, $work . '/pull.log', true, inowHttp($calls), T0);
ok(count($calls) === 0 && $r['sent'] === 0, '--no-indexnow sends nothing');
ok(strpos(inowLog($work . '/pull.log'), 'indexnow: turned off (--no-indexnow)') !== false, 'and says so');
$r = radar_pull_indexnow(['ok' => false, 'reason' => 'index', 'fetched' => 0], $site, $work . '/pull.log', false, inowHttp($calls), T0);
ok(count($calls) === 0 && $r['sent'] === 0, 'without a pages index nothing is sent');
ok(strpos(inowLog($work . '/pull.log'), 'indexnow: no pages index, nothing sent') !== false, 'and says so');
$r = radar_pull_indexnow($pr, $site, $work . '/pull.log', false, inowHttp($calls, 429), T0);
ok(count($calls) === 1 && $r['sent'] === 0, 'a refused ping inside the pull is reported, not thrown');
$r = radar_pull_indexnow($pr, $site, $work . '/pull.log', false, inowHttp($calls), T0);
ok(count($calls) === 2 && $r['sent'] === 1 && is_file($work . '/indexnow.json'), 'the pull sends the changed page and keeps the state next to the log');
rrmdir($site); rrmdir($work);

// pull.php knows the switch (run without --dest it only prints its usage, so no request is made)
$out = []; $code = null; exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/../pull.php') . ' 2>&1', $out, $code);
ok($code === 2 && strpos(implode("\n", $out), '[--no-indexnow]') !== false, 'pull.php lists --no-indexnow in its usage');

ob_end_clean();
echo "\n" . $GLOBALS['passed'] . " passed, " . count($GLOBALS['failed']) . " failed\n";
exit(count($GLOBALS['failed']) ? 1 : 0);
