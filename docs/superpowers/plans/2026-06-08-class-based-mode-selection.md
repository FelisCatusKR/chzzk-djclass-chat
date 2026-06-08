# Class-based DJ mode selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choose a streamer's displayed button mode during V-ARCHIVE sync by highest DJ CLASS (rank → level → button) instead of highest DJ POWER.

**Architecture:** Add the rank-ordering knowledge (`RANK_ORDER`, `getClassSortKey`, `compareClassSortKeys`) to `src/lib/dj-class.ts`, the existing single source of truth for rank semantics. Swap only the reducer inside `getHighestDjClass()` in `src/lib/varchive.ts` to compare those sort keys. No schema, API, cache, or widget change.

**Tech Stack:** TypeScript, Vitest. Pure functions, no DOM/network in the unit-tested core.

**Spec:** `docs/superpowers/specs/2026-06-08-class-based-mode-selection-design.md`

---

## File Structure

- `src/lib/dj-class.ts` (modify) — add `RANK_ORDER`, `getClassSortKey`, `compareClassSortKeys`. Owns all rank semantics.
- `src/lib/varchive.ts` (modify) — replace the `djPowerConversion` reducer in `getHighestDjClass` with class-key comparison.
- `tests/dj-class.test.ts` (modify) — unit tests for the new pure helpers (primary test target).
- `tests/varchive.test.ts` (modify) — update the existing power-based test to the new behavior; add class-selection, rank-over-power, theory, and all-theory cases.

**Sort key contract:** `getClassSortKey(djClass, djPowerConversion, button)` returns a 3-tuple `[rankOrdinal, levelOrdinal, buttonPref]`, all "bigger is better". `compareClassSortKeys(a, b)` returns `>0` when `a` ranks higher. Lexicographic, descending.

- `rankOrdinal`: `RANK_ORDER.length - 1 - index` (LoD highest); unknown rank → `-1` (below BEGINNER).
- `levelOrdinal`: Theory=5, I=4, II=3, III=2, IV=1, none=0. Theory only when rank is LoD and `isTheoryPower(djPowerConversion)`.
- `buttonPref`: 8→3, 5→2, 6→1, 4→0; unknown button → `-1`.

---

## Task 1: Rank-ordering helpers in `dj-class.ts`

**Files:**
- Modify: `src/lib/dj-class.ts`
- Test: `tests/dj-class.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this import line to the existing import block at the top of `tests/dj-class.test.ts` (extend the existing `from '../src/lib/dj-class'` import):

```ts
import {
  getThreshold,
  getDjClassColor,
  getBadgeText,
  parseRankName,
  isTheoryPower,
  THEORY_POWER_THRESHOLD,
  DJ_CLASS_COLORS,
  SHORT_NAMES,
  RANK_ORDER,
  getClassSortKey,
  compareClassSortKeys,
} from '../src/lib/dj-class'
```

Append these `describe` blocks to the end of `tests/dj-class.test.ts`:

```ts
describe('RANK_ORDER', () => {
  it('runs from LoD (best) to BEGINNER (worst)', () => {
    expect(RANK_ORDER[0]).toBe('THE LORD OF DJMAX')
    expect(RANK_ORDER[RANK_ORDER.length - 1]).toBe('BEGINNER')
  })

  it('has 14 ranks', () => {
    expect(RANK_ORDER).toHaveLength(14)
  })
})

