# Realtime — Chzzk ingest + SSE fan-out + server-side badges — Implementation Plan (migration plan 5/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app's realtime heart in Django — a per-channel Chzzk chat ingestor (`python-socketio` 4.x, EIO3), a ~250 ms batch flush that resolves DJ CLASS badges **server-side**, and an SSE fan-out (`StreamingHttpResponse`) consumed by a functional vanilla-JS widget — faithfully reproducing the Node app's live overlay (spec Decisions 4–7).

**Architecture:** One ASGI process (`uvicorn --workers 1`), all realtime state in-memory. An in-memory `connections` registry maps `channel_id → {socketio client, raw-message buffer, subscriber queues, timers}`. A widget's SSE connection (`/widget/<ch>/stream`) registers an `asyncio.Queue` subscriber and **lazily** starts (a) the per-channel ingestor and (b) the global flush loop. The ingestor connects to Chzzk (session-auth → `?auth=` → SYSTEM `connected` → HTTP subscribe → `CHAT`), appending raw messages to the channel buffer. Every ~250 ms the flush loop swaps each channel's buffer, dedups senders, resolves each unique sender's badge (in-memory TTL cache → sync ORM → pure selection logic), builds one batch event, and pushes it to every subscriber queue. The badge **selection/threshold/theory logic is pure Python** ported 1:1 from `src/lib/dj-class.ts` (with its Vitest cases ported to pytest); the widget only concatenates atomic fields per its `mode`.

**Tech Stack:** Django 6.0 async views + async ORM (`aget`/`async for`), `StreamingHttpResponse` (async generator), `python-socketio[asyncio_client]~=4.6` + `python-engineio~=3.14` (EIO3 — the **only** version verified against Chzzk's Socket.IO v2 server in the Plan 1 spike), `aiohttp` (socketio's async transport), async `httpx` for session/subscribe, `uvicorn` (ASGI), `asgiref.sync.sync_to_async` for the sync↔async boundary, pytest-django + `asgiref.async_to_sync` for testing coroutines.

---

> **What is NEW vs ported (be honest about it):** The Node app fans out over a **raw WebSocket, per-message, with no batching** (`server.ts` + `chat-proxy.ts` — verified: no flush loop exists). SSE and the ~250 ms batch are **new** simplifications introduced here per spec Decisions 4 & 7; they de-risk burst rendering and let the widget drop all client-side fetch/cache/dedup/patch logic. The Chzzk **ingest** side, the **5 s reconnect / 30 s teardown / connect-dedup / token-refresh** lifecycle, and the **DJ CLASS badge logic** are faithful 1:1 ports.

> **Single-worker constraint (spec Decision 5):** the registry, buffers, queues, and badge cache are module-level in-memory state. This is correct **only** under `uvicorn --workers 1` (one event loop). Documented here and enforced in the run command (Task 11). This matches the Node single-process model exactly.

> **Spike reference (authoritative, validated 2026-06-22):** the throwaway proof in `~/chzzk-spike/{chzzk.py,connect.py,sse_app.py}` is the validated socketio-4.6.1 flow. The ports below mirror it. (Task 11 deletes it once the real path is verified.)

## Reference: the Node flow being ported

- **Ingestor** (`src/lib/chat-proxy.ts`): session URL `GET …/open/v1/sessions/auth` → `content.url`; socket `?auth=<token>` (don't double-append); `socket.io-client@2.0.3` opts `{reconnection:false, forceNew:true, timeout:3000, transports:['websocket']}`; subscribe is an **HTTP POST** `…/open/v1/sessions/events/subscribe/chat?sessionKey=…` gated on `SYSTEM {type:'connected', data.sessionKey}`; `CHAT` payload may be a JSON string or object; fields read = `profile.nickname|nickname`, `content`, `channelId`, `profile.senderChannelId|senderChannelId`, `messageTime`, `emojis` (string-valued only). Reconnect: single fixed **5 s** on `disconnect` iff `widgets>0` (no backoff). Teardown: **30 s** after last widget, cancellable on rejoin. Connect-dedup via `connectingPromise`. Token refresh **only at connect time** when `token_expires_at < now`, rotating both tokens (`expiresIn` default 86400 s).
- **Badge logic** (`src/lib/dj-class.ts`, fully Vitest-tested): `RANK_ORDER` (14), `RANK_THRESHOLDS`, `SHORT_NAMES`, `LEVEL_VALUES{I:4,II:3,III:2,IV:1}`, `BUTTON_PREFERENCE{8:3,5:2,6:1,4:0}` (note **6 < 5**), theory predicates (`isTheoryPower≥10000`, `isTheoryConversion≥9999.9847`), `toPowerInteger` (bump-or-floor), `getClassSortKey`→`[rankOrdinal,levelOrdinal,buttonPref]`, `resolveDisplayedClass` (viewer-preferred-button else highest-CLASS). Status (`src/app/api/widget/dj-class/route.ts`): **unlinked** = no user OR no active V-ARCHIVE token; **unsynced** = active token but zero DJ CLASS rows; **linked** = active token + ≥1 row. Selection is by **CLASS, never raw power** (power only via the theory→LoD-level-5 promotion).
- **Emoji** (`src/lib/emoji.ts`): placeholders `{:key:}` (`/\{:([\w-]+):\}/g`) → `{key:url}`; unmatched key dropped. Stays **client-side** (widget renders; server passes the `emojis` map through).
- **Widget params** (`src/lib/{font-size,fadeout}.ts`): `mode` short|threshold|power (default `short`); `buttonSel` auto|viewer (default `auto`, only literal `"viewer"` flips); `fontSize` 12–28 default 14; `fadeout` 5–60 s, with `0<x<5 ⇒ off`, no param ⇒ off.

> **Deferred to Plan 6 (pages/daisyUI):** colored gradient badges (`DJ_CLASS_COLORS`), the theory glint shimmer (`dj-class-badge.module.css`, `glintDelayMs`), `0.85em` badge sizing, unlinked/unsynced opacity tiers and the gray `미인증` chip, Pretendard font, and the dashboard widget-URL builder. The widget built here is **functional** (proves stream + badge contract + params + emoji + fadeout + 100-cap + scroll) with minimal styling. The pure presentation helpers `getBadgeText`/colors/glint are not re-ported to Python — `class`/`rank`/`power`/`threshold`/`isTheory` are pre-resolved server-side and the widget concatenates them.

> **Deferred to Plan 7 (sync):** there is no live DJ CLASS sync here. `unsynced` senders (linked but no rows yet) render without a badge until the daily `sync_djclass` (Plan 7) populates `dj_classes`. Migrated users already have rows from Plan 3.

---

### Task 1: Dependencies + `overlay` app scaffold + settings

Add the realtime deps and create the empty `overlay` app so later tasks have a home and `manage.py check` stays green. No behavior yet.

**Files:**
- Modify: `pyproject.toml` (via uv), `uv.lock`
- Create: `djclass_overlay/overlay/__init__.py`, `apps.py`, `models.py`, `views.py`, `admin.py`, `migrations/__init__.py`, `tests/__init__.py`
- Modify: `config/settings/base.py`

- [ ] **Step 1: Add dependencies.**

```bash
uv add "python-socketio[asyncio_client]~=4.6" "python-engineio~=3.14" uvicorn
```

> Rationale for the pins: Chzzk runs a **Socket.IO v2** server (Node client `socket.io-client@2.0.3`), which speaks **Engine.IO protocol 3 (EIO3)**. Modern `python-socketio` 5.x defaults to EIO4 and **will not handshake**. `python-socketio` 4.6.x (→ `python-engineio` 3.14.x, `aiohttp`) is the version the Plan 1 spike verified end-to-end on Python 3.13. The `[asyncio_client]` extra pulls `aiohttp`.

- [ ] **Step 2: Create the app package.** Create these files:

`djclass_overlay/overlay/__init__.py` — empty.
`djclass_overlay/overlay/models.py`:

```python
# Realtime overlay has no DB models; all state is in-memory (spec Decision 5).
```

`djclass_overlay/overlay/apps.py`:

```python
from django.apps import AppConfig


class OverlayConfig(AppConfig):
    name = 'djclass_overlay.overlay'
```

`djclass_overlay/overlay/views.py`:

```python
# Views live in sse.py (the SSE stream) and a thin widget page added in Task 9.
```

`djclass_overlay/overlay/admin.py`:

```python
# No models to register.
```

`djclass_overlay/overlay/migrations/__init__.py` — empty.
`djclass_overlay/overlay/tests/__init__.py` — empty.

- [ ] **Step 3: Register the app.** In `config/settings/base.py`, add to `INSTALLED_APPS` after `"djclass_overlay.djclass"`:

```python
    "djclass_overlay.overlay",
```

- [ ] **Step 4: Verify.**

```bash
uv run python manage.py check
uv run pytest -q
```

Expected: `System check identified no issues`; all existing tests pass (38 at time of writing).

- [ ] **Step 5: Commit.**

```bash
git add pyproject.toml uv.lock config/settings/base.py djclass_overlay/overlay
git commit -m "chore(overlay): scaffold overlay app + realtime deps (socketio 4.x EIO3, uvicorn)"
```

---

### Task 2: Pure DJ CLASS logic — constants, theory/power, rank parsing, thresholds — TDD

Port the dependency-free half of `src/lib/dj-class.ts`. Pure functions, no DB, no Django — port the Vitest cases directly to pytest.

**Files:**
- Create: `djclass_overlay/djclass/badges.py`, `djclass_overlay/djclass/tests/test_badges.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/djclass/tests/test_badges.py`):

