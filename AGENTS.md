# AGENTS.md — Chzzk DJ CLASS Chat Widget

> Rules and context that AI coding agents MUST follow when working on this project.

---

## 1. Project Overview

An OBS Browser Source widget service that displays V-ARCHIVE DJ CLASS badges on Chzzk (Korean streaming platform) chat messages.

- **Target Users:** Korean Chzzk streamers and viewers who play DJMAX RESPECT V
- **UI Language:** Korean ONLY. All user-facing text must be written in Korean.
- **Repository:** `chzzk-djclass-overlay`

---

## 2. Technology Stack

| Technology       | Version          | Purpose                                                |
| ---------------- | ---------------- | ------------------------------------------------------ |
| Node.js          | 24               | Runtime (engines field, .nvmrc, Dockerfile base image) |
| Next.js          | 15+ (App Router) | Web server, API routes, pages                          |
| TypeScript       | 5.7+             | Entire codebase                                        |
| Tailwind CSS     | 3.4+             | Styling                                                |
| shadcn/ui        | —                | UI component system                                    |
| SQLite           | —                | File-based DB via `better-sqlite3`                     |
| Socket.IO-client | **v2.0.3**       | Chzzk chat server integration (NOT compatible with v4) |
| Vitest           | 3.0+             | Unit tests                                             |

---

## 3. UI and Component Rules

### 3.1 Mandatory shadcn/ui Usage

- **Always check shadcn/ui first when a new UI component is needed.**
- If the component exists, install it via `npx shadcn add <component>` and use it.
- If it does NOT exist in shadcn/ui, build it on top of **Radix UI primitives** + Tailwind CSS, and place it in `src/components/ui/`.
- Avoid writing ad-hoc custom `<div>`-based UI components.

### 3.2 Korean UI Language

- All user-facing text MUST be written in **Korean**.
- This includes error messages, button labels, tooltips, alerts, and any other UI copy.
- Code comments may be in Korean or English.

### 3.3 Tailwind Class Ordering

- `prettier-plugin-tailwindcss` automatically sorts Tailwind CSS classes.
- Do NOT manually reorder classes. Leave it to Prettier formatting.

---

## 4. Directory Structure and Conventions

```
src/
  app/                    # Next.js App Router pages and API routes
    page.tsx              # Landing page
    layout.tsx            # Root layout
    globals.css           # Global styles and Tailwind directives
    (route)/              # Route groups (when sharing layouts)
    api/                  # API routes (route.ts)
    widget/[channelId]/   # OBS widget page
    dashboard/            # Streamer dashboard
    link/                 # Viewer linking page
  components/
    ui/                   # shadcn/ui components ONLY
    *.tsx                 # Page-specific components
  lib/                    # Business logic, utilities, DB, API clients
    db.ts                 # SQLite initialization and migrations
    crypto.ts             # AES-256-GCM encryption / decryption
    session.ts            # Session cookie signing / verification
    chzzk.ts              # Chzzk API client
    varchive.ts           # V-ARCHIVE API client
    chat-proxy.ts         # Chzzk chat proxy (Socket.IO v2)
    cache.ts              # LRU cache
    logger.ts             # Leveled logger (debug suppressed in production)
    rate-limit.ts         # In-memory per-IP rate limiting
    types.ts              # Shared TypeScript types
    utils.ts              # Utilities like cn()
  worker/                 # Cron workers (node-cron based)
    index.ts
    sync-djclass.ts
scripts/                  # Utility scripts
tests/                    # Vitest test files
```

### 4.1 Adding / Moving Rules

- **New pages** go under `src/app/` following App Router conventions.
- **New API endpoints** go under `src/app/api/` as `route.ts` files.
- **New shared utilities** go in `src/lib/`.
- **New shadcn/ui components** MUST be placed in `src/components/ui/`.

---

## 5. Architecture and Key Constraints

### 5.1 Chat Proxy

- Widgets **cannot connect directly to Chzzk**. The server acts as a middle proxy.
- The server connects to Chzzk using Socket.IO-client **v2.0.3**. **v4.x is NOT compatible.**
- The server encrypts Chzzk tokens with AES-256-GCM and stores them in the `channels` table.
- A `connectingPromise` prevents race conditions when multiple widgets connect simultaneously.
- When all widgets disconnect, the server waits 30 seconds before cleaning up the Chzzk connection.

### 5.2 Widget Rendering

- The widget page (`/widget/[channelId]`) uses a **transparent background**. It is meant for OBS overlay use.
- The widget connects to our server via raw WebSocket (`/ws/chat?channelId=xxx`).
- Message format: `[{button}B {DJ CLASS}]: message text` — the Chzzk nickname is NOT displayed.
- Unlinked viewers are shown at 25% opacity.

### 5.3 Token Encryption

- V-ARCHIVE tokens: `AES-256-GCM` + `VARCHIVE_TOKEN_KEY` environment variable; each record uses a **random per-record salt**
- Chzzk tokens: stored in the `channels` table using the same encryption method
- Session cookies: `HMAC-SHA256` signed (`SESSION_SECRET`) with a **server-verified 7-day expiry** embedded in the payload

### 5.4 Caching

