# Chat Emoji Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `{:emojiKey:}` placeholders in Chzzk chat messages with the actual emoticon images.

**Architecture:** The server forwards the raw `emojis` map (emojiKey → image URL) untouched over the widget WebSocket. The client parses `{:key:}` placeholders into a pure ordered array of text/emoji parts, and React renders emoji parts as inline `<img>` at text height. A placeholder with no matching key is dropped.

**Tech Stack:** TypeScript, Next.js (React), socket.io-client (server→Chzzk), native WebSocket (server→widget), vitest.

---

## File Structure

- **Create** `src/lib/emoji.ts` — pure `parseEmojiContent` tokenizer + `EmojiPart` type. Sole owner of the placeholder syntax.
- **Create** `tests/emoji.test.ts` — unit tests for the tokenizer.
- **Modify** `src/lib/chat-proxy.ts` — extract `parsed.emojis` in the `CHAT` handler and forward it on the WS payload.
- **Modify** `src/components/ChatMessageRow.tsx` — add `emojis` to the client `ChatMessage` type and render parsed parts.
- **Modify** `src/components/WidgetPage.tsx` — carry `emojis` from the WS payload through the pending queue onto the `ChatMessage`.

Tasks are ordered so each type/field exists before a later task consumes it.

---

### Task 1: Pure emoji tokenizer

**Files:**
- Create: `src/lib/emoji.ts`
- Test: `tests/emoji.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/emoji.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEmojiContent } from '../src/lib/emoji'

const MAP = {
  d_07: 'https://cdn.example/d_07.png',
  cat: 'https://cdn.example/cat.png',
}

describe('parseEmojiContent', () => {
  it('returns a single text part when there are no placeholders', () => {
    expect(parseEmojiContent('hello world', MAP)).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('resolves a single placeholder to an emoji part', () => {
    expect(parseEmojiContent('hi {:cat:}', MAP)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
    ])
  })

  it('resolves multiple placeholders interleaved with text', () => {
    expect(parseEmojiContent('a {:cat:} b {:d_07:} c', MAP)).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'text', value: ' b ' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
      { type: 'text', value: ' c' },
    ])
  })

  it('handles adjacent placeholders with no text between', () => {
    expect(parseEmojiContent('{:cat:}{:d_07:}', MAP)).toEqual([
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
    ])
  })

  it('handles a placeholder at the start and at the end', () => {
    expect(parseEmojiContent('{:cat:} mid {:d_07:}', MAP)).toEqual([
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'text', value: ' mid ' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
    ])
  })

  it('drops a placeholder whose key is not in the map', () => {
    expect(parseEmojiContent('hi {:nope:} there', MAP)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'text', value: ' there' },
    ])
  })

  it('drops all placeholders when the map is empty, keeping text', () => {
    expect(parseEmojiContent('hi {:cat:} there', {})).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'text', value: ' there' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- emoji`
Expected: FAIL — `Failed to resolve import "../src/lib/emoji"` / `parseEmojiContent is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/emoji.ts`:

```ts
export type EmojiPart =
  | { type: 'text'; value: string }
  | { type: 'emoji'; key: string; url: string }

const PLACEHOLDER = /\{:([\w-]+):\}/g

/**
 * Tokenizes Chzzk chat `content` into an ordered list of text and emoji parts.
 * `{:key:}` placeholders are replaced by emoji parts when `key` is present in
 * `emojis`; unmatched placeholders are dropped (per design).
 */
export function parseEmojiContent(
  content: string,
  emojis: Record<string, string>
): EmojiPart[] {
  const parts: EmojiPart[] = []
  let lastIndex = 0
  // Reset because the regex is module-scoped and stateful (global flag).
  PLACEHOLDER.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER.exec(content)) !== null) {
    const [placeholder, key] = match
    const start = match.index

    if (start > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, start) })
    }

    const url = emojis[key]
    if (url) {
      parts.push({ type: 'emoji', key, url })
    }
    // Unmatched key: drop the placeholder (emit nothing).

    lastIndex = start + placeholder.length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return parts
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- emoji`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/emoji.ts tests/emoji.test.ts
git commit -m "feat: add pure emoji placeholder tokenizer"
```

---

### Task 2: Forward the `emojis` map from the server

**Files:**
- Modify: `src/lib/chat-proxy.ts:9-15` (ChatMessage interface)
- Modify: `src/lib/chat-proxy.ts:274-309` (CHAT handler)

No automated test — `chat-proxy.ts` has no socket-handler test harness in this repo. Verification is a typecheck.

- [ ] **Step 1: Add `emojis` to the server `ChatMessage` interface**

In `src/lib/chat-proxy.ts`, change the interface (currently lines 9-15):

```ts
interface ChatMessage {
  channelId: string
  senderChannelId: string
  nickname: string
  content: string
  messageTime: number
  emojis: Record<string, string>
}
```

- [ ] **Step 2: Extract `parsed.emojis` in the CHAT handler**

In the `socket.on('CHAT', ...)` handler, immediately after this existing line (~line 288):

```ts
      const content = String(parsed.content ?? '')
```

add:

```ts
      const emojis =
        parsed.emojis && typeof parsed.emojis === 'object'
          ? (parsed.emojis as Record<string, string>)
          : {}
