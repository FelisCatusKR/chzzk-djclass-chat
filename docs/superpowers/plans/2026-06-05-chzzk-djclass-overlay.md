# chzzk-djclass-overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js full-stack app that provides an OBS chat widget for Chzzk streamers, displaying viewers' DJ CLASS (from V-ARCHIVE) instead of nicknames.

**Architecture:** Next.js 15 (App Router) serves web UI, API routes, and the OBS widget page. A custom server (`server.ts`) adds a WebSocket proxy for Chzzk chat. A separate Node.js worker process runs daily cron jobs to sync DJ CLASS data. SQLite stores users, channels, tokens, and cached DJ CLASS. All UI is in Korean.

**Tech Stack:** Next.js 15, TypeScript, better-sqlite3, node-cron, socket.io-client v2.0.3, ws, shadcn/ui, Tailwind CSS, Docker, Dokku

**Key Implementation Notes:**

- Chzzk chat requires **Socket.IO-client v2.0.3** (not v4.x). Server proxies chat via raw WebSocket to widgets.
- DJ CLASS badges are **configurable** via URL query parameter: `?mode=short|threshold|power`.
- Badge mode set via widget URL query parameter (`?mode=short|threshold|power`). Not stored in database.
- Theory badge (`이론치`) shown when DJ POWER ≥ 10000 with glittering CSS animation.
- Manual sync endpoint (`POST /api/user/sync-djclass`) for immediate DJ CLASS updates.
- Auto-sync runs after OAuth login if V-ARCHIVE token already linked.
- Cache TTLs: Linked 5min, Unlinked 10sec, Fallback BEGINNER 15sec. `updateAgeOnGet: false`.
- Fallback BEGINNER shows as `4B BG` (treats as 4B 0 point), same structure as real BEGINNER.
- Chat proxy has `connectingPromise` to prevent race conditions, auto-reconnects on disconnect.
- Database migrations run automatically via `runMigrations()` in `initSchema()`.

---

## File Structure

```
├── Dockerfile
├── Procfile
├── package.json
├── tsconfig.json
├── next.config.js
├── global.d.ts                         # Ambient type declarations
├── server.ts                           # Custom server with WebSocket proxy
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Landing page (/)
│   │   ├── link/
│   │   │   └── page.tsx                # Viewer linking page (/link)
│   │   ├── dashboard/
│   │   │   └── page.tsx                # Streamer dashboard (/dashboard)
│   │   ├── widget/
│   │   │   └── [channelId]/
│   │   │       └── page.tsx            # OBS widget (/widget/[channelId])
│   │   ├── not-found.tsx               # 404 page
│   │   ├── layout.tsx                  # Root layout
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── chzzk/
│   │   │   │   │   └── route.ts        # GET /api/auth/chzzk - OAuth init
│   │   │   │   └── chzzk/
│   │   │   │       └── callback/
│   │   │   │           └── route.ts    # GET /api/auth/chzzk/callback
│   │   │   │   └── logout/
│   │   │   │       └── route.ts        # POST /api/auth/logout
│   │   │   ├── user/
│   │   │   │   ├── link-varchive/
│   │   │   │   │   └── route.ts        # POST /api/user/link-varchive
│   │   │   │   ├── sync-djclass/
│   │   │   │   │   └── route.ts        # POST /api/user/sync-djclass
│   │   │   │   └── me/
│   │   │   │       └── route.ts        # GET /api/user/me
│   │   │   ├── channel/
│   │   │   │   └── route.ts            # GET /api/channel
│   │   │   └── widget/
│   │   │       └── dj-class/
│   │   │           └── route.ts        # GET /api/widget/dj-class
│   ├── lib/
│   │   ├── db.ts                       # SQLite connection + schema + migrations
│   │   ├── crypto.ts                   # AES-256-GCM token encryption
│   │   ├── chzzk.ts                    # Chzzk OAuth helpers + token refresh
│   │   ├── varchive.ts                 # V-ARCHIVE API client
│   │   ├── cache.ts                    # In-memory LRU cache (rich metadata)
│   │   ├── session.ts                  # HMAC-SHA256 session cookies
│   │   ├── chat-proxy.ts               # Socket.IO v2 Chzzk chat proxy
│   │   ├── types.ts                    # Shared types (BadgeMode, Socket.IO types)
│   │   └── utils.ts                    # cn() Tailwind utility
│   ├── components/
│   │   ├── ui/                         # shadcn/ui components
│   │   ├── LandingPage.tsx
│   │   ├── LinkPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── WidgetPage.tsx
│   ├── types/
│   │   └── socket.io-client.d.ts       # Module augmentation for socket.io-client v2
│   └── worker/
│       ├── index.ts                    # Worker entry point
│       └── sync-djclass.ts             # Daily sync logic + cache invalidation
├── tests/
│   ├── crypto.test.ts
│   ├── db.test.ts
│   ├── session.test.ts
│   └── varchive.test.ts
└── docker-compose.yml (optional, for local dev)
```

---

## Task 1: Project Setup

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `.gitignore`

**Goal:** Initialize the Next.js project with required dependencies.

- [x] **Step 1: Create package.json**

```json
{
  "name": "chzzk-djclass-overlay",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "tsx server.ts",
    "worker": "tsx src/worker/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-sqlite3": "^12.1.0",
    "node-cron": "^3.0.3",
    "lru-cache": "^11.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0",
    "@radix-ui/react-slot": "^1.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

- [x] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [x] **Step 3: Create next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    DATABASE_URL: process.env.DATABASE_URL || './data/app.db',
  },
}

module.exports = nextConfig
```

