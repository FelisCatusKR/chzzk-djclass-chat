// Validates a `next` redirect target as a safe, same-origin relative path.
// Rejects absolute URLs and protocol-relative ("//host", "/\host") values to
// prevent open redirects. Returns the fallback when next is missing or unsafe.
export function safeNextPath(
  next: string | null | undefined,
  fallback = '/link'
): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  // Reject protocol-relative ("//") and backslash tricks ("/\") that browsers
  // may treat as a scheme-relative URL to another host.
  if (next[1] === '/' || next[1] === '\\') return fallback
  return next
}
