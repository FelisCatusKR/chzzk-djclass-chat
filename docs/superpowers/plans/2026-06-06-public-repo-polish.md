# Public-Repo Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring chzzk-djclass-overlay up to public-repo best practices — CI, community/meta files, a security/code hardening pass (session expiry, random-salt crypto, rate limiting, security headers, leveled logging, fetch timeouts), Docker/Node cleanup, and reconciled Korean docs.

**Architecture:** Incremental changes committed in logical chunks directly on `main` (project unpublished). Code changes follow TDD with Vitest. New shared logic lives in focused `src/lib/` modules (`logger.ts`, `rate-limit.ts`); existing modules (`session.ts`, `crypto.ts`, `chzzk.ts`, `varchive.ts`, `chat-proxy.ts`) are modified in place. Config/docs changes (CI, Dockerfile, README, AGENTS.md) follow the codebase's existing conventions.

**Tech Stack:** Next.js 15 (App Router) + custom `tsx server.ts`, TypeScript, SQLite (better-sqlite3), Vitest, Tailwind/shadcn, Node 24, GitHub Actions.

**Reference spec:** `docs/superpowers/specs/2026-06-06-public-repo-polish-design.md`

**Conventions (apply to every task):**
- Prettier: no semicolons, single quotes, 2-space, `trailingComma: es5`.
- Commit messages use the repo's prefixes: `feat:`, `fix:`, `security:`, `chore:`, `docs:`, `style:`.
- After any code change, before committing: `npm run lint:fix && npm run format`.
- All user-facing strings in Korean.

---

## Task 1: Establish green baseline

**Files:** none (verification only).

- [ ] **Step 1: Install and run all checks**

Run each and record the result (this is the "before" snapshot):

```bash
npm install
npm run lint
npm run format:check
npm test
npm run build
```

Expected: `npm test` → `6 passed (6)`, `27 passed (27)`. `npm run build` succeeds. Lint/format may report issues — note them; they'll be fixed by `lint:fix`/`format` during later tasks. Do NOT proceed if `npm test` or `npm run build` fail for reasons unrelated to known lint formatting.

- [ ] **Step 2: No commit** — baseline only.

---

## Task 2: Bump Node 22 → 24 (engines, .nvmrc, Dockerfile, README)

**Files:**
- Modify: `package.json` (add `engines`)
- Create: `.nvmrc`
- Modify: `Dockerfile:2`, `Dockerfile:10`
- Modify: `README.md:31`

- [ ] **Step 1: Add `engines` to package.json**

Add this top-level field (after `"private": true,`):

```json
  "engines": {
    "node": ">=24"
  },
```

- [ ] **Step 2: Create `.nvmrc`**

```
24
```

- [ ] **Step 3: Bump both Dockerfile stages**

Change `FROM node:22-alpine AS builder` → `FROM node:24-alpine AS builder` and `FROM node:22-alpine AS runner` → `FROM node:24-alpine AS runner`.

- [ ] **Step 4: Update README requirement**

In `README.md`, change the line `- Node.js 22+` to `- Node.js 24+`.

- [ ] **Step 5: Verify build still green**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add package.json .nvmrc Dockerfile README.md
git commit -m "chore: require Node 24 (latest LTS) via engines, .nvmrc, Dockerfile"
```

---

## Task 3: Leveled logger (`src/lib/logger.ts`)

**Files:**
- Create: `src/lib/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveLevel, isLevelEnabled } from '../src/lib/logger'

