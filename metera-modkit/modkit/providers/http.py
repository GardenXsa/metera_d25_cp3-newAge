"""Stdlib HTTP helper used by every provider.

We avoid the ``requests`` dependency so the produced .exe stays small
and dependency-free. Returns ``(status_code, json_or_text)``.
"""

from __future__ import annotations

import gzip
import io
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from modkit.ssl_helpers import ssl_context as _ssl_context


def get_json(
    url: str,
    headers: dict[str, str],
    timeout: int = 120,
) -> tuple[int, Any]:
    req = Request(url, method="GET")
    merged = {"Accept": "application/json"}
    merged.update(headers)
    for key, value in merged.items():
        req.add_header(key, value)
    ctx = _ssl_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
            text = raw.decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(text)
            except json.JSONDecodeError:
                return resp.status, {"_raw": text}
    except HTTPError as exc:
        raw = exc.read()
        text = raw.decode("utf-8", errors="replace") if raw else ""
        try:
            return exc.code, json.loads(text)
        except json.JSONDecodeError:
            return exc.code, {"_raw": text}
    except URLError as exc:
        raise ConnectionError(f"network error: {exc.reason}") from exc



def post_json(
    url: str,
    headers: dict[str, str],
    body: dict[str, Any] | list[Any],
    timeout: int = 120,
) -> tuple[int, Any]:
    """POST a JSON body, parse a JSON response. Always returns ``(status, parsed)``.

    On HTTP errors we still try to JSON-decode the body so callers get
    structured error info from APIs.
    """
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method="POST")
    merged = {"Content-Type": "application/json"}
    merged.update(headers)
    for key, value in merged.items():
        req.add_header(key, value)
    ctx = _ssl_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:  # noqa: S310 - explicit URL
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
            text = raw.decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(text)
            except json.JSONDecodeError:
                return resp.status, {"_raw": text}
    except HTTPError as exc:
        raw = exc.read()
        text = raw.decode("utf-8", errors="replace") if raw else ""
        try:
            return exc.code, json.loads(text)
        except json.JSONDecodeError:
            return exc.code, {"_raw": text}
    except URLError as exc:
        raise ConnectionError(f"network error: {exc.reason}") from exc
