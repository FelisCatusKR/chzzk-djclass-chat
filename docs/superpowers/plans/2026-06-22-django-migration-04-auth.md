# Auth — Chzzk OAuth + Django sessions — Implementation Plan (migration plan 4/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Hand-rolled Chzzk OAuth login/logout on the custom `User` model, using Django's native DB-backed sessions and a custom auth backend, with `@login_required` gating — faithfully reproducing the Node app's flow (no django-allauth, per spec Decision 8).

**Architecture:** Port `src/lib/chzzk.ts` → `common/chzzk.py` (httpx, 8 s timeouts) and `src/lib/safe-redirect.ts` → `common/safe_redirect.py`. A `ChzzkBackend` resolves users by `chzzk_id` (no passwords). The OAuth init view stores `state`/`next` in the Django session and redirects to Chzzk; the callback validates `state` (timing-safe), exchanges the code, fetches the channel identity, upserts `User`+`Channel` (re-encrypting tokens via `common.crypto`), and calls `django.contrib.auth.login()`. Logout clears the session. **The two OAuth endpoint paths are preserved verbatim from the Node app** (`/api/auth/chzzk`, `/api/auth/chzzk/callback`) so the Chzzk-console-registered `redirect_uri` keeps working at cutover with zero console changes.

**Tech Stack:** Django 6.0 auth (`login`/`logout`/`@login_required`, custom `BaseBackend`), DB sessions, httpx (sync), pytest-httpx for HTTP mocking, `common.crypto` (AES-256-GCM).

---

> **Secret handling:** `CHZZK_CLIENT_ID`/`CHZZK_CLIENT_SECRET` are secrets. They are **not** needed for the build or the test suite (all Chzzk HTTP is mocked). They are only needed for a live OAuth round-trip (deferred — see "Live OAuth verification"). When the owner adds them to `.env.django`, that is done in the owner's own terminal; never echo their values.

## Reference: the Node flow being ported (authoritative)

- **Authorize URL:** `https://chzzk.naver.com/account-interlock?clientId=…&redirectUri={BASE_URL}/api/auth/chzzk/callback&state=…` (`src/lib/chzzk.ts:8-15`).
- **`state`:** 32 random bytes hex (64 chars), stored server-side, 10-min lifetime; validated by exact equality at callback (`src/app/api/auth/chzzk/route.ts:16`, `callback/route.ts:30`).
- **Token exchange:** `POST https://openapi.chzzk.naver.com/auth/v1/token`, JSON body `{grantType:"authorization_code", clientId, clientSecret, code, state}`; response `data.content ?? data` → `{accessToken, refreshToken, expiresIn||86400}` (`src/lib/chzzk.ts:17-50`).
- **Refresh:** same URL, body `{grantType:"refresh_token", clientId, clientSecret, refreshToken}` (`src/lib/chzzk.ts:52-81`).
- **Identity:** `GET https://openapi.chzzk.naver.com/open/v1/users/me`, header `Authorization: Bearer {accessToken}`; response `data.content || data` → `channelId`→`chzzk_id`, `channelName`→`chzzk_nickname` (`src/lib/chzzk.ts:83-106`).
- **Upsert (callback):** `users` upsert on `chzzk_id` updating only `chzzk_nickname`; `channels` upsert on `user_id` setting `chzzk_channel_id = channelId`, encrypted access/refresh tokens, `token_expires_at = now + expiresIn` (`src/app/api/auth/chzzk/callback/route.ts:50-80`).
- **Redirect:** success → `safeNextPath(next)` (fallback `/link`); failure / state-mismatch → `/?error=auth_failed` (`callback/route.ts:120,32`).
- **Deferred to Plan 7:** the callback's "auto-sync DJ CLASS if V-ARCHIVE already linked" block (`callback/route.ts:82-118`) depends on the varchive/sync subsystem. **Not built here.** A design note marks the extension point; migrated users keep their imported classes and the daily sync refreshes them.

---

### Task 1: `safe_next_path` (open-redirect guard) — TDD

