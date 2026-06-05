'use client'

import { useEffect, useRef, useState } from 'react'

interface ChatMessage {
  id: string
  djClass: string | null
  text: string
  isUnlinked: boolean
}

interface WidgetPageProps {
  channelId: string
}

export default function WidgetPage({ channelId }: WidgetPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Connect to Chzzk WebSocket
    // Note: Actual Chzzk WebSocket URL may differ. This is a placeholder.
    const wsUrl = `wss://chat.chzzk.naver.com/chat?channelId=${channelId}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        
        // Parse Chzzk chat message format
        // Note: Actual Chzzk WebSocket payload format needs to be verified during testing
        const senderId = data.userId || data.sender?.userId
        const senderNickname = data.nickname || data.sender?.nickname
        const messageText = data.message || data.content

        if (!messageText) return

        // Lookup DJ CLASS
        let djClass: string | null = null
        let isUnlinked = false

        try {
          const params = new URLSearchParams()
          if (senderId) params.append('chzzkId', senderId)
          if (senderNickname) params.append('chzzkNickname', senderNickname)

          const response = await fetch(`/api/widget/dj-class?${params.toString()}`)
          const result = await response.json()

          if (result.unlinked) {
            isUnlinked = true
          } else if (result.djClass) {
            djClass = result.djClass
          }
        } catch {
          // On error, treat as unlinked
          isUnlinked = true
        }

        const newMessage: ChatMessage = {
          id: `${Date.now()}-${Math.random()}`,
          djClass,
          text: messageText,
          isUnlinked,
        }

        setMessages((prev) => [...prev.slice(-99), newMessage])
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onerror = () => {
      console.error('WebSocket error')
    }

    ws.onclose = () => {
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        window.location.reload()
      }, 3000)
    }

    return () => {
      ws.close()
    }
  }, [channelId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="h-screen w-full overflow-hidden bg-transparent">
      <div className="flex flex-col justify-end h-full px-2 py-2 space-y-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm break-words ${
              msg.isUnlinked ? 'opacity-25' : 'opacity-100'
            }`}
          >
            {msg.djClass && (
              <span className="inline-block px-1.5 py-0.5 bg-gray-800 text-white rounded text-xs font-medium mr-1">
                {msg.djClass}
              </span>
            )}
            <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              {msg.text}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
