# Widget Feature Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three widget features — viewer-selectable button (4/5/6/8), a streamer auto-vs-viewer selection toggle, and an optional per-message fadeout.

**Architecture:** Store all four buttons' DJ CLASS per user (today only the highest is stored). A pure helper resolves which button to display based on the streamer's mode and the viewer's stored preference; the widget passes its mode to the existing per-message API, which appends the mode to its cache key. All streamer-facing settings remain widget-URL query params (no server-side widget config), matching the existing `mode`/`fontSize` design. Fadeout is a client-only widget behavior driven by one interval.

**Tech Stack:** Next.js 15 (App Router), TypeScript, better-sqlite3 (SQLite), Vitest, Tailwind + shadcn/ui (Radix RadioGroup/Slider), `ws` WebSocket server.

**Spec:** `docs/superpowers/specs/2026-06-08-widget-feature-additions-design.md`

---

## File Structure

**New files:**
- `src/lib/fadeout.ts` — fadeout URL-param bounds + parsing (mirrors `font-size.ts`).
- `src/lib/dj-class-store.ts` — `persistUserDjClasses(db, userId, classes)` DB write helper.
- `src/app/api/user/preferred-button/route.ts` — `POST` to set/clear a viewer's preferred button.
- `tests/dj-class-resolve.test.ts` — `resolveDisplayedClass` + `validatePreferredButton` unit tests.
- `tests/fadeout.test.ts` — `parseFadeout` unit tests.
- `tests/dj-class-store.test.ts` — `persistUserDjClasses` unit tests.
- `tests/cache.test.ts` — cache invalidation unit tests.

**Modified files:**
- `src/lib/dj-class.ts` — add `DjClassRow`, `resolveDisplayedClass`, `validatePreferredButton`.
- `src/lib/db.ts` — new `dj_classes` shape (`UNIQUE(user_id, button)`), Migration 4 (rebuild + `preferred_button` column).
- `src/lib/varchive.ts` — add `getAllDjClasses`; refactor `getHighestDjClass` to reuse it.
- `src/lib/cache.ts` — invalidation clears both `:auto` and `:viewer` cache variants.
- `src/app/api/widget/dj-class/route.ts` — `sel` param, `resolveDisplayedClass`, suffixed cache key.
- `src/app/api/user/sync-djclass/route.ts` — persist all buttons.
- `src/worker/sync-djclass.ts` — persist all buttons.
- `src/app/api/user/me/route.ts` — return `availableButtons` + `preferredButton`.
- `src/components/WidgetPage.tsx` — parse `buttonSel`/`fadeout`, pass `sel`, suffix client cache key, fadeout interval.
- `src/components/ChatMessageRow.tsx` — `createdAt`/`fading` fields, fade CSS.
- `src/components/DashboardPage.tsx` — button-mode card + fadeout card; URL params.
- `src/components/LinkPage.tsx` — viewer button-preference card.
- `tests/worker.test.ts` — update schema setup + multi-row assertions.
- `README.md` — document new URL params + viewer step.

---

## Task 1: `resolveDisplayedClass` pure helper

**Files:**
- Modify: `src/lib/dj-class.ts` (append after `compareClassSortKeys`, around line 158)
- Test: `tests/dj-class-resolve.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/dj-class-resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveDisplayedClass, type DjClassRow } from '../src/lib/dj-class'

const rows: DjClassRow[] = [
  { button: 4, djClass: 'SHOWSTOPPER II', djPowerConversion: 9800 },
  { button: 5, djClass: 'HIGH CLASS I', djPowerConversion: 8400 },
  { button: 8, djClass: 'HEADLINER IV', djPowerConversion: 9400 },
]

describe('resolveDisplayedClass', () => {
  it('auto picks the highest CLASS regardless of button', () => {
    const chosen = resolveDisplayedClass(rows, null, 'auto')
    expect(chosen?.button).toBe(4) // SHOWSTOPPER outranks HEADLINER/HIGH CLASS
  })

  it('viewer picks the preferred button even if not the highest', () => {
    const chosen = resolveDisplayedClass(rows, 8, 'viewer')
    expect(chosen?.button).toBe(8)
  })

  it('viewer falls back to highest when the preferred button has no row', () => {
    const chosen = resolveDisplayedClass(rows, 6, 'viewer')
    expect(chosen?.button).toBe(4)
  })

  it('viewer falls back to highest when no preference is set', () => {
    const chosen = resolveDisplayedClass(rows, null, 'viewer')
    expect(chosen?.button).toBe(4)
  })

  it('returns null for an empty row set', () => {
    expect(resolveDisplayedClass([], 8, 'viewer')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dj-class-resolve.test.ts`
Expected: FAIL — `resolveDisplayedClass` is not exported from `dj-class.ts`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/dj-class.ts`, append after `compareClassSortKeys` (before `getBadgeText`):

```ts
// One stored button's DJ CLASS, in the shape the display resolver needs.
export interface DjClassRow {
  button: number
  djClass: string
  djPowerConversion: number | null
}