Pure function port of `src/lib/safe-redirect.ts`. Dep-free warm-up. **Fallback differs deliberately:** the new app's logged-in home is `/dashboard/` (migrated users are already V-ARCHIVE-linked), so the default fallback is `/dashboard/` (Node used `/link`).

**Files:** Create `djclass_overlay/common/safe_redirect.py`, `djclass_overlay/common/tests/test_safe_redirect.py`.

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_safe_redirect.py`):

```python
from djclass_overlay.common.safe_redirect import safe_next_path


def test_valid_relative_path():
    assert safe_next_path("/dashboard/") == "/dashboard/"


def test_none_falls_back():
    assert safe_next_path(None) == "/dashboard/"
    assert safe_next_path("") == "/dashboard/"


def test_absolute_url_rejected():
    assert safe_next_path("https://evil.test/x") == "/dashboard/"


def test_non_slash_rejected():
    assert safe_next_path("dashboard") == "/dashboard/"


def test_protocol_relative_rejected():
    assert safe_next_path("//evil.test") == "/dashboard/"


def test_backslash_trick_rejected():
    assert safe_next_path("/\\evil.test") == "/dashboard/"


def test_custom_fallback():
    assert safe_next_path(None, fallback="/link/") == "/link/"
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError`).

Run: `uv run pytest djclass_overlay/common/tests/test_safe_redirect.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/common/safe_redirect.py`):

```python
"""Validate a `next` redirect target as a safe, same-origin relative path.

Port of src/lib/safe-redirect.ts. Rejects absolute and protocol-relative URLs
("//host", "/\\host") to prevent open redirects.
"""


def safe_next_path(next_path, fallback="/dashboard/"):
    if not next_path:
        return fallback
    if not next_path.startswith("/"):
        return fallback
    # Reject protocol-relative ("//") and backslash tricks ("/\") that browsers
    # may treat as a scheme-relative URL to another host.
    if next_path[1:2] in ("/", "\\"):
        return fallback
    return next_path
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_safe_redirect.py -q` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/common/safe_redirect.py djclass_overlay/common/tests/test_safe_redirect.py
git commit -m "feat(auth): safe_next_path open-redirect guard"
```

---

### Task 2: Settings — deps + Chzzk env + session/login config

Add the runtime + test deps and all auth-related settings **except** `AUTHENTICATION_BACKENDS` (deferred to Task 3, which creates the backend it references — otherwise `manage.py check` fails).

**Files:** Modify `pyproject.toml` (via uv), `config/settings/base.py`, `config/settings/production.py`.

- [ ] **Step 1: Add dependencies.**

```bash
uv add httpx
uv add --dev pytest-httpx
```

- [ ] **Step 2: Add settings to `config/settings/base.py`** — append at the end of the file:

```python
# --- Chzzk OAuth ---
# Secrets: not required for build/tests (Chzzk HTTP is mocked). Empty default keeps
# dev/test runs working; production.py re-reads CLIENT_ID/SECRET as required.
CHZZK_CLIENT_ID = env("CHZZK_CLIENT_ID", default="")
CHZZK_CLIENT_SECRET = env("CHZZK_CLIENT_SECRET", default="")
# Public origin used to build redirect_uri + the OAuth callback. No trailing slash.
BASE_URL = env("BASE_URL", default="http://localhost:8000")

# --- Auth / sessions ---
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/dashboard/"
LOGOUT_REDIRECT_URL = "/"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days, matching the legacy session cookie
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
```

- [ ] **Step 3: Harden cookies in `config/settings/production.py`** — append:

```python
# Secrets required in production (fail fast if unset).
CHZZK_CLIENT_ID = env("CHZZK_CLIENT_ID")
CHZZK_CLIENT_SECRET = env("CHZZK_CLIENT_SECRET")

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

- [ ] **Step 4: Verify** the project still checks out and the suite still passes:

```bash
uv run python manage.py check
uv run pytest -q
```

Expected: `System check identified no issues`, all existing tests pass.

- [ ] **Step 5: Commit.**

```bash
git add pyproject.toml uv.lock config/settings/base.py config/settings/production.py
git commit -m "chore(auth): add httpx + Chzzk OAuth/session settings"
```

> Owner note (out of band, optional, secret-bearing): for a live OAuth round-trip later, add `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, and `BASE_URL` to `.env.django` (copy the two secrets from the Node `.env`). Not needed for any task below.

