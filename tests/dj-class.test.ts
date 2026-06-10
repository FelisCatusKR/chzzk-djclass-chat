import { describe, it, expect } from 'vitest'
import {
  getThreshold,
  getDjClassColor,
  getBadgeText,
  parseRankName,
  isTheoryPower,
  THEORY_POWER_THRESHOLD,
  THEORY_POWER_CONVERSION_THRESHOLD,
  isTheoryConversion,
  toPowerInteger,
  GLINT_PERIOD_MS,
  glintDelayMs,
  DJ_CLASS_COLORS,
  SHORT_NAMES,
  RANK_ORDER,
  getClassSortKey,
  compareClassSortKeys,
} from '../src/lib/dj-class'

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

describe('parseRankName', () => {
  it('strips button prefix and level', () => {
    expect(parseRankName('4B SHOWSTOPPER II')).toBe('SHOWSTOPPER')
  })

  it('handles rank with no level', () => {
    expect(parseRankName('4B THE LORD OF DJMAX')).toBe('THE LORD OF DJMAX')
  })

  it('falls back to BEGINNER for null', () => {
    expect(parseRankName(null)).toBe('BEGINNER')
  })
})

describe('getBadgeText', () => {
  const base = ['4B SHOWSTOPPER II', 'SS', 'II', 9823] as const

  it('short mode', () => {
    expect(getBadgeText('short', ...base)).toBe('4B SS II')
  })

  it('threshold mode', () => {
    expect(getBadgeText('threshold', ...base)).toBe('4B 9800+')
  })

  it('power mode', () => {
    expect(getBadgeText('power', ...base)).toBe('4B 9823')
  })

  it('threshold mode falls back to rankShort when no threshold', () => {
    expect(getBadgeText('threshold', '4B UNKNOWN II', 'SS', 'II', 9823)).toBe(
      '4B SS'
    )
  })

  it('power mode defaults null power to 0', () => {
    expect(getBadgeText('power', '4B BEGINNER', 'BG', null, null)).toBe('4B 0')
  })

  it('threshold mode shows 10000 for a theory player', () => {
    expect(
      getBadgeText('threshold', '4B THE LORD OF DJMAX', 'LoD', null, 10000)
    ).toBe('4B 10000')
  })

  it('threshold mode shows rank threshold for a non-theory LoD player', () => {
    expect(
      getBadgeText('threshold', '4B THE LORD OF DJMAX', 'LoD', null, 9990)
    ).toBe('4B 9980+')
  })
})

describe('isTheoryPower', () => {
  it('is true at exactly the threshold', () => {
    expect(isTheoryPower(10000)).toBe(true)
  })

  it('is true above the threshold', () => {
    expect(isTheoryPower(10001)).toBe(true)
  })

  it('is false just below the threshold', () => {
    expect(isTheoryPower(9999)).toBe(false)
  })

  it('is false for null', () => {
    expect(isTheoryPower(null)).toBe(false)
  })

  it('is false for undefined', () => {
    expect(isTheoryPower(undefined)).toBe(false)
  })

  it('exposes the threshold constant as 10000', () => {
    expect(THEORY_POWER_THRESHOLD).toBe(10000)
  })
})

describe('isTheoryConversion', () => {
  it('exposes the conversion threshold constant as 9999.9847', () => {
    expect(THEORY_POWER_CONVERSION_THRESHOLD).toBe(9999.9847)
  })

  it('is true at exactly the conversion threshold', () => {
    expect(isTheoryConversion(9999.9847)).toBe(true)
  })

  it('is true above the conversion threshold', () => {
    expect(isTheoryConversion(10000)).toBe(true)
  })

  it('is false just below the conversion threshold', () => {
    expect(isTheoryConversion(9999.9846)).toBe(false)
  })

  it('is false for a clearly sub-theory score', () => {
    expect(isTheoryConversion(9999.5)).toBe(false)
  })

  it('is false for null and undefined', () => {
    expect(isTheoryConversion(null)).toBe(false)
    expect(isTheoryConversion(undefined)).toBe(false)
  })
})

describe('toPowerInteger', () => {
  it('bumps a theory conversion up to THEORY_POWER_THRESHOLD (10000)', () => {
    expect(toPowerInteger(9999.9847)).toBe(10000)
    expect(toPowerInteger(10000)).toBe(10000)
  })

  it('floors a non-theory conversion', () => {
    expect(toPowerInteger(9999.9846)).toBe(9999)
    expect(toPowerInteger(9999.5)).toBe(9999)
    expect(toPowerInteger(8800.7)).toBe(8800)
  })

  it('a floored non-theory value is not treated as theory by isTheoryPower', () => {
    expect(isTheoryPower(toPowerInteger(9999.5))).toBe(false)
  })

  it('preserves a genuine zero (not null)', () => {
    expect(toPowerInteger(0)).toBe(0)
  })

  it('returns null for null and undefined', () => {
    expect(toPowerInteger(null)).toBeNull()
    expect(toPowerInteger(undefined)).toBeNull()
  })
})

