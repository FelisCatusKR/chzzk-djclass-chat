# Sync + Viewer Link Page — Implementation Plan (migration plan 7/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the viewer-facing **DJ CLASS linking + sync** feature: a real `/link` page (replacing the Plan 6 placeholder) where a viewer verifies their V-ARCHIVE account once, syncs their DJ CLASS per button, and picks a preferred button — plus the V-ARCHIVE client, the per-user sync core, and the daily `sync_djclass` management command.

**Architecture:** The `/link` page is server-rendered Django with **htmx partial swaps** — each action (`연동하기` / `동기화` / `연동 해제` / button pick) is an `hx-post` to a small view that returns the `#link-card` **Django 6.0 template partial** (`{% partialdef link_card inline %}`), swapped in place with no full reload. V-ARCHIVE is **token-less**: the 조회토큰 is used once (`lookup_user`) to capture `{userNo, nickname}`, then discarded — all ongoing sync hits the **public nickname endpoint**, so no V-ARCHIVE secret is stored. All the rank/threshold/theory/selection logic already exists in `djclass/badges.py` + `djclass/resolver.py` and is reused unchanged.

**Tech Stack:** Django 6.0.6 (built-in template partials), htmx 2.0.4 (already loaded; `hx-post` + body-level `hx-headers` CSRF), `httpx` (8s timeout, mirroring `common/chzzk.py`), pytest-django + pytest-httpx.

---

## Decisions baked in (from brainstorming, 2026-06-23)

- **Interaction model — htmx partial swaps.** Each link-page action `hx-post`s to a view returning the `#link-card` fragment (Django 6.0 `{% partialdef link_card inline %}`, verified to resolve via `render(request, "viewers/link.html#link_card", ctx)` against the installed Django 6.0.6). This is the app's **first** `hx-post` + CSRF-for-htmx; chosen over plain-form PRG for the no-reload UX, keeping all logic server-side in Python.
- **Token-less V-ARCHIVE** (supersedes master design Decision 3 / §4.2 / §4.7 for V-ARCHIVE tokens). The 조회토큰 only ever calls `lookup_user` once (ownership check + `{userNo, nickname}`); it is **never stored**. The `VarchiveToken` model **drops `token_encrypted`** and **adds `varchive_user_no`**. Sync uses the **public** `GET /api/v2/archive/<nickname>/djClass/<button>` endpoint. Confirmed via the V-ARCHIVE open API docs that DJ CLASS is fetchable only by nickname or token (no `userNo` fetch), so the nickname is the sync key and `userNo` is stored as the immutable identity. **Trade-off (accepted):** a V-ARCHIVE nickname change makes sync return empty → the UI prompts a re-link; existing migrated users keep working by their stored nickname (zero re-link). `common/crypto.py` is no longer used for V-ARCHIVE (it stays for Chzzk channel tokens).
- **Unlink included.** A `연동 해제` action deactivates the link + clears the viewer's `DjClass` rows + resets `preferred_button` (the resolver then reports those senders as `unlinked`). Re-linking with a new token is the rename-recovery path.
- **Rate-limiting deferred to Plan 8** (master design §6) — `common/ratelimit.py` still does not exist; link/sync ship unthrottled (login-gated, single owner-operated instance).
- **Model name kept** `VarchiveToken` / table `varchive_tokens` (avoids churning the Plan 3 data-migration + admin + tests); a docstring clarifies it now holds a *verified link*, not a token.

## Reference: the Node behavior being reproduced

