/**
 * The one place the tower's shape is decided.
 *
 * Both the 3D scene and the DOM sections read this array, so the pagoda cannot
 * end up with a different number of storeys than the page has sections. Add a
 * fifth tier here and the tower grows a storey by itself.
 */
export interface TowerTier {
  id: string
  heading: string
  tagline: string
  /** Where the CTA goes once signed in. */
  route: string
  /**
   * Whether the destination is built. An unbuilt storey must not link to its own
   * route — that is the dead end. It shows a non-link and offers
   * `fallbackRoute` instead, which must resolve to a route some built storey
   * also uses.
   */
  status: 'built' | 'in-progress'
  /** Required on every `in-progress` storey, absent on every `built` one. */
  fallbackRoute?: string
  /** Set on tiers whose destination exists but is not built yet. */
  badge?: string
  cards: Card[]
}

export interface Card {
  title: string
  body: string
}

export const TOWER_TIERS: TowerTier[] = [
  {
    id: 'fundamentals',
    heading: 'Fundamental Analysis',
    tagline: 'Screen 500 companies on the ratios that actually matter.',
    route: '/fundamentals/criteria',
    status: 'built',
    cards: [
      {
        title: 'Your criteria, not ours',
        body: 'Turn ratios on and off and set your own thresholds. Saved screens let you keep a separate set per idea.',
      },
      {
        title: 'A verifiable verdict',
        body: 'Every stock shows the ratios it passed and the ones it failed, with the values beside them.',
      },
      {
        title: 'A ranked top ten',
        body: 'Results are ordered by how strongly a stock clears your bar, not by market cap.',
      },
    ],
  },
  {
    id: 'stocks',
    heading: 'The Universe',
    tagline: 'Search all 500 names, then open any stock in full.',
    route: '/fundamentals/stocks',
    status: 'built',
    cards: [
      {
        title: 'Search by symbol or name',
        body: 'Filter the whole Nifty 500 and sort by any ratio you already track.',
      },
      {
        title: 'Verdict on every row',
        body: 'Pass, near-miss or fail, decided by the same criteria that produced your shortlist.',
      },
      {
        title: 'The full company story',
        body: 'Business description, what the company owns, and how it has performed, in one place.',
      },
    ],
  },
  {
    id: 'models',
    heading: 'Models & Signals',
    tagline: 'Turn price history into an actual buy, sell or hold.',
    route: '/backtest',
    status: 'in-progress',
    fallbackRoute: '/fundamentals/criteria',
    badge: 'In progress',
    cards: [
      {
        title: 'Signals with confidence',
        body: 'A gradient-boosted model reads the price series and commits to a direction, with a stated confidence.',
      },
      {
        title: 'Walk-forward backtests',
        body: 'No peeking at the future: the model is retrained on the past and scored only on what came after.',
      },
      {
        title: 'The cost of being wrong',
        body: 'CAGR, Sharpe and maximum drawdown reported together, so a good average cannot hide a bad collapse.',
      },
    ],
  },
  {
    id: 'documents',
    heading: 'Documents',
    tagline: 'Read the annual report so you do not have to.',
    route: '/documents',
    status: 'in-progress',
    fallbackRoute: '/fundamentals/criteria',
    badge: 'In progress',
    cards: [
      {
        title: 'Drop in a filing',
        body: 'Annual reports and results are parsed on your own machine. Nothing leaves it.',
      },
      {
        title: 'The numbers, extracted',
        body: 'Revenue, margin, debt and segment detail pulled out of the document and lined up against the ratio screen.',
      },
      {
        title: 'A written verdict',
        body: 'A short read on what the numbers mean for the thesis behind the screen.',
      },
    ],
  },
]

/** Import shape kept loose so a future CMS payload can satisfy it too. */
export type TowerTierLike = Pick<TowerTier, 'id' | 'heading' | 'tagline' | 'route'>

export function tierIndex(id: string): number {
  return TOWER_TIERS.findIndex((t) => t.id === id)
}
