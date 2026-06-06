# Dashboard Badge Mode Preview Design

## Overview

Add a real-time badge mode preview and an animated widget preview to the `/dashboard` page so streamers can see exactly how DJ CLASS badges will look in OBS before copying the widget URL.

## Background

The current dashboard (`src/components/DashboardPage.tsx`) shows three text-only buttons for badge mode selection (`short`, `threshold`, `power`). Streamers have no visual feedback on what each mode looks like in the actual widget. This leads to trial-and-error: copy URL → open OBS → check → switch mode → repeat.

The widget page (`src/components/WidgetPage.tsx`) already renders badges with V-ARCHIVE color gradients, rank thresholds, and `이론치` theory badges. That rendering logic is currently embedded inside `WidgetPage` and cannot be reused.

## Goals

1. Show a real badge preview for each of the 3 modes in the Dashboard badge mode selector.
2. Show a live 400×200 widget preview that animates fake chat messages with the selected badge mode.
3. Ensure the preview never drifts from the real widget's rendering logic.

## Non-Goals

- Do not modify the real widget's appearance or behavior for OBS.
- Do not add a connection status indicator to the preview widget.
- Do not create a separate preview page (all on Dashboard).

## Design Principles

**shadcn/ui first:** All dashboard UI elements must be built with shadcn/ui primitives (Card, Button, RadioGroup, etc.) rather than plain Tailwind utility classes. If an existing dashboard component uses raw Tailwind for structure or interaction, refactor it to the closest shadcn/ui equivalent during this work. The widget page (OBS-facing) may keep its optimized inline styles since it is a transparent overlay, but any new shared component that appears on the dashboard should follow shadcn/ui patterns.

**Easily modifiable fake chat:** The fake message list in `src/lib/fake-chat-messages.ts` is the user's domain for personalization. The file must remain a flat, self-contained array export with no logic or imports from the rest of the app so it can be edited without risk.

## Architecture

### Extract Shared Components

Refactor `WidgetPage.tsx` to extract rendering logic into shared components so both `WidgetPage` and `DashboardPage` use the same code.

| Component             | File                                     | Purpose                                                                                                                |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DjClassBadge`        | `src/components/DjClassBadge.tsx`        | Renders the colored badge text. Props: `mode`, `djClass`, `rankShort`, `rankLevel`, `powerInteger`.                    |
| `TheoryBadge`         | `src/components/TheoryBadge.tsx`         | Renders the glittering red `이론치` badge. No props.                                                                   |
| `ChatMessageRow`      | `src/components/ChatMessageRow.tsx`      | Combines `DjClassBadge` + `TheoryBadge` + message text. Props match `ChatMessage` interface.                           |
| `BadgeModePreviewRow` | `src/components/BadgeModePreviewRow.tsx` | Dashboard-only. A selectable row with label + real `DjClassBadge` preview + sample text.                               |
| `WidgetPreview`       | `src/components/WidgetPreview.tsx`       | Dashboard-only. 400×200 container that renders `ChatMessageRow` items with fake data, dark background, auto-scrolling. |

### Data Flow

```
DashboardPage
├── BadgeModePreviewRow (×3) — user clicks → calls setBadgeMode
│   └── DjClassBadge (with fixed example data)
├── WidgetPreview — receives badgeMode, renders looping fake messages
│   └── ChatMessageRow (×N, fake data)
│       ├── DjClassBadge
│       └── TheoryBadge

WidgetPage (refactored)
└── ChatMessageRow (per real message)
    ├── DjClassBadge
    └── TheoryBadge
```

## Component Specifications

### DjClassBadge

**Props:**

```typescript
interface DjClassBadgeProps {
  mode: BadgeMode
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
}
````

**Logic:** Identical to the current inline logic in `WidgetPage` (the badge `<span>` content). To keep this logic testable without a DOM, it is extracted into a **pure function** `getBadgeText(mode, djClass, rankShort, rankLevel, powerInteger): string` in `src/lib/dj-class.ts`. `DjClassBadge` is then a thin presentational wrapper that calls `getBadgeText` for the text and `getDjClassColor(parseRankName(djClass))` for the background. This matches the existing node-based test suite (`tests/*.test.ts`) — no jsdom or testing-library is introduced.

`getBadgeText` behavior:

1. Extract button prefix (e.g., `4B`) from `djClass` via `/^(\d+B)/`.
2. If `mode === 'short'`: return `{buttonPrefix} {rankShort}{rankLevel ? ` ${rankLevel}` : ''}`.
3. If `mode === 'threshold'`: look up threshold via `getThreshold(rankName, rankLevel)` (rankName/level parsed from `djClass`). Return `{buttonPrefix} {threshold}+` or fallback to `{buttonPrefix} {rankShort}`.
4. If `mode === 'power'`: return `{buttonPrefix} {powerInteger ?? 0}`.

`parseRankName(djClass)` strips the button prefix and trailing roman-numeral level, returning the rank name (or `'BEGINNER'` when absent). Both `getBadgeText` and the color lookup use it.

