"""One builder per feed. A builder fetches through ctx.get, validates, and returns the files to publish.

It raises Unchanged when the source has nothing new, FeedFailure for a bad or missing answer (the runner keeps the
last good copy), and Halt when a usage policy says to stop.
"""
import gzip
import json
from datetime import datetime, timezone

from . import catalogue as CAT
from . import config, pack, validate
from .runner import FeedFailure, Result, Unchanged, dumps, iso, parse

F = config.FEEDS
PAUSE_S = 3  # between requests to the same policy source (the first build used the same pause)


# ---------------------------------------------------------------- single-request feeds
def quakes(ctx):
    r = ctx.get("quakes", F["quakes"].url, conditional=True)
    try:
        data, rep = validate.quakes(r.body, ctx.now)
    except validate.ValidationError as e:
        raise FeedFailure(str(e))
    return Result({"quakes.json": dumps(data)}, len(data["events"]), data["generated"], f"{rep['dropped']} invalid events dropped" if rep["dropped"] else "")


def aurora(ctx):
    r = ctx.get("aurora", F["aurora"].url, conditional=True)
    try:
        meta, grid = validate.aurora(r.body)
    except validate.ValidationError as e:
        raise FeedFailure(str(e))
    return Result({"aurora.bin": grid, "aurora.json": dumps(meta)}, sum(1 for v in grid if v), meta["observation"])


def kp(ctx):
    r = ctx.get("kp", F["kp"].url, conditional=True)
    try:
        rows = validate.kp(r.body)
    except validate.ValidationError as e:
        raise FeedFailure(str(e))
    return Result({"kp.json": dumps(rows)}, len(rows), rows[-1]["t"] + "Z")


def events(ctx):
    pages, base = [], F["events"].url
    for levels in ("Orange;Red", "Green"):
        for page in range(1, 4):  # the API's page size is capped at 100, so a full page means read the next one
            url = f"{base}?eventlist={config.GDACS_TYPES}&alertlevel={levels}&pageSize={config.GDACS_PAGE_SIZE}&pageNumber={page}"
            r = ctx.get("events", url, key=f"{levels}:{page}")
            try:
                d = json.loads(r.body)
            except ValueError as e:
                raise FeedFailure(f"events: not valid JSON ({e})")
            pages.append(d)
            if not isinstance(d, dict) or len(d.get("features", [])) < config.GDACS_PAGE_SIZE:
                break
            ctx.sleep(1)
        ctx.sleep(1)
    try:
        evs, rep = validate.gdacs(pages, ctx.now)
    except validate.ValidationError as e:
        raise FeedFailure(str(e))
    prev = ctx.previous_json("events", "events.json")
    if not evs and prev:
        raise FeedFailure(f"events: the answer had no usable events but the last good copy had {len(prev)}")
    modified = rep["modified"] and iso(validate.parse_iso(rep["modified"]))  # when GDACS last changed any listed event
    reds = sum(1 for e in evs if e["alert"] == "Red")
    return Result({"events.json": dumps(evs)}, len(evs), modified,
                  f"{reds} red, {sum(1 for e in evs if e['alert'] == 'Orange')} orange" + (f", {rep['dropped']} invalid dropped" if rep["dropped"] else ""))


# ---------------------------------------------------------------- one request per place
def _per_city(ctx, feed_id, url_for, check, name, conditional, honour_expires):
    prev = ctx.previous_json(feed_id, name) or {"cities": {}}
    out, failed, refreshed = dict(prev.get("cities", {})), [], 0
    first = True
    for c in ctx.cities():
        key = f"city:{c['id']}"
        exp = ctx.expires_of(feed_id, key)
        if honour_expires and exp and ctx.now < exp and c["id"] in out:
            continue  # the source asked us not to repeat before its Expires time
        if not first:
            ctx.sleep(1)
        first = False
        try:
            r = ctx.get(feed_id, url_for(c), key=key, conditional=conditional)
            data = check(r.body)
        except Unchanged:
            continue
        except (FeedFailure, validate.ValidationError) as e:
            failed.append(f"{c['id']}: {e}")
            continue
        data["fetchedAt"] = iso(ctx.clock())
        out[c["id"]] = data
        refreshed += 1
    if not refreshed:
        if failed:
            raise FeedFailure("; ".join(failed))
        raise Unchanged()
    known = {c["id"] for c in ctx.cities()}
    out = {k: v for k, v in out.items() if k in known}
    note = f"{refreshed} of {len(known)} places refreshed" + (f"; kept the last copy for {len(failed)} that failed ({failed[0]})" if failed else "")
    return out, note


def clouds(ctx):
    out, note = _per_city(ctx, "clouds", lambda c: f"{F['clouds'].url}?lat={c['lat']:.4f}&lon={c['lon']:.4f}",
                          validate.clouds, "clouds.json", conditional=True, honour_expires=True)
    newest = max(v["updated"] for v in out.values())
    return Result({"clouds.json": dumps({"cities": out})}, len(out), newest, note)