```python
from djclass_overlay.djclass import badges


def test_constants():
    assert badges.THEORY_POWER_THRESHOLD == 10000
    assert badges.THEORY_POWER_CONVERSION_THRESHOLD == 9999.9847
    assert len(badges.RANK_ORDER) == 14
    assert badges.RANK_ORDER[0] == "THE LORD OF DJMAX"
    assert badges.RANK_ORDER[-1] == "BEGINNER"
    assert badges.SHORT_NAMES["SHOWSTOPPER"] == "SS"
    assert badges.SHORT_NAMES["THE LORD OF DJMAX"] == "LoD"


def test_is_theory_power():
    assert badges.is_theory_power(10000) is True
    assert badges.is_theory_power(10001) is True
    assert badges.is_theory_power(9999) is False
    assert badges.is_theory_power(None) is False


def test_is_theory_conversion():
    assert badges.is_theory_conversion(9999.9847) is True
    assert badges.is_theory_conversion(10000) is True
    assert badges.is_theory_conversion(9999.9846) is False
    assert badges.is_theory_conversion(9999.5) is False
    assert badges.is_theory_conversion(None) is False


def test_to_power_integer():
    assert badges.to_power_integer(9999.9847) == 10000   # theory bump
    assert badges.to_power_integer(10000) == 10000
    assert badges.to_power_integer(9999.9846) == 9999    # floor
    assert badges.to_power_integer(9999.5) == 9999
    assert badges.to_power_integer(8800.7) == 8800
    assert badges.to_power_integer(0) == 0               # genuine zero preserved
    assert badges.to_power_integer(None) is None


def test_parse_rank_name():
    assert badges.parse_rank_name("SHOWSTOPPER II") == "SHOWSTOPPER"
    assert badges.parse_rank_name("4B SHOWSTOPPER II") == "SHOWSTOPPER"  # strips button prefix
    assert badges.parse_rank_name("THE LORD OF DJMAX") == "THE LORD OF DJMAX"
    assert badges.parse_rank_name(None) == "BEGINNER"
    assert badges.parse_rank_name("") == "BEGINNER"


def test_extract_level():
    assert badges.extract_level("SHOWSTOPPER II") == "II"
    assert badges.extract_level("THE LORD OF DJMAX") is None
    assert badges.extract_level("4B HEADLINER IV") == "IV"


def test_get_threshold():
    assert badges.get_threshold("THE LORD OF DJMAX", None) == 9980   # default ignores level
    assert badges.get_threshold("SHOWSTOPPER", "II") == 9800
    assert badges.get_threshold("BEGINNER", None) == 0               # default
    assert badges.get_threshold("UNKNOWN RANK", "II") is None        # unknown rank
    assert badges.get_threshold("SHOWSTOPPER", None) is None         # rank needs a level, none given
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError`).

Run: `uv run pytest djclass_overlay/djclass/tests/test_badges.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/djclass/badges.py`):

```python
"""Pure DJ CLASS badge logic. 1:1 port of src/lib/dj-class.ts (no DB, no Django).

The server pre-resolves these atomic fields and the widget concatenates them per
its display mode, so the rank/level/threshold/theory rules live here once.
"""

import math
import re

# --- theory thresholds (dj-class.ts:6, :17) ---
THEORY_POWER_THRESHOLD = 10000
# V-ARCHIVE reports true in-game theory as a float slightly below 10000
# (observed 9999.9847); treat that as theory on the RAW conversion value.
THEORY_POWER_CONVERSION_THRESHOLD = 9999.9847

# --- rank ordering, best→worst (dj-class.ts:124) ---
RANK_ORDER = [
    "THE LORD OF DJMAX",
    "BEAT MAESTRO",
    "SHOWSTOPPER",
    "HEADLINER",
    "TREND SETTER",
    "PROFESSIONAL",
    "HIGH CLASS",
    "PRO DJ",
    "MIDDLEMAN",
    "STREET DJ",
    "ROOKIE",
    "AMATEUR",
    "TRAINEE",
    "BEGINNER",
]

# --- approximate DJ POWER floor per rank/level (dj-class.ts:77) ---
RANK_THRESHOLDS = {
    "THE LORD OF DJMAX": {"default": 9980},
    "BEAT MAESTRO": {"IV": 9900, "III": 9930, "II": 9950, "I": 9970},
    "SHOWSTOPPER": {"IV": 9700, "III": 9750, "II": 9800, "I": 9850},
    "HEADLINER": {"IV": 9400, "III": 9500, "II": 9600, "I": 9650},
    "TREND SETTER": {"IV": 9000, "III": 9100, "II": 9200, "I": 9300},
    "PROFESSIONAL": {"IV": 8600, "III": 8700, "II": 8800, "I": 8900},
    "HIGH CLASS": {"IV": 7800, "III": 8000, "II": 8200, "I": 8400},
    "PRO DJ": {"IV": 7000, "III": 7200, "II": 7400, "I": 7600},
    "MIDDLEMAN": {"IV": 6200, "III": 6400, "II": 6600, "I": 6800},
    "STREET DJ": {"IV": 5200, "III": 5500, "II": 5800, "I": 6000},
    "ROOKIE": {"IV": 4000, "III": 4300, "II": 4600, "I": 4900},
    "AMATEUR": {"IV": 2400, "III": 2800, "II": 3200, "I": 3600},
    "TRAINEE": {"IV": 500, "III": 1000, "II": 1500, "I": 2000},
    "BEGINNER": {"default": 0},
}

# --- short labels (dj-class.ts:59) ---
SHORT_NAMES = {
    "THE LORD OF DJMAX": "LoD",
    "BEAT MAESTRO": "BM",
    "SHOWSTOPPER": "SS",
    "HEADLINER": "HL",
    "TREND SETTER": "TS",
    "PROFESSIONAL": "PRO",
    "HIGH CLASS": "HC",
    "PRO DJ": "PD",
    "MIDDLEMAN": "MM",
    "STREET DJ": "SD",
    "ROOKIE": "RK",
    "AMATEUR": "AM",
    "TRAINEE": "TR",
    "BEGINNER": "BG",
}

# Roman level → ordinal, higher is better (dj-class.ts:142). Theory LoD = 5 (set in sort key).
LEVEL_VALUES = {"I": 4, "II": 3, "III": 2, "IV": 1}
# Button display preference: 8 > 5 > 6 > 4 (dj-class.ts:145) — note 6 sits BELOW 5.
BUTTON_PREFERENCE = {8: 3, 5: 2, 6: 1, 4: 0}

_LEVEL_RE = re.compile(r"\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$", re.IGNORECASE)
_PREFIX_RE = re.compile(r"^\d+B\s+")


def is_theory_power(power_integer):
    return power_integer is not None and power_integer >= THEORY_POWER_THRESHOLD


def is_theory_conversion(conversion):
    return conversion is not None and conversion >= THEORY_POWER_CONVERSION_THRESHOLD


def to_power_integer(conversion):
    if conversion is None:
        return None
    if is_theory_conversion(conversion):
        return THEORY_POWER_THRESHOLD
    return math.floor(conversion)


def parse_rank_name(dj_class):
    if not dj_class:
        return "BEGINNER"
    stripped = _PREFIX_RE.sub("", dj_class)
    stripped = _LEVEL_RE.sub("", stripped).strip()
    return stripped or "BEGINNER"


def extract_level(dj_class):
    if not dj_class:
        return None
    match = _LEVEL_RE.search(dj_class)
    return match.group(1).upper() if match else None


def get_threshold(rank_name, rank_level):
    thresholds = RANK_THRESHOLDS.get(rank_name)
    if not thresholds:
        return None
    if thresholds.get("default") is not None:
        return thresholds["default"]
    if rank_level is not None and thresholds.get(rank_level) is not None:
        return thresholds[rank_level]
    return None
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_badges.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/badges.py djclass_overlay/djclass/tests/test_badges.py
git commit -m "feat(djclass): port pure badge constants + threshold/power/rank logic"
```

