"""In-memory per-IP fixed-window rate limiter. Single-process (matches
uvicorn --workers 1, like common/cache.py). Behind the Cloudflare Tunnel the
real client IP arrives in CF-Connecting-IP, not REMOTE_ADDR.
"""

import time

_MAX_KEYS = 10000
_buckets = {}  # (scope, ip) -> [window_start, count, window]


def reset():
    """Clear all buckets (tests)."""
    _buckets.clear()


def client_ip(request):
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        return cf
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def allow(request, *, scope, limit, window, now=time.monotonic):
    """Return True if this (scope, client-ip) is within `limit` requests per
    `window` seconds; False if it has hit the limit. Counts the request when True."""
    t = now()
    if len(_buckets) > _MAX_KEYS:  # opportunistic eviction, by each bucket's own window
        for k, b in list(_buckets.items()):
            if t - b[0] >= b[2]:
                del _buckets[k]
    key = (scope, client_ip(request))
    bucket = _buckets.get(key)
    if bucket is None or t - bucket[0] >= window:
        _buckets[key] = [t, 1, window]
        return True
    if bucket[1] >= limit:
        return False
    bucket[1] += 1
    return True