- **Link page** (`src/components/LinkPage.tsx`): three cards — `Chzzk 계정` (greeting + logout), `V-ARCHIVE 토큰 입력` (not-linked → `조회토큰` form `연동하기`; linked → disabled `V-ARCHIVE 연동 완료` + `DJ CLASS 동기화`), and `버튼 선택` (only when linked **and** ≥1 button) with an `자동 (최고 클래스)` option + one `{n}버튼` option each, each showing a compact badge. Footer `← 돌아가기`. Copy reproduced verbatim below.
- **V-ARCHIVE client** (`src/lib/varchive.ts`): `lookupUser(token)` → `GET /api/v2/open-token/user` (Bearer) → `{success, userNo, nickname}`, 401 = invalid; `getDjClass(nickname, button)` → `GET /api/v2/archive/<nickname>/djClass/<button>` (public); `getAllDjClasses(nickname)` over buttons `[4,5,6,8]`, skipping failures.
- **Persist** (`src/lib/dj-class-store.ts:persistUserDjClasses`): upsert by `(user, button)`, delete stale buttons, empty list clears all, one transaction.
- **Compact badge** (`src/components/LinkClassBadge.tsx`): three gray chips — `class` (e.g. `SS II`), `{threshold}+` (when known), `{power}`. (Distinct from the overlay's color-gradient `.dj-badge`; this one shows the numbers so the viewer can confirm their sync.)
- **preferred-button** (`src/lib/dj-class.ts:validatePreferredButton`): `null → null`; an int in the available set → it; else throw.

## Already in the codebase (reuse — do NOT rebuild)

- `djclass/badges.py`: `resolve_displayed_class(rows, preferred_button, sel)`, `build_badge(row)` → `{button, class, rank, power, threshold, isTheory}`, plus `SHORT_NAMES`/`RANK_THRESHOLDS`/`get_threshold`/theory helpers. (Task 3 adds `validate_preferred_button`.)
- `djclass/resolver.py`: `resolve_sender_badges()` + module-level `badge_cache = TTLCache()`, keyed `id:<chzzk_id>` / `nick:<chzzk_nickname>`. (Task 3 adds `invalidate_user`.)
- `djclass/models.py`: `DjClass(user, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at[auto_now])`, unique `(user, button)`, check `button ∈ {4,5,6,8}`.
- `viewers/models.py`: `VarchiveToken` (Task 1 alters it).
- `common/crypto.py`, `common/cache.py` (`TTLCache.get/set/invalidate`), `common/chzzk.py` (httpx 8s-timeout pattern to mirror).
- Test pattern: `client.force_login(user, backend="djclass_overlay.users.backends.ChzzkBackend")`, `@pytest.mark.django_db`, `monkeypatch.setattr(module, "func", ...)` for HTTP clients.

---

### Task 1: Token-less `VarchiveToken` model

Drop the stored token; add the immutable V-ARCHIVE `userNo`.

**Files:**
- Modify: `djclass_overlay/viewers/models.py`
- Create: `djclass_overlay/viewers/migrations/0002_tokenless_varchivetoken.py` (via `makemigrations`)
- Modify: `djclass_overlay/viewers/tests/test_models.py`

- [ ] **Step 1: Write the failing test** (replace the body of `djclass_overlay/viewers/tests/test_models.py` with):

```python
import pytest

from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_varchive_token_is_tokenless():
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    link = VarchiveToken.objects.create(
        user=u, varchive_nickname="VA-Nick", varchive_user_no=4242
    )
    assert link.is_active is True
    assert link.varchive_user_no == 4242
    # The encrypted token column is gone (token-less design).
    assert not hasattr(link, "token_encrypted")
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_models.py -q`
Expected: FAIL (`create()` got an unexpected keyword `varchive_user_no`, or `token_encrypted` NOT NULL).

- [ ] **Step 3: Edit the model** (`djclass_overlay/viewers/models.py`) — drop `token_encrypted`, add `varchive_user_no`:

```python
from django.conf import settings
from django.db import models


class VarchiveToken(models.Model):
    """A viewer's verified V-ARCHIVE link. Token-less: the 조회토큰 is used once at
    link time to capture (varchive_user_no, varchive_nickname) and is NOT stored;
    sync fetches DJ CLASS by the public nickname endpoint. (Table name kept for
    migration continuity.)"""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    varchive_nickname = models.CharField(max_length=255)
    # Immutable V-ARCHIVE identity (불변값). Null for rows migrated before Plan 7.
    varchive_user_no = models.BigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "varchive_tokens"
```

- [ ] **Step 4: Make the migration.** `uv run python manage.py makemigrations viewers`
Expected: a migration removing `token_encrypted` + adding `varchive_user_no`. Rename the generated file to `0002_tokenless_varchivetoken.py` if you like (optional).

- [ ] **Step 5: Run — expect pass** (migration applied to the test DB automatically). `uv run pytest djclass_overlay/viewers/tests/test_models.py -q`
Expected: PASS.

- [ ] **Step 6: Update the admin** (`djclass_overlay/viewers/admin.py`) so it doesn't reference the dropped field. Set:

```python
from django.contrib import admin

from .models import VarchiveToken


@admin.register(VarchiveToken)
class VarchiveTokenAdmin(admin.ModelAdmin):
    list_display = ("varchive_nickname", "varchive_user_no", "user", "is_active", "updated_at")
    search_fields = ("varchive_nickname",)
```

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/viewers/models.py djclass_overlay/viewers/migrations/ \
        djclass_overlay/viewers/admin.py djclass_overlay/viewers/tests/test_models.py
git commit -m "feat(viewers): token-less VarchiveToken (drop token, add varchive_user_no)"
```

---

### Task 2: V-ARCHIVE client — `djclass/varchive.py` (TDD)

Port `src/lib/varchive.ts` token-lessly: `lookup_user` (once, at link) + the public `get_dj_class` / `get_all_dj_classes`.

**Files:**
- Create: `djclass_overlay/djclass/varchive.py`
- Create: `djclass_overlay/djclass/tests/test_varchive.py`

- [ ] **Step 1: Write the failing tests** (`djclass_overlay/djclass/tests/test_varchive.py`):

```python
import pytest

from djclass_overlay.djclass import varchive


def test_lookup_user_ok(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user",
        json={"success": True, "userNo": 4242, "nickname": "VA-Nick"},
    )
    info = varchive.lookup_user("tok")
    assert info == {"user_no": 4242, "nickname": "VA-Nick"}


def test_lookup_user_401_is_invalid(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user", status_code=401
    )
    with pytest.raises(varchive.InvalidToken):
        varchive.lookup_user("bad")


def test_lookup_user_success_false_is_invalid(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user",
        json={"success": False},
    )
    with pytest.raises(varchive.InvalidToken):
        varchive.lookup_user("tok")


def test_get_all_dj_classes_skips_failures(httpx_mock):
    base = "https://v-archive.net/api/v2/archive/VA-Nick/djClass"
    httpx_mock.add_response(
        url=f"{base}/4",
        json={"success": True, "djClass": "SHOWSTOPPER II",
              "djPowerSum": 1.0, "maxDjPower": 2.0, "djPowerConversion": 9823.0},
    )
    httpx_mock.add_response(url=f"{base}/5", status_code=404)
    httpx_mock.add_response(url=f"{base}/6", status_code=404)
    httpx_mock.add_response(
        url=f"{base}/8",
        json={"success": True, "djClass": "HEADLINER IV",
              "djPowerSum": 3.0, "maxDjPower": 4.0, "djPowerConversion": 9410.0},
    )
    rows = varchive.get_all_dj_classes("VA-Nick")
    assert [r["button"] for r in rows] == [4, 8]
    assert rows[0]["djClass"] == "SHOWSTOPPER II"
    assert rows[0]["djPowerConversion"] == 9823.0
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/djclass/tests/test_varchive.py -q`
Expected: FAIL (`ModuleNotFoundError: djclass_overlay.djclass.varchive`).

- [ ] **Step 3: Implement** (`djclass_overlay/djclass/varchive.py`):

```python
"""V-ARCHIVE open API client. Token-less: the 조회토큰 is used ONCE (lookup_user)
to verify ownership and capture {userNo, nickname}; all ongoing DJ CLASS sync uses
the PUBLIC nickname endpoint, so no token is stored. Port of src/lib/varchive.ts.

Sync httpx with an 8s timeout, mirroring common/chzzk.py.
"""

from urllib.parse import quote

import httpx

BASE_URL = "https://v-archive.net"
TIMEOUT = 8.0
BUTTONS = [4, 5, 6, 8]


class VarchiveError(Exception):
    """A V-ARCHIVE request failed (network, timeout, or unexpected status)."""


class InvalidToken(VarchiveError):
    """The 조회토큰 was rejected (HTTP 401 or success=false)."""


def lookup_user(token):
    """Verify a 조회토큰; return {"user_no": int, "nickname": str}.

    GET /api/v2/open-token/user with Authorization: Bearer <token>. Called ONCE at
    link time; the token is NOT persisted afterward. Port of varchive.ts:lookupUser.
    """
    try:
        resp = httpx.get(
            f"{BASE_URL}/api/v2/open-token/user",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise VarchiveError("V-ARCHIVE request failed") from exc
    if resp.status_code == 401:
        raise InvalidToken()
    try:
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise VarchiveError(f"V-ARCHIVE API error: {resp.status_code}") from exc
    data = resp.json()
    if not data.get("success", True):
        raise InvalidToken()
    return {"user_no": data["userNo"], "nickname": data["nickname"]}


def get_dj_class(nickname, button):
    """GET the public DJ CLASS for one button. Port of varchive.ts:getDjClass.

    GET /api/v2/archive/<nickname>/djClass/<button> (no token). Raises VarchiveError
    on any non-200 (e.g. 404 = no record for that button).
    """
    try:
        resp = httpx.get(
            f"{BASE_URL}/api/v2/archive/{quote(nickname, safe='')}/djClass/{button}",
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise VarchiveError(f"V-ARCHIVE DJ CLASS API error (button {button})") from exc
    return resp.json()


def get_all_dj_classes(nickname):
    """Fetch buttons [4,5,6,8] in turn, skipping any that fail or lack a class.

    Returns a list of dicts: {button, djClass, djPowerSum, maxDjPower, djPowerConversion}.
    A total failure (stale nickname / V-ARCHIVE down) yields []. Port of getAllDjClasses.
    """
    out = []
    for button in BUTTONS:
        try:
            result = get_dj_class(nickname, button)
        except VarchiveError:
            continue
        if result.get("success") and result.get("djClass"):
            out.append({
                "button": button,
                "djClass": result["djClass"],
                "djPowerSum": result.get("djPowerSum"),
                "maxDjPower": result.get("maxDjPower"),
                "djPowerConversion": result.get("djPowerConversion"),
            })
    return out
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_varchive.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/varchive.py djclass_overlay/djclass/tests/test_varchive.py
git commit -m "feat(djclass): token-less V-ARCHIVE client (lookup_user + public DJ CLASS fetch)"
```

---

### Task 3: `validate_preferred_button` + `resolver.invalidate_user` (TDD)

Two small reused helpers: the preferred-button validator (Plan 6 deferred it here) and a per-user badge-cache invalidator (the resolver caches by sender, with no user-level invalidation yet).

**Files:**
- Modify: `djclass_overlay/djclass/badges.py` (append `validate_preferred_button`)
- Modify: `djclass_overlay/djclass/resolver.py` (append `invalidate_user`)
- Modify: `djclass_overlay/djclass/tests/test_badges.py` (append)
- Modify: `djclass_overlay/djclass/tests/test_resolver.py` (append)

- [ ] **Step 1: Write the failing tests.** Append to `djclass_overlay/djclass/tests/test_badges.py`:

```python
import pytest

from djclass_overlay.djclass import badges


def test_validate_preferred_button():
    assert badges.validate_preferred_button(None, [4, 8]) is None
    assert badges.validate_preferred_button(8, [4, 8]) == 8
    with pytest.raises(ValueError):
        badges.validate_preferred_button(5, [4, 8])
```

Append to `djclass_overlay/djclass/tests/test_resolver.py`:

```python
@pytest.mark.django_db
def test_invalidate_user_clears_both_keys():
    from djclass_overlay.djclass import resolver
    from djclass_overlay.users.models import User

    u = User.objects.create_user(chzzk_id="cid", chzzk_nickname="nick")
    resolver.badge_cache.set("id:cid", {"status": "linked"}, 300)
    resolver.badge_cache.set("nick:nick", {"status": "linked"}, 300)
    resolver.invalidate_user(u)
    assert resolver.badge_cache.get("id:cid") is None
    assert resolver.badge_cache.get("nick:nick") is None
```

> `test_resolver.py` already imports `pytest`; reuse its existing imports/fixtures.

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/djclass/tests/test_badges.py::test_validate_preferred_button djclass_overlay/djclass/tests/test_resolver.py::test_invalidate_user_clears_both_keys -q`
Expected: FAIL (attributes don't exist).

- [ ] **Step 3a: Implement `validate_preferred_button`** — append to `djclass_overlay/djclass/badges.py`:

```python
def validate_preferred_button(button, available_buttons):
    """Port of dj-class.ts:246. None -> None; an int in `available_buttons` -> it;
    anything else -> ValueError."""
    if button is None:
        return None
    if isinstance(button, int) and button in available_buttons:
        return button
    raise ValueError("Invalid preferred button")
```

- [ ] **Step 3b: Implement `invalidate_user`** — append to `djclass_overlay/djclass/resolver.py`:

```python
def invalidate_user(user):
    """Drop any cached badge result for a user, under both possible sender keys
    (matches the keys built in resolve_sender_badges). Called after link/sync/
    unlink/preferred-button changes."""
    badge_cache.invalidate(f"id:{user.chzzk_id}")
    badge_cache.invalidate(f"nick:{user.chzzk_nickname}")
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_badges.py djclass_overlay/djclass/tests/test_resolver.py -q`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/badges.py djclass_overlay/djclass/resolver.py \
        djclass_overlay/djclass/tests/test_badges.py djclass_overlay/djclass/tests/test_resolver.py
git commit -m "feat(djclass): validate_preferred_button + resolver.invalidate_user"
```

---

### Task 4: Sync core — `djclass/sync.py` (TDD)

`persist_user_dj_classes` (port of `persistUserDjClasses`) + `sync_user` (fetch one link's classes by nickname and persist, guarding the empty case so a transient failure/rename never wipes good data).

**Files:**
- Create: `djclass_overlay/djclass/sync.py`
- Create: `djclass_overlay/djclass/tests/test_sync.py`

- [ ] **Step 1: Write the failing tests** (`djclass_overlay/djclass/tests/test_sync.py`):

```python
import pytest

from djclass_overlay.djclass import sync, varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

CLASSES = [
    {"button": 4, "djClass": "SHOWSTOPPER II", "djPowerSum": 1.0,
     "maxDjPower": 2.0, "djPowerConversion": 9823.0},
    {"button": 8, "djClass": "HEADLINER IV", "djPowerSum": 3.0,
     "maxDjPower": 4.0, "djPowerConversion": 9410.0},
]


@pytest.mark.django_db
def test_persist_upserts_and_deletes_stale():
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    DjClass.objects.create(user=u, button=6, dj_class="ROOKIE I", dj_power_conversion=4900.0)
    sync.persist_user_dj_classes(u, CLASSES)
    rows = {r.button: r for r in DjClass.objects.filter(user=u)}
    assert set(rows) == {4, 8}                       # 6 was stale -> deleted
    assert rows[4].dj_class == "SHOWSTOPPER II"
    assert rows[4].dj_power_conversion == 9823.0


@pytest.mark.django_db
def test_persist_empty_clears_all():
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    sync.persist_user_dj_classes(u, [])
    assert DjClass.objects.filter(user=u).count() == 0


@pytest.mark.django_db
def test_sync_user_persists_and_returns_highest(monkeypatch):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    link = VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=1)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)
    result = sync.sync_user(link)
    assert result["ok"] is True
    assert result["highest"].button == 4          # SS II outranks HL IV
    assert DjClass.objects.filter(user=u).count() == 2


@pytest.mark.django_db
def test_sync_user_empty_keeps_existing_rows_and_flags_stale(monkeypatch):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    link = VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=1)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: [])
    result = sync.sync_user(link)
    assert result == {"ok": False, "stale": True, "highest": None}
    assert DjClass.objects.filter(user=u).count() == 1   # NOT wiped
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/djclass/tests/test_sync.py -q`
Expected: FAIL (`ModuleNotFoundError: djclass_overlay.djclass.sync`).

- [ ] **Step 3: Implement** (`djclass_overlay/djclass/sync.py`):

```python
"""DJ CLASS persistence + per-user sync (token-less: fetch by stored nickname).

persist_user_dj_classes ports src/lib/dj-class-store.ts. sync_user fetches one
link's classes and persists them, guarding the empty case so a transient V-ARCHIVE
failure or a stale nickname never wipes good data. The management command and the
on-demand /link sync both call sync_user.
"""