// Choose which button's DJ CLASS to display.
// - 'auto' (and every fallback) returns the highest CLASS via the sort key.
// - 'viewer' returns the row matching `preferredButton` when present,
//   otherwise falls back to the highest CLASS.
export function resolveDisplayedClass(
  rows: DjClassRow[],
  preferredButton: number | null,
  sel: 'auto' | 'viewer'
): DjClassRow | null {
  if (rows.length === 0) return null

  if (sel === 'viewer' && preferredButton != null) {
    const match = rows.find((r) => r.button === preferredButton)
    if (match) return match
  }

  return rows.reduce((best, current) =>
    compareClassSortKeys(
      getClassSortKey(
        current.djClass,
        current.djPowerConversion,
        current.button
      ),
      getClassSortKey(best.djClass, best.djPowerConversion, best.button)
    ) > 0
      ? current
      : best
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dj-class-resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class-resolve.test.ts
git commit -m "feat: add resolveDisplayedClass for button selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `fadeout.ts` URL-param parsing

**Files:**
- Create: `src/lib/fadeout.ts`
- Test: `tests/fadeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fadeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseFadeout, FADEOUT_MIN, FADEOUT_MAX } from '../src/lib/fadeout'

describe('parseFadeout', () => {
  it('returns 0 (off) for null/absent', () => {
    expect(parseFadeout(null)).toBe(0)
  })

  it('returns 0 (off) for non-numeric input', () => {
    expect(parseFadeout('abc')).toBe(0)
  })

  it('returns 0 (off) for values below the minimum', () => {
    expect(parseFadeout('4')).toBe(0)
    expect(parseFadeout('0')).toBe(0)
  })

  it('passes through in-range values, rounded', () => {
    expect(parseFadeout('5')).toBe(FADEOUT_MIN)
    expect(parseFadeout('30')).toBe(30)
    expect(parseFadeout('30.6')).toBe(31)
  })

  it('clamps values above the maximum', () => {
    expect(parseFadeout('120')).toBe(FADEOUT_MAX)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fadeout.test.ts`
Expected: FAIL — cannot resolve `../src/lib/fadeout`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/fadeout.ts`:

```ts
// Inactive-chat fadeout bounds and URL parsing.
// `fadeout` is a number of seconds; 0 (or out-of-range-low) means "off".
// Single source of truth shared by the widget read-path and the dashboard.

export const FADEOUT_MIN = 5
export const FADEOUT_MAX = 60
export const FADEOUT_DEFAULT = 15

/**
 * Parse a `fadeout` URL query value into whole seconds.
 * - null/empty/non-numeric/non-finite -> 0 (off)
 * - below FADEOUT_MIN -> 0 (off)
 * - in range -> rounded integer
 * - above FADEOUT_MAX -> FADEOUT_MAX
 */
export function parseFadeout(raw: string | null): number {
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  const rounded = Math.round(parsed)
  if (rounded < FADEOUT_MIN) return 0
  return Math.min(FADEOUT_MAX, rounded)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fadeout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fadeout.ts tests/fadeout.test.ts
git commit -m "feat: add fadeout URL-param parsing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DB schema — multi-button `dj_classes` + `preferred_button`

**Files:**
- Modify: `src/lib/db.ts` (CREATE TABLE at lines 92-101; `runMigrations` at lines 34-61)
- Test: `tests/db.test.ts` (append new `it` blocks)

- [ ] **Step 1: Write the failing tests**

Append these `it` blocks inside the `describe('Database', ...)` in `tests/db.test.ts` (after the existing `'should enforce button CHECK constraint'` test, before the closing `})`):

```ts
  it('allows multiple buttons per user', () => {
    const db = initDb()
    db.prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)').run(
      'multi_user',
      'multi_nick'
    )
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('multi_user') as { id: number }

    const ins = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    expect(() => ins.run(user.id, 4, 'SHOWSTOPPER II')).not.toThrow()
    expect(() => ins.run(user.id, 8, 'HEADLINER IV')).not.toThrow()

    const rows = db
      .prepare('SELECT button FROM dj_classes WHERE user_id = ?')
      .all(user.id) as { button: number }[]
    expect(rows.length).toBe(2)
    db.close()
  })

  it('rejects a duplicate (user_id, button) pair', () => {
    const db = initDb()
    db.prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)').run(
      'dup_user',
      'dup_nick'
    )
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('dup_user') as { id: number }
    const ins = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    ins.run(user.id, 4, 'SHOWSTOPPER II')
    expect(() => ins.run(user.id, 4, 'HEADLINER IV')).toThrow()
    db.close()
  })

  it('adds the preferred_button column to users', () => {
    const db = initDb()
    const cols = db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('users') as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('preferred_button')
    db.close()
  })

  it('migrates a legacy single-row dj_classes table to multi-button', () => {
    // Build the OLD-shape table (user_id UNIQUE) with one row, then run initSchema.
    const legacy = getDb()
    legacy.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chzzk_id TEXT UNIQUE NOT NULL,
        chzzk_nickname TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE dj_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
        dj_class TEXT NOT NULL,
        dj_power_sum REAL,
        max_dj_power REAL,
        dj_power_conversion REAL,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    legacy
      .prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)')
      .run('legacy_user', 'legacy_nick')
    const user = legacy
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('legacy_user') as { id: number }
    legacy
      .prepare(
        'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
      )
      .run(user.id, 4, 'SHOWSTOPPER II')
    legacy.close()

    // Re-open through initDb so migrations run.
    const db = initDb()
    // Existing row preserved
    const preserved = db
      .prepare('SELECT dj_class FROM dj_classes WHERE user_id = ? AND button = 4')
      .get(user.id) as { dj_class: string } | undefined
    expect(preserved?.dj_class).toBe('SHOWSTOPPER II')
    // A second button is now allowed
    expect(() =>
      db
        .prepare(
          'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
        )
        .run(user.id, 8, 'HEADLINER IV')
    ).not.toThrow()
    db.close()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `allows multiple buttons per user` throws on the second insert (old `user_id UNIQUE`), and `preferred_button` column is missing.

- [ ] **Step 3: Update the CREATE TABLE**

In `src/lib/db.ts`, replace the `dj_classes` CREATE TABLE block (lines 92-101) with the new shape (note: `user_id` is no longer `UNIQUE` on its own; a table-level `UNIQUE(user_id, button)` replaces it):

```ts
    CREATE TABLE IF NOT EXISTS dj_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
      dj_class TEXT NOT NULL,
      dj_power_sum REAL,
      max_dj_power REAL,
      dj_power_conversion REAL,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, button)
    );
```

- [ ] **Step 4: Add Migration 4 (rebuild + preferred_button)**

In `src/lib/db.ts`, replace the "Migration 3" comment block (lines 59-60) with this. Add a `djClassesNeedsRebuild` helper above `runMigrations` (next to `columnExists`):

```ts
// True when dj_classes still has the legacy single-column UNIQUE(user_id),
// which blocks storing more than one button per user.
function djClassesNeedsRebuild(db: Database.Database): boolean {
  const indexes = db
    .prepare(`SELECT name FROM pragma_index_list('dj_classes') WHERE "unique" = 1`)
    .all() as { name: string }[]
  for (const idx of indexes) {
    const cols = db
      .prepare(`SELECT name FROM pragma_index_info(?)`)
      .all(idx.name) as { name: string }[]
    if (cols.length === 1 && cols[0].name === 'user_id') return true
  }
  return false
}
```

Then inside `runMigrations`, replace the Migration 3 comment with:

```ts
  // Migration 4: allow multiple buttons per user (2026-06-08).
  // Rebuild dj_classes to drop the legacy column-level UNIQUE(user_id),
  // which SQLite cannot remove in place.
  if (djClassesNeedsRebuild(db)) {
    const rebuild = db.transaction(() => {
      db.exec('ALTER TABLE dj_classes RENAME TO dj_classes_legacy')
      db.exec(`
        CREATE TABLE dj_classes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
          dj_class TEXT NOT NULL,
          dj_power_sum REAL,
          max_dj_power REAL,
          dj_power_conversion REAL,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, button)
        )
      `)
      db.exec(`
        INSERT INTO dj_classes
          (id, user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
        SELECT
          id, user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at
        FROM dj_classes_legacy
      `)
      db.exec('DROP TABLE dj_classes_legacy')
    })
    rebuild()
    console.log('[DB Migration] Rebuilt dj_classes for multi-button support')
  }

  // Migration 5: viewer's preferred button (2026-06-08).
  if (!columnExists(db, 'users', 'preferred_button')) {
    db.exec(`ALTER TABLE users ADD COLUMN preferred_button INTEGER`)
    console.log('[DB Migration] Added preferred_button to users')
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts tests/db.test.ts
git commit -m "feat: store all buttons per user, add preferred_button column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `getAllDjClasses` in varchive.ts

**Files:**
- Modify: `src/lib/varchive.ts` (refactor `getHighestDjClass` at lines 61-97)
- Test: `tests/varchive.test.ts` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/varchive.test.ts` (after the existing `describe('getHighestDjClass', ...)` block). Add `getAllDjClasses` to the import on line 2 so it reads:
`import { getHighestDjClass, getAllDjClasses } from '../src/lib/varchive'`

```ts
describe('getAllDjClasses', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('returns one entry per button that has a record', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('SHOWSTOPPER II', 9800)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 8400)) // 5B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HEADLINER IV', 9400)) // 8B

    const result = await getAllDjClasses('testuser')
    expect(result.map((r) => r.button).sort((a, b) => a - b)).toEqual([4, 5, 8])
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns an empty array when all buttons fail', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Not found'))
    const result = await getAllDjClasses('testuser')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/varchive.test.ts`
Expected: FAIL — `getAllDjClasses` is not exported.

- [ ] **Step 3: Refactor varchive.ts**

In `src/lib/varchive.ts`, replace the entire `getHighestDjClass` function (lines 61-97) with `getAllDjClasses` plus a slimmed `getHighestDjClass` that reuses it:

```ts
export async function getAllDjClasses(
  nickname: string
): Promise<Array<VarchiveDjClass & { button: number }>> {
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

  return settled.filter(
    (r): r is VarchiveDjClass & { button: number } => r !== null
  )
}

