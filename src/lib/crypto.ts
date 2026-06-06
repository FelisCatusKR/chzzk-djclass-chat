import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function deriveKey(salt: Buffer): Buffer {
  const key = process.env.VARCHIVE_TOKEN_KEY
  if (!key) {
    throw new Error('VARCHIVE_TOKEN_KEY environment variable is required')
  }
  return crypto.scryptSync(key, salt, KEY_LENGTH)
}

export function encrypt(text: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(salt)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Layout: salt | iv | authTag | ciphertext
  return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64')
}

export function decrypt(encryptedText: string): string {
  const data = Buffer.from(encryptedText, 'base64')
  const salt = data.subarray(0, SALT_LENGTH)
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const authTag = data.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  )
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const key = deriveKey(salt)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8'
  )
}
