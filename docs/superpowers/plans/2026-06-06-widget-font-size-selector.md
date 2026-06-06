# Widget Chat Font-Size Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard slider that sets the OBS chat widget's font size, encoded in the widget URL, scaling message text and badges together.

**Architecture:** A pure helper module (`src/lib/font-size.ts`) owns the range/clamp/parse logic and is unit-tested. The dashboard adds a slider whose value is appended to the widget URL as `?fontSize=`. The widget reads and clamps that param and applies it as a base `fontSize` (px) on the message container; `ChatMessageRow`/`DjClassBadge`/`TheoryBadge` switch to `em`-relative sizing so they scale off that base.

**Tech Stack:** Next.js (App Router), React client components, TypeScript, Tailwind, Radix UI (shadcn-style wrappers), Vitest.

---

## File Structure

- **Create** `src/lib/font-size.ts` — constants + `clampFontSize` + `parseFontSize`. Single source of truth for the valid range and URL parsing.
- **Create** `tests/font-size.test.ts` — unit tests for the helper.
- **Create** `src/components/ui/slider.tsx` — shadcn-style Radix slider wrapper.
- **Modify** `package.json` — add `@radix-ui/react-slider` dependency.
- **Modify** `src/components/ChatMessageRow.tsx` — message text `1em` (drop `text-sm`).
- **Modify** `src/components/DjClassBadge.tsx` — badge font `0.85em` (drop `text-xs`).
- **Modify** `src/components/theory-badge.module.css` — badge font `0.85em`.
- **Modify** `src/components/WidgetPage.tsx` — read `fontSize` param, apply base size.
- **Modify** `src/components/WidgetPreview.tsx` — accept `fontSize` prop, apply base size.
- **Modify** `src/components/DashboardPage.tsx` — `fontSize` state, slider card, URL param, pass to preview.

---

## Task 1: Font-size helper module (TDD)

**Files:**
- Create: `src/lib/font-size.ts`
- Test: `tests/font-size.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/font-size.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  clampFontSize,
  parseFontSize,
} from '../src/lib/font-size'

describe('font-size constants', () => {
  it('uses the agreed range and default', () => {
    expect(FONT_SIZE_MIN).toBe(12)
    expect(FONT_SIZE_MAX).toBe(28)
    expect(FONT_SIZE_DEFAULT).toBe(14)
  })
})

describe('clampFontSize', () => {
  it('returns the value when within range', () => {
    expect(clampFontSize(18)).toBe(18)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampFontSize(5)).toBe(12)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampFontSize(100)).toBe(28)
  })

  it('rounds floats to the nearest integer', () => {
    expect(clampFontSize(16.7)).toBe(17)
  })
})

describe('parseFontSize', () => {
  it('returns default for null', () => {
    expect(parseFontSize(null)).toBe(14)
  })

  it('returns default for non-numeric input', () => {
    expect(parseFontSize('abc')).toBe(14)
  })

  it('parses and returns an in-range integer', () => {
    expect(parseFontSize('18')).toBe(18)
  })

  it('clamps a too-small value', () => {
    expect(parseFontSize('5')).toBe(12)
  })

  it('clamps a too-large value', () => {
    expect(parseFontSize('100')).toBe(28)
  })

  it('rounds a float string', () => {
    expect(parseFontSize('16.7')).toBe(17)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- font-size`
Expected: FAIL — cannot find module `../src/lib/font-size`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/font-size.ts`:

```ts
// Chat widget font-size bounds and URL parsing.
// Single source of truth shared by the widget read-path and the dashboard.

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 28
export const FONT_SIZE_DEFAULT = 14

/** Clamp a finite font size into [MIN, MAX], rounded to a whole pixel. */
export function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/**
 * Parse a `fontSize` URL query value. Returns FONT_SIZE_DEFAULT for null or
 * non-numeric input; otherwise the clamped integer.
 */
