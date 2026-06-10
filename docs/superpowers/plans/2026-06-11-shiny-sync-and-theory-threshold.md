# Shiny Sync + Theory Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the shiny badge glint from visibly restarting when chat scrolls, and detect true V-ARCHIVE theory (이론치) players whose `djPowerConversion` lands just under 10000.

**Architecture:** (1) Phase-lock every shiny badge's CSS glint to absolute wall-clock time via a negative `animation-delay` derived from `Date.now()`, so any (re)mounted badge resumes at the same cycle point. (2) Detect theory from the raw `djPowerConversion` float against a lowered `9999.9847` threshold, and bump the displayed integer to `10000` so existing integer-based callers keep working.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, CSS Modules, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-shiny-sync-and-theory-threshold-design.md`

**Working directory:** worktree `.claude/worktrees/shiny-sync-theory-threshold` (branch `worktree-shiny-sync-theory-threshold`). All paths below are relative to the repo root.

---

## File Structure

- `src/lib/dj-class.ts` — add theory-conversion constants/helpers (`THEORY_POWER_CONVERSION_THRESHOLD`, `isTheoryConversion`, `toPowerInteger`) and glint helpers (`GLINT_PERIOD_MS`, `glintDelayMs`); wire `getClassSortKey` to the raw-float check. Single source of truth for both features.
- `tests/dj-class.test.ts` — unit tests for all new pure functions and the updated sort key.
- `src/app/api/widget/dj-class/route.ts` — replace `Math.floor` with `toPowerInteger`.
- `src/app/api/user/me/route.ts` — replace two `Math.floor` sites with `toPowerInteger`.
- `src/components/dj-class-badge.module.css` — drive glint duration/delay from CSS variables.
- `src/components/DjClassBadge.tsx` — inject the glint CSS variables when the badge is shiny.

`isTheoryPower` and `THEORY_POWER_THRESHOLD` (10000) are intentionally **unchanged** — badge rendering and threshold-mode text consume the bumped integer and keep working.

---

## Task 1: Theory-conversion constants + `isTheoryConversion`

**Files:**
- Modify: `src/lib/dj-class.ts` (after the existing `isTheoryPower` at lines 8-12)
- Test: `tests/dj-class.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/dj-class.test.ts`. First extend the import block at the top (lines 2-14) to include the new symbols:

```ts
import {
  getThreshold,
  getDjClassColor,
  getBadgeText,
  parseRankName,
  isTheoryPower,
  THEORY_POWER_THRESHOLD,
  THEORY_POWER_CONVERSION_THRESHOLD,
  isTheoryConversion,
  toPowerInteger,
  GLINT_PERIOD_MS,
  glintDelayMs,
  DJ_CLASS_COLORS,
  SHORT_NAMES,
  RANK_ORDER,
  getClassSortKey,
  compareClassSortKeys,
} from '../src/lib/dj-class'
```

Then add this describe block (place it right after the existing `isTheoryPower` describe block, which ends at line 122):

```ts
describe('isTheoryConversion', () => {
  it('exposes the conversion threshold constant as 9999.9847', () => {
    expect(THEORY_POWER_CONVERSION_THRESHOLD).toBe(9999.9847)
  })

  it('is true at exactly the conversion threshold', () => {
    expect(isTheoryConversion(9999.9847)).toBe(true)
  })

  it('is true above the conversion threshold', () => {
    expect(isTheoryConversion(10000)).toBe(true)
  })

  it('is false just below the conversion threshold', () => {
    expect(isTheoryConversion(9999.9846)).toBe(false)
  })

  it('is false for a clearly sub-theory score', () => {
    expect(isTheoryConversion(9999.5)).toBe(false)
  })

  it('is false for null and undefined', () => {
    expect(isTheoryConversion(null)).toBe(false)
    expect(isTheoryConversion(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dj-class.test.ts`
