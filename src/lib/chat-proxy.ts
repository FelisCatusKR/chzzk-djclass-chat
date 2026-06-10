import io from 'socket.io-client'
import { initDb } from './db'
import { decrypt } from './crypto'
import { refreshAccessToken } from './chzzk'
import { encrypt } from './crypto'
import { logger } from './logger'
import type { SocketIOClientSocket, SocketIOEventPacket } from './types'

interface ChatMessage {
  channelId: string
  senderChannelId: string
  nickname: string
  content: string
  messageTime: number
  emojis: Record<string, string>
}

interface WidgetSocket {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

interface ChannelConnection {
  socket: SocketIOClientSocket | null
  channelId: string
  widgets: Set<WidgetSocket>
  sessionKey: string | null
  accessToken: string
  disconnectTimeout: NodeJS.Timeout | null
  connectingPromise: Promise<void> | null
}

const connections = new Map<string, ChannelConnection>()
const FETCH_TIMEOUT_MS = 8000

async function getSessionUrl(accessToken: string): Promise<string> {
  const response = await fetch(
    'https://openapi.chzzk.naver.com/open/v1/sessions/auth',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )

  if (!response.ok) {
    throw new Error(`Session auth failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.content || data
  return content.url
}

async function subscribeToChat(
  accessToken: string,
  sessionKey: string
): Promise<void> {
  const response = await fetch(
    `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${encodeURIComponent(sessionKey)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Subscribe failed: ${response.status} - ${errorText}`)
  }

  logger.debug(`[ChatProxy] Subscribe response OK`)
}

export async function connectToChat(channelId: string): Promise<void> {
  // Check for existing connection or in-progress connection
  const existing = connections.get(channelId)
  if (existing?.socket?.connected) {
    logger.debug(`[ChatProxy] Already connected to ${channelId}`)
    return
  }
  if (existing?.connectingPromise) {
    logger.debug(
      `[ChatProxy] Connection in progress for ${channelId}, waiting...`
    )
    await existing.connectingPromise
    return
  }

  const db = initDb()

  // Create a connection stub with a promise so concurrent calls wait
  let resolveConnecting: (() => void) | null = null
  const connectingPromise = new Promise<void>((resolve) => {
    resolveConnecting = resolve
  })

  // Reuse existing stub (e.g. created by addWidget) so widgets aren't lost
  let conn: ChannelConnection
  const existingStub = connections.get(channelId)
  if (existingStub) {
    conn = existingStub
    conn.connectingPromise = connectingPromise
  } else {
    conn = {
      socket: null,
      channelId,
      widgets: new Set(),
      sessionKey: null,
      accessToken: '',
      disconnectTimeout: null,
      connectingPromise,
    }
    connections.set(channelId, conn)
  }

  try {
    const channel = db
      .prepare(
        `
      SELECT chzzk_access_token_encrypted, chzzk_refresh_token_encrypted
      FROM channels WHERE chzzk_channel_id = ?
    `
      )
      .get(channelId) as
      | {
          chzzk_access_token_encrypted: string
          chzzk_refresh_token_encrypted: string
        }
      | undefined

    if (!channel || !channel.chzzk_access_token_encrypted) {
      logger.debug(`[ChatProxy] No tokens found for ${channelId}`)
      return
    }

    let accessToken = decrypt(channel.chzzk_access_token_encrypted)

    // Check if access token is expired and refresh if needed
    const tokenExpiresRow = db
      .prepare(
        'SELECT token_expires_at FROM channels WHERE chzzk_channel_id = ?'
      )
      .get(channelId) as { token_expires_at: string } | undefined

    if (
      tokenExpiresRow &&
      new Date(tokenExpiresRow.token_expires_at) < new Date()
    ) {
      logger.debug(
        `[ChatProxy] Access token expired for ${channelId}, refreshing...`
      )
      if (channel.chzzk_refresh_token_encrypted) {
        try {
          const refreshToken = decrypt(channel.chzzk_refresh_token_encrypted)
          const refreshed = await refreshAccessToken(refreshToken)
          accessToken = refreshed.accessToken

          // Update stored tokens
          const newAccessEncrypted = encrypt(refreshed.accessToken)
          const newRefreshEncrypted = encrypt(refreshed.refreshToken)
          const newExpiresAt = new Date(
            Date.now() + refreshed.expiresIn * 1000
          ).toISOString()

          db.prepare(
            `
            UPDATE channels
            SET chzzk_access_token_encrypted = ?,
                chzzk_refresh_token_encrypted = ?,
                token_expires_at = ?
            WHERE chzzk_channel_id = ?
          `
          ).run(
            newAccessEncrypted,
            newRefreshEncrypted,
            newExpiresAt,
            channelId
          )

          logger.debug(`[ChatProxy] Token refreshed for ${channelId}`)
        } catch (refreshErr) {
          logger.error(
            `[ChatProxy] Token refresh failed for ${channelId}:`,
            refreshErr
          )
          return
        }
      } else {
        logger.debug(`[ChatProxy] No refresh token available for ${channelId}`)
        return
      }
    }

    logger.debug(`[ChatProxy] Getting session URL for ${channelId}`)
    const sessionUrlBase = await getSessionUrl(accessToken)

    // The API may already include auth; don't double-append
    const sessionUrl = sessionUrlBase.includes('?auth=')
      ? sessionUrlBase
      : `${sessionUrlBase}?auth=${encodeURIComponent(accessToken)}`

    // Clear any existing connection's disconnect timeout
    if (conn.disconnectTimeout) {
      clearTimeout(conn.disconnectTimeout)
      conn.disconnectTimeout = null
    }

    conn.accessToken = accessToken

    logger.debug(`[ChatProxy] Creating Socket.IO connection for ${channelId}`)

    // Socket.IO v2 options from Chzzk docs
    const socket = io(sessionUrl, {
      reconnection: false,
      forceNew: true,
      timeout: 3000,
      transports: ['websocket'],
    })

    conn.socket = socket

    socket.on('connect', () => {
      logger.debug(
        `[ChatProxy] Socket CONNECTED for ${channelId}, socket.id=${socket.id}`
      )
    })

    socket.on('SYSTEM', async (data: unknown) => {
      let parsed: Record<string, unknown> = {}
      if (typeof data === 'string') {
        try {
          parsed = JSON.parse(data) as Record<string, unknown>
        } catch {
          /* keep raw */
        }
      } else if (typeof data === 'object' && data !== null) {
        parsed = data as Record<string, unknown>
      }
      logger.debug(
        `[ChatProxy] SYSTEM event for ${channelId}: type=${parsed.type}, data=`,
        JSON.stringify(parsed.data || {})
      )

      const parsedData = parsed.data as Record<string, unknown> | undefined
      if (parsed.type === 'connected' && parsedData?.sessionKey) {
        const sessionKey = String(parsedData.sessionKey)
        conn.sessionKey = sessionKey

        try {
          await subscribeToChat(accessToken, sessionKey)
          logger.debug(
            `[ChatProxy] Subscribe API called successfully for ${channelId}`
          )
        } catch (err) {
          logger.error(`[ChatProxy] Failed to subscribe for ${channelId}:`, err)
        }
      }

      if (parsed.type === 'subscribed') {
        logger.debug(
          `[ChatProxy] Subscription CONFIRMED for ${channelId}, eventType=${parsedData?.eventType}, channelId=${parsedData?.channelId}`
        )
      }
    })

    socket.on('CHAT', (data: unknown) => {
      let parsed: Record<string, unknown> = {}
      if (typeof data === 'string') {
        try {
          parsed = JSON.parse(data) as Record<string, unknown>
        } catch {
          /* keep raw */
        }
      } else if (typeof data === 'object' && data !== null) {
        parsed = data as Record<string, unknown>
      }

      const profile = parsed.profile as Record<string, unknown> | undefined
      const sender = String(profile?.nickname ?? parsed.nickname ?? '')
      const content = String(parsed.content ?? '')
      const rawEmojis =
        parsed.emojis && typeof parsed.emojis === 'object'
          ? (parsed.emojis as Record<string, unknown>)
          : {}
      const emojis: Record<string, string> = Object.fromEntries(
        Object.entries(rawEmojis).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )

      if (process.env.NODE_ENV !== 'production') {
        logger.debug(
          `[ChatProxy] CHAT event for ${channelId}:`,
          JSON.stringify({
            sender,
            content: content.substring(0, 50),
            widgetCount: conn.widgets.size,
            emojiCount: Object.keys(emojis).length,
          })
        )
      }

      const msg: ChatMessage = {
        channelId: String(parsed.channelId ?? channelId),
        senderChannelId: String(
          profile?.senderChannelId ?? parsed.senderChannelId ?? ''
        ),
        nickname: sender,
        content,
        messageTime: Number(parsed.messageTime ?? Date.now()),
        emojis,
      }

      const payload = JSON.stringify({
        type: 'chat',
        data: msg,
      })

      let sent = 0
      conn.widgets.forEach((ws) => {
        if (ws.readyState === 1) {
          // OPEN
          ws.send(payload)
          sent++
        }
      })
      if (process.env.NODE_ENV !== 'production') {
        logger.debug(
          `[ChatProxy] Forwarded CHAT to ${sent}/${conn.widgets.size} widgets`
        )
      }
    })

    socket.on('disconnect', (reason: string) => {
      logger.debug(
        `[ChatProxy] Socket DISCONNECTED for ${channelId}, reason=${reason}`
      )
      conn.socket = null
      conn.sessionKey = null
      if (conn.widgets.size > 0) {
        // Widgets are still connected — retry after delay
        logger.debug(
          `[ChatProxy] Scheduling reconnect for ${channelId} (${conn.widgets.size} widgets waiting)`
        )
        setTimeout(() => {
          const checkConn = connections.get(channelId)
          if (
            checkConn &&
            checkConn.widgets.size > 0 &&
            !checkConn.socket?.connected
          ) {
            connectToChat(channelId).catch((err) => {
              logger.error(
                `[ChatProxy] Reconnect failed for ${channelId}:`,
                err
              )
            })
          }
        }, 5000)
      } else {
        connections.delete(channelId)
      }
    })

    socket.on('error', (err: Error) => {
      logger.error(`[ChatProxy] Socket ERROR for ${channelId}:`, err)
    })

    socket.on('connect_error', (err: Error) => {
      logger.error(
        `[ChatProxy] Connect ERROR for ${channelId}:`,
        err.message || err
      )
    })

    // Catch-all for unknown events to help debug (only in development)
    if (process.env.NODE_ENV !== 'production') {
      const typedSocket = socket as SocketIOClientSocket & {
        onevent?: (packet: SocketIOEventPacket) => void
      }
      const originalOnevent = typedSocket.onevent
      if (originalOnevent) {
        typedSocket.onevent = function (packet: SocketIOEventPacket) {
          const eventName = packet.data[0]
          if (
            typeof eventName === 'string' &&
            eventName !== 'CHAT' &&
            eventName !== 'SYSTEM'
          ) {
            let payload: unknown = packet.data[1]
            if (typeof payload === 'string') {
              try {
                payload = JSON.parse(payload)
              } catch {
                /* keep raw */
              }
            }
            logger.debug(
              `[ChatProxy] Unknown event for ${channelId}:`,
              eventName,
              JSON.stringify(payload ?? {}).substring(0, 200)
            )
          }
          originalOnevent.call(this, packet)
        }
      }
    }
  } finally {
    db.close()
    // Resolve the connecting promise so concurrent callers can proceed
    if (resolveConnecting) {
      ;(resolveConnecting as () => void)()
      conn.connectingPromise = null
    }
  }
}

export function disconnectFromChat(channelId: string): void {
  const conn = connections.get(channelId)
  if (conn) {
    if (conn.disconnectTimeout) {
      clearTimeout(conn.disconnectTimeout)
      conn.disconnectTimeout = null
    }
    if (conn.socket) {
      conn.socket.disconnect()
    }
    connections.delete(channelId)
    logger.debug(`[ChatProxy] Disconnected from ${channelId}`)
  }
}

export function addWidget(channelId: string, ws: WidgetSocket): void {
  let conn = connections.get(channelId)
  if (!conn) {
    conn = {
      socket: null,
      channelId,
      widgets: new Set(),
      sessionKey: null,
      accessToken: '',
      disconnectTimeout: null,
      connectingPromise: null,
    }
    connections.set(channelId, conn)

    connectToChat(channelId).catch((err) => {
      logger.error(`[ChatProxy] Failed to connect to ${channelId}:`, err)
    })
  }

  // Cancel pending disconnect if a widget reconnects
  if (conn.disconnectTimeout) {
    clearTimeout(conn.disconnectTimeout)
    conn.disconnectTimeout = null
  }

  conn.widgets.add(ws)
  logger.debug(
    `[ChatProxy] Widget added for ${channelId}, total widgets: ${conn.widgets.size}`
  )
}

export function removeWidget(channelId: string, ws: WidgetSocket): void {
  const conn = connections.get(channelId)
  if (conn) {
    conn.widgets.delete(ws)
    logger.debug(
      `[ChatProxy] Widget removed for ${channelId}, remaining widgets: ${conn.widgets.size}`
    )
    if (conn.widgets.size === 0) {
      // Clear any existing disconnect timeout to prevent race conditions
      if (conn.disconnectTimeout) {
        clearTimeout(conn.disconnectTimeout)
      }
      conn.disconnectTimeout = setTimeout(() => {
        const checkConn = connections.get(channelId)
        if (checkConn && checkConn.widgets.size === 0) {
          disconnectFromChat(channelId)
        }
      }, 30000)
    }
  }
}

export function getActiveConnections(): string[] {
  return Array.from(connections.entries())
    .filter(([, conn]) => conn.socket?.connected === true)
    .map(([channelId]) => channelId)
}