describe('getClassSortKey', () => {
  it('encodes rank, level, and button (SHOWSTOPPER IV on 4-button)', () => {
    // SS index 2 → ordinal 13-2=11; level IV=1; button 4→0
    expect(getClassSortKey('SHOWSTOPPER IV', 9700, 4)).toEqual([11, 1, 0])
  })

  it('ranks a higher rank above a lower rank regardless of level/button', () => {
    const ss = getClassSortKey('SHOWSTOPPER IV', 9700, 4) // [11,1,0]
    const hl = getClassSortKey('HEADLINER I', 9650, 8) // [10,4,3]
    expect(compareClassSortKeys(ss, hl)).toBeGreaterThan(0)
  })

  it('orders levels within a rank (I beats IV)', () => {
    const i = getClassSortKey('SHOWSTOPPER I', 9850, 5) // [11,4,2]
    const iv = getClassSortKey('SHOWSTOPPER IV', 9700, 8) // [11,1,3]
    expect(compareClassSortKeys(i, iv)).toBeGreaterThan(0)
  })

  it('breaks an exact rank+level tie by button 8 > 5 > 6 > 4', () => {
    const b8 = getClassSortKey('HIGH CLASS I', 8000, 8) // [7,4,3]
    const b5 = getClassSortKey('HIGH CLASS I', 8000, 5) // [7,4,2]
    const b6 = getClassSortKey('HIGH CLASS I', 8000, 6) // [7,4,1]
    const b4 = getClassSortKey('HIGH CLASS I', 8000, 4) // [7,4,0]
    expect(compareClassSortKeys(b8, b5)).toBeGreaterThan(0)
    expect(compareClassSortKeys(b5, b6)).toBeGreaterThan(0)
    expect(compareClassSortKeys(b6, b4)).toBeGreaterThan(0)
  })

  it('treats Theory (LoD at >=10000) as a level above plain LoD', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 10000, 4) // [13,5,0]
    const plain = getClassSortKey('THE LORD OF DJMAX', 9990, 8) // [13,0,3]
    expect(theory).toEqual([13, 5, 0])
    expect(plain).toEqual([13, 0, 3])
    expect(compareClassSortKeys(theory, plain)).toBeGreaterThan(0)
  })

  it('keeps Theory above every non-LoD rank', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 10000, 4)
    const bm = getClassSortKey('BEAT MAESTRO I', 9970, 8)
    expect(compareClassSortKeys(theory, bm)).toBeGreaterThan(0)
  })

  it('gives no-level ranks a level ordinal of 0 without throwing', () => {
    expect(getClassSortKey('THE LORD OF DJMAX', 9990, 5)).toEqual([13, 0, 2])
    expect(getClassSortKey('BEGINNER', 0, 4)).toEqual([0, 0, 0])
  })

  it('sorts an unknown class to the bottom', () => {
    expect(getClassSortKey('NONSENSE', 0, 4)).toEqual([-1, 0, 0])
  })
})

