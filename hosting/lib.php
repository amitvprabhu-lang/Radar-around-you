<?php
// The two small jobs that keep a Hostinger site's live data fresh, because Business Web Hosting does not run Python:
//   trigger.php  asks GitHub to run the collector (which is Python and runs on GitHub's machines)
//   pull.php     copies the finished data from GitHub into the site's live/ folder
// Written to run on PHP 7.4 or newer (no newer syntax), and tested on PHP 8.3. Nothing here runs in a visitor's request.

const RADAR_USER_AGENT = 'radar-around-you-hosting/1';
const RADAR_MAX_FILE_BYTES = 25 * 1024 * 1024;   // OURS: the largest data file is about 7 MB
const RADAR_MAX_RUN_BYTES = 80 * 1024 * 1024;    // OURS: one run never downloads more than this
const RADAR_DEFAULT_BASE = 'https://raw.githubusercontent.com/amitvprabhu-lang/Radar-around-you/data/';

// ------------------------------------------------------------------ HTTP (returns status, body, error; never throws)
function radar_http(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 40, bool $follow = true): array
{
    if (strpos($url, 'https://') !== 0) {
        return ['status' => 0, 'body' => '', 'error' => 'only https addresses are used'];
    }
    $headers[] = 'User-Agent: ' . RADAR_USER_AGENT;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => $follow, CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPHEADER => $headers,
        ]);
        if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
            curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $out = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = $out === false ? curl_error($ch) : '';
        curl_close($ch);
        return ['status' => $status, 'body' => $out === false ? '' : (string) $out, 'error' => $err];
    }
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body === null ? '' : $body, 'timeout' => $timeout, 'ignore_errors' => true, 'follow_location' => $follow ? 1 : 0, 'max_redirects' => 3]]);
    $out = @file_get_contents($url, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('#^HTTP/\S+\s+(\d{3})#', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }
    return ['status' => $status, 'body' => $out === false ? '' : (string) $out, 'error' => $out === false ? 'the request failed' : ''];
}

function radar_log(string $line, ?string $file = null): void
{
    $line = gmdate('Y-m-d\TH:i:s\Z') . ' ' . $line;
    echo $line . "\n";
    if ($file === null) {
        return;
    }
    $old = is_file($file) ? file($file, FILE_IGNORE_NEW_LINES) : [];
    $old[] = $line;
    @file_put_contents($file, implode("\n", array_slice($old, -300)) . "\n", LOCK_EX);  // keeps the last 300 lines
}

// ------------------------------------------------------------------ the collector's manifest
// A feed's files are named like "launches/20261005T025703Z/launches.json". Only paths of exactly this shape are ever fetched or written,
// so a damaged or hostile manifest cannot make the script touch anything outside the live folder.
function radar_safe_path(string $p): bool
{
    return (bool) preg_match('#^[a-z]{2,24}/[0-9]{8}T[0-9]{6}Z/[A-Za-z0-9][A-Za-z0-9._-]{0,60}$#', $p);
}

function radar_parse_manifest(string $text): ?array
{
    $d = json_decode($text, true);
    if (!is_array($d) || ($d['schema'] ?? null) !== 1 || !isset($d['feeds']) || !is_array($d['feeds'])) {
        return null;
    }
    return $d;
}

// every (path, expected size or null) the manifest says should exist, from feeds that have files
function radar_wanted(array $manifest): array
{
    $out = [];
    foreach ($manifest['feeds'] as $id => $f) {
        if (!is_array($f) || empty($f['files']) || !is_array($f['files']) || empty($f['version'])) {
            continue;
        }
        foreach ($f['files'] as $name => $path) {
            if (!is_string($path) || !radar_safe_path($path)) {
                continue;
            }
            $size = isset($f['sizes'][$name]) && is_int($f['sizes'][$name]) ? $f['sizes'][$name] : null;
            $out[$path] = $size;
        }
    }
    return $out;
}

function radar_ensure_dir(string $dir): bool
{
    return is_dir($dir) || @mkdir($dir, 0755, true) || is_dir($dir);
}

