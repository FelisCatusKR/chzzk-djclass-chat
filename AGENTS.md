# AGENTS.md — Chzzk DJ CLASS Chat Widget

> Rules and context that AI coding agents MUST follow when working on this project.

---

## 1. Project Overview

An OBS Browser Source widget service that displays V-ARCHIVE DJ CLASS badges on Chzzk (Korean streaming platform) chat messages.

- **Target Users:** Korean Chzzk streamers and viewers who play DJMAX RESPECT V
- **UI Language:** Korean ONLY. All user-facing text must be written in Korean.
- **Repository:** `chzzk-djclass-overlay`
- **History:** originally a Next.js/Node app; rewritten to Python/Django in 2026-06. The legacy code has been removed — do NOT reintroduce a Node/Next.js app.
- **Production runs the Go server (since 2026-10-08).** `go/` (Go + SQLite) replaced Django via [`go/CUTOVER.md`](./go/CUTOVER.md) / the homelab-infra runbook. The Django code below is **no longer deployed** and is kept only until the post-cutover cleanup (Postgres stays a few days for rollback). Make all changes in Go; do not fix or extend Django.

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
| mise                     | —               | Tool versions (`mise.toml`: Go, Node, sqlc) — local + CI    |
| Go                       | 1.27            | `go/` migration (`coder/websocket`)                         |
| SQLite (Go)              | —               | `modernc.org/sqlite` (pure Go), goose migrations, sqlc      |
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
go/                       # Go server (own go.mod; built into the `go-runner` image target)
  internal/chzzk/         # Chzzk OAuth + session API client (port of common/chzzk.py)
  internal/chzzk/eio3/    # minimal Socket.IO v2 / Engine.IO v3 websocket client
  internal/djclass/       # pure DJ CLASS badge logic (port of djclass/badges.py) + Python golden data
  internal/ttlcache/      # per-entry-TTL cache (port of common/cache.py)
  internal/resolver/      # chat sender → badge status, cached (port of djclass/resolver.py)
  internal/realtime/      # per-channel chat worker (ingest + 250 ms flush), hub, SSE subscriptions
  internal/varchive/      # V-ARCHIVE client (token used once; ≤8 requests in flight process-wide)
  internal/link/          # viewer linking: connect/sync/unlink/preferred button, daily SyncAll
  internal/schedule/      # in-process daily job at a UTC hour (18:00 DJ CLASS sync)
  internal/ratelimit/     # per-IP fixed-window limiter (CF-Connecting-IP)
  internal/crypto/        # AES-GCM token encryption, byte-compatible with common/crypto.py
  internal/store/         # SQLite: migrations/ (goose, embedded), queries.sql → db/ (sqlc)
  cmd/server/             # the Go server (HTTP + SSE + chat workers); `cd go && go run ./cmd/server`
  internal/config/        # env/.env configuration
  internal/web/           # pages, widget + SSE, OAuth login, /link, /healthz, /dev (DEV only); static/ is filled at image build
  internal/importer/      # one-shot cutover import: Django dumpdata JSON → SQLite (verifies every token decrypts)
  CUTOVER.md              # cutover runbook: verification, steps, rollback, post-cutover cleanup
  cmd/spike/              # throwaway live test: OAuth login → session socket → print chat