export function parseFontSize(raw: string | null): number {
  if (raw === null) return FONT_SIZE_DEFAULT
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return FONT_SIZE_DEFAULT
  return clampFontSize(parsed)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- font-size`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/font-size.ts tests/font-size.test.ts
git commit -m "feat: add font-size helper with range clamp and URL parser"
```

---

## Task 2: Slider UI component

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/components/ui/slider.tsx`

- [ ] **Step 1: Add the Radix slider dependency**

Run: `npm install @radix-ui/react-slider`
Expected: `package.json` gains `"@radix-ui/react-slider": "^x.y.z"` under dependencies and `package-lock.json` updates.

- [ ] **Step 2: Create the slider wrapper**

Create `src/components/ui/slider.tsx` (mirrors the existing `radio-group.tsx` wrapper style):

```tsx
"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
```

- [ ] **Step 3: Verify it typechecks/lints**

Run: `npm run lint`
Expected: PASS (no errors for the new file).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/ui/slider.tsx
git commit -m "feat: add shadcn-style Radix slider component"
```

---

## Task 3: Switch chat row and badges to em-relative sizing

This makes message text and badges scale off the container's base `fontSize`.
No unit test (CSS/markup change); verified by lint + the manual check in Task 6.

**Files:**
- Modify: `src/components/ChatMessageRow.tsx`
- Modify: `src/components/DjClassBadge.tsx`
- Modify: `src/components/theory-badge.module.css`

- [ ] **Step 1: Message text to `1em` in `ChatMessageRow.tsx`**

Replace the outer `<div>` className (remove `text-sm` so the text inherits the
container base size):

```tsx
    <div
      className={`break-words ${
        message.isUnlinked ? 'opacity-75' : 'opacity-100'
      }`}
    >
```

(The `<span>` with the message text already has no font-size class, so it
renders at `1em` — the inherited base.)

- [ ] **Step 2: DJ CLASS badge to `0.85em` in `DjClassBadge.tsx`**

Replace the badge `<span>` — drop `text-xs` from the className and add
`fontSize: '0.85em'` to the inline style:

```tsx
    <span
      className="mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm"
      style={{
        background: getDjClassColor(parseRankName(djClass)),
        color: '#000',
        textShadow: '0 0 1px rgba(255,255,255,0.5)',
        fontSize: '0.85em',
      }}
    >
      {badgeText}
    </span>
```

- [ ] **Step 3: Theory badge to `0.85em` in `theory-badge.module.css`**

In the `.theory-badge` rule, change the fixed font size and line height so the
badge scales with the base and never clips at large sizes:

```css
  font-size: 0.85em;
  line-height: 1.2;
```

(Replaces the existing `font-size: 0.75rem;` and `line-height: 1rem;` lines.)

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatMessageRow.tsx src/components/DjClassBadge.tsx src/components/theory-badge.module.css
git commit -m "refactor: scale chat text and badges with em-relative font sizes"
```

---

## Task 4: Widget reads and applies fontSize

**Files:**
- Modify: `src/components/WidgetPage.tsx`

- [ ] **Step 1: Import the helper**

Add to the imports at the top of `WidgetPage.tsx`:

```tsx
import { FONT_SIZE_DEFAULT, parseFontSize } from '@/lib/font-size'
```

- [ ] **Step 2: Add fontSize state**

Add alongside the other `useState`/`useRef` declarations (near `badgeModeRef`):

```tsx
  const [fontSize, setFontSize] = useState<number>(FONT_SIZE_DEFAULT)
```

- [ ] **Step 3: Read fontSize from the URL on mount**

In the existing mount effect that reads `mode`, add the `fontSize` read:

```tsx
  // Read badge mode and font size from URL query parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    if (mode === 'threshold' || mode === 'power' || mode === 'short') {
      badgeModeRef.current = mode
    }
    setFontSize(parseFontSize(params.get('fontSize')))
  }, [])
```

- [ ] **Step 4: Apply fontSize as the base size on the message container**

Add `style={{ fontSize }}` to the message-list wrapper div (the one with
`flex h-full flex-col justify-end space-y-1 px-2 py-2`):

```tsx
      <div
        className="flex h-full flex-col justify-end space-y-1 px-2 py-2"
        style={{ fontSize }}
      >
```

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/WidgetPage.tsx
git commit -m "feat: apply fontSize URL param to the chat widget"
```

---

## Task 5: Preview accepts a fontSize prop