from django.db import transaction

from djclass_overlay.djclass import badges, varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.djclass.resolver import invalidate_user


@transaction.atomic
def persist_user_dj_classes(user, classes):
    """Replace `user`'s DjClass rows with `classes`: upsert each button, delete any
    stored button not in the new set. An empty list clears all rows. (synced_at is
    auto_now, so it updates on each save.) Port of persistUserDjClasses."""
    if not classes:
        DjClass.objects.filter(user=user).delete()
        return
    buttons = []
    for c in classes:
        DjClass.objects.update_or_create(
            user=user,
            button=c["button"],
            defaults={
                "dj_class": c["djClass"],
                "dj_power_sum": c["djPowerSum"],
                "max_dj_power": c["maxDjPower"],
                "dj_power_conversion": c["djPowerConversion"],
            },
        )
        buttons.append(c["button"])
    DjClass.objects.filter(user=user).exclude(button__in=buttons).delete()


def sync_user(link):
    """Fetch + persist DJ CLASS for one active VarchiveToken, by its nickname.

    Returns {"ok": bool, "stale": bool, "highest": DjClass | None}. An empty fetch
    is treated as a probable stale nickname / transient error: existing rows are
    KEPT (not wiped), and stale=True when the user already had data.
    """
    classes = varchive.get_all_dj_classes(link.varchive_nickname)
    if not classes:
        had = DjClass.objects.filter(user=link.user).exists()
        invalidate_user(link.user)
        return {"ok": False, "stale": had, "highest": None}
    persist_user_dj_classes(link.user, classes)
    invalidate_user(link.user)
    rows = list(DjClass.objects.filter(user=link.user))
    return {"ok": True, "stale": False,
            "highest": badges.resolve_displayed_class(rows, None, "auto")}
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_sync.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/sync.py djclass_overlay/djclass/tests/test_sync.py
git commit -m "feat(djclass): sync core (persist_user_dj_classes + sync_user, empty-safe)"
```

---

### Task 5: `sync_djclass` management command (TDD)

Daily cron entry point: sync every active link, tallying success/failure.

**Files:**
- Create: `djclass_overlay/djclass/management/__init__.py` (empty)
- Create: `djclass_overlay/djclass/management/commands/__init__.py` (empty)
- Create: `djclass_overlay/djclass/management/commands/sync_djclass.py`
- Create: `djclass_overlay/djclass/tests/test_sync_command.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/djclass/tests/test_sync_command.py`):

```python
import pytest
from django.core.management import call_command