export async function getHighestDjClass(
  nickname: string
): Promise<(VarchiveDjClass & { button: number }) | null> {
  const results = await getAllDjClasses(nickname)
  if (results.length === 0) return null

  return results.reduce((best, current) =>
    compareClassSortKeys(
      getClassSortKey(
        current.djClass,
        current.djPowerConversion,
        current.button
      ),
      getClassSortKey(best.djClass, best.djPowerConversion, best.button)
    ) > 0
      ? current
      : best
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/varchive.test.ts`
Expected: PASS — existing `getHighestDjClass` tests still pass, plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/varchive.ts tests/varchive.test.ts
git commit -m "feat: add getAllDjClasses, reuse it in getHighestDjClass

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `dj-class-store.ts` — persist all buttons

**Files:**
- Create: `src/lib/dj-class-store.ts`
- Test: `tests/dj-class-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dj-class-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb } from '../src/lib/db'
import { persistUserDjClasses } from '../src/lib/dj-class-store'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/store-test.db'

function makeUser(): number {
  const db = initDb()
  db.prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)').run(
    'store_user',
    'store_nick'
  )
  const user = db
    .prepare('SELECT id FROM users WHERE chzzk_id = ?')
    .get('store_user') as { id: number }
  db.close()
  return user.id
}

function buttons(userId: number): number[] {
  const db = initDb()
  const rows = db
    .prepare('SELECT button FROM dj_classes WHERE user_id = ? ORDER BY button')
    .all(userId) as { button: number }[]
  db.close()
  return rows.map((r) => r.button)
}