- Server-side DJ CLASS lookups use an LRU cache:
  - Linked user with DJ CLASS data → 5 minutes
  - Linked user without DJ CLASS → 15 seconds
  - Unlinked user → 10 seconds
- `updateAgeOnGet: false` — active chatters do NOT extend their TTL.

### 5.5 Rate Limiting

- `src/lib/rate-limit.ts` provides in-memory per-IP rate limiting.
- Applied to the auth, link-varchive, and sync-djclass routes; violations return **HTTP 429**.

### 5.6 Security Headers

- Security headers (including **CSP**) are injected on all responses via `next.config.js` `headers()`.

### 5.7 Outbound Fetch Timeouts

- All outbound HTTP calls to Chzzk and V-ARCHIVE use an **8-second `AbortSignal` timeout**.

### 5.8 Logging

- All server-side logging goes through `src/lib/logger.ts`.
- `debug` level is suppressed in production (`NODE_ENV=production`).
- **Never log tokens, session keys, or other secrets**, regardless of log level.

---

## 6. API Route Patterns

- All API routes are written in `src/app/api/.../route.ts`.
- Use standard HTTP methods as `export async function`.

```ts
// Example: GET /api/example
export async function GET(request: Request) {
  // ...
  return Response.json({ data })
}
```

---

## 7. Testing

- **Test Framework:** Vitest
- **Test Location:** `tests/` directory or co-located as `*.test.ts` alongside the file under test
- **Run Tests:** `npm test`
- **Current Test Coverage:**
  - `tests/crypto.test.ts` — Encryption / decryption round-trip
  - `tests/db.test.ts` — DB schema initialization and constraints
  - `tests/oauth.test.ts` — Chzzk OAuth URL generation and token exchange
  - `tests/varchive.test.ts` — DJ CLASS API response parsing and button selection
  - `tests/session.test.ts` — Session cookie signing and tamper resistance
  - `tests/worker.test.ts` — Daily DJ CLASS sync worker batch logic

---

## 8. Linter and Formatter

- **ESLint:** Next.js + TypeScript + Prettier integrated flat config
- **Prettier:** Code formatting + automatic Tailwind CSS class sorting
- **Config Files:**
  - `eslint.config.mjs` — ESLint flat config
  - `.prettierrc` — Prettier settings
  - `.editorconfig` — Editor settings mirroring Prettier (indent, line endings, trailing newline)

### 8.1 Mandatory Commands

**After finishing code changes, you MUST run:**

```bash
npm run lint:fix
npm run format
```

**Available Scripts:**

| Script                 | Description                 |
| ---------------------- | --------------------------- |
| `npm run lint`         | Run linter                  |
| `npm run lint:fix`     | Auto-fix linter errors      |
| `npm run format`       | Format code with Prettier   |
| `npm run format:check` | Check formatting compliance |

---

## 9. Environment Variables

Required variables in `.env`:

| Variable               | Description                              |
| ---------------------- | ---------------------------------------- |
| `CHZZK_CLIENT_ID`      | Chzzk OAuth client ID                    |
| `CHZZK_CLIENT_SECRET`  | Chzzk OAuth client secret                |
| `NEXT_PUBLIC_BASE_URL` | Public base URL (for OAuth callbacks)    |
| `VARCHIVE_TOKEN_KEY`   | AES-256-GCM encryption key (32+ bytes)   |
| `SESSION_SECRET`       | Session cookie HMAC-SHA256 signing key   |
| `DATABASE_URL`         | SQLite file path (e.g., `./data/app.db`) |
| `NODE_ENV`             | `development` or `production`            |

---

## 10. Deployment

- **Platform:** Dokku (or similar PaaS). Full setup steps in [`DEPLOY.md`](./DEPLOY.md).
- **Containers:** 1 web + 1 worker — **one app, two process types** via `Procfile` (NOT two apps; they share the SQLite volume)
- **Database:** SQLite file mounted as a Dokku volume at `/app/data`, shared by both process types
- **Docker:** Multi-stage `Dockerfile`
  - Base image: **Node.js 24** (`bookworm-slim`; build stage installs `python3 make g++` for `better-sqlite3`)
  - Runtime: `tsx server.ts` (no `output: 'standalone'`)
  - Includes a **HEALTHCHECK** that fetches `http://localhost:3000/` via Node's global `fetch` (web only; the worker container reports unhealthy since it serves no HTTP — Dokku uses its own checks, so this is cosmetic)
  - `NEXT_PUBLIC_BASE_URL` is inlined by Next at **build time** — must be passed as a Docker `--build-arg` (Dokku: `docker-options:add <app> build`)

---

## 11. AGENTS.md Self-Update Rule (MANDATORY)

> **If you change anything documented in this file, you MUST update AGENTS.md accordingly.**

Update AGENTS.md when any of the following change:

- **Technology stack** additions / changes / version bumps
- **UI / component rules** (shadcn/ui usage, language policy, etc.)
- **Directory structure** (new directories, file moves, etc.)
- **Architecture constraints** (chat proxy, caching policy, encryption method, etc.)
- **API route patterns**
- **Testing** conventions or frameworks
- **Linter / formatter** settings
- **Environment variables** added / changed / removed
- **Deployment method**

**Failure to update this file risks the next AI agent working with stale or incorrect context.**

---

_This document is the project's live context guide. Update it immediately when things change._