---

### Task 3: Pure DJ CLASS selection + badge composition — TDD

Port `getClassSortKey` / `resolveDisplayedClass` (`dj-class.ts:141-241`) and add `build_badge`, which composes the atomic SSE fields. Selection works on any object exposing `.button`, `.dj_class`, `.dj_power_conversion` (the `DjClass` model, or a test stub).

**Files:**
- Modify: `djclass_overlay/djclass/badges.py` (append)
- Create: `djclass_overlay/djclass/tests/test_selection.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/djclass/tests/test_selection.py`):

```python
from dataclasses import dataclass

from djclass_overlay.djclass import badges


@dataclass
class Row:
    button: int
    dj_class: str
    dj_power_conversion: float | None


def test_sort_key_basic():
    # SHOWSTOPPER (idx 2 → ordinal 11), level IV (1), button 4 (0)
    assert badges.get_class_sort_key("SHOWSTOPPER IV", 9700, 4) == (11, 1, 0)


def test_sort_key_theory_lod_is_level_5():
    # raw 9999.9847 on LoD → level 5; plain LoD → level 0
    assert badges.get_class_sort_key("THE LORD OF DJMAX", 9999.9847, 4) == (13, 5, 0)
    assert badges.get_class_sort_key("THE LORD OF DJMAX", 9999.5, 4) == (13, 0, 0)


def test_sort_key_button_preference_8_5_6_4():
    # same rank+level, button preference 8 > 5 > 6 > 4
    assert badges.get_class_sort_key("ROOKIE I", 4900, 8)[2] == 3
    assert badges.get_class_sort_key("ROOKIE I", 4900, 5)[2] == 2
    assert badges.get_class_sort_key("ROOKIE I", 4900, 6)[2] == 1
    assert badges.get_class_sort_key("ROOKIE I", 4900, 4)[2] == 0


def test_sort_key_unknown_rank():
    assert badges.get_class_sort_key("NONSENSE II", 100, 4)[0] == -1


def test_resolve_auto_picks_highest_class():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, None, "auto")
    assert chosen.dj_class == "SHOWSTOPPER II"   # higher rank wins over higher button


def test_resolve_auto_class_beats_raw_power():
    # lower rank but higher power must lose — selection is by CLASS, not power
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9999)]
    assert badges.resolve_displayed_class(rows, None, "auto").dj_class == "SHOWSTOPPER II"


def test_resolve_viewer_prefers_preferred_button():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, 8, "viewer")
    assert chosen.button == 8                    # preferred even though not highest class


def test_resolve_viewer_falls_back_when_preferred_missing():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, 6, "viewer")  # no button-6 row
    assert chosen.dj_class == "SHOWSTOPPER II"


def test_resolve_viewer_falls_back_when_no_preference():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    assert badges.resolve_displayed_class(rows, None, "viewer").dj_class == "SHOWSTOPPER II"


def test_resolve_empty_is_none():
    assert badges.resolve_displayed_class([], None, "auto") is None


def test_build_badge_short_class_and_fields():
    badge = badges.build_badge(Row(4, "SHOWSTOPPER II", 9810))
    assert badge == {
        "button": 4,
        "class": "SS II",
        "rank": "SS",
        "power": 9810,
        "threshold": 9800,
        "isTheory": False,
    }


def test_build_badge_theory_lod():
    badge = badges.build_badge(Row(8, "THE LORD OF DJMAX", 9999.9847))
    assert badge == {
        "button": 8,
        "class": "LoD",        # level-less rank → no trailing level
        "rank": "LoD",
        "power": 10000,        # theory bump
        "threshold": 9980,
        "isTheory": True,
    }
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/djclass/tests/test_selection.py -q`

- [ ] **Step 3: Implement** — append to `djclass_overlay/djclass/badges.py`:

```python
def get_class_sort_key(dj_class, dj_power_conversion, button):
    """Port of dj-class.ts:147. Returns (rank_ordinal, level_ordinal, button_pref);
    bigger is better at every position, compared lexicographically (Python tuple order)."""
    rank_name = parse_rank_name(dj_class)
    try:
        rank_index = RANK_ORDER.index(rank_name)
        rank_ordinal = len(RANK_ORDER) - 1 - rank_index
    except ValueError:
        rank_ordinal = -1

    if rank_name == "THE LORD OF DJMAX" and is_theory_conversion(dj_power_conversion):
        level_ordinal = 5
    else:
        level = extract_level(dj_class)
        level_ordinal = LEVEL_VALUES.get(level, 0) if level else 0

    button_pref = BUTTON_PREFERENCE.get(button, -1)
    return (rank_ordinal, level_ordinal, button_pref)


def resolve_displayed_class(rows, preferred_button, sel):
    """Port of dj-class.ts:212. `rows` = objects with .button/.dj_class/.dj_power_conversion."""
    if not rows:
        return None
    if sel == "viewer" and preferred_button is not None:
        for row in rows:
            if row.button == preferred_button:
                return row
    # Highest CLASS by sort key. max() returns the first maximal row on ties,
    # matching the JS reduce that keeps the earlier `best` on a tie.
    return max(
        rows,
        key=lambda r: get_class_sort_key(r.dj_class, r.dj_power_conversion, r.button),
    )


def build_badge(row):
    """Compose the atomic SSE badge fields (spec §4.4.1) from a chosen DJ CLASS row.

    `class` = short rank + level (e.g. "SS II", or "LoD" for level-less ranks);
    `rank`  = short rank only (color/authority key); the widget prepends "<button>B".
    """
    rank_name = parse_rank_name(row.dj_class)
    level = extract_level(row.dj_class)
    rank_short = SHORT_NAMES.get(rank_name, rank_name)
    power = to_power_integer(row.dj_power_conversion)
    return {
        "button": row.button,
        "class": f"{rank_short} {level}" if level else rank_short,
        "rank": rank_short,
        "power": power,
        "threshold": get_threshold(rank_name, level),
        "isTheory": is_theory_power(power),
    }
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_selection.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/badges.py djclass_overlay/djclass/tests/test_selection.py
git commit -m "feat(djclass): port class selection + atomic badge composition"
```

---

### Task 4: In-memory TTL cache — TDD

Port the per-entry-TTL badge cache (`src/lib/cache.ts`). Python's `cachetools` only does a single global TTL, but the Node cache uses **per-entry** TTLs (linked 5 min / unsynced 15 s / unlinked 10 s), so hand-roll a tiny one. Inject the clock so expiry is testable without sleeping.

**Files:**
- Create: `djclass_overlay/common/cache.py`, `djclass_overlay/common/tests/test_cache.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_cache.py`):

```python
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
    assert c.get("k") == "v"        # not yet expired
    clock[0] = 1010.1
    assert c.get("k") is None       # expired, evicted


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
    c.set("c", 3, 100)              # over capacity → one old entry dropped
    present = [k for k in ("a", "b", "c") if c.get(k) is not None]
    assert present == ["c"] or len(present) == 2
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/common/tests/test_cache.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/common/cache.py`):

```python
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
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_cache.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/common/cache.py djclass_overlay/common/tests/test_cache.py
git commit -m "feat(common): per-entry TTL cache for badge resolution"
```

---

### Task 5: Badge resolver — sender → status + auto/viewer badges (DB + cache) — TDD

The server-side replacement for `src/app/api/widget/dj-class/route.ts`. **Synchronous** (plain Django ORM) so it's trivial to test; the async flush loop calls it via `sync_to_async`. Resolves a chat sender to `{status, badge}` where `badge` (when linked) carries both `auto` and `viewer` objects (spec §4.4.1 / open-question §11.1 default: emit both, widget picks).

**Files:**
- Create: `djclass_overlay/djclass/resolver.py`, `djclass_overlay/djclass/tests/test_resolver.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/djclass/tests/test_resolver.py`):

