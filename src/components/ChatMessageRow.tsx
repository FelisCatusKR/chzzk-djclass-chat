import type { BadgeMode } from '@/lib/types'
import DjClassBadge from './DjClassBadge'

export interface ChatMessage {
  id: string
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
  text: string
  isUnlinked: boolean
}

interface ChatMessageRowProps {
  message: ChatMessage
  badgeMode: BadgeMode
}

export default function ChatMessageRow({
  message,
  badgeMode,
}: ChatMessageRowProps) {
  return (
    <div
      className={`break-words ${
        message.isUnlinked ? 'opacity-75' : 'opacity-100'
      }`}
    >
      {message.rankShort && (
        <DjClassBadge
          mode={badgeMode}
          djClass={message.djClass}
          rankShort={message.rankShort}
          rankLevel={message.rankLevel}
          powerInteger={message.powerInteger}
        />
      )}

      <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {message.text}
      </span>
    </div>
  )
}
