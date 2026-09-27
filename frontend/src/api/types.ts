export interface AuthUser {
  id: number
  username: string
}

export interface AuthState {
  users_exist: boolean
  user: AuthUser | null
}

export type RatioDirection = 'min' | 'max'

export interface RatioSpec {
  key: string
  label: string
  unit: string
  category: string
  direction: RatioDirection
}

export interface Criterion {
  key: string
  enabled: boolean
  value: number
}

export interface UserCriteria {
  criteria: Criterion[]
  thesis: string | null
  shortlist_size: number
}

export interface ShortlistRow {
  symbol: string
  rank: number
  score: number
  ratios: {
    pe: number | null
    pb: number | null
    roe: number | null
    roce: number | null
    debt_to_equity: number | null
  }
  name?: string
  sector?: string
  market_cap?: number | null
  data_date?: string | null
}

export interface FailedDetail {
  symbol: string
  failed: string[]
}

export interface ScreenRunResult {
  run_id: number
  shortlisted: ShortlistRow[]
  failed_count: number
  failed_symbols?: string[]
  failed_details?: FailedDetail[]
  stale?: boolean
  total: number
}

export interface LatestScreen {
  run_id: number
  run_date: string
  shortlisted: ShortlistRow[]
}

export type ChartRange = '6m' | '1y' | '2y' | '5y'
export type ChartInterval = '1d' | '15d' | '1mo'

export interface StockSnapshot {
  date: string
  pe: number | null
  pb: number | null
  roe: number | null
  roce: number | null
  debt_to_equity: number | null
  data_status: string
}

export interface ReportCriterion {
  key: string
  label: string
  unit: string
  direction: RatioDirection
  threshold: number
  value: number | null
  passed: boolean
  delta: number | null
}

export interface Metric {
  key: string
  label: string
  unit: string
  value: number
}

export interface MetricGroup {
  category: string
  metrics: Metric[]
}

export interface StockReport {
  verdict: 'pass' | 'fail'
  score: number
  passed: number
  enabled: number
  criteria: ReportCriterion[]
  notes: string[]
  groups: MetricGroup[]
}

export interface RunContext {
  run_id: number
  run_date: string
  rank: number | null
  score: number | null
}

export interface StockDetail {
  symbol: string
  name: string
  sector: string | null
  market_cap: number | null
  snapshot: StockSnapshot
  report: StockReport
  data_date: string
  stale: boolean
  run: RunContext | null
  refreshed: boolean | null
  warning: string | null
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartMarker {
  time: string
  kind: 'buy' | 'sell'
}

export interface OhlcResponse {
  symbol: string
  range: ChartRange
  interval: ChartInterval
  as_of: string
  candles: Candle[]
}
