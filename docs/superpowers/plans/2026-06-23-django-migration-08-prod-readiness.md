# Production Readiness — Implementation Plan (migration plan 8/9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Django app production-deployable on Dokku — hardened settings + security headers + CSP + rate-limiting + a Python Dockerfile/Procfile + `collectstatic` + a Django CI — so it can run **alongside** the Node app for verification. **All code/config; the live cutover is Plan 9.**

**Architecture:** Layer production hardening onto the existing `config/settings/{base,production}.py` split (env-agnostic security in `base`, prod-only in `production`), using Django 6.0's **built-in** CSP (`ContentSecurityPolicyMiddleware` + `SECURE_CSP`) — no new dependency. A tiny in-memory per-IP rate limiter (`common/ratelimit.py`, same single-process style as `common/cache.py`) keyed on `CF-Connecting-IP` guards the link/sync/auth routes. A uv-based multi-stage Dockerfile + a Procfile (`web: runasgi`, `release: migrate`) replace the Node ones; WhiteNoise serves collected static. CI moves to uv/pytest with a `check --deploy` security gate.

**Tech Stack:** Django 6.0.6 built-in CSP + security middleware, `manage.py runasgi` (existing, graceful SIGTERM shutdown), WhiteNoise compressed-manifest static, uv + Python 3.13 Docker, Dokku + Cloudflare Tunnel, pytest-django, GitHub Actions.

---

## Decisions baked in (from brainstorming, 2026-06-23)

