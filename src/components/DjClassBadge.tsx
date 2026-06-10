import type { CSSProperties } from 'react'
import type { BadgeMode } from '@/lib/types'
import {
  getBadgeText,
  getDjClassColor,
  parseRankName,
  isTheoryPower,
  GLINT_PERIOD_MS,
  glintDelayMs,
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

  // Phase-lock the glint to wall-clock time so it never restarts when chat
  // scrolls. Set at render (not in an effect) — safe because no shiny badge is
  // ever server-rendered (chat lists start empty and fill in on the client).
  const style: CSSProperties = {
    background: getDjClassColor(parseRankName(djClass)),
    color: '#000',
    textShadow: '0 0 1px rgba(255,255,255,0.5)',
    fontSize: '0.85em',
    ...(shiny
      ? ({
          '--glint-duration': `${GLINT_PERIOD_MS}ms`,
          '--glint-delay': `${glintDelayMs(Date.now())}ms`,
        } as CSSProperties)
      : {}),
  }

  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-0.5 font-bold shadow-sm ${
        shiny ? styles.shiny : ''
      }`}
      style={style}
    >
      {badgeText}
    </span>
  )
}
