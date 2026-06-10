export type EmojiPart =
  | { type: 'text'; value: string }
  | { type: 'emoji'; key: string; url: string }

/**
 * Tokenizes Chzzk chat `content` into an ordered list of text and emoji parts.
 * `{:key:}` placeholders are replaced by emoji parts when `key` is present in
 * `emojis`; unmatched placeholders are dropped (per design).
 * When an unmatched placeholder is dropped, the surrounding text may be emitted as two adjacent text parts (this is expected).
 */
export function parseEmojiContent(
  content: string,
  emojis: Record<string, string>
): EmojiPart[] {
  const parts: EmojiPart[] = []
  let lastIndex = 0
  const placeholderRe = /\{:([\w-]+):\}/g

  let match: RegExpExecArray | null
  while ((match = placeholderRe.exec(content)) !== null) {
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
