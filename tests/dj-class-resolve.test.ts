import { describe, it, expect } from 'vitest'
import {
  resolveDisplayedClass,
  validatePreferredButton,
  type DjClassRow,
} from '../src/lib/dj-class'

const rows: DjClassRow[] = [
  { button: 4, djClass: 'SHOWSTOPPER II', djPowerConversion: 9800 },
  { button: 5, djClass: 'HIGH CLASS I', djPowerConversion: 8400 },
  { button: 8, djClass: 'HEADLINER IV', djPowerConversion: 9400 },
]

describe('resolveDisplayedClass', () => {
  it('auto picks the highest CLASS regardless of button', () => {
    const chosen = resolveDisplayedClass(rows, null, 'auto')
    expect(chosen?.button).toBe(4) // SHOWSTOPPER outranks HEADLINER/HIGH CLASS
  })

  it('viewer picks the preferred button even if not the highest', () => {
    const chosen = resolveDisplayedClass(rows, 8, 'viewer')
    expect(chosen?.button).toBe(8)
  })

  it('viewer falls back to highest when the preferred button has no row', () => {
    const chosen = resolveDisplayedClass(rows, 6, 'viewer')
    expect(chosen?.button).toBe(4)
  })

  it('viewer falls back to highest when no preference is set', () => {
    const chosen = resolveDisplayedClass(rows, null, 'viewer')
    expect(chosen?.button).toBe(4)
  })

  it('returns null for an empty row set', () => {
    expect(resolveDisplayedClass([], 8, 'viewer')).toBeNull()
  })
})

describe('validatePreferredButton', () => {
  it('returns the button when it is available', () => {
    expect(validatePreferredButton(8, [4, 8])).toBe(8)
  })

  it('returns null when clearing (null input)', () => {
    expect(validatePreferredButton(null, [4, 8])).toBeNull()
  })

  it('throws when the button is not available', () => {
    expect(() => validatePreferredButton(6, [4, 8])).toThrow()
  })

  it('throws for non-numeric input', () => {
    expect(() => validatePreferredButton('8', [4, 8])).toThrow()
  })
})
