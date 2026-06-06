import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { initDb } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { lookupUser, getHighestDjClass } from '@/lib/varchive'
import { invalidateAllUserCaches } from '@/lib/cache'

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('session')?.value
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = verifySessionCookie(sessionCookie)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const db = initDb()
  try {
    // Get V-ARCHIVE token
    const tokenRow = db
      .prepare(
        'SELECT token_encrypted, varchive_nickname FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(userId) as
      | { token_encrypted: string; varchive_nickname: string }
      | undefined

    if (!tokenRow) {
      return NextResponse.json(
        { error: 'V-ARCHIVE not linked' },
        { status: 400 }
      )
    }

    const token = decrypt(tokenRow.token_encrypted)

    // Validate token and get current nickname
    const userInfo = await lookupUser(token)
    if (!userInfo.success) {
      return NextResponse.json(
        { error: 'Invalid V-ARCHIVE token' },
        { status: 400 }
      )
    }

    // Update nickname if changed
    if (userInfo.nickname !== tokenRow.varchive_nickname) {
      db.prepare(
        'UPDATE varchive_tokens SET varchive_nickname = ? WHERE user_id = ?'
      ).run(userInfo.nickname, userId)
    }

    // Fetch highest DJ CLASS
    const djClassData = await getHighestDjClass(userInfo.nickname)

    if (djClassData) {
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
        userId,
        djClassData.button,
        djClassData.djClass,
        djClassData.djPowerSum,
        djClassData.maxDjPower,
        djClassData.djPowerConversion
      )
    } else {
      // No DJ CLASS found — delete existing row so widget shows BEGINNER
      db.prepare('DELETE FROM dj_classes WHERE user_id = ?').run(userId)
    }

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_id: string; chzzk_nickname: string } | undefined

    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    const djClass = djClassData
      ? `${djClassData.button}B ${djClassData.djClass}`
      : '4B BEGINNER'
    return NextResponse.json({
      success: true,
      djClass,
      button: djClassData?.button ?? 4,
      rawClass: djClassData?.djClass ?? 'BEGINNER',
      djPowerConversion: djClassData?.djPowerConversion ?? 0,
    })
  } catch (error) {
    console.error('Manual sync error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  } finally {
    db.close()
  }
}
