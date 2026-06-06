# Chzzk DJ CLASS OBS Overlay - Design Spec

**Date:** 2026-06-05 (Updated 2026-06-06)  
**Topic:** chzzk-djclass-overlay  
**Status:** Approved & Implemented

---

## 1. Overview

A full-stack web application that provides an OBS Browser Source widget for Chzzk (Korean streaming platform) chat. The widget displays each chatter's DJ CLASS (from V-ARCHIVE, a DJMAX RESPECT V rhythm game database) in front of their messages instead of their nickname.

**Target Users:** Korean Chzzk streamers and viewers who play DJMAX RESPECT V.

**Primary Language:** Korean (all UI text).

---

## 2. Goals

- Streamers can get a unique OBS widget URL for their channel.
- Viewers can link their Chzzk account with their V-ARCHIVE Open API token.
- The server syncs DJ CLASS data once per day.
- The chat widget displays DJ CLASS badges with no nickname shown.
- Unlinked viewers see their messages at 25% opacity (silent encouragement to link).
- Fallback to `BEGINNER` for linked users with no DJ CLASS data.

---

## 3. Architecture

### 3.1 Services

| Service         | Purpose                                                           | Technology                                         |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **Web Server**  | Serves UI pages, API routes, OBS widget, and WebSocket chat proxy | Next.js 15+ (App Router), TypeScript, Socket.IO v2 |
| **Cron Worker** | Daily DJ CLASS sync from V-ARCHIVE                                | Node.js + `node-cron`                              |
| **Database**    | Stores users, channels, tokens, cached DJ CLASS                   | SQLite (file-based)                                |

### 3.1a Chat Proxy Architecture

Chzzk chat requires authenticated access via the Open API session system. The widget cannot connect directly.

**Flow:**

1. Server stores streamer's encrypted Chzzk access token (from OAuth callback).
2. Server calls `GET /open/v1/sessions/auth` to get a Socket.IO session URL.
3. Server connects to Chzzk via **Socket.IO-client v2.0.3** (required by Chzzk).
4. Server receives `SYSTEM` event with `sessionKey`, then subscribes to `CHAT` events.
5. Widgets connect to our server via raw WebSocket (`/ws/chat?channelId=xxx`).
6. Server relays Chzzk chat messages to all connected widgets.
7. Widget performs DJ CLASS lookup via `/api/widget/dj-class`.

**Resilience:**

- **Race condition handling:** `connectingPromise` prevents duplicate Socket.IO connections when multiple widgets connect simultaneously.
- **Auto-reconnect:** If Chzzk disconnects while widgets are still connected, the server schedules a reconnect after 5 seconds.
- **Token refresh:** If the access token is expired at connection time, the server automatically refreshes it using the stored refresh token.
- **Graceful disconnect:** When all widgets disconnect, the server waits 30 seconds before closing the Chzzk connection (allows OBS reloads without re-authing).

**Note:** Socket.IO-client v4.x is **not compatible** with Chzzk. The API requires v2.0.3 specifically.

### 3.2 Deployment

- **Platform:** Dokku (or similar PaaS).
- **Containers:** 2 containers (web + worker) via Dokku `Procfile`.
- **Persistence:** SQLite file mounted via Dokku volume.
- **Docker:** Single `Dockerfile` with multi-stage build.

### 3.3 External APIs

| API                       | Purpose                                              | Auth             |
| ------------------------- | ---------------------------------------------------- | ---------------- |
| **Chzzk OAuth**           | Authenticate streamers and viewers                   | OAuth 2.0        |
| **V-ARCHIVE User Lookup** | Validate Open API token, get `userNo` and `nickname` | `Bearer {token}` |
| **V-ARCHIVE DJ CLASS**    | Fetch DJ CLASS by nickname and button                | None (public)    |

#### Chzzk API Endpoints & Formats

**OAuth Initiation** (`GET /account-interlock`):
Query parameters (camelCase):

- `clientId` (String)
- `redirectUri` (String)
- `state` (String)

**Token Exchange** (`POST /auth/v1/token`):
Request body (camelCase):

