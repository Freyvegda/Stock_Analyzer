/**
 * Newbie-friendly one-liners for every fundamental ratio on the stock
 * detail page. Shown in the `i` tooltip on each tile: what the ratio
 * is + what a high/low value signifies. Frontend-only, offline.
 */

export const RATIO_INFO: Record<string, string> = {
  pe: 'Price / earnings. What you pay for each rupee of profit. Lower usually means cheaper vs earnings; very high can mean rich expectations.',
  pb: 'Price / book value. What you pay vs net assets. Lower suggests cheaper vs assets; high implies the market prizes earnings power over book.',
  roe: 'Return on equity. Profit per rupee of shareholder equity. Higher means stronger compounding; persistently low hints at weak moat.',
  roce: 'Return on capital employed. Profit vs all capital used. Higher means efficient capital use; low means growth eats a lot of capital.',
  debt_to_equity: 'Debt / equity. Leverage load. Lower means safer balance sheet; high means profits swing harder in downturns.',
  market_cap: 'Total company value (price x shares, in Rs cr). Bigger usually means steadier and widely tracked; smaller can move faster both ways.',
  priceToSalesTrailing12Months:
    'Price / sales. What you pay per rupee of revenue. Lower means cheaper vs sales; useful when earnings are lumpy.',
  enterpriseToEbitda:
    'Enterprise value / EBITDA. Takeover-style price vs operating cash profit. Lower means cheaper; high needs fast growth to justify.',
  enterpriseToRevenue:
    'Enterprise value / revenue. Takeover-style price vs sales. Lower means cheaper vs sales; compare within the same sector.',
  priceToFreeCashflow:
    'Price / free cash flow. What you pay per rupee of real cash left after capex. Lower means cheaper vs cash generation.',
  returnOnAssets:
    'Return on assets. Profit per rupee of assets. Higher means the asset base works harder; low can mean bloated assets.',
  profitMargins:
    'Net margin. Share of revenue kept as net profit. Higher means pricing power or cost control; falling margin warns of pressure.',
  operatingMargins:
    'Operating margin. Share of revenue kept from core operations. Higher means an efficient core; compare trend over years.',
  grossMargins:
    'Gross margin. Share of revenue left after direct costs. Higher means pricing power; low means commodity-like business.',
  ebitdaMargins:
    'EBITDA margin. Share of revenue before interest, tax and depreciation. Higher means strong operating cashCow; watch for stability.',
  revenueGrowth:
    'Year-on-year revenue growth. Higher means demand is expanding; negative means the top line is shrinking.',
  earningsGrowth:
    'Year-on-year earnings growth. Higher means profits compounding; volatile swings warn that growth is uneven.',
  currentRatio:
    'Current assets / current liabilities. Short-term safety. Above 1 means bills are covered; well below 1 flags liquidity stress.',
  quickRatio:
    'Quick assets / current liabilities (excludes inventory). Stricter safety check. Higher means bills are covered even without selling stock.',
  trailingEps:
    'Earnings per share (last 12 months, in Rs). Profit owned per share. Rising EPS over years signals compounding; falling warns.',
  bookValue:
    'Book value per share (in Rs). Net assets per share. Growing book value means retained wealth; price far above book needs earnings to justify.',
  revenuePerShare:
    'Revenue per share (in Rs). Sales owned per share. Rising trend means the business is scaling per holder.',
  dividendYield:
    'Annual dividend / price. Cash back per rupee invested. Higher pays you to wait; very high can flag a falling price or cut risk.',
  payoutRatio:
    'Dividends / earnings. Share of profit paid out. High means generous now but less reinvested; very high can threaten the payout.',
  heldPercentInstitutions:
    'Institutional holding. Share owned by mutual funds and big investors. Higher means professional scrutiny; sharp exits can move price.',
  heldPercentInsiders:
    'Insider holding. Share owned by promoters and management. Higher usually aligns owners with you; steep declines warn.',
  totalRevenue: 'Total sales (in Rs cr). The top line. Rising over years means demand growth; flat or falling warns.',
  ebitda: 'Operating cash profit before interest, tax and depreciation (in Rs cr). Higher with stable margin means a healthy core.',
  netIncomeToCommon:
    'Net profit for shareholders (in Rs cr). The bottom line. Rising steadily signals compounding; erratic warns.',
  operatingCashflow:
    'Cash from operations (in Rs cr). Real cash the business throws off. Should broadly track profits; persistent gap warns.',
  freeCashflow:
    'Cash left after capex (in Rs cr). What owners could pocket. Positive and growing funds dividends and buybacks.',
  totalCash: 'Cash on hand (in Rs cr). Buffer for downturns and growth. High cash cushions shocks; too much idle can drag returns.',
  totalDebt: 'Total borrowings (in Rs cr). Lower vs cash and profits means safety; high debt amplifies both gains and stress.',
  beta: 'Price swing vs the market. 1 moves with the market; above 1 swings harder, below 1 stays calmer.',
  earningsYield:
    'Earnings / price. Profit yield on your rupee. Higher means cheaper vs earnings; negative means losses.',
  fcfYield:
    'Free cash flow / market cap. Real cash yield after capex. Higher means cheaper vs cash; negative means cash burn.',
  operatingCashflowMargin:
    'Cash from operations / revenue. Cash kept per rupee sold. Higher means profits turn into cash; gap vs net margin warns.',
  assetTurnover:
    'Revenue / assets. Sales squeezed per rupee of assets. Higher means lean asset use; low means asset-heavy model.',
  inventoryDays:
    'Days stock sits before sale. Lower means fast-moving goods; rising trend warns of pile-up.',
  debtorDays:
    'Days customers take to pay. Lower means quick collection; rising trend warns of weak receivables.',
  cashRatio:
    'Cash / current liabilities. Strictest safety check. Above 1 means bills covered from cash alone.',
  interestCoverage:
    'EBIT / interest. Times profits cover interest. Higher means safe debt load; below 2 flags stress.',
  pledgedPct:
    'Pledged promoter shares. Share of owner holding pawned for loans. Higher means forced-sale risk in falls.',
}

/** Fallback for any metric key without a curated line (e.g. future catalog keys). */
export function getRatioInfo(key: string, label: string): string {
  return RATIO_INFO[key] ?? `${label}. Compare across years and peers — trend and context matter more than one value.`
}
