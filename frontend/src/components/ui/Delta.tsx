import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Signed change: colour + arrow + explicit sign, so P&L never depends on colour
 * alone. Gain/loss tones come from the vault tokens; the brand hue is never used here.
 */
export function Delta({
  value,
  decimals = 1,
  suffix = '',
  className,
}: {
  value: number
  decimals?: number
  suffix?: string
  className?: string
}) {
  const tone = value > 0 ? 'gain' : value < 0 ? 'loss' : 'neutral'
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''

  return (
    <span
      data-testid="delta"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 font-mono tabular-nums',
        tone === 'gain' && 'text-gain',
        tone === 'loss' && 'text-loss',
        tone === 'neutral' && 'text-muted-foreground',
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      {`${sign}${Math.abs(value).toFixed(decimals)}${suffix}`}
    </span>
  )
}
