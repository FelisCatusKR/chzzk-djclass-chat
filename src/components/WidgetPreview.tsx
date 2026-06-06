'use client'

import { useEffect, useRef, useState } from 'react'
import type { BadgeMode } from '@/lib/types'
import type { ChatMessage } from './ChatMessageRow'
import ChatMessageRow from './ChatMessageRow'
import { FAKE_CHAT_MESSAGES } from '@/lib/fake-chat-messages'

interface WidgetPreviewProps {
  badgeMode: BadgeMode
  fontSize: number
}

const MAX_VISIBLE_MESSAGES = 15

function getRandomInterval(): number {
  return Math.random() * 700 + 500 // 500–1200 ms
}

export default function WidgetPreview({
  badgeMode,
  fontSize,
}: WidgetPreviewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const indexRef = useRef(0)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const addNextMessage = () => {
      setMessages((prev) => {
        const nextMessage = FAKE_CHAT_MESSAGES[indexRef.current]
        indexRef.current = (indexRef.current + 1) % FAKE_CHAT_MESSAGES.length
        const next = [...prev, nextMessage]
        if (next.length > MAX_VISIBLE_MESSAGES) {
          next.shift()
        }
        return next
      })

      timeoutRef.current = setTimeout(addNextMessage, getRandomInterval())
    }

    timeoutRef.current = setTimeout(addNextMessage, 500)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div
      className="overflow-hidden rounded-lg bg-gray-900"
      style={{
        width: 400,
        height: 200,
        fontFamily:
          "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        className="flex h-full flex-col justify-end space-y-1 px-2 py-2"
        style={{ fontSize }}
      >
        {messages.map((msg) => (
          <ChatMessageRow key={msg.id} message={msg} badgeMode={badgeMode} />
        ))}
      </div>
    </div>
  )
}
