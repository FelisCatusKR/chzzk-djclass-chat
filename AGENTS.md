# AGENTS.md — Chzzk DJ CLASS Chat Widget

> Rules and context that AI coding agents MUST follow when working on this project.

---

## 1. Project Overview

An OBS Browser Source widget service that displays V-ARCHIVE DJ CLASS badges on Chzzk (Korean streaming platform) chat messages.

- **Target Users:** Korean Chzzk streamers and viewers who play DJMAX RESPECT V
- **UI Language:** Korean ONLY. All user-facing text must be written in Korean.
- **History:** Next.js/Node → Python/Django (2026-06) → **Go + SQLite (2026-10, production since 2026-10-08)**. The earlier implementations are gone; do NOT reintroduce them. The cutover record is [`docs/go-cutover-2026-10.md`](./docs/go-cutover-2026-10.md).

---

## 2. Technology Stack

| Technology               | Version | Purpose                                                             |
| ------------------------ | ------- | ------------------------------------------------------------------- |
| Go                       | 1.27    | The whole server: HTTP, SSE, Chzzk chat, daily sync — one binary    |
| SQLite                   | —       | `modernc.org/sqlite` (pure Go, no cgo); goose migrations (embedded) |
| sqlc                     | 1.31    | Typed queries generated from `internal/store/queries.sql`           |
| coder/websocket          | —       | Transport for the hand-written Engine.IO v3 client                  |
| alexedwards/scs          | v2      | Sessions, stored in SQLite                                          |
| daisyUI + Tailwind (CDN) | 5 / 4   | Config-page styling (no build step; SRI-pinned)                     |
| htmx + Alpine.js         | 2 / 3   | `/link` fragment swaps; dashboard widget-config + preview           |
| mise                     | —       | Tool versions (`mise.toml`: Go, sqlc, Node) — local + CI            |
| Node                     | 24      | Only for eslint/prettier and the widget smoke test                  |

---

## 3. UI and Component Rules

### 3.1 Styling & interactivity

- **Config pages** (landing, login, dashboard, `/link`) are Go `html/template` pages using **daisyUI + raw Tailwind utilities via the CDN** (`@tailwindcss/browser@4` + `daisyui@5`, version-pinned with SRI in `internal/web/templates/base.html`) — **no build step, no bundler**. Interactivity: **htmx** for the `/link` card fragments only (**no `hx-boost`** — page navigations are full loads so Alpine initialises each page once) + **Alpine.js** components registered in `internal/web/static/js/components.js` (`alpine:init`).
- The **OBS overlay widget** (`/widget/<channelId>/`) is CDN-free apart from fonts: hand-written `internal/web/static/overlay/widget.js` + `static/css/chat.css`, embedded in the binary.
- Do NOT add a JS build toolchain, bundler or SPA framework.

### 3.2 Korean UI Language

- All user-facing text MUST be written in **Korean** (errors, labels, tooltips, alerts).
- Code comments may be in Korean or English.

---

## 4. Directory Structure

```
cmd/server/            # main: `serve` (default) | `healthcheck` | `backup FILE|-`
internal/
  web/                 # HTTP: pages, widget page + SSE, OAuth login, /link, /healthz, /dev (DEV only)
    templates/         #   html/template (base.html layout + pages/, widget.html, dev.html)
    static/            #   chat.css, js/components.js, overlay/widget.js — embedded
  realtime/            # Hub, per-channel ingest + 250 ms flush workers, SSE subscriptions, token refresh
  chzzk/               # Chzzk OAuth + session API client
  chzzk/eio3/          # minimal receive-only Socket.IO v2 / Engine.IO v3 websocket client
  djclass/             # pure DJ CLASS badge logic (+ frozen python_golden.json oracle)
  resolver/            # chat sender → badge status, TTL-cached
  link/                # viewer linking: connect/sync/unlink/preferred button, daily SyncAll
  varchive/            # V-ARCHIVE client (token used once; ≤8 requests in flight)
  store/               # SQLite: migrations/ (goose), queries.sql → db/ (sqlc), session store
  crypto/              # AES-256-GCM for stored Chzzk tokens
  ratelimit/ ttlcache/ schedule/ config/
tests/widget-smoke.cjs # executes widget.js / components.js under stubs (CI)
public/                # cover image, deployed to Cloudflare Pages (deploy-assets.yml)
docs/                  # screenshot, cutover record, older design notes
```

### 4.1 Adding things

- **New page:** handler in `internal/web`, route in `Server.Handler`, template under `internal/web/templates/pages/` (defines `title` + `content`; rendered with `base.html`). htmx fragments are `{{define "name"}}` blocks executed alone.
- **New query:** add to `internal/store/queries.sql`, run `sqlc generate`. **Schema change:** a new goose file in `internal/store/migrations/` — never edit an applied one.
- **Pure DJ CLASS logic** stays I/O-free in `internal/djclass`, checked against `testdata/python_golden.json` (frozen output of the former Python implementation). If a rule changes intentionally, update the golden file deliberately and say why.

---

## 5. Architecture and Key Constraints

### 5.1 Single process, single instance

