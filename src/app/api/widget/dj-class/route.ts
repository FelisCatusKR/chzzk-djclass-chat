import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { getDjClassFromCache, setDjClassCache } from '@/lib/cache'
import { resolveDisplayedClass, type DjClassRow } from '@/lib/dj-class'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const chzzkId = searchParams.get('chzzkId')
  const chzzkNickname = searchParams.get('chzzkNickname')
  const sel = searchParams.get('sel') === 'viewer' ? 'viewer' : 'auto'

  if (!chzzkId && !chzzkNickname) {
    return NextResponse.json(
      { error: 'chzzkId or chzzkNickname required' },
      { status: 400 }
    )
  }

  const baseKey = chzzkId ? `id:${chzzkId}` : `nick:${chzzkNickname}`
  const cacheKey = `${baseKey}:${sel}`

  // Check cache first
  const cached = getDjClassFromCache(cacheKey)
  if (cached) {
    if ('djClass' in cached) {
      return NextResponse.json({
        djClass: cached.djClass,
        rankName: cached.rankName,
        rankLevel: cached.rankLevel,
        powerInteger: cached.powerInteger,
        source: 'cache',
      })
    }
    if ('unlinked' in cached) {
      return NextResponse.json({ unlinked: true, source: 'cache' })
    }
  }

  const db = initDb()
  try {
    // Try to find user by chzzk_id first, then by nickname
    let userId: number | undefined

    if (chzzkId) {
      const result = db
        .prepare('SELECT id FROM users WHERE chzzk_id = ?')
        .get(chzzkId) as { id: number } | undefined
      if (result) userId = result.id
    }

    if (!userId && chzzkNickname) {
      const result = db
        .prepare('SELECT id FROM users WHERE chzzk_nickname = ?')
        .get(chzzkNickname) as { id: number } | undefined
      if (result) userId = result.id
    }

    if (!userId) {
      setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10s — keep retrying until they link
      return NextResponse.json({ unlinked: true, source: 'db' })
    }

    // Check if user has linked V-ARCHIVE
    const tokenResult = db
      .prepare(
        'SELECT id FROM varchive_tokens WHERE user_id = ? AND is_active = true'
      )
      .get(userId) as { id: number } | undefined

    if (!tokenResult) {
      setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10s — keep retrying until they link
      return NextResponse.json({ unlinked: true, source: 'db' })
    }

    // Load all stored buttons + the viewer's preferred button, then resolve.
    const dbRows = db
      .prepare(
        'SELECT button, dj_class, dj_power_conversion FROM dj_classes WHERE user_id = ?'
      )
      .all(userId) as Array<{
      button: number
      dj_class: string
      dj_power_conversion: number | null
    }>
    const prefRow = db
      .prepare('SELECT preferred_button FROM users WHERE id = ?')
      .get(userId) as { preferred_button: number | null } | undefined

    const rows: DjClassRow[] = dbRows.map((r) => ({
      button: r.button,
      djClass: r.dj_class,
      djPowerConversion: r.dj_power_conversion,
    }))
    const chosen = resolveDisplayedClass(
      rows,
      prefRow?.preferred_button ?? null,
      sel
    )

    if (chosen) {
      const formattedClass = `${chosen.button}B ${chosen.djClass}`
      const powerInteger = chosen.djPowerConversion
        ? Math.floor(chosen.djPowerConversion)
        : null
      const rankMatch = chosen.djClass.match(
        /^(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
      )
      const rankName = rankMatch ? rankMatch[1].trim() : chosen.djClass
      const rankLevel = rankMatch ? rankMatch[2] : null

      setDjClassCache(cacheKey, {
        djClass: formattedClass,
        rankName,
        rankLevel,
        powerInteger,
      })
      return NextResponse.json({
        djClass: formattedClass,
        rankName,
        rankLevel,
        powerInteger,
        source: 'db',
      })
    }

    // Linked but no DJ CLASS data → fallback BEGINNER (treat as 4B 0 point)
    const fallbackData = {
      djClass: '4B BEGINNER',
      rankName: 'BEGINNER',
      rankLevel: null,
      powerInteger: 0,
    }
    setDjClassCache(cacheKey, fallbackData, 0.25) // 15s — sync may finish soon
    return NextResponse.json({ ...fallbackData, source: 'db' })
  } finally {
    db.close()
  }
}