describe('RANK_ORDER', () => {
  it('runs from LoD (best) to BEGINNER (worst)', () => {
    expect(RANK_ORDER[0]).toBe('THE LORD OF DJMAX')
    expect(RANK_ORDER[RANK_ORDER.length - 1]).toBe('BEGINNER')
  })

  it('has 14 ranks', () => {
    expect(RANK_ORDER).toHaveLength(14)
  })
})

describe('getClassSortKey', () => {
  it('encodes rank, level, and button (SHOWSTOPPER IV on 4-button)', () => {
    // SS index 2 → ordinal 13-2=11; level IV=1; button 4→0
    expect(getClassSortKey('SHOWSTOPPER IV', 9700, 4)).toEqual([11, 1, 0])
  })

  it('ranks a higher rank above a lower rank regardless of level/button', () => {
    const ss = getClassSortKey('SHOWSTOPPER IV', 9700, 4) // [11,1,0]
    const hl = getClassSortKey('HEADLINER I', 9650, 8) // [10,4,3]
    expect(compareClassSortKeys(ss, hl)).toBeGreaterThan(0)
  })

  it('orders levels within a rank (I beats IV)', () => {
    const i = getClassSortKey('SHOWSTOPPER I', 9850, 5) // [11,4,2]
    const iv = getClassSortKey('SHOWSTOPPER IV', 9700, 8) // [11,1,3]
    expect(compareClassSortKeys(i, iv)).toBeGreaterThan(0)
  })

  it('breaks an exact rank+level tie by button 8 > 5 > 6 > 4', () => {
    const b8 = getClassSortKey('HIGH CLASS I', 8000, 8) // [7,4,3]
    const b5 = getClassSortKey('HIGH CLASS I', 8000, 5) // [7,4,2]
    const b6 = getClassSortKey('HIGH CLASS I', 8000, 6) // [7,4,1]
    const b4 = getClassSortKey('HIGH CLASS I', 8000, 4) // [7,4,0]
    expect(compareClassSortKeys(b8, b5)).toBeGreaterThan(0)
    expect(compareClassSortKeys(b5, b6)).toBeGreaterThan(0)
    expect(compareClassSortKeys(b6, b4)).toBeGreaterThan(0)
  })

  it('treats Theory (LoD at >=10000) as a level above plain LoD', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 10000, 4) // [13,5,0]
    const plain = getClassSortKey('THE LORD OF DJMAX', 9990, 8) // [13,0,3]
    expect(theory).toEqual([13, 5, 0])
    expect(plain).toEqual([13, 0, 3])
    expect(compareClassSortKeys(theory, plain)).toBeGreaterThan(0)
  })

  it('keeps Theory above every non-LoD rank', () => {
    const theory = getClassSortKey('THE LORD OF DJMAX', 10000, 4)
    const bm = getClassSortKey('BEAT MAESTRO I', 9970, 8)
    expect(compareClassSortKeys(theory, bm)).toBeGreaterThan(0)
  })

  it('gives no-level ranks a level ordinal of 0 without throwing', () => {
    expect(getClassSortKey('THE LORD OF DJMAX', 9990, 5)).toEqual([13, 0, 2])
    expect(getClassSortKey('BEGINNER', 0, 4)).toEqual([0, 0, 0])
  })

  it('sorts an unknown class to the bottom', () => {
    expect(getClassSortKey('NONSENSE', 0, 4)).toEqual([-1, 0, 0])
  })

  it('handles a button-prefixed class string (the caller format)', () => {
    // parseRankName strips the "4B " prefix; LEVEL_RE still matches the level
    expect(getClassSortKey('4B SHOWSTOPPER IV', 9700, 4)).toEqual([11, 1, 0])
  })
})

describe('compareClassSortKeys', () => {
  it('returns 0 for identical keys', () => {
    expect(compareClassSortKeys([7, 4, 3], [7, 4, 3])).toBe(0)
  })

  it('is positive when the first key ranks higher', () => {
    expect(compareClassSortKeys([8, 0, 0], [7, 9, 9])).toBeGreaterThan(0)
  })

  it('is negative when the first key ranks lower', () => {
    expect(compareClassSortKeys([7, 4, 0], [7, 4, 3])).toBeLessThan(0)
  })
})