---

### Task 3: `ChzzkBackend` auth backend — TDD

Resolves users by `chzzk_id` (no passwords). Required because `login()` needs a backend with `get_user()` to rehydrate the user each request. Keep `ModelBackend` too so the existing `/admin` superuser (password) still logs in.

**Files:** Create `djclass_overlay/users/backends.py`, `djclass_overlay/users/tests/test_backends.py`. Modify `config/settings/base.py`.

- [ ] **Step 1: Write the failing test** (`djclass_overlay/users/tests/test_backends.py`):

```python
import pytest

from djclass_overlay.users.backends import ChzzkBackend
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_authenticate_returns_user_by_chzzk_id():
    u = User.objects.create_user(chzzk_id="chan1", chzzk_nickname="N")
    assert ChzzkBackend().authenticate(None, chzzk_id="chan1") == u


@pytest.mark.django_db
def test_authenticate_unknown_returns_none():
    assert ChzzkBackend().authenticate(None, chzzk_id="nope") is None


@pytest.mark.django_db
def test_authenticate_without_chzzk_id_returns_none():
    assert ChzzkBackend().authenticate(None) is None


@pytest.mark.django_db
def test_authenticate_inactive_returns_none():
    User.objects.create_user(chzzk_id="chan2", chzzk_nickname="N", is_active=False)
    assert ChzzkBackend().authenticate(None, chzzk_id="chan2") is None


@pytest.mark.django_db
def test_get_user_roundtrip():
    u = User.objects.create_user(chzzk_id="chan3", chzzk_nickname="N")
    assert ChzzkBackend().get_user(u.pk) == u
    assert ChzzkBackend().get_user(999999) is None
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError`).

Run: `uv run pytest djclass_overlay/users/tests/test_backends.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/users/backends.py`):

```python
from django.contrib.auth.backends import BaseBackend

from .models import User


class ChzzkBackend(BaseBackend):
    """Authenticate a user by their Chzzk channel id (identity already proven by OAuth)."""

    def authenticate(self, request, chzzk_id=None, **kwargs):
        if not chzzk_id:
            return None
        try:
            return User.objects.get(chzzk_id=chzzk_id, is_active=True)
        except User.DoesNotExist:
            return None

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
```

- [ ] **Step 4: Wire `AUTHENTICATION_BACKENDS`** — append to `config/settings/base.py`:

```python
AUTHENTICATION_BACKENDS = [
    "djclass_overlay.users.backends.ChzzkBackend",
    "django.contrib.auth.backends.ModelBackend",  # /admin superuser login
]
```

- [ ] **Step 5: Run — expect pass.** `uv run pytest djclass_overlay/users/tests/test_backends.py -q` → all pass. Also `uv run python manage.py check`.

- [ ] **Step 6: Commit.**

```bash
git add djclass_overlay/users/backends.py djclass_overlay/users/tests/test_backends.py config/settings/base.py
git commit -m "feat(auth): ChzzkBackend (chzzk_id auth) + AUTHENTICATION_BACKENDS"
```

---

### Task 4: `common/chzzk.py` Chzzk OAuth client — TDD

Sync httpx port of `src/lib/chzzk.ts`. Snake_case return keys; **camelCase request bodies** (Chzzk requires it). 8 s timeout. `content` envelope tolerated (`data.get("content") or data`).

**Files:** Create `djclass_overlay/common/chzzk.py`, `djclass_overlay/common/tests/test_chzzk.py`.

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_chzzk.py`):

```python
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
    httpx_mock.add_response(url=TOKEN_URL, json={"accessToken": "A", "refreshToken": "R"})
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
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError`).

Run: `uv run pytest djclass_overlay/common/tests/test_chzzk.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/common/chzzk.py`):

```python
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
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_chzzk.py -q` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/common/chzzk.py djclass_overlay/common/tests/test_chzzk.py
git commit -m "feat(auth): Chzzk OAuth client (httpx port of chzzk.ts)"
```