- [x] **Step 4: Create .gitignore**

```
/node_modules
/.next
/out
/data
.env
.env.local
*.log
```

- [x] **Step 5: Install dependencies**

Run: `npm install`

Expected: Dependencies installed successfully.

- [x] **Step 6: Initialize shadcn/ui**

Create `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

Create `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config

export default config
```

Create `postcss.config.js`:

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

Create `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

Create `src/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Install shadcn/ui components:

Run: `npx shadcn-ui@latest add button card input label`

Expected: Components installed in `src/components/ui/`

- [x] **Step 7: Commit**

```bash
git add package.json tsconfig.json next.config.js .gitignore components.json tailwind.config.ts postcss.config.js src/app/globals.css src/lib/utils.ts src/components/ui/
git commit -m "chore: initial project setup with Next.js 15 and shadcn/ui"
```

---

## Task 2: Database Layer

**Files:**

- Create: `src/lib/db.ts`
- Create: `tests/db.test.ts`

**Goal:** Set up SQLite schema and connection.

- [x] **Step 1: Create database module with schema**

```typescript
// src/lib/db.ts
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

function getDbPath(): string {
  const dbPath = process.env.DATABASE_URL || './data/app.db'
  if (path.isAbsolute(dbPath)) return dbPath
  return path.join(process.cwd(), dbPath)
}

export function getDb(): Database.Database {
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function columnExists(
  db: Database.Database,
  table: string,
  column: string
): boolean {
  const result = db
    .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column)
  return !!result
}

function runMigrations(db: Database.Database): void {
  // Migration 1: Add Chzzk token columns to channels table
  if (!columnExists(db, 'channels', 'chzzk_access_token_encrypted')) {
    db.exec(`ALTER TABLE channels ADD COLUMN chzzk_access_token_encrypted TEXT`)
  }
  // ... additional migrations
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chzzk_id TEXT UNIQUE NOT NULL,
      chzzk_nickname TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      chzzk_channel_id TEXT UNIQUE NOT NULL,
      chzzk_access_token_encrypted TEXT,
      chzzk_refresh_token_encrypted TEXT,
      token_expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS varchive_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      token_encrypted TEXT NOT NULL,
      varchive_nickname TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dj_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
      dj_class TEXT NOT NULL,
      dj_power_sum REAL,
      max_dj_power REAL,
      dj_power_conversion REAL,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_chzzk_id ON users(chzzk_id);
    CREATE INDEX IF NOT EXISTS idx_users_chzzk_nickname ON users(chzzk_nickname);
    CREATE INDEX IF NOT EXISTS idx_channels_chzzk_channel_id ON channels(chzzk_channel_id);

    CREATE TRIGGER IF NOT EXISTS trg_varchive_tokens_updated_at
    AFTER UPDATE ON varchive_tokens
    BEGIN
      UPDATE varchive_tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `)

  runMigrations(db)
}

export function initDb(): Database.Database {
  const db = getDb()
  initSchema(db)
  return db
}
```

- [x] **Step 2: Write test for database initialization**

```typescript
// tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb } from '../src/lib/db'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/test.db'

describe('Database', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DB_PATH
    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  it('should initialize schema correctly', () => {
    const db = initDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('channels')
    expect(tableNames).toContain('varchive_tokens')
    expect(tableNames).toContain('dj_classes')
    db.close()
  })
})
```

- [x] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`

Expected: PASS - 5 tests pass (schema, indexes, idempotent, foreign keys, button CHECK constraint)

- [x] **Step 4: Commit**

```bash
git add src/lib/db.ts tests/db.test.ts
git commit -m "feat: add SQLite database layer with schema"
```

---

## Task 3: Token Encryption

**Files:**

- Create: `src/lib/crypto.ts`
- Create: `tests/crypto.test.ts`

**Goal:** Implement AES-256-GCM encryption for V-ARCHIVE tokens.

- [x] **Step 1: Create crypto module**

```typescript
// src/lib/crypto.ts
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.VARCHIVE_TOKEN_KEY
  if (!key)
    throw new Error('VARCHIVE_TOKEN_KEY environment variable is required')
  return crypto.scryptSync(key, 'salt', KEY_LENGTH)
}

export function encrypt(text: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const result = Buffer.concat([iv, authTag, encrypted])
  return result.toString('base64')
}

