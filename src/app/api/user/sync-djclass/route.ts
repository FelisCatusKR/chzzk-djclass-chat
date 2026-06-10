import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { getSharedDb } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { lookupUser, getAllDjClasses } from '@/lib/varchive'
import { persistUserDjClasses } from '@/lib/dj-class-store'
import { resolveDisplayedClass } from '@/lib/dj-class'
import { invalidateAllUserCaches } from '@/lib/cache'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const rl = rateLimit(`sync:${getClientIp(request)}`, 3, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    )
  }
  const sessionCookie = request.cookies.get('session')?.value
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = verifySessionCookie(sessionCookie)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const db = getSharedDb()
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

    // Fetch all buttons that have a record and persist them.
    const all = await getAllDjClasses(userInfo.nickname)
    persistUserDjClasses(
      db,
      userId,
      all.map((c) => ({
        button: c.button,
        djClass: c.djClass,
        djPowerSum: c.djPowerSum,
        maxDjPower: c.maxDjPower,
        djPowerConversion: c.djPowerConversion,
      }))
    )

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_id: string; chzzk_nickname: string } | undefined

    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    // Report the highest CLASS for the link-page status row.
    const highest = resolveDisplayedClass(
      all.map((c) => ({
        button: c.button,
        djClass: c.djClass,
        djPowerConversion: c.djPowerConversion,
      })),
      null,
      'auto'
    )
    const djClass = highest
      ? `${highest.button}B ${highest.djClass}`
      : '4B BEGINNER'
    return NextResponse.json({
      success: true,
      djClass,
      button: highest?.button ?? 4,
      rawClass: highest?.djClass ?? 'BEGINNER',
      djPowerConversion: highest?.djPowerConversion ?? 0,
    })
  } catch (error) {
    logger.error('Manual sync error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