from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_sync_djclass_command_syncs_active_links(monkeypatch):
    active = User.objects.create_user(chzzk_id="a", chzzk_nickname="A")
    VarchiveToken.objects.create(user=active, varchive_nickname="VA", varchive_user_no=1)
    inactive = User.objects.create_user(chzzk_id="b", chzzk_nickname="B")
    VarchiveToken.objects.create(user=inactive, varchive_nickname="VB",
                                 varchive_user_no=2, is_active=False)

    monkeypatch.setattr(
        varchive, "get_all_dj_classes",
        lambda nick: [{"button": 4, "djClass": "SHOWSTOPPER II", "djPowerSum": 1.0,
                       "maxDjPower": 2.0, "djPowerConversion": 9823.0}],
    )
    call_command("sync_djclass")

    assert DjClass.objects.filter(user=active).count() == 1
    assert DjClass.objects.filter(user=inactive).count() == 0   # inactive skipped
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/djclass/tests/test_sync_command.py -q`
Expected: FAIL (`CommandError: Unknown command: 'sync_djclass'`).

- [ ] **Step 3a: Create the package markers.** Create empty files `djclass_overlay/djclass/management/__init__.py` and `djclass_overlay/djclass/management/commands/__init__.py`.

- [ ] **Step 3b: Implement the command** (`djclass_overlay/djclass/management/commands/sync_djclass.py`):

```python
"""Daily V-ARCHIVE DJ CLASS sync for all active links. Scheduled by host cron at
18:00 UTC (= 03:00 KST), per the master design §4.7. Port of src/worker/sync-djclass.ts.
"""

from django.core.management.base import BaseCommand

from djclass_overlay.djclass.sync import sync_user
from djclass_overlay.viewers.models import VarchiveToken


class Command(BaseCommand):
    help = "Sync DJ CLASS from V-ARCHIVE for every active link."

    def handle(self, *args, **options):
        links = VarchiveToken.objects.filter(is_active=True).select_related("user")
        success = failed = 0
        for link in links:
            try:
                result = sync_user(link)
            except Exception as exc:  # noqa: BLE001 — one bad link must not stop the batch
                failed += 1
                self.stderr.write(f"[sync_djclass] {link.varchive_nickname}: {exc}")
                continue
            if result["ok"]:
                success += 1
            else:
                failed += 1
        self.stdout.write(f"[sync_djclass] synced={success} failed={failed}")
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_sync_command.py -q`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/management/ djclass_overlay/djclass/tests/test_sync_command.py
git commit -m "feat(djclass): sync_djclass management command (daily cron)"
```

---

### Task 6: Link page scaffold — CSRF-for-htmx, full GET, template + partial (TDD)

Replace the placeholder with the real page: `base.html` gains the htmx CSRF header; `viewers/link.html` defines the `link_card` partial (not-linked + linked + button-picker states); `link_page` renders the full page; all five routes register (the four `hx-post` views are thin stubs here, fleshed out in Tasks 7–10).

**Files:**
- Modify: `djclass_overlay/templates/base.html` (add `hx-headers` to `<body>`)
- Create: `djclass_overlay/templates/viewers/link.html`
- Create: `djclass_overlay/templates/viewers/_link_badge.html`
- Delete: `djclass_overlay/templates/pages/link_placeholder.html`
- Modify: `djclass_overlay/viewers/views.py`, `djclass_overlay/viewers/urls.py`
- Modify: `djclass_overlay/viewers/tests/test_pages.py`

