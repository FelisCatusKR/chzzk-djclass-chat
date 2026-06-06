import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { lookupUser } from '@/lib/varchive'
import { verifySessionCookie } from '@/lib/session'
import { invalidateAllUserCaches } from '@/lib/cache'

export async function POST(request: NextRequest) {
  const signedSession = request.cookies.get('session')?.value
  const userId = signedSession ? verifySessionCookie(signedSession) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    const db = initDb()

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

    // Get user's chzzk info for cache invalidation
    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(Number(userId)) as
      | { chzzk_id: string; chzzk_nickname: string }
      | undefined

    db.close()

    // Invalidate cache so widget shows updated status immediately
    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    return NextResponse.json({
      success: true,
      message: '연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.',
    })
  } catch (error) {
    console.error('Link V-ARCHIVE error:', error)
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
  }
}