- `grantType` (String, e.g., `"authorization_code"`)
- `clientId` (String)
- `clientSecret` (String)
- `code` (String)
- `state` (String)

Response: May be wrapped in `{ code, message, content }` envelope. `content.accessToken`, `content.refreshToken`, `content.expiresIn`.

**User Info** (`GET /open/v1/users/me`):
Response: Top-level fields (NOT wrapped in `content`):

- `channelId` (String) — The unique identifier for the channel.
- `channelName` (String) — The name of the channel.

---

## 4. Data Model

### 4.1 Schema

```sql
-- Users who have authenticated via Chzzk OAuth
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chzzk_id TEXT UNIQUE NOT NULL,          -- Chzzk user ID from OAuth
    chzzk_nickname TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Streamer channels (one per user)
CREATE TABLE channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
    chzzk_channel_id TEXT UNIQUE NOT NULL,  -- The channel/streamer ID
    chzzk_access_token_encrypted TEXT,       -- For chat proxy (AES-256-GCM encrypted)
    chzzk_refresh_token_encrypted TEXT,      -- Token refresh
    token_expires_at DATETIME,               -- Access token expiration
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- V-ARCHIVE token links (one per viewer user)
CREATE TABLE varchive_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
    token_encrypted TEXT NOT NULL,           -- AES-256-GCM encrypted
    varchive_nickname TEXT NOT NULL,         -- Fetched from /api/v2/open-token/user
    is_active BOOLEAN DEFAULT true,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cached DJ CLASS data (synced daily by worker)
CREATE TABLE dj_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
    button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),  -- 4, 5, 6, or 8 (highest selected)
    dj_class TEXT NOT NULL,                  -- e.g., "HIGH CLASS II"
    dj_power_sum REAL,
    max_dj_power REAL,
    dj_power_conversion REAL,                -- DJ POWER used for theory badge (≥10000)
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Design Decisions

- **Token Encryption:** V-ARCHIVE tokens are encrypted at rest using `AES-256-GCM` with a key from the `VARCHIVE_TOKEN_KEY` environment variable.
- **Nickname from Token:** The V-ARCHIVE nickname is fetched once during linking via `/api/v2/open-token/user` and stored. It is used to look up DJ CLASS via `/api/v2/archive/{nickname}/djClass/{button}`.
- **Button Selection:** All buttons (4, 5, 6, 8) are tried, and the one with the highest **DJ POWER** (`djPowerConversion`) is selected. This is non-configurable to prevent users from displaying a class they haven't earned.
- **Daily Sync:** The worker fetches fresh DJ CLASS for all active `varchive_tokens` and upserts into `dj_classes`.

---

## 5. Pages & UI

All UI text is in **Korean**.

### 5.1 Landing Page (`/`)

- Brief service description (what it does, why it's useful).
- Two primary CTA buttons:
  - **"시청자이신가요? - DJ CLASS 연동하기"** → `/link`
  - **"스트리머이신가요? - 채팅 위젯 얻기"** → `/dashboard`
- Footer with GitHub link.

### 5.2 Viewer Linking Page (`/link`)

- **Step 1:** Chzzk 로그인 button (initiates OAuth flow).
- **Step 2:** After OAuth callback, V-ARCHIVE Open API 조회토큰 입력 폼.
  - Input field for the token.
  - Link to `https://v-archive.net/mypage` with instructions on how to get the token.
  - Submit button.
- **Step 3:** Server validates token by calling `GET /api/v2/open-token/user`.
- **Step 4:** On success, show message: "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다."
- On failure, show: "조회토큰이 유효하지 않습니다. 다시 확인해주세요."

### 5.3 Streamer Dashboard (`/dashboard`)

- Unique OBS widget URL: `https://<domain>/widget/<channelId>?mode=short`
- **"URL 복사"** button (copies URL with current mode parameter).
- Widget preview link.
- **Badge mode chooser:** Buttons to select `short` / `threshold` / `power` mode. Updates URL in real-time.
- Simple OBS setup instructions.
- **Connection status card:**
  - Chzzk 로그인 status (whether tokens are stored)
  - 채팅 서버 연결 status (whether Socket.IO is actually connected to Chzzk)
  - Alerts if tokens are missing (requires re-login)

