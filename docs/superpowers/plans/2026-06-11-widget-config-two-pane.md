# Two-Pane Widget Config Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `/dashboard` widget-config page into a desktop-first two-pane layout (config grid left, sticky URL + preview right), drop the redundant connection-status card, and replace the two remaining raw HTML controls with shadcn `Switch` and `Collapsible`.

**Architecture:** Single presentational component (`src/components/DashboardPage.tsx`) is re-laid-out; no data flow, state, URL-generation, or API changes. Two new shadcn/ui primitives are hand-authored to match the project's existing `forwardRef` + CSS-variable-token style (the repo predates the modern `data-slot` CLI output, so we don't run the CLI).

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, Tailwind CSS v3, shadcn/ui (slate, CSS variables), Radix UI primitives.

**Testing approach:** This is a presentational refactor with no testable logic, and the repo has **no React component-test harness** (vitest is used only for `src/lib` unit tests — no jsdom / Testing Library). Introducing such a harness for a layout change is out of scope (YAGNI). Each task is therefore verified by **`npx tsc --noEmit` + `npm run lint`**, plus a **manual visual check** in the running dev server. The final task runs the full `npm run build` and `npm run test` to confirm no regression. Husky's pre-commit hook auto-runs prettier + eslint on staged files.

**Branch:** Work continues on the existing `refactor/widget-config-two-pane` branch. `main` is PR-gated — do not push to `main`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/ui/switch.tsx` | shadcn Switch primitive (Radix wrapper) | **Create** |
| `src/components/ui/collapsible.tsx` | shadcn Collapsible primitive (Radix re-exports) | **Create** |
| `src/components/DashboardPage.tsx` | The widget-config page UI | **Modify** (layout rewrite of the loaded-data branch + imports) |
| `package.json` / `package-lock.json` | Add `@radix-ui/react-switch`, `@radix-ui/react-collapsible` | **Modify** (via `npm install`) |

The four config cards (뱃지 모드, 글자 크기, 버튼 선택 모드, 페이드아웃) keep their internal markup; only their container/position changes. The preview, URL, and OBS guide move into a sticky right pane. The 연결 상태 card is deleted.

---

## Task 1: Add `Switch` and `Collapsible` shadcn components

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/collapsible.tsx`

- [ ] **Step 1: Install the Radix dependencies**

Run:
```bash
npm install @radix-ui/react-switch @radix-ui/react-collapsible
```
Expected: both packages added to `dependencies` in `package.json`, lockfile updated, no peer-dep errors.

- [ ] **Step 2: Create `src/components/ui/switch.tsx`**

Matches the existing `slider.tsx` style (forwardRef, `cn`, token classes). Tokens used (`bg-primary`, `bg-input`, `ring-ring`, `bg-background`) are all defined in `src/app/globals.css`.

```tsx
'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
```

- [ ] **Step 3: Create `src/components/ui/collapsible.tsx`**

```tsx
'use client'

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors (the new files are unused for now, which is fine — they are exported modules, not unused locals).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/ui/switch.tsx src/components/ui/collapsible.tsx
git commit -m "feat: add shadcn Switch and Collapsible ui components"
```

---

## Task 2: Rewrite the DashboardPage layout into two panes

This is the core change: it replaces the loaded-data branch (the flat stack of cards) with the two-pane grid, removes the 연결 상태 card, swaps the fadeout checkbox for `Switch`, and moves the OBS guide into a `Collapsible`. The component's state, effects, and helper functions (`getWidgetUrl`, `copyUrl`, `handleLogout`, `handleSetBadgeMode`) are **unchanged**.

**Files:**
- Modify: `src/components/DashboardPage.tsx`

- [ ] **Step 1: Update imports**

The 연결 상태 card was the only consumer of `Badge`, so remove that import. Add `Switch` and `Collapsible`.

Remove this line (currently `src/components/DashboardPage.tsx:16`):
```tsx
import { Badge } from '@/components/ui/badge'
```

Add these two imports alongside the other `@/components/ui/*` imports:
```tsx
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
```

Leave `Alert` / `AlertDescription` imported — they are still used by the top-level error branch.

- [ ] **Step 2: Widen the page container**

Change the container max width so two panes fit. Replace (currently `src/components/DashboardPage.tsx:118`):
```tsx
        <div className="w-full max-w-lg space-y-6">
```
with:
```tsx
        <div className="w-full max-w-5xl space-y-6">
```

- [ ] **Step 3: Replace the loaded-data branch with the two-pane layout**

Replace the **entire** `{!data ? ( ... ) : ( <> ... </> )}` block — from the `{!data ? (` line through its closing `)}` (currently `src/components/DashboardPage.tsx:123-352`) — with the following. This keeps every card's internals identical to today except: 연결 상태 is gone, the fadeout toggle is a `Switch`, and the OBS guide is a `Collapsible`. Preview + URL + OBS are in a `lg:sticky` right pane; the four config cards are in a `sm:grid-cols-2` left grid.

