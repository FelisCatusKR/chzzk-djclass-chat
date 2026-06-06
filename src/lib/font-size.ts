// Chat widget font-size bounds and URL parsing.
// Single source of truth shared by the widget read-path and the dashboard.

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 28
export const FONT_SIZE_DEFAULT = 14

/**
 * Clamp a font size into [MIN, MAX], rounded to a whole pixel.
 * Non-finite input (NaN, Infinity, -Infinity) falls back to FONT_SIZE_DEFAULT.
 */
export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/**
 * Parse a `fontSize` URL query value. Returns FONT_SIZE_DEFAULT for null,
 * empty string, non-numeric, or non-finite input; otherwise the clamped integer.
 */
export function parseFontSize(raw: string | null): number {
  if (!raw) return FONT_SIZE_DEFAULT
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return FONT_SIZE_DEFAULT
  return clampFontSize(parsed)
}
