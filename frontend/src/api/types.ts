export interface ScreenConfig {
  criteria: Record<string, number>
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