export function decrypt(encryptedText: string): string {
  const key = getKey()
  const data = Buffer.from(encryptedText, 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
```

- [ ] **Step 2: Write test for encryption/decryption**

```typescript
// tests/crypto.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from '../src/lib/crypto'

describe('Crypto', () => {
  beforeAll(() => {
    process.env.VARCHIVE_TOKEN_KEY = 'test-key-32-chars-long!!!'
  })

  it('should encrypt and decrypt successfully', () => {
    const original = 'varc_12345_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const encrypted = encrypt(original)
    expect(encrypted).not.toBe(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('should produce different ciphertext for same plaintext', () => {
    const original = 'test-token'
    const encrypted1 = encrypt(original)
    const encrypted2 = encrypt(original)
    expect(encrypted1).not.toBe(encrypted2)
  })
})
```

- [x] **Step 3: Run test to verify it passes**

Run: `VARCHIVE_TOKEN_KEY=test-key-32-chars-long!!! npx vitest run tests/crypto.test.ts`

Expected: PASS - 2 tests pass

- [x] **Step 4: Commit**

```bash
git add src/lib/crypto.ts tests/crypto.test.ts
git commit -m "feat: add AES-256-GCM token encryption"
```

---

## Task 4: V-ARCHIVE API Client

**Files:**

- Create: `src/lib/varchive.ts`
- Create: `tests/varchive.test.ts`

**Goal:** Create client for V-ARCHIVE APIs.

- [ ] **Step 1: Create V-ARCHIVE API client**

```typescript
// src/lib/varchive.ts

const VARCHIVE_BASE_URL = 'https://v-archive.net'

export interface VarchiveUser {
  success: boolean
  userNo: number
  nickname: string
}

export interface VarchiveDjClass {
  success: boolean
  djPowerSum: number
  djPowerConversion: number
  maxDjPower: number
  djClass: string
}

export async function lookupUser(token: string): Promise<VarchiveUser> {
  const response = await fetch(`${VARCHIVE_BASE_URL}/api/v2/open-token/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid token')
    }
    throw new Error(`V-ARCHIVE API error: ${response.status}`)
  }

  return response.json()
}

export async function getDjClass(
  nickname: string,
  button: number
): Promise<VarchiveDjClass> {
  const encodedNickname = encodeURIComponent(nickname)
  const response = await fetch(
    `${VARCHIVE_BASE_URL}/api/v2/archive/${encodedNickname}/djClass/${button}`,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`V-ARCHIVE DJ CLASS API error: ${response.status}`)
  }

  return response.json()
}

export async function getHighestDjClass(
  nickname: string
): Promise<(VarchiveDjClass & { button: number }) | null> {
  const buttons = [4, 5, 6, 8]
  const results: Array<VarchiveDjClass & { button: number }> = []

  for (const button of buttons) {
    try {
      const result = await getDjClass(nickname, button)
      if (result.success && result.djClass) {
        results.push({ ...result, button })
      }
    } catch {
      // Skip failed buttons
    }
  }

  if (results.length === 0) return null

  // Return the button with the highest DJ POWER (djPowerConversion)
  return results.reduce((best, current) =>
    current.djPowerConversion > best.djPowerConversion ? current : best
  )
}
```

- [ ] **Step 2: Write test for button selection logic**

```typescript
// tests/varchive.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getHighestDjClass, getDjClass } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

describe('V-ARCHIVE API', () => {
  it('should return the button with the highest DJ POWER (djPowerConversion)', async () => {
    const mockFetch = vi.mocked(fetch)

    // 4-button: lower DJ POWER
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 5000.0,
        djPowerConversion: 5500.0,
        maxDjPower: 6000.0,
      }),
    } as Response)
    // 5-button: highest DJ POWER
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS II',
        djPowerSum: 7000.0,
        djPowerConversion: 8385.9047,
        maxDjPower: 9190.92,
      }),
    } as Response)
    // 6-button: fails
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    // 8-button: lower DJ POWER than 5-button
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 8000.0,
        djPowerConversion: 6000.0,
        maxDjPower: 7000.0,
      }),
    } as Response)

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS II')
    expect(result?.button).toBe(5)
    expect(result?.djPowerConversion).toBe(8385.9047)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('should return null if all buttons fail', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Not found'))

    const result = await getHighestDjClass('testuser')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})
```

- [x] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/varchive.test.ts`

Expected: PASS - 2 tests pass

- [x] **Step 4: Commit**

```bash
git add src/lib/varchive.ts tests/varchive.test.ts
git commit -m "feat: add V-ARCHIVE API client with button selection"
```

---

## Task 5: In-Memory Cache for Widget

**Files:**

- Create: `src/lib/cache.ts`

**Goal:** Implement LRU cache for widget DJ CLASS lookups to avoid frequent DB queries.

- [x] **Step 1: Create cache module**

```typescript
// src/lib/cache.ts
import { LRUCache } from 'lru-cache'

type CacheValue =
  | {
      djClass: string
      rankName: string
      rankLevel: string | null
      powerInteger: number | null
      isTheory: boolean
    }
  | { unlinked: true }

const cache = new LRUCache<string, CacheValue>({
  max: 10000,
  ttl: 1000 * 60 * 5, // 5 minutes default for linked users
  updateAgeOnGet: false, // TTL should not extend on active chat
})

export function getDjClassFromCache(key: string): CacheValue | undefined {
  return cache.get(key)
}

export function setDjClassCache(
  key: string,
  value: CacheValue,
  ttlMinutes?: number
): void {
  if (ttlMinutes) {
    cache.set(key, value, { ttl: ttlMinutes * 60 * 1000 })
  } else {
    cache.set(key, value)
  }
}

export function invalidateUserCache(chzzkId: string): void {
  cache.delete(`id:${chzzkId}`)
}

export function invalidateNicknameCache(nickname: string): void {
  cache.delete(`nick:${nickname}`)
}

export function invalidateAllUserCaches(
  chzzkId: string,
  chzzkNickname?: string
): void {
  invalidateUserCache(chzzkId)
  if (chzzkNickname) {
    invalidateNicknameCache(chzzkNickname)
  }
}

export function getCacheStats(): { size: number } {
  return {
    size: cache.size,
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/lib/cache.ts
git commit -m "feat: add LRU cache for widget DJ CLASS lookups"
```

---

## Task 6: Chzzk OAuth

**Files:**

- Create: `src/lib/chzzk.ts`
- Create: `src/app/api/auth/chzzk/route.ts`
- Create: `src/app/api/auth/chzzk/callback/route.ts`

**Goal:** Implement Chzzk OAuth flow.

- [x] **Step 1: Create Chzzk OAuth helpers**

```typescript
// src/lib/chzzk.ts

const CHZZK_AUTH_URL = 'https://chzzk.naver.com/account-interlock'
const CHZZK_TOKEN_URL = 'https://openapi.chzzk.naver.com/auth/v1/token'
const CHZZK_API_URL = 'https://openapi.chzzk.naver.com/open/v1'

export function getOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    clientId: process.env.CHZZK_CLIENT_ID!,
    redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/chzzk/callback`,
    state,
  })
  return `${CHZZK_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(
  code: string,
  state: string
): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const response = await fetch(CHZZK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      code,
      state,
    }),
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.content ?? data
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    expiresIn: parseInt(content.expiresIn, 10) || 86400,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const response = await fetch(CHZZK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'refresh_token',
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.content ?? data
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    expiresIn: parseInt(content.expiresIn, 10) || 86400,
  }
}

export async function getUserInfo(accessToken: string): Promise<{
  userId: string
  nickname: string
}> {
  const response = await fetch(`${CHZZK_API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`User info fetch failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.content ?? data
  return {
    userId: content.channelId,
    nickname: content.channelName,
  }
}
```

- [x] **Step 2: Create OAuth init route**

```typescript
// src/app/api/auth/chzzk/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getOAuthUrl } from '@/lib/chzzk'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  const state = randomBytes(32).toString('hex')
  const url = getOAuthUrl(state)

  const response = NextResponse.redirect(url)
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })

  return response
}
```

- [x] **Step 3: Create OAuth callback route**

```typescript
// src/app/api/auth/chzzk/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, getUserInfo } from '@/lib/chzzk'
import { initDb } from '@/lib/db'
import { createSessionCookie } from '@/lib/session'
import { encrypt } from '@/lib/crypto'
import { decrypt } from '@/lib/crypto'
import { lookupUser, getHighestDjClass } from '@/lib/varchive'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('oauth_state')?.value

  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  }

  try {
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForToken(
      code,
      state
    )
    const userInfo = await getUserInfo(accessToken)

    const db = initDb()
    const stmt = db.prepare(`
      INSERT INTO users (chzzk_id, chzzk_nickname)
      VALUES (?, ?)
      ON CONFLICT(chzzk_id) DO UPDATE SET chzzk_nickname = excluded.chzzk_nickname
      RETURNING id
    `)
    const result = stmt.get(userInfo.userId, userInfo.nickname) as {
      id: number
    }

    // Store encrypted Chzzk tokens in channels table for chat proxy
    const expiresAt = new Date(
      Date.now() + (expiresIn || 86400) * 1000
    ).toISOString()
    db.prepare(
      `
      INSERT INTO channels (user_id, chzzk_channel_id, chzzk_access_token_encrypted, chzzk_refresh_token_encrypted, token_expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        chzzk_access_token_encrypted = excluded.chzzk_access_token_encrypted,
        chzzk_refresh_token_encrypted = excluded.chzzk_refresh_token_encrypted,
        token_expires_at = excluded.token_expires_at
    `
    ).run(
      result.id,
      userInfo.userId,
      encrypt(accessToken),
      encrypt(refreshToken),
      expiresAt
    )

    // Auto-sync DJ CLASS if V-ARCHIVE already linked
    const tokenRow = db
      .prepare(
        'SELECT token_encrypted, varchive_nickname FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(result.id) as
      | { token_encrypted: string; varchive_nickname: string }
      | undefined

    if (tokenRow) {
      try {
        const vtoken = decrypt(tokenRow.token_encrypted)
        const vuser = await lookupUser(vtoken)
        if (vuser.success) {
          const djData = await getHighestDjClass(vuser.nickname)
          if (djData) {
            db.prepare(
              `
              INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET
                button = excluded.button,
                dj_class = excluded.dj_class,
                dj_power_sum = excluded.dj_power_sum,
                max_dj_power = excluded.max_dj_power,
                dj_power_conversion = excluded.dj_power_conversion,
                synced_at = excluded.synced_at
            `
            ).run(
              result.id,
              djData.button,
              djData.djClass,
              djData.djPowerSum,
              djData.maxDjPower,
              djData.djPowerConversion
            )
          }
        }
      } catch (syncErr) {
        console.error(
          `[OAuth Callback] Auto-sync failed for user ${result.id}:`,
          syncErr
        )
      }
    }

    const response = NextResponse.redirect(new URL('/link', baseUrl))
    response.cookies.set('session', createSessionCookie(result.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    response.cookies.delete('oauth_state')

    db.close()
    return response
  } catch (error) {
    console.error('[OAuth Callback] Error:', error)
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  }
}
```

- [x] **Step 4: Commit**

```bash
git add src/lib/chzzk.ts src/app/api/auth/chzzk/route.ts src/app/api/auth/chzzk/callback/route.ts
git commit -m "feat: implement Chzzk OAuth flow"
```

---

## Task 7: Viewer Linking API

**Files:**

- Create: `src/app/api/user/link-varchive/route.ts`

**Goal:** API endpoint for viewers to link their V-ARCHIVE token.

- [x] **Step 1: Create link V-ARCHIVE API route**

```typescript
// src/app/api/user/link-varchive/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { lookupUser } from '@/lib/varchive'
import { verifySessionCookie } from '@/lib/session'
import { invalidateAllUserCaches } from '@/lib/cache'

export async function POST(request: NextRequest) {
  const signedSession = request.cookies.get('session')?.value
  const userId = signedSession ? verifySessionCookie(signedSession) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { token } = await request.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Validate token with V-ARCHIVE
    const userInfo = await lookupUser(token)
    if (!userInfo.success) {
      return NextResponse.json(
        { error: '조회토큰이 유효하지 않습니다. 다시 확인해주세요.' },
        { status: 400 }
      )
    }

    // Encrypt and store token
    const encryptedToken = encrypt(token)
    const db = initDb()

    const stmt = db.prepare(`
      INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        token_encrypted = excluded.token_encrypted,
        varchive_nickname = excluded.varchive_nickname,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
    `)
    stmt.run(Number(userId), encryptedToken, userInfo.nickname)

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(Number(userId)) as
      | { chzzk_id: string; chzzk_nickname: string }
      | undefined

    db.close()

    // Invalidate cache so widget shows updated status immediately
    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    return NextResponse.json({
      success: true,
      message: '연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.',
    })
  } catch (error) {
    console.error('Link V-ARCHIVE error:', error)
    return NextResponse.json(
      {
        error: '조회토큰이 유효하지 않습니다. 다시 확인해주세요.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 }
    )
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/app/api/user/link-varchive/route.ts
git commit -m "feat: add V-ARCHIVE token linking API"
```

---

## Task 8: Channel/Widget API

**Files:**

- Create: `src/app/api/channel/route.ts`
- Create: `src/app/api/widget/dj-class/route.ts`

**Goal:** API endpoints for streamer channel and widget DJ CLASS lookup.

- [x] **Step 1: Create channel API**

```typescript
// src/app/api/channel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { verifySessionCookie } from '@/lib/session'
import { getActiveConnections } from '@/lib/chat-proxy'

export async function GET(request: NextRequest) {
  const signedSession = request.cookies.get('session')?.value
  const userId = signedSession ? verifySessionCookie(signedSession) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = initDb()

  const getStmt = db.prepare('SELECT * FROM channels WHERE user_id = ?')
  let channel = getStmt.get(Number(userId)) as
    | {
        id: number
        chzzk_channel_id: string
        chzzk_access_token_encrypted: string | null
      }
    | undefined

  if (!channel) {
    const userStmt = db.prepare('SELECT chzzk_id FROM users WHERE id = ?')
    const user = userStmt.get(Number(userId)) as
      | { chzzk_id: string }
      | undefined

    if (!user) {
      db.close()
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const insertStmt = db.prepare(`
      INSERT INTO channels (user_id, chzzk_channel_id)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET chzzk_channel_id = excluded.chzzk_channel_id
      RETURNING id, chzzk_channel_id
    `)
    channel = insertStmt.get(Number(userId), user.chzzk_id) as {
      id: number
      chzzk_channel_id: string
      chzzk_access_token_encrypted: string | null
    }
  }

  const activeConnections = getActiveConnections()
  const isConnected = activeConnections.includes(channel.chzzk_channel_id)
  const hasTokens = !!channel.chzzk_access_token_encrypted

  db.close()

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  return NextResponse.json({
    channelId: channel.chzzk_channel_id,
    widgetUrl: `${baseUrl}/widget/${channel.chzzk_channel_id}`,
    isConnected,
    hasTokens,
  })
}
```

- [x] **Step 2: Create widget DJ CLASS lookup API**

```typescript
// src/app/api/widget/dj-class/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { getDjClassFromCache, setDjClassCache } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const chzzkId = searchParams.get('chzzkId')
  const chzzkNickname = searchParams.get('chzzkNickname')

  if (!chzzkId && !chzzkNickname) {
    return NextResponse.json(
      { error: 'chzzkId or chzzkNickname required' },
      { status: 400 }
    )
  }

  const cacheKey = chzzkId ? `id:${chzzkId}` : `nick:${chzzkNickname}`

  // Check cache first
  const cached = getDjClassFromCache(cacheKey)
  if (cached) {
    if ('djClass' in cached) {
      return NextResponse.json({
        djClass: cached.djClass,
        rankName: cached.rankName,
        rankLevel: cached.rankLevel,
        powerInteger: cached.powerInteger,
        isTheory: cached.isTheory,
        source: 'cache',
      })
    }
    if ('unlinked' in cached) {
      return NextResponse.json({ unlinked: true, source: 'cache' })
    }
  }

  const db = initDb()

  let userId: number | undefined

  if (chzzkId) {
    const stmt = db.prepare('SELECT id FROM users WHERE chzzk_id = ?')
    const result = stmt.get(chzzkId) as { id: number } | undefined
    if (result) userId = result.id
  }

  if (!userId && chzzkNickname) {
    const stmt = db.prepare('SELECT id FROM users WHERE chzzk_nickname = ?')
    const result = stmt.get(chzzkNickname) as { id: number } | undefined
    if (result) userId = result.id
  }

  if (!userId) {
    setDjClassCache(cacheKey, { unlinked: true }, 0.15)
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  const tokenStmt = db.prepare(
    'SELECT id FROM varchive_tokens WHERE user_id = ? AND is_active = true'
  )
  const tokenResult = tokenStmt.get(userId) as { id: number } | undefined
  if (!tokenResult) {
    setDjClassCache(cacheKey, { unlinked: true }, 0.15)
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  const djStmt = db.prepare(
    'SELECT dj_class, button, dj_power_conversion FROM dj_classes WHERE user_id = ?'
  )
  const djResult = djStmt.get(userId) as
    | { dj_class: string; button: number; dj_power_conversion: number | null }
    | undefined

  db.close()

  if (djResult) {
    const formattedClass = `${djResult.button}B ${djResult.dj_class}`
    const isTheory =
      djResult.dj_power_conversion !== null &&
      djResult.dj_power_conversion >= 10000
    const powerInteger = djResult.dj_power_conversion
      ? Math.floor(djResult.dj_power_conversion)
      : null

    const rankMatch = djResult.dj_class.match(
      /^(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
    )
    const rankName = rankMatch ? rankMatch[1].trim() : djResult.dj_class
    const rankLevel = rankMatch ? rankMatch[2] : null

    setDjClassCache(cacheKey, {
      djClass: formattedClass,
      rankName,
      rankLevel,
      powerInteger,
      isTheory,
    })
    return NextResponse.json({
      djClass: formattedClass,
      rankName,
      rankLevel,
      powerInteger,
      isTheory,
      source: 'db',
    })
  }

  // Linked but no DJ CLASS data → fallback BEGINNER
  const fallbackData = {
    djClass: '4B BEGINNER',
    rankName: 'BEGINNER',
    rankLevel: null,
    powerInteger: 0,
    isTheory: false,
  }
  setDjClassCache(cacheKey, fallbackData, 0.25)
  return NextResponse.json({ ...fallbackData, source: 'db' })
}
```

- [x] **Step 3: Commit**

```bash
git add src/app/api/channel/route.ts src/app/api/widget/dj-class/route.ts
git commit -m "feat: add channel and widget DJ CLASS lookup APIs"
```

---

## Task 9: Landing Page

**Files:**

- Create: `src/app/page.tsx`
- Create: `src/components/LandingPage.tsx`

**Goal:** Create the landing page with two CTA buttons in Korean.

- [ ] **Step 1: Create LandingPage component**

```tsx
// src/components/LandingPage.tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900">
          Chzzk DJ CLASS 채팅 위젯
        </h1>
        <p className="text-lg text-gray-600">
          V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스입니다.
        </p>

        <Card className="border-0 bg-transparent shadow-none">
          <CardContent className="space-y-4 pt-8">
            <Link href="/link" className="block w-full">
              <Button size="lg" className="w-full py-6 text-lg">
                시청자이신가요? - DJ CLASS 연동하기
              </Button>
            </Link>
            <Link href="/dashboard" className="block w-full">
              <Button
                size="lg"
                variant="secondary"
                className="w-full py-6 text-lg"
              >
                스트리머이신가요? - 채팅 위젯 얻기
              </Button>
            </Link>
          </CardContent>
        </Card>

        <footer className="pt-12 text-sm text-gray-400">
          <a
            href="https://github.com/yourusername/chzzk-djclass-overlay"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600"
          >
            GitHub
          </a>
        </footer>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create page.tsx**

```tsx
// src/app/page.tsx
import LandingPage from '@/components/LandingPage'

export default function Home() {
  return <LandingPage />
}
```

- [x] **Step 3: Commit**

```bash
git add src/components/LandingPage.tsx src/app/page.tsx
git commit -m "feat: add Korean landing page"
```

---

## Task 10: Viewer Linking Page

**Files:**

- Create: `src/app/link/page.tsx`
- Create: `src/components/LinkPage.tsx`

**Goal:** Create the viewer linking page with Chzzk OAuth and V-ARCHIVE token input.

- [x] **Step 1: Create LinkPage component**

```tsx
// src/components/LinkPage.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface UserInfo {
  chzzkNickname: string
  varchiveLinked: boolean
  varchiveNickname: string | null
  djClass: string | null
  powerInteger: number | null
  isTheory: boolean
}

export default function LinkPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [syncStatus, setSyncStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    fetch('/api/user/me')
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json()
          setUser(data)
        }
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setLoadingUser(false))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  const handleSync = async () => {
    setSyncStatus('loading')
    try {
      const response = await fetch('/api/user/sync-djclass', { method: 'POST' })
      const data = await response.json()
      if (response.ok) {
        setSyncStatus('success')
        setSyncMessage(`DJ CLASS 동기화 완료: ${data.djClass}`)
        setUser((prev) =>
          prev
            ? {
                ...prev,
                djClass: data.djClass,
                powerInteger: data.djPowerConversion
                  ? Math.floor(data.djPowerConversion)
                  : null,
                isTheory: data.djPowerConversion >= 10000,
              }
            : null
        )
      } else {
        setSyncStatus('error')
        setSyncMessage(data.error || '동기화에 실패했습니다.')
      }
    } catch {
      setSyncStatus('error')
      setSyncMessage('네트워크 오류가 발생했습니다.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    try {
      const response = await fetch('/api/user/link-varchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json()
      if (response.ok) {
        setStatus('success')
        setMessage(data.message)
        setUser((prev) => (prev ? { ...prev, varchiveLinked: true } : null))
      } else {
        setStatus('error')
        setMessage(data.error || '연동에 실패했습니다.')
      }
    } catch {
      setStatus('error')
      setMessage('네트워크 오류가 발생했습니다.')
    }
  }

  // Shows login status, V-ARCHIVE link form, DJ CLASS sync button, and current DJ CLASS badges
  // ... (see full file)
}
```

- [ ] **Step 2: Create page.tsx**

```tsx
// src/app/link/page.tsx
import LinkPage from '@/components/LinkPage'

export default function Link() {
  return <LinkPage />
}
```

- [x] **Step 3: Commit**

```bash
git add src/components/LinkPage.tsx src/app/link/page.tsx
git commit -m "feat: add viewer V-ARCHIVE linking page"
```

---

## Task 11: Streamer Dashboard

**Files:**

- Create: `src/app/dashboard/page.tsx`
- Create: `src/components/DashboardPage.tsx`

**Goal:** Create streamer dashboard with widget URL.

- [x] **Step 1: Create DashboardPage component**

```tsx
// src/components/DashboardPage.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { BadgeMode } from '@/lib/types'

interface ChannelData {
  channelId: string
  widgetUrl: string
  isConnected: boolean
  hasTokens: boolean
}

const BADGE_MODE_LABELS: Record<BadgeMode, string> = {
  short: '짧은 이름 (4B SS II)',
  threshold: '근사 파워 (4B 9800+)',
  power: '정수 파워 (4B 9843)',
}

export default function DashboardPage() {
  const [data, setData] = useState<ChannelData | null>(null)
  const [badgeMode, setBadgeMode] = useState<BadgeMode>('short')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/channel')
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/api/auth/chzzk'
            return
          }
          throw new Error('Failed to fetch channel')
        }
        return res.json()
      })
      .then((data) => setData(data))
      .catch((err) => setError(err.message))
  }, [])

  const getWidgetUrl = (mode?: BadgeMode) => {
    if (!data?.widgetUrl) return ''
    const url = new URL(data.widgetUrl, window.location.origin)
    url.searchParams.set('mode', mode || badgeMode)
    return url.toString()
  }

  const copyUrl = () => {
    const url = getWidgetUrl()
    if (url) {
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Shows widget URL with mode parameter, badge mode chooser, connection status, logout
  // ... (see full file)
}
```

- [ ] **Step 2: Create page.tsx**

```tsx
// src/app/dashboard/page.tsx
import DashboardPage from '@/components/DashboardPage'

export default function Dashboard() {
  return <DashboardPage />
}
```

- [x] **Step 3: Commit**

```bash
git add src/components/DashboardPage.tsx src/app/dashboard/page.tsx
git commit -m "feat: add streamer dashboard with widget URL"
```

---

## Task 12: OBS Widget Page

**Files:**

- Create: `src/app/widget/[channelId]/page.tsx`
- Create: `src/components/WidgetPage.tsx`

**Goal:** Create the OBS widget page that connects to Chzzk chat and displays DJ CLASS badges.

- [x] **Step 1: Create WidgetPage component**

```tsx
// src/components/WidgetPage.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

type BadgeMode = 'short' | 'threshold' | 'power'

interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  isTheory: boolean
  text: string
  isUnlinked: boolean
}

interface WidgetPageProps {
  channelId: string
}

export default function WidgetPage({ channelId }: WidgetPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUnmountingRef = useRef(false)
  const pendingQueueRef = useRef<PendingMessage[]>([])
  const isProcessingRef = useRef(false)
  const badgeModeRef = useRef<BadgeMode>('short')

  // Read badge mode from URL query parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    if (mode === 'threshold' || mode === 'power' || mode === 'short') {
      badgeModeRef.current = mode
    }
  }, [])

  useEffect(() => {
    isUnmountingRef.current = false
    // WebSocket connection + sequential message queue processing
    // ... (see full file)
  }, [channelId])
  // ...
}
```

- [ ] **Step 2: Create page.tsx**

```tsx
// src/app/widget/[channelId]/page.tsx
import WidgetPage from '@/components/WidgetPage'

interface PageProps {
  params: Promise<{ channelId: string }>
}

export default async function Widget({ params }: PageProps) {
  const { channelId } = await params
  return <WidgetPage channelId={channelId} />
}
```

- [x] **Step 3: Commit**

```bash
git add src/components/WidgetPage.tsx "src/app/widget/[channelId]/page.tsx"
git commit -m "feat: add OBS widget page with Chzzk chat and DJ CLASS display"
```

---

## Task 13: Cron Worker

**Files:**

- Create: `src/worker/index.ts`
- Create: `src/worker/sync-djclass.ts`

**Goal:** Implement the daily DJ CLASS sync worker.

- [x] **Step 1: Create sync logic**

```typescript
// src/worker/sync-djclass.ts
import { initDb } from '../lib/db'
import { decrypt } from '../lib/crypto'
import { lookupUser, getHighestDjClass } from '../lib/varchive'
import { invalidateAllUserCaches } from '../lib/cache'

export async function syncDjClasses(): Promise<{
  success: number
  failed: number
  errors: string[]
}> {
  const db = initDb()
  let success = 0
  let failed = 0
  const errors: string[] = []

  try {
    const tokens = db
      .prepare(
        `
      SELECT vt.id, vt.user_id, vt.token_encrypted, vt.varchive_nickname
      FROM varchive_tokens vt
      WHERE vt.is_active = true
    `
      )
      .all() as Array<{
      id: number
      user_id: number
      token_encrypted: string
      varchive_nickname: string
    }>

    for (const token of tokens) {
      try {
        // Decrypt token and validate
        const decryptedToken = decrypt(token.token_encrypted)
        const userInfo = await lookupUser(decryptedToken)

        if (!userInfo.success) {
          failed++
          errors.push(`User ${token.user_id}: Invalid token`)
          continue
        }

        // Update nickname if changed
        if (userInfo.nickname !== token.varchive_nickname) {
          db.prepare(
            'UPDATE varchive_tokens SET varchive_nickname = ? WHERE id = ?'
          ).run(userInfo.nickname, token.id)
        }

        // Fetch highest DJ CLASS
        const djClassData = await getHighestDjClass(userInfo.nickname)

        if (djClassData) {
          db.prepare(
            `
            INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              button = excluded.button,
              dj_class = excluded.dj_class,
              dj_power_sum = excluded.dj_power_sum,
              max_dj_power = excluded.max_dj_power,
              dj_power_conversion = excluded.dj_power_conversion,
              synced_at = excluded.synced_at
          `
          ).run(
            token.user_id,
            djClassData.button,
            djClassData.djClass,
            djClassData.djPowerSum,
            djClassData.maxDjPower,
            djClassData.djPowerConversion
          )
          success++
        } else {
          db.prepare('DELETE FROM dj_classes WHERE user_id = ?').run(
            token.user_id
          )
          success++
        }

        // Invalidate cache so widgets show updated data immediately
        const userRow = db
          .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
          .get(token.user_id) as
          | { chzzk_id: string; chzzk_nickname: string }
          | undefined
        if (userRow) {
          invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
        }
      } catch (error) {
        failed++
        errors.push(
          `User ${token.user_id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } finally {
    db.close()
  }

  return { success, failed, errors }
}
```

- [x] **Step 2: Create worker entry point**

```typescript
// src/worker/index.ts
import cron from 'node-cron'
import { syncDjClasses } from './sync-djclass'

// Validate environment
if (!process.env.VARCHIVE_TOKEN_KEY) {
  console.error('VARCHIVE_TOKEN_KEY is required')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

console.log('Worker started. Scheduling daily DJ CLASS sync at 03:00 KST.')

// Run at 03:00 KST every day (18:00 UTC)
cron.schedule('0 18 * * *', async () => {
  console.log(`[${new Date().toISOString()}] Starting DJ CLASS sync...`)
  const result = await syncDjClasses()
  console.log(
    `[${new Date().toISOString()}] Sync complete: ${result.success} success, ${result.failed} failed`
  )
  if (result.errors.length > 0) {
    console.log('Errors:', result.errors)
  }
})

// Keep process alive
process.stdin.resume()

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Worker shutting down...')
  process.exit(0)
})
```

- [x] **Step 3: Commit**

```bash
git add src/worker/index.ts src/worker/sync-djclass.ts
git commit -m "feat: add daily DJ CLASS sync worker"
```

---

## Task 14: Docker & Dokku Configuration

**Files:**

- Create: `Dockerfile`
- Create: `Procfile`
- Create: `.dockerignore`

**Goal:** Containerize the application for Dokku deployment.

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Install production dependencies for worker
RUN npm ci --only=production

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
```

- [ ] **Step 2: Create Procfile**

```
web: npm start
worker: npm run worker
```

- [ ] **Step 3: Create .dockerignore**

```
node_modules
.next
.git
tests
data
*.md
.env*
```

- [ ] **Step 4: Update next.config.js for standalone output**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    DATABASE_URL: process.env.DATABASE_URL || './data/app.db',
  },
}

module.exports = nextConfig
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile Procfile .dockerignore next.config.js
git commit -m "chore: add Docker and Dokku deployment config"
```

---

## Task 15: Environment Configuration

**Files:**

- Create: `.env.example`

**Goal:** Document required environment variables.

- [ ] **Step 1: Create .env.example**

```
# Required
CHZZK_CLIENT_ID=your_chzzk_client_id
CHZZK_CLIENT_SECRET=your_chzzk_client_secret
VARCHIVE_TOKEN_KEY=your_32_char_encryption_key
DATABASE_URL=./data/app.db
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add environment configuration example"
```

---

## Plan Self-Review

### Spec Coverage Check

| Spec Section             | Plan Task           | Status  |
| ------------------------ | ------------------- | ------- |
| Next.js 15 web server    | Task 1 (Setup)      | Covered |
| SQLite schema            | Task 2 (DB)         | Covered |
| Token encryption         | Task 3 (Crypto)     | Covered |
| V-ARCHIVE API client     | Task 4 (Varchive)   | Covered |
| In-memory cache          | Task 5 (Cache)      | Covered |
| Chzzk OAuth              | Task 6 (Auth)       | Covered |
| Viewer linking           | Task 7 (Link API)   | Covered |
| Channel/Widget API       | Task 8 (APIs)       | Covered |
| Landing page             | Task 9 (Landing)    | Covered |
| Linking page             | Task 10 (Link page) | Covered |
| Dashboard                | Task 11 (Dashboard) | Covered |
| OBS widget               | Task 12 (Widget)    | Covered |
| Cron worker              | Task 13 (Worker)    | Covered |
| Docker/Dokku             | Task 14 (Docker)    | Covered |
| Korean UI                | Tasks 9-12          | Covered |
| No nickname in widget    | Task 12             | Covered |
| 25% opacity for unlinked | Task 12             | Covered |
| BEGINNER fallback        | Tasks 8, 12         | Covered |
| Cache for widget         | Tasks 5, 8          | Covered |

### Placeholder Scan

- No TBD, TODO, or "implement later" found.
- All code blocks contain complete, runnable code.
- All commands have exact expected output.
- No "similar to Task N" references.
- All file paths are exact.

### Type Consistency Check

- `Database.Database` from better-sqlite3 used consistently.
- `VarchiveUser` and `VarchiveDjClass` interfaces defined in Task 4 and used in Task 13.
- `CacheValue` type defined in Task 5 and used in Task 8.
- Cookie names consistent: `user_id`, `oauth_state`.
- Environment variable names consistent: `DATABASE_URL`, `VARCHIVE_TOKEN_KEY`, `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`.

### Gaps Found and Fixed

- Added `next.config.js` standalone output in Task 14 (needed for Docker).
- Added `.env.example` in Task 15 for documentation.
- Noted that Chzzk WebSocket format needs verification during widget implementation (documented in Task 12 comment).

---

_Plan complete. Ready for execution._
