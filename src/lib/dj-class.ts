import type { BadgeMode } from './types'

// DJ power at or above this value is a "theory" (이론치) / perfect score.
// Single source of truth for the theory check across badge rendering,
// threshold-mode text, and previews.
export const THEORY_POWER_THRESHOLD = 10000

export function isTheoryPower(
  powerInteger: number | null | undefined
): boolean {
  return powerInteger != null && powerInteger >= THEORY_POWER_THRESHOLD
}

// TEMPORARY WORKAROUND (2026-06-11): V-ARCHIVE's djPowerConversion calculation
// reports true in-game theory (이론치) scores slightly below 10000 (observed
// 9999.9847). Until V-ARCHIVE corrects this, treat any raw conversion at or
// above this value as theory. Detection runs on the RAW float; the displayed
// integer is still bumped to THEORY_POWER_THRESHOLD via toPowerInteger().
export const THEORY_POWER_CONVERSION_THRESHOLD = 9999.9847

// Source-of-truth theory check, applied to the raw djPowerConversion float.
export function isTheoryConversion(
  conversion: number | null | undefined
): boolean {
  return conversion != null && conversion >= THEORY_POWER_CONVERSION_THRESHOLD
}

// Convert a raw djPowerConversion float to the integer power shown in badges.
// Theory scores are bumped to THEORY_POWER_THRESHOLD (10000) so the existing
// integer-based isTheoryPower() callers keep working; every other score floors.
// Preserves null (no data) and a genuine 0.
export function toPowerInteger(
  conversion: number | null | undefined
): number | null {
  if (conversion == null) return null
  if (isTheoryConversion(conversion)) return THEORY_POWER_THRESHOLD
  return Math.floor(conversion)
}

// V-ARCHIVE DJ CLASS color scheme (from official wiki)
export const DJ_CLASS_COLORS: Record<string, string> = {
  'THE LORD OF DJMAX': 'linear-gradient(to right, #f2b2f7, #acebff)',
  'BEAT MAESTRO': 'linear-gradient(135deg, #ff7183, #ff8a9a)',
  SHOWSTOPPER: 'linear-gradient(135deg, #ff856f, #ff9a87)',
  HEADLINER: 'linear-gradient(135deg, #ff9758, #ffaa75)',
  'TREND SETTER': 'linear-gradient(135deg, #ffaf51, #ffbf70)',
  PROFESSIONAL: 'linear-gradient(135deg, #ffd352, #ffdd70)',
  'HIGH CLASS': 'linear-gradient(135deg, #feff63, #feff85)',
  'PRO DJ': 'linear-gradient(135deg, #c7e644, #d1eb60)',
  MIDDLEMAN: 'linear-gradient(135deg, #9ae28a, #a8e89c)',
  'STREET DJ': 'linear-gradient(135deg, #92eaca, #a2edd2)',
  ROOKIE: 'linear-gradient(135deg, #78e3da, #8ee8e0)',
  AMATEUR: 'linear-gradient(135deg, #8eccdb, #a2d6e2)',
  TRAINEE: 'linear-gradient(135deg, #a9d0ee, #bdd8f0)',
  BEGINNER: 'linear-gradient(135deg, #c0c0c0, #d0d0d0)',
}

// Short display names for DJ CLASS ranks
export const SHORT_NAMES: Record<string, string> = {
  'THE LORD OF DJMAX': 'LoD',
  'BEAT MAESTRO': 'BM',
  SHOWSTOPPER: 'SS',
  HEADLINER: 'HL',
  'TREND SETTER': 'TS',
  PROFESSIONAL: 'PRO',
  'HIGH CLASS': 'HC',
  'PRO DJ': 'PD',
  MIDDLEMAN: 'MM',
  'STREET DJ': 'SD',
  ROOKIE: 'RK',
  AMATEUR: 'AM',
  TRAINEE: 'TR',
  BEGINNER: 'BG',
}

// Minimum power thresholds for each rank and level (from V-ARCHIVE wiki)
export const RANK_THRESHOLDS: Record<string, Record<string, number>> = {
  'THE LORD OF DJMAX': { default: 9980 },
  'BEAT MAESTRO': { IV: 9900, III: 9930, II: 9950, I: 9970 },
  SHOWSTOPPER: { IV: 9700, III: 9750, II: 9800, I: 9850 },
  HEADLINER: { IV: 9400, III: 9500, II: 9600, I: 9650 },
  'TREND SETTER': { IV: 9000, III: 9100, II: 9200, I: 9300 },
  PROFESSIONAL: { IV: 8600, III: 8700, II: 8800, I: 8900 },
  'HIGH CLASS': { IV: 7800, III: 8000, II: 8200, I: 8400 },
  'PRO DJ': { IV: 7000, III: 7200, II: 7400, I: 7600 },
  MIDDLEMAN: { IV: 6200, III: 6400, II: 6600, I: 6800 },
  'STREET DJ': { IV: 5200, III: 5500, II: 5800, I: 6000 },
  ROOKIE: { IV: 4000, III: 4300, II: 4600, I: 4900 },
  AMATEUR: { IV: 2400, III: 2800, II: 3200, I: 3600 },
  TRAINEE: { IV: 500, III: 1000, II: 1500, I: 2000 },
  BEGINNER: { default: 0 },
}

export function getThreshold(
  rankName: string,
  rankLevel: string | null
): number | null {
  const thresholds = RANK_THRESHOLDS[rankName]
  if (!thresholds) return null
  if (thresholds.default != null) return thresholds.default
  if (rankLevel && thresholds[rankLevel] != null) return thresholds[rankLevel]
  return null
}