describe('persistUserDjClasses', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DB_PATH
    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  it('inserts one row per provided button', () => {
    const userId = makeUser()
    const db = initDb()
    persistUserDjClasses(db, userId, [
      { button: 4, djClass: 'SHOWSTOPPER II', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 9800 },
      { button: 8, djClass: 'HEADLINER IV', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 9400 },
    ])
    db.close()
    expect(buttons(userId)).toEqual([4, 8])
  })

  it('removes buttons no longer present and upserts the rest', () => {
    const userId = makeUser()
    let db = initDb()
    persistUserDjClasses(db, userId, [
      { button: 4, djClass: 'SHOWSTOPPER II', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 9800 },
      { button: 8, djClass: 'HEADLINER IV', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 9400 },
    ])
    db.close()
    db = initDb()
    persistUserDjClasses(db, userId, [
      { button: 5, djClass: 'HIGH CLASS I', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 8400 },
    ])
    db.close()
    expect(buttons(userId)).toEqual([5])
  })

  it('deletes all rows when given an empty list', () => {
    const userId = makeUser()
    let db = initDb()
    persistUserDjClasses(db, userId, [
      { button: 4, djClass: 'SHOWSTOPPER II', djPowerSum: 1, maxDjPower: 2, djPowerConversion: 9800 },
    ])
    db.close()
    db = initDb()
    persistUserDjClasses(db, userId, [])
    db.close()
    expect(buttons(userId)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dj-class-store.test.ts`
Expected: FAIL — cannot resolve `../src/lib/dj-class-store`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dj-class-store.ts`:

```ts
import type Database from 'better-sqlite3'

export interface PersistDjClass {
  button: number
  djClass: string
  djPowerSum: number | null
  maxDjPower: number | null
  djPowerConversion: number | null
}

// Replace a user's stored DJ CLASS rows with `classes`: upsert each provided
// button and delete any stored button not in the new set. An empty list clears
// all of the user's rows. Runs in a single transaction.
export function persistUserDjClasses(
  db: Database.Database,
  userId: number,
  classes: PersistDjClass[]
): void {
  const upsert = db.prepare(`
    INSERT INTO dj_classes
      (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, button) DO UPDATE SET
      dj_class = excluded.dj_class,
      dj_power_sum = excluded.dj_power_sum,
      max_dj_power = excluded.max_dj_power,
      dj_power_conversion = excluded.dj_power_conversion,
      synced_at = excluded.synced_at
  `)
  const deleteAll = db.prepare('DELETE FROM dj_classes WHERE user_id = ?')
  const deleteStale = db.prepare(
    `DELETE FROM dj_classes
     WHERE user_id = ? AND button NOT IN (SELECT value FROM json_each(?))`
  )

  const tx = db.transaction(() => {
    if (classes.length === 0) {
      deleteAll.run(userId)
      return
    }
    for (const c of classes) {
      upsert.run(
        userId,
        c.button,
        c.djClass,
        c.djPowerSum,
        c.maxDjPower,
        c.djPowerConversion
      )
    }
    deleteStale.run(userId, JSON.stringify(classes.map((c) => c.button)))
  })
  tx()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dj-class-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class-store.ts tests/dj-class-store.test.ts
git commit -m "feat: add persistUserDjClasses store helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire sync (worker + manual route) to persist all buttons

**Files:**
- Modify: `src/worker/sync-djclass.ts` (lines 3, 51-82)
- Modify: `src/app/api/user/sync-djclass/route.ts` (lines 5, 64-117)
- Modify: `tests/worker.test.ts` (schema setup lines 24-52; first test assertions lines 119-143)

- [ ] **Step 1: Update the worker test setup and assertions**

In `tests/worker.test.ts`, replace the manual schema `db.exec(...)` block in `beforeEach` (lines 24-52) with a call to `initDb` so the new-shape table (with `UNIQUE(user_id, button)`) is created. Replace:

```ts
    // Initialize schema
    const db = getDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        ...
      );
    `)
    db.close()
```

with:

```ts
    // Initialize schema (new multi-button shape)
    const db = initDb()
    db.close()
```

Update the import on line 3 to pull in `initDb`:

```ts
import { getDb, initDb } from '../src/lib/db'
```

Then update the first test's DB-state assertions (lines 125-143) to expect three persisted rows (4B, 5B, 8B; 6B failed) with 8B as the highest CLASS:

```ts
    // Verify DB state: all three successful buttons are stored
    const db2 = getDb()
    const rows = db2
      .prepare('SELECT button FROM dj_classes WHERE user_id = ? ORDER BY button')
      .all(user.id) as { button: number }[]
    const eight = db2
      .prepare('SELECT dj_class, dj_power_conversion FROM dj_classes WHERE user_id = ? AND button = 8')
      .get(user.id) as { dj_class: string; dj_power_conversion: number }
    db2.close()

    expect(rows.map((r) => r.button)).toEqual([4, 5, 8])
    expect(eight.dj_class).toBe('HIGH CLASS I')
    expect(eight.dj_power_conversion).toBe(6000)
```

- [ ] **Step 2: Run the worker test to verify it fails**

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL — the worker still stores only the single highest row, so `rows.map(...)` is `[8]`, not `[4, 5, 8]`.

- [ ] **Step 3: Update the worker implementation**

In `src/worker/sync-djclass.ts`, update the import on line 3:

```ts
import { lookupUser, getAllDjClasses } from '../lib/varchive'
import { persistUserDjClasses } from '../lib/dj-class-store'
```

Replace the DJ CLASS fetch + write block (lines 51-82, from `// Fetch highest DJ CLASS` through the `else { ... } success++` branch) with:

```ts
        // Fetch all buttons that have a record and persist them.
        const all = await getAllDjClasses(userInfo.nickname)
        persistUserDjClasses(
          db,
          token.user_id,
          all.map((c) => ({
            button: c.button,
            djClass: c.djClass,
            djPowerSum: c.djPowerSum,
            maxDjPower: c.maxDjPower,
            djPowerConversion: c.djPowerConversion,
          }))
        )
        success++
```

- [ ] **Step 4: Run the worker test to verify it passes**

Run: `npx vitest run tests/worker.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Update the manual sync route**

In `src/app/api/user/sync-djclass/route.ts`, update the import on line 5:

```ts
import { lookupUser, getAllDjClasses } from '@/lib/varchive'
import { persistUserDjClasses } from '@/lib/dj-class-store'
import { resolveDisplayedClass } from '@/lib/dj-class'
```

Replace the fetch + write block (lines 64-94, from `// Fetch highest DJ CLASS` through the `else { ... }` that deletes) and the response block (lines 109-117) so the route persists all buttons and reports the highest:

```ts
    // Fetch all buttons that have a record and persist them.
    const all = await getAllDjClasses(userInfo.nickname)
    persistUserDjClasses(
      db,
      userId,
      all.map((c) => ({
        button: c.button,
        djClass: c.djClass,
        djPowerSum: c.djPowerSum,
        maxDjPower: c.maxDjPower,
        djPowerConversion: c.djPowerConversion,
      }))
    )

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_id: string; chzzk_nickname: string } | undefined

    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    // Report the highest CLASS for the link-page status row.
    const highest = resolveDisplayedClass(
      all.map((c) => ({
        button: c.button,
        djClass: c.djClass,
        djPowerConversion: c.djPowerConversion,
      })),
      null,
      'auto'
    )
    const djClass = highest
      ? `${highest.button}B ${highest.djClass}`
      : '4B BEGINNER'
    return NextResponse.json({
      success: true,
      djClass,
      button: highest?.button ?? 4,
      rawClass: highest?.djClass ?? 'BEGINNER',
      djPowerConversion: highest?.djPowerConversion ?? 0,
    })
```

Note: this deletes the now-duplicated `userRow`/`invalidateAllUserCaches` block that previously lived at lines 96-107 — make sure it appears only once (in the replacement above).

- [ ] **Step 6: Verify the route compiles and the suite is green**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/worker/sync-djclass.ts src/app/api/user/sync-djclass/route.ts tests/worker.test.ts
git commit -m "feat: persist all buttons on sync (worker and manual route)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Cache invalidation clears both selection variants

**Files:**
- Modify: `src/lib/cache.ts` (lines 34-40)
- Test: `tests/cache.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setDjClassCache,
  getDjClassFromCache,
  invalidateAllUserCaches,
} from '../src/lib/cache'

const linked = {
  djClass: '4B SHOWSTOPPER II',
  rankName: 'SHOWSTOPPER',
  rankLevel: 'II',
  powerInteger: 9800,
}

describe('cache invalidation', () => {
  beforeEach(() => {
    setDjClassCache('id:abc:auto', linked)
    setDjClassCache('id:abc:viewer', linked)
    setDjClassCache('nick:Nick:auto', linked)
    setDjClassCache('nick:Nick:viewer', linked)
  })

  it('clears both auto and viewer variants for id and nickname', () => {
    invalidateAllUserCaches('abc', 'Nick')
    expect(getDjClassFromCache('id:abc:auto')).toBeUndefined()
    expect(getDjClassFromCache('id:abc:viewer')).toBeUndefined()
    expect(getDjClassFromCache('nick:Nick:auto')).toBeUndefined()
    expect(getDjClassFromCache('nick:Nick:viewer')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL — the old invalidators delete unsuffixed keys, so the `:auto`/`:viewer` entries survive.

- [ ] **Step 3: Update cache.ts**

In `src/lib/cache.ts`, replace `invalidateUserCache` and `invalidateNicknameCache` (lines 34-40) with:

```ts
export function invalidateUserCache(chzzkId: string): void {
  cache.delete(`id:${chzzkId}:auto`)
  cache.delete(`id:${chzzkId}:viewer`)
}

export function invalidateNicknameCache(nickname: string): void {
  cache.delete(`nick:${nickname}:auto`)
  cache.delete(`nick:${nickname}:viewer`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts tests/cache.test.ts
git commit -m "feat: invalidate both auto and viewer cache variants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Widget DJ-CLASS API — `sel` param + resolution

**Files:**
- Modify: `src/app/api/widget/dj-class/route.ts` (full rewrite of the handler body)

This route depends on a DB + LRU cache; the project does not unit-test API routes (selection logic is covered by Task 1). Verify manually.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `src/app/api/widget/dj-class/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { getDjClassFromCache, setDjClassCache } from '@/lib/cache'
import { resolveDisplayedClass, type DjClassRow } from '@/lib/dj-class'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const chzzkId = searchParams.get('chzzkId')
  const chzzkNickname = searchParams.get('chzzkNickname')
  const sel = searchParams.get('sel') === 'viewer' ? 'viewer' : 'auto'

  if (!chzzkId && !chzzkNickname) {
    return NextResponse.json(
      { error: 'chzzkId or chzzkNickname required' },
      { status: 400 }
    )
  }

  const baseKey = chzzkId ? `id:${chzzkId}` : `nick:${chzzkNickname}`
  const cacheKey = `${baseKey}:${sel}`

  // Check cache first
  const cached = getDjClassFromCache(cacheKey)
  if (cached) {
    if ('djClass' in cached) {
      return NextResponse.json({
        djClass: cached.djClass,
        rankName: cached.rankName,
        rankLevel: cached.rankLevel,
        powerInteger: cached.powerInteger,
        source: 'cache',
      })
    }
    if ('unlinked' in cached) {
      return NextResponse.json({ unlinked: true, source: 'cache' })
    }
  }

  const db = initDb()
  try {
    // Try to find user by chzzk_id first, then by nickname
    let userId: number | undefined

    if (chzzkId) {
      const result = db
        .prepare('SELECT id FROM users WHERE chzzk_id = ?')
        .get(chzzkId) as { id: number } | undefined
      if (result) userId = result.id
    }

    if (!userId && chzzkNickname) {
      const result = db
        .prepare('SELECT id FROM users WHERE chzzk_nickname = ?')
        .get(chzzkNickname) as { id: number } | undefined
      if (result) userId = result.id
    }

    if (!userId) {
      setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10s — keep retrying until they link
      return NextResponse.json({ unlinked: true, source: 'db' })
    }

    // Check if user has linked V-ARCHIVE
    const tokenResult = db
      .prepare(
        'SELECT id FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(userId) as { id: number } | undefined

    if (!tokenResult) {
      setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10s — keep retrying until they link
      return NextResponse.json({ unlinked: true, source: 'db' })
    }

    // Load all stored buttons + the viewer's preferred button, then resolve.
    const dbRows = db
      .prepare(
        'SELECT button, dj_class, dj_power_conversion FROM dj_classes WHERE user_id = ?'
      )
      .all(userId) as Array<{
      button: number
      dj_class: string
      dj_power_conversion: number | null
    }>
    const prefRow = db
      .prepare('SELECT preferred_button FROM users WHERE id = ?')
      .get(userId) as { preferred_button: number | null } | undefined

    const rows: DjClassRow[] = dbRows.map((r) => ({
      button: r.button,
      djClass: r.dj_class,
      djPowerConversion: r.dj_power_conversion,
    }))
    const chosen = resolveDisplayedClass(
      rows,
      prefRow?.preferred_button ?? null,
      sel
    )

    if (chosen) {
      const formattedClass = `${chosen.button}B ${chosen.djClass}`
      const powerInteger = chosen.djPowerConversion
        ? Math.floor(chosen.djPowerConversion)
        : null
      const rankMatch = chosen.djClass.match(
        /^(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
      )
      const rankName = rankMatch ? rankMatch[1].trim() : chosen.djClass
      const rankLevel = rankMatch ? rankMatch[2] : null

      setDjClassCache(cacheKey, {
        djClass: formattedClass,
        rankName,
        rankLevel,
        powerInteger,
      })
      return NextResponse.json({
        djClass: formattedClass,
        rankName,
        rankLevel,
        powerInteger,
        source: 'db',
      })
    }

    // Linked but no DJ CLASS data → fallback BEGINNER (treat as 4B 0 point)
    const fallbackData = {
      djClass: '4B BEGINNER',
      rankName: 'BEGINNER',
      rankLevel: null,
      powerInteger: 0,
    }
    setDjClassCache(cacheKey, fallbackData, 0.25) // 15s — sync may finish soon
    return NextResponse.json({ ...fallbackData, source: 'db' })
  } finally {
    db.close()
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Manual verification**

Start the dev server (`npm run dev`) and, for a linked test user, compare:
- `curl 'http://localhost:3000/api/widget/dj-class?chzzkId=<id>&sel=auto'`
- `curl 'http://localhost:3000/api/widget/dj-class?chzzkId=<id>&sel=viewer'`

Expected: `sel=auto` returns the highest button-class; with a `preferred_button` set in the DB, `sel=viewer` returns that button. Both respond with `djClass`/`rankName`/`rankLevel`/`powerInteger`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/widget/dj-class/route.ts
git commit -m "feat: resolve widget class by selection mode with sel param

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `validatePreferredButton` + `/api/user/me` extension

**Files:**
- Modify: `src/lib/dj-class.ts` (append `validatePreferredButton`)
- Modify: `src/app/api/user/me/route.ts` (lines 32-52)
- Test: `tests/dj-class-resolve.test.ts` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/dj-class-resolve.test.ts`, and extend the import on line 2 to:
`import { resolveDisplayedClass, validatePreferredButton, type DjClassRow } from '../src/lib/dj-class'`

```ts
describe('validatePreferredButton', () => {
  it('returns the button when it is available', () => {
    expect(validatePreferredButton(8, [4, 8])).toBe(8)
  })

  it('returns null when clearing (null input)', () => {
    expect(validatePreferredButton(null, [4, 8])).toBeNull()
  })

  it('throws when the button is not available', () => {
    expect(() => validatePreferredButton(6, [4, 8])).toThrow()
  })

  it('throws for non-numeric input', () => {
    expect(() => validatePreferredButton('8', [4, 8])).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dj-class-resolve.test.ts`
Expected: FAIL — `validatePreferredButton` is not exported.

- [ ] **Step 3: Add `validatePreferredButton`**

Append to `src/lib/dj-class.ts`:

```ts
// Validate a requested preferred button against the buttons a viewer actually
// has. Returns the button (to set) or null (to clear). Throws on an invalid or
// unavailable button so callers can answer 400.
export function validatePreferredButton(
  button: unknown,
  availableButtons: number[]
): number | null {
  if (button === null) return null
  if (typeof button === 'number' && availableButtons.includes(button)) {
    return button
  }
  throw new Error('Invalid preferred button')
}
```

- [ ] **Step 4: Extend `/api/user/me`**

In `src/app/api/user/me/route.ts`, replace the `djClassRow` lookup and the `NextResponse.json({...})` (lines 32-52) so it returns the user's available buttons, preferred button, and highest class for the status row:

```ts
    const buttonRows = db
      .prepare(
        'SELECT button, dj_class, dj_power_conversion FROM dj_classes WHERE user_id = ? ORDER BY button'
      )
      .all(userId) as Array<{
      button: number
      dj_class: string
      dj_power_conversion: number | null
    }>

    const prefRow = db
      .prepare('SELECT preferred_button FROM users WHERE id = ?')
      .get(userId) as { preferred_button: number | null } | undefined

    const highest = resolveDisplayedClass(
      buttonRows.map((r) => ({
        button: r.button,
        djClass: r.dj_class,
        djPowerConversion: r.dj_power_conversion,
      })),
      null,
      'auto'
    )
    const powerInteger = highest?.djPowerConversion
      ? Math.floor(highest.djPowerConversion)
      : null

    return NextResponse.json({
      chzzkNickname: user.chzzk_nickname,
      varchiveLinked: !!token,
      varchiveNickname: token?.varchive_nickname || null,
      djClass: highest ? `${highest.button}B ${highest.djClass}` : null,
      powerInteger,
      availableButtons: buttonRows.map((r) => r.button),
      preferredButton: prefRow?.preferred_button ?? null,
    })
```

Add the import near the top of the file:

```ts
import { resolveDisplayedClass } from '@/lib/dj-class'
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/dj-class-resolve.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dj-class.ts src/app/api/user/me/route.ts tests/dj-class-resolve.test.ts
git commit -m "feat: validatePreferredButton and expose buttons via /api/user/me

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `POST /api/user/preferred-button` route

**Files:**
- Create: `src/app/api/user/preferred-button/route.ts`

Validation logic is covered by Task 9; verify the route manually.

- [ ] **Step 1: Write the route**

Create `src/app/api/user/preferred-button/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { initDb } from '@/lib/db'
import { validatePreferredButton } from '@/lib/dj-class'
import { invalidateAllUserCaches } from '@/lib/cache'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const rl = rateLimit(`pref-button:${getClientIp(request)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }

  const sessionCookie = request.cookies.get('session')?.value
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = verifySessionCookie(sessionCookie)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  let body: { button?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const db = initDb()
  try {
    const available = (
      db
        .prepare('SELECT button FROM dj_classes WHERE user_id = ?')
        .all(userId) as { button: number }[]
    ).map((r) => r.button)

    let resolved: number | null
    try {
      resolved = validatePreferredButton(body.button ?? null, available)
    } catch {
      return NextResponse.json(
        { error: 'Invalid preferred button' },
        { status: 400 }
      )
    }

    db.prepare('UPDATE users SET preferred_button = ? WHERE id = ?').run(
      resolved,
      userId
    )

    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_id: string; chzzk_nickname: string } | undefined
    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    return NextResponse.json({ success: true, preferredButton: resolved })
  } finally {
    db.close()
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Manual verification**

With a logged-in session cookie for a user who has e.g. buttons `[4, 8]`:
- `POST {"button": 8}` → `{ success: true, preferredButton: 8 }`, and `GET /api/user/me` now reports `preferredButton: 8`.
- `POST {"button": 6}` → `400 Invalid preferred button`.
- `POST {"button": null}` → `{ success: true, preferredButton: null }`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/user/preferred-button/route.ts
git commit -m "feat: add preferred-button API route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Widget reads `buttonSel` + passes `sel`, suffixes client cache

**Files:**
- Modify: `src/components/WidgetPage.tsx` (lines 49-72, 152, 175-182, 211-212)

Client React behavior; verify manually.

- [ ] **Step 1: Parse `buttonSel` and `fadeout` on mount**

In `src/components/WidgetPage.tsx`, add an import near the top:

```ts
import { parseFadeout } from '@/lib/fadeout'
```

Add a ref + state alongside the existing ones (near line 61-62):

```ts
  const selRef = useRef<'auto' | 'viewer'>('auto')
  const [fadeoutSec, setFadeoutSec] = useState<number>(0)
```

Update the mount effect that reads URL params (lines 65-72) to also read the two new params:

```ts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    if (mode === 'threshold' || mode === 'power' || mode === 'short') {
      badgeModeRef.current = mode
    }
    selRef.current = params.get('buttonSel') === 'viewer' ? 'viewer' : 'auto'
    setFontSize(parseFontSize(params.get('fontSize')))
    setFadeoutSec(parseFadeout(params.get('fadeout')))
  }, [])
```

- [ ] **Step 2: Include `sel` in the API call and the client cache key**

In `processQueue`, change the cache key (line 152) to include the selection mode. Keep the original "no sender → empty (uncached) key" behavior by only suffixing when a sender key exists:

```ts
        const senderKey = pending.senderId || pending.senderNickname
        const cacheKey = senderKey ? `${senderKey}:${selRef.current}` : ''
```

And add `sel` to the fetch query params (within the `params` builder near lines 175-179):

```ts
            const params = new URLSearchParams()
            if (pending.senderId) params.append('chzzkId', pending.senderId)
            if (pending.senderNickname)
              params.append('chzzkNickname', pending.senderNickname)
            params.append('sel', selRef.current)
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Manual verification**

Open the widget with `?buttonSel=viewer` for a channel with a linked chatter who has a preferred button set; confirm the badge reflects that button. With `?buttonSel=auto` (or omitted), confirm it shows the highest. (Fadeout is wired in Task 12.)

- [ ] **Step 5: Commit**

```bash
git add src/components/WidgetPage.tsx
git commit -m "feat: widget passes selection mode via buttonSel URL param

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Per-message fadeout rendering

**Files:**
- Modify: `src/components/ChatMessageRow.tsx` (interface lines 4-12; wrapper className lines 23-28)
- Modify: `src/components/WidgetPage.tsx` (message creation ~line 216-224; add fadeout effect)

Client React behavior; verify manually.

- [ ] **Step 1: Add fields + fade CSS to ChatMessageRow**

In `src/components/ChatMessageRow.tsx`, extend the `ChatMessage` interface with two optional fields:

```ts
export interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  text: string
  isUnlinked: boolean
  createdAt?: number
  fading?: boolean
}
```

Replace the wrapping `<div>`'s className (lines 24-28) so a fading message transitions to transparent (the transition duration matches the `FADE_MS` used in WidgetPage):

```tsx
    <div
      className={`break-words transition-opacity duration-500 ${
        message.fading
          ? 'opacity-0'
          : message.isUnlinked
            ? 'opacity-75'
            : 'opacity-100'
      }`}
    >
```

- [ ] **Step 2: Stamp `createdAt` on new widget messages**

In `src/components/WidgetPage.tsx`, set `createdAt` when building `newMessage` (lines 216-224):

```ts
        const newMessage: ChatMessage = {
          id: pending.id,
          djClass: cacheEntry.djClass,
          rankShort: cacheEntry.rankShort,
          rankLevel: cacheEntry.rankLevel,
          powerInteger: cacheEntry.powerInteger,
          text: pending.messageText,
          isUnlinked: cacheEntry.unlinked,
          createdAt: Date.now(),
        }
```

- [ ] **Step 3: Add the fadeout pruning effect**

In `src/components/WidgetPage.tsx`, add this effect just after the existing scroll effect (after lines 245-247):

```ts
  // Per-message fadeout: when enabled, mark aged messages as fading (CSS
  // transitions them out), then drop them once the transition has finished.
  useEffect(() => {
    if (fadeoutSec <= 0) return
    const FADE_MS = 500
    const interval = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        let changed = false
        const next: ChatMessage[] = []
        for (const m of prev) {
          const age = m.createdAt ? now - m.createdAt : 0
          if (m.createdAt && age >= fadeoutSec * 1000 + FADE_MS) {
            changed = true
            continue // remove fully-faded message
          }
          if (m.createdAt && age >= fadeoutSec * 1000 && !m.fading) {
            changed = true
            next.push({ ...m, fading: true })
          } else {
            next.push(m)
          }
        }
        return changed ? next : prev
      })
    }, 250)
    return () => clearInterval(interval)
  }, [fadeoutSec])
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Manual verification**

