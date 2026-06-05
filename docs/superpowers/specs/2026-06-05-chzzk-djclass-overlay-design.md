# Chzzk DJ CLASS OBS Overlay - Design Spec

**Date:** 2026-06-05  
**Topic:** chzzk-djclass-overlay  
**Status:** Approved

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

| Service | Purpose | Technology |
|---------|---------|------------|
| **Web Server** | Serves UI pages, API routes, and OBS widget | Next.js 15+ (App Router), TypeScript |
| **Cron Worker** | Daily DJ CLASS sync from V-ARCHIVE | Node.js + `node-cron` |
| **Database** | Stores users, channels, tokens, cached DJ CLASS | SQLite (file-based) |

### 3.2 Deployment

- **Platform:** Dokku (or similar PaaS).
- **Containers:** 2 containers (web + worker) via Dokku `Procfile`.
- **Persistence:** SQLite file mounted via Dokku volume.
- **Docker:** Single `Dockerfile` with multi-stage build.

### 3.3 External APIs

| API | Purpose | Auth |
|-----|---------|------|
| **Chzzk OAuth** | Authenticate streamers and viewers | OAuth 2.0 |
| **V-ARCHIVE User Lookup** | Validate Open API token, get `userNo` and `nickname` | `Bearer {token}` |
| **V-ARCHIVE DJ CLASS** | Fetch DJ CLASS by nickname and button | None (public) |

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
    button INTEGER NOT NULL,                 -- 4, 5, 6, or 8 (we use the highest)
    dj_class TEXT NOT NULL,                  -- e.g., "HIGH CLASS II"
    dj_power_sum REAL,
    max_dj_power REAL,
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

- Streamer's Chzzk 프로필 정보 display.
- Unique OBS widget URL: `https://<domain>/widget/<channelId>`
- **"URL 복사"** button.
- Simple OBS setup instructions:
  - Browser Source 추가
  - URL 입력
  - Width/Height 설정 (e.g., 400x600)
- Optional: live preview of widget appearance.

### 5.4 OBS Widget (`/widget/[channelId]`)

- **Transparent background** (suitable for OBS overlay).
- Connects directly to Chzzk chat WebSocket.
- Displays incoming chat messages.
- **Message format:** `[DJ CLASS]: message text` (no Chzzk nickname shown).
- Auto-scrolls with smooth animations.

---

## 6. Chat Widget Behavior

### 6.1 DJ Class Display Rules

| Viewer State | Display | Opacity | Badge |
|--------------|---------|---------|-------|
| Linked + Has DJ CLASS | `[DJ CLASS]: message` | 100% | Actual class (e.g., `[HIGH CLASS II]`) |
| Linked + No DJ CLASS (fallback) | `[BEGINNER]: message` | 100% | `[BEGINNER]` |
| Not Linked (no V-ARCHIVE token) | `message` | 25% | None (faded text) |

### 6.2 Examples

```
[HIGH CLASS II]: 안녕하세요!              ← Normal opacity, full badge
[BEGINNER]: 반갑습니다                     ← Normal opacity, BEGINNER badge
(안녕하세요...)                           ← 25% opacity, faded, no badge
```

### 6.3 Technical Flow

1. OBS loads `/widget/[channelId]` as Browser Source.
2. Widget page connects to Chzzk WebSocket chat server directly.
3. On each chat message:
   - Extract sender's identifier (Chzzk user ID if available from WebSocket, otherwise nickname).
   - **Cache Lookup:** Check in-memory LRU cache first (key: `chzzk_id` or `chzzk_nickname`).
     - Cache hit: Use cached DJ CLASS directly.
     - Cache miss: Query local SQLite and populate cache.
   - **SQLite Query (on cache miss):**
     - By `chzzk_id` (preferred): `SELECT d.dj_class, u.id AS user_exists, t.id AS token_exists FROM users u LEFT JOIN dj_classes d ON u.id = d.user_id LEFT JOIN varchive_tokens t ON u.id = t.user_id WHERE u.chzzk_id = ?`.
     - Fallback by `chzzk_nickname`: Same query with `u.chzzk_nickname = ?`.
   - **Cache Population:**
     - If DJ CLASS found → cache result for 5 minutes.
     - If user exists in `varchive_tokens` but no `dj_classes` → cache `"BEGINNER"` for 5 minutes.
     - If user not in `varchive_tokens` → cache `"UNLINKED"` for 1 minute.
   - If DJ CLASS found, prepend `[DJ CLASS]:`.
   - If cached as `"BEGINNER"` → `[BEGINNER]:`.
   - If cached as `"UNLINKED"` → render at 25% opacity with no badge.
   - Note: Chzzk WebSocket payload format to be verified during implementation. User ID lookup is preferred over nickname.

---

## 7. API Routes

### 7.1 Auth

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/auth/chzzk` | Initiate Chzzk OAuth |
| GET | `/api/auth/chzzk/callback` | OAuth callback handler |
| POST | `/api/auth/logout` | Clear session |

### 7.2 Viewer Linking

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/user/link-varchive` | Submit V-ARCHIVE token (validates via V-ARCHIVE API) |

### 7.3 Streamer

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/channel` | Get current user's channel info and widget URL (creates if not exists) |

### 7.4 Widget

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/widget/[channelId]` | OBS Browser Source page (public, no auth) |
| GET | `/api/widget/dj-class?chzzkId=&chzzkNickname=` | Lookup DJ CLASS for a given Chzzk user (internal, used by widget) |

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

| Scenario | Behavior |
|----------|----------|
| V-ARCHIVE token invalid during linking | Show "조회토큰이 유효하지 않습니다. 다시 확인해주세요." |
| V-ARCHIVE token invalid during sync | Log error, skip user, continue batch |
| DJ CLASS not found for linked user | Fallback to `[BEGINNER]` in widget |
| Chzzk OAuth failure | Generic error page: "로그인에 실패했습니다. 다시 시도해주세요." |
| Database connection issue | Worker retries; web server returns 500 with generic message |
| Widget can't connect to Chzzk chat | Show offline message, auto-reconnect WebSocket |

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
- **Widget URL:** Public but unguessable (channel ID is not secret, just obscure).

---

## 11. Testing Strategy

**Implemented:**
- **Unit Tests:**
  - Token encryption/decryption round-trip (`tests/crypto.test.ts`).
  - Database schema initialization and constraints (`tests/db.test.ts`).
  - DJ CLASS API response parsing and button selection (`tests/varchive.test.ts`).
  - Session cookie signing and tamper resistance (`tests/session.test.ts`).

**Planned (not yet implemented):**
- Integration tests for OAuth callback flow.
- Manual testing: OBS widget rendering, real Chzzk chat connection, daily sync job execution.

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

*Spec written: 2026-06-05*  
*Approved by: Hansaem Woo*