---

### Task 5: OAuth views — `chzzk_login` + `chzzk_callback` + URLs — TDD

The init view generates `state`, stores `state`/`next` in the session, and redirects to Chzzk. The callback validates `state` (timing-safe), exchanges the code, fetches identity, upserts `User`+`Channel` (encrypting tokens), logs in, and redirects. Paths preserved: `/api/auth/chzzk`, `/api/auth/chzzk/callback` (no trailing slash — exact `redirect_uri` match).

**Files:** Create `djclass_overlay/users/views.py`, `djclass_overlay/users/urls.py`, `djclass_overlay/users/tests/test_oauth_views.py`. Modify `config/urls.py`.

- [ ] **Step 1: Write the failing test** (`djclass_overlay/users/tests/test_oauth_views.py`):

```python
import pytest

from djclass_overlay.common import chzzk, crypto
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


def test_login_sets_state_and_redirects(client, settings):
    settings.CHZZK_CLIENT_ID = "cid"
    settings.BASE_URL = "https://app.test"
    resp = client.get("/api/auth/chzzk", {"next": "/dashboard/"})
    assert resp.status_code == 302
    assert resp["Location"].startswith("https://chzzk.naver.com/account-interlock?")
    s = client.session
    assert len(s["oauth_state"]) == 64
    assert s["oauth_next"] == "/dashboard/"
    assert f"state={s['oauth_state']}" in resp["Location"]


@pytest.mark.django_db
def test_callback_creates_user_channel_and_logs_in(client, monkeypatch):
    monkeypatch.setattr(
        chzzk, "exchange_code_for_token",
        lambda code, state: {"access_token": "AT", "refresh_token": "RT", "expires_in": 86400},
    )
    monkeypatch.setattr(
        chzzk, "get_user_info",
        lambda access_token: {"user_id": "chan42", "nickname": "Streamer"},
    )
    s = client.session
    s["oauth_state"] = "STATE"
    s["oauth_next"] = "/dashboard/"
    s.save()

    resp = client.get("/api/auth/chzzk/callback", {"code": "CODE", "state": "STATE"})

    assert resp.status_code == 302
    assert resp["Location"] == "/dashboard/"
    u = User.objects.get(chzzk_id="chan42")
    assert u.chzzk_nickname == "Streamer"
    assert u.has_usable_password() is False
    ch = Channel.objects.get(user=u)
    assert ch.chzzk_channel_id == "chan42"
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "AT"
    assert crypto.decrypt(ch.chzzk_refresh_token_encrypted) == "RT"
    assert ch.token_expires_at is not None
    assert client.session["_auth_user_id"] == str(u.pk)


@pytest.mark.django_db
def test_callback_updates_existing_user_nickname(client, monkeypatch):
    User.objects.create_user(chzzk_id="chan42", chzzk_nickname="Old", preferred_button=6)
    monkeypatch.setattr(
        chzzk, "exchange_code_for_token",
        lambda code, state: {"access_token": "AT", "refresh_token": "RT", "expires_in": 86400},
    )
    monkeypatch.setattr(
        chzzk, "get_user_info",
        lambda access_token: {"user_id": "chan42", "nickname": "New"},
    )
    s = client.session
    s["oauth_state"] = "STATE"
    s.save()
    client.get("/api/auth/chzzk/callback", {"code": "CODE", "state": "STATE"})
    u = User.objects.get(chzzk_id="chan42")
    assert u.chzzk_nickname == "New"
    assert u.preferred_button == 6  # untouched


@pytest.mark.django_db
def test_callback_state_mismatch_redirects_to_error(client):
    s = client.session
    s["oauth_state"] = "GOOD"
    s.save()
    resp = client.get("/api/auth/chzzk/callback", {"code": "C", "state": "BAD"})
    assert resp.status_code == 302
    assert "error=auth_failed" in resp["Location"]
    assert User.objects.count() == 0


@pytest.mark.django_db
def test_callback_upstream_failure_redirects_to_error(client, monkeypatch):
    def boom(code, state):
        raise RuntimeError("chzzk down")

    monkeypatch.setattr(chzzk, "exchange_code_for_token", boom)
    s = client.session
    s["oauth_state"] = "STATE"
    s.save()
    resp = client.get("/api/auth/chzzk/callback", {"code": "C", "state": "STATE"})
    assert resp.status_code == 302
    assert "error=auth_failed" in resp["Location"]
    assert User.objects.count() == 0
```