### 5.4 OBS Widget (`/widget/[channelId]`)

- **Transparent background** (suitable for OBS overlay).
- Connects to our server via WebSocket (`/ws/chat?channelId=xxx`), which proxies Chzzk chat.
- Displays incoming chat messages.
- **Message format:** `[{button}B {DJ CLASS}]: message text` (no Chzzk nickname shown).
- DJ CLASS badges use official V-ARCHIVE tier colors (gradients).
- Auto-scrolls with smooth animations.
- Unlinked viewers shown at 25% opacity.

---

## 6. Chat Widget Behavior

### 6.1 DJ Class Display Rules

| Viewer State                    | Display   | Opacity  | Badge             |
| ------------------------------- | --------- | -------- | ----------------- | -------------------------------------------- |
| Linked + Has DJ CLASS           | `[Badge]  | message` | 100%              | Single colored badge, content by mode        |
| Linked + No DJ CLASS (fallback) | `[4B BG]  | message` | 100%              | Silver BEGINNER badge (treats as 4B 0 point) |
| Not Linked (no V-ARCHIVE token) | `message` | 25%      | None (faded text) |

**Badge Mode:** Set via URL query parameter on the widget (`?mode=short|threshold|power`). Exactly one colored badge is shown per message:

1. **Short Name** (`short`, default): Colored badge shows button + short name + level, e.g., `4B SS II`.
2. **Threshold** (`threshold`): Colored badge shows button + threshold, e.g., `4B 9800+`.
3. **Integer Power** (`power`): Colored badge shows button + integer power, e.g., `4B 9843`.

All modes use the official V-ARCHIVE tier color gradient for the badge background.

**Short Rank Names:**

- `LoD` (THE LORD OF DJMAX), `BM` (BEAT MAESTRO), `SS` (SHOWSTOPPER)
- `HL` (HEADLINER), `TS` (TREND SETTER), `PRO` (PROFESSIONAL)
- `HC` (HIGH CLASS), `PD` (PRO DJ), `MM` (MIDDLEMAN)
- `SD` (STREET DJ), `RK` (ROOKIE), `AM` (AMATEUR), `TR` (TRAINEE), `BG` (BEGINNER)

**Per-Level Thresholds:** Each rank (except LoD and BEGINNER) has 4 thresholds by Roman numeral level (IV, III, II, I):

- BEAT MAESTRO: IV=9900, III=9930, II=9950, I=9970
- SHOWSTOPPER: IV=9700, III=9750, II=9800, I=9850
- etc.

**Theory Badge (이론치):** Special red/orange glittering gradient badge shown when DJ POWER ≥ 10000. Displayed as a separate badge alongside the main DJ CLASS badge.

**Auto-sync:** After Chzzk OAuth login, if V-ARCHIVE is already linked, DJ CLASS is automatically synced.

### 6.2 Examples

```
4B SS II 안녕하세요!                        ← Short name mode
4B 9800+ 안녕하세요!                        ← Threshold mode
4B 9843 안녕하세요!                         ← Power mode
4B LoD 이론치 안녕하세요!                   ← Theory mode (any mode + 이론치)
4B BG 반갑습니다                            ← BEGINNER fallback (4B 0 point)
안녕하세요...                                ← 25% opacity, faded, no badge
```

### 6.3 Technical Flow

1. OBS loads `/widget/[channelId]` as Browser Source.
2. Widget page connects to Chzzk WebSocket chat server directly.
3. On each chat message:
   - Extract sender's identifier (Chzzk user ID if available from WebSocket, otherwise nickname).
   - **Cache Lookup (client-side):** Check in-memory Map cache first (2-minute TTL, key: `chzzk_id` or `chzzk_nickname`).
     - Cache hit: Use cached DJ CLASS directly.
     - Cache miss: Call `/api/widget/dj-class` and populate cache.
   - **Cache Lookup (server-side):** LRU cache with differentiated TTLs:
     - **Linked with DJ CLASS** → cache for 5 minutes (rich metadata: `rankName`, `rankLevel`, `powerInteger`, `isTheory`).
     - **Linked but no DJ CLASS** (fallback BEGINNER) → cache for 15 seconds (retries until sync finishes).
     - **Not linked / not in DB** → cache for 10 seconds (retries until user links).
     - `updateAgeOnGet: false` — active chatters do NOT extend TTLs.
   - **Widget rendering:** Colored prefix badge (`{button}B {shortName} {level}`) shown for all linked users. Mode-specific badge (`threshold+` or integer power) shown alongside. Theory badge (`이론치`) shown when DJ POWER ≥ 10000.

