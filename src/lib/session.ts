import crypto from 'crypto'

const SEPARATOR = '.'
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days (matches cookie maxAge)

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }
  return secret
}

function signature(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex')
}

// Returns the verified value (everything before the last separator) or null.
function verify(signedValue: string): string | null {
  const idx = signedValue.lastIndexOf(SEPARATOR)
  if (idx === -1) return null

  const value = signedValue.slice(0, idx)
  const provided = signedValue.slice(idx + 1)
  const expected = signature(value)

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(provided, 'hex'),
      Buffer.from(expected, 'hex')
    )
    return ok ? value : null
  } catch {
    // Buffer lengths differ
    return null
  }
}

export function createSessionCookie(
  userId: number,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const value = `${userId}${SEPARATOR}${exp}` // userId.exp
  return `${value}${SEPARATOR}${signature(value)}` // userId.exp.signature
}

export function verifySessionCookie(signedValue: string): number | null {
  const value = verify(signedValue)
  if (!value) return null

  const parts = value.split(SEPARATOR)
  if (parts.length !== 2) return null // reject legacy 1-segment cookies

  const userId = parseInt(parts[0], 10)
  const exp = parseInt(parts[1], 10)
  if (isNaN(userId) || isNaN(exp)) return null
  if (exp < Math.floor(Date.now() / 1000)) return null // expired

  return userId
}
