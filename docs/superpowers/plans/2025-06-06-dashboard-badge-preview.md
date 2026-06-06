# Dashboard Badge Mode Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time badge mode previews and an animated widget preview to the `/dashboard` page using shadcn/ui components, while extracting shared components so the preview never drifts from the real widget.

**Architecture:** Extract `DjClassBadge`, `TheoryBadge`, and `ChatMessageRow` as shared components plus `src/lib/dj-class.ts` utilities. Build `BadgeModePreviewRow` (shadcn/ui RadioGroup) and `WidgetPreview` for the dashboard. Refactor both `WidgetPage` and `DashboardPage` to consume the shared pieces.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, Vitest

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/lib/dj-class.ts` | Shared constants (`DJ_CLASS_COLORS`, `SHORT_NAMES`, `RANK_THRESHOLDS`) and pure functions (`getThreshold`, `getDjClassColor`). |
| `src/lib/fake-chat-messages.ts` | Flat array of 20 fake `ChatMessage` objects. User-editable. No imports from app code. |
| `src/components/DjClassBadge.tsx` | Renders the colored DJ CLASS badge text for any mode. |
| `src/components/TheoryBadge.tsx` | Renders the glittering red `이론치` badge. Imports shared CSS module. |
| `src/components/theory-badge.module.css` | `@keyframes glitter` and `.theory-badge` styles. |
| `src/components/ChatMessageRow.tsx` | Combines `DjClassBadge` + `TheoryBadge` + message text. Used by both widget and preview. |
| `src/components/BadgeModePreviewRow.tsx` | shadcn/ui selectable row with label + real badge preview + sample text. |
| `src/components/WidgetPreview.tsx` | 400×200 dark container that animates fake messages using `ChatMessageRow`. |
| `src/components/WidgetPage.tsx` | Refactored to use `ChatMessageRow`. WebSocket logic unchanged. |
| `src/components/DashboardPage.tsx` | Refactored to use shadcn/ui Card/Input/Button/Badge/RadioGroup and new preview components. |
| `tests/dj-class.test.ts` | Unit tests for `getThreshold` and `getDjClassColor`. |
| `tests/components/DjClassBadge.test.tsx` | Component tests for badge rendering in all 3 modes. |

---

### Task 1: Install shadcn/ui RadioGroup component

**Files:**
- Modify: `package.json` (dependencies added by CLI)
- Create: `src/components/ui/radio-group.tsx`

- [ ] **Step 1: Install radio-group via shadcn CLI**

```bash
npx shadcn@latest add radio-group
```

Expected: installs `@radix-ui/react-radio-group` and creates `src/components/ui/radio-group.tsx`.

- [ ] **Step 2: Verify the file exists**

```bash
ls src/components/ui/radio-group.tsx
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/radio-group.tsx package.json package-lock.json
git commit -m "chore: add shadcn/ui radio-group component"
```

---

### Task 2: Create shared DJ CLASS utilities

**Files:**
- Create: `src/lib/dj-class.ts`
- Create: `tests/dj-class.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/dj-class.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getThreshold, getDjClassColor, DJ_CLASS_COLORS, SHORT_NAMES } from '../src/lib/dj-class'

describe('getThreshold', () => {
  it('returns default threshold for THE LORD OF DJMAX', () => {
    expect(getThreshold('THE LORD OF DJMAX', null)).toBe(9980)
  })

  it('returns level-specific threshold for SHOWSTOPPER II', () => {
    expect(getThreshold('SHOWSTOPPER', 'II')).toBe(9800)
  })

  it('returns null for unknown rank', () => {
    expect(getThreshold('UNKNOWN', 'I')).toBeNull()
  })
})

describe('getDjClassColor', () => {
  it('returns SHOWSTOPPER gradient', () => {
    expect(getDjClassColor('SHOWSTOPPER')).toBe(DJ_CLASS_COLORS['SHOWSTOPPER'])
  })

  it('returns BEGINNER fallback for unknown rank', () => {
    expect(getDjClassColor('UNKNOWN')).toBe(DJ_CLASS_COLORS['BEGINNER'])
  })
})