---

## 7. API Routes

### 7.1 Auth

| Method | Route                      | Description            |
| ------ | -------------------------- | ---------------------- |
| GET    | `/api/auth/chzzk`          | Initiate Chzzk OAuth   |
| GET    | `/api/auth/chzzk/callback` | OAuth callback handler |
| POST   | `/api/auth/logout`         | Clear session          |

### 7.2 Viewer Linking

| Method | Route                     | Description                                                                 |
| ------ | ------------------------- | --------------------------------------------------------------------------- |
| POST   | `/api/user/link-varchive` | Submit V-ARCHIVE token (validates via V-ARCHIVE API)                        |
| POST   | `/api/user/sync-djclass`  | Manual DJ CLASS sync (fetches from V-ARCHIVE immediately)                   |
| GET    | `/api/user/me`            | Get current user's info (nickname, V-ARCHIVE link status, current DJ CLASS) |

### 7.3 Streamer

| Method | Route          | Description                                                                                |
| ------ | -------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/channel` | Get current user's channel info, widget URL, and connection status (creates if not exists) |

### 7.4 Widget

| Method | Route                                          | Description                                                       |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/widget/[channelId]`                          | OBS Browser Source page (public, no auth)                         |
| GET    | `/api/widget/dj-class?chzzkId=&chzzkNickname=` | Lookup DJ CLASS for a given Chzzk user (internal, used by widget) |

---

## 8. Cron Worker

### 8.1 Job: Daily DJ CLASS Sync

**Schedule:** Once per day at 03:00 KST (low-traffic time).

**Steps:**

1. Query all active rows from `varchive_tokens`.
2. For each token:
   - Decrypt the token.
   - Call `GET /api/v2/open-token/user` to get current V-ARCHIVE nickname.
   - If nickname changed, update `varchive_tokens.varchive_nickname`.
   - Try all buttons: 4, 5, 6, 8.
   - Select the button with the highest **DJ POWER** (`djPowerConversion`).
   - Upsert into `dj_classes` table with the selected button.