// write through a temporary file and rename it, so a reader never sees half a file
function radar_write_atomic(string $final, string $body): bool
{
    if (!radar_ensure_dir(dirname($final))) {
        return false;
    }
    $tmp = $final . '.tmp' . getmypid();
    if (@file_put_contents($tmp, $body, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $final)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

// Bring $dest up to date with the manifest at $base. $http is a function (url) -> [status, body, error]; the default fetches for real.
// The new manifest.json is written last and only if every file it names is in place, so the app never sees a manifest that points at missing data.
function radar_sync(string $base, string $dest, ?callable $http = null, ?string $logFile = null): array
{
    $http = $http ?: function ($u) { return radar_http('GET', $u); };
    $log = function ($m) use ($logFile) { radar_log($m, $logFile); };
    $base = rtrim($base, '/') . '/';
    $r = $http($base . 'manifest.json');
    if ($r['status'] !== 200) {
        $log('manifest: HTTP ' . $r['status'] . ' ' . $r['error']);
        return ['ok' => false, 'reason' => 'manifest', 'fetched' => 0];
    }
    $manifest = radar_parse_manifest($r['body']);
    if ($manifest === null) {
        $log('manifest: not a valid manifest, nothing changed');
        return ['ok' => false, 'reason' => 'invalid', 'fetched' => 0];
    }
    if (!radar_ensure_dir($dest)) {
        $log('cannot create ' . $dest);
        return ['ok' => false, 'reason' => 'dest', 'fetched' => 0];
    }
    $wanted = radar_wanted($manifest);
    $fetched = 0; $failed = []; $bytes = 0;
    foreach ($wanted as $path => $size) {
        $file = $dest . '/' . $path;
        if (is_file($file) && ($size === null || filesize($file) === $size)) {
            continue;  // already here (paths carry the version, so the same path is the same content)
        }
        if ($bytes > RADAR_MAX_RUN_BYTES) {
            $failed[] = $path . ' (run size limit)';
            continue;
        }
        $f = $http($base . $path);
        if ($f['status'] !== 200 || $f['body'] === '' || strlen($f['body']) > RADAR_MAX_FILE_BYTES || ($size !== null && strlen($f['body']) !== $size)) {
            $failed[] = $path . ' (HTTP ' . $f['status'] . ($f['body'] !== '' && $size !== null && strlen($f['body']) !== $size ? ', size ' . strlen($f['body']) . ' not ' . $size : '') . ')';
            continue;
        }
        if (substr($path, -5) === '.json' && json_decode($f['body']) === null && trim($f['body']) !== 'null') {
            $failed[] = $path . ' (not valid JSON)';
            continue;
        }
        if (!radar_write_atomic($file, $f['body'])) {
            $failed[] = $path . ' (could not write)';
            continue;
        }
        $fetched++; $bytes += strlen($f['body']);
    }
    if ($failed) {
        $log('kept the previous manifest; ' . count($failed) . ' file(s) not fetched: ' . implode('; ', array_slice($failed, 0, 5)));
        return ['ok' => false, 'reason' => 'files', 'fetched' => $fetched, 'failed' => $failed];
    }
    // what the manifest on disk (the one visitors are using now) names stays for one more run, about ten minutes, so a visitor in the middle of loading still finds it
    $oldText = is_file($dest . '/manifest.json') ? (string) file_get_contents($dest . '/manifest.json') : '';
    $old = $oldText !== '' ? radar_parse_manifest($oldText) : null;
    $keep = $wanted + ($old ? radar_wanted($old) : []);
    if (!radar_write_atomic($dest . '/manifest.json', $r['body'])) {
        $log('could not write manifest.json');
        return ['ok' => false, 'reason' => 'write', 'fetched' => $fetched];
    }
    $removed = radar_prune($dest, $keep);
    $log('ok: ' . $fetched . ' file(s) fetched, ' . $removed . ' old file(s) removed, manifest of ' . ($manifest['generatedAt'] ?? 'unknown time'));
    return ['ok' => true, 'fetched' => $fetched, 'removed' => $removed];
}

// remove the collector's files that no manifest names any more ($keep: path => size)
function radar_prune(string $dest, array $keep): int
{
    $removed = 0;
    foreach (glob($dest . '/*', GLOB_ONLYDIR) ?: [] as $feedDir) {
        if (!preg_match('#/[a-z]{2,24}$#', $feedDir)) {
            continue;  // only the collector's own feed folders
        }
        foreach (glob($feedDir . '/*', GLOB_ONLYDIR) ?: [] as $verDir) {
            if (!preg_match('#/[0-9]{8}T[0-9]{6}Z$#', $verDir)) {
                continue;
            }
            foreach (glob($verDir . '/*') ?: [] as $f) {
                $rel = substr($f, strlen($dest) + 1);
                if (isset($keep[$rel]) || !is_file($f)) {
                    continue;
                }
                if (@unlink($f)) {
                    $removed++;
                }
            }
            @rmdir($verDir);  // only succeeds when empty
        }
        @rmdir($feedDir);
    }
    return $removed;
}

// ------------------------------------------------------------------ finished pages
// The collector's GitHub job also writes finished HTML pages into pages/ on the data branch, with pages/index.json listing each file and
// its sha256. Only these exact paths are ever fetched or written:
//   built now: "how-many-satellites-in-orbit/index.html", "sitemap-live.xml", "satellites-by-country/index.html" and
//     "satellites-by-country/<slug>/index.html" for the five slugs united-states, china, united-kingdom, cis-former-ussr and japan;
//   allowed ahead of being built (docs/superpowers/specs/2026-10-06-live-hazard-pages-design.md): "<slug>/index.html" for the six slugs
//     earthquakes-today, aurora-tonight, asteroid-close-approaches, tropical-storms-now, wildfires-today and right-now, so the owner copies
//     this file to the server once for all of them; a path that is allowed but absent from pages/index.json is never fetched.
// So a damaged or hostile index cannot overwrite any other page of the site (such as about/index.html) or write anywhere else. \z (not $)
// is used so a trailing newline cannot slip through.
// The slugs must match COUNTRY_PAGES in site/satcountry.mjs (a unit test, test/satcountry.test.js, checks they match). Adding a country
// page means adding its slug here as well, and the owner copying this lib.php to the server again; until then the server refuses it.
// Added 2026-10-07 (docs/superpowers/specs/2026-10-07-country-objects-design.md): "satellites-and-debris-by-country/index.html" and
// "satellites-by-country/<slug>/index.html" for the 19 owner pages of NEW_OWNER_PAGES in site/objects.mjs, an exact list again (a unit test,
// test/objects.test.js, checks it matches). A server still on the older lib.php refuses these paths, logs them and copies every other page.
const RADAR_MAX_PAGE_BYTES = 2 * 1024 * 1024;   // OURS: the largest live page (the United States page with its map and objects) is about 270 KB

function radar_safe_page_path(string $p): bool
{
    return (bool) preg_match('#^(?:how-many-satellites-in-orbit/index\.html|sitemap-live\.xml|satellites-by-country/index\.html|satellites-by-country/(?:united-states|china|united-kingdom|cis-former-ussr|japan)/index\.html|(?:earthquakes-today|aurora-tonight|asteroid-close-approaches|tropical-storms-now|wildfires-today|right-now|starlink-tracker|natural-disasters-now|rocket-launches|iss-today|tonights-sky)/index\.html|tonights-sky/(?:pune|newyork|london|tromso|tokyo|sydney)/index\.html|satellites-and-debris-by-country/index\.html|satellites-by-country/(?:france|india|intelsat|european-space-agency|germany|italy|globalstar|canada|south-korea|ses|orbcomm|spain|eutelsat|turkiye|australia|taiwan|sea-launch|argentina|o3b-networks)/index\.html)\z#', $p);
}

// Copy the pages named in $base/pages/index.json into $destRoot (the site's public folder, which must already exist; the folders inside it,
// such as satellites-by-country/japan/, are created as needed). Files whose hash
// already matches are skipped. Each file is written through a temporary name and renamed, so a visitor never sees half a page, and a
// download that does not match its hash is refused so the previous page stays.
// Besides ok and fetched (and reason, failed), the result carries 'changed', the paths written in this run, and 'index', the parsed
// pages/index.json once it was read, so radar_indexnow can ping only what changed without downloading the index again.
function radar_sync_pages(string $base, string $destRoot, ?callable $http = null, ?string $logFile = null): array
{
    $http = $http ?: function ($u) { return radar_http('GET', $u); };
    $log = function ($m) use ($logFile) { radar_log($m, $logFile); };
    $base = rtrim($base, '/') . '/';
    $r = $http($base . 'pages/index.json');
    if ($r['status'] !== 200) {
        $log('pages index: HTTP ' . $r['status'] . ' ' . $r['error']);
        return ['ok' => false, 'reason' => 'index', 'fetched' => 0, 'changed' => []];
    }
    $d = json_decode($r['body'], true);
    if (!is_array($d) || ($d['schema'] ?? null) !== 1 || !isset($d['files']) || !is_array($d['files'])) {
        $log('pages index: not a valid index, nothing changed');
        return ['ok' => false, 'reason' => 'invalid', 'fetched' => 0, 'changed' => []];
    }
    if (!is_dir($destRoot)) {
        $log('pages: the site folder ' . $destRoot . ' does not exist, nothing written');
        return ['ok' => false, 'reason' => 'dest', 'fetched' => 0, 'changed' => []];
    }
    $fetched = 0; $failed = []; $changed = [];
    foreach ($d['files'] as $path => $info) {
        $path = (string) $path;
        if (!radar_safe_page_path($path) || !is_array($info) || !isset($info['sha256']) || !preg_match('/^[0-9a-f]{64}\z/', (string) $info['sha256'])) {
            $failed[] = json_encode($path) . ' (not an allowed page)';
            continue;
        }
        $file = rtrim($destRoot, '/') . '/' . $path;
        if (is_file($file) && hash_file('sha256', $file) === $info['sha256']) {
            continue;
        }
        $f = $http($base . 'pages/' . $path);
        if ($f['status'] !== 200 || $f['body'] === '' || strlen($f['body']) > RADAR_MAX_PAGE_BYTES) {
            $failed[] = $path . ' (HTTP ' . $f['status'] . ')';
            continue;
        }
        if (hash('sha256', $f['body']) !== $info['sha256']) {
            $failed[] = $path . ' (the download does not match the hash in the index)';
            continue;
        }
        if (!radar_write_atomic($file, $f['body'])) {
            $failed[] = $path . ' (could not write)';
            continue;
        }
        $fetched++;
        $changed[] = $path;
    }
    if ($failed) {
        $log('pages: ' . count($failed) . ' not updated: ' . implode('; ', array_slice($failed, 0, 5)));
        return ['ok' => false, 'reason' => 'files', 'fetched' => $fetched, 'failed' => $failed, 'changed' => $changed, 'index' => $d];
    }
    $log('pages: ok, ' . $fetched . ' file(s) fetched');
    return ['ok' => true, 'fetched' => $fetched, 'changed' => $changed, 'index' => $d];
}

// ------------------------------------------------------------------ IndexNow pings for the pages that changed
// docs/superpowers/specs/2026-10-06-live-hazard-pages-design.md, section 2b, from the IndexNow documentation read on 2026-10-06: a POST
// of JSON (host, key, keyLocation, urlList) to an IndexNow endpoint; 200 or 202 is success, 403 an invalid key, 422 URLs that do not
// match the host, 429 too many requests. The key is proved by <site root>/<key>.txt holding the key. The documentation asks sites not to
// submit the same URL many times a day, so each page is sent at most once every RADAR_INDEXNOW_EVERY seconds.
const RADAR_INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const RADAR_INDEXNOW_EVERY = 6 * 3600;   // OURS: at most one ping per page every 6 hours
const RADAR_INDEXNOW_RETRY_FIRST = 3600;      // OURS: after a failed send, wait 1 hour before trying that page again,
const RADAR_INDEXNOW_RETRY_MAX = 12 * 3600;   // OURS: doubling on each further failure, up to 12 hours

// The wait after the n-th failure in a row: 1, 2, 4, 8, then 12 hours.
function radar_indexnow_retry_delay(int $failures): int
{
    return min(RADAR_INDEXNOW_RETRY_FIRST * (2 ** min(max($failures, 1) - 1, 4)), RADAR_INDEXNOW_RETRY_MAX);
}

// The throttle state lives next to the log as indexnow.json; without a log there is nowhere sensible to keep it.
function radar_indexnow_state_file(?string $logFile): ?string
{
    return ($logFile === null || $logFile === '') ? null : dirname($logFile) . '/indexnow.json';
}

// A page IndexNow may be told about: an allowed page path (never the sitemap).
function radar_indexnow_page(string $p): bool
{
    return radar_safe_page_path($p) && substr($p, -11) === '/index.html';
}

// The real sender: a 30 second POST that does not follow redirects, so a redirect answer counts as a failure. $transport is for tests.
function radar_indexnow_sender(?callable $transport = null): callable
{
    $transport = $transport ?: 'radar_http';
    return function ($m, $u, $h, $b) use ($transport) { return $transport($m, $u, $h, $b, 30, false); };
}

// The state file: {"sent": {"<page>": <Unix time of the last accepted send>}, "pending": ["<page>", ...],
// "retry": {"<page>": {"failures": <failed sends in a row>, "retryAt": <Unix time>}}}. A page is pending when it changed but was not
// accepted yet (throttled, failed, or the key file was missing); it has a retry record only after a failed send. Anything that is not this
// shape counts as empty. Send times for paths that are not allowed pages, that are not integers or that lie in the future are dropped; a
// retry record with a failure count that is not a positive integer, or a retry time that is not an integer or lies more than 12 hours
// ahead, counts as no record; radar_indexnow drops pending entries that are not allowed pages and records for pages that are not pending,
// so the file never grows beyond the allowed list.
function radar_indexnow_read_state(string $stateFile, int $now): array
{
    $sent = []; $pending = []; $retry = [];
    $d = is_file($stateFile) ? json_decode((string) @file_get_contents($stateFile), true) : null;
    if (!is_array($d)) {
        return [$sent, $pending, $retry];
    }
    if (isset($d['sent']) && is_array($d['sent'])) {
        foreach ($d['sent'] as $p => $t) {
            if (is_int($t) && $t <= $now && radar_indexnow_page((string) $p)) {
                $sent[(string) $p] = $t;
            }
        }
    }
    if (isset($d['pending']) && is_array($d['pending'])) {
        foreach ($d['pending'] as $p) {
            if (is_string($p)) {
                $pending[$p] = true;  // filtered with the changed paths in radar_indexnow, so a hostile entry is dropped there
            }
        }
    }
    if (isset($d['retry']) && is_array($d['retry'])) {
        foreach ($d['retry'] as $p => $rec) {
            if (is_array($rec) && isset($rec['failures'], $rec['retryAt']) && is_int($rec['failures']) && $rec['failures'] >= 1
                && is_int($rec['retryAt']) && $rec['retryAt'] <= $now + RADAR_INDEXNOW_RETRY_MAX) {
                $retry[(string) $p] = ['failures' => $rec['failures'], 'retryAt' => $rec['retryAt']];
            }
        }
    }
    return [$sent, array_keys($pending), $retry];
}

function radar_indexnow_write_state(string $stateFile, array $sent, array $pending, array $retry): bool
{
    ksort($sent);
    $pending = array_values(array_unique($pending));
    sort($pending);
    $retry = array_intersect_key($retry, array_flip($pending));  // a record lives only as long as its page is pending
    ksort($retry);
    return radar_write_atomic($stateFile, json_encode(['sent' => (object) $sent, 'pending' => $pending, 'retry' => (object) $retry], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");
}

// Ping IndexNow for the pages in $changedPaths and the pages still pending from earlier runs, those not sent in the last 6 hours.
// $index is the parsed pages/index.json (siteUrl, indexnowKey, noindex), $destRoot the site's public folder, $http a function
// (method, url, headers, body) -> [status, body, error] (the default sends for real), $now a Unix time (default: the current time).
// Writes exactly one log line and never throws. A page is due when it was not sent in the last 6 hours and, if its last send failed, its
// retry time has come (a change does not shorten that wait). A page leaves pending, gets its send time and loses its retry record only
// after a 200 or 202; any failed send keeps it pending and sets its retry time 1, 2, 4, 8, then 12 hours ahead, so a later run tries
// again without it having to change again, but never every run. There is no retry inside one run.
// Returns ['sent' => number of URLs accepted, 'reason' => short word, 'status' => HTTP status or null].
function radar_indexnow(array $index, string $destRoot, array $changedPaths, ?callable $http = null, ?string $logFile = null, ?string $stateFile = null, ?int $now = null): array
{
    $log = function ($m) use ($logFile) { radar_log('indexnow: ' . $m, $logFile); };
    $done = function (string $reason, string $line, ?int $status = null, int $sent = 0) use ($log) { $log($line); return ['sent' => $sent, 'reason' => $reason, 'status' => $status]; };
    $now = $now === null ? time() : $now;
    if ($stateFile === null || $stateFile === '') {
        return $done('state', 'no state file (pull.php needs --log for it), nothing sent');
    }
    if (($index['noindex'] ?? false) === true) {
        return $done('noindex', 'the site is noindex, nothing sent');
    }
    $key = $index['indexnowKey'] ?? null;
    if ($key === null) {
        return $done('nokey', 'no key in the pages index, nothing sent');
    }
    if (!is_string($key) || !preg_match('/^[A-Za-z0-9-]{8,128}\z/', $key)) {
        return $done('badkey', 'the key in the pages index is not valid, nothing sent');
    }
    $site = $index['siteUrl'] ?? null;
    if (!is_string($site) || !preg_match('#^https://([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\z#', $site, $m)) {
        return $done('site', 'the site address in the pages index is not a plain https host, nothing sent');
    }
    $host = $m[1];
    [$sent, $pending, $retry] = radar_indexnow_read_state($stateFile, $now);
    // the candidates: what changed now and what is still pending, only pages (never the sitemap or anything the page sync would refuse), each once
    $wanted = [];
    foreach (array_merge($changedPaths, $pending) as $p) {
        if (is_string($p) && radar_indexnow_page($p)) {
            $wanted[$p] = true;
        }
    }
    $wanted = array_keys($wanted);
    if (!$wanted) {
        return $done('none', 'nothing due');
    }
    // without a state that can be saved the throttle would not hold, so nothing is sent
    $dir = dirname($stateFile);
    if (!is_dir($dir) || !is_writable($dir) || (file_exists($stateFile) && !is_writable($stateFile))) {
        return $done('state', 'state file not writable, nothing sent');
    }
    $due = array_values(array_filter($wanted, function ($p) use ($sent, $retry, $now) {
        return (!isset($sent[$p]) || $now - $sent[$p] >= RADAR_INDEXNOW_EVERY) && (!isset($retry[$p]) || $now >= $retry[$p]['retryAt']);
    }));
    // after a failed send every page that was in it waits longer; all wanted pages stay pending
    $failed = function () use (&$retry, $due, $now) {
        foreach ($due as $p) {
            $f = isset($retry[$p]) ? $retry[$p]['failures'] + 1 : 1;
            $retry[$p] = ['failures' => $f, 'retryAt' => $now + radar_indexnow_retry_delay($f)];
        }
    };
    $note = function () use ($stateFile, $sent, $wanted, &$retry) { return radar_indexnow_write_state($stateFile, $sent, $wanted, $retry) ? '' : ', and could not write ' . $stateFile; };
    if (!$due) {
        return $done('none', 'nothing due' . $note());
    }
    $proof = $destRoot . '/' . $key . '.txt';
    if (!is_file($proof) || (string) @file_get_contents($proof) !== $key) {
        return $done('keyfile', 'key file missing or different, nothing sent' . $note());
    }
    $urls = [];
    foreach ($due as $p) {
        $urls[] = $site . '/' . substr($p, 0, -strlen('index.html'));
    }
    $body = json_encode(['host' => $host, 'key' => $key, 'keyLocation' => $site . '/' . $key . '.txt', 'urlList' => $urls], JSON_UNESCAPED_SLASHES);
    $http = $http ?: radar_indexnow_sender();
    try {
        $r = $http('POST', RADAR_INDEXNOW_ENDPOINT, ['Content-Type: application/json; charset=utf-8'], $body);
    } catch (Throwable $e) {
        $failed();
        return $done('error', 'the request failed (' . $e->getMessage() . '), ' . count($urls) . ' url(s) kept pending; tried again after a wait' . $note());
    }
    $status = is_array($r) && isset($r['status']) && is_int($r['status']) ? $r['status'] : 0;
    if ($status !== 200 && $status !== 202) {
        $failed();
        $why = [400 => 'bad request', 403 => 'the key was not accepted', 422 => 'the URLs do not match the host or the key', 429 => 'too many requests'];
        $err = is_array($r) && !empty($r['error']) ? ' ' . $r['error'] : '';
        return $done('http', 'HTTP ' . $status . ' ' . ($why[$status] ?? ($status === 0 ? 'no answer' : 'unexpected answer')) . $err . ', ' . count($urls) . ' url(s) kept pending; tried again after a wait' . $note(), $status);
    }
    foreach ($due as $p) {
        $sent[$p] = $now;
    }
    // the sent pages leave pending, and with it their retry records (radar_indexnow_write_state keeps records only for pending pages)
    $saved = radar_indexnow_write_state($stateFile, $sent, array_diff($wanted, $due), $retry);
    return $done('sent', 'sent ' . count($urls) . ' url(s) (HTTP ' . $status . ')' . ($saved ? '' : ', but could not write ' . $stateFile), $status, count($urls));
}

// What pull.php runs after the page sync: one log line, never an exception, and the pull's exit code never depends on it.
function radar_pull_indexnow(array $pagesResult, string $pagesDest, ?string $logFile, bool $off, ?callable $http = null, ?int $now = null): array
{
    if ($off) {
        radar_log('indexnow: turned off (--no-indexnow)', $logFile);
        return ['sent' => 0, 'reason' => 'off', 'status' => null];
    }
    if (!isset($pagesResult['index']) || !is_array($pagesResult['index'])) {
        radar_log('indexnow: no pages index, nothing sent', $logFile);
        return ['sent' => 0, 'reason' => 'noindexfile', 'status' => null];
    }
    try {
        return radar_indexnow($pagesResult['index'], rtrim($pagesDest, '/'), $pagesResult['changed'] ?? [], $http, $logFile, radar_indexnow_state_file($logFile), $now);
    } catch (Throwable $e) {
        radar_log('indexnow: unexpected error (' . $e->getMessage() . '), nothing sent', $logFile);
        return ['sent' => 0, 'reason' => 'error', 'status' => null];
    }
}

// ------------------------------------------------------------------ asking GitHub to run the collector
// POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches answers 204 with no body when it worked.
function radar_trigger(array $cfg, ?callable $http = null): array
{
    foreach (['token', 'owner', 'repo', 'workflow', 'ref'] as $k) {
        if (empty($cfg[$k]) || !is_string($cfg[$k])) {
            return ['ok' => false, 'message' => "config is missing '$k'"];
        }
    }
    foreach (['owner', 'repo', 'workflow', 'ref'] as $k) {
        if (!preg_match('#^[A-Za-z0-9._-]+$#', $cfg[$k])) {
            return ['ok' => false, 'message' => "config value '$k' has odd characters"];
        }
    }
    $http = $http ?: function ($m, $u, $h, $b) { return radar_http($m, $u, $h, $b, 30); };
    $url = 'https://api.github.com/repos/' . $cfg['owner'] . '/' . $cfg['repo'] . '/actions/workflows/' . $cfg['workflow'] . '/dispatches';
    $r = $http('POST', $url, [
        'Authorization: Bearer ' . $cfg['token'], 'Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28', 'Content-Type: application/json',
    ], json_encode(['ref' => $cfg['ref']]));
    if ($r['status'] === 204) {
        return ['ok' => true, 'message' => 'collector started'];
    }
    $why = [401 => 'GitHub did not accept the token (wrong or expired)', 403 => 'the token is not allowed to start workflows (it needs Actions: read and write on this repository) or a limit was reached',
            404 => 'GitHub could not find the repository or workflow, or the token cannot see it', 422 => 'the workflow cannot be started on that branch (does it allow workflow_dispatch?)'];
    $msg = $r['status'] === 0 ? ('no answer: ' . $r['error']) : ($why[$r['status']] ?? ('unexpected answer'));
    return ['ok' => false, 'message' => 'HTTP ' . $r['status'] . ': ' . $msg];
}
