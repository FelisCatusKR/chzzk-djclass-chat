# Chat Emoji Rendering — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

Chzzk chat messages carry emoticons (이모티콘) as `{:emojiKey:}` placeholders embedded
in the message `content`, alongside an `emojis` map that resolves each `emojiKey` to an
image URL. Today the widget ignores the `emojis` map entirely and renders `content` as a
raw string, so viewers see literal `{:d_07:}` text instead of the emoticon image.

This adds logic to replace those placeholders with the actual emoticon images.

## Data Source

Per the Chzzk session API (`https://chzzk.gitbook.io/chzzk/chzzk-api/session.md`), a
`CHAT` event payload includes:

- `content`: the message text, containing `{:emojiKey:}` placeholders.
- `emojis`: a `Record<string, string>` mapping `emojiKey` → emoticon image URL.

## Approach

**Client-side React parsing.** The server forwards the raw `emojis` map untouched; the
client parses `{:key:}` placeholders into inline `<img>` elements at render time in React.

Rejected alternatives:

- **Server-side HTML string** (`dangerouslySetInnerHTML`): introduces an XSS surface from
  chat-controlled content and fights React. Rejected.
- **Server-side tokenization**: splits parsing logic across server and client for no real
  benefit and bloats the WebSocket payload. Rejected.

Parsing is a pure function, easy to test, and lives where rendering happens.

## Components

### 1. Data flow — plumb the `emojis` map server → client

- **`src/lib/chat-proxy.ts`** (`CHAT` handler, ~line 274): extract `parsed.emojis` as a
  `Record<string, string>` and include it on the forwarded `ChatMessage` and the WS
  payload `data`. Default to `{}` when missing.
- **`src/components/WidgetPage.tsx`** (~line 115): read `data.emojis` alongside
  `data.content`, carry it through the pending-message queue, and store it on the client
  `ChatMessage` as `emojis`.

### 2. New pure unit — `src/lib/emoji.ts`

```ts
type EmojiPart =
  | { type: 'text'; value: string }
  | { type: 'emoji'; key: string; url: string }

function parseEmojiContent(
  content: string,
  emojis: Record<string, string>
): EmojiPart[]
```

- Tokenizes `content` with a single regex: `/\{:([\w-]+):\}/g`.
- Returns an ordered array of parts interleaving text and emoji.
- A placeholder whose `key` is **not** present in `emojis` is **dropped** (removed from
  output) — per the chosen fallback behavior.
- Plain text with no placeholders returns a single `text` part.
- An empty / missing `emojis` map causes every placeholder to be dropped, leaving the
  surrounding text intact.

This is the only place the placeholder syntax is defined, and it is fully unit-testable in
isolation.

### 3. Render — `src/components/ChatMessageRow.tsx`

Replace the bare `{message.text}` render with the parsed parts:

- `text` parts render as-is.
- `emoji` parts render:
  ```tsx
  <img
    src={url}
    alt=""
    className="inline-block align-text-bottom"
    style={{ height: '1em' }}
    loading="lazy"
  />
  ```
- `height: '1em'` matches the surrounding text height (the chosen size); width auto
  preserves aspect ratio; `align-text-bottom` keeps the image on the text baseline.

## Edge Cases

- **Missing / empty `emojis` map** → text renders normally; placeholders dropped.
- **Malformed placeholder** (e.g. no closing `:}`) → the regex does not match, so it is
  left as literal text.
- **Unmatched key** → placeholder dropped (chosen fallback).
- **Image load failure** → `alt=""` suppresses broken-image UI; acceptable for an overlay.
- **Key charset** → alphanumeric, underscore, hyphen (`[\w-]+`).

## Testing

Unit tests for `parseEmojiContent` in `tests/emoji.test.ts`, matching the existing
`tests/*.test.ts` (vitest) style:

- no emojis (plain text → single text part)
- single emoji
- multiple emojis
- adjacent emojis (no text between)
- emoji at start and at end of content
- unmatched key → dropped
- empty `emojis` map → all placeholders dropped, text intact

## Out of Scope

- Animated / subscription-tier emoticon special handling (URLs are rendered as-is).
- Configurable emoji size in widget settings.