3. Log successes and failures.
4. Continue on individual failures (don't let one bad token stop the whole batch).

### 8.2 Error Handling

- Individual API failures: Log error, skip user, continue batch.
- Full batch failure: Log error, retry at next scheduled run (03:00 KST next day).

---

## 9. Error Handling

| Scenario                               | Behavior                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| V-ARCHIVE token invalid during linking | Show "조회토큰이 유효하지 않습니다. 다시 확인해주세요."            |
| V-ARCHIVE token invalid during sync    | Log error, skip user, continue batch                               |
| DJ CLASS not found for linked user     | Fallback to `[BEGINNER]` in widget                                 |
| Chzzk OAuth failure                    | Generic error page: "로그인에 실패했습니다. 다시 시도해주세요."    |
| Database connection issue              | Worker retries; web server returns 500 with generic message        |
| Widget can't connect to chat proxy     | Show offline message, auto-reconnect WebSocket (up to 5 retries)   |
| Chzzk token expired                    | Chat proxy disconnects; streamer must re-login via `/link`         |
| No DJ CLASS data (first time)          | Show "BEGINNER" badge; user can click "DJ CLASS 동기화" on `/link` |

---

## 10. Security

- **Token Encryption:** V-ARCHIVE tokens encrypted with AES-256-GCM.
- **Environment Variables:**
  - `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`
  - `VARCHIVE_TOKEN_KEY` (AES-256-GCM encryption key for V-ARCHIVE tokens)
  - `SESSION_SECRET` (HMAC-SHA256 signing key for session cookies)
  - `DATABASE_URL` (SQLite file path)
  - `NEXT_PUBLIC_BASE_URL` (public base URL for OAuth callbacks)
  - No manual sync endpoint — the worker runs autonomously on schedule
- **Session:** HMAC-SHA256 signed `session` httpOnly cookie. The cookie value is `${userId}.${signature}` where signature is derived from `SESSION_SECRET`. This prevents session tampering (users can't forge another user's session by changing the cookie value).
- **Chzzk Token Storage:** Streamer's Chzzk access/refresh tokens are encrypted with AES-256-GCM and stored in the `channels` table. Required for the server-side chat proxy.
- **Widget Badge Mode:** Set via URL query parameter (`?mode=short|threshold|power`). Not stored in database.
- **Widget URL:** Public but unguessable (channel ID is not secret, just obscure).
- **Database Migrations:** Simple migration system using `ALTER TABLE ADD COLUMN` with `columnExists()` checks. Runs automatically on server startup.

---

## 11. Testing Strategy

**Implemented:**

- **Unit Tests:**
  - Token encryption/decryption round-trip (`tests/crypto.test.ts`).
  - Database schema initialization and constraints (`tests/db.test.ts`).
  - DJ CLASS API response parsing and button selection (`tests/varchive.test.ts`).
  - Session cookie signing and tamper resistance (`tests/session.test.ts`).

**Completed via manual testing:**

- OAuth callback flow with real Chzzk credentials.
- V-ARCHIVE token linking and validation.
- Manual DJ CLASS sync (`POST /api/user/sync-djclass`).
- Server-side chat proxy with Socket.IO v2.0.3.
- OBS widget rendering with colored DJ CLASS badges.
- WebSocket relay from Chzzk to widgets.
- Logout and session clearing.

**Still planned:**

- Automated integration tests for OAuth callback flow.
- Daily sync worker execution test.

---

## 12. Deployment

### 12.1 Docker

- **Dockerfile:** Multi-stage build (install → build → runtime).
- **Procfile:**
  ```
  web: npm start
  worker: npm run worker
  ```

### 12.2 Dokku

```bash
# Create app
dokku apps:create chzzk-djclass-overlay

# Set environment variables
dokku config:set chzzk-djclass-overlay CHZZK_CLIENT_ID=xxx CHZZK_CLIENT_SECRET=xxx VARCHIVE_TOKEN_KEY=xxx

# Create volume for SQLite persistence
dokku storage:mount chzzk-djclass-overlay /var/lib/dokku/data/storage/chzzk-djclass-overlay:/app/data

# Deploy
git push dokku main

# Scale worker
dokku ps:scale chzzk-djclass-overlay web=1 worker=1
```

### 12.3 Developer Tooling & Agent Guidelines

**Linting & Formatting:**

- **ESLint:** Next.js + TypeScript flat config (`eslint.config.mjs`) with Prettier integration.
- **Prettier:** Code formatting with `prettier-plugin-tailwindcss` for automatic Tailwind class sorting.
- **Scripts:** `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- All code changes must pass `npm run lint:fix && npm run format` before completion.

**AGENTS.md:**

- A project-level `AGENTS.md` at the repository root serves as the living context guide for AI coding agents.
- It covers: tech stack, shadcn/ui usage rules, Korean UI language policy, directory conventions, architecture constraints (chat proxy, token encryption, widget rendering), API route patterns, testing strategy, environment variables, and deployment notes.
- **Critical rule:** Any change to items documented in `AGENTS.md` (stack, conventions, architecture, tests, linting, env vars, deployment) must be accompanied by an `AGENTS.md` update. Agents are instructed to enforce this.

---

## 13. Out of Scope

- Multiple V-ARCHIVE tokens per user (one per user is sufficient).
- Customizable widget styling (fixed design only).
- Support for other streaming platforms (Twitch, YouTube, etc.).
- Real-time DJ CLASS updates (daily sync is sufficient).
- DJ CLASS history/trends.
- Admin dashboard.

---

## 14. Open Questions

None. All questions resolved during brainstorming.

---

_Spec written: 2026-06-05_  
_Approved by: Hansaem Woo_
