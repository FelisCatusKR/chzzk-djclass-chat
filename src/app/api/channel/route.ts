import { NextRequest, NextResponse } from 'next/server'
import { getSharedDb } from '@/lib/db'
import { verifySessionCookie } from '@/lib/session'
import { getActiveConnections } from '@/lib/chat-proxy'

export async function GET(request: NextRequest) {
  const signedSession = request.cookies.get('session')?.value
  const userId = signedSession ? verifySessionCookie(signedSession) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getSharedDb()

  // Get or create channel
  const getStmt = db.prepare('SELECT * FROM channels WHERE user_id = ?')
  let channel = getStmt.get(Number(userId)) as
    | {
        id: number
        chzzk_channel_id: string
        chzzk_access_token_encrypted: string | null
      }
    | undefined

  if (!channel) {
    // Get user's chzzk_id to use as channel_id
    const userStmt = db.prepare('SELECT chzzk_id FROM users WHERE id = ?')
    const user = userStmt.get(Number(userId)) as
      | { chzzk_id: string }
      | undefined

    if (!user) {
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
      chzzk_access_token_encrypted: string | null
    }
  }

  // Check if chat proxy is active
  const activeConnections = getActiveConnections()
  const isConnected = activeConnections.includes(channel.chzzk_channel_id)
  const hasTokens = !!channel.chzzk_access_token_encrypted

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  return NextResponse.json({
    channelId: channel.chzzk_channel_id,
    widgetUrl: `${baseUrl}/widget/${channel.chzzk_channel_id}`,
    isConnected,
    hasTokens,
  })
}
