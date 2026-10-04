"""Command line: python3 -m pipeline.run --data live --baseline public

Exit code 0: fine (feeds may be unchanged or have failed and kept their last copy; see the log and the manifest).
Exit code 2: a source's usage policy halted it, so a person needs to look. A scheduler shows this as a failed job.
"""
import argparse
import os
import sys

from . import config, net
from .feeds import BUILDERS
from .runner import Runner


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="the data folder to update (it also holds the runner's memory between runs)")
    ap.add_argument("--baseline", default="public", help="folder with cities.json (the places to fetch for)")
    ap.add_argument("--only", help="comma separated feed ids; default is every feed that is due")
    ap.add_argument("--force", action="store_true", help="ignore schedules (not halts)")
    ap.add_argument("--contact", default=os.environ.get("CONTACT_EMAIL"), help="contact address for the User-Agent (or set CONTACT_EMAIL)")
    ap.add_argument("--list", action="store_true", help="list the feeds and what their sources say, then exit")
    a = ap.parse_args(argv)
    if a.list:
        for f in config.FEEDS.values():
            print(f"{f.id:11} every {f.refresh_s // 60:>5} min, stale after {f.stale_s // 60:>5} min  {f.source}\n            {f.says}")
        return 0
    if not a.data:
        print("--data is required", file=sys.stderr)
        return 1
    if not a.contact or a.contact == "not set":
        print("A contact address is required: CelesTrak and MET Norway ask for identifying requests. Set CONTACT_EMAIL or pass --contact.", file=sys.stderr)
        return 1
    only = set(a.only.split(",")) if a.only else None
    unknown = (only or set()) - set(BUILDERS)
    if unknown:
        print(f"unknown feed ids: {sorted(unknown)}", file=sys.stderr)
        return 1
    summary = Runner(a.data, a.baseline, a.contact, BUILDERS).run(only=only, force=a.force)
    print(f"ok {len(summary['ok'])}, unchanged {len(summary['unchanged'])}, failed {len(summary['failed'])}, halted {len(summary['halted'])}, skipped {len(summary['skipped'])}")
    if summary["halted"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
