import { SHORT_NAMES, getThreshold } from '@/lib/dj-class'

interface LinkClassBadgeProps {
  djClass: string | null
  powerInteger: number | null
}

// Compact DJ CLASS badge used on the /link page (gray rank chip + threshold +
// power). `djClass` is the formatted "<button>B <RANK> <LEVEL?>" string.
export default function LinkClassBadge({
  djClass,
  powerInteger,
}: LinkClassBadgeProps) {
  if (!djClass) return null

  const rankMatch = djClass.match(
    /^\d+B\s+(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
  )
  const rankName = rankMatch ? rankMatch[1] : djClass.replace(/^\d+B\s+/, '')
  const rankLevel = rankMatch ? rankMatch[2] : null
  const shortName = SHORT_NAMES[rankName] || rankName
  const threshold = getThreshold(rankName, rankLevel)

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center rounded bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-800">
        {shortName}
        {rankLevel ? ` ${rankLevel}` : ''}
      </span>
      {threshold != null && (
        <span className="inline-flex items-center rounded bg-gray-700 px-1.5 py-0.5 text-xs font-bold text-white">
          {threshold}+
        </span>
      )}
      {powerInteger != null && (
        <span className="inline-flex items-center rounded bg-black px-1.5 py-0.5 text-xs font-bold text-white">
          {powerInteger}
        </span>
      )}
    </span>
  )
}