describe('SHORT_NAMES', () => {
  it('has SHOWSTOPPER as SS', () => {
    expect(SHORT_NAMES['SHOWSTOPPER']).toBe('SS')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/dj-class.test.ts
```

Expected: FAIL with module not found or function not defined errors.

- [ ] **Step 3: Create `src/lib/dj-class.ts`**

```typescript
// V-ARCHIVE DJ CLASS color scheme (from official wiki)
export const DJ_CLASS_COLORS: Record<string, string> = {
  'THE LORD OF DJMAX': 'linear-gradient(to right, #f2b2f7, #acebff)',
  'BEAT MAESTRO': 'linear-gradient(135deg, #ff7183, #ff8a9a)',
  'SHOWSTOPPER': 'linear-gradient(135deg, #ff856f, #ff9a87)',
  'HEADLINER': 'linear-gradient(135deg, #ff9758, #ffaa75)',
  'TREND SETTER': 'linear-gradient(135deg, #ffaf51, #ffbf70)',
  'PROFESSIONAL': 'linear-gradient(135deg, #ffd352, #ffdd70)',
  'HIGH CLASS': 'linear-gradient(135deg, #feff63, #feff85)',
  'PRO DJ': 'linear-gradient(135deg, #c7e644, #d1eb60)',
  'MIDDLEMAN': 'linear-gradient(135deg, #9ae28a, #a8e89c)',
  'STREET DJ': 'linear-gradient(135deg, #92eaca, #a2edd2)',
  'ROOKIE': 'linear-gradient(135deg, #78e3da, #8ee8e0)',
  'AMATEUR': 'linear-gradient(135deg, #8eccdb, #a2d6e2)',
  'TRAINEE': 'linear-gradient(135deg, #a9d0ee, #bdd8f0)',
  'BEGINNER': 'linear-gradient(135deg, #c0c0c0, #d0d0d0)',
}

// Short display names for DJ CLASS ranks
export const SHORT_NAMES: Record<string, string> = {
  'THE LORD OF DJMAX': 'LoD',
  'BEAT MAESTRO': 'BM',
  'SHOWSTOPPER': 'SS',
  'HEADLINER': 'HL',
  'TREND SETTER': 'TS',
  'PROFESSIONAL': 'PRO',
  'HIGH CLASS': 'HC',
  'PRO DJ': 'PD',
  'MIDDLEMAN': 'MM',
  'STREET DJ': 'SD',
  'ROOKIE': 'RK',
  'AMATEUR': 'AM',
  'TRAINEE': 'TR',
  'BEGINNER': 'BG',
}

// Minimum power thresholds for each rank and level (from V-ARCHIVE wiki)
export const RANK_THRESHOLDS: Record<string, Record<string, number>> = {
  'THE LORD OF DJMAX': { default: 9980 },
  'BEAT MAESTRO': { 'IV': 9900, 'III': 9930, 'II': 9950, 'I': 9970 },
  'SHOWSTOPPER': { 'IV': 9700, 'III': 9750, 'II': 9800, 'I': 9850 },
  'HEADLINER': { 'IV': 9400, 'III': 9500, 'II': 9600, 'I': 9650 },
  'TREND SETTER': { 'IV': 9000, 'III': 9100, 'II': 9200, 'I': 9300 },
  'PROFESSIONAL': { 'IV': 8600, 'III': 8700, 'II': 8800, 'I': 8900 },
  'HIGH CLASS': { 'IV': 7800, 'III': 8000, 'II': 8200, 'I': 8400 },
  'PRO DJ': { 'IV': 7000, 'III': 7200, 'II': 7400, 'I': 7600 },
  'MIDDLEMAN': { 'IV': 6200, 'III': 6400, 'II': 6600, 'I': 6800 },
  'STREET DJ': { 'IV': 5200, 'III': 5500, 'II': 5800, 'I': 6000 },
  'ROOKIE': { 'IV': 4000, 'III': 4300, 'II': 4600, 'I': 4900 },
  'AMATEUR': { 'IV': 2400, 'III': 2800, 'II': 3200, 'I': 3600 },
  'TRAINEE': { 'IV': 500, 'III': 1000, 'II': 1500, 'I': 2000 },
  'BEGINNER': { default: 0 },
}

export function getThreshold(rankName: string, rankLevel: string | null): number | null {
  const thresholds = RANK_THRESHOLDS[rankName]
  if (!thresholds) return null
  if (thresholds.default != null) return thresholds.default
  if (rankLevel && thresholds[rankLevel] != null) return thresholds[rankLevel]
  return null
}

export function getDjClassColor(rankName: string): string {
  return DJ_CLASS_COLORS[rankName] || DJ_CLASS_COLORS['BEGINNER']
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/dj-class.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dj-class.ts tests/dj-class.test.ts
git commit -m "feat: extract shared DJ CLASS utilities and add tests"
```

---

### Task 3: Create DjClassBadge component

**Files:**
- Create: `src/components/DjClassBadge.tsx`
- Create: `tests/components/DjClassBadge.test.tsx`
- Modify: `package.json`

- [ ] **Step 1: Install testing-library for React**

```bash
npm install -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Write failing test**

Create `tests/components/DjClassBadge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DjClassBadge from '../../src/components/DjClassBadge'

describe('DjClassBadge', () => {
  const baseProps = {
    djClass: '4B SHOWSTOPPER II',
    rankShort: 'SS',
    rankLevel: 'II',
    powerInteger: 9823,
  }

  it('renders short mode', () => {
    render(<DjClassBadge mode="short" {...baseProps} />)
    expect(screen.getByText('4B SS II')).toBeInTheDocument()
  })

  it('renders threshold mode', () => {
    render(<DjClassBadge mode="threshold" {...baseProps} />)
    expect(screen.getByText('4B 9800+')).toBeInTheDocument()
  })

  it('renders power mode', () => {
    render(<DjClassBadge mode="power" {...baseProps} />)
    expect(screen.getByText('4B 9823')).toBeInTheDocument()
  })

  it('returns null when rankShort is null', () => {
    const { container } = render(<DjClassBadge mode="short" djClass={null} rankShort={null} rankLevel={null} powerInteger={null} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/components/DjClassBadge.test.tsx
```

Expected: FAIL with module not found.

- [ ] **Step 4: Create `src/components/DjClassBadge.tsx`**

```typescript
import type { BadgeMode } from '@/lib/types'
import { getThreshold, getDjClassColor } from '@/lib/dj-class'

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

  const buttonMatch = djClass?.match(/^(\d+B)/)
  const buttonPrefix = buttonMatch ? buttonMatch[1] : ''

  const rankName = djClass
    ?.replace(/^\d+B\s+/, '')
    .replace(/\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
    .trim() || 'BEGINNER'

  let badgeText: string

  if (mode === 'short') {
    badgeText = `${buttonPrefix} ${rankShort}${rankLevel ? ` ${rankLevel}` : ''}`
  } else if (mode === 'threshold') {
    const levelMatch = djClass?.match(/\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i)
    const resolvedLevel = levelMatch ? levelMatch[1] : null
    const threshold = getThreshold(rankName, resolvedLevel)
    badgeText = threshold != null
      ? `${buttonPrefix} ${threshold}+`
      : `${buttonPrefix} ${rankShort}`
  } else if (mode === 'power') {
    badgeText = `${buttonPrefix} ${powerInteger ?? 0}`
  } else {
    badgeText = `${buttonPrefix} ${rankShort}`
  }

  return (
    <span
      className="inline-block px-1 py-0.5 rounded text-xs font-bold mr-1 shadow-sm"
      style={{
        background: getDjClassColor(rankName),
        color: '#000',
        textShadow: '0 0 1px rgba(255,255,255,0.5)',
      }}
    >
      {badgeText}
    </span>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/components/DjClassBadge.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DjClassBadge.tsx tests/components/DjClassBadge.test.tsx package.json package-lock.json
git commit -m "feat: add DjClassBadge shared component with tests"
```

---

### Task 4: Create TheoryBadge component with CSS module

**Files:**
- Create: `src/components/theory-badge.module.css`
- Create: `src/components/TheoryBadge.tsx`

- [ ] **Step 1: Create CSS module**

Create `src/components/theory-badge.module.css`:

```css
@keyframes glitter {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.theory-badge {
  background: linear-gradient(90deg, #ff0000, #ff6600, #ffcc00, #ff6600, #ff0000);
  background-size: 300% 300%;
  animation: glitter 2s ease infinite;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
  display: inline-block;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 700;
  margin-right: 0.25rem;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
```

- [ ] **Step 2: Create TheoryBadge component**

Create `src/components/TheoryBadge.tsx`:

```typescript
import styles from './theory-badge.module.css'

export default function TheoryBadge() {
  return <span className={styles['theory-badge']}>이론치</span>
}
```

- [ ] **Step 3: Verify build compiles**

```bash
npm run build
```

Expected: build succeeds (or at least TypeScript compilation passes; full build may need dev server running).

If build fails due to CSS module typing, create `src/components/theory-badge.module.css.d.ts`:

```typescript
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/theory-badge.module.css src/components/TheoryBadge.tsx
git commit -m "feat: add TheoryBadge component with CSS module"
```

---

### Task 5: Create ChatMessageRow component

**Files:**
- Create: `src/components/ChatMessageRow.tsx`

- [ ] **Step 1: Create ChatMessageRow component**

Create `src/components/ChatMessageRow.tsx`:

```typescript
import type { BadgeMode } from '@/lib/types'
import DjClassBadge from './DjClassBadge'
import TheoryBadge from './TheoryBadge'

export interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  isTheory: boolean
  text: string
  isUnlinked: boolean
}

interface ChatMessageRowProps {
  message: ChatMessage
  badgeMode: BadgeMode
}

export default function ChatMessageRow({ message, badgeMode }: ChatMessageRowProps) {
  return (
    <div
      className={`text-sm break-words ${
        message.isUnlinked ? 'opacity-75' : 'opacity-100'
      }`}
    >
      {message.rankShort && (
        <DjClassBadge
          mode={badgeMode}
          djClass={message.djClass}
          rankShort={message.rankShort}
          rankLevel={message.rankLevel}
          powerInteger={message.powerInteger}
        />
      )}
      {message.isTheory && <TheoryBadge />}
      <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {message.text}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatMessageRow.tsx
git commit -m "feat: add ChatMessageRow shared component"
```

---

### Task 6: Refactor WidgetPage to use shared components

**Files:**
- Modify: `src/components/WidgetPage.tsx`

- [ ] **Step 1: Update imports and remove extracted code**

Replace the top of `WidgetPage.tsx` (lines 1–93) with:

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'
import ChatMessageRow, { type ChatMessage } from './ChatMessageRow'

interface PendingMessage {
  id: string
  senderId: string
  senderNickname: string
  messageText: string
}

interface WidgetPageProps {
  channelId: string
}
```

Remove the following from `WidgetPage.tsx`:
- `DJ_CLASS_COLORS` constant
- `SHORT_NAMES` constant
- `RANK_THRESHOLDS` constant
- `getThreshold` function
- `getDjClassColor` function
- The inline `ChatMessage` interface (now imported from `ChatMessageRow`)

- [ ] **Step 2: Replace inline badge rendering**

Find the message map block (around lines 333–388 in the original) and replace it with:

```tsx
<div className="flex flex-col justify-end h-full px-2 py-2 space-y-1">
  {messages.map((msg) => (
    <ChatMessageRow
      key={msg.id}
      message={msg}
      badgeMode={badgeModeRef.current}
    />
  ))}
  <div ref={messagesEndRef} />
</div>
```

Also remove the `<style jsx global>` block (the `.theory-badge` animation is now in the CSS module).

- [ ] **Step 3: Verify the file still compiles**

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors in `src/components/WidgetPage.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/WidgetPage.tsx
git commit -m "refactor: WidgetPage uses shared ChatMessageRow and extracted utilities"
```

---

### Task 7: Create fake chat messages file

**Files:**
- Create: `src/lib/fake-chat-messages.ts`

- [ ] **Step 1: Create the file with user-modifiable array**

Create `src/lib/fake-chat-messages.ts`:

```typescript
import type { ChatMessage } from '@/components/ChatMessageRow'

export const FAKE_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'fake-1',
    djClass: '4B SHOWSTOPPER II',
    rankShort: 'SS',
    rankLevel: 'II',
    powerInteger: 9823,
    isTheory: false,
    text: '안녕하세요',
    isUnlinked: false,
  },
  {
    id: 'fake-2',
    djClass: '6B SHOWSTOPPER I',
    rankShort: 'SS',
    rankLevel: 'I',
    powerInteger: 9888,
    isTheory: false,
    text: '이거 쉽던데',
    isUnlinked: false,
  },
  {
    id: 'fake-3',
    djClass: '5B STREET DJ IV',
    rankShort: 'SD',
    rankLevel: 'IV',
    powerInteger: 5342,
    isTheory: false,
    text: '처음 왔어요 잘 부탁드려요',
    isUnlinked: false,
  },
  {
    id: 'fake-4',
    djClass: '8B PRO DJ III',
    rankShort: 'PD',
    rankLevel: 'III',
    powerInteger: 7337,
    isTheory: false,
    text: '신청곡 넣어도 되나요?',
    isUnlinked: false,
  },
  {
    id: 'fake-5',
    djClass: '6B HEADLINER II',
    rankShort: 'HL',
    rankLevel: 'II',
    powerInteger: 9600,
    isTheory: false,
    text: '망이조아',
    isUnlinked: false,
  },
  {
    id: 'fake-6',
    djClass: '4B THE LORD OF DJMAX',
    rankShort: 'LoD',
    rankLevel: null,
    powerInteger: 10000,
    isTheory: true,
    text: 'ㅎㅇ',
    isUnlinked: false,
  },
  {
    id: 'fake-7',
    djClass: '5B PROFESSIONAL II',
    rankShort: 'PRO',
    rankLevel: 'II',
    powerInteger: 8800,
    isTheory: true,
    text: '스코어 인증 완료했습니다',
    isUnlinked: false,
  },
  {
    id: 'fake-8',
    djClass: '6B AMATEUR III',
    rankShort: 'AM',
    rankLevel: 'III',
    powerInteger: 2800,
    isTheory: false,
    text: '로페바이럴',
    isUnlinked: false,
  },
  {
    id: 'fake-9',
    djClass: '8B MIDDLEMAN I',
    rankShort: 'MM',
    rankLevel: 'I',
    powerInteger: 6999,
    isTheory: false,
    text: '잘 좀 해봐요',
    isUnlinked: false,
  },
  {
    id: 'fake-10',
    djClass: '4B ROOKIE II',
    rankShort: 'RK',
    rankLevel: 'II',
    powerInteger: 4600,
    isTheory: false,
    text: '키보드 혹시 뭔가요?',
    isUnlinked: false,
  },
  {
    id: 'fake-11',
    djClass: '5B BEGINNER',
    rankShort: 'BG',
    rankLevel: null,
    powerInteger: 652,
    isTheory: false,
    text: '이거 좀 어렵...',
    isUnlinked: false,
  },
  {
    id: 'fake-12',
    djClass: '6B HIGH CLASS I',
    rankShort: 'HC',
    rankLevel: 'I',
    powerInteger: 8400,
    isTheory: false,
    text: '오늘도 래더 하시나요?',
    isUnlinked: false,
  },
  {
    id: 'fake-13',
    djClass: '8B BEAT MAESTRO IV',
    rankShort: 'BM',
    rankLevel: 'IV',
    powerInteger: 9900,
    isTheory: false,
    text: '지린다 ㄷㄷ',
    isUnlinked: false,
  },
  {
    id: 'fake-14',
    djClass: '4B TRAINEE I',
    rankShort: 'TR',
    rankLevel: 'I',
    powerInteger: 2000,
    isTheory: false,
    text: '반가워요',
    isUnlinked: false,
  },
  {
    id: 'fake-15',
    djClass: '5B PROFESSIONAL I',
    rankShort: 'PRO',
    rankLevel: 'I',
    powerInteger: 8900,
    isTheory: false,
    text: '연타를 변기에 넣고 내려',
    isUnlinked: false,
  },
  {
    id: 'fake-16',
    djClass: null,
    rankShort: null,
    rankLevel: null,
    powerInteger: null,
    isTheory: false,
    text: 'ㅁㅁㅁㅁㄷㄴㅅ',
    isUnlinked: true,
  },
  {
    id: 'fake-17',
    djClass: '4B STREET DJ III',
    rankShort: 'SD',
    rankLevel: 'III',
    powerInteger: 5704,
    isTheory: false,
    text: '방금 어케 친거임',
    isUnlinked: false,
  },
  {
    id: 'fake-18',
    djClass: '8B SHOWSTOPPER III',
    rankShort: 'SS',
    rankLevel: 'III',
    powerInteger: 9750,
    isTheory: true,
    text: '퍼펙 ㅊㅊㅊㅊㅊ',
    isUnlinked: false,
  },
  {
    id: 'fake-19',
    djClass: null,
    rankShort: null,
    rankLevel: null,
    powerInteger: null,
    isTheory: false,
    text: '탭소닉은다시돌아온다',
    isUnlinked: true,
  },
  {
    id: 'fake-20',
    djClass: '6B ROOKIE I',
    rankShort: 'RK',
    rankLevel: 'I',
    powerInteger: 4943,
    isTheory: false,
    text: '혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ',
    isUnlinked: false,
  },
]
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fake-chat-messages.ts
git commit -m "feat: add fake chat messages for widget preview"
```

---

### Task 8: Create BadgeModePreviewRow component

**Files:**
- Create: `src/components/BadgeModePreviewRow.tsx`

- [ ] **Step 1: Create component using shadcn/ui**

Create `src/components/BadgeModePreviewRow.tsx`:

```typescript
import type { BadgeMode } from '@/lib/types'
import DjClassBadge from './DjClassBadge'
import { RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface BadgeModePreviewRowProps {
  mode: BadgeMode
  label: string
}

const EXAMPLE_DJ_CLASS = '4B SHOWSTOPPER II'
const EXAMPLE_RANK_SHORT = 'SS'
const EXAMPLE_RANK_LEVEL = 'II'
const EXAMPLE_POWER_INTEGER = 9823

export default function BadgeModePreviewRow({
  mode,
  label,
}: BadgeModePreviewRowProps) {
  return (
    <Label
      htmlFor={`badge-mode-${mode}`}
      className={cn(
        'flex items-center justify-between w-full rounded-lg border p-3 transition-colors cursor-pointer',
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
        'border-border bg-card hover:bg-accent/50'
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex items-center gap-1.5 text-sm">
          <DjClassBadge
            mode={mode}
            djClass={EXAMPLE_DJ_CLASS}
            rankShort={EXAMPLE_RANK_SHORT}
            rankLevel={EXAMPLE_RANK_LEVEL}
            powerInteger={EXAMPLE_POWER_INTEGER}
          />
          <span className="text-muted-foreground">안녕하세요</span>
        </div>
      </div>
      <RadioGroupItem
        value={mode}
        id={`badge-mode-${mode}`}
        className="shrink-0"
      />
    </Label>
  )
}
```

> Note: Uses shadcn/ui `RadioGroupItem` for the native radio indicator and `Label` for the clickable row. The `has-[[data-state=checked]]` Tailwind selector styles the entire row when the radio inside is checked, giving us full-row selection with proper accessibility.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/BadgeModePreviewRow.tsx
git commit -m "feat: add BadgeModePreviewRow component with shadcn/ui styling"
```

---

### Task 9: Create WidgetPreview component

**Files:**
- Create: `src/components/WidgetPreview.tsx`

- [ ] **Step 1: Create WidgetPreview component**

Create `src/components/WidgetPreview.tsx`:

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'
import type { ChatMessage } from './ChatMessageRow'
import ChatMessageRow from './ChatMessageRow'
import { FAKE_CHAT_MESSAGES } from '@/lib/fake-chat-messages'

interface WidgetPreviewProps {
  badgeMode: BadgeMode
}

const MAX_VISIBLE_MESSAGES = 15

function getRandomInterval(): number {
  return Math.random() * 700 + 500 // 500–1200 ms
}

export default function WidgetPreview({ badgeMode }: WidgetPreviewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const indexRef = useRef(0)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const addNextMessage = () => {
      setMessages((prev) => {
        const nextMessage = FAKE_CHAT_MESSAGES[indexRef.current]
        indexRef.current = (indexRef.current + 1) % FAKE_CHAT_MESSAGES.length
        const next = [...prev, nextMessage]
        if (next.length > MAX_VISIBLE_MESSAGES) {
          next.shift()
        }
        return next
      })

      timeoutRef.current = setTimeout(addNextMessage, getRandomInterval())
    }

    // Start the first message after a short delay
    timeoutRef.current = setTimeout(addNextMessage, 500)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // When badgeMode changes, the component re-renders and ChatMessageRow
  // receives the new mode automatically. No extra effect needed.

  return (
    <div
      className="rounded-lg overflow-hidden bg-gray-900"
      style={{ width: 400, height: 200, fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
      <div className="flex flex-col justify-end h-full px-2 py-2 space-y-1">
        {messages.map((msg) => (
          <ChatMessageRow
            key={`${msg.id}-${badgeMode}`}
            message={msg}
            badgeMode={badgeMode}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/WidgetPreview.tsx
git commit -m "feat: add WidgetPreview component with looping fake chat"
```

---

### Task 10: Refactor DashboardPage with shadcn/ui and previews

**Files:**
- Modify: `src/components/DashboardPage.tsx`

- [ ] **Step 1: Update imports**

Add these imports to the top of `DashboardPage.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { RadioGroup } from '@/components/ui/radio-group'
import BadgeModePreviewRow from './BadgeModePreviewRow'
import WidgetPreview from './WidgetPreview'
```

- [ ] **Step 2: Replace badge mode selector**

Find the current badge mode card (lines 139–161) and replace with:

```tsx
<Card>
  <CardHeader>
    <CardTitle>뱃지 모드</CardTitle>
    <CardDescription>위젯에 표시할 DJ CLASS 뱃지 스타일을 선택하세요.</CardDescription>
  </CardHeader>
  <CardContent className="space-y-2">
    <RadioGroup
      value={badgeMode}
      onValueChange={(value) => handleSetBadgeMode(value as BadgeMode)}
      className="space-y-2"
    >
      {(Object.keys(BADGE_MODE_LABELS) as BadgeMode[]).map((mode) => (
        <BadgeModePreviewRow
          key={mode}
          mode={mode}
          label={BADGE_MODE_LABELS[mode]}
        />
      ))}
    </RadioGroup>
    <p className="mt-2 text-xs text-muted-foreground">
      현재 선택: <span className="font-semibold">{BADGE_MODE_LABELS[badgeMode]}</span>
    </p>
  </CardContent>
</Card>
```

- [ ] **Step 3: Add widget preview card**

After the badge mode card (before the connection status card), insert:

```tsx
<Card>
  <CardHeader>
    <CardTitle>위젯 미리보기</CardTitle>
    <CardDescription>실제 위젯 화면 미리보기 (400×200)</CardDescription>
  </CardHeader>
  <CardContent className="flex flex-col items-center space-y-3">
    <WidgetPreview badgeMode={badgeMode} />
    <p className="text-xs text-muted-foreground text-center">
      가짜 채팅 메시지가 500~1200ms 간격으로 자동으로 표시됩니다
    </p>
  </CardContent>
</Card>
```

- [ ] **Step 4: Refactor connection status badges to shadcn/ui Badge**

Find the connection status spans (lines 171–177 and 181–187) and replace with:

```tsx
<Badge variant={data.hasTokens ? 'default' : 'destructive'}>
  {data.hasTokens ? '완료' : '미완료'}
</Badge>
```

and

```tsx
<Badge variant={data.isConnected ? 'default' : 'secondary'}>
  {data.isConnected ? '연결됨' : '대기 중'}
</Badge>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/DashboardPage.tsx
git commit -m "feat: dashboard badge mode previews and widget preview"
```

---

### Task 11: Run full test suite and verify build

**Files:**
- Run: all tests

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests PASS. If any fail, fix the issue before proceeding.

- [ ] **Step 2: Build the project**

```bash
npm run build
```

Expected: Build completes successfully.

- [ ] **Step 3: Final commit (if any fixes were needed)**

If any test or build fixes were made:

```bash
git add -A
git commit -m "fix: address test and build issues from preview feature"
```

---

## Spec Coverage Check

| Spec Requirement | Plan Task |
|---|---|
| Show real badge preview for each of 3 modes | Task 8 (BadgeModePreviewRow) + Task 10 (Dashboard integration) |
| Live 400×200 widget preview with fake chat | Task 9 (WidgetPreview) + Task 10 (Dashboard integration) |
| Preview never drifts from real widget | Task 3-6 (shared DjClassBadge, TheoryBadge, ChatMessageRow) |
| All dashboard UI with shadcn/ui | Task 1 (install radio-group primitives), Task 8, Task 10 |
| Easily modifiable fake chat list | Task 7 (flat array in dedicated file) |
| Do not modify real widget behavior | Task 6 (only mechanical extraction, no logic changes) |
| No connection status in preview | Task 9 (WidgetPreview has no status indicator) |

## Placeholder Scan

- No "TBD", "TODO", or "implement later" strings.
- Every step contains complete code blocks or exact commands.
- All type names, function names, and file paths are consistent across tasks.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/YYYY-MM-DD-dashboard-badge-preview.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
