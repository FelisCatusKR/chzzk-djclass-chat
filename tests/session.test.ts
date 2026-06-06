import crypto from 'crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionCookie, verifySessionCookie } from '../src/lib/session'

describe('Session', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
  })

  it('should create and verify a valid session cookie', () => {
    const userId = 42
    const cookie = createSessionCookie(userId)
    expect(cookie).toContain('.')

    const verified = verifySessionCookie(cookie)
    expect(verified).toBe(userId)
  })

  it('should reject tampered session cookies', () => {
    const userId = 42
    const cookie = createSessionCookie(userId)

    // Tamper with the userId part
    const tampered = '99' + cookie.slice(cookie.indexOf('.'))
    const verified = verifySessionCookie(tampered)
    expect(verified).toBeNull()
  })

  it('should reject cookies with invalid format', () => {
    expect(verifySessionCookie('not-signed')).toBeNull()
    expect(verifySessionCookie('')).toBeNull()
    expect(verifySessionCookie('abc.def.ghi')).toBeNull()
  })

  it('should produce different signatures for different secrets', () => {
    const userId = 42
    const cookie1 = createSessionCookie(userId)

    process.env.SESSION_SECRET = 'different-secret-key-here!!'
    const cookie2 = createSessionCookie(userId)

    expect(cookie1).not.toBe(cookie2)

    // First cookie should fail verification with new secret
    const verified = verifySessionCookie(cookie1)
    expect(verified).toBeNull()
  })

  it('rejects an expired session cookie', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const expired = createSessionCookie(42, -10) // expired 10s ago
    expect(verifySessionCookie(expired)).toBeNull()
  })

  it('accepts a cookie within its TTL', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const fresh = createSessionCookie(42, 60)
    expect(verifySessionCookie(fresh)).toBe(42)
  })

  it('rejects a legacy cookie without an expiry segment', () => {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long!!!'
    const secret = process.env.SESSION_SECRET
    const sig = crypto.createHmac('sha256', secret).update('42').digest('hex')
    const legacy = `42.${sig}` // old userId.signature format
    expect(verifySessionCookie(legacy)).toBeNull()
  })
})