```python
import pytest

from djclass_overlay.djclass import resolver
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.fixture(autouse=True)
def _clear_cache():
    resolver.badge_cache.clear()
    yield
    resolver.badge_cache.clear()


@pytest.mark.django_db
def test_unlinked_when_no_user():
    out = resolver.resolve_sender_badges("nobody", "Ghost")
    assert out == {"status": "unlinked", "badge": None}


@pytest.mark.django_db
def test_unlinked_when_no_active_varchive_token():
    User.objects.create_user(chzzk_id="c1", chzzk_nickname="N")
    out = resolver.resolve_sender_badges("c1", "N")
    assert out["status"] == "unlinked"


@pytest.mark.django_db
def test_unsynced_when_linked_but_no_rows():
    u = User.objects.create_user(chzzk_id="c2", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    out = resolver.resolve_sender_badges("c2", "N")
    assert out == {"status": "unsynced", "badge": None}


@pytest.mark.django_db
def test_linked_emits_auto_and_viewer():
    u = User.objects.create_user(chzzk_id="c3", chzzk_nickname="N", preferred_button=8)
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9810)
    DjClass.objects.create(user=u, button=8, dj_class="HEADLINER I", dj_power_conversion=9660)
    out = resolver.resolve_sender_badges("c3", "N")
    assert out["status"] == "linked"
    assert out["badge"]["auto"]["class"] == "SS II"      # highest class
    assert out["badge"]["viewer"]["button"] == 8         # preferred button


@pytest.mark.django_db
def test_result_is_cached(django_assert_num_queries):
    u = User.objects.create_user(chzzk_id="c4", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="ROOKIE I", dj_power_conversion=4900)
    first = resolver.resolve_sender_badges("c4", "N")
    # Second call hits the cache — zero DB queries.
    with django_assert_num_queries(0):
        second = resolver.resolve_sender_badges("c4", "N")
    assert first == second
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/djclass/tests/test_resolver.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/djclass/resolver.py`):

```python
"""Resolve a chat sender to {status, badge} server-side.

Port of src/app/api/widget/dj-class/route.ts. Synchronous (plain ORM); the async
flush loop calls this via sync_to_async. Results are cached per sender with a TTL
that depends on status (linked 5 min / unsynced 15 s / unlinked 10 s).
"""

from djclass_overlay.common.cache import TTLCache
from djclass_overlay.djclass import badges
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

badge_cache = TTLCache()

_TTL = {"linked": 300, "unsynced": 15, "unlinked": 10}


def resolve_sender_badges(sender_channel_id, nickname=""):
    key = f"id:{sender_channel_id}" if sender_channel_id else f"nick:{nickname}"
    cached = badge_cache.get(key)
    if cached is not None:
        return cached
    result = _resolve_uncached(sender_channel_id, nickname)
    badge_cache.set(key, result, _TTL[result["status"]])
    return result


def _resolve_uncached(sender_channel_id, nickname):
    user = None
    if sender_channel_id:
        user = User.objects.filter(chzzk_id=sender_channel_id).first()
    if user is None and nickname:
        user = User.objects.filter(chzzk_nickname=nickname).first()
    if user is None:
        return {"status": "unlinked", "badge": None}

    if not VarchiveToken.objects.filter(user=user, is_active=True).exists():
        return {"status": "unlinked", "badge": None}

    rows = list(DjClass.objects.filter(user=user))
    auto = badges.resolve_displayed_class(rows, None, "auto")
    if auto is None:
        return {"status": "unsynced", "badge": None}

    viewer = badges.resolve_displayed_class(rows, user.preferred_button, "viewer")
    return {
        "status": "linked",
        "badge": {"auto": badges.build_badge(auto), "viewer": badges.build_badge(viewer)},
    }
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/djclass/tests/test_resolver.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/djclass/resolver.py djclass_overlay/djclass/tests/test_resolver.py
git commit -m "feat(djclass): server-side sender→badge resolver with TTL cache"
```

---

### Task 6: Chzzk realtime HTTP helpers — `get_session_url` + `subscribe_chat` (async) — TDD

Add the two realtime-only Chzzk calls the ingestor needs. Async `httpx` (called from the event loop), mirroring the validated spike `~/chzzk-spike/chzzk.py`. These are new; the existing OAuth helpers in `common/chzzk.py` stay sync and untouched.

**Files:**
- Modify: `djclass_overlay/common/chzzk.py` (append)
- Create: `djclass_overlay/common/tests/test_chzzk_realtime.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_chzzk_realtime.py`):

```python
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
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/common/tests/test_chzzk_realtime.py -q`

- [ ] **Step 3: Implement** — append to `djclass_overlay/common/chzzk.py`:

```python
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
```

> `httpx`, `API_URL`, and `TIMEOUT` are already imported/defined at the top of `chzzk.py` (from Plan 4). Do not redefine them.

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_chzzk_realtime.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/common/chzzk.py djclass_overlay/common/tests/test_chzzk_realtime.py
git commit -m "feat(common): async Chzzk session-url + chat-subscribe helpers"
```

---

### Task 7: Registry + ingestor message parsing — TDD

The in-memory registry and the **pure, testable** parts of the ingestor: the str-or-dict `parse` and the `CHAT` field extraction (port of `chat-proxy.ts:275-321`). The live socket lifecycle is added in Task 8 on top of these.

**Files:**
- Create: `djclass_overlay/overlay/registry.py`, `djclass_overlay/overlay/ingestor.py`, `djclass_overlay/overlay/tests/test_ingestor_parse.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/overlay/tests/test_ingestor_parse.py`):

```python
from djclass_overlay.overlay import ingestor


def test_parse_handles_dict_string_and_garbage():
    assert ingestor.parse({"a": 1}) == {"a": 1}
    assert ingestor.parse('{"a": 1}') == {"a": 1}
    assert ingestor.parse("not json") == {}
    assert ingestor.parse(123) == {}


def test_extract_chat_full_payload():
    raw = {
        "profile": {"nickname": "Streamer", "senderChannelId": "snd1"},
        "content": "hello {:cat:}",
        "channelId": "chan1",
        "messageTime": 1700000000000,
        "emojis": {"cat": "https://e/cat.png", "bad": 123},
    }
    msg = ingestor.extract_chat(raw, "chan1")
    assert msg == {
        "channelId": "chan1",
        "senderChannelId": "snd1",
        "nickname": "Streamer",
        "content": "hello {:cat:}",
        "messageTime": 1700000000000,
        "emojis": {"cat": "https://e/cat.png"},   # non-string emoji value dropped
    }


def test_extract_chat_fallbacks():
    # nickname falls back to top-level; channelId falls back to the connection's id;
    # missing emojis → {}
    msg = ingestor.extract_chat({"nickname": "Top", "content": "hi"}, "chanX")
    assert msg["nickname"] == "Top"
    assert msg["channelId"] == "chanX"
    assert msg["senderChannelId"] == ""
    assert msg["emojis"] == {}
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/overlay/tests/test_ingestor_parse.py -q`

- [ ] **Step 3: Implement the registry** (`djclass_overlay/overlay/registry.py`):

```python
"""In-memory realtime registry. Single process / single event loop (spec Decision 5).

Maps channel_id -> ChannelConnection holding the live Chzzk socket, the raw-message
buffer, the set of SSE subscriber queues, and the teardown timer. Mirrors the Node
`connections` Map in src/lib/chat-proxy.ts.
"""

from dataclasses import dataclass, field

import asyncio


@dataclass
class ChannelConnection:
    channel_id: str
    sio: object = None                      # socketio.AsyncClient | None
    session_key: str | None = None
    buffer: list = field(default_factory=list)          # raw CHAT message dicts
    subscribers: set = field(default_factory=set)       # asyncio.Queue per widget
    disconnect_task: asyncio.Task | None = None         # 30s teardown timer
    connect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


connections: dict[str, ChannelConnection] = {}


def get_or_create(channel_id):
    conn = connections.get(channel_id)
    if conn is None:
        conn = ChannelConnection(channel_id=channel_id)
        connections[channel_id] = conn
    return conn
```

- [ ] **Step 4: Implement the parse/extract helpers** (`djclass_overlay/overlay/ingestor.py`):

```python
"""Chzzk chat ingestor — pure helpers + (Task 8) the live socket lifecycle.

Faithful port of src/lib/chat-proxy.ts and the validated spike ~/chzzk-spike/.
"""

import json


