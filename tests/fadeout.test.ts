import { describe, it, expect } from 'vitest'
import { parseFadeout, FADEOUT_MIN, FADEOUT_MAX } from '../src/lib/fadeout'

describe('parseFadeout', () => {
  it('returns 0 (off) for null/absent', () => {
    expect(parseFadeout(null)).toBe(0)
  })

  it('returns 0 (off) for non-numeric input', () => {
    expect(parseFadeout('abc')).toBe(0)
  })

  it('returns 0 (off) for values below the minimum', () => {
    expect(parseFadeout('4')).toBe(0)
    expect(parseFadeout('0')).toBe(0)
  })

  it('passes through in-range values, rounded', () => {
    expect(parseFadeout('5')).toBe(FADEOUT_MIN)
    expect(parseFadeout('30')).toBe(30)
    expect(parseFadeout('30.6')).toBe(31)
  })

  it('clamps values above the maximum', () => {
    expect(parseFadeout('120')).toBe(FADEOUT_MAX)
  })
})
