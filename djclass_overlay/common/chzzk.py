"""Chzzk OAuth client. Port of src/lib/chzzk.ts (sync httpx, 8s timeout).

Request bodies use Chzzk's camelCase keys; returned dicts use snake_case.
"""

from urllib.parse import urlencode

import httpx
from django.conf import settings

AUTH_URL = "https://chzzk.naver.com/account-interlock"
TOKEN_URL = "https://openapi.chzzk.naver.com/auth/v1/token"
API_URL = "https://openapi.chzzk.naver.com/open/v1"
TIMEOUT = 8.0


def redirect_uri():
    return f"{settings.BASE_URL}/api/auth/chzzk/callback"


def get_oauth_url(state):
    params = {
        "clientId": settings.CHZZK_CLIENT_ID,
        "redirectUri": redirect_uri(),
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _token_payload(data):
    content = data.get("content") or data
    return {
        "access_token": content["accessToken"],
        "refresh_token": content["refreshToken"],
        "expires_in": int(content.get("expiresIn") or 86400),
    }


def exchange_code_for_token(code, state):
    resp = httpx.post(
        TOKEN_URL,
        json={
            "grantType": "authorization_code",
            "clientId": settings.CHZZK_CLIENT_ID,
            "clientSecret": settings.CHZZK_CLIENT_SECRET,
            "code": code,
            "state": state,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return _token_payload(resp.json())


def refresh_access_token(refresh_token):
    resp = httpx.post(
        TOKEN_URL,
        json={
            "grantType": "refresh_token",
            "clientId": settings.CHZZK_CLIENT_ID,
            "clientSecret": settings.CHZZK_CLIENT_SECRET,
            "refreshToken": refresh_token,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return _token_payload(resp.json())


def get_user_info(access_token):
    resp = httpx.get(
        f"{API_URL}/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data.get("content") or data
    return {"user_id": content["channelId"], "nickname": content["channelName"]}


async def get_session_url(access_token):
    """GET the Chzzk chat session URL and append the auth token as a query param.

    Port of chat-proxy.ts:38 + :206 (and ~/chzzk-spike/chzzk.py). Don't double-append.
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"{API_URL}/sessions/auth",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()
        url = (data.get("content") or data)["url"]
    if "?auth=" not in url:
        url += ("&" if "?" in url else "?") + f"auth={access_token}"
    return url


async def subscribe_chat(access_token, session_key):
    """POST to subscribe the session to CHAT events. Port of chat-proxy.ts:59."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{API_URL}/sessions/events/subscribe/chat",
            params={"sessionKey": session_key},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
