# AGENTS.md — Chzzk DJ CLASS Chat Widget

> Rules and context that AI coding agents MUST follow when working on this project.

---

## 1. Project Overview

An OBS Browser Source widget service that displays V-ARCHIVE DJ CLASS badges on Chzzk (Korean streaming platform) chat messages.

- **Target Users:** Korean Chzzk streamers and viewers who play DJMAX RESPECT V
- **UI Language:** Korean ONLY. All user-facing text must be written in Korean.
- **Repository:** `chzzk-djclass-overlay`
- **History:** originally a Next.js/Node app; rewritten to Python/Django in 2026-06. The legacy code has been removed — do NOT reintroduce a Node/Next.js app.

---

## 2. Technology Stack

| Technology               | Version         | Purpose                                                     |
| ------------------------ | --------------- | ----------------------------------------------------------- |
| Python                   | 3.14            | Runtime (`.python-version`, `requires-python`, Docker base) |
| Django                   | 6.0             | Web framework: HTTP, ORM, auth, sessions, built-in CSP      |
| uv                       | —               | Dependency + venv management (`uv.lock`)                    |
| PostgreSQL               | —               | Database (`psycopg`); dev via `docker compose`              |
| uvicorn                  | —               | ASGI server, launched by `manage.py runasgi`                |
| python-socketio          | **~4.6** (EIO3) | Chzzk chat ingestor (async client) — **NOT 5.x**            |
| httpx                    | —               | Chzzk / V-ARCHIVE REST (sync, 8s timeout)                   |
| WhiteNoise               | —               | Static file serving                                         |
| daisyUI + Tailwind (CDN) | 5 / 4           | Config-page styling (no build step)                         |
| htmx + Alpine.js         | —               | Config-page interactivity (`hx-boost` app shell)            |
| pytest                   | —               | Tests (`pytest-django`, `pytest-httpx`)                     |
| ruff / djlint / mypy     | —               | Lint, format, template lint, strict typing                  |

---

## 3. UI and Component Rules

### 3.1 Styling & interactivity

- **Config pages** (landing, login, dashboard, `/link`) use **daisyUI + raw Tailwind utilities via the official CDN** (`@tailwindcss/browser@4` + `daisyui@5`) — **no build step, no Node bundle**. Interactivity is **htmx** (`hx-boost` app shell, `{% partialdef %}` fragment swaps) + **Alpine.js** (components registered globally in `static/js/components.js` via the `alpine:init` event).
- The **OBS overlay widget** (`/widget/<channelId>`) is intentionally **CDN-free**: hand-written `overlay/static/overlay/widget.js` + `static/css/badge.css`, served by WhiteNoise.
- Do NOT reintroduce a JS build toolchain (Next.js, bundlers) or shadcn/React.

### 3.2 Korean UI Language

- All user-facing text MUST be written in **Korean** (errors, labels, tooltips, alerts).
- Code comments may be in Korean or English.

---

## 4. Directory Structure and Conventions

```
config/                   # Django project
  settings/{base,local,production}.py
  urls.py, asgi.py, wsgi.py
djclass_overlay/
  common/                 # crypto (AES-GCM), Chzzk OAuth client, cache, middleware,
                          #   ratelimit, import_legacy command
  users/                  # custom User (keyed on chzzk_id), Chzzk OAuth backend, session views
  streamers/              # Channel model, dashboard
  viewers/                # V-ARCHIVE linking (/link) + link actions
  djclass/                # pure badge logic (badges.py), resolver, sync, varchive client
  overlay/                # realtime: ingestor (socket.io), flush loop, SSE, registry,
                          #   scheduler, runasgi command, static/overlay/widget.js
  templates/              # Django templates
  static/                 # css/badge.css, js/components.js
manage.py
```

### 4.1 Adding / Moving Rules

