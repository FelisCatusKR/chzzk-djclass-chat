# Django Migration — Plan 9: In-process Daily Sync + Staging-First Cutover

> **For agentic workers:** Part A (code) uses REQUIRED SUB-SKILL superpowers:subagent-driven-development (or executing-plans), task-by-task with the checkbox (`- [ ]`) steps. Part B is an **operator runbook** — the owner runs it by hand against live Dokku + Cloudflare; do NOT execute Part B automatically (it touches production + secrets).

**Goal:** Finish the Next.js→Django migration: (A) move the daily V-ARCHIVE DJ-CLASS sync **into the single ASGI process** (no resurrected worker container), then (B) cut traffic over from the legacy Node app to Django **staging-first** — deploy Django as a second Dokku app, import the live data, parity-check, flip the Cloudflare Tunnel, with Node kept hot for instant rollback.

**Architecture:** The app is one `uvicorn --workers 1` process holding Django HTTP + SSE + the Chzzk ingestor + the 250 ms flush loop + an in-memory registry (spec Decision 5). Part A adds one more lifecycle-managed asyncio task — a **daily scheduler** that, once a day at 18:00 UTC, runs the existing sync in a non-thread-sensitive pool thread (mirroring `flush._build_batch_detached`, so it never blocks the event loop). Part B keeps that single-container shape: the Django app is deployed beside Node and the **Cloudflare Tunnel ingress** is the cutover switch (and the rollback switch).

**Tech Stack:** Python 3.14 / Django 6.0 / uvicorn / Postgres, Dokku, Cloudflare Tunnel (+ CF Access service token), `gh` Actions.

---

## Decisions baked in (brainstorming + owner answers, 2026-06-23)

