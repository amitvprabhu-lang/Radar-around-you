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
function radar_http(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 40): array
{
    if (strpos($url, 'https://') !== 0) {
        return ['status' => 0, 'body' => '', 'error' => 'only https addresses are used'];
    }
    $headers[] = 'User-Agent: ' . RADAR_USER_AGENT;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
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
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body === null ? '' : $body, 'timeout' => $timeout, 'ignore_errors' => true, 'follow_location' => 1, 'max_redirects' => 3]]);
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
