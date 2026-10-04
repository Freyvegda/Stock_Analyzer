import { Text } from '@chakra-ui/react'
import { Check, Info, X } from 'lucide-react'
import { Num } from './ui/Num'
import { Tooltip } from './ui/tooltip'
import { getRatioInfo } from '../content/ratioInfo'
import type { StockFact } from '../api/types'

export interface TileCriterion {
  key: string
  passed: boolean
  threshold: number
  direction: 'min' | 'max'
  unit: string
}

function fmt(value: number): string {
  return value.toFixed(1)
}

/**
 * Interactive fundamental tile: glass hover, `i` explainer for newbies,
 * plus pass/fail vs the picked screen where it applies. Polarity is
 * always green/red + glyph, never sakura.
 */
export function RatioTile({ fact, criterion }: { fact: StockFact; criterion?: TileCriterion | null }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5">
        <Text fontSize="xs" color="fg.muted" className="min-w-0 flex-1 truncate">
          {fact.label}
        </Text>
        <Tooltip showArrow content={getRatioInfo(fact.key, fact.label)}>
          <button
            type="button"
            aria-label={`About ${fact.label}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Info size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <Text fontSize="sm" mt={1}>
        <Num>{fmt(fact.value)}</Num>{' '}
        <span className="text-xs text-muted-foreground">{fact.unit}</span>
      </Text>
      {criterion !== null && criterion !== undefined ? (
        <div
          className={
            criterion.passed
              ? 'mt-1.5 flex items-center gap-1 text-xs text-gain'
              : 'mt-1.5 flex items-center gap-1 text-xs text-loss'
          }
        >
          {criterion.passed ? (
            <Check size={12} strokeWidth={2} aria-hidden="true" />
          ) : (
            <X size={12} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="sr-only">{criterion.passed ? 'Passes' : 'Fails'}</span>
          <span>
            vs {criterion.direction === 'max' ? '≤' : '≥'} <Num>{fmt(criterion.threshold)}</Num>
            {criterion.unit}
          </span>
        </div>
      ) : null}
    </div>
  )
}
