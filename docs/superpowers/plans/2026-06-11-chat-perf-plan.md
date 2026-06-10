# Chat pipeline performance — implementation plan

Spec: `docs/superpowers/specs/2026-06-11-chat-perf-design.md`

## Step 1 — Shared DB singleton (test-first)

1. Write `tests/shared-db.test.ts`:
   - sets `process.env.DATABASE_URL` to a temp path, unlinks before/after,
     calls `closeSharedDb()` in `afterEach`.
   - asserts `getSharedDb() === getSharedDb()` (same instance), instance `.open`
     is true, schema tables exist, and after `closeSharedDb()` a new call
     returns a fresh open instance.
2. Add to `src/lib/db.ts`:
   - `getSharedDb()` — `globalThis`-guarded lazy singleton built via `initDb()`.
   - `closeSharedDb()` — closes + clears the singleton.
   - Leave `getDb`/`initSchema`/`runMigrations`/`initDb` unchanged.
3. Run `tests/shared-db.test.ts` → green. Run full suite → still green.

## Step 2 — Migrate production paths to `getSharedDb()`

Replace `initDb()` → `getSharedDb()` and remove `db.close()` (and
`finally { db.close() }` blocks) in:
- `src/app/api/widget/dj-class/route.ts`
- `src/app/api/channel/route.ts`
- `src/app/api/user/preferred-button/route.ts`
- `src/app/api/user/link-varchive/route.ts`
- `src/app/api/user/me/route.ts`
- `src/app/api/user/sync-djclass/route.ts`
- `src/app/api/auth/chzzk/callback/route.ts`
- `src/lib/chat-proxy.ts`
- `src/worker/sync-djclass.ts`

Then add `closeSharedDb()` to `server.ts` graceful shutdown. Keep tests
(`tests/*`) on `initDb()` untouched.

## Step 3 — Client decouple (`WidgetPage.tsx`)

1. Extend `ChatMessage` (in `ChatMessageRow.tsx`) with `senderKey: string` and
   `pending?: boolean`.
2. Remove `pendingQueueRef` / `isProcessingRef` / `processQueue`.
3. In `ws.onmessage`: build row, sync cache check, append immediately; on miss
   fire deduped async lookup via an `inFlightRef` map; patch matching pending
   rows on resolve. Guard all async writes with `isUnmountingRef`.
4. Extract the fetch+cache logic into a local `lookupDjClass(senderId, nick)`
   returning a `CacheEntry`, preserving 404/5xx/network semantics.

## Step 4 — Render polish

- `export default React.memo(ChatMessageRow)`.
- Auto-scroll `behavior: 'smooth'` → `'auto'`.

## Step 5 — Verify & integrate

- `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` — all clean.
- Commit on `perf/chat-pipeline`, merge to `main`, push origin, remove worktree.