def parse(data):
    """SYSTEM/CHAT payloads arrive as a JSON string or an already-decoded dict
    (chat-proxy.ts:275-285). Fall back to {} on anything else."""
    if isinstance(data, str):
        try:
            return json.loads(data)
        except Exception:
            return {}
    return data if isinstance(data, dict) else {}


def extract_chat(parsed, channel_id):
    """Port of chat-proxy.ts:287-321. Reads exactly the fields the Node app reads,
    with the same fallbacks and coercions; drops non-string emoji values."""
    profile = parsed.get("profile") or {}
    raw_emojis = parsed.get("emojis")
    emojis = (
        {k: v for k, v in raw_emojis.items() if isinstance(v, str)}
        if isinstance(raw_emojis, dict)
        else {}
    )
    return {
        "channelId": str(parsed.get("channelId") or channel_id),
        "senderChannelId": str(profile.get("senderChannelId") or parsed.get("senderChannelId") or ""),
        "nickname": str(profile.get("nickname") or parsed.get("nickname") or ""),
        "content": str(parsed.get("content") or ""),
        "messageTime": int(parsed.get("messageTime") or 0),
        "emojis": emojis,
    }
```

> Note: Node defaults `messageTime` to `Date.now()`; here we default to `0` (the field is unused downstream — the SSE event carries no timestamp — and `0` keeps `extract_chat` pure/deterministic for tests).

- [ ] **Step 5: Run — expect pass.** `uv run pytest djclass_overlay/overlay/tests/test_ingestor_parse.py -q`

- [ ] **Step 6: Commit.**

```bash
git add djclass_overlay/overlay/registry.py djclass_overlay/overlay/ingestor.py djclass_overlay/overlay/tests/test_ingestor_parse.py
git commit -m "feat(overlay): registry + ingestor message parse/extract"
```

---

### Task 8: Ingestor socket lifecycle — connect, subscribe, reconnect, teardown, token refresh — TDD

Build the live lifecycle on top of Task 7. The socket I/O is mocked in tests (the real connection is verified manually in Task 11, like the spike). DB token read/refresh uses sync ORM + the sync `chzzk.refresh_access_token`, wrapped via `sync_to_async`.

**Files:**
- Modify: `djclass_overlay/overlay/ingestor.py` (append)
- Create: `djclass_overlay/overlay/tests/test_ingestor_lifecycle.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/overlay/tests/test_ingestor_lifecycle.py`):

```python
import asyncio
from datetime import timedelta

import pytest
from asgiref.sync import async_to_sync
from django.utils import timezone

from djclass_overlay.common import crypto
from djclass_overlay.overlay import ingestor, registry
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.fixture(autouse=True)
def _clear_registry():
    registry.connections.clear()
    yield
    registry.connections.clear()


@pytest.mark.django_db
def test_get_channel_access_token_fresh():
    u = User.objects.create_user(chzzk_id="c1", chzzk_nickname="N")
    Channel.objects.create(
        user=u,
        chzzk_channel_id="c1",
        chzzk_access_token_encrypted=crypto.encrypt("ACCESS"),
        chzzk_refresh_token_encrypted=crypto.encrypt("REFRESH"),
        token_expires_at=timezone.now() + timedelta(hours=1),
    )
    assert ingestor.get_channel_access_token("c1") == "ACCESS"


@pytest.mark.django_db
def test_get_channel_access_token_refreshes_when_expired(monkeypatch):
    u = User.objects.create_user(chzzk_id="c2", chzzk_nickname="N")
    Channel.objects.create(
        user=u,
        chzzk_channel_id="c2",
        chzzk_access_token_encrypted=crypto.encrypt("OLD"),
        chzzk_refresh_token_encrypted=crypto.encrypt("OLDREFRESH"),
        token_expires_at=timezone.now() - timedelta(seconds=1),
    )
    from djclass_overlay.common import chzzk

    monkeypatch.setattr(
        chzzk, "refresh_access_token",
        lambda rt: {"access_token": "NEW", "refresh_token": "NEWREFRESH", "expires_in": 86400},
    )
    assert ingestor.get_channel_access_token("c2") == "NEW"
    ch = Channel.objects.get(chzzk_channel_id="c2")
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "NEW"
    assert crypto.decrypt(ch.chzzk_refresh_token_encrypted) == "NEWREFRESH"
    assert ch.token_expires_at > timezone.now()


@pytest.mark.django_db
def test_get_channel_access_token_none_when_no_channel():
    assert ingestor.get_channel_access_token("missing") is None


def test_schedule_teardown_cancelled_on_rejoin():
    async def scenario():
        conn = registry.get_or_create("ch")
        ingestor.schedule_teardown("ch", delay=10)
        assert conn.disconnect_task is not None
        ingestor.cancel_teardown(conn)        # rejoin cancels it
        assert conn.disconnect_task is None
    async_to_sync(scenario)()
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/overlay/tests/test_ingestor_lifecycle.py -q`

- [ ] **Step 3: Implement** — append to `djclass_overlay/overlay/ingestor.py`:

First add imports at the top of the file (next to the existing `import json`):

```python
import asyncio
import logging
from datetime import timedelta

import socketio
from asgiref.sync import sync_to_async
from django.utils import timezone

from djclass_overlay.common import chzzk, crypto
from djclass_overlay.overlay import registry

logger = logging.getLogger(__name__)

RECONNECT_DELAY = 5      # chat-proxy.ts:367
TEARDOWN_DELAY = 30      # chat-proxy.ts:484
```

Then append the lifecycle functions:

```python
def get_channel_access_token(channel_id):
    """Read the channel's access token, refreshing (and re-persisting) if expired.
    Plain sync (tested directly); connect_to_chat calls it via sync_to_async.
    Port of chat-proxy.ts:145-201."""
    from djclass_overlay.streamers.models import Channel

    channel = Channel.objects.filter(chzzk_channel_id=channel_id).first()
    if channel is None or not channel.chzzk_access_token_encrypted:
        return None

    if channel.token_expires_at and channel.token_expires_at < timezone.now():
        if not channel.chzzk_refresh_token_encrypted:
            logger.warning("[ingestor] no refresh token for %s", channel_id)
            return None
        try:
            refreshed = chzzk.refresh_access_token(crypto.decrypt(channel.chzzk_refresh_token_encrypted))
        except Exception:
            logger.exception("[ingestor] token refresh failed for %s", channel_id)
            return None
        channel.chzzk_access_token_encrypted = crypto.encrypt(refreshed["access_token"])
        channel.chzzk_refresh_token_encrypted = crypto.encrypt(refreshed["refresh_token"])
        channel.token_expires_at = timezone.now() + timedelta(seconds=refreshed["expires_in"])
        channel.save(update_fields=[
            "chzzk_access_token_encrypted",
            "chzzk_refresh_token_encrypted",
            "token_expires_at",
        ])
        return refreshed["access_token"]

    return crypto.decrypt(channel.chzzk_access_token_encrypted)


async def connect_to_chat(channel_id):
    """Connect a channel's Chzzk chat socket and wire CHAT → buffer.
    Dedup via the per-channel lock (port of the connectingPromise pattern)."""
    conn = registry.get_or_create(channel_id)
    async with conn.connect_lock:
        if conn.sio is not None and getattr(conn.sio, "connected", False):
            return
        token = await sync_to_async(get_channel_access_token)(channel_id)
        if not token:
            logger.warning("[ingestor] no access token for %s; not connecting", channel_id)
            return

        sio = socketio.AsyncClient(reconnection=False)
        conn.sio = sio

        @sio.on("SYSTEM")
        async def on_system(data):
            parsed = parse(data)
            if parsed.get("type") == "connected":
                key = (parsed.get("data") or {}).get("sessionKey")
                if key:
                    conn.session_key = key
                    try:
                        await chzzk.subscribe_chat(token, key)
                    except Exception:
                        logger.exception("[ingestor] subscribe failed for %s", channel_id)

        @sio.on("CHAT")
        async def on_chat(data):
            conn.buffer.append(extract_chat(parse(data), channel_id))

        @sio.on("disconnect")
        async def on_disconnect():
            conn.sio = None
            conn.session_key = None
            if conn.subscribers:
                schedule_reconnect(channel_id)
            else:
                registry.connections.pop(channel_id, None)

        url = await chzzk.get_session_url(token)
        try:
            await sio.connect(url, transports=["websocket"])
        except Exception:
            logger.exception("[ingestor] connect failed for %s", channel_id)
            conn.sio = None


