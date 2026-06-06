import { NextRequest, NextResponse } from 'next/server'
import { getOAuthUrl } from '@/lib/chzzk'
import { randomBytes } from 'crypto'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { safeNextPath } from '@/lib/safe-redirect'

export async function GET(request: NextRequest) {
  const rl = rateLimit(`auth:${getClientIp(request)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
  const state = randomBytes(32).toString('hex')
  const url = getOAuthUrl(state)
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))

  logger.debug('[OAuth Init] redirecting')

  const response = NextResponse.redirect(url)
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })
  response.cookies.set('oauth_next', next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })

  return response
}
