# Widget Feature Additions — Design

Date: 2026-06-08

## Overview

Three additions to the DJ CLASS chat widget:

1. **Viewer button preference** — a linked viewer picks one of their buttons
   (4/5/6/8) to display; the picker only offers buttons they actually have a
   record for.
2. **Streamer auto-vs-viewer toggle** — the streamer chooses whether the widget
   honors each viewer's preferred button or always shows the highest class
   (auto). Default is auto, matching today's behavior.
3. **Per-message fadeout** — optional. When enabled, each message fades out a
   configurable number of seconds (5–60) after it appears. Default off.

### Dropped: moderator-deleted messages

A fourth idea — reflecting mod-deleted messages in the widget — was investigated
and **dropped from this spec**. The Chzzk *open API* session (the official
socket.io connection this project uses) emits only `CHAT`, `DONATION`,
`SUBSCRIPTION`, and `SYSTEM` (connected/subscribed/unsubscribed/revoked) events.
There is **no pushed event for message deletion or blind**. The CHAT payload's
`chatChannelId` field is annotated "used for message deletion," but that is for
moderators to call a delete REST endpoint — nothing is pushed back to
subscribers. The only source of blind/deletion events is the unofficial legacy
Chzzk chat WebSocket, which is a different protocol with ToS/reliability risk and
departs from this project's official-API stance. Revisit if Chzzk adds a
deletion event to the open API.

## Architectural decision: where button-selection resolves

The widget calls `/api/widget/dj-class` per message and gets back one resolved
class. We keep that shape and **resolve the auto-vs-viewer choice server-side**:
the widget passes its mode as a query param, the API returns the single
appropriate class. The selection mode is appended to the cache key.

Rejected alternatives: resolving client-side (larger payload, moves logic out of
the tested pure helpers) or a hybrid returning both classes (middle ground, no
clear win). Server-side resolution matches the existing "API returns one class"
contract and keeps selection logic in `dj-class.ts` where it is unit-tested.

## Section 1 — Data model

### `dj_classes`: one row per `(user_id, button)`

Today the table has `user_id INTEGER UNIQUE NOT NULL` — a single row per user
(the highest button-class, chosen at sync time). To let a viewer pick any of
their buttons, we store every button that has a record.

- `initSchema` CREATE TABLE adds `UNIQUE(user_id, button)` and a named index
  `idx_dj_classes_user_button`, so fresh installs are correct.
- **Migration 4** (idempotent): guarded by "does `idx_dj_classes_user_button`
  exist?". When absent, rebuild the table — create the new-shape table, copy
  existing rows, drop the old table, rename, create the index. SQLite cannot drop
  a column-level `UNIQUE` in place, so a table rebuild is required. Existing
  single rows survive as that user's one known button.

### `users`: add `preferred_button INTEGER` (nullable)

- `NULL` = auto / no preference. Every existing user starts here, so behavior is
  unchanged until they opt in.
- Added via `ALTER TABLE users ADD COLUMN preferred_button INTEGER`, guarded by
  `columnExists`.
- Validation (must be 4/5/6/8 **and** a button the user actually has) lives in the
  application layer, not a SQL CHECK, to keep the ALTER simple.

## Section 2 — Sync (manual route + worker)

- New `getAllDjClasses(nickname)` in `varchive.ts` returns every button that has a
  record: `{ button, djClass, djPowerSum, maxDjPower, djPowerConversion }[]`.
  `getHighestDjClass` is retained (or derived from the array) for the link-page
  "current class" display and the sync response payload.
- Both sync paths — `POST /api/user/sync-djclass` and `worker/sync-djclass.ts` —
  **upsert each fetched button** (`ON CONFLICT(user_id, button)`) and **delete
  rows for buttons no longer present** in the fresh fetch.
- Sync never touches `preferred_button`. A temporary V-ARCHIVE blip must not wipe
  a viewer's choice; the API falls back to highest if the preference ever points
  at a button with no current row.
- When a user has no DJ CLASS at all, delete all their `dj_classes` rows (current
  behavior, generalized from one row to all).

## Section 3 — Widget DJ-CLASS API (`/api/widget/dj-class`)

