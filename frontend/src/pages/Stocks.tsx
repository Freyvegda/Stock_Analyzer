/**
 * Stocks — browse/search the whole stored Nifty 500 universe.
 *
 * One `GET /stocks` fetch per picked screen; search, sector and verdict
 * filters run client-side over ~500 rows. Each row links to the stock
 * detail page and carries that screen's verdict (computed server-side from
 * shared data — a pure read that never writes). The screen picker is the
 * same glass `ScreenPicker` the Top 10 page uses.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { ApiError, api } from '../api/client'
import type { ScreeningSet, StockListResponse } from '../api/types'
import { ScreenPicker } from '../components/ScreenPicker'
import { StocksTable } from '../components/StocksTable'
import { BlurFade } from '../components/ui/BlurFade'
import { Num } from '../components/ui/Num'

type VerdictFilter = 'all' | 'pass' | 'fail' | 'no_data'

const VERDICT_FILTERS: { key: VerdictFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pass', label: 'Pass' },
  { key: 'fail', label: 'Fail' },
  { key: 'no_data', label: 'No data' },
]

export default function Stocks() {
  const [sets, setSets] = useState<ScreeningSet[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [data, setData] = useState<StockListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('all')
  const [verdict, setVerdict] = useState<VerdictFilter>('all')

  const selected = sets.find((set) => set.id === selectedId) ?? null

  async function loadUniverse(setId: number | null) {
    setLoading(true)
    setError(null)
    try {
      const path = setId === null ? '/stocks' : `/stocks?set_id=${setId}`
      setData(await api.get<StockListResponse>(path))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // global redirect
      setError(e instanceof Error ? e.message : 'Failed to load the stock list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // Initial paint uses plain `/stocks` (active-screen verdicts, one fetch);
    // explicit picks grade the same snapshot via `?set_id=`.
    void loadUniverse(null)
    api
      .get<ScreeningSet[]>('/screen/sets')
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return
        setSets(list)
        const active = list.find((set) => set.is_active) ?? list[0] ?? null
        setSelectedId(active?.id ?? null)
      })
      .catch(() => {
        // Picker is a bonus: the universe above already painted.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pick(id: number) {
    setSelectedId(id)
    void loadUniverse(id)
  }

  async function retry() {
    await loadUniverse(selectedId)
  }

  const sectors = useMemo(
    () =>
      [
        ...new Set(
          (data?.rows ?? [])
            .map((row) => row.sector)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    [data],
  )

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.rows ?? []).filter(
      (row) =>
        (needle === '' ||
          row.symbol.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle)) &&
        (sector === 'all' || row.sector === sector) &&
        (verdict === 'all' || row.verdict === verdict),
    )
  }, [data, query, sector, verdict])

  return (
    <div className="space-y-4">
      <Flex align="baseline" justify="space-between" gap={3} wrap="wrap">
        <Text as="h1" fontSize="xl" fontWeight="semibold">
          Nifty 500
        </Text>
        {data?.as_of != null ? (
          <Text data-testid="as-of" fontSize="sm" color="fg.muted">
            Data as of <Num>{data.as_of}</Num>
          </Text>
        ) : null}
      </Flex>

      {selected !== null ? (
        <Text fontSize="sm" color="fg.muted">
          Showing verdicts for {selected.name}
        </Text>
      ) : null}

      <BlurFade key={selectedId ?? 'default'}>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          {sets.length > 0 ? (
            <ScreenPicker
              options={sets.map((set) => ({
                id: set.id,
                name: set.name,
                isActive: set.is_active,
                verdict: null,
              }))}
              selectedId={selectedId}
              onSelect={pick}
              hideVerdict
            />
          ) : null}
          <Flex gap={3} wrap="wrap" align="center">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search symbol or company"
              aria-label="Search symbol or company"
              className="h-9 w-full max-w-xs rounded-md border border-border bg-background/40 px-3 text-sm outline-none transition-colors focus-visible:border-ring"
            />
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              aria-label="Sector"
              className="h-9 rounded-md border border-border bg-background/40 px-2 text-sm outline-none transition-colors focus-visible:border-ring"
            >
              <option value="all">All sectors</option>
              {sectors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Flex gap={1} role="group" aria-label="Screen verdict">
              {VERDICT_FILTERS.map((option) => (
                <Button
                  key={option.key}
                  size="xs"
                  variant={verdict === option.key ? 'solid' : 'ghost'}
                  colorPalette="sakura"
                  aria-pressed={verdict === option.key}
                  onClick={() => setVerdict(option.key)}
                >
                  {option.label}
                </Button>
              ))}
            </Flex>
          </Flex>

          {error !== null && !loading ? (
            <div className="py-2">
              <Text role="alert" fontSize="sm" color="fg.error">
                {error}
              </Text>
              <Button mt={3} size="sm" colorPalette="sakura" variant="outline" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : rows.length > 0 || loading ? (
            <StocksTable rows={rows} loading={loading} />
          ) : (
            <div className="rounded-md border border-border bg-background/40 p-10 text-center">
              <Text color="fg.muted">No stocks match</Text>
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  )
}