- [ ] **Step 1: Write the failing tests** (replace `djclass_overlay/viewers/tests/test_pages.py` with):

```python
import pytest

from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_link_requires_login(client):
    resp = client.get("/link/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/link/" in resp["Location"]


@pytest.mark.django_db
def test_link_not_linked_state(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    body = client.get("/link/").content.decode()
    assert "DJ CLASS 연동" in body
    assert "조회토큰을 입력하세요" in body
    assert "V-ARCHIVE 마이페이지" in body
    assert 'hx-post="/link/connect/"' in body
    assert "버튼 선택" not in body          # no picker when not linked


@pytest.mark.django_db
def test_link_linked_state_shows_actions_and_buttons(client):
    u = User.objects.create_user(chzzk_id="v2", chzzk_nickname="Viewer2")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    client.force_login(u, backend=BACKEND)
    body = client.get("/link/").content.decode()
    assert "V-ARCHIVE 연동 완료" in body
    assert 'hx-post="/link/sync/"' in body
    assert 'hx-post="/link/unlink/"' in body
    assert "버튼 선택" in body
    assert "자동 (최고 클래스)" in body
    assert "4버튼" in body
    assert "SS II" in body                  # compact rank chip (build_badge "class")
    assert "9823" in body                   # power chip
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_pages.py -q`
Expected: FAIL (placeholder copy `준비 중` no longer matches; new routes 404).

