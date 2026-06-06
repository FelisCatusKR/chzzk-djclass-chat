import { describe, it, expect } from 'vitest'
import { safeNextPath } from '../src/lib/safe-redirect'

describe('safeNextPath', () => {
  it('accepts root-relative paths', () => {
    expect(safeNextPath('/link')).toBe('/link')
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
    expect(safeNextPath('/dashboard?mode=short')).toBe('/dashboard?mode=short')
  })

  it('falls back when next is missing', () => {
    expect(safeNextPath(null)).toBe('/link')
    expect(safeNextPath(undefined)).toBe('/link')
    expect(safeNextPath('')).toBe('/link')
  })

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.com')).toBe('/link')
    expect(safeNextPath('//evil.com')).toBe('/link')
    expect(safeNextPath('/\\evil.com')).toBe('/link')
    expect(safeNextPath('relative')).toBe('/link')
  })

  it('honours a custom fallback', () => {
    expect(safeNextPath(null, '/dashboard')).toBe('/dashboard')
    expect(safeNextPath('//evil.com', '/dashboard')).toBe('/dashboard')
  })
})
