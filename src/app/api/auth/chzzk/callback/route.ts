import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, getUserInfo } from '@/lib/chzzk'
import { initDb } from '@/lib/db'
import { createSessionCookie } from '@/lib/session'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('oauth_state')?.value

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url))
  }

  try {
    const { accessToken } = await exchangeCodeForToken(code)
    const userInfo = await getUserInfo(accessToken)

    const db = initDb()
    const stmt = db.prepare(`
      INSERT INTO users (chzzk_id, chzzk_nickname)
      VALUES (?, ?)
      ON CONFLICT(chzzk_id) DO UPDATE SET chzzk_nickname = excluded.chzzk_nickname
      RETURNING id
    `)
    const result = stmt.get(userInfo.userId, userInfo.nickname) as { id: number }

    const response = NextResponse.redirect(new URL('/link', request.url))
    response.cookies.set('session', createSessionCookie(result.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    response.cookies.delete('oauth_state')

    db.close()
    return response
  } catch (error) {
    console.error('OAuth callback error:', error)
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url))
  }
}