- [ ] **Step 3: Add the htmx CSRF header** — in `djclass_overlay/templates/base.html`, change the `<body>` opening tag to include `hx-headers` (the app's first `hx-post` needs the CSRF token globally; this is the django-htmx-documented pattern):

```html
  <body class="min-h-screen" hx-boost="true" hx-target="#content" hx-select="#content" hx-swap="outerHTML"
        hx-headers='{"x-csrftoken": "{{ csrf_token }}"}'>
```

> Django always enables the `csrf` context processor, so `{{ csrf_token }}` is available in every `render()`. With this on `<body>`, every htmx request (including the `/link/` `hx-post`s) carries `X-CSRFToken`. The `hx-post` forms below also include `{% csrf_token %}`, so the token is present even on a boosted-in page whose `<body>` wasn't re-rendered.

- [ ] **Step 4: Create the compact badge partial** (`djclass_overlay/templates/viewers/_link_badge.html`) — port of `LinkClassBadge.tsx`, fed a `build_badge()` dict as `badge`:

```html
{% comment %}Compact DJ CLASS chip for the /link page: class / threshold+ / power.
Port of src/components/LinkClassBadge.tsx. `badge` is a djclass.badges.build_badge dict.
Uses `is not None` so a 0 threshold/power still renders.{% endcomment %}
{% if badge %}
<span class="inline-flex flex-wrap items-center gap-1">
  <span class="inline-flex items-center rounded bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-800">{{ badge.class }}</span>
  {% if badge.threshold is not None %}<span class="inline-flex items-center rounded bg-gray-700 px-1.5 py-0.5 text-xs font-bold text-white">{{ badge.threshold }}+</span>{% endif %}
  {% if badge.power is not None %}<span class="inline-flex items-center rounded bg-black px-1.5 py-0.5 text-xs font-bold text-white">{{ badge.power }}</span>{% endif %}
</span>
{% endif %}
```

- [ ] **Step 5: Create the page** (`djclass_overlay/templates/viewers/link.html`). The `{% partialdef link_card inline %}` renders in place for the full GET **and** is fetched standalone as `viewers/link.html#link_card` by the `hx-post` views:

```html
{% extends "base.html" %}
{% block title %}DJ CLASS 연동{% endblock %}
{% block content %}
<main class="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
  <div class="w-full max-w-md space-y-6">
    <h1 class="text-center text-3xl font-bold text-gray-900">DJ CLASS 연동</h1>

    <!-- Chzzk account card (static across swaps) -->
    <div class="frosted-card p-6">
      <h2 class="text-lg font-bold text-gray-900">Chzzk 계정</h2>
      <p class="mt-1 mb-4 text-sm text-gray-600">{{ user.chzzk_nickname }}님, 환영합니다!</p>
      <form method="post" action="{% url 'logout' %}" hx-boost="false">
        {% csrf_token %}
        <button type="submit" class="w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{{ user.chzzk_nickname }}님 로그아웃</button>
      </form>
    </div>

    {% partialdef link_card inline %}
    <div id="link-card" class="space-y-6">
      <!-- V-ARCHIVE card -->
      <div class="frosted-card p-6">
        <h2 class="text-lg font-bold text-gray-900">V-ARCHIVE 토큰 입력</h2>
        {% if link %}
          <p class="mt-1 mb-4 text-sm text-gray-600">{{ varchive_nickname|default:"V-ARCHIVE" }}와 연동 완료</p>
          <div class="space-y-3">
            <button class="btn-chzzk w-full opacity-60" disabled>V-ARCHIVE 연동 완료</button>
            <form hx-post="{% url 'link_sync' %}" hx-target="#link-card" hx-swap="outerHTML">
              {% csrf_token %}
              <button type="submit" class="w-full rounded-lg bg-gray-200 py-3 text-sm font-bold text-gray-800 hover:bg-gray-300">DJ CLASS 동기화</button>
            </form>
            <form hx-post="{% url 'link_unlink' %}" hx-target="#link-card" hx-swap="outerHTML"
                  hx-confirm="V-ARCHIVE 연동을 해제할까요? 동기화된 DJ CLASS 정보가 삭제됩니다.">
              {% csrf_token %}
              <button type="submit" class="w-full text-xs text-gray-400 hover:text-gray-600">연동 해제</button>
            </form>
          </div>
        {% else %}
          <p class="mt-1 mb-4 text-sm text-gray-600">토큰은 <a href="https://v-archive.net/mypage" target="_blank" rel="noopener noreferrer" hx-boost="false" class="text-blue-600 hover:underline">V-ARCHIVE 마이페이지</a>에서 발급받을 수 있습니다.</p>
          <form hx-post="{% url 'link_connect' %}" hx-target="#link-card" hx-swap="outerHTML" class="space-y-4">
            {% csrf_token %}
            <div class="space-y-2">
              <label for="token" class="text-sm font-medium text-gray-700">조회토큰</label>
              <input id="token" name="token" type="text" placeholder="조회토큰을 입력하세요"
                     class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" class="btn-chzzk w-full">연동하기</button>
          </form>
        {% endif %}
        {% if message %}
          <div class="mt-4 rounded-lg p-3 text-sm {% if message_type == 'error' %}bg-red-50 text-red-800{% else %}bg-green-50 text-green-800{% endif %}">{{ message }}</div>
        {% endif %}
      </div>

      <!-- Button picker: only when linked AND there is ≥1 button row -->
      {% if options %}
      <div class="frosted-card p-6">
        <h2 class="text-lg font-bold text-gray-900">버튼 선택</h2>
        <p class="mt-1 mb-4 text-sm text-gray-600">위젯에 표시할 버튼을 선택하세요. 스트리머가 ‘시청자 선택 우선’을 켰을 때 적용됩니다.</p>
        <form hx-post="{% url 'link_preferred_button' %}" hx-target="#link-card" hx-swap="outerHTML"
              hx-trigger="change" class="space-y-2">
          {% csrf_token %}
          {% for opt in options %}
          <label class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border p-3 {% if opt.checked %}border-gray-900 bg-gray-50{% else %}border-gray-200{% endif %}">
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-gray-800">{{ opt.label }}</span>
              {% include "viewers/_link_badge.html" with badge=opt.badge %}
            </span>
            <input type="radio" name="button" value="{{ opt.value }}" class="h-4 w-4"
                   {% if opt.checked %}checked{% endif %} />
          </label>
          {% endfor %}
        </form>
      </div>
      {% endif %}
    </div>
    {% endpartialdef %}

    <a href="/" class="block text-center text-gray-500 hover:text-gray-700">← 돌아가기</a>
  </div>
</main>
{% endblock %}
```

- [ ] **Step 6: Replace the view module** (`djclass_overlay/viewers/views.py`) — full GET + shared helpers + four `require_POST` stubs (real bodies land in Tasks 7–10):

```python
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.http import require_POST

from djclass_overlay.djclass import badges
from djclass_overlay.djclass.models import DjClass

from .models import VarchiveToken


def _link_context(user, message=None, message_type=None):
    """Build the /link state: the active link, the preferred-button picker options
    (auto + one per synced button, each with a compact badge), and an optional flash."""
    link = VarchiveToken.objects.filter(user=user, is_active=True).first()
    rows = list(DjClass.objects.filter(user=user).order_by("button")) if link else []
    options = []
    if rows:
        auto = badges.resolve_displayed_class(rows, None, "auto")
        options.append({
            "label": "자동 (최고 클래스)", "value": "auto",
            "badge": badges.build_badge(auto), "checked": user.preferred_button is None,
        })
        for row in rows:
            options.append({
                "label": f"{row.button}버튼", "value": str(row.button),
                "badge": badges.build_badge(row),
                "checked": user.preferred_button == row.button,
            })
    return {
        "link": link,
        "varchive_nickname": link.varchive_nickname if link else None,
        "options": options,
        "message": message,
        "message_type": message_type,
    }


def _render_card(request, message=None, message_type=None):
    """Render just the #link-card partial for an hx-post swap (Django 6.0 partials)."""
    return render(request, "viewers/link.html#link_card",
                  _link_context(request.user, message, message_type))


@login_required
def link_page(request):
    return render(request, "viewers/link.html", _link_context(request.user))


@login_required
@require_POST
def link_connect(request):
    return _render_card(request)  # implemented in Task 7


@login_required
@require_POST
def link_sync(request):
    return _render_card(request)  # implemented in Task 8


@login_required
@require_POST
def link_unlink(request):
    return _render_card(request)  # implemented in Task 9


@login_required
@require_POST
def link_preferred_button(request):
    return _render_card(request)  # implemented in Task 10
```

- [ ] **Step 7: Register the routes** (`djclass_overlay/viewers/urls.py`):

```python
from django.urls import path

from . import views

urlpatterns = [
    path("link/", views.link_page, name="link"),
    path("link/connect/", views.link_connect, name="link_connect"),
    path("link/sync/", views.link_sync, name="link_sync"),
    path("link/unlink/", views.link_unlink, name="link_unlink"),
    path("link/preferred-button/", views.link_preferred_button, name="link_preferred_button"),
]
```

- [ ] **Step 8: Delete the placeholder.** `git rm djclass_overlay/templates/pages/link_placeholder.html`

- [ ] **Step 9: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_pages.py -q`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit.**

```bash
git add djclass_overlay/templates/base.html djclass_overlay/templates/viewers/ \
        djclass_overlay/viewers/views.py djclass_overlay/viewers/urls.py \
        djclass_overlay/viewers/tests/test_pages.py
git rm djclass_overlay/templates/pages/link_placeholder.html
git commit -m "feat(viewers): real /link page (htmx partial states) + CSRF-for-htmx"
```

---

### Task 7: `link_connect` — verify token, store link, auto-sync (TDD)

**Files:**
- Modify: `djclass_overlay/viewers/views.py` (imports + `link_connect` body)
- Create: `djclass_overlay/viewers/tests/test_link_actions.py`

- [ ] **Step 1: Write the failing tests** (`djclass_overlay/viewers/tests/test_link_actions.py`):

```python
import pytest

from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"

CLASSES = [{"button": 4, "djClass": "SHOWSTOPPER II", "djPowerSum": 1.0,
            "maxDjPower": 2.0, "djPowerConversion": 9823.0}]


@pytest.mark.django_db
def test_connect_valid_token_links_and_syncs(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "lookup_user",
                        lambda tok: {"user_no": 7, "nickname": "VA-Nick"})
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)

    resp = client.post("/link/connect/", {"token": "good-token"})
    body = resp.content.decode()

    assert resp.status_code == 200
    assert "<!doctype" not in body.lower()                 # a fragment, not a full page
    assert "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다." in body
    assert "V-ARCHIVE 연동 완료" in body                    # linked state
    link = VarchiveToken.objects.get(user=u)
    assert link.varchive_nickname == "VA-Nick"
    assert link.varchive_user_no == 7
    assert link.is_active is True
    assert DjClass.objects.filter(user=u).count() == 1


@pytest.mark.django_db
def test_connect_invalid_token_shows_error(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)

    def _raise(tok):
        raise varchive.InvalidToken()

    monkeypatch.setattr(varchive, "lookup_user", _raise)
    resp = client.post("/link/connect/", {"token": "bad"})
    assert "조회토큰이 유효하지 않습니다. 다시 확인해주세요." in resp.content.decode()
    assert not VarchiveToken.objects.filter(user=u).exists()