describe('logger', () => {
  it('uses info level in production, debug otherwise', () => {
    expect(resolveLevel('production')).toBe('info')
    expect(resolveLevel('development')).toBe('debug')
    expect(resolveLevel(undefined)).toBe('debug')
  })

  it('enables a level only when at or above the current threshold', () => {
    expect(isLevelEnabled('debug', 'info')).toBe(false)
    expect(isLevelEnabled('info', 'info')).toBe(true)
    expect(isLevelEnabled('error', 'info')).toBe(true)
    expect(isLevelEnabled('warn', 'error')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/logger.test.ts`
Expected: FAIL — cannot import `resolveLevel`/`isLevelEnabled`.

- [ ] **Step 3: Write the implementation**

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function resolveLevel(nodeEnv: string | undefined): LogLevel {
  return nodeEnv === 'production' ? 'info' : 'debug'
}

export function isLevelEnabled(level: LogLevel, current: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[current]
}

const current = resolveLevel(process.env.NODE_ENV)

export const logger = {
  debug: (...args: unknown[]) => {
    if (isLevelEnabled('debug', current)) console.log(...args)
  },
  info: (...args: unknown[]) => {
    if (isLevelEnabled('info', current)) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    if (isLevelEnabled('warn', current)) console.warn(...args)
  },
  error: (...args: unknown[]) => {
    if (isLevelEnabled('error', current)) console.error(...args)
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run tests/logger.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/logger.ts tests/logger.test.ts
git commit -m "feat: add leveled logger (silent debug in production)"
```

---

## Task 4: Session cookie expiry (H1)

**Files:**
- Modify: `src/lib/session.ts`
- Test: `tests/session.test.ts` (extend)

- [ ] **Step 1: Add failing tests for TTL behavior**

First, add a crypto import at the top of `tests/session.test.ts` (needed by the legacy-cookie test; use an ESM import, not `require`):

```ts
import crypto from 'crypto'
```

Then append these tests inside the `describe('Session', ...)` block. Reset the secret first so they're independent of the existing "different secrets" test ordering:

```ts
  it('rejects an expired session cookie', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const expired = createSessionCookie(42, -10) // expired 10s ago
    expect(verifySessionCookie(expired)).toBeNull()
  })

  it('accepts a cookie within its TTL', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const fresh = createSessionCookie(42, 60)
    expect(verifySessionCookie(fresh)).toBe(42)
  })

  it('rejects a legacy cookie without an expiry segment', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const secret = process.env.SESSION_SECRET
    const sig = crypto.createHmac('sha256', secret).update('42').digest('hex')
    const legacy = `42.${sig}` // old userId.signature format
    expect(verifySessionCookie(legacy)).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run tests/session.test.ts`
Expected: FAIL — `createSessionCookie` doesn't accept a TTL arg / expired cookie still verifies / legacy cookie returns `42`.

- [ ] **Step 3: Rewrite `src/lib/session.ts`**

Replace the entire file with:

```ts
import crypto from 'crypto'

const SEPARATOR = '.'
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days (matches cookie maxAge)

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }
  return secret
}

function signature(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex')
}

// Returns the verified value (everything before the last separator) or null.
function verify(signedValue: string): string | null {
  const idx = signedValue.lastIndexOf(SEPARATOR)
  if (idx === -1) return null

  const value = signedValue.slice(0, idx)
  const provided = signedValue.slice(idx + 1)
  const expected = signature(value)

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(provided, 'hex'),
      Buffer.from(expected, 'hex')
    )
    return ok ? value : null
  } catch {
    // Buffer lengths differ
    return null
  }
}

export function createSessionCookie(
  userId: number,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const value = `${userId}${SEPARATOR}${exp}` // userId.exp
  return `${value}${SEPARATOR}${signature(value)}` // userId.exp.signature
}

export function verifySessionCookie(signedValue: string): number | null {
  const value = verify(signedValue)
  if (!value) return null

  const parts = value.split(SEPARATOR)
  if (parts.length !== 2) return null // reject legacy 1-segment cookies

  const userId = parseInt(parts[0], 10)
  const exp = parseInt(parts[1], 10)
  if (isNaN(userId) || isNaN(exp)) return null
  if (exp < Math.floor(Date.now() / 1000)) return null // expired

  return userId
}
```

- [ ] **Step 4: Run the full session suite**

Run: `node node_modules/vitest/vitest.mjs run tests/session.test.ts`
Expected: PASS — all original tests plus the 3 new ones (7 total).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/session.ts tests/session.test.ts
git commit -m "security: add server-verified expiry to session cookies"
```

---

## Task 5: Random per-record salt in crypto (M1)

**Files:**
- Modify: `src/lib/crypto.ts`
- Test: `tests/crypto.test.ts` (extend)
- Local data reset (one-time)

- [ ] **Step 1: Add a failing test for salt randomness/round-trip**

Append inside `describe('Crypto', ...)` in `tests/crypto.test.ts`:

```ts
  it('round-trips a long token and varies salt per encryption', () => {
    const original = 'varc_'.padEnd(120, 'x')
    const a = encrypt(original)
    const b = encrypt(original)
    // First 16 base64-decoded bytes are the random salt → ciphertexts differ
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe(original)
    expect(decrypt(b)).toBe(original)
  })
```

- [ ] **Step 2: Run to verify current code still passes (regression guard)**

Run: `node node_modules/vitest/vitest.mjs run tests/crypto.test.ts`
Expected: PASS with the OLD implementation too (it already randomizes via IV). This test locks in behavior before the refactor.

- [ ] **Step 3: Rewrite `src/lib/crypto.ts` to use a random per-record salt**

Replace the entire file with:

```ts
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function deriveKey(salt: Buffer): Buffer {
  const key = process.env.VARCHIVE_TOKEN_KEY
  if (!key) {
    throw new Error('VARCHIVE_TOKEN_KEY environment variable is required')
  }
  return crypto.scryptSync(key, salt, KEY_LENGTH)
}

export function encrypt(text: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(salt)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Layout: salt | iv | authTag | ciphertext
  return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64')
}

export function decrypt(encryptedText: string): string {
  const data = Buffer.from(encryptedText, 'base64')
  const salt = data.subarray(0, SALT_LENGTH)
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const authTag = data.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  )
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const key = deriveKey(salt)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8'
  )
}
```

- [ ] **Step 4: Run crypto suite**

Run: `node node_modules/vitest/vitest.mjs run tests/crypto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Reset local DB (stored ciphertext format changed)**

Old tokens in the local DB can no longer be decrypted. Since there is no production data, delete the local SQLite files (confirmed acceptable by the maintainer):

```bash
rm -f data/app.db data/app.db-wal data/app.db-shm
```

Expected: files removed; they are gitignored and will be recreated on next run.

- [ ] **Step 6: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/crypto.ts tests/crypto.test.ts
git commit -m "security: use random per-record salt for token encryption"
```

---

## Task 6: Outbound fetch timeouts (M3)

**Files:**
- Modify: `src/lib/chzzk.ts`
- Modify: `src/lib/varchive.ts`
- Modify: `src/lib/chat-proxy.ts:36-44` and `:66-75`

- [ ] **Step 1: Add a shared timeout constant + apply in `chzzk.ts`**

At the top of `src/lib/chzzk.ts` (after the URL constants), add:

```ts
const FETCH_TIMEOUT_MS = 8000
```

Add `signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),` to each `fetch(...)` options object in `chzzk.ts` (`exchangeCodeForToken`, `refreshAccessToken`, `getUserInfo`). Example for `getUserInfo`:

```ts
  const response = await fetch(`${CHZZK_API_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
```

- [ ] **Step 2: Apply in `varchive.ts`**

At the top of `src/lib/varchive.ts` (after `VARCHIVE_BASE_URL`), add:

```ts
const FETCH_TIMEOUT_MS = 8000
```

Add `signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),` to the options of both `fetch(...)` calls (`lookupUser`, `getDjClass`).

- [ ] **Step 3: Apply in `chat-proxy.ts`**

Add `const FETCH_TIMEOUT_MS = 8000` near the top (after the `connections` map). Add `signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),` to the `fetch(...)` options in `getSessionUrl` and `subscribeToChat`.

- [ ] **Step 4: Verify existing suites still pass**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS — all suites (oauth/varchive/worker tests mock `fetch`, so the `signal` option is ignored by mocks).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/chzzk.ts src/lib/varchive.ts src/lib/chat-proxy.ts
git commit -m "fix: add 8s timeout to outbound Chzzk/V-ARCHIVE fetches"
```

---

## Task 7: Rate-limit module (`src/lib/rate-limit.ts`) (M5)

**Files:**
- Create: `src/lib/rate-limit.ts`
- Test: `tests/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, getClientIp, resetRateLimit } from '../src/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => resetRateLimit())

  it('allows requests up to the limit then blocks', () => {
    const key = 'test:1.2.3.4'
    const now = 1_000_000
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(true)
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(true)
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(false)
  })

  it('resets after the window elapses', () => {
    const key = 'test:1.2.3.4'
    expect(rateLimit(key, 1, 60_000, 1_000_000).allowed).toBe(true)
    expect(rateLimit(key, 1, 60_000, 1_000_000).allowed).toBe(false)
    // window has passed
    expect(rateLimit(key, 1, 60_000, 1_000_000 + 60_001).allowed).toBe(true)
  })

  it('extracts the first IP from x-forwarded-for', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('9.9.9.9')
  })

  it('falls back to "unknown" when no IP headers present', () => {
    expect(getClientIp(new Request('http://x'))).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { LRUCache } from 'lru-cache'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new LRUCache<string, Bucket>({
  max: 10000,
  ttl: 1000 * 60 * 60, // safety cap; real expiry is per-window below
})

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt }, { ttl: windowMs })
    return { allowed: true, remaining: limit - 1, resetAt }
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  existing.count += 1
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  }
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

