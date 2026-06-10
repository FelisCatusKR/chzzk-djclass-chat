'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'
import { FONT_SIZE_DEFAULT, parseFontSize } from '@/lib/font-size'
import { parseFadeout } from '@/lib/fadeout'
import { SHORT_NAMES } from '@/lib/dj-class'
import ChatMessageRow, { type ChatMessage } from './ChatMessageRow'

interface WidgetPageProps {
  channelId: string
}

// Client-side cache for DJ CLASS lookups (badgeMode is global, not per-user)
interface CacheEntry {
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  unverified: boolean
  expiry: number
}

// Badge fields without the cache bookkeeping — what a lookup resolves to and
// what gets patched onto a rendered message.
type DjClassFields = Omit<CacheEntry, 'expiry'>

const EMPTY_FIELDS: DjClassFields = {
  djClass: null,
  rankShort: null,
  rankLevel: null,
  powerInteger: null,
  unverified: false,
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
  // Dedup in-flight DJ-class lookups so a chatter sending a burst triggers one
  // request, not one per message. Keyed by `senderKey:sel`.
  const inFlightRef = useRef<Map<string, Promise<DjClassFields>>>(new Map())
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
          const senderId: string = data.senderChannelId || ''
          const senderNickname: string = data.nickname || ''
          const messageText: string = data.content
          const emojis: Record<string, string> = data.emojis || {}

          if (!messageText) return

          const senderKey = senderId || senderNickname
          const cacheKey = senderKey ? `${senderKey}:${selRef.current}` : ''
          const cached = cacheKey ? getCachedDjClass(cacheKey) : undefined
          const fields: DjClassFields = cached ?? EMPTY_FIELDS

          // Render immediately — text never waits on the badge lookup. If the
          // sender isn't cached yet, badge fields are filled in by patchSender()
          // once the async lookup resolves.
          const message: ChatMessage = {
            id: `${Date.now()}-${Math.random()}`,
            senderKey,
            djClass: fields.djClass,
            rankShort: fields.rankShort,
            rankLevel: fields.rankLevel,
            powerInteger: fields.powerInteger,
            text: messageText,
            emojis,
            isUnverified: fields.unverified,
            pending: !cached && !!cacheKey,
            createdAt: Date.now(),
          }
          setMessages((prev) => [...prev.slice(-99), message])

          if (!cached && cacheKey) {
            lookupSender(senderId, senderNickname, cacheKey).then(
              (resolved) => {
                if (isUnmountingRef.current) return
                patchSender(senderKey, resolved)
              }
            )
          }
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

    // Resolve a sender's DJ-class fields, deduping concurrent lookups for the
    // same sender so a burst triggers one request. Resolves to EMPTY_FIELDS on
    // transient errors (and doesn't cache them, so the next message retries).
    const lookupSender = (
      senderId: string,
      senderNickname: string,
      cacheKey: string
    ): Promise<DjClassFields> => {
      const existing = inFlightRef.current.get(cacheKey)
      if (existing) return existing

      const promise = (async (): Promise<DjClassFields> => {
        const fields: DjClassFields = { ...EMPTY_FIELDS }
        let shouldCache = true
        try {
          const params = new URLSearchParams()
          if (senderId) params.append('chzzkId', senderId)
          if (senderNickname) params.append('chzzkNickname', senderNickname)
          params.append('sel', selRef.current)

          const response = await fetch(
            `/api/widget/dj-class?${params.toString()}`
          )
          if (!response.ok) {
            console.error('[Widget] DJ CLASS lookup failed:', response.status)
            // Only mark unverified on 404; 5xx are transient — don't cache.
            if (response.status === 404) fields.unverified = true
            else shouldCache = false
          } else {
            const result = await response.json()
            if (result.unlinked || result.unsynced) {
              fields.unverified = true
            } else if (result.djClass) {
              fields.djClass = result.djClass
              fields.rankShort = result.rankName
                ? SHORT_NAMES[result.rankName] || result.rankName
                : null
              fields.rankLevel = result.rankLevel || null
              fields.powerInteger = result.powerInteger ?? null
            }
          }
        } catch {
          // Network error — don't cache, retry on the sender's next message.
          shouldCache = false
        }
        if (shouldCache) setCachedDjClass(cacheKey, fields)
        return fields
      })()

      inFlightRef.current.set(cacheKey, promise)
      void promise.finally(() => inFlightRef.current.delete(cacheKey))
      return promise
    }

    // Patch every currently-displayed pending row from this sender with the
    // resolved badge fields, in a single state update.
    const patchSender = (senderKey: string, fields: DjClassFields) => {
      setMessages((prev) => {
        let changed = false
        const next = prev.map((m) => {
          if (m.senderKey !== senderKey || !m.pending) return m
          changed = true
          return {
            ...m,
            djClass: fields.djClass,
            rankShort: fields.rankShort,
            rankLevel: fields.rankLevel,
            powerInteger: fields.powerInteger,
            isUnverified: fields.unverified,
            pending: false,
          }
        })
        return changed ? next : prev
      })
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
    // 'auto' (not 'smooth'): bursts must not queue stacked scroll animations.
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
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
