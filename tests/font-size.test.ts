import { describe, it, expect } from 'vitest'
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  clampFontSize,
  parseFontSize,
} from '../src/lib/font-size'

describe('font-size constants', () => {
  it('uses the agreed range and default', () => {
    expect(FONT_SIZE_MIN).toBe(12)
    expect(FONT_SIZE_MAX).toBe(28)
    expect(FONT_SIZE_DEFAULT).toBe(14)
  })
})

describe('clampFontSize', () => {
  it('returns the value when within range', () => {
    expect(clampFontSize(18)).toBe(18)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampFontSize(5)).toBe(12)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampFontSize(100)).toBe(28)
  })

  it('rounds floats to the nearest integer', () => {
    expect(clampFontSize(16.7)).toBe(17)
  })

  it('returns default for NaN', () => {
    expect(clampFontSize(NaN)).toBe(14)
  })

  it('returns default for Infinity', () => {
    expect(clampFontSize(Infinity)).toBe(14)
  })
})

describe('parseFontSize', () => {
  it('returns default for null', () => {
    expect(parseFontSize(null)).toBe(14)
  })

  it('returns default for non-numeric input', () => {
    expect(parseFontSize('abc')).toBe(14)
  })

  it('parses and returns an in-range integer', () => {
    expect(parseFontSize('18')).toBe(18)
  })

  it('clamps a too-small value', () => {
    expect(parseFontSize('5')).toBe(12)
  })

  it('clamps a too-large value', () => {
    expect(parseFontSize('100')).toBe(28)
  })

  it('rounds a float string', () => {
    expect(parseFontSize('16.7')).toBe(17)
  })

  it('returns default for empty string', () => {
    expect(parseFontSize('')).toBe(14)
  })

  it('returns default for Infinity string', () => {
    expect(parseFontSize('Infinity')).toBe(14)
  })
})