def schedule_reconnect(channel_id, delay=RECONNECT_DELAY):
    """Single fixed-delay reconnect iff subscribers remain (chat-proxy.ts:343-372)."""
    async def _later():
        await asyncio.sleep(delay)
        conn = registry.connections.get(channel_id)
        if conn and conn.subscribers and conn.sio is None:
            await connect_to_chat(channel_id)
    asyncio.create_task(_later())


def schedule_teardown(channel_id, delay=TEARDOWN_DELAY):
    """Arm the 30s teardown after the last subscriber leaves (chat-proxy.ts:472-492)."""
    conn = registry.connections.get(channel_id)
    if conn is None:
        return
    if conn.disconnect_task:
        conn.disconnect_task.cancel()

    async def _later():
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        c = registry.connections.get(channel_id)
        if c and not c.subscribers:
            await teardown(channel_id)

    conn.disconnect_task = asyncio.create_task(_later())


def cancel_teardown(conn):
    """Cancel a pending teardown when a widget rejoins (chat-proxy.ts:460-464)."""
    if conn.disconnect_task:
        conn.disconnect_task.cancel()
        conn.disconnect_task = None


async def teardown(channel_id):
    conn = registry.connections.pop(channel_id, None)
    if conn is None:
        return
    cancel_teardown(conn)
    if conn.sio is not None:
        try:
            await conn.sio.disconnect()
        except Exception:
            pass
```

> The `schedule_teardown` test passes `delay=10` but immediately cancels, so the sleep never elapses — no real wait. The reconnect path is exercised live in Task 11.

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/overlay/tests/test_ingestor_lifecycle.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/overlay/ingestor.py djclass_overlay/overlay/tests/test_ingestor_lifecycle.py
git commit -m "feat(overlay): ingestor socket lifecycle — connect/subscribe/reconnect/teardown/refresh"
```

---

### Task 9: Flush loop — batch, dedup, resolve, fan-out — TDD

The ~250 ms batch builder (spec Decisions 6 & 7). `build_batch` is **sync** (it calls the sync resolver) and fully testable with `@pytest.mark.django_db`; `flush_once` does the buffer-swap + queue fan-out.

**Files:**
- Create: `djclass_overlay/overlay/flush.py`, `djclass_overlay/overlay/tests/test_flush.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/overlay/tests/test_flush.py`):

```python
import asyncio
import json

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.djclass import resolver
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.overlay import flush, registry
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.fixture(autouse=True)
def _reset():
    registry.connections.clear()
    resolver.badge_cache.clear()
    yield
    registry.connections.clear()
    resolver.badge_cache.clear()


@pytest.mark.django_db
def test_build_batch_resolves_and_dedups(django_assert_num_queries):
    u = User.objects.create_user(chzzk_id="s1", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9810)
    raw = [
        {"senderChannelId": "s1", "nickname": "N", "content": "hi", "emojis": {}},
        {"senderChannelId": "s1", "nickname": "N", "content": "again", "emojis": {"a": "u"}},
        {"senderChannelId": "ghost", "nickname": "G", "content": "yo", "emojis": {}},
    ]
    batch = flush.build_batch(raw)
    msgs = batch["messages"]
    assert len(msgs) == 3
    assert msgs[0]["text"] == "hi"
    assert msgs[0]["status"] == "linked"
    assert msgs[0]["badge"]["auto"]["class"] == "SS II"
    assert msgs[1]["emojis"] == {"a": "u"}
    assert msgs[2]["status"] == "unlinked"
    assert msgs[2]["badge"] is None
    # ids are unique within the batch
    assert len({m["id"] for m in msgs}) == 3


@pytest.mark.django_db
def test_build_batch_caps_messages():
    raw = [{"senderChannelId": "x", "nickname": "X", "content": str(i), "emojis": {}}
           for i in range(flush.MAX_BATCH + 50)]
    batch = flush.build_batch(raw)
    assert len(batch["messages"]) == flush.MAX_BATCH


def test_flush_once_pushes_event_to_subscribers():
    async def scenario():
        conn = registry.get_or_create("ch")
        q = asyncio.Queue()
        conn.subscribers.add(q)
        conn.buffer.append({"senderChannelId": "", "nickname": "Anon", "content": "hello", "emojis": {}})
        await flush.flush_once()
        assert conn.buffer == []                 # buffer drained
        data = q.get_nowait()
        assert data.startswith("event: chat\ndata: ")
        payload = json.loads(data.split("data: ", 1)[1].strip())
        assert payload["messages"][0]["text"] == "hello"
    async_to_sync(scenario)()


def test_flush_once_clears_buffer_when_no_subscribers():
    async def scenario():
        conn = registry.get_or_create("ch")
        conn.buffer.append({"senderChannelId": "", "nickname": "A", "content": "x", "emojis": {}})
        await flush.flush_once()
        assert conn.buffer == []                 # dropped — nobody listening
    async_to_sync(scenario)()
```

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/overlay/tests/test_flush.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/overlay/flush.py`):

```python
"""~250 ms batch flush: drain each channel buffer, resolve badges (dedup per sender),
build one batch event, fan out to subscriber queues. New behavior per spec Decisions
6 & 7 (the Node app forwarded per-message over WebSocket; here we batch over SSE)."""

import asyncio
import itertools
import json
import logging

from asgiref.sync import sync_to_async

from djclass_overlay.djclass.resolver import resolve_sender_badges
from djclass_overlay.overlay import registry

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 0.25     # 250 ms (spec Decision 7)
MAX_BATCH = 200           # abnormal-burst cap (spec §6)
KEEPALIVE_TIMEOUT = 15    # SSE idle heartbeat (matches the spike)

_id_counter = itertools.count(1)
_flush_task = None


def build_batch(raw_messages):
    """Sync: resolve each unique sender once, build the SSE batch payload (§4.4.1)."""
    per_batch = {}
    messages = []
    for m in raw_messages[:MAX_BATCH]:
        sender = m["senderChannelId"]
        cache_key = sender or f"nick:{m['nickname']}"
        if cache_key not in per_batch:
            per_batch[cache_key] = resolve_sender_badges(sender, m["nickname"])
        res = per_batch[cache_key]
        messages.append({
            "id": next(_id_counter),
            "text": m["content"],
            "emojis": m["emojis"],
            "status": res["status"],
            "badge": res["badge"],
        })
    return {"messages": messages}


async def flush_once():
    """One flush tick across all channels."""
    for channel_id, conn in list(registry.connections.items()):
        if not conn.buffer:
            continue
        raw = conn.buffer
        conn.buffer = []
        if not conn.subscribers:
            continue                              # drop: nobody listening
        payload = await sync_to_async(build_batch)(raw)
        data = f"event: chat\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        for q in list(conn.subscribers):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass


async def flush_loop():
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        try:
            await flush_once()
        except Exception:
            logger.exception("[flush] tick failed")


def ensure_flush_loop():
    """Start the single global flush loop on first use (idempotent)."""
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = asyncio.create_task(flush_loop())
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/overlay/tests/test_flush.py -q`

- [ ] **Step 5: Commit.**

```bash
git add djclass_overlay/overlay/flush.py djclass_overlay/overlay/tests/test_flush.py
git commit -m "feat(overlay): 250ms batch flush — resolve, dedup, fan-out"
```

---

### Task 10: SSE stream view + subscriber lifecycle + widget page + widget.js — TDD

The async SSE view ties it together: register a queue subscriber, lazily start the ingestor + flush loop, stream batches, and clean up (schedule 30 s teardown) on disconnect. Plus a thin widget page and the functional vanilla-JS client.

**Files:**
- Create: `djclass_overlay/overlay/sse.py`, `djclass_overlay/overlay/urls.py`
- Modify: `config/urls.py`
- Create: `djclass_overlay/templates/overlay/widget.html`, `djclass_overlay/overlay/static/overlay/widget.js`
- Create: `djclass_overlay/overlay/tests/test_sse.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/overlay/tests/test_sse.py`):

```python
import asyncio

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.overlay import registry, sse


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    registry.connections.clear()
    # Don't touch the network or start background loops in unit tests.
    monkeypatch.setattr(sse, "_ensure_ingestor", lambda channel_id: None)
    monkeypatch.setattr(sse, "_ensure_flush", lambda: None)
    yield
    registry.connections.clear()


def test_subscribe_registers_queue_and_cancels_teardown():
    async def scenario():
        q = sse.subscribe("ch")
        conn = registry.connections["ch"]
        assert q in conn.subscribers
        assert conn.disconnect_task is None
    async_to_sync(scenario)()