- [ ] **Step 2: Run — expect fail** (404 / no URL).

Run: `uv run pytest djclass_overlay/users/tests/test_oauth_views.py -q`

- [ ] **Step 3: Implement the views** (`djclass_overlay/users/views.py`):

```python
import hmac
import logging
import secrets
from datetime import timedelta

from django.contrib.auth import login
from django.db import transaction
from django.shortcuts import redirect
from django.utils import timezone

from djclass_overlay.common import chzzk, crypto
from djclass_overlay.common.safe_redirect import safe_next_path
from djclass_overlay.streamers.models import Channel

from .models import User

logger = logging.getLogger(__name__)

_BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def chzzk_login(request):
    state = secrets.token_hex(32)  # 64 hex chars, like Node randomBytes(32).hex()
    request.session["oauth_state"] = state
    request.session["oauth_next"] = request.GET.get("next") or ""
    return redirect(chzzk.get_oauth_url(state))


def chzzk_callback(request):
    code = request.GET.get("code")
    state = request.GET.get("state")
    stored = request.session.get("oauth_state")
    if not code or not state or not stored or not hmac.compare_digest(state, stored):
        logger.warning("[OAuth] state mismatch or missing parameters")
        return redirect("/?error=auth_failed")

    try:
        tokens = chzzk.exchange_code_for_token(code, state)
        info = chzzk.get_user_info(tokens["access_token"])
        expires_at = timezone.now() + timedelta(seconds=tokens["expires_in"])

        with transaction.atomic():
            user, created = User.objects.update_or_create(
                chzzk_id=info["user_id"],
                defaults={"chzzk_nickname": info["nickname"]},
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])
            Channel.objects.update_or_create(
                user=user,
                defaults={
                    "chzzk_channel_id": info["user_id"],
                    "chzzk_access_token_encrypted": crypto.encrypt(tokens["access_token"]),
                    "chzzk_refresh_token_encrypted": crypto.encrypt(tokens["refresh_token"]),
                    "token_expires_at": expires_at,
                },
            )
        # NOTE(plan-7): the Node callback also auto-syncs DJ CLASS here when the
        # user already has an active V-ARCHIVE token. That depends on the sync
        # subsystem and is wired in Plan 7; migrated users keep their imported
        # classes meanwhile.

        next_path = safe_next_path(request.session.pop("oauth_next", None))
        request.session.pop("oauth_state", None)
        login(request, user, backend=_BACKEND)
        return redirect(next_path)
    except Exception:
        logger.exception("[OAuth] callback failed")
        return redirect("/?error=auth_failed")
```

- [ ] **Step 4: Add the URLs** (`djclass_overlay/users/urls.py`):

```python
from django.urls import path

from . import views

urlpatterns = [
    # Paths preserved verbatim from the Node app so the Chzzk-registered
    # redirect_uri keeps matching (no trailing slash).
    path("api/auth/chzzk", views.chzzk_login, name="chzzk_login"),
    path("api/auth/chzzk/callback", views.chzzk_callback, name="chzzk_callback"),
]
```

- [ ] **Step 5: Include them at the project root.** In `config/urls.py`, add `include` and a pattern (keep the existing `admin/` entry):

```python
from django.urls import include, path

# ... inside urlpatterns, alongside the admin entry:
    path("", include("djclass_overlay.users.urls")),
```