// Test helper: clear all buckets between tests.
export function resetRateLimit(): void {
  buckets.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run tests/rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/rate-limit.ts tests/rate-limit.test.ts
git commit -m "feat: add in-memory per-IP rate limiter (lru-cache backed)"
```

---

## Task 8: Apply rate limiting to sensitive routes (M5)

**Files:**
- Modify: `src/app/api/auth/chzzk/route.ts`
- Modify: `src/app/api/auth/chzzk/callback/route.ts`
- Modify: `src/app/api/user/link-varchive/route.ts`
- Modify: `src/app/api/user/sync-djclass/route.ts`

Per-route windows: auth init/callback = 10 / 60s; link-varchive = 5 / 60s; sync-djclass = 3 / 60s. The 429 body is Korean.

- [ ] **Step 1: Add the guard to `auth/chzzk/route.ts`**

At the top of the `GET` handler body, before generating `state`:

```ts
import { rateLimit, getClientIp } from '@/lib/rate-limit'
// ...
export async function GET(_request: NextRequest) {
  const rl = rateLimit(`auth:${getClientIp(_request)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
  const state = randomBytes(32).toString('hex')
  // ...unchanged
}
```

(Note: rename `_request` → `request` is optional; the helper accepts it either way. If keeping `_request`, pass `_request` to `getClientIp`.)

- [ ] **Step 2: Add the guard to `auth/chzzk/callback/route.ts`**

At the very start of `GET`, before reading `searchParams`:

```ts
import { rateLimit, getClientIp } from '@/lib/rate-limit'
// ...
  const rl = rateLimit(`authcb:${getClientIp(request)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
```

- [ ] **Step 3: Add the guard to `user/link-varchive/route.ts`**

At the start of `POST`, before reading the session cookie:

```ts
import { rateLimit, getClientIp } from '@/lib/rate-limit'
// ...
  const rl = rateLimit(`link:${getClientIp(request)}`, 5, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
```

- [ ] **Step 4: Add the guard to `user/sync-djclass/route.ts`**

At the start of `POST`, before reading the session cookie:

```ts
import { rateLimit, getClientIp } from '@/lib/rate-limit'
// ...
  const rl = rateLimit(`sync:${getClientIp(request)}`, 3, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
```

- [ ] **Step 5: Verify build + tests**

Run: `npm run build && node node_modules/vitest/vitest.mjs run`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/app/api/auth/chzzk/route.ts src/app/api/auth/chzzk/callback/route.ts src/app/api/user/link-varchive/route.ts src/app/api/user/sync-djclass/route.ts
git commit -m "security: rate-limit auth, link, and sync endpoints per IP"
```

---

## Task 9: Security headers + CSP (M4)

**Files:**
- Modify: `next.config.js`

- [ ] **Step 1: Rewrite `next.config.js` with a `headers()` function**

```js
/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  { key: 'Content-Security-Policy', value: csp },
]

if (isProd) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  })
}

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
```

Note: `output: 'standalone'` is intentionally removed here (Task 13 covers the Docker side). The `script-src 'unsafe-inline' 'unsafe-eval'` is a pragmatic baseline for Next's runtime; nonce-based CSP is a documented future improvement.

- [ ] **Step 2: Build and smoke-test headers locally**

```bash
npm run build
npm run start &
sleep 4
curl -sI http://localhost:3000/ | grep -iE 'content-security-policy|x-frame-options|x-content-type|referrer-policy|permissions-policy'
curl -s http://localhost:3000/widget/test-channel -o /dev/null -w "widget status: %{http_code}\n"
kill %1
```

Expected: the five security headers print; widget route returns 200 (renders). If the widget page errors due to CSP, relax `connect-src`/`script-src` as needed and re-test.

- [ ] **Step 3: Manual OBS/browser sanity check (record result)**

Load `http://localhost:3000/widget/<a real channelId>` in a browser; confirm the widget renders and the WebSocket connects (no CSP violation in console). Record pass/fail in the commit body if anything had to be relaxed.

- [ ] **Step 4: Commit**

```bash
git add next.config.js
git commit -m "security: send CSP and security headers on all routes"
```

---

## Task 10: Route logging through the leveled logger; strip secrets (M2)

**Files:**
- Modify: `src/lib/chat-proxy.ts`
- Modify: `src/lib/chzzk.ts`
- Modify: `src/app/api/auth/chzzk/route.ts`
- Modify: `src/app/api/auth/chzzk/callback/route.ts`

- [ ] **Step 1: Replace secret-bearing logs in `chat-proxy.ts`**

Add `import { logger } from './logger'` at the top. Then:
- Delete the log that prints the session URL prefix (`[ChatProxy] Session URL response...`) and the `Full session URL` log entirely.
- Delete the `Subscribing to chat with sessionKey ...substring(0, 15)` and `Got sessionKey ...substring` logs.
- Convert remaining `console.log(...)` calls to `logger.debug(...)`, `console.error(...)` to `logger.error(...)`, `console.warn` to `logger.warn`. Keep connection lifecycle logs (connect/disconnect/widget counts) at `logger.debug`.

- [ ] **Step 2: Replace logs in `chzzk.ts`**

Add `import { logger } from './logger'`. Change the `console.log('[Chzzk] User info ${status} response:', errorText)` to `logger.error(...)` (it only fires on error). Remove `errorText` from the message if it could contain sensitive data — keep only the status.

- [ ] **Step 3: Replace logs in the two auth routes**

Add `import { logger } from '@/lib/logger'` to both.
- In `auth/chzzk/route.ts`, change `console.log('[OAuth Init] Redirecting to:', url)` → `logger.debug('[OAuth Init] redirecting')` (drop the full URL, which carries clientId/state).
- In `auth/chzzk/callback/route.ts`, change the three `console.log` lines that print `code`/`state`/`storedState` prefixes to a single `logger.debug('[OAuth Callback] received callback')` with no token material. Convert the remaining `console.log`/`console.error` to `logger.debug`/`logger.error`. Keep the `[OAuth Callback] State mismatch` as `logger.warn`.

- [ ] **Step 4: Verify build + tests**

Run: `npm run build && node node_modules/vitest/vitest.mjs run`
Expected: build succeeds; all tests pass (the oauth test asserting a thrown error on 403 still passes — only the log call changed, not the throw).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/chat-proxy.ts src/lib/chzzk.ts src/app/api/auth/chzzk/route.ts src/app/api/auth/chzzk/callback/route.ts
git commit -m "security: route logs through leveled logger and stop logging token material"
```

---

## Task 11: Close DB handle on the callback error path (L1)

**Files:**
- Modify: `src/app/api/auth/chzzk/callback/route.ts`

- [ ] **Step 1: Wrap the DB lifecycle in try/finally**

Currently `db.close()` runs only on the success path (just before `return response`). The outer `catch` returns without closing. Refactor so the DB is closed in a `finally`:

Move `const db = initDb()` so it is declared as `let db: ReturnType<typeof initDb> | null = null` before the `try`, assign `db = initDb()` where it is currently created, remove the success-path `db.close()`, and add a `finally` to the existing `try/catch`:

```ts
  } catch (error) {
    logger.error('[OAuth Callback] Error:', error)
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  } finally {
    if (db) db.close()
  }
```

Ensure the `db` variable is in scope for both the `try` body and the `finally`.

- [ ] **Step 2: Verify build + tests**

Run: `npm run build && node node_modules/vitest/vitest.mjs run`
Expected: build succeeds; tests pass.

- [ ] **Step 3: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/app/api/auth/chzzk/callback/route.ts
git commit -m "fix: always close DB handle in OAuth callback (finally)"
```

---

## Task 12: Parallelize V-ARCHIVE button lookups (L2)

**Files:**
- Modify: `src/lib/varchive.ts` (`getHighestDjClass`)
- Test: `tests/varchive.test.ts` (verify still green)

- [ ] **Step 1: Replace the serial loop with `Promise.all`**

Rewrite `getHighestDjClass` to fetch all four buttons concurrently while still tolerating per-button failures:

```ts
export async function getHighestDjClass(
  nickname: string
): Promise<(VarchiveDjClass & { button: number }) | null> {
  const buttons = [4, 5, 6, 8]

  const settled = await Promise.all(
    buttons.map(async (button) => {
      try {
        const result = await getDjClass(nickname, button)
        if (result.success && result.djClass) {
          return { ...result, button }
        }
      } catch {
        // Skip failed buttons
      }
      return null
    })
  )

  const results = settled.filter(
    (r): r is VarchiveDjClass & { button: number } => r !== null
  )
  if (results.length === 0) return null

  return results.reduce((best, current) =>
    current.djPowerConversion > best.djPowerConversion ? current : best
  )
}
```

- [ ] **Step 2: Run the varchive + worker suites**

Run: `node node_modules/vitest/vitest.mjs run tests/varchive.test.ts tests/worker.test.ts`
Expected: PASS — selection of the highest `djPowerConversion` is unchanged.

- [ ] **Step 3: Lint, format, commit**

```bash
npm run lint:fix && npm run format
git add src/lib/varchive.ts
git commit -m "perf: fetch V-ARCHIVE button DJ classes concurrently"
```

---

## Task 13: Docker / infra cleanup (drop standalone, healthcheck, ignores)

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `.gitignore`

(`next.config.js` no longer has `output: 'standalone'` after Task 9.)

- [ ] **Step 1: Rewrite the Dockerfile to match the tsx runtime**

The runtime is `tsx server.ts` (needed for the WebSocket proxy), so copy `.next`, `src`, `server.ts` rather than the standalone bundle:

```dockerfile
# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/.next ./.next

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
```

- [ ] **Step 2: Review `.dockerignore`**

Ensure it excludes build artifacts and secrets. Set its contents to:

```
node_modules
.next/cache
data
test-data
.env
.env.local
.git
docs
*.log
```

- [ ] **Step 3: Add `test-data/` to `.gitignore`**

Append a line to `.gitignore`:

```
/test-data
```

- [ ] **Step 4: Build the Docker image**

Run: `docker build -t chzzk-djclass-overlay:polish-test .`
Expected: build completes; no reference errors to `.next/standalone`.

(If Docker is unavailable in the environment, record that this step is deferred to the maintainer and verify the Dockerfile has no `standalone` references via `grep -n standalone Dockerfile next.config.js` → no output.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore .gitignore
git commit -m "chore: align Docker image with tsx runtime, add healthcheck"
```

---

## Task 14: Community & meta files

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.editorconfig`
- Rename: `LICENSE.md` → `LICENSE`
- Modify: `README.md` (badges + license link)

- [ ] **Step 1: Create `.editorconfig` (mirrors `.prettierrc`)**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 2: Create `CONTRIBUTING.md` (Korean)**

```markdown
# 기여 가이드

이 프로젝트에 기여해주셔서 감사합니다.

## 개발 환경

- Node.js 24+ (`.nvmrc` 참고)
- SQLite

## 설정

\```bash
npm install
cp .env.example .env   # 값을 채워주세요
npm run dev            # 웹 서버 (WebSocket 포함)
npm run worker         # 동기화 워커 (별도 터미널)
\```

## 커밋 전 필수 확인

\```bash
npm run lint:fix
npm run format
npm test
\```

## 규칙

- 모든 사용자 노출 문구는 **한국어**로 작성합니다.
- UI 컴포넌트는 shadcn/ui를 우선 사용합니다 (`AGENTS.md` 참고).
- 커밋 메시지는 `feat:`, `fix:`, `docs:`, `security:`, `chore:`, `style:` 접두사를 사용합니다.
- 변경이 `AGENTS.md`에 문서화된 규칙에 영향을 주면 해당 문서도 함께 업데이트합니다.

## Pull Request

- 하나의 PR은 하나의 목적에 집중합니다.
- 테스트가 통과하는지 확인 후 PR을 보냅니다.
```

(Replace `\``` ` with real triple backticks when creating the file.)

- [ ] **Step 3: Create `SECURITY.md` (Korean)**

```markdown
# 보안 정책

## 취약점 신고

보안 취약점을 발견하시면 **공개 이슈로 등록하지 말고** 아래 이메일로 비공개 제보해주세요:

- 이메일: <메인테이너 이메일 주소>

제보 시 다음 정보를 포함해주시면 빠른 대응에 도움이 됩니다:

- 취약점 설명과 영향 범위
- 재현 절차
- 가능하다면 PoC(개념 증명)

합당한 시간 내에 회신드리며, 수정 후 제보자에게 알려드립니다.

## 지원 버전

`main` 브랜치의 최신 커밋만 보안 패치를 지원합니다.
```

(The maintainer fills in the contact email.)

- [ ] **Step 4: Create `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: 버그 신고
about: 동작하지 않는 문제를 신고합니다
title: '[Bug] '
labels: bug
---

## 설명

무엇이 잘못되었나요?

## 재현 절차

1.
2.
3.

## 예상 동작

## 실제 동작

## 환경

- 역할: 스트리머 / 시청자
- 브라우저 / OBS 버전:
```

- [ ] **Step 5: Create `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: 기능 제안
about: 새로운 기능이나 개선을 제안합니다
title: '[Feature] '
labels: enhancement
---

## 제안 내용

## 동기 / 배경

## 대안

```

- [ ] **Step 6: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## 변경 사항

## 관련 이슈

## 체크리스트

- [ ] `npm run lint:fix` 실행
- [ ] `npm run format` 실행
- [ ] `npm test` 통과
- [ ] 필요 시 `AGENTS.md` / `README.md` 업데이트
```

- [ ] **Step 7: Rename the license file**

```bash
git mv LICENSE.md LICENSE
```

- [ ] **Step 8: Update README badges + license link**

In `README.md`, directly under the H1 title line (`# Chzzk DJ CLASS 채팅 위젯`), add a badges row:

```markdown
![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)
```

Then change the license link at the bottom from `[MIT License](./LICENSE.md)` to `[MIT License](./LICENSE)`. (The maintainer replaces `<owner>/<repo>` with the real repo path.)

- [ ] **Step 9: Commit**

```bash
git add CONTRIBUTING.md SECURITY.md .github .editorconfig LICENSE README.md
git commit -m "docs: add community/meta files (CONTRIBUTING, SECURITY, templates, editorconfig)"
```

---

## Task 15: CI workflow + Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      VARCHIVE_TOKEN_KEY: ci-dummy-key-32-characters-long!!
      SESSION_SECRET: ci-dummy-session-secret-32-chars!!
      CHZZK_CLIENT_ID: ci-dummy
      CHZZK_CLIENT_SECRET: ci-dummy
      NEXT_PUBLIC_BASE_URL: http://localhost:3000
      DATABASE_URL: ./data/app.db
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: '/'
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      interval: weekly
```

- [ ] **Step 3: Validate the workflow runs the four checks locally**

Run (simulating CI steps): `npm ci && npm run lint && npm run format:check && npm test && npm run build`
Expected: all pass. If `format:check` fails, run `npm run format` and commit the formatting, then re-run.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml
git commit -m "ci: add GitHub Actions (lint, format, test, build) and Dependabot"
```

---

## Task 16: Reconcile docs (README, AGENTS.md, .env.example)

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.env.example` (only if a variable changed — none added by this plan)

- [ ] **Step 1: README accuracy pass**

Verify and update as needed against the post-polish code:
- "기술 스택" section: Node 24, mention security headers + rate limiting in "보안" section.
- Add a concise "프로젝트 구조" section summarizing `src/app`, `src/components`, `src/lib`, `src/worker`, `tests` (mirror the structure in `AGENTS.md` §4, condensed).
- "보안" section: add bullets for "세션 만료(7일)", "요청 속도 제한", "보안 헤더 (CSP 포함)".
- Confirm the API table and env-var list still match the code.

- [ ] **Step 2: AGENTS.md self-update**

Per the AGENTS.md self-update rule, update it for changes this plan introduced:
- §2 tech stack: add Node 24 row.
- §5 architecture: note `src/lib/logger.ts` (leveled logging), `src/lib/rate-limit.ts` (per-IP rate limiting), session cookie expiry, random-salt crypto format, and security headers in `next.config.js`.
- §8: note `.editorconfig`.
- §10 deployment: Node 24 base image, healthcheck.

- [ ] **Step 3: Confirm `.env.example` matches code**

Run: `git grep -n "process.env\." -- src server.ts | grep -oE "process\.env\.[A-Z_]+" | sort -u`
Compare the output against `.env.example`. Every variable the code reads must be present. (Current expectation: no new variables were added by this plan, so no change.) If any are missing, add them with placeholder values.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md .env.example
git commit -m "docs: reconcile README and AGENTS.md with polished codebase"
```

---

## Task 17: Final full verification

**Files:** none (verification).

- [ ] **Step 1: Run the complete check suite**

```bash
npm run lint
npm run format:check
npm test
npm run build
```

Expected: lint clean, format clean, `npm test` shows the original 6 suites plus `logger`, `rate-limit` (and extended session/crypto) all passing, build succeeds.

- [ ] **Step 2: Verify the screenshot still represents the UI**

If the widget rendering changed visually (it should not have), regenerate per the README:

```bash
npm run dev &   # separate terminal
npm run screenshot
```

Expected: `docs/screenshot.png` still accurate. If unchanged, no commit needed.

- [ ] **Step 3: Confirm clean working tree**

Run: `git status`
Expected: clean (all changes committed). Local-only `data/` and `test-data/` remain untracked/ignored.

- [ ] **Step 4 (optional): Run the requesting-code-review skill**

Consider `superpowers:requesting-code-review` before declaring the polish complete.

---

## Self-Review Notes (spec coverage)

- Spec §0 baseline → Task 1. §1 meta files → Task 14. §2 CI → Task 15.
- §3 audit: H1 → Task 4; M1 → Task 5; M2 → Tasks 3+10; M3 → Task 6; M4 → Task 9; M5 → Tasks 7+8; L1 → Task 11; L2 → Task 12; L3/L4 (error-shape/validation) → covered opportunistically in Tasks 8/10 where routes are touched, with Korean messages; no separate task needed since existing routes already validate inputs (link-varchive, sync-djclass) and return `{ error }` shapes.
- §4 infra → Tasks 9 (drop standalone) + 13. §5 docs → Task 16. §6 tests → folded into Tasks 3/4/5/7 (TDD) per task.
- Node 24 bump → Task 2.

**L3/L4 note:** The spec's L3 (consistent error shape) and L4 (input validation) were audited as already largely satisfied — every mutating route returns `{ error: string }` and validates session/inputs. Rather than a speculative refactor (YAGNI), these are handled inline when routes are edited in Tasks 8/10. If a future reviewer wants a shared `apiError()` helper, that is a clean follow-up.
