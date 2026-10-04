import { useMemo, useState } from 'react'
import { Text } from '@chakra-ui/react'
import { BlurFade } from './ui/BlurFade'
import { Num } from './ui/Num'
import { RatioTile, type TileCriterion } from './RatioTile'
import type { MetricGroup, StockFact } from '../api/types'
import { cn } from '@/lib/utils'

const KEY_TO_SECTION: Record<string, string> = {
  pe: 'valuation',
  pb: 'valuation',
  priceToSalesTrailing12Months: 'valuation',
  enterpriseToEbitda: 'valuation',
  enterpriseToRevenue: 'valuation',
  priceToFreeCashflow: 'valuation',
  roe: 'profitability',
  roce: 'profitability',
  returnOnAssets: 'profitability',
  profitMargins: 'profitability',
  operatingMargins: 'profitability',
  grossMargins: 'profitability',
  ebitdaMargins: 'profitability',
  revenueGrowth: 'growth',
  earningsGrowth: 'growth',
  market_cap: 'scale',
  totalRevenue: 'scale',
  ebitda: 'scale',
  netIncomeToCommon: 'scale',
  operatingCashflow: 'scale',
  freeCashflow: 'scale',
  totalCash: 'scale',
  totalDebt: 'scale',
  debt_to_equity: 'leverage',
  currentRatio: 'liquidity',
  quickRatio: 'liquidity',
  dividendYield: 'dividend',
  payoutRatio: 'dividend',
  trailingEps: 'perShare',
  bookValue: 'perShare',
  revenuePerShare: 'perShare',
  heldPercentInstitutions: 'ownership',
  heldPercentInsiders: 'ownership',
  earningsYield: 'valuation',
  fcfYield: 'valuation',
  operatingCashflowMargin: 'profitability',
  assetTurnover: 'efficiency',
  inventoryDays: 'efficiency',
  debtorDays: 'efficiency',
  cashRatio: 'liquidity',
  interestCoverage: 'leverage',
  pledgedPct: 'ownership',
}

const SECTION_ORDER = [
  { id: 'valuation', label: 'Valuation' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'growth', label: 'Growth' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'scale', label: 'Financial Scale' },
  { id: 'leverage', label: 'Leverage' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'dividend', label: 'Dividends' },
  { id: 'perShare', label: 'Per Share' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'other', label: 'Other' },
] as const

export interface FundamentalsPanelProps {
  mainRatios: StockFact[]
  has: StockFact[]
  done: StockFact[]
  otherGroups: MetricGroup[]
  criteria?: TileCriterion[] | null
}

function collectFacts(
  mainRatios: StockFact[],
  has: StockFact[],
  done: StockFact[],
  otherGroups: MetricGroup[],
): StockFact[] {
  const seen = new Set<string>()
  const out: StockFact[] = []
  const push = (fact: StockFact) => {
    if (seen.has(fact.key)) return
    seen.add(fact.key)
    out.push(fact)
  }
  mainRatios.forEach(push)
  has.forEach(push)
  done.forEach(push)
  otherGroups.forEach((group) =>
    group.metrics.forEach((metric) =>
      push({ key: metric.key, label: metric.label, unit: metric.unit, value: metric.value }),
    ),
  )
  return out
}

/**
 * Big fundamentals explorer replacing the flat ratio stack. One section
 * visible at a time via a professional side nav (technical names, counts);
 * vertical on desktop, scroll pills on mobile. Theme: flat muted rail +
 * sakura active pill, semantic tokens only.
 */
export function FundamentalsPanel({
  mainRatios,
  has,
  done,
  otherGroups,
  criteria = null,
}: FundamentalsPanelProps) {
  const sections = useMemo(() => {
    const buckets = new Map<string, StockFact[]>()
    for (const fact of collectFacts(mainRatios, has, done, otherGroups)) {
      const id = KEY_TO_SECTION[fact.key] ?? 'other'
      const list = buckets.get(id) ?? []
      list.push(fact)
      buckets.set(id, list)
    }
    return SECTION_ORDER.filter((section) => (buckets.get(section.id) ?? []).length > 0).map(
      (section) => ({ ...section, facts: buckets.get(section.id) ?? [] }),
    )
  }, [mainRatios, has, done, otherGroups])

  const [selected, setSelected] = useState<string | null>(null)
  const active = sections.find((section) => section.id === selected) ?? sections[0] ?? null

  const criteriaByKey = useMemo(() => {
    const map = new Map<string, TileCriterion>()
    ;(criteria ?? []).forEach((criterion) => map.set(criterion.key, criterion))
    return map
  }, [criteria])

  if (active === null) return null

  function onNavKeyDown(event: React.KeyboardEvent) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = sections.findIndex((section) => section.id === active.id)
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const next = sections[(index + delta + sections.length) % sections.length]
    setSelected(next.id)
    document.getElementById(`fundamentals-tab-${next.id}`)?.focus()
  }

  return (
    <BlurFade>
      <section
        data-testid="fundamentals-panel"
        aria-label="Fundamentals"
        className="rounded-lg border border-border bg-card p-4"
      >
        <Text fontSize="sm" fontWeight="medium">
          Fundamentals
        </Text>
        <div className="mt-3 grid gap-4 lg:grid-cols-[220px_1fr]">
          <div
            role="tablist"
            aria-label="Fundamentals sections"
            onKeyDown={onNavKeyDown}
            className="fundamentals-rail flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible"
          >
            {sections.map((section) => {
              const isActive = section.id === active.id
              return (
                <button
                  key={section.id}
                  id={`fundamentals-tab-${section.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="fundamentals-tabpanel"
                  onClick={() => setSelected(section.id)}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm',
                    isActive
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {isActive ? (
                    <span aria-hidden="true" data-testid="fundamentals-nav-pill" className="glass-nav-pill" />
                  ) : null}
                  <span className="relative flex w-full items-center gap-2">
                    {section.label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      <Num>{section.facts.length}</Num>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <div
            id="fundamentals-tabpanel"
            role="tabpanel"
            aria-label={`${active.label} ratios`}
            key={active.id}
          >
            <Text fontSize="xs" color="fg.muted" className="uppercase tracking-[0.08em]">
              {active.label}
            </Text>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {active.facts.map((fact) => (
                <RatioTile key={fact.key} fact={fact} criterion={criteriaByKey.get(fact.key)} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </BlurFade>
  )
}