- [ ] **Step 6: Run — expect pass.** `uv run pytest djclass_overlay/users/tests/test_oauth_views.py -q` → all pass.

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/users/views.py djclass_overlay/users/urls.py djclass_overlay/users/tests/test_oauth_views.py config/urls.py
git commit -m "feat(auth): Chzzk OAuth login + callback views"
```

---

### Task 6: Session entry/exit + gating — `login_page` + `logout_view` + `dashboard` + templates — TDD

A minimal login landing (Chzzk button + `next` passthrough), a POST logout, and a `@login_required` dashboard proving end-to-end gating. Templates are intentionally minimal — **Plan 6 restyles them with daisyUI** (and may relocate the dashboard into the `streamers` app).

**Files:** Append to `djclass_overlay/users/views.py` and `djclass_overlay/users/urls.py`. Create `djclass_overlay/templates/base.html`, `djclass_overlay/templates/users/login.html`, `djclass_overlay/templates/users/dashboard.html`, `djclass_overlay/users/tests/test_session_views.py`.

- [ ] **Step 1: Write the failing test** (`djclass_overlay/users/tests/test_session_views.py`):

```python
import pytest

from djclass_overlay.users.models import User

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_login_page_renders_with_next(client):
    resp = client.get("/login/", {"next": "/dashboard/"})
    assert resp.status_code == 200
    assert b"/api/auth/chzzk" in resp.content


@pytest.mark.django_db
def test_login_page_redirects_when_authenticated(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="N")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/login/")
    assert resp.status_code == 302
    assert resp["Location"] == "/dashboard/"


