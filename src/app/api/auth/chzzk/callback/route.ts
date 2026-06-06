import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, getUserInfo } from '@/lib/chzzk'
import { logger } from '@/lib/logger'
import { initDb } from '@/lib/db'
import { createSessionCookie } from '@/lib/session'
import { encrypt } from '@/lib/crypto'
import { decrypt } from '@/lib/crypto'
import { lookupUser, getHighestDjClass } from '@/lib/varchive'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeNextPath } from '@/lib/safe-redirect'

export async function GET(request: NextRequest) {
  const rl = rateLimit(`authcb:${getClientIp(request)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('oauth_state')?.value

  logger.debug('[OAuth Callback] received callback')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.url

  if (!code || !state || !storedState || state !== storedState) {
    logger.warn('[OAuth Callback] State mismatch or missing parameters')
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  }

  let db: ReturnType<typeof initDb> | null = null
  try {
    logger.debug('[OAuth Callback] Exchanging code for token...')
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForToken(
      code,
      state
    )
    logger.debug('[OAuth Callback] Token received')

    const userInfo = await getUserInfo(accessToken)
    logger.debug('[OAuth Callback] User info:', {
      userId: userInfo.userId,
      nickname: userInfo.nickname,
    })

    db = initDb()
    const stmt = db.prepare(`
      INSERT INTO users (chzzk_id, chzzk_nickname)
      VALUES (?, ?)
      ON CONFLICT(chzzk_id) DO UPDATE SET chzzk_nickname = excluded.chzzk_nickname
      RETURNING id
    `)
    const result = stmt.get(userInfo.userId, userInfo.nickname) as {
      id: number
    }

    // Store encrypted Chzzk tokens in channels table for chat proxy
    const expiresAt = new Date(
      Date.now() + (expiresIn || 86400) * 1000
    ).toISOString()
    db.prepare(
      `
      INSERT INTO channels (user_id, chzzk_channel_id, chzzk_access_token_encrypted, chzzk_refresh_token_encrypted, token_expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        chzzk_access_token_encrypted = excluded.chzzk_access_token_encrypted,
        chzzk_refresh_token_encrypted = excluded.chzzk_refresh_token_encrypted,
        token_expires_at = excluded.token_expires_at
    `
    ).run(
      result.id,
      userInfo.userId,
      encrypt(accessToken),
      encrypt(refreshToken),
      expiresAt
    )

    // Auto-sync DJ CLASS if V-ARCHIVE is already linked
    const tokenRow = db
      .prepare(
        'SELECT token_encrypted, varchive_nickname FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(result.id) as
      | { token_encrypted: string; varchive_nickname: string }
      | undefined

    if (tokenRow) {
      try {
        const vtoken = decrypt(tokenRow.token_encrypted)
        const vuser = await lookupUser(vtoken)
        if (vuser.success) {
          const djData = await getHighestDjClass(vuser.nickname)
          if (djData) {
            db.prepare(
              `
              INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET
                button = excluded.button,
                dj_class = excluded.dj_class,
                dj_power_sum = excluded.dj_power_sum,
                max_dj_power = excluded.max_dj_power,
                dj_power_conversion = excluded.dj_power_conversion,
                synced_at = excluded.synced_at
            `
            ).run(
              result.id,
              djData.button,
              djData.djClass,
              djData.djPowerSum,
              djData.maxDjPower,
              djData.djPowerConversion
            )
            logger.debug(
              `[OAuth Callback] Auto-synced DJ CLASS for user ${result.id}`
            )
          }
        }
      } catch (syncErr) {
        logger.error(
          `[OAuth Callback] Auto-sync failed for user ${result.id}:`,
          syncErr
        )
      }
    }

    const nextPath = safeNextPath(request.cookies.get('oauth_next')?.value)
    const response = NextResponse.redirect(new URL(nextPath, baseUrl))
    response.cookies.set('session', createSessionCookie(result.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    response.cookies.delete('oauth_state')
    response.cookies.delete('oauth_next')

    return response
  } catch (error) {
    logger.error('[OAuth Callback] Error:', error)
    if (error instanceof Error) {
      logger.error('[OAuth Callback] Error details:', error.message)
    }
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl))
  } finally {
    if (db) db.close()
  }
}
