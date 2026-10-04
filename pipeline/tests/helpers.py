import gzip
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

from .. import net

HERE = os.path.dirname(__file__)
UTC = timezone.utc
NOW = datetime(2026, 10, 4, 18, 30, tzinfo=UTC)


def fx(name):
    with open(os.path.join(HERE, "fixtures", name), "rb") as f:
        data = f.read()
    return gzip.decompress(data) if name.endswith(".gz") else data


def fxj(name):
    return json.loads(fx(name))


def resp(status=200, body=b"", **headers):
    return net.Response(status, {k.replace("_", "-"): v for k, v in headers.items()}, body if isinstance(body, bytes) else body.encode(), "x")


class Clock:
    def __init__(self, start=NOW):
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


class FakeNet:
    """Stands in for pipeline.net.fetch. Routes are matched by the longest URL prefix; a list is consumed in order, the last item repeats."""

    def __init__(self):
        self.routes, self.calls = [], []

    def add(self, prefix, answer):
        self.routes.append((prefix, answer if isinstance(answer, list) else [answer]))
        self.routes.sort(key=lambda r: -len(r[0]))
        return self

    def count(self, prefix=""):
        return sum(1 for c in self.calls if c[0].startswith(prefix))

    def __call__(self, url, headers=None, timeout=60, max_bytes=0, follow_redirects=False):
        self.calls.append((url, dict(headers or {}), follow_redirects))
        for prefix, answers in self.routes:
            if url.startswith(prefix):
                a = answers.pop(0) if len(answers) > 1 else answers[0]
                if isinstance(a, Exception):
                    raise a
                return a(url, headers) if callable(a) else a
        raise AssertionError(f"unexpected request: {url}")


def workdir():
    d = tempfile.TemporaryDirectory()
    base = os.path.join(d.name, "baseline")
    os.makedirs(base)
    with open(os.path.join(base, "cities.json"), "w") as f:
        json.dump([{"id": "pune", "name": "Pune", "lat": 18.5204, "lon": 73.8567}, {"id": "london", "name": "London", "lat": 51.5074, "lon": -0.1278}], f)
    return d, os.path.join(d.name, "data"), base
