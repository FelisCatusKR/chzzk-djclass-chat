from djclass_overlay.common import ratelimit


class _Req:
    def __init__(self, headers=None, remote="1.2.3.4"):
        self.headers = headers or {}
        self.META = {"REMOTE_ADDR": remote}


def test_client_ip_prefers_cf_connecting_ip():
    req = _Req(headers={"CF-Connecting-IP": "9.9.9.9", "X-Forwarded-For": "8.8.8.8"})
    assert ratelimit.client_ip(req) == "9.9.9.9"


def test_client_ip_falls_back_to_xff_then_remote():
    assert ratelimit.client_ip(_Req(headers={"X-Forwarded-For": "8.8.8.8, 7.7.7.7"})) == "8.8.8.8"
    assert ratelimit.client_ip(_Req()) == "1.2.3.4"


def test_allow_enforces_fixed_window():
    ratelimit.reset()
    clock = [1000.0]
    req = _Req(headers={"CF-Connecting-IP": "5.5.5.5"})
    ok = [ratelimit.allow(req, scope="t", limit=2, window=60, now=lambda: clock[0]) for _ in range(3)]
    assert ok == [True, True, False]
    clock[0] += 61
    assert ratelimit.allow(req, scope="t", limit=2, window=60, now=lambda: clock[0]) is True


def test_allow_is_per_ip_and_per_scope():
    ratelimit.reset()
    a = _Req(headers={"CF-Connecting-IP": "1.1.1.1"})
    b = _Req(headers={"CF-Connecting-IP": "2.2.2.2"})
    assert ratelimit.allow(a, scope="t", limit=1, window=60) is True
    assert ratelimit.allow(a, scope="t", limit=1, window=60) is False
    assert ratelimit.allow(b, scope="t", limit=1, window=60) is True
    assert ratelimit.allow(a, scope="u", limit=1, window=60) is True
