'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'

interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  isTheory: boolean
  text: string
  isUnlinked: boolean
}

interface PendingMessage {
  id: string
  senderId: string
  senderNickname: string
  messageText: string
}

interface WidgetPageProps {
  channelId: string
}

// V-ARCHIVE DJ CLASS color scheme (from official wiki)
const DJ_CLASS_COLORS: Record<string, string> = {
  'THE LORD OF DJMAX': 'linear-gradient(to right, #f2b2f7, #acebff)',
  'BEAT MAESTRO': 'linear-gradient(135deg, #ff7183, #ff8a9a)',
  SHOWSTOPPER: 'linear-gradient(135deg, #ff856f, #ff9a87)',
  HEADLINER: 'linear-gradient(135deg, #ff9758, #ffaa75)',
  'TREND SETTER': 'linear-gradient(135deg, #ffaf51, #ffbf70)',
  PROFESSIONAL: 'linear-gradient(135deg, #ffd352, #ffdd70)',
  'HIGH CLASS': 'linear-gradient(135deg, #feff63, #feff85)',
  'PRO DJ': 'linear-gradient(135deg, #c7e644, #d1eb60)',
  MIDDLEMAN: 'linear-gradient(135deg, #9ae28a, #a8e89c)',
  'STREET DJ': 'linear-gradient(135deg, #92eaca, #a2edd2)',
  ROOKIE: 'linear-gradient(135deg, #78e3da, #8ee8e0)',
  AMATEUR: 'linear-gradient(135deg, #8eccdb, #a2d6e2)',
  TRAINEE: 'linear-gradient(135deg, #a9d0ee, #bdd8f0)',
  BEGINNER: 'linear-gradient(135deg, #c0c0c0, #d0d0d0)',
}

// Short display names for DJ CLASS ranks
const SHORT_NAMES: Record<string, string> = {
  'THE LORD OF DJMAX': 'LoD',
  'BEAT MAESTRO': 'BM',
  SHOWSTOPPER: 'SS',
  HEADLINER: 'HL',
  'TREND SETTER': 'TS',
  PROFESSIONAL: 'PRO',
  'HIGH CLASS': 'HC',
  'PRO DJ': 'PD',
  MIDDLEMAN: 'MM',
  'STREET DJ': 'SD',
  ROOKIE: 'RK',
  AMATEUR: 'AM',
  TRAINEE: 'TR',
  BEGINNER: 'BG',
}

// Minimum power thresholds for each rank and level (from V-ARCHIVE wiki)
// Format: rank name -> { level: threshold }
const RANK_THRESHOLDS: Record<string, Record<string, number>> = {
  'THE LORD OF DJMAX': { default: 9980 },
  'BEAT MAESTRO': { IV: 9900, III: 9930, II: 9950, I: 9970 },
  SHOWSTOPPER: { IV: 9700, III: 9750, II: 9800, I: 9850 },
  HEADLINER: { IV: 9400, III: 9500, II: 9600, I: 9650 },
  'TREND SETTER': { IV: 9000, III: 9100, II: 9200, I: 9300 },
  PROFESSIONAL: { IV: 8600, III: 8700, II: 8800, I: 8900 },
  'HIGH CLASS': { IV: 7800, III: 8000, II: 8200, I: 8400 },
  'PRO DJ': { IV: 7000, III: 7200, II: 7400, I: 7600 },
  MIDDLEMAN: { IV: 6200, III: 6400, II: 6600, I: 6800 },
  'STREET DJ': { IV: 5200, III: 5500, II: 5800, I: 6000 },
  ROOKIE: { IV: 4000, III: 4300, II: 4600, I: 4900 },
  AMATEUR: { IV: 2400, III: 2800, II: 3200, I: 3600 },
  TRAINEE: { IV: 500, III: 1000, II: 1500, I: 2000 },
  BEGINNER: { default: 0 },
}

function getThreshold(
  rankName: string,
  rankLevel: string | null
): number | null {
  const thresholds = RANK_THRESHOLDS[rankName]
  if (!thresholds) return null
  if (thresholds.default != null) return thresholds.default
  if (rankLevel && thresholds[rankLevel] != null) return thresholds[rankLevel]
  return null
}