Open the widget with `?fadeout=5`. Send (or simulate) a few messages; each should fade to transparent ~5s after it appears and then disappear, while newer messages remain. Open with `?fadeout=0` (or omitted) and confirm messages persist as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatMessageRow.tsx src/components/WidgetPage.tsx
git commit -m "feat: per-message fadeout for inactive chat

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Dashboard — button-mode + fadeout cards

**Files:**
- Modify: `src/components/DashboardPage.tsx` (state ~lines 43-46; `getWidgetUrl` lines 65-72; new cards before the preview card ~line 219)

Client React; verify manually.

- [ ] **Step 1: Add state + imports**

In `src/components/DashboardPage.tsx`, extend the fadeout import (line 23-27) and add `RadioGroupItem` + `Label`:

```ts
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
} from '@/lib/font-size'
import { FADEOUT_MIN, FADEOUT_MAX, FADEOUT_DEFAULT } from '@/lib/fadeout'
```

Add state next to the existing `useState`s (after line 46):

```ts
  const [buttonSel, setButtonSel] = useState<'auto' | 'viewer'>('auto')
  const [fadeoutOn, setFadeoutOn] = useState(false)
  const [fadeoutSec, setFadeoutSec] = useState<number>(FADEOUT_DEFAULT)
```

- [ ] **Step 2: Fold the params into `getWidgetUrl`**

