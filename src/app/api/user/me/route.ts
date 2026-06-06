import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { initDb } from '@/lib/db'

export async function GET(request: NextRequest) {
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
    const user = db
      .prepare('SELECT chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_nickname: string } | undefined

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const token = db
      .prepare(
        'SELECT varchive_nickname FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(userId) as { varchive_nickname: string } | undefined

    const djClassRow = db
      .prepare(
        'SELECT dj_class, button, dj_power_conversion FROM dj_classes WHERE user_id = ?'
      )
      .get(userId) as
      | { dj_class: string; button: number; dj_power_conversion: number | null }
      | undefined

    const powerInteger = djClassRow?.dj_power_conversion
      ? Math.floor(djClassRow.dj_power_conversion)
      : null

    return NextResponse.json({
      chzzkNickname: user.chzzk_nickname,
      varchiveLinked: !!token,
      varchiveNickname: token?.varchive_nickname || null,
      djClass: djClassRow
        ? `${djClassRow.button}B ${djClassRow.dj_class}`
        : null,
      powerInteger,
    })
  } finally {
    db.close()
  }
}
