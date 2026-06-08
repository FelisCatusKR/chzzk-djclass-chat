'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'
import { FONT_SIZE_DEFAULT, parseFontSize } from '@/lib/font-size'
import { parseFadeout } from '@/lib/fadeout'
import { SHORT_NAMES } from '@/lib/dj-class'
import ChatMessageRow, { type ChatMessage } from './ChatMessageRow'

interface PendingMessage {
  id: string
  senderId: string
  senderNickname: string
  messageText: string
}

interface WidgetPageProps {
  channelId: string
}

// Client-side cache for DJ CLASS lookups (badgeMode is global, not per-user)
interface CacheEntry {
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  unlinked: boolean
  expiry: number
}

const djClassCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

function getCachedDjClass(key: string): CacheEntry | undefined {
  const entry = djClassCache.get(key)
  if (entry && Date.now() < entry.expiry) {
    return entry
  }
  djClassCache.delete(key)
  return undefined
}

function setCachedDjClass(
  key: string,
  entry: Omit<CacheEntry, 'expiry'>
): void {
  djClassCache.set(key, { ...entry, expiry: Date.now() + CACHE_TTL_MS })
}

export default function WidgetPage({ channelId }: WidgetPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUnmountingRef = useRef(false)
  const pendingQueueRef = useRef<PendingMessage[]>([])
  const isProcessingRef = useRef(false)
  const badgeModeRef = useRef<BadgeMode>('short')
  const selRef = useRef<'auto' | 'viewer'>('auto')
  const [fontSize, setFontSize] = useState<number>(FONT_SIZE_DEFAULT)
  const [fadeoutSec, setFadeoutSec] = useState<number>(0)

  // Read badge mode and font size from URL query parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    if (mode === 'threshold' || mode === 'power' || mode === 'short') {
      badgeModeRef.current = mode
    }
    selRef.current = params.get('buttonSel') === 'viewer' ? 'viewer' : 'auto'
    setFontSize(parseFontSize(params.get('fontSize')))
    setFadeoutSec(parseFadeout(params.get('fadeout')))
  }, [])

  useEffect(() => {
    isUnmountingRef.current = false

    const connect = () => {
      if (isUnmountingRef.current) return
      if (retryCountRef.current >= 5) {
        setConnectionStatus('error')
        return
      }

      setConnectionStatus('connecting')
      retryCountRef.current++

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws/chat?channelId=${channelId}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (isUnmountingRef.current) {
          ws.close()
          return
        }
        setConnectionStatus('connected')
        retryCountRef.current = 0
      }

      ws.onmessage = (event) => {
        if (isUnmountingRef.current) return
        try {
          const payload = JSON.parse(event.data)
          if (payload.type !== 'chat') return

          const data = payload.data
          const senderId = data.senderChannelId
          const senderNickname = data.nickname
          const messageText = data.content

          if (!messageText) return

          // Queue message for sequential processing
          pendingQueueRef.current.push({
            id: `${Date.now()}-${Math.random()}`,
            senderId: senderId || '',
            senderNickname: senderNickname || '',
            messageText,
          })

          processQueue()
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onerror = () => {
        if (isUnmountingRef.current) return
        console.error('[Widget] WebSocket error')
        setConnectionStatus('error')
      }

      ws.onclose = () => {
        if (isUnmountingRef.current) return
        if (retryCountRef.current < 5) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, 3000)
        }
      }
    }

    const processQueue = async () => {
      if (isProcessingRef.current) return
      isProcessingRef.current = true

      while (pendingQueueRef.current.length > 0) {
        if (isUnmountingRef.current) break

        const pending = pendingQueueRef.current.shift()!
        const senderKey = pending.senderId || pending.senderNickname
        const cacheKey = senderKey ? `${senderKey}:${selRef.current}` : ''

        let cacheEntry: Omit<CacheEntry, 'expiry'> = {
          djClass: null,
          rankShort: null,
          rankLevel: null,
          powerInteger: null,
          unlinked: false,
        }

        // Check client-side cache first
        const cached = cacheKey ? getCachedDjClass(cacheKey) : undefined
        if (cached) {
          cacheEntry = {
            djClass: cached.djClass,
            rankShort: cached.rankShort,
            rankLevel: cached.rankLevel,
            powerInteger: cached.powerInteger,
            unlinked: cached.unlinked,
          }
        } else {
          let shouldCache = true
          try {
            const params = new URLSearchParams()
            if (pending.senderId) params.append('chzzkId', pending.senderId)
            if (pending.senderNickname)
              params.append('chzzkNickname', pending.senderNickname)
            params.append('sel', selRef.current)

            const response = await fetch(
              `/api/widget/dj-class?${params.toString()}`
            )
            if (!response.ok) {
              console.error('[Widget] DJ CLASS lookup failed:', response.status)
              // Only mark as unlinked on 404; 500s are temporary server errors
              if (response.status === 404) {
                cacheEntry.unlinked = true
              } else {
                // Temporary error — don't cache, just show message without badges
                shouldCache = false
              }
            } else {
              const result = await response.json()
              if (result.unlinked || result.unsynced) {
                cacheEntry.unlinked = true
              } else if (result.djClass) {
                cacheEntry.djClass = result.djClass
                cacheEntry.rankShort = result.rankName
                  ? SHORT_NAMES[result.rankName] || result.rankName
                  : null
                cacheEntry.rankLevel = result.rankLevel || null
                cacheEntry.powerInteger = result.powerInteger ?? null
              }
            }
          } catch {
            // Network error — don't cache, retry on next message
            shouldCache = false
          }

          // Cache the result only for successful lookups or confirmed unlinked
          if (shouldCache && cacheKey) {
            setCachedDjClass(cacheKey, cacheEntry)
          }
        }

        const newMessage: ChatMessage = {
          id: pending.id,
          djClass: cacheEntry.djClass,
          rankShort: cacheEntry.rankShort,
          rankLevel: cacheEntry.rankLevel,
          powerInteger: cacheEntry.powerInteger,
          text: pending.messageText,
          isUnlinked: cacheEntry.unlinked,
          createdAt: Date.now(),
        }

        setMessages((prev) => [...prev.slice(-99), newMessage])
      }

      isProcessingRef.current = false
    }

    connect()

    return () => {
      isUnmountingRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [channelId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Per-message fadeout: when enabled, mark aged messages as fading (CSS
  // transitions them out), then drop them once the transition has finished.
  useEffect(() => {
    if (fadeoutSec <= 0) return
    const FADE_MS = 500
    const interval = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        let changed = false
        const next: ChatMessage[] = []
        for (const m of prev) {
          const age = m.createdAt ? now - m.createdAt : 0
          if (m.createdAt && age >= fadeoutSec * 1000 + FADE_MS) {
            changed = true
            continue // remove fully-faded message
          }
          if (m.createdAt && age >= fadeoutSec * 1000 && !m.fading) {
            changed = true
            next.push({ ...m, fading: true })
          } else {
            next.push(m)
          }
        }
        return changed ? next : prev
      })
    }, 250)
    return () => clearInterval(interval)
  }, [fadeoutSec])

  return (
    <div
      className="h-screen w-full overflow-hidden bg-transparent"
      style={{
        fontFamily:
          "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans KR', sans-serif",
      }}
    >
      {connectionStatus === 'connecting' && messages.length === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-white/50">
          채팅 연결 중...
        </div>
      )}
      {connectionStatus === 'error' && messages.length === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-red-400/50">
          채팅 연결 실패
        </div>
      )}
      <div
        className="flex h-full flex-col justify-end space-y-1 px-2 py-2"
        style={{ fontSize }}
      >
        {messages.map((msg) => (
          <ChatMessageRow
            key={msg.id}
            message={msg}
            badgeMode={badgeModeRef.current}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
