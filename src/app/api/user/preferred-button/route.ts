import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { initDb } from '@/lib/db'
import { validatePreferredButton } from '@/lib/dj-class'
import { invalidateAllUserCaches } from '@/lib/cache'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const rl = rateLimit(`pref-button:${getClientIp(request)}`, 10, 60_000)
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

  let body: { button?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const db = initDb()
  try {
    const available = (
      db
        .prepare('SELECT button FROM dj_classes WHERE user_id = ?')
        .all(userId) as { button: number }[]
    ).map((r) => r.button)

    let resolved: number | null
    try {
      resolved = validatePreferredButton(body.button ?? null, available)
    } catch {
      return NextResponse.json(
        { error: 'Invalid preferred button' },
        { status: 400 }
      )
    }

    db.prepare('UPDATE users SET preferred_button = ? WHERE id = ?').run(
      resolved,
      userId
    )

    const userRow = db
      .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
      .get(userId) as { chzzk_id: string; chzzk_nickname: string } | undefined
    if (userRow) {
      invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
    }

    return NextResponse.json({ success: true, preferredButton: resolved })
  } finally {
    db.close()
  }
}
