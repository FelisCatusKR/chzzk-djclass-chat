// Inactive-chat fadeout bounds and URL parsing.
// `fadeout` is a number of seconds; 0 (or out-of-range-low) means "off".
// Single source of truth shared by the widget read-path and the dashboard.

export const FADEOUT_MIN = 5
export const FADEOUT_MAX = 60
export const FADEOUT_DEFAULT = 15

/**
 * Parse a `fadeout` URL query value into whole seconds.
 * - null/empty/non-numeric/non-finite -> 0 (off)
 * - below FADEOUT_MIN -> 0 (off)
 * - in range -> rounded integer
 * - above FADEOUT_MAX -> FADEOUT_MAX
 */
export function parseFadeout(raw: string | null): number {
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  const rounded = Math.round(parsed)
  if (rounded < FADEOUT_MIN) return 0
  return Math.min(FADEOUT_MAX, rounded)
}