function getDjClassColor(rankName: string): string {
  return DJ_CLASS_COLORS[rankName] || DJ_CLASS_COLORS['BEGINNER']
}

// Client-side cache for DJ CLASS lookups (badgeMode is global, not per-user)
interface CacheEntry {
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  isTheory: boolean
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

  // Read badge mode from URL query parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    if (mode === 'threshold' || mode === 'power' || mode === 'short') {
      badgeModeRef.current = mode
    }
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
        const cacheKey = pending.senderId || pending.senderNickname

        let cacheEntry: Omit<CacheEntry, 'expiry'> = {
          djClass: null,
          rankShort: null,
          rankLevel: null,
          powerInteger: null,
          isTheory: false,
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
            isTheory: cached.isTheory,
            unlinked: cached.unlinked,
          }
        } else {
          let shouldCache = true
          try {
            const params = new URLSearchParams()
            if (pending.senderId) params.append('chzzkId', pending.senderId)
            if (pending.senderNickname)
              params.append('chzzkNickname', pending.senderNickname)

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
              if (result.unlinked) {
                cacheEntry.unlinked = true
              } else if (result.djClass) {
                cacheEntry.djClass = result.djClass
                cacheEntry.rankShort = result.rankName
                  ? SHORT_NAMES[result.rankName] || result.rankName
                  : null
                cacheEntry.rankLevel = result.rankLevel || null
                cacheEntry.powerInteger = result.powerInteger ?? null
                cacheEntry.isTheory = result.isTheory || false
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
          isTheory: cacheEntry.isTheory,
          text: pending.messageText,
          isUnlinked: cacheEntry.unlinked,
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
      <div className="flex h-full flex-col justify-end space-y-1 px-2 py-2">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`break-words text-sm ${
              msg.isUnlinked ? 'opacity-75' : 'opacity-100'
            }`}
          >
            {/* DJ CLASS Badge — content changes by mode */}
            {msg.rankShort && (
              <span
                className="mr-1 inline-block rounded px-1 py-0.5 text-xs font-bold shadow-sm"
                style={{
                  background: getDjClassColor(
                    msg.djClass
                      ?.replace(/^\d+B\s+/, '')
                      .replace(/\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
                      .trim() || 'BEGINNER'
                  ),
                  color: '#000',
                  textShadow: '0 0 1px rgba(255,255,255,0.5)',
                }}
              >
                {(() => {
                  const buttonMatch = msg.djClass?.match(/^(\d+B)/)
                  const buttonPrefix = buttonMatch ? buttonMatch[1] : ''
                  const mode = badgeModeRef.current

                  if (mode === 'short') {
                    return `${buttonPrefix} ${msg.rankShort}${msg.rankLevel ? ` ${msg.rankLevel}` : ''}`
                  }

                  if (mode === 'threshold') {
                    const rankName =
                      msg.djClass
                        ?.replace(/^\d+B\s+/, '')
                        .replace(/\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
                        .trim() || 'BEGINNER'
                    const levelMatch = msg.djClass?.match(
                      /\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i
                    )
                    const rankLevel = levelMatch ? levelMatch[1] : null
                    const threshold = getThreshold(rankName, rankLevel)
                    return threshold != null
                      ? `${buttonPrefix} ${threshold}+`
                      : `${buttonPrefix} ${msg.rankShort}`
                  }

                  if (mode === 'power') {
                    const power = msg.powerInteger ?? 0
                    return `${buttonPrefix} ${power}`
                  }

                  return `${buttonPrefix} ${msg.rankShort}`
                })()}
              </span>
            )}
            {/* Theory badge always shown if applicable */}
            {msg.isTheory && (
              <span className="theory-badge mr-1 inline-block rounded px-1 py-0.5 text-xs font-bold shadow-sm">
                이론치
              </span>
            )}
            <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              {msg.text}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <style jsx global>{`
        @keyframes glitter {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .theory-badge {
          background: linear-gradient(
            90deg,
            #ff0000,
            #ff6600,
            #ffcc00,
            #ff6600,
            #ff0000
          );
          background-size: 300% 300%;
          animation: glitter 2s ease infinite;
          color: #fff;
          text-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
        }
      `}</style>
    </div>
  )
}
