from djclass_overlay.common.cache import TTLCache


def test_set_get_roundtrip():
    clock = [1000.0]
    c = TTLCache(now=lambda: clock[0])
    c.set("k", {"v": 1}, ttl_seconds=10)
    assert c.get("k") == {"v": 1}


def test_expiry():
    clock = [1000.0]
    c = TTLCache(now=lambda: clock[0])
    c.set("k", "v", ttl_seconds=10)
    clock[0] = 1009.9
    assert c.get("k") == "v"  # not yet expired
    clock[0] = 1010.1
    assert c.get("k") is None  # expired, evicted


def test_invalidate():
    c = TTLCache(now=lambda: 0.0)
    c.set("k", "v", ttl_seconds=100)
    c.invalidate("k")
    assert c.get("k") is None


def test_max_entries_eviction():
    clock = [0.0]
    c = TTLCache(max_entries=2, now=lambda: clock[0])
    c.set("a", 1, 100)
    c.set("b", 2, 100)
    c.set("c", 3, 100)  # over capacity → one old entry dropped
    present = [k for k in ("a", "b", "c") if c.get(k) is not None]
    assert present == ["c"] or len(present) == 2
