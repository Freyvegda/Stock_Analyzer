import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Text } from '@chakra-ui/react'
import type { Candle } from '../api/types'
import { formatPrice, getLatestPrice } from '../lib/price'
import { Delta } from './ui/Delta'
import { Num } from './ui/Num'
import { cn } from '@/lib/utils'

/**
 * Latest traded price accordion (detail page).
 *
 * Last daily close is the price; previous close gives day change.
 * Fallback (stored screener price) renders instantly while candles load,
 * then swaps to the live close once the chart arrives — no "(stored)" tag,
 * just the last traded price with its as-of date.
 * Default open — price details are content, not chrome. Collapses for
 * users who only want the header number.
 */
export function PriceAccordion({
  candles,
  loading = false,
  error = null,
  onRetry,
  fallbackPrice = null,
  fallbackAsOf = null,
}: {
  candles: Candle[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  fallbackPrice?: number | null
  fallbackAsOf?: string | null
}) {
  const [open, setOpen] = useState(true)
  const baseId = useId()
  const panelId = `${baseId}-panel`
  const buttonId = `${baseId}-button`
  const latest = getLatestPrice(candles)
  const shownPrice = latest?.price ?? fallbackPrice
  const shownAsOf = latest?.asOf ?? fallbackAsOf

  return (
    <section
      data-testid="price-accordion"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h3 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="text-sm font-medium">Latest price</span>
          {loading && shownPrice === null ? (
            <Text fontSize="sm" color="fg.muted">Loading…</Text>
          ) : shownPrice !== null ? (
            <span className="ml-auto flex items-center gap-3">
              <Text fontSize="sm" fontWeight="semibold">
                <Num>{formatPrice(shownPrice)}</Num>
              </Text>
              {latest?.change !== null && latest?.change !== undefined ? <Delta value={latest.change} decimals={2} /> : null}
              {shownAsOf !== null ? (
                <Text fontSize="xs" color="fg.muted">
                  <Num>{shownAsOf}</Num>
                </Text>
              ) : null}
            </span>
          ) : null}
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className={cn('text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={buttonId} className={cn(!open && 'hidden')}>
        <div className="mt-3">
          {latest !== null ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Open', value: latest.open, money: true },
                { label: 'High', value: latest.high, money: true },
                { label: 'Low', value: latest.low, money: true },
                { label: 'Close', value: latest.price, money: true },
                { label: 'Volume', value: latest.volume, money: false },
                { label: 'Prev close', value: latest.prevClose, money: true },
              ].map((row) => (
                <div key={row.label} className="rounded-md border border-border bg-background/40 p-3">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 text-sm">
                    {row.value === null ? '—' : <Num>{row.money ? formatPrice(row.value) : row.value}</Num>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : shownPrice !== null ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <dt className="text-xs text-muted-foreground">Close</dt>
                <dd className="mt-1 text-sm">
                  <Num>{formatPrice(shownPrice)}</Num>
                </dd>
              </div>
              {shownAsOf !== null ? (
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <dt className="text-xs text-muted-foreground">As of</dt>
                  <dd className="mt-1 text-sm">
                    <Num>{shownAsOf}</Num>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : error !== null ? (
            <div className="py-4 text-center">
              <Text role="alert" fontSize="sm" color="fg.error">{error}</Text>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-sm underline-offset-4 hover:underline"
                >
                  Retry price
                </button>
              ) : null}
            </div>
          ) : (
            <Text fontSize="sm" color="fg.muted">No price data</Text>
          )}
          {latest === null && shownPrice !== null && error !== null && onRetry ? (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={onRetry}
                className="text-sm underline-offset-4 hover:underline"
              >
                Retry price
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