```

- [ ] **Step 3: Include `emojis` on the forwarded message**

In the same handler, change the `msg` object literal (currently ends at ~line 309) so it includes `emojis`:

```ts
      const msg: ChatMessage = {
        channelId: String(parsed.channelId ?? channelId),
        senderChannelId: String(
          profile?.senderChannelId ?? parsed.senderChannelId ?? ''
        ),
        nickname: sender,
        content,
        messageTime: Number(parsed.messageTime ?? Date.now()),
        emojis,
      }
```

(The `msg` is already serialized into the `{ type: 'chat', data: msg }` payload just below, so `data.emojis` now reaches the widget automatically.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-proxy.ts
git commit -m "feat: forward chat emojis map over widget websocket"
```

---

### Task 3: Render emoji parts in `ChatMessageRow`

**Files:**
- Modify: `src/components/ChatMessageRow.tsx:1-14` (imports + ChatMessage interface)
- Modify: `src/components/ChatMessageRow.tsx:52-54` (message text render)

- [ ] **Step 1: Import the parser and add `emojis` to the client `ChatMessage` type**

In `src/components/ChatMessageRow.tsx`, update the imports at the top:

```tsx
import type { BadgeMode } from '@/lib/types'
import { parseEmojiContent } from '@/lib/emoji'
import DjClassBadge from './DjClassBadge'
```

and add `emojis` to the exported interface:

```tsx
export interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  text: string
  emojis: Record<string, string>
  isUnverified: boolean
  createdAt?: number
  fading?: boolean
}
```

- [ ] **Step 2: Render parsed parts instead of the raw string**

Replace this block (currently lines 52-54):

```tsx
      <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {message.text}
      </span>
```

with:

```tsx
      <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {parseEmojiContent(message.text, message.emojis).map((part, i) =>
          part.type === 'text' ? (
            <span key={i}>{part.value}</span>
          ) : (
            <img
              key={i}
              src={part.url}
              alt=""
              className="inline-block align-text-bottom"
              style={{ height: '1em' }}
              loading="lazy"
            />
          )
        )}
      </span>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — every place that constructs a `ChatMessage` without `emojis` now errors. The only such place is `src/components/WidgetPage.tsx` (`newMessage` literal), fixed in Task 4. This confirms the type now requires `emojis`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatMessageRow.tsx
git commit -m "feat: render emoji images in chat message row"
```

---

### Task 4: Carry `emojis` through the widget message queue

**Files:**
- Modify: `src/components/WidgetPage.tsx:10-15` (PendingMessage interface)
- Modify: `src/components/WidgetPage.tsx:112-125` (ws.onmessage)
- Modify: `src/components/WidgetPage.tsx:223-232` (newMessage literal)

- [ ] **Step 1: Add `emojis` to `PendingMessage`**

In `src/components/WidgetPage.tsx`, update the interface (currently lines 10-15):

```tsx
interface PendingMessage {
  id: string
  senderId: string
  senderNickname: string
  messageText: string
  emojis: Record<string, string>
}
```

- [ ] **Step 2: Read `data.emojis` and enqueue it**

In `ws.onmessage`, after this existing line (~line 115):

```tsx
          const messageText = data.content
```

add:

```tsx
          const emojis: Record<string, string> = data.emojis || {}
```

then add `emojis` to the `pendingQueueRef.current.push({...})` object (currently ~lines 120-125):

```tsx
          pendingQueueRef.current.push({
            id: `${Date.now()}-${Math.random()}`,
            senderId: senderId || '',
            senderNickname: senderNickname || '',
            messageText,
            emojis,
          })
```

- [ ] **Step 3: Put `emojis` on the constructed `ChatMessage`**

In `processQueue`, add `emojis` to the `newMessage` literal (currently lines 223-232):

```tsx
        const newMessage: ChatMessage = {
          id: pending.id,
          djClass: cacheEntry.djClass,
          rankShort: cacheEntry.rankShort,
          rankLevel: cacheEntry.rankLevel,
          powerInteger: cacheEntry.powerInteger,
          text: pending.messageText,
          emojis: pending.emojis,
          isUnverified: cacheEntry.unverified,
          createdAt: Date.now(),
        }
```

- [ ] **Step 4: Typecheck (now clean)**

Run: `npx tsc --noEmit`
Expected: PASS — the Task 3 error is resolved now that `newMessage` provides `emojis`.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS, including `tests/emoji.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/components/WidgetPage.tsx
git commit -m "feat: thread chat emojis from websocket to message row"
```

---

## Self-Review

**Spec coverage:**
- Data flow plumbing (server `chat-proxy.ts`) → Task 2 ✓
- Data flow plumbing (client `WidgetPage.tsx`) → Task 4 ✓
- Pure `parseEmojiContent` unit with `EmojiPart` shape, regex `/\{:([\w-]+):\}/g`, drop-unmatched → Task 1 ✓
- Render with 1em inline `<img>`, `align-text-bottom`, `loading="lazy"`, `alt=""` → Task 3 ✓
- Edge cases (empty map, malformed placeholder left as text, unmatched dropped, key charset) → covered by Task 1 tests + regex ✓
- Testing list (no emojis, single, multiple, adjacent, start/end, unmatched, empty map) → Task 1 Step 1 ✓
- Out of scope (animated emotes, configurable size) → not implemented, correct ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `parseEmojiContent(content, emojis)` and `EmojiPart` (`{type:'text',value}` / `{type:'emoji',key,url}`) are defined in Task 1 and consumed identically in Task 3. `emojis: Record<string, string>` is named consistently across `ChatMessage` (server + client), `PendingMessage`, and the parser argument. ✓
