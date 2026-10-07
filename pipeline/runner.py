"""Decide what is due, run each feed, publish versioned files, keep the last good copy, write the manifest.

Layout of the data folder (what a static host serves, apart from _state):
  manifest.json                 what is current, how fresh, and what each source says about itself
  <feed>/<version>/<file>       immutable files; a version is the fetch time, so a reader never mixes two builds
  _state/state.json             the runner's memory between runs (also holds the catalogue the packer needs)
"""
import email.utils
import gzip
import json
import os
import re
import shutil
from datetime import datetime, timedelta, timezone

from . import PIPELINE_VERSION, config, net

SLACK_S = 60   # OURS: the scheduler is not exact, so a feed is due a little before its interval is up
MANIFEST = "manifest.json"
STATE_DIR = "_state"


class Unchanged(Exception):
    """The source said nothing new (HTTP 304, or no city was due)."""


class FeedFailure(Exception):
    def __init__(self, message, retry_after_s=None):
        super().__init__(message)
        self.retry_after_s = retry_after_s


class Halt(Exception):
    """A source's usage policy says stop at the first non-200 answer and tell a human."""
    def __init__(self, group, message):
        super().__init__(message)
        self.group = group


class Result:
    def __init__(self, files, count, source_time=None, note="", private=False):
        self.files, self.count, self.source_time, self.note, self.private = files, count, source_time, note, private


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(text):
    t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def dumps(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


class Context:
    """What a feed builder is given: the clock, a polite getter, the baseline places, and the memory of earlier runs."""

    def __init__(self, data_dir, baseline_dir, contact, clock, fetch, sleep, state):
        self.data_dir, self.baseline_dir, self.contact = data_dir, baseline_dir, contact
        self.clock, self._fetch, self.sleep, self.state = clock, fetch, sleep, state
        self.now = clock()

    # ---- memory
    def fs(self, feed_id):
        entry = self.state["feeds"].setdefault(feed_id, {})
        entry.setdefault("cond", {})
        return entry

    def cities(self):
        with open(os.path.join(self.baseline_dir, config.CITIES_FILE), encoding="utf-8") as f:
            return [{k: c[k] for k in ("id", "name", "lat", "lon")} for c in json.load(f)]

    def previous_json(self, feed_id, name):
        """The last good published file of a feed, or None."""
        rel = self.fs(feed_id).get("files", {}).get(name)
        if not rel:
            return None
        try:
            with open(os.path.join(self.data_dir, rel), "rb") as f:
                return json.loads(f.read())
        except (OSError, ValueError):
            return None

    def private_json(self, name):
        try:
            with gzip.open(os.path.join(self.data_dir, STATE_DIR, name), "rb") as f:
                return json.loads(f.read())
        except (OSError, ValueError):
            return None

    # ---- the polite getter
    def get(self, feed_id, url, key="main", conditional=False, headers=None):
        feed = config.FEEDS[feed_id]
        cond = self.fs(feed_id)["cond"].setdefault(key, {})
        h = {"User-Agent": net.user_agent(self.contact), **(headers or {})}
        if conditional:
            if cond.get("etag"):
                h["If-None-Match"] = cond["etag"]
            if cond.get("lastModified"):
                h["If-Modified-Since"] = cond["lastModified"]
        tries = 1 if feed.halt_group else 3  # a policy source is asked once: repeating after an error is what gets an address blocked
        for attempt in range(tries):
            try:
                r = self._fetch(url, headers=h, follow_redirects=not feed.halt_group)
            except net.FetchError as e:
                if attempt + 1 < tries:
                    self.sleep(3 * (attempt + 1))
                    continue
                raise FeedFailure(str(e))
            if 500 <= r.status < 600 and attempt + 1 < tries:
                self.sleep(3 * (attempt + 1))
                continue
            break
        if feed.halt_group and r.status != 200:
            raise Halt(feed.halt_group, f"HTTP {r.status} from {url.split('?')[0]}")
        if r.status == 304:
            raise Unchanged()
        if r.status in (403, 429):
            wait = _retry_after(r) or (6 * 3600 if r.status == 403 else 3600)
            raise FeedFailure(f"HTTP {r.status} (the source is refusing requests; check the contact address in the User-Agent)", retry_after_s=wait)
        if r.status != 200:
            raise FeedFailure(f"HTTP {r.status}")
        cond["etag"], cond["lastModified"] = r.header("etag"), r.header("last-modified")
        exp = _http_date(r.header("expires"))
        cond["expires"] = iso(exp) if exp else None
        return r

    def expires_of(self, feed_id, key):
        e = self.fs(feed_id)["cond"].get(key, {}).get("expires")
        return parse(e) if e else None


def _http_date(text):
    if not text:
        return None
    try:
        return email.utils.parsedate_to_datetime(text).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _retry_after(r):
    """Seconds to wait from a Retry-After header (a number of seconds or an HTTP date), capped at a day, or None."""
    v = r.header("retry-after")
    if not v:
        return None
    if re.fullmatch(r"\d+", v.strip()):
        return min(int(v), 86400)
    d = _http_date(v)
    if d is None:
        return None
    return int(min(max(0, (d - datetime.now(timezone.utc)).total_seconds()), 86400))


class Runner:
    def __init__(self, data_dir, baseline_dir, contact, builders, clock=None, fetch=net.fetch, sleep=None, log=print):
        import time
        self.data_dir, self.baseline_dir, self.contact, self.builders = data_dir, baseline_dir, contact, builders
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.fetch, self.sleep, self.log = fetch, sleep or time.sleep, log
        self.order = list(builders)

    # ---- state
    def load_state(self):
        try:
            with open(os.path.join(self.data_dir, STATE_DIR, "state.json"), encoding="utf-8") as f:
                s = json.load(f)
            if s.get("version") == PIPELINE_VERSION:
                return s
        except (OSError, ValueError):
            pass
        return {"version": PIPELINE_VERSION, "feeds": {}, "halts": {}}

    def save_state(self, state):
        atomic_write(os.path.join(self.data_dir, STATE_DIR, "state.json"), json.dumps(state, indent=1, sort_keys=True).encode("utf-8"))

    # ---- scheduling
    def due(self, feed_id, state, now, force=False):
        feed = config.FEEDS[feed_id]
        halt = state["halts"].get(feed.halt_group) if feed.halt_group else None
        if halt and now < parse(halt["until"]):
            return False, "halted"
        if force:
            return True, ""
        nxt = state["feeds"].get(feed_id, {}).get("nextTryAt")
        if nxt and now < parse(nxt):
            return False, "not yet"
        return True, ""

    # ---- one run
    def run(self, only=None, force=False):
        state = self.load_state()
        summary = {"ran": [], "ok": [], "unchanged": [], "failed": {}, "halted": {}, "skipped": []}
        for fid in self.order:
            if only and fid not in only:
                continue
            ctx = Context(self.data_dir, self.baseline_dir, self.contact, self.clock, self.fetch, self.sleep, state)
            now = ctx.now
            ok, why = self.due(fid, state, now, force)
            if not ok:
                summary["skipped"].append(f"{fid} ({why})")
                continue
            fs, feed = ctx.fs(fid), config.FEEDS[fid]
            fs["lastAttempt"] = iso(now)
            summary["ran"].append(fid)
            try:
                res = self.builders[fid](ctx)
                self._publish(fid, fs, res, ctx)
                fs.update(failures=0, error=None, status="ok", checkedAt=iso(ctx.clock()))
                if feed.halt_group:
                    state["halts"].pop(feed.halt_group, None)  # a successful probe after the cool-off ends the halt
                summary["ok"].append(fid)
                self.log(f"{fid}: ok, {res.count} items{', ' + res.note if res.note else ''}")
            except Unchanged:
                fs.update(failures=0, error=None, status="ok", checkedAt=iso(ctx.clock()))
                summary["unchanged"].append(fid)
                self.log(f"{fid}: unchanged")
            except Halt as e:
                until = ctx.clock() + timedelta(seconds=config.HALT_COOL_OFF_S)
                state["halts"][e.group] = {"since": iso(ctx.clock()), "until": iso(until), "reason": str(e)}
                fs.update(status="halted", error=f"Stopped by the source's usage policy: {e}", failures=fs.get("failures", 0) + 1)
                summary["halted"][fid] = str(e)
                self.log(f"{fid}: HALTED ({e}). A person needs to look at this.")
            except FeedFailure as e:
                self._fail(fid, fs, feed, ctx, str(e), e.retry_after_s)
                summary["failed"][fid] = str(e)
                self.log(f"{fid}: FAILED ({e}); keeping the last good copy")
            except Exception as e:  # a bug or an unexpected shape must never take the other feeds down
                self._fail(fid, fs, feed, ctx, f"{type(e).__name__}: {e}", None)
                summary["failed"][fid] = f"{type(e).__name__}: {e}"
                self.log(f"{fid}: ERROR {type(e).__name__}: {e}; keeping the last good copy")
            self._schedule(fid, fs, feed, ctx)
            self.save_state(state)
        self.write_manifest(state)
        self._prune(state)
        return summary

    def _fail(self, fid, fs, feed, ctx, message, retry_after_s):
        n = fs.get("failures", 0) + 1
        fs.update(failures=n, error=message, status="failing")
        backoff = feed.refresh_s * min(2 ** (n - 1), 8)  # OURS: back off, never more than 8 times the normal interval
        fs["_retry_after_s"] = max(backoff, retry_after_s or 0)

    def _schedule(self, fid, fs, feed, ctx):
        now = ctx.clock()
        wait = fs.pop("_retry_after_s", None)
        nxt = now + timedelta(seconds=wait) if wait else now + timedelta(seconds=max(0, feed.refresh_s - SLACK_S))
        exps = [parse(c["expires"]) for c in fs["cond"].values() if c.get("expires")]
        if exps and not wait:
            nxt = max(nxt, max(exps))  # never ask again before the source's own Expires
        fs["nextTryAt"] = iso(nxt)

    # ---- publishing
    def _publish(self, fid, fs, res, ctx):
        now = ctx.clock()
        if res.private:
            for name, data in res.files.items():
                atomic_write(os.path.join(self.data_dir, STATE_DIR, name), data)
            files = {}
        else:
            version = now.strftime("%Y%m%dT%H%M%SZ")
            files = {}
            for name, data in res.files.items():
                rel = f"{fid}/{version}/{name}"
                atomic_write(os.path.join(self.data_dir, rel), data)
                files[name] = rel
            fs["version"] = version
        fs.update(files=files, sizes={n: len(d) for n, d in res.files.items()}, count=res.count, sourceTime=res.source_time,
                  fetchedAt=iso(now), note=res.note)

    def _prune(self, state):
        for fid in config.FEEDS:
            d = os.path.join(self.data_dir, fid)
            if not os.path.isdir(d):
                continue
            keep = state["feeds"].get(fid, {}).get("version")
            versions = sorted(os.listdir(d))
            for v in versions[:-config.KEEP_VERSIONS_BY_FEED.get(fid, config.KEEP_VERSIONS)]:
                if v != keep:
                    shutil.rmtree(os.path.join(d, v), ignore_errors=True)

    # ---- the manifest
    def write_manifest(self, state):
        feeds = {}
        for fid, feed in config.FEEDS.items():
            fs = state["feeds"].get(fid, {})
            halted = state["halts"].get(feed.halt_group) if feed.halt_group else None
            feeds[fid] = {
                "label": feed.label, "source": feed.source, "docUrl": feed.doc, "says": feed.says, "licence": feed.licence,
                "credit": feed.credit, "refreshSec": feed.refresh_s, "staleAfterSec": feed.stale_s,
                "status": fs.get("status", "never"), "checkedAt": fs.get("checkedAt"), "fetchedAt": fs.get("fetchedAt"),
                "sourceTime": fs.get("sourceTime"), "count": fs.get("count"), "version": fs.get("version"),
                "files": fs.get("files", {}), "sizes": fs.get("sizes", {}), "note": fs.get("note", ""),
                "error": fs.get("error"), "failures": fs.get("failures", 0), "nextTryAt": fs.get("nextTryAt"),
                "halted": {"since": halted["since"], "until": halted["until"], "reason": halted["reason"]} if halted else None,
            }
        manifest = {"schema": 1, "pipeline": PIPELINE_VERSION, "generatedAt": iso(self.clock()), "pollSec": 300,
                    "feeds": feeds, "static": config.STATIC}
        atomic_write(os.path.join(self.data_dir, MANIFEST), json.dumps(manifest, indent=1).encode("utf-8"))