@pytest.mark.django_db
def test_connect_empty_token_shows_error(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/connect/", {"token": "   "})
    assert "조회토큰을 입력하세요." in resp.content.decode()
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k connect -q`
Expected: FAIL (the stub returns the not-linked card; no link created).

- [ ] **Step 3: Implement.** In `djclass_overlay/viewers/views.py`, extend the imports and replace `link_connect`:

```python
from djclass_overlay.djclass import badges, varchive
from djclass_overlay.djclass.sync import sync_user
```

```python
@login_required
@require_POST
def link_connect(request):
    token = (request.POST.get("token") or "").strip()
    if not token:
        return _render_card(request, "조회토큰을 입력하세요.", "error")
    try:
        info = varchive.lookup_user(token)
    except varchive.InvalidToken:
        return _render_card(request, "조회토큰이 유효하지 않습니다. 다시 확인해주세요.", "error")
    except varchive.VarchiveError:
        return _render_card(request, "네트워크 오류가 발생했습니다.", "error")
    link, _ = VarchiveToken.objects.update_or_create(
        user=request.user,
        defaults={"varchive_nickname": info["nickname"],
                  "varchive_user_no": info["user_no"], "is_active": True},
    )
    sync_user(link)  # immediate first sync (empty result is fine — no badges yet)
    return _render_card(request, "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.", "success")
```

> Merge the new `badges, varchive` import with the existing `from djclass_overlay.djclass import badges` line (don't duplicate it).

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k connect -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/viewers/views.py djclass_overlay/viewers/tests/test_link_actions.py
git commit -m "feat(viewers): link_connect — verify 조회토큰, store link, auto-sync"
```

---

### Task 8: `link_sync` — re-sync on demand (TDD)

**Files:**
- Modify: `djclass_overlay/viewers/views.py` (`link_sync` body)
- Modify: `djclass_overlay/viewers/tests/test_link_actions.py` (append)

- [ ] **Step 1: Append failing tests** to `djclass_overlay/viewers/tests/test_link_actions.py`:

```python
@pytest.mark.django_db
def test_sync_success_reports_highest(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)
    resp = client.post("/link/sync/")
    assert "DJ CLASS 동기화 완료: 4B SHOWSTOPPER II" in resp.content.decode()
    assert DjClass.objects.filter(user=u).count() == 1


@pytest.mark.django_db
def test_sync_empty_with_existing_rows_prompts_relink(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: [])
    resp = client.post("/link/sync/")
    assert "다시 연동" in resp.content.decode()
    assert DjClass.objects.filter(user=u).count() == 1     # not wiped


@pytest.mark.django_db
def test_sync_without_link_errors(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/sync/")
    assert "먼저 V-ARCHIVE를 연동해주세요." in resp.content.decode()
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k sync -q`

- [ ] **Step 3: Implement** — replace `link_sync` in `djclass_overlay/viewers/views.py`:

```python
@login_required
@require_POST
def link_sync(request):
    link = VarchiveToken.objects.filter(user=request.user, is_active=True).first()
    if link is None:
        return _render_card(request, "먼저 V-ARCHIVE를 연동해주세요.", "error")
    result = sync_user(link)
    if not result["ok"]:
        if result["stale"]:
            return _render_card(
                request,
                "DJ CLASS 정보를 찾을 수 없습니다. V-ARCHIVE 닉네임이 바뀌었다면 다시 연동해주세요.",
                "error",
            )
        return _render_card(request, "동기화할 DJ CLASS 정보가 없습니다.", "error")
    highest = result["highest"]
    label = f"{highest.button}B {highest.dj_class}" if highest else "BEGINNER"
    return _render_card(request, f"DJ CLASS 동기화 완료: {label}", "success")
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k sync -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/viewers/views.py djclass_overlay/viewers/tests/test_link_actions.py
git commit -m "feat(viewers): link_sync — on-demand re-sync with stale-nickname prompt"
```

---

### Task 9: `link_unlink` — disconnect + clear (TDD)

**Files:**
- Modify: `djclass_overlay/viewers/views.py` (import + `link_unlink` body)
- Modify: `djclass_overlay/viewers/tests/test_link_actions.py` (append)

- [ ] **Step 1: Append the failing test** to `djclass_overlay/viewers/tests/test_link_actions.py`:

```python
@pytest.mark.django_db
def test_unlink_deactivates_and_clears(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    u.preferred_button = 4
    u.save(update_fields=["preferred_button"])
    link = VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    client.force_login(u, backend=BACKEND)

    resp = client.post("/link/unlink/")
    body = resp.content.decode()

    assert "V-ARCHIVE 연동을 해제했습니다." in body
    assert "조회토큰을 입력하세요" in body                 # back to not-linked state
    link.refresh_from_db()
    u.refresh_from_db()
    assert link.is_active is False
    assert DjClass.objects.filter(user=u).count() == 0
    assert u.preferred_button is None
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k unlink -q`

- [ ] **Step 3: Implement.** Add the import and replace `link_unlink` in `djclass_overlay/viewers/views.py`:

```python
from djclass_overlay.djclass.resolver import invalidate_user
```

```python
@login_required
@require_POST
def link_unlink(request):
    link = VarchiveToken.objects.filter(user=request.user, is_active=True).first()
    if link is not None:
        link.is_active = False
        link.save()
        DjClass.objects.filter(user=request.user).delete()
        request.user.preferred_button = None
        request.user.save(update_fields=["preferred_button"])
        invalidate_user(request.user)
    return _render_card(request, "V-ARCHIVE 연동을 해제했습니다.", "success")
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k unlink -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/viewers/views.py djclass_overlay/viewers/tests/test_link_actions.py
git commit -m "feat(viewers): link_unlink — deactivate link + clear DJ CLASS rows"
```

---

### Task 10: `link_preferred_button` — set the viewer's button (TDD)

**Files:**
- Modify: `djclass_overlay/viewers/views.py` (`link_preferred_button` body)
- Modify: `djclass_overlay/viewers/tests/test_link_actions.py` (append)

- [ ] **Step 1: Append failing tests** to `djclass_overlay/viewers/tests/test_link_actions.py`:

```python
def _link_with_buttons(u, buttons):
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    for b in buttons:
        DjClass.objects.create(user=u, button=b, dj_class="SHOWSTOPPER II",
                               dj_power_conversion=9823.0)


@pytest.mark.django_db
def test_preferred_button_set_valid(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "8"})
    assert resp.status_code == 200
    u.refresh_from_db()
    assert u.preferred_button == 8


@pytest.mark.django_db
def test_preferred_button_auto_clears(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    u.preferred_button = 4
    u.save(update_fields=["preferred_button"])
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "auto"})
    assert resp.status_code == 200
    u.refresh_from_db()
    assert u.preferred_button is None


@pytest.mark.django_db
def test_preferred_button_invalid_rejected(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "5"})   # no 5 row
    assert "잘못된 버튼 선택입니다." in resp.content.decode()
    u.refresh_from_db()
    assert u.preferred_button is None
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k preferred -q`

- [ ] **Step 3: Implement** — replace `link_preferred_button` in `djclass_overlay/viewers/views.py`:

```python
@login_required
@require_POST
def link_preferred_button(request):
    raw = request.POST.get("button")
    available = list(
        DjClass.objects.filter(user=request.user).values_list("button", flat=True)
    )
    try:
        parsed = None if raw in (None, "", "auto") else int(raw)
    except (TypeError, ValueError):
        return _render_card(request, "잘못된 버튼 선택입니다.", "error")
    try:
        value = badges.validate_preferred_button(parsed, available)
    except ValueError:
        return _render_card(request, "잘못된 버튼 선택입니다.", "error")
    request.user.preferred_button = value
    request.user.save(update_fields=["preferred_button"])
    invalidate_user(request.user)
    return _render_card(request)
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_link_actions.py -k preferred -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/viewers/views.py djclass_overlay/viewers/tests/test_link_actions.py
git commit -m "feat(viewers): link_preferred_button — validate + set viewer button"
```

---

### Task 11: Full suite + owner verification

The suite covers logic/content/structure; this confirms the live htmx flow once.

- [ ] **Step 1: Full suite + check.**

```bash
uv run pytest -q
uv run python manage.py check
```

Expected: all green (the prior ~85 + the new Task 1–10 tests); `check` clean.

- [ ] **Step 2: Run the app** (owner terminal):

```bash
uv run uvicorn config.asgi:application --workers 1 --port 8000
```

- [ ] **Step 3: Walk `/link/`** (logged in as a viewer, through the tunnel or locally). Confirm, with **no full-page reloads** (htmx swaps only `#link-card`):
  - Not-linked: paste a real V-ARCHIVE 조회토큰 (from v-archive.net/mypage) → `연동하기` → card flips to linked + `연동 완료! …` and the button picker appears with per-button `class / threshold+ / power` chips.
  - `DJ CLASS 동기화` → `DJ CLASS 동기화 완료: <NB CLASS>`.
  - Pick a different button radio → it persists (re-open `/link/` to confirm the selection stuck); pick `자동 (최고 클래스)` → clears it.
  - `연동 해제` → confirm dialog → card returns to the token form; the picker is gone.
  - Invalid token → `조회토큰이 유효하지 않습니다. …` inline, no reload.
- [ ] **Step 4: Widget cross-check.** With a streamer widget open for a channel where this viewer chats, confirm a freshly-linked viewer's messages show their DJ CLASS badge (cache invalidation works), and after `연동 해제` they show as `미인증`/dimmed (`unlinked`).
- [ ] **Step 5: Cron command smoke test.** `uv run python manage.py sync_djclass` → prints `[sync_djclass] synced=<n> failed=<m>`.

> No commit unless Step 3/4 surfaced a tweak.

---

## Deferred → Plan 8 (deploy/cutover/hardening)

- **CSP** (master design §6, requested 2026-06-23). When the global security-header middleware adds a Content-Security-Policy, it must allow: the **jsdelivr CDNs** (daisyUI, `@tailwindcss/browser`, htmx, Alpine, Pretendard) and the **cover-image host** `chzzk-djclass-assets.pages.dev`; account for the **inline** `<style type="text/tailwindcss">` + the SiteBackground inline `style=` attrs (need `style-src 'unsafe-inline'` or nonces) and the `hx-headers`/Alpine inline expressions. The new Plan 7 surface is just htmx `hx-post` (same-origin) + the `{"x-csrftoken": …}` `hx-headers` — no new external origins.
- **Data-migration script** (Plan 3 → run at cutover): update it for the **token-less** schema — write `varchive_nickname` (+ `is_active`) only, **drop the V-ARCHIVE token re-encryption step**, leave `varchive_user_no` null for migrated rows. (Chzzk channel-token re-encryption is unaffected.)
- **Rate-limiting** (master design §6): per-IP limits on the link/sync (+ preferred-button) routes; build `common/ratelimit.py` once and apply to these views and the Plan 4 auth routes.
- **`collectstatic` + Procfile** (already noted in Plan 6): the cron process line runs `python manage.py sync_djclass`.
- **htmx session-expiry edge:** an `hx-post` after the session expires returns `login_required`'s 302 → htmx would swap the login page into `#link-card`. Rare (the page is login-gated on load). If it ever matters, return an `HX-Redirect` to `/login/` for unauthenticated htmx POSTs.

---

## Self-Review

- **Spec coverage (master design + brainstorming):** V-ARCHIVE client §4.4/§4.7 ✓ (Task 2, token-less); sync core + daily command §4.7 ✓ (Tasks 4–5); viewer link page §4.6 ✓ (Tasks 6–10); per-button badge + `preferred_button` (Plan 6 deferral) ✓ (Tasks 3, 6, 10); `validate_preferred_button` ported ✓ (Task 3); unlink (this session’s addition) ✓ (Task 9); cache invalidation on every mutation ✓ (Tasks 3–10). Token-less decision recorded + model altered ✓ (Task 1). Rate-limit + CSP explicitly deferred to Plan 8 ✓.
- **Reuse, not rebuild:** `badges.build_badge`/`resolve_displayed_class`, `resolver.resolve_sender_badges`, `crypto`, `cache`, `chzzk` httpx pattern — all reused; only `validate_preferred_button` + `invalidate_user` added.
- **Type/name consistency:** `sync_user` returns `{"ok","stale","highest"}` (Task 4) — consumed exactly by `link_sync` (Task 8) and the command (Task 5); `build_badge` keys `class/rank/power/threshold/isTheory` (existing) — read by `_link_badge.html` (`badge.class/threshold/power`); URL names `link_connect/link_sync/link_unlink/link_preferred_button` match the template `{% url %}` calls and `urls.py`; fragment target `#link-card` matches every form’s `hx-target`; `VarchiveToken` fields `varchive_nickname/varchive_user_no/is_active` consistent across Tasks 1, 6–10.
- **Placeholders:** none — every code step is complete; the four Task 6 view stubs are intentional, each replaced with a full body + tests in Tasks 7–10.
- **Verified mechanisms:** Django 6.0.6 partial fetch `viewers/link.html#link_card` (probed live); htmx CSRF via `<body hx-headers>` (django-htmx docs); `httpx`/`pytest-httpx` already in deps; `TTLCache.invalidate` exists.
- **TDD + commits:** each task is test-first, green before commit, one focused commit per task (matching the Plan 01–06b style).
- **Deliverable:** a fully working viewer DJ CLASS linking + sync feature — token-less, htmx-swapped, with daily cron — completing the master design’s viewer half; only deploy/cutover/hardening (Plan 8) remains.
