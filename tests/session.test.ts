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
})
