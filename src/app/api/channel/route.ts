import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'

export async function GET(request: NextRequest) {
  const userId = request.cookies.get('user_id')?.value
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = initDb()

  // Get or create channel
  const getStmt = db.prepare('SELECT * FROM channels WHERE user_id = ?')
  let channel = getStmt.get(Number(userId)) as
    | { id: number; chzzk_channel_id: string }
    | undefined

  if (!channel) {
    // Get user's chzzk_id to use as channel_id
    const userStmt = db.prepare('SELECT chzzk_id FROM users WHERE id = ?')
    const user = userStmt.get(Number(userId)) as { chzzk_id: string } | undefined

    if (!user) {
      db.close()
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const insertStmt = db.prepare(`
      INSERT INTO channels (user_id, chzzk_channel_id)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET chzzk_channel_id = excluded.chzzk_channel_id
      RETURNING id, chzzk_channel_id
    `)
    channel = insertStmt.get(Number(userId), user.chzzk_id) as {
      id: number
      chzzk_channel_id: string
    }
  }

  db.close()

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  return NextResponse.json({
    channelId: channel.chzzk_channel_id,
    widgetUrl: `${baseUrl}/widget/${channel.chzzk_channel_id}`,
  })
}
