# mypy + django-stubs Comprehensive Type-Check — Implementation Plan (code-quality 2/2, before cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **comprehensive static typing** to the Django source — `mypy` + `django-stubs` (the mypy Django plugin), configured per cookiecutter-django plus strict "every function is annotated" flags — so the codebase is fully type-checked and gated in CI, completing the pre-cutover code-quality work (Plan ① ruff/djlint is already done).

**Architecture:** One `[tool.mypy]` + `[tool.django-stubs]` config in `pyproject.toml`. The base config is **`strict = true`** (mypy's full strict preset), with a single shrinking **"ratchet" override** that starts every app lenient and is emptied one app at a time — so *every task ends with `mypy` fully green*, and once the ratchet is empty all source is strict and future un-annotated code fails CI. Data-shape contracts (badge / V-ARCHIVE / sync / SSE payloads) become `TypedDict`s co-located with their producer; `djclass/badges.py` stays Django-free via a `Protocol` instead of importing the model. Annotation order is dependency-first (foundational `common`/`config` → leaf models → `djclass` core → `viewers` → async `overlay`).

**Tech Stack:** mypy 1.13–2.1 (via `django-stubs[compatible-mypy]`), django-stubs 6.0.5 (supports Django 4.2–6.0 + Python 3.10–3.14 — confirmed against our Django 6.0.6 / Python 3.14), GitHub Actions, the existing husky/lint-staged.

---

## Decisions baked in (from brainstorming + exploration, 2026-06-23)

- **Tool = mypy + django-stubs**, NOT `ty` (Astral) — `ty` is beta and cannot type Django ORM models/managers until its stable 2026 release. django-stubs is the only production-ready Django type-checker.
- **Ambition = comprehensive source typing**: every source function gets parameter + return annotations, enforced by mypy's full `strict = true`. Tests and migrations are relaxed.
- **Config = `strict = true`** (owner delegated the choice to best practice 2026-06-23; django-stubs is built to support strict). `strict` bundles `disallow_untyped_defs`, `disallow_incomplete_defs`, `disallow_untyped_calls`, `disallow_any_generics`, `disallow_untyped_decorators`, `warn_return_any`, `strict_equality`, `warn_unused_ignores`, `warn_redundant_casts`, `no_implicit_reexport`, `check_untyped_defs`, etc. **Targeted relaxations** — the only places strict fights Django: `*.tests.*` (no annotation / generic-parameterization requirement — tests stay readable, verified by *running*), and `config.settings.*` keeps `implicit_reexport = true` for its intentional `from .base import *`. `ignore_missing_imports = true` keeps untyped third-party libs (socketio / engineio / environ) as `Any`. **DROP the DRF plugin** — no Django REST Framework here, so only `mypy_django_plugin.main`. If `disallow_untyped_decorators` proves noisy on a Django decorator django-stubs doesn't type, relax it with a one-line documented reason — but plan for it staying on. Expect minor friction at httpx `.json()` boundaries (`warn_return_any`) — fix by binding to a typed local (`data: dict[str, Any] = resp.json(); return data`), not a blanket ignore.
- **`django_settings_module = "config.settings.local"`** (matches pytest's `DJANGO_SETTINGS_MODULE`). The django-stubs plugin runs `django.setup()`, so **mypy needs the same environment as `manage.py check`** — locally `config.settings.base` reads `.env.django` (present in dev); in CI the env vars are set on the `build` job. No DB connection is made at setup, so no Postgres is needed for the mypy step.
- **No `from __future__ import annotations`, no `django-stubs-ext` / monkeypatch.** Verified there are no custom `Manager`/`QuerySet` subclasses. The project runs on **Python 3.14**, where PEP 649 makes annotations **deferred-by-default** (computed lazily, never eagerly evaluated at definition) — so `QuerySet[Model]` / `X | None` / `list[X]` in annotation position carry no runtime cost and forward references resolve without ceremony. The modules that annotate with models already import them for runtime use anyway, so forced forward references are essentially nil; where a type is needed ONLY for an annotation and a real runtime import would cycle, put that import under `if TYPE_CHECKING:` (on 3.14 the annotation needn't even be quoted — PEP 649 defers it). `from __future__ import annotations` is therefore pure redundancy on 3.14 (PEP 649 already does exactly that), so we skip it. **Zero new production dependency.**
- **Ratchet rollout**: strict base + one shrinking lenient override, emptied app-by-app, so each task is independently green-gateable. Order: `common`+`config` → `streamers`+`users` → `djclass` → `viewers` → `overlay`.
- **Enforcement**: a `mypy` step in the CI `build` job (it already has the Django env), plus optionally extend lint-staged.

## Baseline (measured 2026-06-23, so the work is scoped not guessed)
67 source files, ~2113 LOC, **99 functions of which only 3 are annotated**. 6 `models.py`. 13 `async def` in `overlay/` (sse 2, ingestor 7, lifecycle 1, flush 3). Dict-shaped payloads needing `TypedDict` live in `common/chzzk.py`, `djclass/{varchive,badges,sync,resolver}.py`, `overlay/{registry,flush,ingestor,sse}.py`, `viewers/views.py`.

---

### Task 1: Tooling + config + green baseline

**Files:** Modify `pyproject.toml`.

- [ ] **Step 1: Add the dev dependencies.**
```bash
uv add --dev mypy "django-stubs[compatible-mypy]"
```
Expected: `mypy` (1.13–2.1) and `django-stubs` (~6.0.5) added to `[dependency-groups] dev` + pinned in `uv.lock`.

- [ ] **Step 2: Add the mypy + django-stubs config** to `pyproject.toml` (append):
```toml
[tool.mypy]
python_version = "3.14"   # runtime; if the installed mypy doesn't recognize 3.14, fall back to "3.13" (code uses no 3.14-only syntax — ruff is pinned to py313)
strict = true
plugins = ["mypy_django_plugin.main"]
# `strict` already implies disallow_untyped_defs / disallow_incomplete_defs /
# disallow_untyped_calls / disallow_any_generics / disallow_untyped_decorators /
# warn_return_any / warn_unused_ignores / warn_redundant_casts / strict_equality /
# no_implicit_reexport / check_untyped_defs / warn_unused_configs.
# Keep untyped 3rd-party libs (socketio / engineio / environ) as Any:
ignore_missing_imports = true

# Migrations are generated — never type-check them.
[[tool.mypy.overrides]]
module = "*.migrations.*"
ignore_errors = true

# Tests stay readable (verified by running): no annotation / generic-parameterization requirement.
[[tool.mypy.overrides]]
module = "*.tests.*"
disallow_untyped_defs = false
disallow_incomplete_defs = false
disallow_untyped_calls = false
disallow_any_generics = false
check_untyped_defs = false

# Settings use `from .base import *` — keep implicit re-export here (else no_implicit_reexport fires).
[[tool.mypy.overrides]]
module = "config.settings.*"
implicit_reexport = true

# RATCHET — every app starts lenient; each annotation task (2–6) deletes its globs
# from this list until it is empty, then Task 6 removes this whole block.
[[tool.mypy.overrides]]
module = [
  "djclass_overlay.common.*",
  "config.*",
  "djclass_overlay.streamers.*",
  "djclass_overlay.users.*",
  "djclass_overlay.djclass.*",
  "djclass_overlay.viewers.*",
  "djclass_overlay.overlay.*",
]
# turn off everything strict would fire on un-annotated code, so lenient apps stay green:
disallow_untyped_defs = false
disallow_incomplete_defs = false
disallow_untyped_calls = false
disallow_any_generics = false
check_untyped_defs = false
warn_return_any = false

[tool.django-stubs]
django_settings_module = "config.settings.local"
```

- [ ] **Step 3: Run mypy to establish the baseline.**
```bash
uv run mypy djclass_overlay config
```
The plugin will run `django.setup()` (reads `.env.django`). Expected: **"Success: no issues found"** — every app is in the lenient ratchet (all annotation-requiring strict flags off + `check_untyped_defs=false`), so no annotation is required and bodies aren't checked yet; mypy only confirms the plugin loads, settings import, and stub-level types resolve. If the plugin can't import settings, confirm `.env.django` exists locally (it does in dev). If any error DOES appear at baseline (a bad import, a settings name error), fix it now. Do NOT add annotations yet (that's Tasks 2–6).

- [ ] **Step 4: Verify suite still green** (any body-fix must not change behavior):
```bash
uv run pytest -q
```
Expected: 131 passed.

- [ ] **Step 5: Commit.**
```bash
git add pyproject.toml uv.lock
git commit -m "build: add mypy + django-stubs (strict base + ratchet, all apps lenient)"
```

---

### Task 2: Annotate `common/` + `config/`

**Files:** `djclass_overlay/common/{cache,chzzk,crypto,middleware,ratelimit,admin}.py`, `djclass_overlay/common/management/commands/{import_legacy,runasgi}.py`, `djclass_overlay/common/models.py`, `config/{urls,asgi,wsgi}.py`, `config/settings/{base,local,production}.py`; `pyproject.toml` (ratchet).

> NOTE: `runasgi.py` lives under `common/` so it becomes strict in THIS task (the ratchet is by module path) — annotate it here even though it's overlay-conceptual; it is NOT in Task 6.

- [ ] **Step 1: Make `common` + `config` strict** — in `pyproject.toml`, DELETE `"djclass_overlay.common.*"` and `"config.*"` from the ratchet `module` list.

- [ ] **Step 2: Annotate every function** in the files above. Give each `def`/`async def` parameter types and a return type (native `X | None` / `list[X]` / `dict[K, V]` — NO `from __future__ import annotations`; see Decisions). Patterns:
  - `common/cache.py` (TTL cache): annotate the cache get/set helpers; a generic value is fine as `object` or a `TypeVar` if it's a typed wrapper — keep it simple (`str`/`object`).
  - `common/chzzk.py` (Chzzk OAuth/API httpx client): annotate request helpers `(...) -> dict[str, Any]` for the RAW external JSON (consumed defensively via `.get()`), but where the function returns an INTERNAL cleaned shape, define a `TypedDict` for it (e.g. the access-token result, the channel/user info) co-located at the top of the module. Use `httpx.Response` where a response is passed around.
  - `common/crypto.py`: `encrypt(value: str) -> str` / `decrypt(token: str) -> str` style.
  - `common/ratelimit.py`: `client_ip(request: HttpRequest) -> str`; `allow(request: HttpRequest, *, scope: str, limit: int, window: float, now: Callable[[], float] = time.monotonic) -> bool`; type `_buckets: dict[tuple[str, str], list[float | int]]` (or a small `@dataclass`/`TypedDict` if cleaner); `reset() -> None`.
  - `common/middleware.py`: `SecurityHeadersMiddleware.__init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None` and `__call__(self, request: HttpRequest) -> HttpResponse`.
  - `common/admin.py`: admin registrations are class-level; annotate any methods.
  - `common/management/commands/import_legacy.py`: `Command.handle(self, *args: Any, **options: Any) -> None` (the Django `BaseCommand` signature).
  - `common/management/commands/runasgi.py` (async ASGI runner): `Command.add_arguments(self, parser: ArgumentParser) -> None` (if present), `Command.handle(self, *args: Any, **options: Any) -> None`, the inner `async def _serve() -> None`, and the uvicorn `Config`/`Server` locals. Use `from collections.abc import ...` as needed; the `# noqa: ASYNC110` poll line already exists.
  - `config/asgi.py`, `config/wsgi.py`, `config/urls.py`: only module-level assignments (`application`, `urlpatterns`) — no defs to annotate. `config/settings/*.py`: module-level assignments only, so `disallow_untyped_defs` has nothing to bite. mypy follows the `from .base import *` star-import fine — confirm it's quiet on settings; ONLY if it reports a real `name-defined`/`misc` error there, add a targeted `# type: ignore[...]` on the offending line (do not broadly exclude settings).
  - For untyped third-party imports (`httpx` is typed; `socketio`, `engineio`, `environ` may lack stubs) — `ignore_missing_imports = true` already covers them; do NOT add per-import ignores.

- [ ] **Step 3: Run mypy — must be green for the now-strict modules:**
```bash
uv run mypy djclass_overlay config
```
Expected: "Success: no issues found". (The other apps are still lenient via the ratchet, so the whole command stays green; `common`/`config` are now strictly checked.) Fix every reported issue in `common`/`config` until clean.

- [ ] **Step 4: Suite green + commit.**
```bash
uv run pytest -q
git add -A
git commit -m "types: annotate common/ + config/ (strict)"
```

---

### Task 3: Annotate `streamers/` + `users/`

**Files:** `djclass_overlay/streamers/{models,apps}.py`, `djclass_overlay/users/{models,backends,views,apps}.py`; `pyproject.toml` (ratchet).

- [ ] **Step 1: Make them strict** — delete `"djclass_overlay.streamers.*"` and `"djclass_overlay.users.*"` from the ratchet list.

- [ ] **Step 2: Annotate** (native generics; no future import). Patterns:
  - **Models** (`streamers/models.py` `Channel`, `users/models.py` `User`): Django fields are class attributes — django-stubs infers them; you do NOT annotate the field assignments. DO annotate methods: `def __str__(self) -> str:`, any `save(self, *args: Any, **kwargs: Any) -> None`, custom properties `-> str | None`, and any classmethod/manager helper. The custom `User` manager methods (e.g. `create_user`) take typed params and return `User`.
  - `users/backends.py` (`ChzzkBackend`): `authenticate(self, request: HttpRequest | None, **kwargs: Any) -> User | None`; `get_user(self, user_id: int) -> User | None`.
  - `users/views.py` (OAuth login/callback/logout): each view `(request: HttpRequest) -> HttpResponse` (or `HttpResponseRedirect`). Annotate helper functions with their real param/return types.
  - `apps.py`: `AppConfig` subclasses — annotate `ready(self) -> None` if present; the `name`/`default_auto_field` are class attrs.

- [ ] **Step 3: mypy green + suite + commit.**
```bash
uv run mypy djclass_overlay config        # Success
uv run pytest -q                          # 131 passed
git add -A && git commit -m "types: annotate streamers/ + users/ (strict)"
```

---

### Task 4: Annotate `djclass/` — the domain core (+ the key TypedDicts)

**Files:** `djclass_overlay/djclass/{badges,varchive,sync,resolver,models}.py`, `djclass_overlay/djclass/management/commands/sync_djclass.py`; `pyproject.toml` (ratchet).

- [ ] **Step 1: Make `djclass` strict** — delete `"djclass_overlay.djclass.*"` from the ratchet list.

- [ ] **Step 2: Define the data-shape contracts** (exact — these are the design core).

  In `djclass/badges.py` (KEEP IT DJANGO-FREE — use a `Protocol`, do not import the model). Add at the top:
```python
from typing import Protocol
from typing import TypedDict


class DjClassRow(Protocol):
    """Structural type for a chosen DJ CLASS row (the DjClass model satisfies it)."""

    button: int
    dj_class: str
    dj_power_conversion: float | None


# `class` is a reserved word, so the badge dict MUST use functional TypedDict syntax.
BadgeDict = TypedDict(
    "BadgeDict",
    {
        "button": int,
        "class": str,
        "rank": str,
        "power": int | None,
        "threshold": int | None,
        "isTheory": bool,
    },
)
```
  Then annotate the pure functions precisely, e.g.:
```python
def is_theory_power(power_integer: int | None) -> bool: ...
def to_power_integer(conversion: float | None) -> int | None: ...
def parse_rank_name(dj_class: str | None) -> str: ...
def extract_level(dj_class: str | None) -> str | None: ...
def get_threshold(rank_name: str, rank_level: str | None) -> int | None: ...
def get_class_sort_key(dj_class: str | None, dj_power_conversion: float | None, button: int) -> tuple[int, int, int]: ...
def resolve_displayed_class(rows: Sequence[DjClassRow], preferred_button: int | None, sel: str) -> DjClassRow | None: ...
def build_badge(row: DjClassRow) -> BadgeDict: ...
def validate_preferred_button(button: int | None, available_buttons: Sequence[int]) -> int | None: ...
```
  (Type the module-level constant dicts too where it clarifies, e.g. `RANK_THRESHOLDS: dict[str, dict[str, int]]`, `BUTTON_PREFERENCE: dict[int, int]`. Use `from collections.abc import Sequence`.)

  In `djclass/varchive.py`:
```python
class VarchiveUser(TypedDict):
    user_no: int
    nickname: str


class VarchiveDjClass(TypedDict):
    button: int
    djClass: str
    djPowerSum: float | None
    maxDjPower: float | None
    djPowerConversion: float | None
```
  Signatures: `def lookup_user(token: str) -> VarchiveUser:`; `def get_dj_class(nickname: str, button: int) -> dict[str, Any]:` (raw external JSON); `def get_all_dj_classes(nickname: str) -> list[VarchiveDjClass]:`.

  In `djclass/sync.py`:
```python
class SyncResult(TypedDict):
    ok: bool
    stale: bool
    highest: DjClass | None
```
  Signatures: `def persist_user_dj_classes(user: User, classes: list[VarchiveDjClass]) -> None:`; `def sync_user(link: VarchiveToken) -> SyncResult:`. (`sync.py` already imports `DjClass`/`VarchiveToken` at runtime, so annotating with them is free; import `User`/`VarchiveDjClass` too. If any one import would create a runtime cycle, move just that import under `if TYPE_CHECKING:` and quote its annotation — `def sync_user(link: "VarchiveToken") -> SyncResult:`.)

- [ ] **Step 3: Annotate the rest** — `djclass/resolver.py` (the cache resolver + `invalidate_user(user: User) -> None`, `_resolve_uncached`, the `id:`/`nick:` cache helpers — return `list[BadgeDict]` or the SSE-facing shape; match the real returns), `djclass/models.py` (`DjClass` / `VarchiveToken` methods + `__str__ -> str`), and `sync_djclass.py` (`Command.handle(self, *args: Any, **options: Any) -> None`, plus the per-link loop helper).

- [ ] **Step 4: mypy green + suite + commit.**
```bash
uv run mypy djclass_overlay config        # Success
uv run pytest -q                          # 131 passed
git add -A && git commit -m "types: annotate djclass/ core + TypedDicts (BadgeDict/VarchiveDjClass/SyncResult)"
```

---

### Task 5: Annotate `viewers/`

**Files:** `djclass_overlay/viewers/{models,views,urls,admin,apps}.py`; `pyproject.toml` (ratchet).

- [ ] **Step 1: Make `viewers` strict** — delete `"djclass_overlay.viewers.*"` from the ratchet list.

- [ ] **Step 2: Annotate** (native generics; no future import).
  - `viewers/models.py` (`VarchiveToken`): `__str__ -> str`, any helpers; fields are inferred.
  - `viewers/views.py` (the htmx `/link` views — `link_page`, `link_connect`, `link_sync`, `link_unlink`, `link_preferred_button`, the `_render_card` helper): each view `(request: HttpRequest) -> HttpResponse`; `_render_card(request: HttpRequest, link: VarchiveToken | None, ...) -> HttpResponse`. Where a view consumes `sync_user`'s result, the `SyncResult` TypedDict from Task 4 types the access (`result["ok"]`, `result["highest"]`). The `options` list built for the preferred-button form is `list[dict[str, Any]]` (or a small `TypedDict` if you define one).
  - `viewers/urls.py`: `urlpatterns` global, no defs. `viewers/admin.py`: annotate methods.

- [ ] **Step 3: mypy green + suite + commit.**
```bash
uv run mypy djclass_overlay config        # Success
uv run pytest -q                          # 131 passed
git add -A && git commit -m "types: annotate viewers/ (strict)"
```

---

### Task 6: Annotate `overlay/` — the async realtime core

**Files:** `djclass_overlay/overlay/{registry,flush,ingestor,lifecycle,sse,models,apps}.py`; `pyproject.toml` (ratchet). (`runasgi.py` was annotated in Task 2 — it lives under `common/`.)

- [ ] **Step 1: Make `overlay` strict + retire the ratchet** — `overlay` is the LAST app, so deleting `"djclass_overlay.overlay.*"` empties the ratchet `module` list. Do NOT leave an empty list (mypy's `warn_unused_configs` would flag it) — **delete the entire ratchet `[[tool.mypy.overrides]]` block**, leaving only the `*.migrations.*` and `*.tests.*` overrides. The whole source tree is now strict by default.

- [ ] **Step 2: Annotate, with correct async/await types.** Use `from collections.abc import AsyncIterator, Awaitable, Coroutine` as needed (no future import).
  - `overlay/registry.py`: the in-memory connection registry. Define a `TypedDict` or a small `@dataclass` for a connection record (the fields actually stored — buffer list, channel id, the per-connection asyncio objects). Annotate the register/unregister/lookup helpers with it. Module globals get explicit types (e.g. `_connections: dict[str, ConnState]`).
  - `overlay/flush.py`: `async def` flush helpers return `None` or `Coroutine`; the module task handle `_flush_task: asyncio.Task[None] | None`; `ensure_flush_loop() -> None`, `stop_flush_loop() -> None`, `async def flush_once(...) -> None`.
  - `overlay/ingestor.py`: the python-socketio handlers and `async def connect_to_chat(channel_id: str) -> None`; `_spawn(coro: Coroutine[Any, Any, None]) -> None`; `_background_tasks: set[asyncio.Task[Any]]`; the SYSTEM/CHAT payload parsing returns a typed dict (define a `ChatEvent`/`SystemEvent` `TypedDict` matching what `parse(...)` builds, or `dict[str, Any]` for the raw socket payload consumed defensively).
  - `overlay/sse.py`: the SSE view returns `StreamingHttpResponse`; the async generator is `async def _event_stream(...) -> AsyncIterator[str]`; `connect_to_chat` scheduling typed. Define the SSE badge-event payload `TypedDict` (what is JSON-serialized to the widget — likely wraps `BadgeDict` + the short `rank` etc.) or import/reuse `BadgeDict`.
  - `overlay/lifecycle.py`: `async def shutdown() -> None` and the registry/flush teardown helpers.
  - `overlay/models.py`, `apps.py`: methods + `ready(self) -> None`.

- [ ] **Step 3: mypy green + suite + commit.**
```bash
uv run mypy djclass_overlay config        # Success — ratchet block removed; all apps strict
uv run pytest -q                          # 131 passed
git add -A && git commit -m "types: annotate overlay/ async realtime core (strict)"
```

---

### Task 7: Full-strict verification + CI gate + local hook

**Files:** `pyproject.toml` (remove the emptied ratchet block), `.github/workflows/ci.yml`, `package.json`.

- [ ] **Step 1: Confirm the ratchet is gone.** Task 6 removed the ratchet `[[tool.mypy.overrides]]` block when it flipped the last app strict. Verify `pyproject.toml` now has ONLY the `*.migrations.*` and `*.tests.*` overrides under `[tool.mypy]`. The whole source tree is strict by default.

- [ ] **Step 2: Confirm whole-source strict green:**
```bash
uv run mypy djclass_overlay config
```
Expected: "Success: no issues found in N source files". If removing the ratchet surfaces a missed file (a module that was only green because it was lenient), annotate it now until clean. Also run a sanity check that strictness is actually ON — temporarily add an unannotated `def _probe(x): return x` to any source file, confirm `mypy` now FAILS on it (`error: Function is missing a type annotation`), then remove the probe.

- [ ] **Step 3: Add the mypy gate to CI.** In `.github/workflows/ci.yml`, add to the `build` job (it already exports `DJANGO_SECRET_KEY`, `VARCHIVE_TOKEN_KEY`, `CHZZK_*`, `DATABASE_URL`, `BASE_URL` — the plugin's `django.setup()` needs these; no DB connection is made). Place it next to the other static gates (after the ruff/djlint steps):
```yaml
      - run: uv run mypy djclass_overlay config
```

- [ ] **Step 4: (Optional) extend lint-staged for `*.py`.** mypy is a whole-program checker (it needs `django.setup()` + cross-module context), so running it per-staged-file is unreliable — do NOT add a naive per-file mypy to lint-staged. If a local pre-push check is wanted, the CI gate is the source of truth; leave lint-staged as-is (ruff/djlint only). Document this choice in the commit body.

- [ ] **Step 5: Verify the CI commands pass locally + commit.**
```bash
uv run ruff check djclass_overlay config manage.py
uv run ruff format --check djclass_overlay config manage.py
uv run djlint djclass_overlay/templates --check && uv run djlint djclass_overlay/templates --lint
uv run mypy djclass_overlay config
uv run pytest -q
git add .github/workflows/ci.yml pyproject.toml package.json
git commit -m "ci: gate mypy; whole source now strictly typed"
```

---

## Self-Review

- **Decisions honored:** mypy + django-stubs (ty rejected) ✓; comprehensive `strict = true` with tests/migrations/settings relaxations ✓; DRF plugin dropped ✓; `django_settings_module=config.settings.local` + CI env note ✓; no future-import / no `django-stubs-ext` (native generics + 3.14 PEP 649 deferred annotations; `TYPE_CHECKING` for any cycle) ✓; ratchet rollout so every task is green-gateable ✓; CI gate + deliberate no-mypy-in-lint-staged ✓.
- **Version safety:** django-stubs 6.0.5 ⇒ Django 4.2–6.0 (covers 6.0.6) + mypy 1.13–2.1 + Python 3.10–3.14 (covers 3.14) — confirmed via current docs, not assumed.
- **Concreteness:** the design-bearing types are fully specified from the real code — `BadgeDict` (functional syntax, `class` key), `DjClassRow` Protocol (keeps `badges.py` Django-free), `VarchiveUser`/`VarchiveDjClass`, `SyncResult`, plus exact signatures for `djclass/badges.py`. For `common`/`overlay` payloads (chzzk/registry/sse) the plan specifies the *rule* (TypedDict for internal cleaned shapes, `dict[str, Any]` for raw external JSON) — the exact fields are read from the real return dicts during implementation, with `mypy --strict-on-that-module` as the precise done-gate.
- **Per-task green gate:** the ratchet (strict base + shrinking lenient override, `check_untyped_defs=false` while lenient) means `uv run mypy djclass_overlay config` is "Success" at the end of EVERY task (1 = green baseline, nothing body-checked; 2–6 each flip one app strict and annotate to green; 6 removes the now-empty ratchet block; 7 confirms + proves strictness with a throwaway probe). No task leaves mypy red.
- **Behavior safety:** annotations are inert (evaluated once at def-time, no behavior change); the only runtime edits are occasional real-bug fixes surfaced when an app's bodies first get strict-checked — each task re-runs `pytest -q` (must stay 131 green).
- **Name consistency:** `BadgeDict`/`DjClassRow`/`VarchiveUser`/`VarchiveDjClass`/`SyncResult` are produced in Task 4 and consumed by name in Tasks 5–6; the ratchet globs removed in Tasks 2–6 exactly match the list seeded in Task 1; any `TYPE_CHECKING`-guarded forward ref is quoted.
- **Deliverable:** a comprehensively, strictly type-checked Django source tree, mypy-gated in CI — completing the pre-cutover code-quality track (Plan ① + Plan ②), ready for Plan 9 (cutover).
