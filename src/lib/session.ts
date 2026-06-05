import crypto from 'crypto'

const SEPARATOR = '.'

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }
  return secret
}

function sign(value: string): string {
  const secret = getSecret()
  const signature = crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('hex')
  return `${value}${SEPARATOR}${signature}`
}

function verify(signedValue: string): string | null {
  const parts = signedValue.split(SEPARATOR)
  if (parts.length !== 2) return null

  const [value, signature] = parts
  const expectedSignature = sign(value).split(SEPARATOR)[1]

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
      ? value
      : null
  } catch {
    // Buffer lengths differ
    return null
  }
}

export function createSessionCookie(userId: number): string {
  return sign(String(userId))
}

export function verifySessionCookie(signedValue: string): number | null {
  const value = verify(signedValue)
  if (!value) return null
  const userId = parseInt(value, 10)
  return isNaN(userId) ? null : userId
}