One process holds HTTP, the SSE streams, every Chzzk chat connection, the badge cache, the rate limiter and the daily sync. State is in memory → **run exactly one instance**.

### 5.2 Realtime (`internal/realtime`)

- Widgets cannot reach Chzzk; the server ingests chat and pushes batches over **SSE** (`/widget/<channelId>/stream`). The widget makes no other requests and renders `[{button}B {DJ CLASS}] message`; unverified viewers get `미인증`.
- One **Hub**; per Chzzk channel one **ingest** goroutine (token → fresh session URL → dial → subscribe → CHAT into buffer) and one **flush** goroutine (every 250 ms: resolve each sender once, encode one `chat` batch, non-blocking send to each subscriber; 200-message cap).
- Workers follow **widget subscribers, not live status**: the first subscriber starts a channel, the last one leaving tears it down after 30 s (a rejoin cancels that). OBS keeps a loaded source open while off-air, so the session stays up then — intended.
- **Every** failure (token, URL, dial, subscribe ×3, server close) restarts the whole session after a backoff (1 s doubling to 60 s, reset after a healthy minute) — never "retry once". Tokens refresh 5 min before expiry, before connecting.
- Widget streams are unauthenticated → capped (10 per channel, 1000 total → 503), ≤64 queued batches per subscriber, a 10 s deadline on every SSE write. Only channels of streamers who logged in get a worker (others 404).
- **Badges resolve by `senderChannelId` only** — no nickname fallback (nicknames are user-changeable; the old fallback allowed impersonation). Emoji URLs are kept only for `https://*.pstatic.net` / `*.naver.net`.
- `widget.js` reconnects by itself when `EventSource` gives up (non-200 such as a 502 during deploys or the 503 cap).
- Locking: per-channel bookkeeping under `Hub.mu`, the chat buffer under its own mutex; `Hub.Close` stops workers **before** closing subscriber channels.

### 5.3 Chzzk session socket facts (verified live, 2026-10)

The server is **EIO3-only** (client pings; server sends `40` unprompted). A session URL is **single-use** — fetch a fresh one per (re)connect. The server closes sessions on its own after many hours; reconnecting is normal operation. An open session outlives its access token, so refresh **before reconnecting**. Details: `internal/chzzk/eio3` package doc.

### 5.4 Store (`internal/store`)

- One SQLite file, two pools: a **read pool** (`query_only`) and a **single write connection** (`_txlock=immediate`, WAL, `synchronous=NORMAL`, `foreign_keys=ON`). Writers queue in `database/sql`, not on SQLite's lock.
- All writes go through `store.WriteTx(ctx, fn)`. Inside `fn`: use only the given `ctx`/`q`, keep it short, **no network I/O** (every writer waits), never call `WriteTx`/`WriteDB()` again (one connection → deadlock; nested `WriteTx` returns `ErrNestedWrite`).
- Timestamps are unix seconds (INTEGER). Sessions use the scs sqlite3store layout.

### 5.5 Web (`internal/web`)