**Styling:** Same inline `background` gradient (from `DJ_CLASS_COLORS`), `color: '#000'`, `textShadow`, `inline-block px-1 py-0.5 rounded text-xs font-bold mr-1 shadow-sm`.

### TheoryBadge

**Props:** None.

**Styling:** Same `.theory-badge` class with glitter animation. Inline `<style jsx global>` remains in `WidgetPage` only; `TheoryBadge` should inject its own `<style jsx>` or use a regular CSS class that `WidgetPage` also imports.

> **Decision:** Use a shared CSS module (`src/components/theory-badge.module.css`) to avoid duplicating the `@keyframes glitter` definition. Both `WidgetPage` and `DashboardPage` import it.

### ChatMessageRow

**Props:**

```typescript
interface ChatMessageRowProps {
  message: ChatMessage
  badgeMode: BadgeMode
}
```

Where `ChatMessage` is the existing interface from `WidgetPage`.

**Rendering:**

- Conditionally render `DjClassBadge` if `message.rankShort` exists.
- Conditionally render `TheoryBadge` if `message.isTheory` is true.
- Render message text with `text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]`.
- Apply `opacity-75` if `message.isUnlinked`.

### BadgeModePreviewRow

**Props:**

```typescript
interface BadgeModePreviewRowProps {
  mode: BadgeMode
  label: string
  isSelected: boolean
  onSelect: () => void
}
```

**Rendering:**

- Built on shadcn/ui `RadioGroup` / `RadioGroupItem` primitives (or custom row that matches the same accessibility/keyboard behavior). Do not use raw styled `<div>` radio indicators.
- Label text above the preview line using shadcn/ui `Label`.
- Preview line: `DjClassBadge` with fixed example data + the Korean text "안녕하세요".
- Example data (hardcoded):
  - `djClass`: `"4B SHOWSTOPPER II"`
  - `rankShort`: `"SS"`
  - `rankLevel`: `"II"`
  - `powerInteger`: `9823`

### WidgetPreview

**Props:**

```typescript
interface WidgetPreviewProps {
  badgeMode: BadgeMode
}
```

**Container:** 400px × 200px, dark background (`#111827` or similar), rounded corners, overflow hidden.

**Message list:** Flex column, justify-end, 8px padding. Messages appear from the bottom and scroll up.

**Fake messages:** 20 hardcoded `ChatMessage` objects. The list cycles: after the last message, start from the first again. Messages include a mix of:

- Various ranks (BEGINNER, TRAINEE, AMATEUR, ROOKIE, STREET DJ, MIDDLEMAN, PRO DJ, HIGH CLASS, PROFESSIONAL, TREND SETTER, HEADLINER, SHOWSTOPPER, BEAT MAESTRO)
- Different button counts (4B, 5B, 6B, 8B)
- At least one `이론치` message
- A mix of linked and unlinked messages
- Varied Korean chat text

**Timing:** `useEffect` interval. Each message is added every 500–1200 ms (random, `Math.random() * 700 + 500`). Start with an empty message list. After reaching 15 visible messages, drop the oldest as new ones arrive. When the 20th message is shown, the next cycle begins from message #1.

**Message content (20 fake messages):**

| #   | Text                                                  | Rank              | Level | Power | Button | Theory | Unlinked |
| --- | ----------------------------------------------------- | ----------------- | ----- | ----- | ------ | ------ | -------- |
| 1   | 안녕하세요                                            | SHOWSTOPPER       | II    | 9823  | 4B     | No     | No       |
| 2   | 이거 쉽던데                                           | SHOWSTOPPER       | I     | 9888  | 6B     | No     | No       |
| 3   | 처음 왔어요 잘 부탁드려요                             | STREET DJ         | IV    | 5342  | 5B     | No     | No       |
| 4   | 신청곡 넣어도 되나요?                                 | PRO DJ            | III   | 7337  | 8B     | No     | No       |
| 5   | 망이조아                                              | HEADLINER         | II    | 9600  | 6B     | No     | No       |
| 6   | ㅎㅇ                                                  | THE LORD OF DJMAX | —     | 10000 | 4B     | Yes    | No       |
| 7   | 스코어 인증 완료했습니다                              | PROFESSIONAL      | II    | 8800  | 5B     | No     | No       |
| 8   | 로페바이럴                                            | AMATEUR           | III   | 2800  | 6B     | No     | No       |
| 9   | 잘 좀 해봐요                                          | MIDDLEMAN         | I     | 6999  | 8B     | No     | No       |
| 10  | 키보드 혹시 뭔가요?                                   | ROOKIE            | II    | 4600  | 4B     | No     | No       |
| 11  | 이거 좀 어렵...                                       | BEGINNER          | —     | 652   | 5B     | No     | No       |
| 12  | 오늘도 래더 하시나요?                                 | HIGH CLASS        | I     | 8400  | 6B     | No     | No       |
| 13  | 지린다 ㄷㄷ                                           | BEAT MAESTRO      | IV    | 9900  | 8B     | No     | No       |
| 14  | 반가워요                                              | TRAINEE           | I     | 2000  | 4B     | No     | No       |
| 15  | 연타를 변기에 넣고 내려                               | PROFESSIONAL      | I     | 8900  | 5B     | No     | No       |
| 16  | ㅁㅁㅁㅁㄷㄴㅅ                                        | —                 | —     | —     | —      | No     | Yes      |
| 17  | 방금 어케 친거임                                      | STREET DJ         | III   | 5704  | 4B     | No     | No       |
| 18  | 퍼펙 ㅊㅊㅊㅊㅊ                                       | SHOWSTOPPER       | III   | 9750  | 8B     | No     | No       |
| 19  | 탭소닉은다시돌아온다                                  | —                 | —     | —     | —      | No     | Yes      |
| 20  | 혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ | ROOKIE            | I     | 4943  | 6B     | No     | No       |