- **Scope:** prod-readiness **code/config only**. The one-time cutover (Dokku Postgres, `config:set`, `import_legacy`, the cron, the tunnel flip, parity, rollback) is **Plan 9**. Plan 8 ends with a Django app that the owner deploys **alongside** Node (staging) to verify.
- **CSP:** Django 6.0 **built-in** (`django.middleware.csp.ContentSecurityPolicyMiddleware` + `SECURE_CSP`/`SECURE_CSP_REPORT_ONLY`, `django.utils.csp.CSP` constants) — **no `django-csp` dependency, no custom middleware**. The policy is necessarily a static allowlist with `'unsafe-eval'` (Alpine evaluates `x-*`) on `script-src` and `'unsafe-inline'` (`@tailwindcss/browser` injects `<style>` at runtime) on `style-src` — nonces can't help given those. Small win: all our scripts are external `src`, so `script-src` needs no `'unsafe-inline'`. **Rolled out report-only first** (`SECURE_CSP_REPORT_ONLY`), flipped to enforcing (`SECURE_CSP`) in the final task after a clean browser check.
- **Rate-limiting:** app-level **custom in-memory** per-IP limiter (`common/ratelimit.py`), keyed on **`CF-Connecting-IP`** (real client IP behind the tunnel). Fits the single-process `--workers 1` model like `common/cache.py`. Cloudflare edge rate-limiting is optional defense-in-depth → Plan 9. Limits (per master design §6): link 5/60s, sync 3/60s, preferred-button 10/60s, auth-callback 10/60s.
- **CSRF + security headers** (owner-requested 2026-06-23): CSRF already on (`CsrfViewMiddleware`); add `CSRF_TRUSTED_ORIGINS` (proxy-safe POSTs), `CSRF_COOKIE_HTTPONLY`; HSTS, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, a minimal `Permissions-Policy`. The gate is **`manage.py check --deploy --fail-level WARNING`** passing in CI (Django's own prod-security checklist). One deliberate exception: **no `SECURE_SSL_REDIRECT`** (Cloudflare serves HTTPS-only at the edge; an in-app redirect risks loops on the OAuth/SSE paths) — its check warning (`security.W008`) is silenced with a comment.
- **Web process:** `manage.py runasgi` (not bare uvicorn) — it reacts to Dokku's SIGTERM via uvicorn's `should_exit` and runs `overlay.lifecycle.shutdown()` so SSE streams close cleanly.

## Already in the codebase (reuse)

- `config/settings/base.py`: `MIDDLEWARE` (security, whitenoise, sessions, common, csrf, auth, messages), `SESSION_COOKIE_HTTPONLY/SAMESITE`, `STATIC_ROOT`, `WHITENOISE_USE_FINDERS`, `BASE_URL`, `env`.
- `config/settings/production.py`: `DEBUG=False`, `ALLOWED_HOSTS`, required `CHZZK_*`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`.
- `djclass_overlay/common/cache.py` (the in-memory TTLCache style to mirror), `djclass_overlay/common/management/commands/runasgi.py` (`--host`/`--port`, graceful shutdown).
- `djclass_overlay/viewers/views.py` (the four link views), `djclass_overlay/users/views.py` (`chzzk_callback`).
- Test pattern: `client`, `@pytest.mark.django_db`, `monkeypatch`, `client.force_login(u, backend="djclass_overlay.users.backends.ChzzkBackend")`.

---

### Task 1: Hardened security settings + headers (TDD)

Add the env-agnostic security headers (base) and the prod-only transport hardening + CSRF settings (production), plus a tiny middleware for `Permissions-Policy` (Django has no built-in).

**Files:**
- Create: `djclass_overlay/common/middleware.py`
- Create: `djclass_overlay/common/tests/test_security_headers.py`
- Modify: `config/settings/base.py`, `config/settings/production.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_security_headers.py`):

```python
def test_security_headers_present(client):
    resp = client.get("/")
    assert resp["X-Frame-Options"] == "DENY"
    assert resp["X-Content-Type-Options"] == "nosniff"
    assert resp["Referrer-Policy"] == "same-origin"
    assert resp["Permissions-Policy"] == "geolocation=(), microphone=(), camera=()"
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/common/tests/test_security_headers.py -q`
Expected: FAIL (`KeyError: 'X-Frame-Options'` / wrong values).

- [ ] **Step 3: Add the Permissions-Policy middleware** (`djclass_overlay/common/middleware.py`):

```python
class SecurityHeadersMiddleware:
    """Set response security headers Django has no built-in setting for.
    (X-Frame-Options/nosniff/Referrer-Policy/HSTS come from Django's own
    middleware; only Permissions-Policy needs setting here.)"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        return response
```

- [ ] **Step 4: Update `config/settings/base.py`.** Add the clickjacking + our headers middleware to `MIDDLEWARE` (append both after `MessageMiddleware`), and add the header settings after the `MIDDLEWARE` block:

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "djclass_overlay.common.middleware.SecurityHeadersMiddleware",
]

# --- Security headers (env-agnostic) ---
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
```

> Keep the rest of `base.py` unchanged. (CSP middleware is added in Task 2.)

- [ ] **Step 5: Update `config/settings/production.py`** — transport hardening + CSRF (append after the existing `CSRF_COOKIE_SECURE = True`):

```python
# TLS terminates at the Cloudflare Tunnel; trust its forwarded scheme so
# request.is_secure() is true (secure cookies, HSTS).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
# (No SECURE_HSTS_PRELOAD — that's a separate, hard-to-undo commitment.)

# CSRF hardening. CSRF_TRUSTED_ORIGINS makes same-origin HTTPS POSTs pass the
# Origin check behind the proxy; defaults to BASE_URL.
CSRF_COOKIE_HTTPONLY = True  # token is delivered via {{ csrf_token }}, never JS-read
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[BASE_URL])

# We deliberately do NOT set SECURE_SSL_REDIRECT: Cloudflare serves HTTPS-only at
# the edge, and an in-app redirect risks loops on the OAuth/SSE paths. Silence the
# deploy-check warning for it.
SILENCED_SYSTEM_CHECKS = ["security.W008"]
```

> `env` and `BASE_URL` are already imported/defined via `from .base import *` + `from .base import env`.

- [ ] **Step 6: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_security_headers.py -q`
Expected: PASS.

- [ ] **Step 7: Verify the full suite + a prod deploy-check.**

```bash
uv run pytest -q
DJANGO_SETTINGS_MODULE=config.settings.production \
  DJANGO_SECRET_KEY=deploy-check-dummy-secret-0123456789abcdef0123456789 \
  VARCHIVE_TOKEN_KEY=deploy-check-key-32-characters-ok!! \
  CHZZK_CLIENT_ID=x CHZZK_CLIENT_SECRET=x \
  DATABASE_URL=sqlite:////tmp/check.db \
  DJANGO_ALLOWED_HOSTS=example.com BASE_URL=https://example.com \
  uv run python manage.py check --deploy --fail-level WARNING
```

Expected: suite green; `check --deploy` reports **no issues** (W008 silenced; CSP warning may remain until Task 2 — if `check --deploy` flags a missing CSP, that's expected and resolved in Task 2, so you may run this final check after Task 2).

- [ ] **Step 8: Commit.**

```bash
git add config/settings/base.py config/settings/production.py \
        djclass_overlay/common/middleware.py djclass_overlay/common/tests/test_security_headers.py
git commit -m "feat(settings): security headers + HSTS + CSRF hardening (prod)"
```

---

### Task 2: Content-Security-Policy — Django 6.0 built-in (TDD)

Enable the built-in CSP middleware + the policy, shipped **report-only** first.

**Files:**
- Modify: `config/settings/base.py`
- Modify: `djclass_overlay/common/tests/test_security_headers.py` (append)

- [ ] **Step 1: Add the failing test** (append to `djclass_overlay/common/tests/test_security_headers.py`):

```python
def test_csp_report_only_header(client):
    resp = client.get("/")
    csp = resp["Content-Security-Policy-Report-Only"]
    assert "default-src 'self'" in csp
    assert "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net" in csp
    assert "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net" in csp
    assert "https://chzzk-djclass-assets.pages.dev" in csp   # cover image
    assert "connect-src 'self'" in csp                       # htmx + SSE
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/common/tests/test_security_headers.py::test_csp_report_only_header -q`
Expected: FAIL (`KeyError: 'Content-Security-Policy-Report-Only'`).

- [ ] **Step 3: Add the CSP middleware + policy to `config/settings/base.py`.** Insert `ContentSecurityPolicyMiddleware` right after `SecurityMiddleware` in `MIDDLEWARE`:

```python
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    # ... rest unchanged ...
```

And add the policy (after the security-header settings from Task 1):

```python
from django.utils.csp import CSP  # noqa: E402  (top-of-file import is fine too)

# Static allowlist: Alpine needs 'unsafe-eval' (script), @tailwindcss/browser
# injects <style> at runtime needing 'unsafe-inline' (style) — so no nonces.
# Shipped report-only; Task 7 flips it to enforcing (SECURE_CSP) after a clean
# browser check. The CDN-free OBS overlay is unaffected (it only uses 'self').
_CSP_POLICY = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF, CSP.UNSAFE_EVAL, "https://cdn.jsdelivr.net"],
    "style-src": [CSP.SELF, CSP.UNSAFE_INLINE, "https://cdn.jsdelivr.net"],
    "img-src": [CSP.SELF, "https://chzzk-djclass-assets.pages.dev", "data:"],
    "font-src": ["https://cdn.jsdelivr.net"],
    "connect-src": [CSP.SELF],
}
SECURE_CSP_REPORT_ONLY = _CSP_POLICY
```

> Put `from django.utils.csp import CSP` with the other imports at the top of `base.py`. `_CSP_POLICY` is named so Task 7 can flip `SECURE_CSP_REPORT_ONLY = _CSP_POLICY` → `SECURE_CSP = _CSP_POLICY` with a one-line change.

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_security_headers.py -q`
Expected: PASS (headers + CSP report-only).

- [ ] **Step 5: Commit.**

```bash
git add config/settings/base.py djclass_overlay/common/tests/test_security_headers.py
git commit -m "feat(settings): Django 6.0 built-in CSP (report-only allowlist)"
```

---

### Task 3: Per-IP rate limiter + apply to link/auth routes (TDD)

**Files:**
- Create: `djclass_overlay/common/ratelimit.py`
- Create: `djclass_overlay/common/tests/test_ratelimit.py`
- Modify: `djclass_overlay/viewers/views.py`, `djclass_overlay/users/views.py`
- Modify: `djclass_overlay/viewers/tests/test_link_actions.py` (append)

- [ ] **Step 1: Write the failing unit tests** (`djclass_overlay/common/tests/test_ratelimit.py`):

```python
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
    assert ok == [True, True, False]          # 3rd in the window is blocked
    clock[0] += 61                            # window elapsed
    assert ratelimit.allow(req, scope="t", limit=2, window=60, now=lambda: clock[0]) is True


def test_allow_is_per_ip_and_per_scope():
    ratelimit.reset()
    a = _Req(headers={"CF-Connecting-IP": "1.1.1.1"})
    b = _Req(headers={"CF-Connecting-IP": "2.2.2.2"})
    assert ratelimit.allow(a, scope="t", limit=1, window=60) is True
    assert ratelimit.allow(a, scope="t", limit=1, window=60) is False   # same ip+scope
    assert ratelimit.allow(b, scope="t", limit=1, window=60) is True    # different ip
    assert ratelimit.allow(a, scope="u", limit=1, window=60) is True    # different scope
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/common/tests/test_ratelimit.py -q`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement** (`djclass_overlay/common/ratelimit.py`):

```python
"""In-memory per-IP fixed-window rate limiter. Single-process (matches
uvicorn --workers 1, like common/cache.py). Behind the Cloudflare Tunnel the
real client IP arrives in CF-Connecting-IP, not REMOTE_ADDR.
"""

import time

_MAX_KEYS = 10000
_buckets = {}  # (scope, ip) -> [window_start, count]


def reset():
    """Clear all buckets (tests)."""
    _buckets.clear()


def client_ip(request):
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        return cf
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def allow(request, *, scope, limit, window, now=time.monotonic):
    """Return True if this (scope, client-ip) is within `limit` requests per
    `window` seconds; False if it has hit the limit. Counts the request when True."""
    t = now()
    if len(_buckets) > _MAX_KEYS:  # opportunistic eviction of expired buckets
        for k, (start, _) in list(_buckets.items()):
            if t - start >= window:
                del _buckets[k]
    key = (scope, client_ip(request))
    bucket = _buckets.get(key)
    if bucket is None or t - bucket[0] >= window:
        _buckets[key] = [t, 1]
        return True
    if bucket[1] >= limit:
        return False
    bucket[1] += 1
    return True
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest djclass_overlay/common/tests/test_ratelimit.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Apply to the link views.** In `djclass_overlay/viewers/views.py`, add the import and a rate-limit guard at the top of three views (return the in-place error fragment — a 429 wouldn't be swapped by htmx). Add to imports:

```python
from djclass_overlay.common import ratelimit
```

Insert as the FIRST line of each view body:

```python
@login_required
@require_POST
def link_connect(request):
    if not ratelimit.allow(request, scope="link", limit=5, window=60):
        return _render_card(request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error")
    token = (request.POST.get("token") or "").strip()
    # ... rest unchanged ...
```

```python
@login_required
@require_POST
def link_sync(request):
    if not ratelimit.allow(request, scope="sync", limit=3, window=60):
        return _render_card(request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error")
    link = VarchiveToken.objects.filter(user=request.user, is_active=True).first()
    # ... rest unchanged ...
```

```python
@login_required
@require_POST
def link_preferred_button(request):
    if not ratelimit.allow(request, scope="pref", limit=10, window=60):
        return _render_card(request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error")
    raw = request.POST.get("button")
    # ... rest unchanged ...
```

> Leave `link_unlink` un-limited (it touches only the user's own rows, makes no outbound call).

- [ ] **Step 6: Apply to the OAuth callback.** In `djclass_overlay/users/views.py`, add imports and guard the callback (a 429 page — this path is a redirect flow, not htmx):

```python
from django.http import HttpResponse

from djclass_overlay.common import ratelimit
```

```python
def chzzk_callback(request):
    if not ratelimit.allow(request, scope="auth", limit=10, window=60):
        return HttpResponse("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", status=429)
    code = request.GET.get("code")
    # ... rest unchanged ...
```

- [ ] **Step 7: Add view-level tests** (append to `djclass_overlay/viewers/tests/test_link_actions.py`):

```python
def test_link_sync_rate_limited(client, monkeypatch):
    from djclass_overlay.common import ratelimit

    u = User.objects.create_user(chzzk_id="rl1", chzzk_nickname="RL")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(ratelimit, "allow", lambda *a, **k: False)
    resp = client.post("/link/sync/")
    assert resp.status_code == 200                       # htmx-swappable fragment
    assert "요청이 너무 많습니다" in resp.content.decode()
```

> `test_link_actions.py` already imports `pytest`, `User`, `VarchiveToken`, `DjClass`, and `BACKEND`. `User.objects.create_user` needs `@pytest.mark.django_db` — add it above the test.

- [ ] **Step 8: Run — expect pass + full suite.**

```bash
uv run pytest djclass_overlay/common/tests/test_ratelimit.py djclass_overlay/viewers/tests/test_link_actions.py -q
uv run pytest -q
```

Expected: all green.

- [ ] **Step 9: Commit.**

```bash
git add djclass_overlay/common/ratelimit.py djclass_overlay/common/tests/test_ratelimit.py \
        djclass_overlay/viewers/views.py djclass_overlay/users/views.py \
        djclass_overlay/viewers/tests/test_link_actions.py
git commit -m "feat(common): per-IP rate limiter (CF-Connecting-IP) on link/sync/auth"
```

---

### Task 4: Production static storage (WhiteNoise compressed-manifest) (TDD)

Serve hashed, far-future-cacheable static in prod via WhiteNoise's manifest storage; dev keeps `WHITENOISE_USE_FINDERS`.

**Files:**
- Modify: `config/settings/production.py`
- Create: `config/tests/__init__.py` (empty, if missing), `config/tests/test_static_storage.py`

- [ ] **Step 1: Write the failing test** (`config/tests/test_static_storage.py`):

```python
import importlib
import os


def test_production_uses_whitenoise_manifest_storage(monkeypatch):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setenv("VARCHIVE_TOKEN_KEY", "k" * 32)
    monkeypatch.setenv("CHZZK_CLIENT_ID", "x")
    monkeypatch.setenv("CHZZK_CLIENT_SECRET", "x")
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/x.db")
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "example.com")
    prod = importlib.import_module("config.settings.production")
    assert (
        prod.STORAGES["staticfiles"]["BACKEND"]
        == "whitenoise.storage.CompressedManifestStaticFilesStorage"
    )
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest config/tests/test_static_storage.py -q`
Expected: FAIL (`AttributeError: ... STORAGES` or wrong backend).

- [ ] **Step 3: Add to `config/settings/production.py`:**

```python
# Hashed + compressed static for cache-busting; served by WhiteNoise.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}
```

- [ ] **Step 4: Run — expect pass.** `uv run pytest config/tests/test_static_storage.py -q`

- [ ] **Step 5: Smoke `collectstatic`.**

```bash
DJANGO_SETTINGS_MODULE=config.settings.production \
  DJANGO_SECRET_KEY=$(python -c "print('x'*50)") \
  VARCHIVE_TOKEN_KEY=$(python -c "print('k'*32)") \
  CHZZK_CLIENT_ID=x CHZZK_CLIENT_SECRET=x \
  DATABASE_URL=sqlite:////tmp/x.db DJANGO_ALLOWED_HOSTS=example.com \
  uv run python manage.py collectstatic --noinput
```

Expected: collects to `staticfiles/` with a `staticfiles.json` manifest, no errors. (Then `rm -rf staticfiles` — it's gitignored / rebuilt in Docker.)

- [ ] **Step 6: Commit.**

```bash
git add config/settings/production.py config/tests/
git commit -m "feat(settings): WhiteNoise compressed-manifest static storage (prod)"
```

---

### Task 5: Python Dockerfile (replaces the Node image)

**Files:** Replace `Dockerfile` (currently Node 24).

- [ ] **Step 1: Replace `Dockerfile` with the uv/Python 3.13 multi-stage build:**

```dockerfile
# Build stage — install deps + project into /app/.venv via uv
FROM python:3.13-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

# Runtime stage
FROM python:3.13-slim-bookworm AS runner
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings.production \
    PYTHONUNBUFFERED=1
COPY --from=builder /app /app

# Bake collected static into the image (build-time dummies — collectstatic needs
# settings to import but touches no DB or real secret).
RUN DJANGO_SECRET_KEY=build-only-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    VARCHIVE_TOKEN_KEY=build-only-key-32-characters-okay \
    CHZZK_CLIENT_ID=build CHZZK_CLIENT_SECRET=build \
    DATABASE_URL=sqlite:////tmp/build.db DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/').status==200 else 1)"

# Default command; Dokku overrides it with the Procfile `web` process.
CMD ["python", "manage.py", "runasgi", "--host", "0.0.0.0", "--port", "8000"]
```

> Pin the uv image to a specific tag (e.g. `ghcr.io/astral-sh/uv:0.9.x`) for reproducibility when implementing — confirm the current release. `runasgi` (not bare uvicorn) gives the graceful SIGTERM shutdown on Dokku stop/deploy.

- [ ] **Step 2: Update `.dockerignore`** so the build context excludes Node + local cruft. Replace `.dockerignore` with:

```
.git
node_modules
.next
.venv
staticfiles
data
test-data
*.sqlite3
.env
.env.*
__pycache__
.pytest_cache
```

- [ ] **Step 3: Local build smoke** (owner/CI — needs Docker):

```bash
docker build -t djclass-overlay:test .
```

Expected: builds clean; `collectstatic` runs in-build; image CMD is `runasgi`.

- [ ] **Step 4: Commit.**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(docker): Python 3.13 + uv image (collectstatic + runasgi)"
```

---

### Task 6: Procfile + `.env.example` (Django deploy config)

**Files:** Replace `Procfile` (Node) and `.env.example` (Node).

- [ ] **Step 1: Replace `Procfile`:**

```
web: python manage.py runasgi --host 0.0.0.0 --port 8000
release: python manage.py migrate --noinput
```

> `web` is the ASGI server (graceful shutdown). `release` runs migrations before Dokku swaps in the new release. **No `worker`** — the daily `sync_djclass` is a Dokku/host cron (Plan 9), not a long-running process.

- [ ] **Step 2: Replace `.env.example`** with the Django template:

```
# Django
DJANGO_SETTINGS_MODULE=config.settings.production
DJANGO_SECRET_KEY=generate_a_50+_char_random_secret
DJANGO_ALLOWED_HOSTS=your-domain.com
# Optional; defaults to BASE_URL. Comma-separated, scheme required.
# DJANGO_CSRF_TRUSTED_ORIGINS=https://your-domain.com
BASE_URL=https://your-domain.com

# Database (Dokku Postgres link provides this)
DATABASE_URL=postgres://user:password@host:5432/dbname

# Secrets
VARCHIVE_TOKEN_KEY=your_32_char_encryption_key
CHZZK_CLIENT_ID=your_chzzk_client_id
CHZZK_CLIENT_SECRET=your_chzzk_client_secret
```

- [ ] **Step 3: Verify** the Procfile parses and the web command is valid (no app start needed):

```bash
uv run python manage.py runasgi --help
```

Expected: shows `--host`/`--port` (confirms the `web` command is correct).

- [ ] **Step 4: Commit.**

```bash
git add Procfile .env.example
git commit -m "feat(deploy): Django Procfile (runasgi web + migrate release) + .env.example"
```

---

### Task 7: CI → Django (uv + pytest + deploy-check)

Move the CI **build** job to uv/pytest with a Postgres service and the `check --deploy` security gate. The **deploy** job is unchanged (it only fires on push to `main`, so it stays dormant until the Plan 9 cutover PR merges — at which point `git:sync --build` builds this Python Dockerfile).

**Files:** Modify `.github/workflows/ci.yml`.

- [ ] **Step 1: Replace the `build` job** in `.github/workflows/ci.yml` (keep the `deploy` job exactly as-is):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_DB: djclass_overlay
          POSTGRES_USER: djclass
          POSTGRES_PASSWORD: devpassword
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U djclass -d djclass_overlay"
          --health-interval 2s --health-timeout 3s --health-retries 15
    env:
      DJANGO_SECRET_KEY: ci-secret-0123456789abcdef0123456789abcdef0123456789
      VARCHIVE_TOKEN_KEY: ci-dummy-key-32-characters-long!!
      CHZZK_CLIENT_ID: ci-dummy
      CHZZK_CLIENT_SECRET: ci-dummy
      DATABASE_URL: postgres://djclass:devpassword@localhost:5432/djclass_overlay
      BASE_URL: http://localhost:8000
    steps:
      - uses: actions/checkout@v4
      - name: Install uv
        uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen
      - run: uv run python manage.py check
      - run: uv run python manage.py makemigrations --check --dry-run
      - run: uv run pytest -q
      - run: uv run python manage.py collectstatic --noinput
      - name: Deploy-security check (production settings)
        env:
          DJANGO_SETTINGS_MODULE: config.settings.production
          DJANGO_ALLOWED_HOSTS: example.com
          BASE_URL: https://example.com
        run: uv run python manage.py check --deploy --fail-level WARNING

  # --- deploy job unchanged (only runs on push to main) ---
```

> Paste the existing `deploy:` job (from the current `ci.yml`) verbatim after the `build` job — it is **not** modified by this task. The `check --deploy` step re-uses the job's `DJANGO_SECRET_KEY`/`VARCHIVE_TOKEN_KEY`/`CHZZK_*`/`DATABASE_URL` and overrides settings module + hosts; `--fail-level WARNING` makes any unsilenced deploy warning fail CI.

- [ ] **Step 2: Verify locally** the same commands pass (Postgres from `docker compose up -d`):

```bash
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest -q
```

Expected: all green (the `check --deploy` step is exercised by Task 1 Step 7 / CI).

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build + test the Django app (uv/pytest) + deploy-security gate"
```

---

### Task 8: Verification + flip CSP to enforcing (owner-driven)

The suite + `check --deploy` cover the config; this confirms the image runs and the CSP allows everything, then enforces it.

- [ ] **Step 1: Full suite + deploy check + build.**

```bash
uv run pytest -q
# deploy check (see Task 1 Step 7 for the env) — expect "no issues"
docker build -t djclass-overlay:test .          # expect a clean build
```

- [ ] **Step 2: Run the image locally** (owner; needs the dev Postgres reachable from the container, or point `DATABASE_URL` at it):

```bash
docker run --rm -p 8000:8000 \
  -e DJANGO_SECRET_KEY=$(python -c "print('x'*50)") \
  -e VARCHIVE_TOKEN_KEY=$(python -c "print('k'*32)") \
  -e CHZZK_CLIENT_ID=x -e CHZZK_CLIENT_SECRET=x \
  -e DATABASE_URL="postgres://djclass:devpassword@host.docker.internal:5432/djclass_overlay" \
  -e DJANGO_ALLOWED_HOSTS=localhost -e BASE_URL=http://localhost:8000 \
  djclass-overlay:test
```

Walk `/` and `/login/` in a browser; **open the devtools console** and confirm the page works with **no CSP *Report-Only* violations** for the daisyUI/Tailwind/htmx/Alpine/Pretendard CDNs, the cover image, or the inline styles. (Report-only means nothing is blocked yet — you're checking the allowlist is complete.)

- [ ] **Step 3: Flip CSP to enforcing.** Once Step 2 shows no violations, in `config/settings/base.py` change the one line:

```python
SECURE_CSP = _CSP_POLICY          # was: SECURE_CSP_REPORT_ONLY = _CSP_POLICY
```

Update the Task 2 test to assert the enforcing header — in `djclass_overlay/common/tests/test_security_headers.py`, rename `test_csp_report_only_header` → `test_csp_header` and change `resp["Content-Security-Policy-Report-Only"]` → `resp["Content-Security-Policy"]` (keep the directive assertions). Run:

```bash
uv run pytest djclass_overlay/common/tests/test_security_headers.py -q
uv run pytest -q
```

Expected: green (now the enforcing `Content-Security-Policy` header).

- [ ] **Step 4: Commit.**

```bash
git add config/settings/base.py djclass_overlay/common/tests/test_security_headers.py
git commit -m "feat(settings): enforce CSP (flip from report-only after clean check)"
```

> **Staging deploy** (deploying this image to a second Dokku app on a staging hostname, alongside Node) is the start of **Plan 9** — it needs a Postgres link + config, which is cutover territory.

---

## Deferred → Plan 9 (cutover runbook)

`dokku postgres:create` + link · `dokku config:set` (the `.env.example` keys) · `dokku ports:set http:80:8000` + EXPOSE wiring · export legacy SQLite → `manage.py import_legacy` · the daily `sync_djclass` cron (18:00 UTC) · deploy alongside Node on a staging hostname, verify parity · **flip the Cloudflare Tunnel** ingress from the Node container to the Django one · rollback (point the tunnel back at Node, Node app kept intact) · optional Cloudflare edge rate-limit rules.

---

## Self-Review

- **Decisions honored:** built-in Django 6.0 CSP (no dep) ✓; report-only → enforce ✓; custom CF-Connecting-IP rate limiter ✓; CSRF hardening (`CSRF_TRUSTED_ORIGINS`/`HTTPONLY`) + headers + HSTS ✓; `check --deploy --fail-level WARNING` gate with the documented W008 silence ✓; `runasgi` web process ✓; cutover deferred to Plan 9 ✓.
- **Spec coverage (master design §6/§7 + carry-overs):** security headers/CSP §6 (Tasks 1–2); rate-limiting §6 (Task 3); Dockerfile/Procfile/Postgres-ready/uvicorn §7 (Tasks 5–6); collectstatic + Procfile (Plan 6 deferral, Tasks 4,6); CSP carry-over (owner-requested, Tasks 2,8); import-script token-less update already done in Plan 7.
- **Type/name consistency:** `_CSP_POLICY` defined in Task 2, flipped in Task 8; `ratelimit.allow(request, *, scope, limit, window, now=…)` + `ratelimit.client_ip` + `ratelimit.reset` consistent across Task 3 unit tests, the view call sites, and the view test; `SecurityHeadersMiddleware` dotted path matches the `MIDDLEWARE` entry; `STORAGES["staticfiles"]` backend string matches the test; Procfile/Dockerfile both use port 8000 + `runasgi --host 0.0.0.0`.
- **Placeholders:** none — every code/config step is complete. The one "confirm/pin the uv image tag" note is a reproducibility nicety (`:latest` works as written).
- **Verified mechanisms:** Django 6.0 `CSP.UNSAFE_EVAL`/`UNSAFE_INLINE` + `ContentSecurityPolicyMiddleware` + `SECURE_CSP`/`SECURE_CSP_REPORT_ONLY` (docs); WhiteNoise `CompressedManifestStaticFilesStorage`; `runasgi --host/--port` (existing); the Node→Django Dockerfile/Procfile/CI swap mirrors the existing files.
- **Test impact:** new tests for headers, CSP, the rate limiter (unit + view), and the prod static storage; existing suite stays green (settings additions don't change rendered content). Docker/Procfile/CI are config — verified by the build smoke + CI run + the owner image-run in Task 8.
- **Deliverable:** a hardened, containerized, CI-tested Django app that runs under `runasgi` with enforced CSP, security headers, and per-IP rate-limiting — deployable alongside Node, leaving only the live cutover (Plan 9).