- **New pages:** a function-based view + URLconf entry in the relevant app, with a template under `djclass_overlay/templates/<app>/`.
- **New shared utilities / external clients:** `djclass_overlay/common/`.
- **Pure DJ CLASS logic** stays Django-free in `djclass_overlay/djclass/badges.py`.
- **htmx partials** use Django 6.0 `{% partialdef name inline %}`, fetched standalone as `app/template.html#name`.

---

## 5. Architecture and Key Constraints

### 5.1 Single ASGI process

- One uvicorn process (`manage.py runasgi`, `--workers 1`) holds Django HTTP + the SSE endpoint + the Chzzk Socket.IO ingestor + a ~250 ms batch/flush loop + an in-memory registry. **No Channels, no Redis.** Use `runasgi` (NOT `runserver`) so the persistent event loop / ingestor survives.
- Detached `asyncio.create_task` work (ingestor, flush, scheduler) must use `sync_to_async(..., thread_sensitive=False)` + `close_old_connections()` — it must not ride the SSE request's `CurrentThreadExecutor` (which dies when the view returns).

### 5.2 Chat ingest + widget

- Widgets **cannot connect directly to Chzzk** — the server ingests via **python-socketio 4.6.1 (EIO3)**. **5.x is NOT compatible** (the 4.x↔5.x API diverged; `python-socketio-stubs` tracks 5.x only — do not add it).
- The server computes DJ CLASS badges; the widget makes **zero network calls** beyond the SSE stream (`/widget/<channelId>/stream`). It renders `[{button}B {DJ CLASS}] message` — the Chzzk nickname is NOT shown; unverified viewers get a `미인증` badge.
- A per-channel connect lock prevents duplicate connections; the ingestor tears down 30 s after the last subscriber leaves.

### 5.3 Tokens & sessions

- **Chzzk channel tokens:** `AES-256-GCM` via `common/crypto.py` (key = `VARCHIVE_TOKEN_KEY`, random per-record salt), stored on the `Channel` model.
- **V-ARCHIVE is token-less:** the 조회토큰 is used **once** (`djclass/varchive.py` → open-token endpoint → `{userNo, nickname}`) then **discarded, never stored**. Ongoing sync hits the **public** nickname endpoint; `VarchiveToken` keeps `varchive_user_no` + nickname only.
- **Sessions:** Django's DB-backed session framework (signed by `SECRET_KEY`), 7-day cookie. There is no `SESSION_SECRET`.

### 5.4 Caching

- `common/cache.py` — in-memory per-entry-TTL cache for DJ CLASS lookups: linked w/ data → 5 min, linked w/o data → 15 s, unlinked → 10 s. Active chatters do NOT extend their TTL. A user's entries are invalidated on sync via `transaction.on_commit`.

### 5.5 Rate limiting

- `common/ratelimit.py` — in-memory per-IP limiter keyed on `CF-Connecting-IP` (link 5 / sync 3 / pref 10 / auth 10 per 60 s); violations return **HTTP 429**.

### 5.6 Security headers

- Set by Django's `SecurityMiddleware` (HSTS, nosniff, Referrer-Policy), `XFrameOptionsMiddleware` (DENY), a small `common/middleware.py` (Permissions-Policy), and **Django 6.0's built-in CSP** (`SECURE_CSP` + `ContentSecurityPolicyMiddleware`). The CSP `img-src` MUST allowlist Naver's emoji CDN (`*.pstatic.net` / `*.naver.net`) and the cover-image host — dropping them blocks chat emoji.

### 5.7 Outbound timeouts

- All Chzzk / V-ARCHIVE httpx calls use an **8-second timeout**.

### 5.8 Daily sync

- An in-process asyncio scheduler (`overlay/scheduler.py`) runs `sync_all_active_links()` at **18:00 UTC** in a pool thread. There is **no worker container / external cron**.

### 5.9 Logging

- Use the `djclass_overlay` logger (see `LOGGING` in settings). **Never log tokens, session keys, or other secrets.**

