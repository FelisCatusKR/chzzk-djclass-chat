import json

from djclass_overlay.common import chzzk

TOKEN_URL = "https://openapi.chzzk.naver.com/auth/v1/token"
ME_URL = "https://openapi.chzzk.naver.com/open/v1/users/me"


def test_get_oauth_url(settings):
    settings.CHZZK_CLIENT_ID = "cid"
    settings.BASE_URL = "https://app.test"
    url = chzzk.get_oauth_url("STATE123")
    assert url.startswith("https://chzzk.naver.com/account-interlock?")
    assert "clientId=cid" in url
    assert "redirectUri=https%3A%2F%2Fapp.test%2Fapi%2Fauth%2Fchzzk%2Fcallback" in url
    assert "state=STATE123" in url


def test_exchange_code_for_token(httpx_mock, settings):
    settings.CHZZK_CLIENT_ID = "cid"
    settings.CHZZK_CLIENT_SECRET = "sec"
    httpx_mock.add_response(
        url=TOKEN_URL,
        json={"content": {"accessToken": "A", "refreshToken": "R", "expiresIn": 3600}},
    )
    out = chzzk.exchange_code_for_token("CODE", "STATE")
    assert out == {"access_token": "A", "refresh_token": "R", "expires_in": 3600}
    body = json.loads(httpx_mock.get_request().content)
    assert body == {
        "grantType": "authorization_code",
        "clientId": "cid",
        "clientSecret": "sec",
        "code": "CODE",
        "state": "STATE",
    }


def test_exchange_flat_envelope_and_default_expiry(httpx_mock, settings):
    # No `content` wrapper, missing expiresIn -> default 86400.
    httpx_mock.add_response(
        url=TOKEN_URL, json={"accessToken": "A", "refreshToken": "R"}
    )
    out = chzzk.exchange_code_for_token("CODE", "STATE")
    assert out == {"access_token": "A", "refresh_token": "R", "expires_in": 86400}


def test_refresh_access_token(httpx_mock, settings):
    settings.CHZZK_CLIENT_ID = "cid"
    settings.CHZZK_CLIENT_SECRET = "sec"
    httpx_mock.add_response(
        url=TOKEN_URL,
        json={"content": {"accessToken": "A2", "refreshToken": "R2", "expiresIn": 100}},
    )
    out = chzzk.refresh_access_token("OLD_REFRESH")
    assert out == {"access_token": "A2", "refresh_token": "R2", "expires_in": 100}
    body = json.loads(httpx_mock.get_request().content)
    assert body == {
        "grantType": "refresh_token",
        "clientId": "cid",
        "clientSecret": "sec",
        "refreshToken": "OLD_REFRESH",
    }


def test_get_user_info(httpx_mock):
    httpx_mock.add_response(
        url=ME_URL,
        json={"content": {"channelId": "chan9", "channelName": "Nick"}},
    )
    out = chzzk.get_user_info("ACCESS")
    assert out == {"user_id": "chan9", "nickname": "Nick"}
    req = httpx_mock.get_request()
    assert req.headers["Authorization"] == "Bearer ACCESS"
