import { NextRequest, NextResponse } from 'next/server'
import { getOAuthUrl } from '@/lib/chzzk'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  const state = randomBytes(32).toString('hex')
  const url = getOAuthUrl(state)
  
  console.log('[OAuth Init] Redirecting to:', url)
  
  const response = NextResponse.redirect(url)
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })
  
  return response
}