Replace `getWidgetUrl` (lines 65-72) with:

```ts
  const getWidgetUrl = (mode?: BadgeMode) => {
    if (!data?.widgetUrl) return ''
    const url = new URL(data.widgetUrl, window.location.origin)
    const m = mode || badgeMode
    url.searchParams.set('mode', m)
    url.searchParams.set('fontSize', String(fontSize))
    if (buttonSel === 'viewer') url.searchParams.set('buttonSel', 'viewer')
    if (fadeoutOn) url.searchParams.set('fadeout', String(fadeoutSec))
    return url.toString()
  }
```

- [ ] **Step 3: Add the two cards**

In `src/components/DashboardPage.tsx`, insert these two `<Card>`s immediately before the "위젯 미리보기" card (before line 219, `<Card>` with `CardTitle>위젯 미리보기`):

```tsx
              <Card>
                <CardHeader>
                  <CardTitle>버튼 선택 모드</CardTitle>
                  <CardDescription>
                    시청자별 DJ CLASS를 어떤 버튼 기준으로 표시할지 선택하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <RadioGroup
                    value={buttonSel}
                    onValueChange={(v) =>
                      setButtonSel(v as 'auto' | 'viewer')
                    }
                    className="space-y-2"
                  >
                    <Label
                      htmlFor="buttonsel-auto"
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3"
                    >
                      <span className="text-sm font-medium">
                        자동 (최고 클래스)
                      </span>
                      <RadioGroupItem id="buttonsel-auto" value="auto" />
                    </Label>
                    <Label
                      htmlFor="buttonsel-viewer"
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3"
                    >
                      <span className="text-sm font-medium">
                        시청자 선택 우선
                      </span>
                      <RadioGroupItem id="buttonsel-viewer" value="viewer" />
                    </Label>
                  </RadioGroup>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>비활성 채팅 페이드아웃</CardTitle>
                  <CardDescription>
                    일정 시간이 지난 메시지를 서서히 사라지게 합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label className="flex items-center justify-between">
                    <span className="text-sm font-medium">페이드아웃 사용</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={fadeoutOn}
                      onChange={(e) => setFadeoutOn(e.target.checked)}
                    />
                  </Label>
                  <Slider
                    aria-label="페이드아웃 시간"
                    min={FADEOUT_MIN}
                    max={FADEOUT_MAX}
                    step={1}
                    value={[fadeoutSec]}
                    onValueChange={(value) => setFadeoutSec(value[0])}
                    disabled={!fadeoutOn}
                  />
                  <p className="text-xs text-muted-foreground">
                    현재:{' '}
                    <span className="font-semibold">
                      {fadeoutOn ? `${fadeoutSec}초` : '꺼짐'}
                    </span>
                  </p>
                </CardContent>
              </Card>
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors. (Note: the existing `import { RadioGroup } from '@/components/ui/radio-group'` line is replaced by the combined import in Step 1 — make sure `RadioGroup` is imported exactly once.)

- [ ] **Step 5: Manual verification**

Load `/dashboard`. Toggle 버튼 선택 모드 to 시청자 선택 우선 → the widget URL gains `&buttonSel=viewer`. Enable 페이드아웃 and move the slider → URL gains `&fadeout=<sec>`; disabling removes it.

- [ ] **Step 6: Commit**

```bash
git add src/components/DashboardPage.tsx
git commit -m "feat: dashboard controls for button mode and fadeout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Link page — viewer button preference

