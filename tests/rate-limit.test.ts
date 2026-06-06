import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, getClientIp, resetRateLimit } from '../src/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => resetRateLimit())

  it('allows requests up to the limit then blocks', () => {
    const key = 'test:1.2.3.4'
    const now = 1_000_000
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(true)
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(true)
    expect(rateLimit(key, 2, 60_000, now).allowed).toBe(false)
  })

  it('resets after the window elapses', () => {
    const key = 'test:1.2.3.4'
    expect(rateLimit(key, 1, 60_000, 1_000_000).allowed).toBe(true)
    expect(rateLimit(key, 1, 60_000, 1_000_000).allowed).toBe(false)
    // window has passed
    expect(rateLimit(key, 1, 60_000, 1_000_000 + 60_001).allowed).toBe(true)
  })

  it('extracts the first IP from x-forwarded-for', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('9.9.9.9')
  })

  it('falls back to "unknown" when no IP headers present', () => {
    expect(getClientIp(new Request('http://x'))).toBe('unknown')
  })
})