- **Daily sync runs IN-PROCESS** (owner: "running cron in a single process if possible, else 2"). An asyncio task in the `runasgi` process replaces the dropped Node worker — no `dokku-cron` plugin, no second container, no GitHub-Actions schedule. **Fallback ("else 2"):** if the in-process sync ever competes with serving or you want isolation, promote it to a separate process — a Procfile `cron:` process running a blocking scheduler, OR a scheduled `gh` workflow that SSHes the tunnel and runs `dokku run … sync_djclass`. The code is structured so this fallback is a 5-line change (Part A keeps the sync logic in a plain callable).
- **Schedule = 18:00 UTC daily** (= 03:00 KST), matching the Node worker + master design §4.7. A process restart re-arms for the next 18:00; a sync missed during a deploy window is acceptable (data also refreshes at link-time + via the manual 동기화 button; `sync_user` is idempotent).
- **Sync offloaded to a pool thread** via `sync_to_async(…, thread_sensitive=False)` + `close_old_connections()` — the exact pattern `flush.py` already uses for its detached loop (a background task must not ride a request's `CurrentThreadExecutor`, and must manage its own DB connection).
- **Cutover = STAGING-FIRST** (owner). Deploy Django as a SECOND Dokku app (`chatoverlay-django`) beside the running Node `chatoverlay`; the **Cloudflare Tunnel ingress** is flipped Node→Django to cut over and Django→Node to roll back. Node stays running until a soak passes. The CI `deploy` job (which rebuilds `chatoverlay` on push to `main`) is **retargeted to `chatoverlay-django` only AFTER cutover** — until then `feat/django-migration` is NOT merged to `main`, so a stray merge can't clobber Node.
- **Single container, no rolling deploy:** the in-memory registry means `web=1` and a redeploy briefly drops SSE connections (widgets auto-reconnect) — acceptable for an overlay.

---

## PART A — In-process daily sync scheduler (code)

### Task A1: Extract a reusable `sync_all_active_links()` (DRY the command)

**Files:**
- Modify: `djclass_overlay/djclass/sync.py`
- Modify: `djclass_overlay/djclass/management/commands/sync_djclass.py`
- Test: `djclass_overlay/djclass/tests/test_sync.py`

- [ ] **Step 1: Write the failing test** in `test_sync.py`:
```python
def test_sync_all_active_links_tallies_and_isolates_failures(db, monkeypatch):
    from djclass_overlay.djclass import sync as sync_mod
    u1 = User.objects.create(chzzk_id="a")
    u2 = User.objects.create(chzzk_id="b")
    VarchiveToken.objects.create(user=u1, varchive_nickname="n1", is_active=True)
    VarchiveToken.objects.create(user=u2, varchive_nickname="n2", is_active=True)
    VarchiveToken.objects.create(user=u1, varchive_nickname="off", is_active=False)

    def fake_sync_user(link):
        if link.varchive_nickname == "n2":
            raise RuntimeError("boom")
        return {"ok": True, "stale": False, "highest": None}

    monkeypatch.setattr(sync_mod, "sync_user", fake_sync_user)
    success, failed = sync_mod.sync_all_active_links()
    assert (success, failed) == (1, 1)  # n1 ok, n2 raised, inactive skipped
```

- [ ] **Step 2: Run it — fails** (`AttributeError: sync_all_active_links`):
`uv run pytest djclass_overlay/djclass/tests/test_sync.py -k sync_all_active_links -q`

- [ ] **Step 3: Implement** in `djclass_overlay/djclass/sync.py` (add at the end; add `import logging` + `logger = logging.getLogger(__name__)` at the top if absent):
```python
def sync_all_active_links() -> tuple[int, int]:
    """Sync every active link by its V-ARCHIVE nickname; return (success, failed).

    One bad link never stops the batch. Shared by the `sync_djclass` command and the
    in-process daily scheduler (overlay.scheduler).
    """
    links = VarchiveToken.objects.filter(is_active=True).select_related("user")
    success = failed = 0
    for link in links:
        try:
            result = sync_user(link)
        except Exception:  # noqa: BLE001 — one bad link must not stop the batch
            failed += 1
            logger.exception("[sync] %s failed", link.varchive_nickname)
            continue
        if result["ok"]:
            success += 1
        else:
            failed += 1
            logger.warning(
                "[sync] %s: no data (stale=%s)", link.varchive_nickname, result["stale"]
            )
    return success, failed
```
(Import `VarchiveToken` from `djclass_overlay.viewers.models` — guard with `if TYPE_CHECKING` only if a runtime cycle appears; `sync.py` already imports models at runtime so a direct import is fine.)

- [ ] **Step 4: Refactor the command to use it** — replace the loop body of `sync_djclass.py` `handle`:
```python
    def handle(self, *args: Any, **options: Any) -> None:
        success, failed = sync_all_active_links()
        self.stdout.write(f"[sync_djclass] synced={success} failed={failed}")
```
(Add `from djclass_overlay.djclass.sync import sync_all_active_links`; drop the now-unused `sync_user` / `VarchiveToken` imports if they become unused — `ruff check` will flag them.)

- [ ] **Step 5: Run tests — pass** (the new test + the existing `sync_djclass` command tests, which still assert the `synced=/failed=` stdout line):
`uv run pytest djclass_overlay/djclass -q` → green. Then `uv run mypy djclass_overlay config` → Success.

- [ ] **Step 6: Commit**
```bash
git add djclass_overlay/djclass/sync.py djclass_overlay/djclass/management/commands/sync_djclass.py djclass_overlay/djclass/tests/test_sync.py
git commit -m "refactor(sync): extract sync_all_active_links() for command + scheduler reuse"
```

---

### Task A2: The scheduler module (`overlay/scheduler.py`)

**Files:**
- Create: `djclass_overlay/overlay/scheduler.py`
- Test: `djclass_overlay/overlay/tests/test_scheduler.py`

- [ ] **Step 1: Write the failing tests** in a new `test_scheduler.py`:
```python
from datetime import UTC, datetime

import pytest

from djclass_overlay.overlay import scheduler


@pytest.mark.parametrize(
    "now_h, now_m, expect_h",
    [(10, 0, 8), (17, 30, 0.5), (18, 0, 24), (19, 0, 23)],  # hours until next 18:00 UTC
)
def test_seconds_until_next_run(now_h, now_m, expect_h):
    now = datetime(2026, 6, 23, int(now_h), int(now_m), tzinfo=UTC)
    assert scheduler._seconds_until(18, now) == pytest.approx(expect_h * 3600)


@pytest.mark.asyncio
async def test_run_sync_invokes_sync_all(monkeypatch):
    calls = {}
    def fake_sync_all():
        calls["ran"] = True
        return (3, 1)
    monkeypatch.setattr(scheduler, "sync_all_active_links", fake_sync_all)
    await scheduler._run_sync()
    assert calls["ran"] is True
```
(If `pytest-asyncio` isn't configured, run `_run_sync` via `asyncio.run(...)` in a sync test instead — match the repo's existing async-test style in `overlay/tests/`.)

- [ ] **Step 2: Run — fails** (`ModuleNotFoundError: scheduler`):
`uv run pytest djclass_overlay/overlay/tests/test_scheduler.py -q`

- [ ] **Step 3: Implement `djclass_overlay/overlay/scheduler.py`:**
```python
"""In-process daily V-ARCHIVE sync. A single asyncio task in the runasgi process
(spec Decision 5: one process, no worker container). Once a day at SYNC_HOUR_UTC it
runs sync_all_active_links in a non-thread-sensitive pool thread (like the flush
loop) so the blocking ORM + httpx never stall the event loop."""

import asyncio
import contextlib
import logging
from datetime import UTC
from datetime import datetime
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.db import close_old_connections

from djclass_overlay.djclass.sync import sync_all_active_links

logger = logging.getLogger(__name__)

SYNC_HOUR_UTC = 18  # 18:00 UTC = 03:00 KST (master design §4.7)

_scheduler_task: asyncio.Task[None] | None = None


def _seconds_until(hour_utc: int, now: datetime) -> float:
    """Seconds from `now` (tz-aware UTC) to the next `hour_utc`:00:00 UTC.
    Exactly at the hour -> a full day (24h), so we never busy-loop on a 0 delay."""
    target = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _sync_blocking() -> tuple[int, int]:
    close_old_connections()
    try:
        return sync_all_active_links()
    finally:
        close_old_connections()


async def _run_sync() -> None:
    success, failed = await sync_to_async(_sync_blocking, thread_sensitive=False)()
    logger.info("[scheduler] daily sync done: synced=%s failed=%s", success, failed)


async def daily_sync_loop() -> None:
    while True:
        await asyncio.sleep(_seconds_until(SYNC_HOUR_UTC, datetime.now(UTC)))
        try:
            await _run_sync()
        except Exception:
            logger.exception("[scheduler] daily sync failed")


def ensure_scheduler() -> None:
    """Start the single daily-sync loop (idempotent). Called at runasgi startup."""
    global _scheduler_task  # noqa: PLW0603 — single process-wide scheduler handle
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(daily_sync_loop())


async def stop_scheduler() -> None:
    """Cancel the daily-sync loop on shutdown (idempotent)."""
    global _scheduler_task  # noqa: PLW0603 — single process-wide scheduler handle
    task = _scheduler_task
    _scheduler_task = None
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
```
> NOTE: the `_seconds_until` "next day" arithmetic above is intentionally written plainly. Implement it cleanly with `datetime.timedelta(days=1)`: `from datetime import timedelta`; if `target <= now: target += timedelta(days=1)`; `return (target - now).total_seconds()`. (Drop the placeholder line — it only marks where the +1-day goes.)

- [ ] **Step 4: Run tests — pass.** `uv run pytest djclass_overlay/overlay/tests/test_scheduler.py -q` → green. `uv run mypy djclass_overlay config` → Success. (`_seconds_until` is pure + parametrized-tested; `_run_sync` offloads to a thread.)

- [ ] **Step 5: Commit**
```bash
git add djclass_overlay/overlay/scheduler.py djclass_overlay/overlay/tests/test_scheduler.py
git commit -m "feat(overlay): in-process daily sync scheduler (18:00 UTC, pool-thread)"
```

---

### Task A3: Wire the scheduler into the process lifecycle

**Files:**
- Modify: `djclass_overlay/common/management/commands/runasgi.py` (start it)
- Modify: `djclass_overlay/overlay/lifecycle.py` (stop it)
- Test: `djclass_overlay/overlay/tests/test_lifecycle.py`

- [ ] **Step 1: Write the failing test** in `test_lifecycle.py` — shutdown cancels the scheduler:
```python
async def test_shutdown_stops_scheduler():
    from djclass_overlay.overlay import lifecycle, scheduler
    scheduler.ensure_scheduler()
    task = scheduler._scheduler_task
    assert task is not None and not task.done()
    await lifecycle.shutdown()
    assert scheduler._scheduler_task is None
    assert task.cancelled() or task.done()
```
(Match the existing async-test invocation style in `test_lifecycle.py`.)

- [ ] **Step 2: Run — fails** (shutdown doesn't touch the scheduler yet).

- [ ] **Step 3: Stop it in `lifecycle.shutdown()`** — add `from djclass_overlay.overlay import scheduler` to `lifecycle.py`'s imports, and at the END of `shutdown()` (after the socket teardown loop, before the final log line):
```python
    # Stop the in-process daily-sync scheduler.
    await scheduler.stop_scheduler()
```

- [ ] **Step 4: Start it at process startup** in `runasgi.py` `_serve()` — import `scheduler` next to `lifecycle` (`from djclass_overlay.overlay import scheduler`), and inside `_serve()` BEFORE `await server.serve()` (e.g. right after `watcher = asyncio.create_task(_watch_exit())`):
```python
            scheduler.ensure_scheduler()  # daily V-ARCHIVE sync, in-process
```

- [ ] **Step 5: Run tests — pass.** `uv run pytest djclass_overlay/overlay -q` → green; full `uv run pytest -q` → 131+ (the 3 new tests added). `uv run mypy djclass_overlay config` → Success. `uv run ruff check djclass_overlay config manage.py` → clean.

- [ ] **Step 6: Manual smoke (optional, owner machine)** — `uv run python manage.py runasgi` and confirm a log line shows the scheduler armed (you can temporarily set `SYNC_HOUR_UTC` to the current hour+minute to watch one run, then revert).

- [ ] **Step 7: Commit**
```bash
git add djclass_overlay/common/management/commands/runasgi.py djclass_overlay/overlay/lifecycle.py djclass_overlay/overlay/tests/test_lifecycle.py
git commit -m "feat(overlay): arm daily scheduler in runasgi, cancel on shutdown"
```

**End of Part A — the dropped Node worker is now an in-process task. Do NOT merge to `main` yet (see Part B B0).**

---

## PART B — Staging-first cutover runbook (operator-run)

> Run these by hand. Each step has a verification; do not proceed past a failed check. `chatoverlay` = the live Node app; `chatoverlay-django` = the new Django app. Substitute YOUR values for `<…>`. Auth to Dokku is the existing SSH-over-tunnel + CF Access service token (same as the CI `deploy` job).

### B0 — Pre-flight
- [ ] All of Part A is committed on `feat/django-migration`; CI is green (ruff + djlint + mypy + 131+ tests). **`feat/django-migration` is NOT merged to `main`** (a merge would trigger the CI `deploy` job against the live `chatoverlay`/Node app). It stays unmerged until B8.
- [ ] You have, ready as Dokku config values: `DJANGO_SECRET_KEY` (new 50+ char random), `VARCHIVE_TOKEN_KEY` (the SAME key the Node app used to encrypt Chzzk channel tokens — required so re-encryption round-trips; if the Node app didn't encrypt or you're re-collecting tokens, a fresh key is fine but channels may need re-auth), `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, and the public origin `BASE_URL=https://chatoverlay.felis.kr`.

### B1 — Export the live legacy data → JSON
The `import_legacy` command expects a JSON array of users in this exact shape (optional keys may be omitted):
```json
[
  {
    "chzzk_id": "abc123",
    "chzzk_nickname": "워나힐",
    "preferred_button": 6,
    "channel": {
      "chzzk_channel_id": "ch_…",
      "access_token": "…", "refresh_token": "…",
      "token_expires_at": "2026-07-01T00:00:00Z"
    },
    "varchive_token": { "varchive_nickname": "wannaheal", "is_active": true },
    "dj_classes": [
      {"button": 6, "dj_class": "BEAT MAESTRO I", "dj_power_sum": 9900.0,
       "max_dj_power": 9950.0, "dj_power_conversion": 9930.0}
    ]
  }
]
```
- [ ] Produce `export.json` with the committed **`scripts/export-legacy.ts`** (validated against the dev DB 2026-06-23 — it reads all four tables, **decrypts** the channel tokens via the Node `src/lib/crypto` `decrypt()`, and **drops** the V-ARCHIVE token to nickname-only). Run it WHILE the Node app still exists (it imports `src/lib/crypto`), against a **copy** of the production sqlite:
```bash
# VARCHIVE_TOKEN_KEY = the key the Node app used to encrypt channel tokens (so decrypt works).
# DATABASE_URL       = path to the copied production sqlite file (defaults to ./data/app.db).
VARCHIVE_TOKEN_KEY='<node-key>' DATABASE_URL=/path/to/prod-copy.db \
  npx tsx scripts/export-legacy.ts
# -> writes export.json + prints: Exported N users -> export.json (M channels, K V-ARCHIVE links)
```
- [ ] Verify: the printed user count matches the Node app, `export.json` parses, and a spot-checked user has a **plaintext** `channel.access_token` (NOT a base64 blob), the right `dj_classes`, and `varchive_token.varchive_nickname`. (Note: Django's `import_legacy` re-encrypts `access_token`/`refresh_token` with ITS `VARCHIVE_TOKEN_KEY`, which may differ from the Node key — the plaintext is the bridge.)

### B2 — Provision the Django app + Postgres on Dokku
- [ ] `dokku apps:create chatoverlay-django`
- [ ] `dokku postgres:create chatoverlay-django-db` then `dokku postgres:link chatoverlay-django-db chatoverlay-django` (this sets `DATABASE_URL` on the app).
- [ ] `dokku ports:set chatoverlay-django http:80:8000` (the container listens on 8000 per the Procfile/Dockerfile; the tunnel will target :80).
- [ ] `dokku ps:scale chatoverlay-django web=1` (single container — the in-memory registry forbids >1).

### B3 — Set config (secrets + prod settings)
- [ ] One `config:set` (no rebuild yet — use `--no-restart`; the first deploy restarts anyway):
```bash
dokku config:set --no-restart chatoverlay-django \
  DJANGO_SETTINGS_MODULE=config.settings.production \
  DJANGO_SECRET_KEY='<secret>' \
  VARCHIVE_TOKEN_KEY='<the-node-token-key>' \
  CHZZK_CLIENT_ID='<id>' CHZZK_CLIENT_SECRET='<secret>' \
  BASE_URL='https://chatoverlay.felis.kr' \
  DJANGO_ALLOWED_HOSTS='chatoverlay.felis.kr'
```
- [ ] Verify `dokku config:show chatoverlay-django` lists all of the above + `DATABASE_URL` (from the link). (`DJANGO_CSRF_TRUSTED_ORIGINS` defaults to `BASE_URL` — only set it if you need extra origins.)

### B4 — Deploy Django to the staging app
- [ ] Deploy the migration branch (the `release` process runs `migrate --noinput`; the image bakes `collectstatic`):
```bash
dokku git:sync --build chatoverlay-django https://github.com/FelisCatusKR/chzzk-djclass-chat.git feat/django-migration
```
- [ ] Verify: the build succeeds, `release` ran migrations, and `dokku ps:report chatoverlay-django` shows the `web` container running. Check `dokku logs chatoverlay-django` for a clean uvicorn start (and the scheduler arming).

### B5 — Import the live data
- [ ] Copy `export.json` to where the app container can read it, then:
```bash
# e.g. via dokku storage or by piping; simplest: run the command with the file mounted/available
dokku run chatoverlay-django python manage.py import_legacy /app/export.json
```
- [ ] Verify the command prints `Imported N users` (N == B1 count). Then **warm the data**: `dokku run chatoverlay-django python manage.py sync_djclass` (don't wait for 18:00 UTC for the first fill) → `synced=… failed=…`.

### B6 — Parity check (before any traffic flip)
Reach the staging app WITHOUT moving real traffic — add a TEMPORARY Cloudflare Tunnel hostname (e.g. `staging-overlay.felis.kr`) pointing at `chatoverlay-django:80`, or use `dokku domains:add` + a temporary DNS/hosts entry. Then verify against the Django app:
- [ ] Landing `/` renders (frosted theme); `/login/` → Chzzk OAuth round-trips → `/dashboard/` (use a real Chzzk login; confirm the imported user maps to the right account).
- [ ] `/link/` htmx flow: 동기화 swaps the card in place; the badge preview matches.
- [ ] The OBS overlay: open the widget URL for a channel with live chat → badges render end-to-end over SSE.
- [ ] `dokku logs chatoverlay-django` is clean (no CSP violations, no 500s, no DB errors).
- [ ] Remove the temporary staging hostname when satisfied.

### B7 — Flip the Cloudflare Tunnel (THE cutover)
- [ ] In the Cloudflare Tunnel config (dashboard or `config.yml`), change the **ingress rule for `chatoverlay.felis.kr`** from the Node target (`chatoverlay:80`/`:3000`) to **`chatoverlay-django:80`**. Apply.
- [ ] Verify on the REAL domain `https://chatoverlay.felis.kr`: landing renders, a real login works, an overlay shows live badges. Watch `dokku logs chatoverlay-django`.
- [ ] **Leave the Node `chatoverlay` app RUNNING** (untouched) for rollback.

### B8 — Rollback (keep this visible during the soak)
- [ ] If anything is wrong after B7: revert the Cloudflare Tunnel ingress for `chatoverlay.felis.kr` back to the Node target. Traffic returns to Node instantly (its data never stopped). Investigate offline. No data loss — the cutover is read-compatible (both apps read their own DB; Node's SQLite is untouched).

### B9 — Post-cutover (after a clean soak, e.g. 24–48 h incl. one 18:00 UTC sync)
- [ ] Confirm the in-process scheduler ran: `dokku logs chatoverlay-django | grep scheduler` shows `daily sync done` at ~18:00 UTC.
- [ ] **Retarget CI to the Django app:** edit `.github/workflows/ci.yml` `deploy` job — change `git:sync --build chatoverlay …` to `chatoverlay-django`, then merge `feat/django-migration` → `main` (now safe: `main` deploys Django to the Django app). The merge follows the PR-gated `main` workflow.
- [ ] Decommission Node: `dokku ps:stop chatoverlay` (keep it for a few days), then `dokku apps:destroy chatoverlay` once confident. (Optionally later `dokku apps:rename chatoverlay-django chatoverlay` + update the tunnel ingress + CI target, so names match the old scheme.)
- [ ] Retire the legacy Node code from the repo (separate cleanup commit) once nothing references it.

---

## Self-Review

- **Decisions honored:** in-process scheduler (no worker container), 18:00 UTC, pool-thread offload (flush pattern), `else 2` fallback documented ✓; staging-first cutover, tunnel-flip switch, Node-hot rollback, CI retarget gated behind cutover ✓; single container (`web=1`) ✓.
- **Part A is TDD + green-gateable:** A1 extracts a tested pure-ish function (DRY with the command, whose existing tests still pass), A2 adds the scheduler with a *pure* `_seconds_until` (parametrized test) + a thread-offloaded `_run_sync`, A3 wires start (runasgi) + stop (lifecycle, with a shutdown test). Each task ends with `pytest`/`mypy`/`ruff` green. The scheduler is started only by `runasgi`, so the existing 131 tests are unaffected (it never arms under pytest).
- **No event-loop blocking:** `_run_sync` uses `sync_to_async(thread_sensitive=False)` + `close_old_connections()` exactly like `flush._build_batch_detached` — the realtime serving keeps ticking during a sync. Errors are isolated (`daily_sync_loop` try/except; `sync_all_active_links` per-link try/except) so a bad sync can't crash the process or the loop.
- **Placeholder honesty:** the only deliberately-loose spot is the B1 export (it depends on the owner's Node SQLite schema, which isn't in this repo) — the exact TARGET JSON shape is fully specified and a template `better-sqlite3` script is given to adapt. All Part-A code blocks are complete and runnable as written.
- **Safety:** Part B never destroys Node until B9 (post-soak); rollback is a single tunnel-ingress revert with no data loss; the `main` merge (which auto-deploys) is held until after a clean cutover so it can't clobber Node.
- **Deliverable:** the migration is complete — Django serves all traffic on a single ASGI container with an in-process daily sync, Node decommissioned, CI deploying the Django app, with a tested rollback path.