**Files:**
- Modify: `src/components/LinkPage.tsx` (`UserInfo` interface lines 18-24; new card + handler)

Client React; verify manually.

- [ ] **Step 1: Extend `UserInfo` and add preference state**

In `src/components/LinkPage.tsx`, add the two new fields to `UserInfo` (lines 18-24):

```ts
interface UserInfo {
  chzzkNickname: string
  varchiveLinked: boolean
  varchiveNickname: string | null
  djClass: string | null
  powerInteger: number | null
  availableButtons: number[]
  preferredButton: number | null
}
```

Add imports for the radio components near the existing UI imports:

```ts
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
```

- [ ] **Step 2: Add the preference handler**

Inside the `LinkPage` component, add a handler (after `handleSync`):

```ts
  const handlePreferredButton = async (value: string) => {
    const button = value === 'auto' ? null : Number(value)
    // Optimistic update
    setUser((prev) => (prev ? { ...prev, preferredButton: button } : prev))
    try {
      await fetch('/api/user/preferred-button', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ button }),
      })
    } catch {
      // ignore — next /api/user/me load reconciles
    }
  }
```

- [ ] **Step 3: Render the button-preference card**

In `src/components/LinkPage.tsx`, insert this card after the V-ARCHIVE token card's closing `</Card>` (after line 355, before the `<Link href="/">` back-link). It only renders when linked and the viewer has more than one button:

