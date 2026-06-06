# Shiny Theory Badge + Derived Theory + Page Margins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate "이론치" theory badge with a shimmering treatment on the existing LoD badge, derive theory status on-the-fly from `powerInteger` (removing the threaded `isTheory` field), add vertical margins to all full web pages, and document the `fontSize` widget URL param.

**Architecture:** A single `isTheoryPower(powerInteger)` helper + `THEORY_POWER_THRESHOLD` constant in `src/lib/dj-class.ts` becomes the one source of truth for "theory". The chat badge (`DjClassBadge`) reads it to toggle a `.shiny` CSS-module class (a glint clipped with `clip-path` to preserve baseline). The `isTheory` boolean is deleted from the cache type, both API routes, the widget client, the fake messages, and the link page. Threshold-mode badge text shows `10000` for theory players. Page layouts gain `py-8 sm:py-12`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, React, Tailwind CSS, CSS Modules, Vitest.

**Testing note:** The repo's test suite (`vitest`) covers pure `src/lib` logic only — there are no React-component or API-route tests. So TDD applies to the `dj-class.ts` changes (Tasks 1–2). Component/CSS/route/markup changes (Tasks 3–7) are verified with `npm run build`, `npm run lint`, and the full `npm test` suite staying green, plus visual confirmation in the dashboard widget preview.

---

### Task 1: Add `isTheoryPower` helper and `THEORY_POWER_THRESHOLD` constant

**Files:**
- Modify: `src/lib/dj-class.ts`
- Test: `tests/dj-class.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this block to `tests/dj-class.test.ts` (after the existing `import` line, update the import to include the new symbols, and append the describe block at the end of the file):

Update the import at the top:

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
} from '../src/lib/dj-class'
```

Append at the end of the file:

```ts
describe('isTheoryPower', () => {
  it('is true at exactly the threshold', () => {
    expect(isTheoryPower(10000)).toBe(true)
  })

  it('is true above the threshold', () => {
    expect(isTheoryPower(10001)).toBe(true)
  })

  it('is false just below the threshold', () => {
    expect(isTheoryPower(9999)).toBe(false)
  })

  it('is false for null', () => {
    expect(isTheoryPower(null)).toBe(false)
  })

  it('is false for undefined', () => {
    expect(isTheoryPower(undefined)).toBe(false)
  })

  it('exposes the threshold constant as 10000', () => {
    expect(THEORY_POWER_THRESHOLD).toBe(10000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- dj-class`
Expected: FAIL — `isTheoryPower is not a function` / `THEORY_POWER_THRESHOLD` is undefined.

- [ ] **Step 3: Implement the helper**

In `src/lib/dj-class.ts`, add near the top (after the existing top-of-file comment, before `DJ_CLASS_COLORS`):

