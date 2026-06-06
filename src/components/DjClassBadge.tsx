import type { BadgeMode } from '@/lib/types'
import {
  getBadgeText,
  getDjClassColor,
  parseRankName,
  isTheoryPower,
} from '@/lib/dj-class'
import styles from './dj-class-badge.module.css'

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

  const shiny = isTheoryPower(powerInteger)

  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm ${
        shiny ? styles.shiny : ''
      }`}
      style={{
        background: getDjClassColor(parseRankName(djClass)),
        color: '#000',
        textShadow: '0 0 1px rgba(255,255,255,0.5)',
        fontSize: '0.85em',
      }}
    >
      {badgeText}
    </span>
  )
}
