import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/session'
import { initDb } from '@/lib/db'
import { resolveDisplayedClass } from '@/lib/dj-class'

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

    const buttonRows = db
      .prepare(
        'SELECT button, dj_class, dj_power_conversion FROM dj_classes WHERE user_id = ? ORDER BY button'
      )
      .all(userId) as Array<{
      button: number
      dj_class: string
      dj_power_conversion: number | null
    }>

    const prefRow = db
      .prepare('SELECT preferred_button FROM users WHERE id = ?')
      .get(userId) as { preferred_button: number | null } | undefined

    const highest = resolveDisplayedClass(
      buttonRows.map((r) => ({
        button: r.button,
        djClass: r.dj_class,
        djPowerConversion: r.dj_power_conversion,
      })),
      null,
      'auto'
    )
    const powerInteger = highest?.djPowerConversion
      ? Math.floor(highest.djPowerConversion)
      : null

    return NextResponse.json({
      chzzkNickname: user.chzzk_nickname,
      varchiveLinked: !!token,
      varchiveNickname: token?.varchive_nickname || null,
      djClass: highest ? `${highest.button}B ${highest.djClass}` : null,
      powerInteger,
      preferredButton: prefRow?.preferred_button ?? null,
      buttons: buttonRows.map((r) => ({
        button: r.button,
        djClass: `${r.button}B ${r.dj_class}`,
        powerInteger: r.dj_power_conversion
          ? Math.floor(r.dj_power_conversion)
          : null,
      })),
    })
  } finally {
    db.close()
  }
}