mise.toml                 # pinned tool versions (replaces .nvmrc)
```

### 4.1 Adding / Moving Rules

- **New pages:** a function-based view + URLconf entry in the relevant app, with a template under `djclass_overlay/templates/<app>/`.
- **New shared utilities / external clients:** `djclass_overlay/common/`.
- **Pure DJ CLASS logic** stays Django-free in `djclass_overlay/djclass/badges.py`. Its Go port `go/internal/djclass` is checked against `testdata/python_golden.json` (generated from `badges.py` by `testdata/gen_golden.py`); until cutover, change both and regenerate the golden file.
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
- **Chzzk session socket facts** (verified live 2026-10, details in `go/internal/chzzk/eio3` package doc): the server is EIO3-only; a session URL is **single-use** (fetch a fresh one per (re)connect); the server closes sessions on its own after many hours (reconnect is normal operation); an open session outlives its access token, so refresh the token **before reconnecting**.

### 5.2.0 Go realtime (`internal/realtime`)

- One **Hub**; per Chzzk channel one **ingest** goroutine (token → fresh session URL → dial → subscribe → CHAT into buffer) and one **flush** goroutine (every 250 ms: resolve each sender once, encode one `chat` batch, non-blocking send to each subscriber). Same SSE batch JSON as `overlay/flush.py`.
- **Every** failure (token, URL, dial, subscribe ×3, server close) restarts the whole session after a backoff (1 s doubling to 60 s, reset after a healthy minute) — never "retry once". Tokens refresh 5 min before expiry, before connecting.
- Widget streams are unauthenticated, so they are capped (10 per channel, 1000 total → 503), each subscriber buffers ≤64 batches, and every SSE write has a 10 s deadline (slow readers are dropped).
- **Badges resolve by `senderChannelId` only** — no nickname fallback (Django had one; nicknames are user-changeable, so it allowed impersonation). Emoji URLs are kept only for `https://*.pstatic.net` / `*.naver.net`.
- Per-channel bookkeeping (subscribers, teardown timer) is guarded by `Hub.mu`; the chat buffer by its own mutex. `Hub.Close` stops workers **before** closing subscriber channels.

### 5.2.0.1 Go web (`internal/web`)

