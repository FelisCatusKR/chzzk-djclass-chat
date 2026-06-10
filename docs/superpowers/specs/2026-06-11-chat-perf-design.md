# Chat pipeline performance — design spec

Date: 2026-06-11
Status: Approved

## Problem

Live chat in the widget can feel laggy: messages appear late or in stuttery
bursts, especially when new chatters speak. Two root causes were identified by
reading the live-chat path (Chzzk → `chat-proxy.ts` → `ws` server →
`WidgetPage` → `/api/widget/dj-class` → `ChatMessageRow`) and by measuring on
the deployment host (Raspberry Pi 4, Docker).

### Root cause 1 — client head-of-line blocking (primary symptom)

`WidgetPage.processQueue` processes messages **one at a time** and, on a
client-cache miss, `await`s a full HTTP round-trip to `/api/widget/dj-class`
**before rendering the message and before starting the next one**. A burst of
new chatters serializes the entire stream behind network latency. Even messages
from already-cached senders wait behind an in-flight uncached lookup.

### Root cause 2 — per-request SQLite open + migration (host resource spikes)

`initDb()` is called on every request and re-runs: open connection → set
pragmas → `CREATE TABLE IF NOT EXISTS` ×4 + indexes + trigger → pragma-based
migration introspection → (after the route) `db.close()`.

Measured on the Pi 4 against a copy of the live DB:

| Pattern | CPU per request |
|---|---|
| Current (`initDb()` open + schema + migrate + close) | **1.9 ms** |
| Singleton connection + cached statements | **0.018 ms** (~103×) |

The DB itself is 64 KB on a USB SSD, so query time is negligible — the 1.9 ms is
pure open/schema/migration overhead. `better-sqlite3` is **synchronous**, and
`server.ts` runs the Next handler and the `ws` chat-forwarding loop **in the
same process/event loop**. So during a burst (e.g. 50 new chatters ≈ 95 ms of
serial blocking) the per-request DB work also **delays chat forwarding**,
feeding back into root cause 1.

### Not a problem on this host

Client render cost (`ChatMessageRow` re-render, `parseEmojiContent`, the glint)
runs on the streamer's separate PC, not the Pi. At rest the Pi sits at load
~0.5 with 8 GB RAM free. So render work is **optional polish**, not a host
concern.

## Goals

1. Eliminate client head-of-line blocking so message **text never waits on a
   badge lookup**.
2. Make server DB access a per-process **singleton** so requests stop
   re-opening/re-migrating SQLite, removing burst-time event-loop blocking.
3. Keep the existing client (2 min) and server (5 min) DJ-class caches and all
   current badge/unverified behavior unchanged.
4. Do not break the existing test suite (which depends on `initDb()` returning a
   fresh, closable connection).

Non-goals: a batch lookup endpoint (YAGNI for current volume); changing badge
visuals; reworking reconnect logic.

## Design

### Server: shared DB singleton (`src/lib/db.ts`)

- Keep `getDb()`, `initSchema()`, `runMigrations()`, and `initDb()` **exactly as
  they are** — tests call `initDb()` and expect a fresh, closable connection
  after unlinking the DB file between cases.
- Add `getSharedDb()`: returns a process-wide singleton, lazily created via
  `initDb()` (so schema + migrations run **once**). Guard the singleton on
  `globalThis` so Next dev hot-reload does not leak connections.
- Add `closeSharedDb()` for graceful shutdown and test isolation.
- Migrate the **production request/proxy/worker paths** from
  `initDb()` + `db.close()` to `getSharedDb()` with **no close**:
  - `src/app/api/widget/dj-class/route.ts` (remove `finally { db.close() }`)
  - `src/app/api/channel/route.ts`
  - `src/app/api/user/preferred-button/route.ts`
  - `src/app/api/user/link-varchive/route.ts`
  - `src/app/api/user/me/route.ts`
  - `src/app/api/user/sync-djclass/route.ts`
  - `src/app/api/auth/chzzk/callback/route.ts`
  - `src/lib/chat-proxy.ts` (remove `db.close()` in `finally`)
  - `src/worker/sync-djclass.ts`
- `server.ts`: call `closeSharedDb()` during graceful shutdown.

The shared connection is safe: `better-sqlite3` serializes calls, WAL is already
enabled, and the worker is a separate process with its own singleton.

### Client: decouple render from lookup (`WidgetPage.tsx`)

Replace the sequential `processQueue` loop with **immediate append + async badge
enrichment**:

1. On each `ws` `chat` message, build the row and **append it immediately**
   (`prev.slice(-99)`), preserving arrival order. Text shows with zero network
   wait.
2. Synchronously check the client cache (`getCachedDjClass`). On a **hit**,
   attach badge fields at append time (no pop-in). On a **miss**, append with
   null badge fields and `pending: true`, then fire an async lookup.
3. The async lookup is deduped by an **in-flight map** keyed by
   `senderKey:sel`: concurrent messages from the same new chatter share one
   request. On resolve, `setMessages` patches **all** currently-displayed
   pending rows from that sender with the resolved badge fields and clears
   `pending`.
4. Keep the existing fetch/caching semantics (404 → unverified; 5xx/network →
   don't cache; client-cache TTL via `setCachedDjClass`).

This removes the queue, `isProcessingRef`, and all per-message awaiting. Badges
appear instantly for cached senders and within one round-trip for new ones,
while text is never delayed.

`ChatMessage` gains internal fields: `senderKey: string` and `pending?: boolean`.

### Client render polish (small, low-risk; included)

- Wrap `ChatMessageRow` in `React.memo` so only new/patched rows re-render
  instead of all ~100 on every append. `badgeMode` is passed from a ref and is
  stable, so the default shallow compare is correct.
- Change the auto-scroll from `behavior: 'smooth'` to `behavior: 'auto'` so
  bursts don't queue stacked smooth-scroll animations.

## Testing

- New `tests/shared-db.test.ts`: `getSharedDb()` returns the same instance across
  calls, the instance is open, and `closeSharedDb()` resets it. Uses a temp
  `DATABASE_URL` and calls `closeSharedDb()` in `afterEach` for isolation.
- Existing suite must stay green (it exercises `initDb()`, unchanged).
- Verify: `npm test`, `tsc --noEmit`, `eslint`, `next build`.

Client changes have no unit-test harness (tests are pure-function only); they are
validated by typecheck, lint, and build, plus manual reasoning about ordering and
dedup.

## Risks

- **Stale shared connection if DB file is replaced at runtime.** Not applicable:
  the production DB path is fixed and the file is never swapped under a running
  process.
- **Badge pop-in for brand-new chatters.** Accepted; standard for chat overlays
  and far less jarring than a stalled stream.
