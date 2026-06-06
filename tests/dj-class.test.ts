import { describe, it, expect } from 'vitest'
import {
  getThreshold,
  getDjClassColor,
  getBadgeText,
  parseRankName,
  isTheoryPower,
  THEORY_POWER_THRESHOLD,
  DJ_CLASS_COLORS,
  SHORT_NAMES,
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