describe('compareClassSortKeys', () => {
  it('returns 0 for identical keys', () => {
    expect(compareClassSortKeys([7, 4, 3], [7, 4, 3])).toBe(0)
  })

  it('is positive when the first key ranks higher', () => {
    expect(compareClassSortKeys([8, 0, 0], [7, 9, 9])).toBeGreaterThan(0)
  })

  it('is negative when the first key ranks lower', () => {
    expect(compareClassSortKeys([7, 4, 0], [7, 4, 3])).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dj-class.test.ts`
Expected: FAIL — `RANK_ORDER`, `getClassSortKey`, `compareClassSortKeys` are not exported (import errors / undefined).

- [ ] **Step 3: Implement the helpers**

Append to the end of `src/lib/dj-class.ts` (after `getBadgeText`). It reuses the existing module-level `LEVEL_RE`, `parseRankName`, and `isTheoryPower`:

```ts
// Canonical DJ CLASS rank order, best → worst. Mirrors the V-ARCHIVE ladder
// and the key order of RANK_THRESHOLDS / DJ_CLASS_COLORS above.
export const RANK_ORDER: string[] = [
  'THE LORD OF DJMAX',
  'BEAT MAESTRO',
  'SHOWSTOPPER',
  'HEADLINER',
  'TREND SETTER',
  'PROFESSIONAL',
  'HIGH CLASS',
  'PRO DJ',
  'MIDDLEMAN',
  'STREET DJ',
  'ROOKIE',
  'AMATEUR',
  'TRAINEE',
  'BEGINNER',
]

// Roman level → ordinal (higher is better). Theory (top level of LoD) = 5.
const LEVEL_VALUES: Record<string, number> = { I: 4, II: 3, III: 2, IV: 1 }

// Button display preference: 8 > 5 > 6 > 4 (higher is preferred).
const BUTTON_PREFERENCE: Record<number, number> = { 8: 3, 5: 2, 6: 1, 4: 0 }

// Comparable sort key for one button's DJ CLASS result, "bigger is better"
// at every position: [rankOrdinal, levelOrdinal, buttonPref]. Used to pick
// the displayed button by highest CLASS (not power). Theory is modeled as
// LoD's top level, so power only matters via the theory check.
export function getClassSortKey(
  djClass: string,
  djPowerConversion: number | null | undefined,
  button: number
): [number, number, number] {
  const rankName = parseRankName(djClass)
  const rankIndex = RANK_ORDER.indexOf(rankName)
  const rankOrdinal = rankIndex === -1 ? -1 : RANK_ORDER.length - 1 - rankIndex

  let levelOrdinal: number
  if (rankName === 'THE LORD OF DJMAX' && isTheoryPower(djPowerConversion)) {
    levelOrdinal = 5
  } else {
    const levelMatch = djClass?.match(LEVEL_RE)
    const level = levelMatch ? levelMatch[1].toUpperCase() : null
    levelOrdinal = level ? (LEVEL_VALUES[level] ?? 0) : 0
  }

  const buttonPref = BUTTON_PREFERENCE[button] ?? -1

  return [rankOrdinal, levelOrdinal, buttonPref]
}

// Lexicographic, descending comparison of two class sort keys.
// Returns > 0 when `a` ranks higher than `b`, < 0 when lower, 0 when equal.
export function compareClassSortKeys(
  a: [number, number, number],
  b: [number, number, number]
): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dj-class.test.ts`
Expected: PASS — all existing dj-class tests plus the new `RANK_ORDER`, `getClassSortKey`, and `compareClassSortKeys` blocks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: add DJ CLASS sort-key helpers (rank > level > button)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Switch `getHighestDjClass` to class-based selection

**Files:**
- Modify: `src/lib/varchive.ts:59-86` (`getHighestDjClass`, the reducer at `:83`)
- Test: `tests/varchive.test.ts`

- [ ] **Step 1: Update and extend the tests (failing)**

Replace the entire contents of `tests/varchive.test.ts` with the following. This rewrites the old power-based test (which asserted the 5-button HIGH CLASS II winner) to the new class-based winner, and adds rank-over-power, theory, and all-theory cases. Buttons are fetched in the order 4, 5, 6, 8, so the four `mockResolvedValueOnce` calls map to buttons 4, 5, 6, 8 respectively.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHighestDjClass } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

function mockButton(djClass: string, djPowerConversion: number): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      djClass,
      djPowerSum: djPowerConversion,
      djPowerConversion,
      maxDjPower: djPowerConversion,
    }),
  } as Response
}

describe('getHighestDjClass', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('picks the highest CLASS, breaking an exact rank+level tie by 8 > 5 > 6 > 4', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 5500)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS II', 8385.9)) // 5B (highest POWER)
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 6000)) // 8B

    // 4B and 8B are both HIGH CLASS I (top level here); 8B wins the button tie.
    // The 5B HIGH CLASS II has the highest POWER but a lower level, so it loses.
    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS I')
    expect(result?.button).toBe(8)
    expect(result?.djPowerConversion).toBe(6000)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('prefers a higher rank even when a lower rank has more POWER and a higher button', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('SHOWSTOPPER IV', 9705)) // 4B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 5B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HEADLINER I', 9999)) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('SHOWSTOPPER IV')
    expect(result?.button).toBe(4)
  })

  it('prefers Theory (LoD at >=10000) over plain LoD even on a lower button', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 4B theory
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 9990)) // 5B plain
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.button).toBe(4)
    expect(result?.djPowerConversion).toBe(10000)
  })

  it('falls back to button order when all buttons are Theory', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 5B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.button).toBe(8)
  })

  it('returns null if all buttons fail', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Not found'))

    const result = await getHighestDjClass('testuser')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/varchive.test.ts`
Expected: FAIL — the reducer still selects by `djPowerConversion`, so e.g. the first test resolves to button 5 (HIGH CLASS II) instead of button 8.

- [ ] **Step 3: Implement the class-based reducer**

In `src/lib/varchive.ts`, add this import as the **very first line of the file**, above the existing `const VARCHIVE_BASE_URL` (the file currently has no imports, so this becomes line 1):

```ts
import { getClassSortKey, compareClassSortKeys } from './dj-class'
```

Then replace the final reducer in `getHighestDjClass` — the block at `src/lib/varchive.ts:83-85`:

```ts
  return results.reduce((best, current) =>
    current.djPowerConversion > best.djPowerConversion ? current : best
  )
```

with:

```ts
  return results.reduce((best, current) =>
    compareClassSortKeys(
      getClassSortKey(current.djClass, current.djPowerConversion, current.button),
      getClassSortKey(best.djClass, best.djPowerConversion, best.button)
    ) > 0
      ? current
      : best
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/varchive.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Run the full suite, lint, and format check**

Run: `npm test`
Expected: PASS — whole suite green (confirms no other test depended on the old power-based selection).

Run: `npx eslint src/lib/varchive.ts src/lib/dj-class.ts && npx prettier --check src/lib/varchive.ts src/lib/dj-class.ts tests/varchive.test.ts tests/dj-class.test.ts`
Expected: no errors. If prettier reports a file, run `npx prettier --write` on it and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/lib/varchive.ts tests/varchive.test.ts
git commit -m "feat: select displayed button by highest DJ CLASS, not DJ POWER

Tie-break order rank > level > button (8>5>6>4); Theory is LoD's top level.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done

Both tasks complete: `getHighestDjClass` now selects by DJ CLASS (rank → level → button, Theory as LoD's top level), with full unit coverage on the pure `getClassSortKey`/`compareClassSortKeys` helpers and integration coverage on the reducer. No schema, API, cache, or widget changes were needed.
