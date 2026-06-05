import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, getUserInfo } from '@/lib/chzzk'
import { initDb } from '@/lib/db'
import { createSessionCookie } from '@/lib/session'
import { encrypt } from '@/lib/crypto'
import { decrypt } from '@/lib/crypto'
import { lookupUser, getHighestDjClass } from '@/lib/varchive'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('oauth_state')?.value

  console.log('[OAuth Callback] code:', code ? code.substring(0, 10) + '...' : 'missing')
  console.log('[OAuth Callback] state:', state ? state.substring(0, 10) + '...' : 'missing')
  console.log('[OAuth Callback] storedState:', storedState ? storedState.substring(0, 10) + '...' : 'missing')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.url

  if (!code || !state || !storedState || state !== storedState) {
    console.error('[OAuth Callback] State mismatch or missing parameters')
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  }

  try {
    console.log('[OAuth Callback] Exchanging code for token...')
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForToken(code, state)
    console.log('[OAuth Callback] Token received')

    const userInfo = await getUserInfo(accessToken)
    console.log('[OAuth Callback] User info:', { userId: userInfo.userId, nickname: userInfo.nickname })

    const db = initDb()
    const stmt = db.prepare(`
      INSERT INTO users (chzzk_id, chzzk_nickname)
      VALUES (?, ?)
      ON CONFLICT(chzzk_id) DO UPDATE SET chzzk_nickname = excluded.chzzk_nickname
      RETURNING id
    `)
    const result = stmt.get(userInfo.userId, userInfo.nickname) as { id: number }

    // Store encrypted Chzzk tokens in channels table for chat proxy
    const expiresAt = new Date(Date.now() + (expiresIn || 86400) * 1000).toISOString()
    db.prepare(`
      INSERT INTO channels (user_id, chzzk_channel_id, chzzk_access_token_encrypted, chzzk_refresh_token_encrypted, token_expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        chzzk_access_token_encrypted = excluded.chzzk_access_token_encrypted,
        chzzk_refresh_token_encrypted = excluded.chzzk_refresh_token_encrypted,
        token_expires_at = excluded.token_expires_at
    `).run(
      result.id,
      userInfo.userId,
      encrypt(accessToken),
      encrypt(refreshToken),
      expiresAt
    )

    // Auto-sync DJ CLASS if V-ARCHIVE is already linked
    const tokenRow = db.prepare(
      'SELECT token_encrypted, varchive_nickname FROM varchive_tokens WHERE user_id = ? AND is_active = true'
    ).get(result.id) as { token_encrypted: string; varchive_nickname: string } | undefined

    if (tokenRow) {
      try {
        const vtoken = decrypt(tokenRow.token_encrypted)
        const vuser = await lookupUser(vtoken)
        if (vuser.success) {
          const djData = await getHighestDjClass(vuser.nickname)
          if (djData) {
            db.prepare(`
              INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET
                button = excluded.button,
                dj_class = excluded.dj_class,
                dj_power_sum = excluded.dj_power_sum,
                max_dj_power = excluded.max_dj_power,
                dj_power_conversion = excluded.dj_power_conversion,
                synced_at = excluded.synced_at
            `).run(
              result.id,
              djData.button,
              djData.djClass,
              djData.djPowerSum,
              djData.maxDjPower,
              djData.djPowerConversion
            )
            console.log(`[OAuth Callback] Auto-synced DJ CLASS for user ${result.id}`)
          }
        }
      } catch (syncErr) {
        console.error(`[OAuth Callback] Auto-sync failed for user ${result.id}:`, syncErr)
      }
    }

    const response = NextResponse.redirect(new URL('/link', baseUrl))
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
    console.error('[OAuth Callback] Error:', error)
    if (error instanceof Error) {
      console.error('[OAuth Callback] Error details:', error.message)
    }
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  }
}