**Files:**
- Modify: `src/components/WidgetPreview.tsx`

- [ ] **Step 1: Add the prop to the interface**

Update `WidgetPreviewProps`:

```tsx
interface WidgetPreviewProps {
  badgeMode: BadgeMode
  fontSize: number
}
```

- [ ] **Step 2: Destructure the prop**

Update the component signature:

```tsx
export default function WidgetPreview({
  badgeMode,
  fontSize,
}: WidgetPreviewProps) {
```

- [ ] **Step 3: Apply fontSize on the message wrapper**

Add `style={{ fontSize }}` to the inner message-list wrapper div (the one with
`flex h-full flex-col justify-end space-y-1 px-2 py-2`):

```tsx
      <div
        className="flex h-full flex-col justify-end space-y-1 px-2 py-2"
        style={{ fontSize }}
      >
```

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: PASS — note it may report that `DashboardPage` now passes too few/many
props only after Task 6; lint here should still pass for this file.

- [ ] **Step 5: Commit**

```bash
git add src/components/WidgetPreview.tsx
git commit -m "feat: support live fontSize in widget preview"
```

---

## Task 6: Dashboard slider, URL param, and live preview wiring

**Files:**
- Modify: `src/components/DashboardPage.tsx`

- [ ] **Step 1: Import the slider and font-size constants**

Add to the imports in `DashboardPage.tsx`:

```tsx
import { Slider } from '@/components/ui/slider'
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
} from '@/lib/font-size'
```

- [ ] **Step 2: Add fontSize state**

Add next to the `badgeMode` state:

```tsx
  const [fontSize, setFontSize] = useState<number>(FONT_SIZE_DEFAULT)
```

- [ ] **Step 3: Append fontSize to the widget URL**

In `getWidgetUrl`, after the `mode` is set, also set `fontSize`:

```tsx
  const getWidgetUrl = (mode?: BadgeMode) => {
    if (!data?.widgetUrl) return ''
    const url = new URL(data.widgetUrl, window.location.origin)
    const m = mode || badgeMode
    url.searchParams.set('mode', m)
    url.searchParams.set('fontSize', String(fontSize))
    return url.toString()
  }
```

- [ ] **Step 4: Add the font-size card**

Insert this card between the "뱃지 모드" card and the "위젯 미리보기" card:

```tsx
              <Card>
                <CardHeader>
                  <CardTitle>글자 크기</CardTitle>
                  <CardDescription>
                    위젯 채팅 글자 크기를 선택하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Slider
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    step={1}
                    value={[fontSize]}
                    onValueChange={(value) => setFontSize(value[0])}
                  />
                  <p className="text-xs text-muted-foreground">
                    현재: <span className="font-semibold">{fontSize}px</span>
                  </p>
                </CardContent>
              </Card>
```

- [ ] **Step 5: Pass fontSize to the preview**

Update the `WidgetPreview` usage in the preview card:

```tsx
                  <WidgetPreview badgeMode={badgeMode} fontSize={fontSize} />
```

- [ ] **Step 6: Verify lint and build pass**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS — Next.js compiles with no type errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open `/dashboard`, and confirm:
- The "글자 크기" slider moves between 12 and 28 and the "현재: Npx" readout updates.
- The preview text and badges grow/shrink together as the slider moves.
- "URL 복사" / "위젯 열기" now include `&fontSize=` and opening the widget URL
  renders chat at the chosen size.
- Editing the URL to `fontSize=999` or `fontSize=abc` still renders at a sane
  size (28 and 14 respectively).

- [ ] **Step 8: Commit**

```bash
git add src/components/DashboardPage.tsx
git commit -m "feat: add font-size slider and fontSize URL param to dashboard"
```

---

## Final Verification

- [ ] Run the full suite: `npm test` — Expected: PASS (includes `font-size.test.ts`).
- [ ] Run `npm run lint` and `npm run build` — Expected: PASS.
- [ ] Confirm spec coverage: slider (Task 2, 6), URL param (Task 6), widget read/clamp (Task 1, 4), proportional scaling (Task 3), live preview (Task 5, 6), helper unit tests (Task 1).