- **CSRF:** `http.CrossOriginProtection` (Sec-Fetch-Site / Origin) + `SameSite=Lax` session cookie — no tokens in templates.
- **Sessions:** scs on SQLite, 7 days, token renewed at login. OAuth `state`/`next` live in short-lived cookies scoped to `/api/auth/chzzk/` (the login link writes nothing to the DB). `next` must pass `safeNextPath` (relative, no `//`, `/\`, control characters).
- **Headers:** CSP (`img-src` MUST keep Naver's emoji CDN and the cover-image host), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: same-origin`, COOP, Permissions-Policy, HSTS when `BASE_URL` is https. `/widget/*` has its own CSP (no `unsafe-eval`). Session pages send `Cache-Control: no-store`.
- `requireLogin`: htmx **fragment** requests get `HX-Redirect` to `/login/?next=<current page>`; other requests redirect to the requested path.
- `/link` actions (`internal/link`): V-ARCHIVE calls happen **outside** write transactions; the badge cache is invalidated **after** commit; an empty V-ARCHIVE fetch never wipes existing classes; fragment handlers re-read the user before rendering.
- Rate limits (per IP, 60 s windows): link 5, sync 3, pref 10, auth callback 10 → **429** (htmx is configured to swap 429 card bodies). The IP comes from `CF-Connecting-IP`, trusted because the container is reachable only via cloudflared — revisit if that changes.
- `DEV=1` (demo viewers + `/dev` chat injection) is refused unless `BASE_URL` is loopback.

### 5.6 Tokens

- **Chzzk channel tokens** are stored AES-256-GCM encrypted (`internal/crypto`: key = SHA-256 of `VARCHIVE_TOKEN_KEY`, random 12-byte nonce, base64(nonce‖ciphertext‖tag)). Changing the key strands every stored token.
- **V-ARCHIVE is token-less:** the 조회토큰 is used **once** (open-token endpoint → `{userNo, nickname}`) and never stored; sync uses the public per-nickname endpoint.

### 5.7 Caching

`internal/resolver` caches per sender: linked → 5 min, linked without classes → 15 s, unlinked → 10 s. Reads don't extend TTLs; link/sync/unlink/preference changes invalidate after commit.

### 5.8 Outbound calls

Chzzk and V-ARCHIVE HTTP calls use an **8-second timeout**. Errors never quote URLs or tokens (`auth=`, `sessionKey=`).

### 5.9 Daily sync

`internal/schedule` runs `link.SyncAll` at **18:00 UTC** in-process (log: `daily sync done synced=X failed=Y`). No worker container, no external cron.

### 5.11 Backups

`djclass backup FILE|-` makes a consistent snapshot of the live database (`store.Snapshot`: `VACUUM INTO` on a separate read-only connection — only committed data, never blocks writers — then `PRAGMA integrity_check`). `-` streams it to stdout for `restic backup --stdin`; logs go to stderr. Never copy the live `.sqlite3`/`-wal` files directly. The host-side schedule, retention and S3 credentials live in homelab-infra.

### 5.10 Logging

`log/slog`. **Never log tokens, session keys, OAuth codes or other secrets**; the access log omits query strings.

---

## 6. Routes

| Route                                                            | Notes                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /`, `/login/`, `/dashboard/`, `/link/`                      | pages (`/login`, `/dashboard`, `/link` redirect to the slash form) |
| `GET /api/auth/chzzk`, `/api/auth/chzzk/callback`                | OAuth (the callback path is registered with Chzzk — keep it)       |
| `POST /logout/`, `/link/{connect,sync,unlink,preferred-button}/` | session / `#link-card` fragment actions                            |
| `GET /widget/{channelID}[/]`, `/widget/{channelID}/stream`       | OBS widget page + SSE (URLs live in streamers' OBS — keep them)    |
| `GET /static/…`, `/healthz`                                      | embedded assets, health probe                                      |
| `GET /dev`, `POST /dev/chat`                                     | DEV only                                                           |

---

## 7. Testing

- `go test ./...` — tests sit next to the code; all external I/O (Chzzk, V-ARCHIVE, websocket) is faked with `httptest`/fakes; DB tests use a temp SQLite file.
- CI runs `go test -race`. The race detector does not work on the 39-bit-VMA Raspberry Pi kernel — run `-race` only on amd64/CI.
- `node tests/widget-smoke.cjs` executes the browser scripts (including the SSE reconnect logic).

---

## 8. Linter, Formatter, Generated Code

- **gofmt + go vet**; **sqlc diff** (generated code must be current). Keep the Go version identical in `mise.toml`, `go.mod` and the Dockerfile's `golang:` tag (CI checks all three).
- **eslint + prettier** for `internal/web/static/**/*.js`, the smoke test and config files. Prettier ignores `*.html` (it mangles `{{ }}`).

### 8.1 Mandatory commands

**After Go changes:**

```bash
sqlc generate && gofmt -w cmd internal && go vet ./... && go test ./...
```

**After JS changes:**

```bash
npm run lint:fix && npm run format && node tests/widget-smoke.cjs
```

---

## 9. Environment Variables

Read from the environment or `./.env` (see `.env.example`).

| Variable              | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `BASE_URL`            | Public origin (OAuth redirect_uri, widget URLs; https → Secure cookies, HSTS) |
| `CHZZK_CLIENT_ID`     | Chzzk OAuth app                                                               |
| `CHZZK_CLIENT_SECRET` | Chzzk OAuth app secret                                                        |
| `VARCHIVE_TOKEN_KEY`  | Encrypts stored Chzzk tokens — set once, never change                         |
| `SQLITE_PATH`         | SQLite file (default `djclass.sqlite3`; image: `/data/djclass.sqlite3`)       |
| `ADDR`                | Listen address (default `:8000`)                                              |
| `DEV`                 | `1` = demo viewers + `/dev`; refused unless `BASE_URL` is loopback            |

---

## 10. Deployment

- Self-hosted rootless Podman host, managed from a separate private infra repo (homelab-infra). Contract: [`DEPLOY.md`](./DEPLOY.md).
- **Single container, single instance**, SQLite in a persistent `/data` volume.
- **Image:** `Dockerfile` target `go-runner` — static CGO-free binary on distroless Debian 13 (~18 MB, uid 65532). `.dockerignore` excludes `**/.env*` and `**/*.sqlite3*` (local secrets / dev DBs).
- **Auto-deploy:** CI publishes `ghcr.io/feliscatuskr/chzzk-djclass-chat` (`main` + `sha-<7>`, amd64 + arm64) for every main commit that passed `build` and `go-image`; docs-only commits are not published. The host's reconcile pulls `:main` and restarts the container when the image revision changes. **Every published merge restarts production** (widgets reconnect). Rollback = pin `sha-<7>` in homelab-infra.
- The Quadlet health check MUST be exec form: `HealthCmd=["/djclass","healthcheck"]` (distroless has no shell).
- Branch protection requires `build` and `go-image`.

---

## 11. AGENTS.md Self-Update Rule (MANDATORY)

> **If you change anything documented in this file, you MUST update AGENTS.md accordingly** — stack, UI rules, directory layout, architecture constraints, routes, testing, linters, environment variables, deployment.

**Failure to update this file risks the next AI agent working with stale or incorrect context.**
