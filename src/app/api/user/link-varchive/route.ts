import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { lookupUser, getHighestDjClass } from '@/lib/varchive'
import { verifySessionCookie } from '@/lib/session'
import { invalidateAllUserCaches } from '@/lib/cache'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const rl = rateLimit(`link:${getClientIp(request)}`, 5, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
  const signedSession = request.cookies.get('session')?.value
  const userId = signedSession ? verifySessionCookie(signedSession) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let db: ReturnType<typeof initDb> | null = null
  try {
    const { token } = await request.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Validate token with V-ARCHIVE
    const userInfo = await lookupUser(token)
    if (!userInfo.success) {
      return NextResponse.json(
        { error: '조회토큰이 유효하지 않습니다. 다시 확인해주세요.' },
        { status: 400 }
      )
    }

    // Encrypt and store token
    const encryptedToken = encrypt(token)
    db = initDb()

    const stmt = db.prepare(`
      INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        token_encrypted = excluded.token_encrypted,
        varchive_nickname = excluded.varchive_nickname,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
    `)
    stmt.run(Number(userId), encryptedToken, userInfo.nickname)

    // Immediately sync DJ CLASS / DJ POWER now that the token is linked,
    // so the user doesn't have to manually sync or wait for the daily cron.
    try {
      const djData = await getHighestDjClass(userInfo.nickname)
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
          Number(userId),
          djData.button,
          djData.djClass,
          djData.djPowerSum,
          djData.maxDjPower,
          djData.djPowerConversion
        )
      } else {
        // No DJ CLASS found — clear any stale row so the widget shows BEGINNER
        db.prepare('DELETE FROM dj_classes WHERE user_id = ?').run(
          Number(userId)
        )
      }
    } catch (syncErr) {
      // Don't fail the link if the sync hiccups; cron / manual sync will catch up.
      logger.error(
        `[Link V-ARCHIVE] Auto-sync failed for user ${userId}:`,
        syncErr
      )
    }

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(Number(userId)) as
      | { chzzk_id: string; chzzk_nickname: string }
      | undefined

    // Invalidate cache so widget shows updated status immediately
    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    return NextResponse.json({
      success: true,
      message: '연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.',
    })
  } catch (error) {
    logger.error('Link V-ARCHIVE error:', error)
    const errorCode =
      error instanceof Error && error.message.includes('fetch')
        ? 'NETWORK_ERROR'
        : 'VALIDATION_ERROR'
    return NextResponse.json(
      {
        error: '조회토큰이 유효하지 않습니다. 다시 확인해주세요.',
        code: errorCode,
      },
      { status: 400 }
    )
  } finally {
    if (db) db.close()
  }
}
