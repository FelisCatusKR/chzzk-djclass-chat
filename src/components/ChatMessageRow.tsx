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
  createdAt?: number
  fading?: boolean
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
      className={`break-words transition-opacity duration-500 ${
        message.fading
          ? 'opacity-0'
          : message.isUnlinked
            ? 'opacity-75'
            : 'opacity-100'
      }`}
    >
      {message.rankShort ? (
        <DjClassBadge
          mode={badgeMode}
          djClass={message.djClass}
          rankShort={message.rankShort}
          rankLevel={message.rankLevel}
          powerInteger={message.powerInteger}
        />
      ) : message.isUnlinked ? (
        <span
          className="mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm"
          style={{ background: '#6b7280', color: '#fff', fontSize: '0.85em' }}
        >
          미인증
        </span>
      ) : null}

      <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {message.text}
      </span>
    </div>
  )
}
