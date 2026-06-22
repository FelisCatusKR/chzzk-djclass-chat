"""Tiny per-entry-TTL cache (port of src/lib/cache.ts). In-memory, single process.

Used by the badge resolver to avoid re-querying the DB for a chatter's class on
every flush. Per-entry TTL because linked / unsynced / unlinked results live for
different durations. Clock is injectable for deterministic tests.
"""

import time


class TTLCache:
    def __init__(self, max_entries=10000, now=time.monotonic):
        self._store = {}  # key -> (expiry_ts, value), insertion-ordered
        self._max = max_entries
        self._now = now

    def get(self, key):
        item = self._store.get(key)
        if item is None:
            return None
        expiry, value = item
        if expiry <= self._now():
            self._store.pop(key, None)
            return None
        return value

    def set(self, key, value, ttl_seconds):
        if key not in self._store and len(self._store) >= self._max:
            # Evict the oldest inserted entry (dict preserves insertion order).
            self._store.pop(next(iter(self._store)), None)
        self._store[key] = (self._now() + ttl_seconds, value)

    def invalidate(self, key):
        self._store.pop(key, None)

    def clear(self):
        self._store.clear()
