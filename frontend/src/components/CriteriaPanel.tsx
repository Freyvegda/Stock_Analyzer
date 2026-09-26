import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ScreenConfig } from '../api/types'

const LABELS: Record<string, (v: number) => string> = {
  pe_max: (v) => `PE ≤ ${v}`,
  pb_max: (v) => `PB ≤ ${v}`,
  roe_min: (v) => `ROE ≥ ${v}%`,
  roce_min: (v) => `ROCE ≥ ${v}%`,
  debt_to_equity_max: (v) => `D/E ≤ ${v}`,
  market_cap_min: (v) => `Mkt Cap ≥ ₹${v}cr`,
}

export function CriteriaPanel({
  config,
  onReload,
}: {
  config: ScreenConfig
  onReload: () => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">Screening Criteria</h2>
        <Button variant="outline" size="sm" onClick={onReload}>
          Reload config
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(config.criteria).map(([key, value]) => (
          <Badge key={key} variant="secondary">
            {LABELS[key] ? LABELS[key](value) : `${key}: ${value}`}
          </Badge>
        ))}
        <Badge variant="outline">Top {config.shortlist_size}</Badge>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Edit <code>backend/config/screening.yaml</code>, then Reload config.
      </p>
    </div>
  )
}