def planes(ctx):
    out, note = _per_city(ctx, "planes", lambda c: f"{F['planes'].url}/{c['lat']}/{c['lon']}/{config.PLANES_RADIUS_NM}",
                          validate.planes, "planes.json", conditional=False, honour_expires=False)
    newest = max(v["time"] for v in out.values())
    return Result({"planes.json": dumps({"cities": out})}, sum(len(v["aircraft"]) for v in out.values()), newest, note)


# ---------------------------------------------------------------- CelesTrak
GP_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=json"
SATCAT_URL = "https://celestrak.org/satcat/records.php?GROUP={g}&FORMAT=json"
SATCAT_MIN_ACTIVE = 5000   # OURS: sanity bounds. The first build saw 17,141 active records and 16,633 GP records.
GP_MIN_ACTIVE = 5000
MAX_COUNT_DROP = 0.3       # OURS: a new satellite file with 30 percent fewer objects than the last one is rejected


def _list(r, what, minimum):
    try:
        d = json.loads(r.body)
    except ValueError as e:
        raise FeedFailure(f"{what}: not valid JSON ({e})")
    if not isinstance(d, list) or len(d) < minimum:
        raise FeedFailure(f"{what}: {len(d) if isinstance(d, list) else 'not a list'} records, expected at least {minimum}")
    return d


def catalogue(ctx):
    """Once a day: SATCAT for active objects and every purpose group, the owner and launch-site tables, the debris GP groups."""
    sat = _list(ctx.get("catalogue", SATCAT_URL.format(g="active"), key="satcat:active"), "SATCAT active", SATCAT_MIN_ACTIVE)
    groups = {}
    for g in CAT.GROUPS:
        ctx.sleep(PAUSE_S)
        groups[g] = _list(ctx.get("catalogue", SATCAT_URL.format(g=g), key=f"satcat:{g}"), f"SATCAT {g}", 0)
    tables = {}
    for name, url, header, minimum in (("owners", "https://celestrak.org/satcat/sources.php", "Source Code", 50),
                                       ("sites", "https://celestrak.org/satcat/launchsites.php", "Launch Site Codes", 20)):
        ctx.sleep(PAUSE_S)
        r = ctx.get("catalogue", url, key=name)
        tables[name] = CAT.name_table(r.body.decode("utf-8", errors="ignore"), header)
        if len(tables[name]) < minimum:
            raise FeedFailure(f"{name} table: {len(tables[name])} rows, expected at least {minimum}")
    debris = {}
    for g in CAT.DEBRIS_GROUPS:
        ctx.sleep(PAUSE_S)
        debris[g] = _list(ctx.get("catalogue", GP_URL.format(g=g), key=f"gp:{g}"), f"GP {g}", 1)
    cat = CAT.build(sat, groups, tables["owners"], tables["sites"], iso(ctx.now))
    files = {"catalogue.json.gz": gzip.compress(dumps(cat), 9, mtime=0), "debris.json.gz": gzip.compress(dumps(debris), 9, mtime=0)}
    return Result(files, len(cat["objects"]), iso(ctx.now), f"{len(groups)} groups, {len(tables['owners'])} owners, {len(tables['sites'])} launch sites", private=True)


def satellites(ctx):
    cat = ctx.private_json("catalogue.json.gz")
    if not cat:
        raise FeedFailure("the satellite catalogue has not been built yet (it is fetched first, once a day)")
    debris = ctx.private_json("debris.json.gz") or {}
    got = {}
    for i, g in enumerate(("active", "stations", "visual")):
        if i:
            ctx.sleep(PAUSE_S)
        got[g] = _list(ctx.get("satellites", GP_URL.format(g=g), key=f"gp:{g}"), f"GP {g}", GP_MIN_ACTIVE if g == "active" else 1)
    ref_ms = int(ctx.clock().timestamp() * 1000)
    sources = [got["active"]] + [debris[g] for g in sorted(debris)]
    files, meta, rep = pack.pack_satellites(sources, got["stations"], got["visual"], cat, ref_ms, iso(ctx.clock()))
    h = meta["health"]
    invalid = sum(h["invalidDropped"].values())
    if meta["count"] < GP_MIN_ACTIVE or invalid > 0.2 * h["recordsRead"]:
        raise FeedFailure(f"satellites: only {meta['count']} of {h['recordsRead']} records were usable ({invalid} invalid)")
    prev = ctx.fs("satellites").get("count")
    if prev and meta["count"] < prev * (1 - MAX_COUNT_DROP):
        raise FeedFailure(f"satellites: object count fell from {prev} to {meta['count']}")
    files["satmeta.json"] = dumps(meta)
    newest = iso(datetime.fromtimestamp(rep["newest_epoch"] / 1000, timezone.utc))
    return Result(files, meta["count"], newest, f"{rep['precise']} exact orbits, {rep['new']} launched in the last 30 days, median element age {h['ageHours']['median']} h")


BUILDERS = {"catalogue": catalogue, "satellites": satellites, "quakes": quakes, "events": events,
            "aurora": aurora, "kp": kp, "clouds": clouds, "planes": planes}
