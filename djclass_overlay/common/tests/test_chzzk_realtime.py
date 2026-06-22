from asgiref.sync import async_to_sync

from djclass_overlay.common import chzzk

SESSION_URL = "https://openapi.chzzk.naver.com/open/v1/sessions/auth"
SUBSCRIBE_URL = "https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat"


def test_get_session_url_appends_auth(httpx_mock):
    httpx_mock.add_response(
        url=SESSION_URL, json={"content": {"url": "wss://ssio.chzzk.naver.com/abc"}}
    )
    url = async_to_sync(chzzk.get_session_url)("TOK")
    assert url == "wss://ssio.chzzk.naver.com/abc?auth=TOK"
    assert httpx_mock.get_request().headers["Authorization"] == "Bearer TOK"


def test_get_session_url_uses_ampersand_when_query_present(httpx_mock):
    httpx_mock.add_response(
        url=SESSION_URL, json={"content": {"url": "wss://host/x?foo=1"}}
    )
    url = async_to_sync(chzzk.get_session_url)("TOK")
    assert url == "wss://host/x?foo=1&auth=TOK"


def test_get_session_url_no_double_append(httpx_mock):
    httpx_mock.add_response(
        url=SESSION_URL, json={"content": {"url": "wss://host/x?auth=already"}}
    )
    url = async_to_sync(chzzk.get_session_url)("TOK")
    assert url == "wss://host/x?auth=already"


def test_subscribe_chat_posts_session_key(httpx_mock):
    httpx_mock.add_response(method="POST", url=f"{SUBSCRIBE_URL}?sessionKey=KEY1", json={})
    async_to_sync(chzzk.subscribe_chat)("TOK", "KEY1")
    req = httpx_mock.get_request()
    assert req.method == "POST"
    assert req.headers["Authorization"] == "Bearer TOK"