export function getDjClassColor(rankName: string): string {
  return DJ_CLASS_COLORS[rankName] || DJ_CLASS_COLORS['BEGINNER']
}

const LEVEL_RE = /\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i

// Strip the leading button prefix (e.g. "4B ") and a trailing roman-numeral
// level, returning the rank name. Falls back to "BEGINNER" when absent.
export function parseRankName(djClass: string | null): string {
  return (
    djClass
      ?.replace(/^\d+B\s+/, '')
      .replace(LEVEL_RE, '')
      .trim() || 'BEGINNER'
  )
}

// Canonical DJ CLASS rank order, best → worst. Mirrors the V-ARCHIVE ladder
// and the key order of RANK_THRESHOLDS / DJ_CLASS_COLORS above.
export const RANK_ORDER: string[] = [
  'THE LORD OF DJMAX',
  'BEAT MAESTRO',
  'SHOWSTOPPER',
  'HEADLINER',
  'TREND SETTER',
  'PROFESSIONAL',
  'HIGH CLASS',
  'PRO DJ',
  'MIDDLEMAN',
  'STREET DJ',
  'ROOKIE',
  'AMATEUR',
  'TRAINEE',
  'BEGINNER',
]

// Roman level → ordinal (higher is better). Theory (top level of LoD) = 5.
const LEVEL_VALUES: Record<string, number> = { I: 4, II: 3, III: 2, IV: 1 }

// Button display preference: 8 > 5 > 6 > 4 (higher is preferred).
const BUTTON_PREFERENCE: Record<number, number> = { 8: 3, 5: 2, 6: 1, 4: 0 }

// Comparable sort key for one button's DJ CLASS result, "bigger is better"
// at every position: [rankOrdinal, levelOrdinal, buttonPref]. Used to pick
// the displayed button by highest CLASS (not power). Theory is modeled as
// LoD's top level, so power only matters via the theory check.
export function getClassSortKey(
  djClass: string,
  djPowerConversion: number | null | undefined,
  button: number
): [number, number, number] {
  const rankName = parseRankName(djClass)
  const rankIndex = RANK_ORDER.indexOf(rankName)
  const rankOrdinal = rankIndex === -1 ? -1 : RANK_ORDER.length - 1 - rankIndex

  let levelOrdinal: number
  if (rankName === 'THE LORD OF DJMAX' && isTheoryConversion(djPowerConversion)) {
    levelOrdinal = 5
  } else {
    const levelMatch = djClass.match(LEVEL_RE)
    const level = levelMatch ? levelMatch[1].toUpperCase() : null
    levelOrdinal = level ? (LEVEL_VALUES[level] ?? 0) : 0
  }

  const buttonPref = BUTTON_PREFERENCE[button] ?? -1

  return [rankOrdinal, levelOrdinal, buttonPref]
}

// Lexicographic, descending comparison of two class sort keys.
// Returns > 0 when `a` ranks higher than `b`, < 0 when lower, 0 when equal.
export function compareClassSortKeys(
  a: [number, number, number],
  b: [number, number, number]
): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

// One stored button's DJ CLASS, in the shape the display resolver needs.
export interface DjClassRow {
  button: number
  djClass: string
  djPowerConversion: number | null
}

// Choose which button's DJ CLASS to display.
// - 'auto' (and every fallback) returns the highest CLASS via the sort key.
// - 'viewer' returns the row matching `preferredButton` when present,
//   otherwise falls back to the highest CLASS.
export function resolveDisplayedClass(
  rows: DjClassRow[],
  preferredButton: number | null,
  sel: 'auto' | 'viewer'
): DjClassRow | null {
  if (rows.length === 0) return null

  if (sel === 'viewer' && preferredButton != null) {
    const match = rows.find((r) => r.button === preferredButton)
    if (match) return match
  }

  return rows.reduce((best, current) =>
    compareClassSortKeys(
      getClassSortKey(
        current.djClass,
        current.djPowerConversion,
        current.button
      ),
      getClassSortKey(best.djClass, best.djPowerConversion, best.button)
    ) > 0
      ? current
      : best
  )
}

// Validate a requested preferred button against the buttons a viewer actually
// has. Returns the button (to set) or null (to clear). Throws on an invalid or
// unavailable button so callers can answer 400.
export function validatePreferredButton(
  button: unknown,
  availableButtons: number[]
): number | null {
  if (button === null) return null
  if (typeof button === 'number' && availableButtons.includes(button)) {
    return button
  }
  throw new Error('Invalid preferred button')
}

// Pure badge-text computation, identical to the original inline WidgetPage
// logic. Kept here so it is testable without a DOM.
export function getBadgeText(
  mode: BadgeMode,
  djClass: string | null,
  rankShort: string | null,
  rankLevel: string | null,
  powerInteger: number | null
): string {
  const buttonMatch = djClass?.match(/^(\d+B)/)
  const buttonPrefix = buttonMatch ? buttonMatch[1] : ''

  if (mode === 'threshold') {
    if (isTheoryPower(powerInteger)) {
      return `${buttonPrefix} ${THEORY_POWER_THRESHOLD}`
    }
    const rankName = parseRankName(djClass)
    const levelMatch = djClass?.match(LEVEL_RE)
    const resolvedLevel = levelMatch ? levelMatch[1] : null
    const threshold = getThreshold(rankName, resolvedLevel)
    return threshold != null
      ? `${buttonPrefix} ${threshold}+`
      : `${buttonPrefix} ${rankShort}`
  }

  if (mode === 'power') {
    return `${buttonPrefix} ${powerInteger ?? 0}`
  }

  // 'short' (and any fallback)
  return `${buttonPrefix} ${rankShort}${rankLevel ? ` ${rankLevel}` : ''}`
}