- New query param `sel=auto|viewer`, default `auto`.
- Selection extracted into a pure, testable helper in `dj-class.ts`:

  ```ts
  resolveDisplayedClass(rows, preferredButton, sel) -> row | null
  ```

  - `sel=auto` → highest via existing `getClassSortKey` / `compareClassSortKeys`.
  - `sel=viewer` + `preferredButton` present among `rows` → that row.
  - `sel=viewer` with preference `null` or not in `rows` → highest (fallback).
- The route reads all `dj_classes` rows for the user plus `users.preferred_button`,
  calls the helper, and returns the same response shape as today
  (`djClass`, `rankName`, `rankLevel`, `powerInteger`).
- **Cache key gains the mode**: `id:${chzzkId}:${sel}` and
  `nick:${nickname}:${sel}`. `invalidateUserCache` / `invalidateNicknameCache`
  delete both `:auto` and `:viewer` variants so a sync clears everything for the
  user. Unlinked/fallback cache entries are keyed with the same suffix scheme.

## Section 4 — Widget behavior & URL params (`WidgetPage.tsx`)

Two new URL params, parsed on mount (same pattern as `mode`/`fontSize`):

- **`buttonSel=auto|viewer`** (default `auto`) — passed to the API as `sel`. Also
  folded into the client-side `djClassCache` key so the two modes don't collide.
- **`fadeout=<seconds>`** — `0`/absent = off; otherwise clamped to **5–60**. New
  `lib/fadeout.ts` (mirrors `font-size.ts`: `FADEOUT_MIN=5`, `FADEOUT_MAX=60`,
  `FADEOUT_DEFAULT=15`, `parseFadeout`) provides testable parsing.

### Fadeout mechanism (per-message age)

- Each `ChatMessage` gains `createdAt: number` and `fading?: boolean`.
- When `fadeout > 0`, a single `setInterval` (~250ms) marks messages older than
  `fadeout` seconds as `fading` (a CSS opacity transition in `ChatMessageRow`),
  then removes them from state once older than `fadeout + ~0.5s` (after the
  transition). One interval, cleared on unmount — no per-message timers.
- When `fadeout = 0`, no interval runs and messages persist as today (capped at
  the last 100).

## Section 5 — Dashboard (streamer)

Two new cards feeding `getWidgetUrl()` — no server state, consistent with the
current URL-param design:

- **버튼 선택 모드** — RadioGroup: `자동 (최고 클래스)` / `시청자 선택 우선`.
  Default auto; `buttonSel` is omitted from the URL when auto to keep it clean.
- **비활성 채팅 페이드아웃** — on/off toggle + `Slider` (5–60, default 15,
  disabled when off). When on, appends `fadeout=<sec>`.
- `WidgetPreview` is left unchanged; fadeout preview is out of scope for this
  spec.

## Section 6 — Link page (viewer) + supporting API

- **`/api/user/me`** extended to also return `availableButtons: number[]`
  (sorted) and `preferredButton: number | null`.
- **New `POST /api/user/preferred-button`** — body `{ button: number | null }`.
  Validates `button` is among the user's available buttons (or `null` to clear),
  updates `users.preferred_button`, invalidates that user's caches. Rate-limited
  like the other user routes.
- **LinkPage** gains a **버튼 선택** card, shown only when linked **and**
  `availableButtons.length > 1` (no choice to make otherwise): RadioGroup `자동`
  plus one option per available button (e.g. `8버튼`). Changing it POSTs
  immediately and reflects the result.

## Section 7 — Testing (Vitest)

- `resolveDisplayedClass` — auto→highest; viewer→preferred; viewer with missing
  or null preference→highest fallback.
- `parseFadeout` — `0`/absent off, `<5`→off, `5–60` pass-through, `>60`→60.
- `getAllDjClasses` — multi-button parsing with some buttons absent (mocked
  fetch).
- Migration 4 — an old single-row DB rebuilds and accepts multiple
  `(user_id, button)` rows; `preferred_button` column present afterward.
- `POST /api/user/preferred-button` — rejects a button the user doesn't have;
  accepts `null`.

## Documentation

Update `README.md`: document the new `buttonSel` and `fadeout` widget URL params
under the streamer section, and the viewer button-preference step under the
viewer section.
