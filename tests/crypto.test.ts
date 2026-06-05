import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from '../src/lib/crypto'

describe('Crypto', () => {
  beforeAll(() => {
    process.env.VARCHIVE_TOKEN_KEY = 'test-key-32-chars-long!!!'
  })

  it('should encrypt and decrypt successfully', () => {
    const original = 'varc_12345_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const encrypted = encrypt(original)
    expect(encrypted).not.toBe(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('should produce different ciphertext for same plaintext', () => {
    const original = 'test-token'
    const encrypted1 = encrypt(original)
    const encrypted2 = encrypt(original)
    expect(encrypted1).not.toBe(encrypted2)
  })
})
