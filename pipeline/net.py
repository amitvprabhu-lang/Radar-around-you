"""One polite HTTP GET. No retries here (the runner decides), no silent redirects, gzip handled, size capped."""
import gzip
import urllib.error
import urllib.request

from . import PIPELINE_VERSION


class FetchError(Exception):
    """The request did not complete at all: timeout, DNS, reset, or a body over the size limit."""


class Response:
    __slots__ = ("status", "headers", "body", "url")

    def __init__(self, status, headers, body, url):
        self.status, self.headers, self.body, self.url = status, headers, body, url

    def header(self, name, default=None):
        return self.headers.get(name.lower(), default)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # CelesTrak's policy treats a 301 as a sign of a long-outdated URL, so a redirect is reported, never followed quietly.
    def redirect_request(self, *args, **kwargs):
        return None


def user_agent(contact):
    return f"RadarAroundYou-pipeline/{PIPELINE_VERSION} (contact: {contact})"


def fetch(url, headers=None, timeout=60, max_bytes=40_000_000, follow_redirects=False):
    handlers = [] if follow_redirects else [_NoRedirect()]
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip", **(headers or {})})
    try:
        with opener.open(req, timeout=timeout) as r:
            return _finish(r.status, r.headers, r, url, max_bytes)
    except urllib.error.HTTPError as e:  # 3xx, 4xx and 5xx all arrive here; the caller decides what they mean
        try:
            return _finish(e.code, e.headers, e, url, max_bytes)
        except FetchError:
            return Response(e.code, {k.lower(): v for k, v in e.headers.items()}, b"", url)
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise FetchError(f"{type(e).__name__}: {e}") from e


def _finish(status, hdrs, stream, url, max_bytes):
    try:
        body = stream.read(max_bytes + 1)
    except (TimeoutError, ConnectionError, OSError) as e:
        raise FetchError(f"{type(e).__name__} while reading the body: {e}") from e
    if len(body) > max_bytes:
        raise FetchError(f"response larger than {max_bytes} bytes")
    headers = {k.lower(): v for k, v in hdrs.items()}
    if headers.get("content-encoding", "").lower() == "gzip" and body:
        try:
            body = gzip.decompress(body)
        except OSError as e:
            raise FetchError(f"bad gzip body: {e}") from e
    return Response(status, headers, body, url)
