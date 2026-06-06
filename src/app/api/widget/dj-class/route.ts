import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { getDjClassFromCache, setDjClassCache } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const chzzkId = searchParams.get('chzzkId')
  const chzzkNickname = searchParams.get('chzzkNickname')

  if (!chzzkId && !chzzkNickname) {
    return NextResponse.json(
      { error: 'chzzkId or chzzkNickname required' },
      { status: 400 }
    )
  }

  const cacheKey = chzzkId ? `id:${chzzkId}` : `nick:${chzzkNickname}`

  // Check cache first
  const cached = getDjClassFromCache(cacheKey)
  if (cached) {
    if ('djClass' in cached) {
      return NextResponse.json({
        djClass: cached.djClass,
        rankName: cached.rankName,
        rankLevel: cached.rankLevel,
        powerInteger: cached.powerInteger,
        isTheory: cached.isTheory,
        source: 'cache',
      })
    }
    if ('unlinked' in cached) {
      return NextResponse.json({ unlinked: true, source: 'cache' })
    }
  }

  const db = initDb()

  // Try to find user by chzzk_id first, then by nickname
  let userId: number | undefined
  let hasToken = false

  if (chzzkId) {
    const stmt = db.prepare('SELECT id FROM users WHERE chzzk_id = ?')
    const result = stmt.get(chzzkId) as { id: number } | undefined
    if (result) userId = result.id
  }

  if (!userId && chzzkNickname) {
    const stmt = db.prepare('SELECT id FROM users WHERE chzzk_nickname = ?')
    const result = stmt.get(chzzkNickname) as { id: number } | undefined
    if (result) userId = result.id
  }

  if (!userId) {
    setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10 seconds — keep retrying until they link
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  // Check if user has linked V-ARCHIVE
  const tokenStmt = db.prepare(
    'SELECT id FROM varchive_tokens WHERE user_id = ? AND is_active = true'
  )
  const tokenResult = tokenStmt.get(userId) as { id: number } | undefined
  hasToken = !!tokenResult

  if (!hasToken) {
    setDjClassCache(cacheKey, { unlinked: true }, 0.15) // 10 seconds — keep retrying until they link
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  // Look up DJ CLASS
  const djStmt = db.prepare(
    'SELECT dj_class, button, dj_power_conversion FROM dj_classes WHERE user_id = ?'
  )
  const djResult = djStmt.get(userId) as
    | { dj_class: string; button: number; dj_power_conversion: number | null }
    | undefined

  db.close()

  if (djResult) {
    const formattedClass = `${djResult.button}B ${djResult.dj_class}`
    const isTheory =
      djResult.dj_power_conversion !== null &&
      djResult.dj_power_conversion >= 10000
    const powerInteger = djResult.dj_power_conversion
      ? Math.floor(djResult.dj_power_conversion)
      : null

    // Parse rank name and level
    const rankMatch = djResult.dj_class.match(
      /^(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
    )
    const rankName = rankMatch ? rankMatch[1].trim() : djResult.dj_class
    const rankLevel = rankMatch ? rankMatch[2] : null

    setDjClassCache(cacheKey, {
      djClass: formattedClass,
      rankName,
      rankLevel,
      powerInteger,
      isTheory,
    })
    return NextResponse.json({
      djClass: formattedClass,
      rankName,
      rankLevel,
      powerInteger,
      isTheory,
      source: 'db',
    })
  }

  // Linked but no DJ CLASS data → fallback BEGINNER (treat as 4B 0 point)
  const fallbackClass = '4B BEGINNER'
  const fallbackData = {
    djClass: fallbackClass,
    rankName: 'BEGINNER',
    rankLevel: null,
    powerInteger: 0,
    isTheory: false,
  }
  setDjClassCache(cacheKey, fallbackData, 0.25) // 15 seconds — sync may finish soon
  return NextResponse.json({ ...fallbackData, source: 'db' })
}
