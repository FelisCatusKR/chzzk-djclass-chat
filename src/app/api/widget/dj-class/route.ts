import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { getDjClassFromCache, setDjClassCache } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const chzzkId = searchParams.get('chzzkId')
  const chzzkNickname = searchParams.get('chzzkNickname')

  if (!chzzkId && !chzzkNickname) {
    return NextResponse.json({ error: 'chzzkId or chzzkNickname required' }, { status: 400 })
  }

  const cacheKey = chzzkId ? `id:${chzzkId}` : `nick:${chzzkNickname}`

  // Check cache first
  const cached = getDjClassFromCache(cacheKey)
  if (cached) {
    if ('djClass' in cached) {
      return NextResponse.json({ djClass: cached.djClass, source: 'cache' })
    }
    if ('beginner' in cached) {
      return NextResponse.json({ djClass: 'BEGINNER', source: 'cache' })
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
    setDjClassCache(cacheKey, { unlinked: true }, 1)
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  // Check if user has linked V-ARCHIVE
  const tokenStmt = db.prepare('SELECT id FROM varchive_tokens WHERE user_id = ? AND is_active = true')
  const tokenResult = tokenStmt.get(userId) as { id: number } | undefined
  hasToken = !!tokenResult

  if (!hasToken) {
    setDjClassCache(cacheKey, { unlinked: true }, 1)
    db.close()
    return NextResponse.json({ unlinked: true, source: 'db' })
  }

  // Look up DJ CLASS
  const djStmt = db.prepare('SELECT dj_class FROM dj_classes WHERE user_id = ?')
  const djResult = djStmt.get(userId) as { dj_class: string } | undefined

  db.close()

  if (djResult) {
    setDjClassCache(cacheKey, { djClass: djResult.dj_class })
    return NextResponse.json({ djClass: djResult.dj_class, source: 'db' })
  }

  // Linked but no DJ CLASS data → BEGINNER
  setDjClassCache(cacheKey, { beginner: true })
  return NextResponse.json({ djClass: 'BEGINNER', source: 'db' })
}
