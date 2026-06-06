import { describe, it, expect } from 'vitest'
import { resolveLevel, isLevelEnabled } from '../src/lib/logger'

describe('logger', () => {
  it('uses info level in production, debug otherwise', () => {
    expect(resolveLevel('production')).toBe('info')
    expect(resolveLevel('development')).toBe('debug')
    expect(resolveLevel(undefined)).toBe('debug')
  })

  it('enables a level only when at or above the current threshold', () => {
    expect(isLevelEnabled('debug', 'info')).toBe(false)
    expect(isLevelEnabled('info', 'info')).toBe(true)
    expect(isLevelEnabled('error', 'info')).toBe(true)
    expect(isLevelEnabled('warn', 'error')).toBe(false)
  })
})