```tsx
          {!data ? (
            <p className="text-center text-gray-500">로딩 중...</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr] lg:items-start">
              {/* LEFT — configuration */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
                <Card>
                  <CardHeader>
                    <CardTitle>뱃지 모드</CardTitle>
                    <CardDescription>
                      위젯에 표시할 DJ CLASS 뱃지 스타일을 선택하세요.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <RadioGroup
                      value={badgeMode}
                      onValueChange={(value) =>
                        handleSetBadgeMode(value as BadgeMode)
                      }
                      className="space-y-2"
                    >
                      {(Object.keys(BADGE_MODE_LABELS) as BadgeMode[]).map(
                        (mode) => (
                          <BadgeModePreviewRow
                            key={mode}
                            mode={mode}
                            label={BADGE_MODE_LABELS[mode]}
                          />
                        )
                      )}
                    </RadioGroup>
                    <p className="mt-2 text-xs text-muted-foreground">
                      현재 선택:{' '}
                      <span className="font-semibold">
                        {BADGE_MODE_LABELS[badgeMode]}
                      </span>
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>글자 크기</CardTitle>
                    <CardDescription>
                      위젯 채팅 글자 크기를 선택하세요.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Slider
                      aria-label="글자 크기"
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

                <Card>
                  <CardHeader>
                    <CardTitle>버튼 선택 모드</CardTitle>
                    <CardDescription>
                      시청자별 DJ CLASS를 어떤 버튼 기준으로 표시할지
                      선택하세요.
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
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="fadeout-toggle"
                        className="text-sm font-medium"
                      >
                        페이드아웃 사용
                      </Label>
                      <Switch
                        id="fadeout-toggle"
                        checked={fadeoutOn}
                        onCheckedChange={setFadeoutOn}
                        aria-label="페이드아웃 사용"
                      />
                    </div>
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
              </div>

              {/* RIGHT — output (sticky on desktop) */}
              <div className="space-y-6 lg:sticky lg:top-8">
                <Card>
                  <CardHeader>
                    <CardTitle>위젯 미리보기</CardTitle>
                    <CardDescription>
                      실제 위젯 화면 미리보기 (400×200)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center space-y-3">
                    <WidgetPreview badgeMode={badgeMode} fontSize={fontSize} />
                    <p className="text-center text-xs text-muted-foreground">
                      가짜 채팅 메시지가 500~1200ms 간격으로 자동으로 표시됩니다
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>위젯 URL</CardTitle>
                    <CardDescription>
                      OBS Browser Source에 이 URL을 사용하세요.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={getWidgetUrl()}
                        readOnly
                        className="flex-1 bg-gray-100"
                      />
                      <Button onClick={copyUrl}>
                        {copied ? '복사됨!' : 'URL 복사'}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      미리보기:{' '}
                      <a
                        href={getWidgetUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-gray-700"
                      >
                        위젯 열기
                      </a>
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <Collapsible>
                      <CollapsibleTrigger className="group flex w-full items-center justify-between font-medium">
                        <span>OBS 설정 방법</span>
                        <span className="text-muted-foreground transition-transform group-data-[state=open]:rotate-90">
                          ▸
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-gray-600">
                          <li>OBS에서 소스 추가 → 브라우저 선택</li>
                          <li>위 URL을 입력하세요</li>
                          <li>너비: 400, 높이: 600 권장</li>
                          <li>투명도: 사용자 지정 CSS로 배경 투명 설정</li>
                        </ol>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If you see "Badge is declared but never read" or "'Badge' is defined but never used", you missed removing the `Badge` import in Step 1 — remove it.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors and no unused-import warnings.

- [ ] **Step 6: Manual visual check**

Run `npm run dev` (starts the app on http://localhost:3000 via `tsx server.ts`). Log in if needed, then open http://localhost:3000/dashboard and confirm:
- Desktop (wide window): config cards in a 2-column grid on the left; preview + URL + OBS card on the right; the right pane stays visible (sticky) when you scroll the left pane.
- Changing 뱃지 모드 and 글자 크기 live-updates both the preview and the URL string.
- "URL 복사" copies; "위젯 열기" opens the widget in a new tab.
- The 페이드아웃 `Switch` toggles, enabling/disabling the seconds slider.
- "OBS 설정 방법" is collapsed by default and expands on click (the ▸ rotates).
- No 연결 상태 card anywhere.
- Narrow the window: the layout collapses to a single column, config first then output, with no horizontal overflow.

- [ ] **Step 7: Commit**

```bash
git add src/components/DashboardPage.tsx
git commit -m "feat: two-pane widget config layout with sticky preview

Restructure /dashboard into a config grid (left) + sticky URL/preview
pane (right). Drop the redundant connection-status card, swap the
fadeout checkbox for shadcn Switch, and move the OBS guide into a
Collapsible."
```

---

## Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: build succeeds with no type errors and no ESLint failures (Next runs both during build).

- [ ] **Step 2: Run the test suite**

Run: `npm run test`
Expected: all existing vitest suites pass (none touch `DashboardPage`, so this confirms no collateral breakage).

- [ ] **Step 3: Format check**

Run: `npm run format:check`
Expected: all files formatted (the husky hook already formats staged files on commit; this is a final confirmation).

- [ ] **Step 4: Open a PR**

`main` is PR-gated. Push the branch and open a PR:
```bash
git push -u origin refactor/widget-config-two-pane
gh pr create --fill
```
Then let the build check pass and request review.

---

## Acceptance criteria (from spec)

1. Desktop: config cards in a 2-column left grid; preview + URL + collapsible OBS in a sticky right pane. ✅ Task 2
2. 연결 상태 card and both status alerts no longer render. ✅ Task 2 (Step 1 + Step 3)
3. OBS instructions are a `Collapsible`, collapsed by default. ✅ Task 2
4. Fadeout toggle is a shadcn `Switch` that enables/disables the slider. ✅ Task 2
5. Badge mode / font size still live-update preview and URL. ✅ Task 2 (logic unchanged) / verified Step 6
6. 복사 button and 위젯 열기 link still work. ✅ verified Task 2 Step 6
7. Narrow viewport collapses to single column (config first) with no overflow. ✅ Task 2 (`grid-cols-1` defaults) / verified Step 6
8. Existing tests pass; lint/format clean. ✅ Task 3