def test_unsubscribe_schedules_teardown_when_empty():
    async def scenario():
        q = sse.subscribe("ch")
        sse.unsubscribe("ch", q)
        conn = registry.connections["ch"]
        assert q not in conn.subscribers
        assert conn.disconnect_task is not None     # 30s teardown armed
        conn.disconnect_task.cancel()
    async_to_sync(scenario)()


def test_stream_view_sets_sse_headers(client):
    # A GET to the stream returns a streaming response with SSE headers.
    # (Django's sync test client can fetch the response object without draining it.)
    resp = client.get("/widget/chTest/stream")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "text/event-stream"
    assert resp["Cache-Control"] == "no-cache"
    assert resp["X-Accel-Buffering"] == "no"
    # tidy up the connection registered by the view
    registry.connections.clear()


def test_widget_page_renders(client):
    resp = client.get("/widget/chTest/")
    assert resp.status_code == 200
    assert b"widget.js" in resp.content
    assert b"chTest" in resp.content
```

> If the streaming-headers assertion proves awkward under the sync test client (it may try to consume the async iterator), switch that one test to `django.test.AsyncClient`: `resp = await AsyncClient().get(...)` in an `async def` test wrapped with `async_to_sync`. The header values are the contract that matters.

- [ ] **Step 2: Run — expect fail.**

Run: `uv run pytest djclass_overlay/overlay/tests/test_sse.py -q`

- [ ] **Step 3: Implement the SSE view** (`djclass_overlay/overlay/sse.py`):

```python
"""SSE stream + widget page. Async views under ASGI (uvicorn). A widget connection
registers an asyncio.Queue subscriber, lazily starts the channel ingestor and the
global flush loop, streams batch events, and on disconnect schedules a 30s teardown
(mirrors Node addWidget/removeWidget)."""

import asyncio

from django.http import StreamingHttpResponse
from django.shortcuts import render

from djclass_overlay.overlay import flush, ingestor, registry


def _ensure_ingestor(channel_id):
    conn = registry.connections.get(channel_id)
    if conn and conn.sio is None:
        asyncio.create_task(ingestor.connect_to_chat(channel_id))


def _ensure_flush():
    flush.ensure_flush_loop()


def subscribe(channel_id):
    """Register a new SSE subscriber queue; cancel any pending teardown."""
    conn = registry.get_or_create(channel_id)
    ingestor.cancel_teardown(conn)
    q = asyncio.Queue(maxsize=1000)
    conn.subscribers.add(q)
    return q


def unsubscribe(channel_id, q):
    conn = registry.connections.get(channel_id)
    if conn is None:
        return
    conn.subscribers.discard(q)
    if not conn.subscribers:
        ingestor.schedule_teardown(channel_id)


async def widget_stream(request, channel_id):
    q = subscribe(channel_id)
    _ensure_ingestor(channel_id)
    _ensure_flush()

    async def gen():
        try:
            yield ": connected\n\n"                # open the stream promptly
            while True:
                try:
                    yield await asyncio.wait_for(q.get(), timeout=flush.KEEPALIVE_TIMEOUT)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"        # survive proxy idle timeouts
        finally:
            unsubscribe(channel_id, q)

    resp = StreamingHttpResponse(gen(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


def widget_page(request, channel_id):
    return render(request, "overlay/widget.html", {"channel_id": channel_id})
```

- [ ] **Step 4: Add URLs** (`djclass_overlay/overlay/urls.py`):

```python
from django.urls import path

from . import sse

urlpatterns = [
    path("widget/<str:channel_id>/stream", sse.widget_stream, name="widget_stream"),
    path("widget/<str:channel_id>/", sse.widget_page, name="widget_page"),
]
```

- [ ] **Step 5: Include at the project root.** In `config/urls.py`, add alongside the existing includes:

```python
    path("", include("djclass_overlay.overlay.urls")),
```

- [ ] **Step 6: Create the widget page** (`djclass_overlay/templates/overlay/widget.html`):

```html
{% load static %}
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DJ CLASS Overlay</title>
    <style>
      /* Minimal, transparent overlay. Full styling (colors/glint/opacity) → Plan 6. */
      html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
      #chat { display: flex; flex-direction: column; justify-content: flex-end;
              height: 100vh; padding: 8px; gap: 4px; box-sizing: border-box;
              font-family: system-ui, sans-serif; color: #fff;
              text-shadow: 0 1px 1px rgba(0,0,0,0.8); }
      .row { transition: opacity 0.5s; }
      .row.fading { opacity: 0; }
      .badge { display: inline-block; padding: 0 4px; margin-right: 4px; border-radius: 4px;
               font-weight: 700; font-size: 0.85em; background: #444; }
      .badge.unverified { background: #6b7280; }
      .emoji { height: 1em; vertical-align: text-bottom; }
      #status { position: fixed; top: 4px; left: 4px; font-size: 12px; opacity: 0.6; }
    </style>
  </head>
  <body>
    <div id="status">채팅 연결 중…</div>
    <div id="chat"></div>
    <script>
      window.CHANNEL_ID = "{{ channel_id|escapejs }}";
    </script>
    <script src="{% static 'overlay/widget.js' %}"></script>
  </body>
</html>
```

- [ ] **Step 7: Create the widget client** (`djclass_overlay/static/overlay/widget.js`):

```javascript
/* Functional DJ CLASS overlay widget (vanilla JS, no build).
   Consumes the SSE batch stream; assembles badge text per mode from the atomic
   fields the server pre-resolved. Visual polish (gradient colors, theory glint,
   opacity tiers, daisyUI) is deferred to Plan 6. Parity helpers ported from
   src/lib/{font-size,fadeout,emoji}.ts and the badge-text rules in dj-class.ts. */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var MODE = ["short", "threshold", "power"].indexOf(params.get("mode")) >= 0
    ? params.get("mode") : "short";
  var BUTTON_SEL = params.get("buttonSel") === "viewer" ? "viewer" : "auto";
  var FONT_SIZE = parseFontSize(params.get("fontSize"));
  var FADEOUT_SEC = parseFadeout(params.get("fadeout"));

  var chat = document.getElementById("chat");
  var statusEl = document.getElementById("status");
  chat.style.fontSize = FONT_SIZE + "px";

  function parseFontSize(raw) {              // font-size.ts: 12–28, default 14
    if (!raw) return 14;
    var n = Number(raw);
    if (!isFinite(n)) return 14;
    return Math.min(28, Math.max(12, Math.round(n)));
  }
  function parseFadeout(raw) {               // fadeout.ts: 5–60, 0<x<5 ⇒ off, none ⇒ off
    if (!raw) return 0;
    var n = Number(raw);
    if (!isFinite(n)) return 0;
    var r = Math.round(n);
    if (r < 5) return 0;
    return Math.min(60, r);
  }

  function badgeText(badge) {                // dj-class.ts getBadgeText, atomic fields
    var prefix = badge.button + "B";
    if (MODE === "power") return prefix + " " + (badge.power == null ? 0 : badge.power);
    if (MODE === "threshold") {
      if (badge.isTheory) return prefix + " 10000";
      if (badge.threshold != null) return prefix + " " + badge.threshold + "+";
      return prefix + " " + badge.rank;
    }
    return prefix + " " + badge["class"];     // short
  }

  var EMOJI_RE = /\{:([\w-]+):\}/g;          // emoji.ts parseEmojiContent
  function appendContent(parent, content, emojis) {
    var last = 0, m;
    EMOJI_RE.lastIndex = 0;
    while ((m = EMOJI_RE.exec(content)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(content.slice(last, m.index)));
      var url = emojis && emojis[m[1]];
      if (url) {
        var img = document.createElement("img");
        img.src = url; img.alt = ""; img.className = "emoji"; img.loading = "lazy";
        parent.appendChild(img);
      }                                       // unmatched key dropped
      last = m.index + m[0].length;
    }
    if (last < content.length) parent.appendChild(document.createTextNode(content.slice(last)));
  }

  function addMessage(msg) {
    var row = document.createElement("div");
    row.className = "row";
    row.dataset.created = String(Date.now());

    if (msg.status === "linked" && msg.badge) {
      var b = document.createElement("span");
      b.className = "badge";
      b.textContent = badgeText(msg.badge[BUTTON_SEL]);
      row.appendChild(b);
    } else if (msg.status === "unlinked" || msg.status === "unsynced") {
      var u = document.createElement("span");
      u.className = "badge unverified";
      u.textContent = "미인증";
      row.appendChild(u);
    }

    var text = document.createElement("span");
    appendContent(text, msg.text, msg.emojis);
    row.appendChild(text);

    chat.appendChild(row);
    while (chat.childElementCount > 100) chat.removeChild(chat.firstChild);  // cap 100
    chat.scrollTop = chat.scrollHeight;                                       // pin bottom
  }

  if (FADEOUT_SEC > 0) {                      // two-phase fade: flag, then remove (+500ms)
    setInterval(function () {
      var now = Date.now();
      Array.prototype.slice.call(chat.children).forEach(function (row) {
        var age = now - Number(row.dataset.created || now);
        if (age >= FADEOUT_SEC * 1000 + 500) row.remove();
        else if (age >= FADEOUT_SEC * 1000) row.classList.add("fading");
      });
    }, 250);
  }

  var es = new EventSource("/widget/" + window.CHANNEL_ID + "/stream");
  es.onopen = function () { statusEl.textContent = ""; };
  es.onerror = function () { statusEl.textContent = "채팅 연결 실패 (재연결 중…)"; };
  es.addEventListener("chat", function (e) {
    var batch = JSON.parse(e.data);
    (batch.messages || []).forEach(addMessage);
  });
})();
```

- [ ] **Step 8: Run — expect pass.** `uv run pytest djclass_overlay/overlay/tests/test_sse.py -q`

- [ ] **Step 9: Full suite + check.**

```bash
uv run pytest -q
uv run python manage.py check
```

Expected: all green (existing 38 + the new tests).

- [ ] **Step 10: Commit.**

```bash
git add djclass_overlay/overlay/sse.py djclass_overlay/overlay/urls.py config/urls.py \
        djclass_overlay/templates/overlay djclass_overlay/static/overlay \
        djclass_overlay/overlay/tests/test_sse.py
git commit -m "feat(overlay): SSE stream view + functional vanilla-JS widget"
```

---

### Task 11: ASGI run config + live end-to-end verification (owner-driven) + cleanup

The suite mocks all external I/O; this proves the real socket path once, end-to-end, then removes the spike artifacts.

**Files:**
- Modify: `config/settings/base.py` (LOGGING for the realtime modules — optional but recommended)

- [ ] **Step 1: Add lightweight logging** so the live run is observable. Append to `config/settings/base.py`:

```python
# --- Logging (realtime is otherwise silent) ---
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "djclass_overlay": {"handlers": ["console"], "level": "INFO"},
    },
}
```

- [ ] **Step 2: Verify the ASGI app serves async SSE under uvicorn.** In the owner's terminal (uvicorn is installed; `--workers 1` is mandatory — in-memory state):

```bash
uv run uvicorn config.asgi:application --workers 1 --port 8000
```

Expected: server starts with no import errors. `manage.py runserver` is **not** sufficient for the long-lived ingestor/flush event loop — uvicorn is the dev and prod server (spec §7).

  Note: WhiteNoise middleware (added in the Plan 5 bug-fix commit) serves `/static/` under uvicorn via `WHITENOISE_USE_FINDERS = True`, so `widget.js` loads without `collectstatic`. `curl http://localhost:8000/static/overlay/widget.js` → 200 confirms this.