> Note: The user will modify these messages later. The list should be defined in a separate file (`src/lib/fake-chat-messages.ts`) so it's easy to edit without touching component logic.

## DashboardPage Changes

Replace the current horizontal 3-button badge mode selector with a vertical stack of `BadgeModePreviewRow` components.

Add a new Card below the badge mode card containing the `WidgetPreview`.

### State Management

`badgeMode` state (`'short' | 'threshold' | 'power'`) remains in `DashboardPage`. It is passed to:

- `getWidgetUrl()` (already done)
- `WidgetPreview` (new)
- Each `BadgeModePreviewRow` via `isSelected`

## WidgetPage Refactoring

1. Move `ChatMessage`, `DJ_CLASS_COLORS`, `SHORT_NAMES`, `RANK_THRESHOLDS`, `getThreshold`, `getDjClassColor`, cache types and functions to shared utility files or keep them in `WidgetPage` if not needed by shared components.
2. `DJ_CLASS_COLORS`, `SHORT_NAMES`, `RANK_THRESHOLDS`, `getThreshold`, `getDjClassColor` must be exported so `DjClassBadge` can import them.
3. Replace inline badge rendering (lines 340–383) with `<ChatMessageRow message={msg} badgeMode={badgeModeRef.current} />`.
4. Keep the `<style jsx global>` for `.theory-badge` animation, or import the shared CSS module.

## Shared Utilities

Create `src/lib/dj-class.ts` containing:

- `DJ_CLASS_COLORS`
- `SHORT_NAMES`
- `RANK_THRESHOLDS`
- `getThreshold(rankName, rankLevel)`
- `getDjClassColor(rankName)`

Both `WidgetPage` and `DjClassBadge` import from here.

## Styling Notes

- `WidgetPreview` uses a dark background to simulate the transparent OBS widget over a dark scene. The `ChatMessageRow` inside it should use the same text-shadow and white text as the real widget.
- `BadgeModePreviewRow` is wrapped in a shadcn/ui `Card` or styled as a selectable row within a `RadioGroup`.
- The radio indicator in `BadgeModePreviewRow` uses shadcn/ui `RadioGroupItem` (or a custom indicator that follows the same design tokens). Do not use a hand-rolled CSS circle.
- Any layout spacing on the dashboard uses shadcn/ui `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` instead of raw margin/padding utilities where possible.
- If existing dashboard elements (e.g., the URL copy input/button, connection status badges) are using plain Tailwind, refactor them to shadcn/ui `Input`, `Button`, and `Badge` components during this work.

## Testing Strategy

Tests run in the existing node-based Vitest setup (no jsdom/testing-library added).

- **Unit (automated):** `getBadgeText` returns the correct string for all 3 modes with example data (`4B SS II`, `4B 9800+`, `4B 9823`), and `parseRankName` / `getThreshold` / `getDjClassColor` behave correctly including fallbacks.
- **Manual:** `WidgetPreview` loops through all fake messages and restarts; the interval is between 500–1200 ms; changing badge mode in `DashboardPage` updates both the preview rows and the `WidgetPreview` instantly; the real widget (`WidgetPage`) still renders after refactoring (verified via `npm run build` + visual check).

## Rollout / Risks

**Risk:** Refactoring `WidgetPage` could introduce a regression in the OBS widget.
**Mitigation:** The extraction is mechanical (move functions and inline JSX into standalone components). No logic changes. Test the widget page directly after refactoring.

## Files to Create / Modify

| Action | File                                                                |
| ------ | ------------------------------------------------------------------- |
| Create | `src/components/ui/radio-group.tsx` (shadcn CLI)                    |
| Create | `src/components/ui/badge.tsx` (shadcn CLI)                          |
| Create | `src/lib/dj-class.ts` (incl. `getBadgeText`, `parseRankName`)       |
| Create | `src/lib/fake-chat-messages.ts`                                     |
| Create | `src/components/DjClassBadge.tsx`                                   |
| Create | `src/components/TheoryBadge.tsx` + CSS module                       |
| Create | `src/components/ChatMessageRow.tsx`                                 |
| Create | `src/components/BadgeModePreviewRow.tsx`                            |
| Create | `src/components/WidgetPreview.tsx`                                  |
| Modify | `src/components/WidgetPage.tsx` (refactor to use shared components) |
| Modify | `src/components/DashboardPage.tsx` (add previews)                   |
| Create | `src/components/theory-badge.module.css`                            |
