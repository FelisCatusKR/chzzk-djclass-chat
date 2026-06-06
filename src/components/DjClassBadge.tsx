import type { BadgeMode } from '@/lib/types'
import { getBadgeText, getDjClassColor, parseRankName } from '@/lib/dj-class'

interface DjClassBadgeProps {
  mode: BadgeMode
  djClass: string | null
  rankShort: string | null
  rankLevel: string | null
  powerInteger: number | null
}

export default function DjClassBadge({
  mode,
  djClass,
  rankShort,
  rankLevel,
  powerInteger,
}: DjClassBadgeProps) {
  if (!rankShort) return null

  const badgeText = getBadgeText(
    mode,
    djClass,
    rankShort,
    rankLevel,
    powerInteger
  )

  return (
    <span
      className="mr-1 inline-block rounded px-1 py-0.5 text-xs font-bold shadow-sm"
      style={{
        background: getDjClassColor(parseRankName(djClass)),
        color: '#000',
        textShadow: '0 0 1px rgba(255,255,255,0.5)',
      }}
    >
      {badgeText}
    </span>
  )
}