```ts
// DJ power at or above this value is a "theory" (이론치) / perfect score.
// Single source of truth for the theory check across badge rendering,
// threshold-mode text, and previews.
export const THEORY_POWER_THRESHOLD = 10000

export function isTheoryPower(
  powerInteger: number | null | undefined
): boolean {
  return powerInteger != null && powerInteger >= THEORY_POWER_THRESHOLD
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- dj-class`
Expected: PASS (all `isTheoryPower` tests green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: add isTheoryPower helper and THEORY_POWER_THRESHOLD constant"
```

---

### Task 2: Threshold-mode badge text shows `10000` for theory players

**Files:**
- Modify: `src/lib/dj-class.ts` (`getBadgeText`, threshold branch — currently lines ~94–102)
- Test: `tests/dj-class.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('getBadgeText', ...)` block in `tests/dj-class.test.ts`:

```ts
  it('threshold mode shows 10000 for a theory player', () => {
    expect(
      getBadgeText('threshold', '4B THE LORD OF DJMAX', 'LoD', null, 10000)
    ).toBe('4B 10000')
  })

  it('threshold mode shows rank threshold for a non-theory LoD player', () => {
    expect(
      getBadgeText('threshold', '4B THE LORD OF DJMAX', 'LoD', null, 9990)
    ).toBe('4B 9980+')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- dj-class`
Expected: FAIL — the theory case returns `4B 9980+` instead of `4B 10000`.

- [ ] **Step 3: Implement the threshold-mode theory branch**

In `src/lib/dj-class.ts`, the `threshold` branch of `getBadgeText` currently reads:

```ts
  if (mode === 'threshold') {
    const rankName = parseRankName(djClass)
    const levelMatch = djClass?.match(LEVEL_RE)
    const resolvedLevel = levelMatch ? levelMatch[1] : null
    const threshold = getThreshold(rankName, resolvedLevel)
    return threshold != null
      ? `${buttonPrefix} ${threshold}+`
      : `${buttonPrefix} ${rankShort}`
  }
```

Change it to short-circuit on theory:

```ts
  if (mode === 'threshold') {
    if (isTheoryPower(powerInteger)) {
      return `${buttonPrefix} ${THEORY_POWER_THRESHOLD}`
    }
    const rankName = parseRankName(djClass)
    const levelMatch = djClass?.match(LEVEL_RE)
    const resolvedLevel = levelMatch ? levelMatch[1] : null
    const threshold = getThreshold(rankName, resolvedLevel)
    return threshold != null
      ? `${buttonPrefix} ${threshold}+`
      : `${buttonPrefix} ${rankShort}`
  }
```

(`isTheoryPower` and `THEORY_POWER_THRESHOLD` are already defined in this file from Task 1.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- dj-class`
Expected: PASS (both new threshold cases green, all prior tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: threshold mode shows 10000 for theory players"
```

---

### Task 3: Shiny badge in `DjClassBadge`; remove the separate `TheoryBadge`

**Files:**
- Create: `src/components/dj-class-badge.module.css`
- Modify: `src/components/DjClassBadge.tsx`
- Modify: `src/components/ChatMessageRow.tsx`
- Delete: `src/components/TheoryBadge.tsx`
- Delete: `src/components/theory-badge.module.css`

- [ ] **Step 1: Create the CSS module with the glint animation**

Create `src/components/dj-class-badge.module.css`:

```css
@keyframes glint {
  0% {
    left: -60%;
  }
  55%,
  100% {
    left: 130%;
  }
}

/* Theory (이론치, power >= 10000) badge: a glossy highlight sweeps across.
   Clip with clip-path (NOT overflow:hidden) so the inline-block keeps its
   text baseline and stays aligned with the chat text. */
.shiny {
  position: relative;
  clip-path: inset(0 round 0.25rem);
}

.shiny::after {
  content: '';
  position: absolute;
  top: 0;
  left: -60%;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    100deg,
    transparent,
    rgba(255, 255, 255, 0.85),
    transparent
  );
  transform: skewX(-20deg);
  animation: glint 2.6s ease-in-out infinite;
}
```

- [ ] **Step 2: Wire the shiny class into `DjClassBadge`**

Replace the entire contents of `src/components/DjClassBadge.tsx` with:

```tsx
import type { BadgeMode } from '@/lib/types'
import {
  getBadgeText,
  getDjClassColor,
  parseRankName,
  isTheoryPower,
} from '@/lib/dj-class'
import styles from './dj-class-badge.module.css'

interface DjClassBadgeProps {
  mode: BadgeMode
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
}

export default function DjClassBadge({
  mode,
  djClass,
  rankShort,
  rankLevel,
  powerInteger,
}: DjClassBadgeProps) {
  if (!rankShort) return null

  const badgeText = getBadgeText(
    mode,
    djClass,
    rankShort,
    rankLevel,
    powerInteger
  )

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
}
```

- [ ] **Step 3: Remove `TheoryBadge` usage from `ChatMessageRow`**

In `src/components/ChatMessageRow.tsx`:

Remove the import line:

```tsx
import TheoryBadge from './TheoryBadge'
```

Remove the render line (currently line 40):

```tsx
      {message.isTheory && <TheoryBadge />}
```

Leave the `isTheory: boolean` field in the `ChatMessage` interface for now — it is removed in Task 4. (The badge now derives shininess from `powerInteger`, so this field is simply unused after this task.)

- [ ] **Step 4: Delete the obsolete files**

```bash
git rm src/components/TheoryBadge.tsx src/components/theory-badge.module.css
```

- [ ] **Step 5: Verify build, lint, and tests pass**

Run: `npm run build && npm run lint && npm test`
Expected: build succeeds, no lint errors, all tests pass. (No references to `TheoryBadge` or `theory-badge.module.css` remain — the build would fail on a dangling import otherwise.)

- [ ] **Step 6: Visual check**

Run: `npm run dev`, open the dashboard (`/dashboard`) widget preview. Confirm the theory row (the `LoD` / `10000` message) shows a glint sweeping across the LoD badge, the badge stays aligned with the text baseline, and non-theory badges are static.

- [ ] **Step 7: Commit**

```bash
git add src/components/dj-class-badge.module.css src/components/DjClassBadge.tsx src/components/ChatMessageRow.tsx
git commit -m "feat: shimmer the LoD badge for theory players, drop separate theory badge"
```

---

### Task 4: Remove the threaded `isTheory` field (derive on the fly)

**Files:**
- Modify: `src/lib/cache.ts` (CacheValue type)
- Modify: `src/app/api/widget/dj-class/route.ts`
- Modify: `src/app/api/user/me/route.ts`
- Modify: `src/components/WidgetPage.tsx`
- Modify: `src/components/ChatMessageRow.tsx` (ChatMessage interface)
- Modify: `src/lib/fake-chat-messages.ts`

This is one cohesive commit: removing the field from the type forces removing it everywhere in the same change so TypeScript stays green.

- [ ] **Step 1: Remove `isTheory` from the cache type**

In `src/lib/cache.ts`, the `CacheValue` type's first variant currently includes `isTheory: boolean`. Remove that line so it reads:

```ts
type CacheValue =
  | {
      djClass: string
      rankName: string
      rankLevel: string | null
      powerInteger: number | null
    }
  | { unlinked: true }
```

- [ ] **Step 2: Remove `isTheory` from the widget route**

In `src/app/api/widget/dj-class/route.ts`:

Remove `isTheory: cached.isTheory,` from the cached-response object (currently line ~28).

Remove the computation block (currently lines ~86–88):

```ts
    const isTheory =
      djResult.dj_power_conversion !== null &&
      djResult.dj_power_conversion >= 10000
```

Remove `isTheory,` from the `setDjClassCache(...)` object (line ~105) and from the `NextResponse.json({...})` object (line ~112).

In the fallback `fallbackData` object (currently lines ~119–125), remove `isTheory: false,`.

After these edits the file no longer references `isTheory` anywhere — `grep -n isTheory src/app/api/widget/dj-class/route.ts` should return nothing.

- [ ] **Step 3: Remove `isTheory` from the user/me route**

In `src/app/api/user/me/route.ts`:

Remove the computation (currently lines ~40–42):

```ts
    const isTheory =
      djClassRow?.dj_power_conversion != null &&
      djClassRow.dj_power_conversion >= 10000
```

Remove `isTheory,` from the `NextResponse.json({...})` object (currently line ~55). Keep `powerInteger` — the link page derives theory from it.

- [ ] **Step 4: Remove `isTheory` from the widget client**

In `src/components/WidgetPage.tsx`:

- Remove `isTheory: boolean` from the `CacheEntry` type definition.
- Remove `isTheory: false,` from the initial `cacheEntry` object (currently line ~160).
- Remove `isTheory: cached.isTheory,` from the cached-branch assignment (currently line ~172).
- Remove `cacheEntry.isTheory = result.isTheory || false` (currently line ~206).
- Remove `isTheory: cacheEntry.isTheory,` from the `newMessage` object (currently line ~226).

`grep -n isTheory src/components/WidgetPage.tsx` should return nothing afterward.

- [ ] **Step 5: Remove `isTheory` from the `ChatMessage` interface**

In `src/components/ChatMessageRow.tsx`, remove `isTheory: boolean` from the `ChatMessage` interface.

- [ ] **Step 6: Remove `isTheory` from the fake messages**

In `src/lib/fake-chat-messages.ts`, remove the `isTheory: true,` / `isTheory: false,` line from all 20 entries. (Sed makes this mechanical:)

```bash
sed -i '/^\s*isTheory: \(true\|false\),$/d' src/lib/fake-chat-messages.ts
```

Then confirm: `grep -n isTheory src/lib/fake-chat-messages.ts` returns nothing.

- [ ] **Step 7: Verify the whole project type-checks, builds, lints, tests**

Run: `npm run build && npm run lint && npm test`
Expected: success. A full-repo `grep -rn "isTheory" src/` should now return **nothing** (the link page is handled in Task 5 — if it still appears there, that is expected until Task 5).

- [ ] **Step 8: Commit**

```bash
git add src/lib/cache.ts src/app/api/widget/dj-class/route.ts src/app/api/user/me/route.ts src/components/WidgetPage.tsx src/components/ChatMessageRow.tsx src/lib/fake-chat-messages.ts
git commit -m "refactor: derive theory from powerInteger, remove threaded isTheory field"
```

---

### Task 5: Remove the `이론치` chip and `isTheory` from the link page

**Files:**
- Modify: `src/components/LinkPage.tsx`

- [ ] **Step 1: Remove `isTheory` from the `UserInfo` interface**

In `src/components/LinkPage.tsx`, remove `isTheory: boolean` from the `UserInfo` interface (currently line ~24).

- [ ] **Step 2: Remove the `isTheory` assignment in `handleSync`**

In the `setUser((prev) => ...)` call inside `handleSync`, remove the line (currently line ~81):

```tsx
                isTheory: data.djPowerConversion >= 10000,
```

- [ ] **Step 3: Remove the red `이론치` status chip**

Remove this block (currently lines ~302–306):

```tsx
                            {user.isTheory && (
                              <span className="inline-flex items-center rounded bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                                이론치
                              </span>
                            )}
```

`grep -n "isTheory\|이론치" src/components/LinkPage.tsx` should return nothing afterward.

- [ ] **Step 4: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm test`
Expected: success. `grep -rn "isTheory" src/` now returns nothing across the whole `src/` tree.

- [ ] **Step 5: Commit**

```bash
git add src/components/LinkPage.tsx
git commit -m "refactor: drop redundant 이론치 chip from link page status row"
```

---

### Task 6: Add top/bottom margin to all full web pages

**Files:**
- Modify: `src/components/LandingPage.tsx` (line ~10)
- Modify: `src/components/LinkPage.tsx` (line ~133)
- Modify: `src/components/DashboardPage.tsx` (lines ~99 and ~110)
- Modify: `src/app/login/page.tsx` (line ~30)
- Modify: `src/app/not-found.tsx` (line ~6)

The fix is identical in each place: add `py-8 sm:py-12` to the centering container's class list. The widget (`WidgetPage.tsx`) and the `SiteBackground.tsx` wrapper are NOT touched.

- [ ] **Step 1: `LandingPage.tsx`**

Change:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
```

to:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 2: `LinkPage.tsx` (line ~133)**

Change:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
```

to:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 3: `DashboardPage.tsx` — main layout (line ~110)**

Change:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
```

to:

```tsx
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 4: `DashboardPage.tsx` — error layout (line ~99)**

Change:

```tsx
        <main className="flex min-h-screen items-center justify-center px-4">
```

to:

```tsx
        <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 5: `src/app/login/page.tsx` (line ~30)**

Change:

```tsx
      <main className="flex min-h-screen items-center justify-center px-4">
```

to:

```tsx
      <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 6: `src/app/not-found.tsx` (line ~6)**

Change:

```tsx
      <div className="flex min-h-screen items-center justify-center px-4">
```

to:

```tsx
      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
```

- [ ] **Step 7: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 8: Visual check**

Run `npm run dev`, open `/dashboard` (the tallest page). Confirm the `채팅 위젯 설정` heading is no longer flush against the top of the viewport — there is clear breathing room above it and below the last element when scrolled to the bottom.

- [ ] **Step 9: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LinkPage.tsx src/components/DashboardPage.tsx src/app/login/page.tsx src/app/not-found.tsx
git commit -m "fix: add vertical padding so web pages aren't flush to viewport top"
```

---

### Task 7: README — theory wording and `fontSize` param

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "이론치 뱃지" feature bullet**

In the `## 기능` list, the bullet currently reads:

```
- **이론치 뱃지**: DJ POWER가 10000 이상이면 반짝이는 빨간색 `이론치` 뱃지가 추가로 표시됩니다.
```

Replace it with:

```
- **이론치 효과**: DJ POWER가 10000 이상이면 LoD 뱃지가 반짝이며(움직이는 광택) 이론치 달성을 표시합니다.
```

- [ ] **Step 2: Update the example widget URL (line ~38)**

Change:

```
3. 위젯 URL을 복사합니다 (예: `https://chatoverlay.felis.kr/widget/abc123?mode=short`).
```

to:

```
3. 위젯 URL을 복사합니다 (예: `https://chatoverlay.felis.kr/widget/abc123?mode=short&fontSize=14`).
```

- [ ] **Step 3: Document the `fontSize` param after the `?mode=` list**

The `?mode=` list currently ends with:

```
   - `?mode=power` — 정수 파워 (예: `4B 9843`)
```

Immediately after that line (step 6 of the streamer instructions), add a step 7:

```
7. 채팅 글자 크기를 URL의 `?fontSize=` 파라미터(픽셀)로 조절할 수 있습니다. 범위는 12~28이며 기본값은 14입니다. 범위를 벗어난 값은 자동으로 보정됩니다.
```

- [ ] **Step 4: Mention `fontSize` in the "모드 변경" tip**

The bullet currently reads:

```
- **모드 변경**: 위젯 URL의 `?mode=` 파라미터만 변경하면 모든 새 메시지의 뱃지 모드가 즉시 바뀝니다.
```

Add a companion bullet right after it:

```
- **글자 크기 변경**: 위젯 URL의 `?fontSize=` 파라미터(12~28, 기본 14)로 채팅 글자 크기를 조절할 수 있습니다.
```

- [ ] **Step 5: Verify**

Run: `grep -n "fontSize\|이론치" README.md`
Expected: the example URL, the new step 7, the new tip bullet, and the updated 이론치 효과 bullet all appear; no remaining "반짝이는 빨간색" wording.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document fontSize URL param and update theory badge wording"
```

---

## Final verification

- [ ] Run the full suite once more: `npm run build && npm run lint && npm test` — all green.
- [ ] `grep -rn "isTheory" src/` returns nothing.
- [ ] `grep -rn "TheoryBadge\|theory-badge" src/` returns nothing.
- [ ] Dashboard widget preview: theory message badge shimmers and is baseline-aligned; threshold mode shows `4B 10000` for the theory entry.
- [ ] Dashboard/link/login/landing/404 pages have clear top and bottom margin.