def test_dashboard_requires_login(client):
    resp = client.get("/dashboard/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/dashboard/" in resp["Location"]


@pytest.mark.django_db
def test_dashboard_renders_for_authenticated_user(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="Streamer")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/dashboard/")
    assert resp.status_code == 200
    assert "Streamer".encode() in resp.content


@pytest.mark.django_db
def test_logout_clears_session(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="N")
    client.force_login(u, backend=BACKEND)
    assert "_auth_user_id" in client.session
    resp = client.post("/logout/")
    assert resp.status_code == 302
    assert "_auth_user_id" not in client.session


@pytest.mark.django_db
def test_logout_rejects_get(client):
    resp = client.get("/logout/")
    assert resp.status_code == 405
```

- [ ] **Step 2: Run — expect fail** (404 / no URL).

Run: `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 3: Append the views** to `djclass_overlay/users/views.py`:

```python
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.http import require_POST


def login_page(request):
    if request.user.is_authenticated:
        return redirect("/dashboard/")
    return render(request, "users/login.html", {"next": safe_next_path(request.GET.get("next"))})


@require_POST
def logout_view(request):
    logout(request)
    return redirect("/")


@login_required
def dashboard(request):
    return render(request, "users/dashboard.html")
```

> Add the three new imports (`logout`, `login_required`, `render`, `require_POST`) to the existing import block at the top of the file — `render` and `redirect` come from `django.shortcuts`. Keep imports tidy (no duplicates).

- [ ] **Step 4: Append the URLs** to `djclass_overlay/users/urls.py`:

```python
    path("login/", views.login_page, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("dashboard/", views.dashboard, name="dashboard"),
```

- [ ] **Step 5: Create the templates.**

`djclass_overlay/templates/base.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{% block title %}DJ CLASS Overlay{% endblock %}</title>
  </head>
  <body>
    {% block content %}{% endblock %}
  </body>
</html>
```

`djclass_overlay/templates/users/login.html`:

```html
{% extends "base.html" %}
{% block title %}로그인{% endblock %}
{% block content %}
  <h1>로그인</h1>
  <a href="{% url 'chzzk_login' %}?next={{ next|urlencode }}">치지직으로 로그인</a>
{% endblock %}
```

`djclass_overlay/templates/users/dashboard.html`:

```html
{% extends "base.html" %}
{% block title %}대시보드{% endblock %}
{% block content %}
  <h1>대시보드</h1>
  <p>{{ user.chzzk_nickname }}님, 환영합니다.</p>
  <form method="post" action="{% url 'logout' %}">
    {% csrf_token %}
    <button type="submit">로그아웃</button>
  </form>
{% endblock %}
```

- [ ] **Step 6: Run — expect pass.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q` → all pass.

- [ ] **Step 7: Full suite + check.** `uv run pytest -q` (all green) and `uv run python manage.py check`.

- [ ] **Step 8: Commit.**

```bash
git add djclass_overlay/users/views.py djclass_overlay/users/urls.py djclass_overlay/templates djclass_overlay/users/tests/test_session_views.py
git commit -m "feat(auth): login page, logout, login-gated dashboard"
```

---

## Live OAuth verification (owner-driven, deferred)

The build + suite fully exercise the flow with mocked Chzzk HTTP. A real round-trip is **optional now** and can wait until cutover (Plan 8), because it requires the Chzzk developer console to list the dev callback as an allowed `redirect_uri`. When desired:

1. Owner adds `CHZZK_CLIENT_ID`/`CHZZK_CLIENT_SECRET` (copy from Node `.env`) and `BASE_URL` to `.env.django`, in their own terminal.
2. Ensure the Chzzk console allows `{BASE_URL}/api/auth/chzzk/callback` (prod already lists `https://chatoverlay.felis.kr/api/auth/chzzk/callback`; a dev origin needs adding only for local end-to-end testing).
3. `uv run python manage.py runserver`, visit `/login/`, complete Chzzk auth, confirm redirect to `/dashboard/` showing the nickname, and that a `Channel` row now holds freshly-encrypted tokens.

---

## Deferred to Plan 8 — production hardening (from the final auth review)

The auth subsystem is functionally complete and secure for its own surface; these are global, deploy-time hardening items surfaced by the holistic review. They are deferred to Plan 8 (Deploy + Cutover) because they are cross-cutting and interact with subsystems not yet built (the widget's frame policy, the Cloudflare/reverse-proxy layer):

- **Security response headers:** add `django.middleware.clickjacking.XFrameOptionsMiddleware` + `X_FRAME_OPTIONS = "DENY"` — but coordinate with the OBS widget's framing needs (Plan 5/6) so embedding isn't broken; add `SECURE_HSTS_SECONDS` (+ `_INCLUDE_SUBDOMAINS`/`_PRELOAD`), `SECURE_CONTENT_TYPE_NOSNIFF`, and `SECURE_PROXY_SSL_HEADER`/`SECURE_SSL_REDIRECT` (behind Cloudflare Tunnel) to `production.py`.
- **Rate limiting on the OAuth endpoints:** the Node app rate-limited `/api/auth/chzzk` and `/api/auth/chzzk/callback` at 10 req/60 s per IP. Re-establish this before public exposure — via Cloudflare rules or `django-ratelimit`.

These do not block Plans 5–7; they are a Plan 8 checklist item.

---

## Self-Review

- **Spec coverage:** Decision 8 (hand-rolled Chzzk OAuth, no allauth) ✓; custom `User` + custom backend + DB sessions ✓; security checklist — `state`/CSRF via session + timing-safe compare ✓, exact `redirect_uri` (path preserved) ✓, safe `next` redirect ✓, encrypted token storage via `common.crypto` ✓, 8 s httpx timeouts ✓.
- **Deferred (documented, not silently dropped):** login-time DJ CLASS auto-sync → Plan 7 (extension-point note in `chzzk_callback`); daisyUI styling + dashboard relocation/`/link/` page → Plan 6; live OAuth round-trip → owner/Plan 8.
- **Placeholders:** none — every step has complete code.
- **Type/name consistency:** `chzzk.exchange_code_for_token`/`get_user_info`/`refresh_access_token` return `access_token`/`refresh_token`/`expires_in`; views consume exactly those keys; `Channel` fields match the model (`chzzk_channel_id`, `chzzk_access_token_encrypted`, `chzzk_refresh_token_encrypted`, `token_expires_at`); backend dotted path `djclass_overlay.users.backends.ChzzkBackend` identical in settings, views, and tests.
- **Ordering:** `AUTHENTICATION_BACKENDS` (Task 3) is added with the backend it names, never before — `manage.py check` stays green throughout.
- **Deliverable:** working Chzzk login → DB session → gated dashboard → logout, fully unit-tested without live secrets.