- **No `hx-boost`** in the Go layout: page navigations are full loads so Alpine initialises each page once (boost + Alpine's observer + `components.js`'s `initTree` double-initialised the dashboard preview). htmx is only for in-page fragment swaps (the `/link` card). `components.js` is still shared with Django — don't change it until cutover.
- **CSRF:** `http.CrossOriginProtection` (Sec-Fetch-Site / Origin) + `SameSite=Lax` session cookie — no tokens in templates.
- **Sessions:** `alexedwards/scs` on the SQLite `sessions` table (7 days; token renewed at login). The OAuth `state`/`next` live in short-lived cookies scoped to `/api/auth/chzzk/`, so the login link writes nothing to the DB.
- **Headers:** CSP (same policy as Django + `frame-ancestors`/`base-uri`/`form-action`), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: same-origin`, COOP, Permissions-Policy, HSTS when `BASE_URL` is https.
- **CDN assets** (daisyUI, Tailwind browser, htmx, Alpine) are version-pinned with SRI `integrity` in `templates/base.html`; bumping a version means recomputing its sha384.
- `requireLogin`: htmx **fragment** requests get `HX-Redirect` to `/login/?next=<current page>`; normal and boosted requests redirect to the requested path.
- Access log never records query strings (OAuth `code`); Chzzk client/eio3 errors never quote URLs (`auth=`, `sessionKey=`).
- Rate-limited `/link` actions answer **429** with the card body (base.html configures htmx to swap 429). Rate limiting trusts `CF-Connecting-IP` because the container is reachable only via cloudflared (no published port; see homelab-infra) — revisit if that changes.
- `/widget/*` has its own CSP (no `unsafe-eval`); session pages send `Cache-Control: no-store`. `DEV` is accepted only with a loopback `BASE_URL`.
- `/link` actions (`internal/link`): V-ARCHIVE calls happen **outside** write transactions; the badge cache is invalidated **after** commit. An empty V-ARCHIVE fetch never wipes existing classes. Fragment handlers re-read the user before rendering (the request-scoped user predates the change).

### 5.2.1 Go store (SQLite)

- One DB file, two pools: a **read pool** (`query_only`) and a **single write connection** (`_txlock=immediate`, WAL, `synchronous=NORMAL`, `foreign_keys=ON`). Writers queue in `database/sql`, not on SQLite's lock.
- All writes go through `store.WriteTx(ctx, fn)`. Inside `fn`: use only the given `ctx`/`q`, keep it short, **no network I/O** (every writer waits), and never call `WriteTx`/`WriteDB()` again (the one connection is held → deadlock; nested `WriteTx` returns `ErrNestedWrite`).
- Schema changes = a new goose file in `internal/store/migrations/` (never edit an applied one) + `sqlc generate`. Timestamps are unix seconds (INTEGER). Sessions use the `alexedwards/scs` sqlite3store table.

### 5.3 Tokens & sessions

- **Chzzk channel tokens:** `AES-256-GCM` via `common/crypto.py` (key = SHA-256 of `VARCHIVE_TOKEN_KEY`, random 12-byte nonce per value, stored as base64(nonce‖ciphertext‖tag)) on the `Channel` model. `go/internal/crypto` is byte-compatible (tested against Python-generated vectors) — keep the two in sync until cutover.
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
- **Go:** `cd go && go test ./...`. CI runs `go test -race`; the race detector does not work on the 39-bit-VMA Raspberry Pi kernel, so run `-race` only on amd64/CI.

---

## 8. Linter, Formatter, Types

- **ruff** — lint + format (config in `pyproject.toml`; ruff syntax target pinned to `py313`).
- **djlint** — Django template lint/format (`profile = django`).
- **mypy** — `strict` + `django-stubs`.
- **eslint + prettier** — for the two first-party browser scripts only (`widget.js`, `components.js`); enforced by **local Git hooks, NOT CI**.
- **gofmt + go vet + sqlc diff** — Go code under `go/`; gofmt runs in lint-staged, CI's `go` job checks gofmt/vet/tests and that sqlc output is up to date. Keep the Go version in `mise.toml` and `go/go.mod` identical (CI checks).

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

**After Go changes:**

```bash
cd go && sqlc generate && gofmt -w . && go vet ./... && go test ./...
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
| `DATABASE_URL`                            | PostgreSQL DSN                                        |
| `DJANGO_ALLOWED_HOSTS`                    | Comma-separated allowed hosts                         |
| `DJANGO_CSRF_TRUSTED_ORIGINS`             | Optional; defaults to `BASE_URL`                      |
| `DJANGO_SETTINGS_MODULE`                  | `config.settings.local` (dev) / `.production`         |

Go server (`go/.env` or real env; shares `CHZZK_*`, `VARCHIVE_TOKEN_KEY`, `BASE_URL` with the table above):

| Variable      | Description                                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| `SQLITE_PATH` | SQLite file (default `djclass.sqlite3`)                                                |
| `ADDR`        | Listen address (default `:8000`)                                                       |
| `DJANGO_DIR`  | Repo root to serve widget assets from until cutover (default `..`)                     |
| `DEV`         | `1` = seed demo viewers + enable `/dev` chat injection; refused if `BASE_URL` is https |

---

## 10. Deployment

- **Platform:** a self-hosted rootless Podman host, managed from a separate (private) infra repo. Container contract in [`DEPLOY.md`](./DEPLOY.md).
- **Single `web` container, single instance**; **no worker** — the daily sync is in-process.
- **Database:** SQLite in the `chatoverlay-data` volume (`/data`, Go). The old PostgreSQL is kept only as a rollback target until cleanup.
- **Docker:** multi-stage `Dockerfile` (Python 3.14 slim + uv); build target `runner`; `collectstatic` baked into the image; HEALTHCHECK on `:8000`; no build args.
- **Go image (production):** the same `Dockerfile` also has `go-builder` → `go-runner` (static binary on distroless Debian 13 / trixie, ~18 MB, SQLite in a `/data` volume, `/djclass healthcheck`). The Django `runner` target is no longer deployed. `.dockerignore` excludes `**/.env*` and `**/*.sqlite3*` (go/.env and the dev DB hold real secrets). CI's `go-image` job builds it; keep the `golang:` tag equal to `mise.toml`'s Go (CI checks).
- **Auto-deploy:** CI publishes the `go-runner` image to **GHCR** (`ghcr.io/feliscatuskr/chzzk-djclass-chat`, tags `main` + `sha-<7>`, amd64 + arm64 on native runners) for every main commit that passed `build`/`go`/`go-image` — docs-only commits (`*.md`, `docs/`) are not published. The host's reconcile pulls `:main` and restarts `chatoverlay-web` when the image's `org.opencontainers.image.revision` changes (Quadlet, `HealthCmd=["/djclass","healthcheck"]` — JSON form, distroless has no shell). Rollback = `pin: sha-<7>` in homelab-infra. Branch protection requires `build`, `go`, `go-image`.

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
