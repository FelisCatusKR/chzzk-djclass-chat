"""V-ARCHIVE open API client. Token-less: the 조회토큰 is used ONCE (lookup_user)
to verify ownership and capture {userNo, nickname}; all ongoing DJ CLASS sync uses
the PUBLIC nickname endpoint, so no token is stored. Port of src/lib/varchive.ts.

Sync httpx with an 8s timeout, mirroring common/chzzk.py.
"""

from urllib.parse import quote

import httpx

BASE_URL = "https://v-archive.net"
TIMEOUT = 8.0
BUTTONS = [4, 5, 6, 8]  # DJMAX button modes (there is no 7-button mode)


class VarchiveError(Exception):
    """A V-ARCHIVE request failed (network, timeout, or unexpected status)."""


class InvalidTokenError(VarchiveError):
    """The 조회토큰 was rejected (HTTP 401 or success=false)."""


def lookup_user(token):
    """Verify a 조회토큰; return {"user_no": int, "nickname": str}.

    GET /api/v2/open-token/user with Authorization: Bearer <token>. Called ONCE at
    link time; the token is NOT persisted afterward. Port of varchive.ts:lookupUser.
    """
    try:
        resp = httpx.get(
            f"{BASE_URL}/api/v2/open-token/user",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise VarchiveError("V-ARCHIVE request failed") from exc
    if resp.status_code == 401:
        raise InvalidTokenError
    try:
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise VarchiveError(f"V-ARCHIVE API error: {resp.status_code}") from exc
    data = resp.json()
    user_no = data.get("userNo")
    nickname = data.get("nickname")
    if not data.get("success") or user_no is None or nickname is None:
        raise InvalidTokenError
    return {"user_no": user_no, "nickname": nickname}


def get_dj_class(nickname, button):
    """GET the public DJ CLASS for one button. Port of varchive.ts:getDjClass.

    GET /api/v2/archive/<nickname>/djClass/<button> (no token). Raises VarchiveError
    on any non-200 (e.g. 404 = no record for that button).
    """
    try:
        resp = httpx.get(
            f"{BASE_URL}/api/v2/archive/{quote(nickname, safe='')}/djClass/{button}",
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise VarchiveError(f"V-ARCHIVE DJ CLASS API error (button {button})") from exc
    return resp.json()


def get_all_dj_classes(nickname):
    """Fetch buttons [4,5,6,8] in turn, skipping any that fail or lack a class.

    Returns a list of dicts:
    {button, djClass, djPowerSum, maxDjPower, djPowerConversion}.
    A total failure (stale nickname / V-ARCHIVE down) yields [].
    Port of getAllDjClasses.
    """
    out = []
    for button in BUTTONS:
        try:
            result = get_dj_class(nickname, button)
        except VarchiveError:
            continue
        if result.get("success") and result.get("djClass"):
            out.append(
                {
                    "button": button,
                    "djClass": result["djClass"],
                    "djPowerSum": result.get("djPowerSum"),
                    "maxDjPower": result.get("maxDjPower"),
                    "djPowerConversion": result.get("djPowerConversion"),
                }
            )
    return out