---

## 6. Views & URLs

- Function-based Django views + per-app `urls.py`, wired through `config/urls.py`.
- htmx endpoints return `{% partialdef %}` fragments for `hx-target` swaps. A nested `hx-post` form inside the `hx-boost` shell MUST set `hx-boost="false"` + its own `hx-select` (e.g. `#link-card`) so it does a local swap instead of inheriting the body's `hx-select="#content"`.

---

## 7. Testing

- **Framework:** pytest (`pytest-django`, `pytest-httpx`); settings module `config.settings.local`.
- **Location:** `djclass_overlay/<app>/tests/test_*.py`. All external I/O (Chzzk, V-ARCHIVE) is mocked.
- **Run:** `uv run pytest`.

---

## 8. Linter, Formatter, Types

- **ruff** — lint + format (config in `pyproject.toml`; ruff syntax target pinned to `py313`).
- **djlint** — Django template lint/format (`profile = django`).
- **mypy** — `strict` + `django-stubs`.
- **eslint + prettier** — for the two first-party browser scripts only (`widget.js`, `components.js`); enforced by **local Git hooks, NOT CI**.

### 8.1 Mandatory commands

**After Python changes:**

```bash
uv run ruff format
uv run ruff check --fix
uv run mypy djclass_overlay config
```

**After JS changes:**

```bash
npm run lint:fix && npm run format
```

---

## 9. Environment Variables

`.env.django` (see `.env.example`):

| Variable                                  | Description                                           |
| ----------------------------------------- | ----------------------------------------------------- |
| `DJANGO_SECRET_KEY`                       | Django secret key (50+ chars)                         |
| `VARCHIVE_TOKEN_KEY`                      | AES-256-GCM key for Chzzk channel tokens (32 chars)   |
| `CHZZK_CLIENT_ID` / `CHZZK_CLIENT_SECRET` | Chzzk OAuth credentials                               |
| `BASE_URL`                                | Public origin (OAuth redirect_uri, widget URLs, CSRF) |
| `DATABASE_URL`                            | PostgreSQL DSN (Dokku link provides it)               |
| `DJANGO_ALLOWED_HOSTS`                    | Comma-separated allowed hosts                         |
| `DJANGO_CSRF_TRUSTED_ORIGINS`             | Optional; defaults to `BASE_URL`                      |
| `DJANGO_SETTINGS_MODULE`                  | `config.settings.local` (dev) / `.production`         |

---

## 10. Deployment

- **Platform:** Dokku. Full steps in [`DEPLOY.md`](./DEPLOY.md).
- **Single `web` process** (`Procfile`); **no worker** — the daily sync is in-process.
- **Database:** Dokku-managed PostgreSQL, linked via `DATABASE_URL`.
- **Docker:** multi-stage `Dockerfile` (Python 3.14 slim + uv); `collectstatic` baked into the image; HEALTHCHECK on `:8000`; no build args.
- **Auto-deploy:** push to `main` → CI `build` passes → the `deploy` job runs `dokku git:sync --build chatoverlay-django … main` over an SSH-via-Cloudflare-Tunnel path; the Procfile `release` phase runs `migrate`.

---

## 11. AGENTS.md Self-Update Rule (MANDATORY)

> **If you change anything documented in this file, you MUST update AGENTS.md accordingly.**

Update AGENTS.md when any of the following change:

- **Technology stack** additions / changes / version bumps
- **UI / component rules** (styling system, language policy, etc.)
- **Directory structure** (new apps, file moves, etc.)
- **Architecture constraints** (ingestor, caching policy, encryption, sessions, etc.)
- **View / URL patterns**
- **Testing** conventions or frameworks
- **Linter / formatter / type** settings
- **Environment variables** added / changed / removed
- **Deployment method**

**Failure to update this file risks the next AI agent working with stale or incorrect context.**

---

_This document is the project's live context guide. Update it immediately when things change._