```tsx
          {user?.varchiveLinked &&
            (user?.availableButtons?.length ?? 0) > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">버튼 선택</CardTitle>
                  <CardDescription>
                    위젯에 표시할 버튼을 선택하세요. 스트리머가 &lsquo;시청자 선택
                    우선&rsquo;을 켰을 때 적용됩니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    value={
                      user.preferredButton == null
                        ? 'auto'
                        : String(user.preferredButton)
                    }
                    onValueChange={handlePreferredButton}
                    className="space-y-2"
                  >
                    <Label
                      htmlFor="pref-auto"
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3"
                    >
                      <span className="text-sm font-medium">자동 (최고 클래스)</span>
                      <RadioGroupItem id="pref-auto" value="auto" />
                    </Label>
                    {user.availableButtons.map((b) => (
                      <Label
                        key={b}
                        htmlFor={`pref-${b}`}
                        className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3"
                      >
                        <span className="text-sm font-medium">{b}버튼</span>
                        <RadioGroupItem id={`pref-${b}`} value={String(b)} />
                      </Label>
                    ))}
                  </RadioGroup>
                </CardContent>
              </Card>
            )}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors. (`Label` and `Card*` are already imported in this file.)

- [ ] **Step 5: Manual verification**

As a linked viewer with ≥2 buttons, load `/link`: the 버튼 선택 card appears. Selecting a button POSTs to `/api/user/preferred-button`; reloading shows the choice persisted. A viewer with one button sees no card.

- [ ] **Step 6: Commit**

```bash
git add src/components/LinkPage.tsx
git commit -m "feat: viewer button-preference picker on link page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Docs + full green run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

In `README.md`, under the streamer steps (around the `?mode=`/`?fontSize=` bullets), add documentation for the two new params:

```markdown
8. 버튼 선택 모드를 URL의 `?buttonSel=` 파라미터로 변경할 수 있습니다:
   - `?buttonSel=auto` — 시청자의 가장 높은 DJ CLASS를 표시합니다 (기본값).
   - `?buttonSel=viewer` — 시청자가 연동 페이지에서 고른 버튼의 DJ CLASS를 표시하며, 선택하지 않았으면 가장 높은 클래스로 대체합니다.
9. 비활성 채팅 페이드아웃을 URL의 `?fadeout=` 파라미터(초)로 켤 수 있습니다. 범위는 5~60이며, 값이 없거나 5 미만이면 꺼집니다. 켜면 각 메시지가 표시 후 지정한 시간이 지나면 서서히 사라집니다.
```

Under the viewer steps, add:

```markdown
6. 4B/5B/6B/8B 중 여러 버튼에 기록이 있으면 연동 페이지에서 위젯에 표시할 버튼을 고를 수 있습니다. 스트리머가 '시청자 선택 우선' 모드를 켰을 때 적용됩니다.
```

- [ ] **Step 2: Run the full suite, typecheck, lint, format**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run format:check`
Expected: all tests PASS; no type errors; lint clean; formatting clean. If `format:check` flags files, run `npm run format` and re-check.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document buttonSel and fadeout params, viewer button choice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks:

- [ ] `npm test` green (new files: `dj-class-resolve`, `fadeout`, `dj-class-store`, `cache`; updated: `db`, `varchive`, `worker`).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` and `npm run format:check` clean.
- [ ] Widget `?buttonSel=auto` shows highest class; `?buttonSel=viewer` honors a viewer's stored preferred button and falls back to highest when unset/missing.
- [ ] Widget `?fadeout=5` fades each message ~5s after it appears; `?fadeout=0` keeps the current persistent behavior.
- [ ] `/link` shows the button picker only for viewers with ≥2 buttons; choices persist.
- [ ] `/dashboard` button-mode + fadeout controls produce the correct widget URL params.
- [ ] A daily/manual sync stores all of a viewer's buttons and prunes buttons that disappeared.
```