Expected: FAIL — `THEORY_POWER_CONVERSION_THRESHOLD` / `isTheoryConversion` are not exported (TypeScript/import error or `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/dj-class.ts`, immediately after the `isTheoryPower` function (currently ending at line 12), insert:

```ts
// TEMPORARY WORKAROUND (2026-06-11): V-ARCHIVE's djPowerConversion calculation
// reports true in-game theory (이론치) scores slightly below 10000 (observed
// 9999.9847). Until V-ARCHIVE corrects this, treat any raw conversion at or
// above this value as theory. Detection runs on the RAW float; the displayed
// integer is still bumped to THEORY_POWER_THRESHOLD via toPowerInteger().
export const THEORY_POWER_CONVERSION_THRESHOLD = 9999.9847

// Source-of-truth theory check, applied to the raw djPowerConversion float.
export function isTheoryConversion(
  conversion: number | null | undefined
): boolean {
  return conversion != null && conversion >= THEORY_POWER_CONVERSION_THRESHOLD
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dj-class.test.ts`
Expected: PASS (all `isTheoryConversion` cases green; existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: add 9999.9847 raw-conversion theory check (isTheoryConversion)"
```

---

## Task 2: `toPowerInteger` helper

**Files:**
- Modify: `src/lib/dj-class.ts` (after `isTheoryConversion` from Task 1)
- Test: `tests/dj-class.test.ts`

- [ ] **Step 1: Write the failing test**

Add this describe block after the `isTheoryConversion` block from Task 1:

```ts
describe('toPowerInteger', () => {
  it('bumps a theory conversion up to THEORY_POWER_THRESHOLD (10000)', () => {
    expect(toPowerInteger(9999.9847)).toBe(10000)
    expect(toPowerInteger(10000)).toBe(10000)
  })

  it('floors a non-theory conversion', () => {
    expect(toPowerInteger(9999.9846)).toBe(9999)
    expect(toPowerInteger(9999.5)).toBe(9999)
    expect(toPowerInteger(8800.7)).toBe(8800)
  })

  it('a floored non-theory value is not treated as theory by isTheoryPower', () => {
    expect(isTheoryPower(toPowerInteger(9999.5))).toBe(false)
  })

  it('preserves a genuine zero (not null)', () => {
    expect(toPowerInteger(0)).toBe(0)
  })

  it('returns null for null and undefined', () => {
    expect(toPowerInteger(null)).toBeNull()
    expect(toPowerInteger(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dj-class.test.ts`
Expected: FAIL — `toPowerInteger` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/dj-class.ts`, immediately after `isTheoryConversion` (from Task 1), insert:

```ts
// Convert a raw djPowerConversion float to the integer power shown in badges.
// Theory scores are bumped to THEORY_POWER_THRESHOLD (10000) so the existing
// integer-based isTheoryPower() callers keep working; every other score floors.
// Preserves null (no data) and a genuine 0.
export function toPowerInteger(
  conversion: number | null | undefined
): number | null {
  if (conversion == null) return null
  if (isTheoryConversion(conversion)) return THEORY_POWER_THRESHOLD
  return Math.floor(conversion)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dj-class.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: add toPowerInteger that bumps theory scores to 10000"
```

---

## Task 3: Wire `getClassSortKey` to the raw-float theory check

**Files:**
- Modify: `src/lib/dj-class.ts:135` (inside `getClassSortKey`)
- Test: `tests/dj-class.test.ts`

**Context:** Line 135 currently reads:
```ts
  if (rankName === 'THE LORD OF DJMAX' && isTheoryPower(djPowerConversion)) {
```
`getClassSortKey` receives the **raw** `djPowerConversion`, so it must use `isTheoryConversion` (9999.9847), not `isTheoryPower` (10000).

- [ ] **Step 1: Write the failing test**

Add this describe block after the existing `getClassSortKey` block (which ends at line 190):

```ts
describe('getClassSortKey — raw-conversion theory threshold', () => {
  it('treats a just-under-10000 LoD score (9999.9847) as theory (level 5)', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 9999.9847, 4)
    expect(theory).toEqual([13, 5, 0])
  })

  it('ranks a 9999.9847 theory above a plain LoD', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 9999.9847, 4)
    const plain = getClassSortKey('THE LORD OF DJMAX', 9990, 8) // [13,0,3]
    expect(compareClassSortKeys(theory, plain)).toBeGreaterThan(0)
  })

  it('does not treat a sub-threshold LoD (9999.5) as theory', () => {
    expect(getClassSortKey('THE LORD OF DJMAX', 9999.5, 5)).toEqual([13, 0, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dj-class.test.ts`
Expected: FAIL — the 9999.9847 case returns `[13, 0, 0]` (level 0) because the old `isTheoryPower(9999.9847)` is `false`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/dj-class.ts`, change line 135 from:

```ts
  if (rankName === 'THE LORD OF DJMAX' && isTheoryPower(djPowerConversion)) {
```

to:

```ts
  if (rankName === 'THE LORD OF DJMAX' && isTheoryConversion(djPowerConversion)) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dj-class.test.ts`
Expected: PASS. The existing `getClassSortKey` tests using `10000` and `9990` still pass (10000 ≥ 9999.9847; 9990 < 9999.9847).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "fix: pick theory LoD by raw conversion threshold in sort key"
```

---

## Task 4: Replace `Math.floor` call sites with `toPowerInteger`

**Files:**
- Modify: `src/app/api/widget/dj-class/route.ts:4` (import) and `:105-108`
- Modify: `src/app/api/user/me/route.ts:4` (import), `:56-59`, and `:71-74`

**Context:** These three sites turn the raw stored `dj_power_conversion` into the `powerInteger` sent to clients. Routing them through `toPowerInteger` is what makes a real theory player display `10000` and render shiny. There is no React/route test harness in this repo, so this task is verified by the full unit suite (the `toPowerInteger` behavior is already covered) plus `tsc` and `build` in Task 7.

- [ ] **Step 1: Update the widget route import**

In `src/app/api/widget/dj-class/route.ts`, change line 4 from:

```ts
import { resolveDisplayedClass, type DjClassRow } from '@/lib/dj-class'
```

to:

```ts
import {
  resolveDisplayedClass,
  toPowerInteger,
  type DjClassRow,
} from '@/lib/dj-class'
```

- [ ] **Step 2: Replace the widget route floor**

In the same file, replace lines 105-108:

```ts
      const powerInteger =
        chosen.djPowerConversion != null
          ? Math.floor(chosen.djPowerConversion)
          : null
```

with:

```ts
      const powerInteger = toPowerInteger(chosen.djPowerConversion)
```

- [ ] **Step 3: Update the user/me route import**

In `src/app/api/user/me/route.ts`, change line 4 from:

```ts
import { resolveDisplayedClass } from '@/lib/dj-class'
```

to:

```ts
import { resolveDisplayedClass, toPowerInteger } from '@/lib/dj-class'
```

- [ ] **Step 4: Replace both user/me floor sites**

Replace lines 56-59:

```ts
    const powerInteger =
      highest?.djPowerConversion != null
        ? Math.floor(highest.djPowerConversion)
        : null
```

with:

```ts
    const powerInteger = toPowerInteger(highest?.djPowerConversion)
```

Then replace lines 71-74 (inside the `buttons` map):

```ts
        powerInteger:
          r.dj_power_conversion != null
            ? Math.floor(r.dj_power_conversion)
            : null,
```

with:

```ts
        powerInteger: toPowerInteger(r.dj_power_conversion),
```

- [ ] **Step 5: Verify no stray djPowerConversion floors remain**

Run: `grep -rn "Math.floor(.*[dD]j[pP]ower\|Math.floor(.*dj_power" src/`
Expected: no output (all conversion floors now go through `toPowerInteger`).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/widget/dj-class/route.ts src/app/api/user/me/route.ts
git commit -m "fix: route djPowerConversion through toPowerInteger so theory shows 10000"
```

---

## Task 5: Glint period constant + `glintDelayMs` helper

**Files:**
- Modify: `src/lib/dj-class.ts` (append at end of file)
- Test: `tests/dj-class.test.ts`

**Context:** This pure helper holds the phase math so it is unit-testable; `DjClassBadge` will call it with `Date.now()` in Task 6. `GLINT_PERIOD_MS` is the single source of truth for the 2.6s period shared with the CSS module.

- [ ] **Step 1: Write the failing test**

Add this describe block at the end of `tests/dj-class.test.ts`:

```ts
describe('glintDelayMs', () => {
  it('exposes the glint period as 2600ms', () => {
    expect(GLINT_PERIOD_MS).toBe(2600)
  })

  it('is 0 at the start of a cycle', () => {
    expect(glintDelayMs(0)).toBe(0)
  })

  it('is 0 at an exact period boundary', () => {
    expect(glintDelayMs(GLINT_PERIOD_MS)).toBe(0)
    expect(glintDelayMs(GLINT_PERIOD_MS * 3)).toBe(0)
  })

  it('returns the negative offset within a cycle', () => {
    expect(glintDelayMs(1300)).toBe(-1300)
    expect(glintDelayMs(GLINT_PERIOD_MS + 1)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dj-class.test.ts`
Expected: FAIL — `GLINT_PERIOD_MS` / `glintDelayMs` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to the end of `src/lib/dj-class.ts`:

```ts
// Glint (shiny badge) animation period in ms. Single source of truth shared
// with dj-class-badge.module.css via the --glint-duration CSS variable.
export const GLINT_PERIOD_MS = 2600

// Negative animation-delay (ms) that phase-locks a shiny badge's glint to
// absolute wall-clock time. Because the offset comes from the clock and not
// the element's mount time, every badge — freshly mounted or re-mounted while
// chat scrolls — lands on the same point in the cycle, so the glint never
// visibly restarts. Pass Date.now().
export function glintDelayMs(now: number): number {
  return -(now % GLINT_PERIOD_MS)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dj-class.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: add wall-clock glint phase helper (glintDelayMs)"
```

---

## Task 6: Wire CSS variables into the glint animation

**Files:**
- Modify: `src/components/dj-class-badge.module.css:33`
- Modify: `src/components/DjClassBadge.tsx`

**Context:** CSS custom properties set on the `.shiny` element inherit into its `::after` pseudo-element. Setting them at render time (not in an effect) is safe because no shiny badge is ever server-rendered — both `WidgetPage` and `WidgetPreview` start with `messages = []` and populate client-side. This task has no unit test (the repo has no component-render harness); it is verified by build + a visual check.

- [ ] **Step 1: Make the CSS animation read variables**

In `src/components/dj-class-badge.module.css`, replace line 33:

```css
  animation: glint 2.6s ease-in-out infinite;
```

with:

```css
  animation: glint var(--glint-duration, 2.6s) ease-in-out infinite;
  animation-delay: var(--glint-delay, 0ms);
```

- [ ] **Step 2: Inject the variables from DjClassBadge**

In `src/components/DjClassBadge.tsx`, update the import on lines 2-7 from:

```ts
import {
  getBadgeText,
  getDjClassColor,
  parseRankName,
  isTheoryPower,
} from '@/lib/dj-class'
```

to:

```ts
import type { CSSProperties } from 'react'
import {
  getBadgeText,
  getDjClassColor,
  parseRankName,
  isTheoryPower,
  GLINT_PERIOD_MS,
  glintDelayMs,
} from '@/lib/dj-class'
```

Then replace the render body (current lines 35-51) from:

```tsx
  const shiny = isTheoryPower(powerInteger)

  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm ${
        shiny ? styles.shiny : ''
      }`}
      style={{
        background: getDjClassColor(parseRankName(djClass)),
        color: '#000',
        textShadow: '0 0 1px rgba(255,255,255,0.5)',
        fontSize: '0.85em',
      }}
    >
      {badgeText}
    </span>
  )
```

to:

```tsx
  const shiny = isTheoryPower(powerInteger)

  // Phase-lock the glint to wall-clock time so it never restarts when chat
  // scrolls. Set at render (not in an effect) — safe because no shiny badge is
  // ever server-rendered (chat lists start empty and fill in on the client).
  const style: CSSProperties = {
    background: getDjClassColor(parseRankName(djClass)),
    color: '#000',
    textShadow: '0 0 1px rgba(255,255,255,0.5)',
    fontSize: '0.85em',
    ...(shiny
      ? ({
          '--glint-duration': `${GLINT_PERIOD_MS}ms`,
          '--glint-delay': `${glintDelayMs(Date.now())}ms`,
        } as CSSProperties)
      : {}),
  }

  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm ${
        shiny ? styles.shiny : ''
      }`}
      style={style}
    >
      {badgeText}
    </span>
  )
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `as CSSProperties` cast permits the `--glint-*` custom properties).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Visual verification**

Run the app (`npm run dev`) and open the widget preview / a widget with a theory player. Confirm:
- The shiny glint sweeps continuously and all shiny badges glint in unison.
- When new chat messages arrive and the list scrolls, existing shiny badges do **not** restart their glint from the beginning.
- A player whose V-ARCHIVE `djPowerConversion` is ≥ 9999.9847 now renders shiny and shows `10000` in power/threshold modes.

- [ ] **Step 6: Commit**

```bash
git add src/components/dj-class-badge.module.css src/components/DjClassBadge.tsx
git commit -m "fix: phase-lock shiny glint to wall-clock so it survives chat scroll"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests PASS (baseline was 119; new tests added in Tasks 1-3 and 5).

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, build succeeds.

- [ ] **Step 3: Confirm clean tree**

Run: `git status`
Expected: clean working tree (all changes committed across Tasks 1-6).

---

## Self-Review Notes

- **Spec coverage:** Problem 1 → Tasks 5-6. Problem 2 → Tasks 1-4. Tests → Tasks 1-3, 5. Out-of-scope items (no re-mount investigation, no storage change) respected.
- **Type consistency:** `isTheoryConversion`, `toPowerInteger`, `THEORY_POWER_CONVERSION_THRESHOLD`, `GLINT_PERIOD_MS`, `glintDelayMs` are defined in Task 1/2/5 and consumed with the same names in Tasks 3/4/6. `isTheoryPower` / `THEORY_POWER_THRESHOLD` deliberately unchanged.
- **Known limitation (no silent cap):** Task 6 (CSS + component wiring) has no automated test — the repo has no component-render harness — so it relies on build + the explicit visual check in Task 6 Step 5. The phase math underneath it is unit-tested via `glintDelayMs` (Task 5).
