import type { BadgeMode } from '@/lib/types'
import DjClassBadge from './DjClassBadge'
import { RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface BadgeModePreviewRowProps {
  mode: BadgeMode
  label: string
}

const EXAMPLE_DJ_CLASS = '4B SHOWSTOPPER II'
const EXAMPLE_RANK_SHORT = 'SS'
const EXAMPLE_RANK_LEVEL = 'II'
const EXAMPLE_POWER_INTEGER = 9823

export default function BadgeModePreviewRow({
  mode,
  label,
}: BadgeModePreviewRowProps) {
  return (
    <Label
      htmlFor={`badge-mode-${mode}`}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
        'border-border bg-card hover:bg-accent/50'
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex items-center gap-1.5 text-sm">
          <DjClassBadge
            mode={mode}
            djClass={EXAMPLE_DJ_CLASS}
            rankShort={EXAMPLE_RANK_SHORT}
            rankLevel={EXAMPLE_RANK_LEVEL}
            powerInteger={EXAMPLE_POWER_INTEGER}
          />
          <span className="text-muted-foreground">안녕하세요</span>
        </div>
      </div>
      <RadioGroupItem
        value={mode}
        id={`badge-mode-${mode}`}
        className="shrink-0"
      />
    </Label>
  )
}