- [ ] **Step 3: Live round-trip (needs a real token + a live, chatted channel).** This is owner-driven and secret-bearing — run in your own terminal, token never echoed into a shared transcript.

  1. Get a fresh Chzzk access token for a channel you control (the legacy app's DB still has one): `export CHZZK_ACCESS_TOKEN=$(npx tsx get-token.ts <chzzkChannelId> 2>/dev/null)`.
  2. Ensure that channel exists in the Django DB with a valid token (from the Plan 3 migration, or log in via the Plan 4 flow). The ingestor reads the token from `channels`, not from the env var — so the channel row must have a non-expired token (or a refresh token).
  3. With uvicorn running, open `http://localhost:8000/widget/<chzzkChannelId>/?mode=short&buttonSel=auto&fontSize=18&fadeout=15` in a browser.
  4. Type in that channel's live chat. **Expected:** within ~250 ms, messages appear in the overlay; a linked sender (V-ARCHIVE-linked with synced rows) shows a `<button>B <class>` badge; an unlinked/unsynced sender shows the gray `미인증` chip; emojis render as images; with `fadeout=15`, messages fade after 15 s; the stream survives ≥1 min of silence (keepalive).
  5. **Parity spot-checks** against the Node app (spec §9 checklist): toggle `mode=threshold` (`<button>B <threshold>+`, theory → `10000`) and `mode=power` (`<button>B <power>`); `buttonSel=viewer` honors the sender's preferred button; `fontSize` clamps to 12–28.

- [ ] **Step 4: Record the result** in this plan (append a short "Live verification — <date>" block: pass/fail + any quirks), mirroring the Plan 1 spike results block.

- [ ] **Step 5: Tear down the spike + token helper** (their job is done; findings live in the plans):

```bash
rm -rf ~/chzzk-spike
rm -f get-token.ts
```

- [ ] **Step 6: Commit.**

```bash
git add config/settings/base.py docs/superpowers/plans/2026-06-22-django-migration-05-realtime.md
git commit -m "chore(overlay): realtime logging + record live verification; retire spike artifacts"
```

---

## Deferred (documented, not dropped)

- **Plan 6 (pages/daisyUI):** gradient rank colors (`DJ_CLASS_COLORS`), theory glint shimmer (`dj-class-badge.module.css` + `glintDelayMs`), `0.85em` badge sizing, unlinked/unsynced opacity tiers, Pretendard font, dashboard widget-URL builder. The widget here is functional with minimal styling.
- **Plan 7 (sync):** the daily `manage.py sync_djclass` that populates `dj_classes`; until then `unsynced` senders render badge-less. Login-time auto-sync (the Plan 4 extension point) also lands here.
- **Plan 8 (deploy/cutover):** the `web` (uvicorn `--workers 1`) + `worker` (cron `sync_djclass`) Procfile/Docker, Cloudflare Tunnel SSE config (`X-Accel-Buffering: no` already set), and the auth hardening checklist recorded at the end of Plan 4.

---

## Self-Review

- **Spec coverage:** Decision 4 (SSE, no Channels) ✓ `StreamingHttpResponse` async gen; Decision 5 (single ASGI proc + in-memory) ✓ registry + uvicorn `--workers 1` documented; Decision 6 (server-side badges in the event) ✓ resolver + `build_badge`, both `auto`+`viewer` emitted; Decision 7 (~250 ms batch, sender dedup, cap) ✓ flush loop. §4.4 ingestor (session-auth→`?auth=`→SYSTEM connected→subscribe→CHAT, 5 s reconnect, 30 s teardown, connect-dedup, token refresh) ✓ Task 8. §4.4.1 event shape ✓ Task 9/10. §11.1 buttonSel default (emit both) ✓. Parity checklist (3 modes, buttonSel, fontSize clamp, fadeout, theory, emoji, token refresh, 30 s cleanup) ✓ exercised in Task 11.
- **#1 risk (socketio protocol):** pinned `python-socketio~=4.6` / `python-engineio~=3.14` (EIO3), the spike-verified combo; rationale documented in Task 1.
- **Async/sync boundary:** pure logic + resolver + DB are sync (plain `@pytest.mark.django_db` tests); only socket/SSE/flush are async, tested via `async_to_sync`. No `pytest-asyncio` dependency needed.
- **Placeholders:** none — every step has complete, runnable code.
- **Type/name consistency:** resolver returns `{"status", "badge"}` where `badge` is `{"auto","viewer"}|None`; `build_badge` keys `button/class/rank/power/threshold/isTheory` consumed verbatim by `widget.js` `badgeText`; model fields match Plan 2/3 (`Channel.chzzk_access_token_encrypted`/`token_expires_at`, `DjClass.dj_class`/`dj_power_conversion`/`button`, `User.chzzk_id`/`preferred_button`, `VarchiveToken.is_active`); dotted paths are `djclass_overlay.*`; SSE event name `chat` matches the widget's `addEventListener("chat", …)`.
- **Ordering / green-throughout:** app scaffold (Task 1) precedes its use; URLs added with the view that backs them (Task 10); `manage.py check` + full suite run at Tasks 1 and 10.
- **Deliverable:** live Chzzk chat → 250 ms batched, server-badge-resolved SSE → functional OBS widget, fully unit-tested without live secrets, with a single owner-driven live round-trip to retire the spike.
