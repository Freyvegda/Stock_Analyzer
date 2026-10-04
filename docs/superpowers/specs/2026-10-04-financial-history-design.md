# Stock financial history — quarterly + annual P&L (design)

**Date:** 2026-10-04
**Status:** Approved in conversation (owner chose option A), pending implementation
**Branch:** `phase-1.8` (follows multi-screen runs + run-performance work)

## 1. Intent

Stock detail shows past operating history, not just current snapshot ratios:

- 8 quarters of past results + 5 years of annual results, per stock.
- Full P&L rows: sales, expenses, operating profit, other income, interest, depreciation, PBT, tax, PAT, EPS.
- New Financials section on `/stock/:symbol` below "What it's done" (`FundamentalsPanel`), with Quarterly | Annual toggle, dense table + sales/PAT bar chart.
- Source: screener.in quarterly + annual P&L tables, consolidated-first with standalone fallback (matches current ratio math). File-cache lazy, no DB schema change, no background-job change.

## 2. Owner decisions (2026-10-04)

| Question | Decision |
|---|---|
| Metric set | Full P&L (not sales+PAT only) |
| Placement | Detail section below done, Quarterly \| Annual toggle, table + chart |
| Freshness | File-cache lazy (reuse 30d statements cache); Refresh button + stale badge; zero job change |
| Basis | Consolidated-first, standalone fallback (same as `_download`) |

## 3. Backend

### 3.1 Parser: `parse_history(html) -> {quarterly, annual}`

New pure function in `backend/app/data/screener_statements.py`, beside `parse_statements`. Reuses `_LABEL_MAP`, `_to_float`, `_lakh_scale`.

- Quarterly series: tables whose headers mix Jun/Sep/Dec/Mar + year with overlapping years across months (inverse of current `quarterly_results` skip). Columns in header order, oldest-first. Period label `Q{1-4}FY{yy}` derived from month+year (Jun=Q1, Sep=Q2, Dec=Q3, Mar=Q4 of FY ending that Mar).
- Annual series: Mar/FY-dominant tables via existing `_annual_indexes` logic. Period label `FY{yy}`.
- Rows captured per period (Rs cr, `None` on missing): `sales` (revenue), `expenses` ("total expenses" row when present, else derived `sales − operating profit` when both present), `operating_profit` (ebitda incl. financing-profit synonym), `other_income`, `interest` (finance cost), `depreciation`, `pbt` (op + other − interest − depreciation when parts present), `tax` (pbt − pat when both present), `pat` (net_income), `eps` (new `_LABEL_MAP` synonyms: "eps", "eps in rs", "adjusted eps"; raw Rs, never lakh-scaled; new `_LABEL_MAP` synonym "total expenses" → expenses base field).
- Quarterly columns skip TTM/partial markers (`_PARTIAL_RE`/`_NON_ANNUAL_RE`: TTM, 9m, half-year) — same filter as annual path. Quarter mapping assumes Mar year-end (Jun=Q1 … Mar=Q4); Sep/Dec year-end tables keep month+year labels verbatim.
- Slice: last 8 quarterly columns, last 5 annual columns. Empty/missing tables yield `[]`, never raise.
- Existing `parse_statements` untouched (latest-annual + prev behavior preserved; history tests pin no regression).

### 3.2 Cache: extend `data/statements/{SYM}.json`

`fetch_statements` payload `fields` gains `history: {quarterly: [...], annual: [...]}`. Rules:

- Fresh cache (≤30d) without `history` triggers lazy backfill: one `_download` + `parse_history` + `parse_identity` merge, rewrite cache (same pattern as identity backfill). Never raises, never blocks ratios.
- Fresh parse merges stale history per-period on partial pages (fresh wins when present; stale fills gaps).
- `_has_minimum` gate unchanged; history never blocks ratios write.

### 3.3 Provider + service + API

- `CompositeProvider.financials(symbol) -> {quarterly, annual, as_of, stale}`: `fetch_statements` (serves cache when fresh), `as_of` from cache file, `stale = age > 30d`. Blocked (403/429) serves stale history at any age; first-ever fetch with no cache raises.
- Thin service `app/stock/service.get_financials(session_factory, provider, symbol)`: `_load_stock` (404 unknown), `_fetch_isolated` per-stock isolation, returns provider payload. No DB writes (history lives in file cache, not SQLite — keeps DB lean per Plan B rule).
- Router `GET /stock/{symbol}/financials -> {symbol, quarterly, annual, as_of, stale}` in `backend/app/api/stock.py`. 404 unknown symbol, 502 upstream fail. Auth via `current_user` like other stock routes.

## 4. Frontend

New `frontend/src/components/Financials.tsx`:

- Props `{symbol}`; fetches `GET /stock/{symbol}/financials` once per symbol; local state for `Quarterly | Annual` toggle (default Quarterly).
- Dense shadcn table: rows = P&L lines, columns = periods (oldest left, latest right), `Num` mono formatting, `—` on null, negative PAT red via `loss` token (never sakura for polarity).
- Recharts `BarChart`: sales bars + PAT bars per period; negative PAT renders below axis; tooltip in cr.
- States: skeleton while loading, error + Retry, `stale` badge (`as of {date}`), empty ("No history yet — hit Refresh") when both series empty.
- Mounted in `StockDetail.tsx` below `<FundamentalsPanel>`. Types in `api/types.ts`: `FinancialPeriod {period, sales, expenses, operating_profit, other_income, interest, depreciation, pbt, tax, pat, eps}`, `FinancialsResponse {symbol, quarterly, annual, as_of, stale}`.
- Follows `DESIGN.md` (semantic tokens, lucide-only icons, `BlurFade` section wrapper).

## 5. Data flow

```
screener.in company page (consolidated → standalone fallback)
 -> parse_history (8Q + 5Y P&L series) + parse_statements (latest ratios)
 -> data/statements/{SYM}.json (30d TTL, history merged w/ stale)
 -> GET /stock/{symbol}/financials (stored-first, per-stock isolation)
 -> Financials.tsx (toggle, table + bars, stale badge)
Refresh button re-downloads + rewrites cache; background job untouched.
```

## 6. Error handling

- Screener 403/429: serve stale history + `stale: true`; UI paints table with badge.
- 404 all variants (`SymbolNotFoundError`): stale cache when present, else 502; UI shows "history unavailable" while ratios still paint.
- Partial pages: missing cells → null; one bad row never kills series.
- Per-stock isolation: history fetch failure never breaks detail snapshot or candles.

## 7. Testing (offline, mocked network)

Backend (pytest):
- Quarterly mixed-month parse (8 cols, period labels, sales/PAT values, missing cell → None).
- Annual 5-col parse incl. bank synonyms (financing profit → op), EPS unscaled, lakh scaling.
- `quarterly_results` skip regression: existing annual tests still green.
- Cache: history backfill on fresh cache miss; stale-merge keeps old periods on partial page.
- API: `GET /financials` 200 shape, 404 unknown, 502 on provider raise.

Frontend (vitest):
- Toggle switches quarterly/annual columns; table renders nulls as —; negative PAT class.
- Loading skeleton, error + retry, stale badge, empty state. Mock all api/WebGL.

## 8. Out of scope

- No `financial_periods` DB table; no universe-wide history; no growth screening on history.
- No background-job refresh of history; no scheduler.
- No standalone/consolidated toggle (consolidated-first fixed).
- No `DataProvider` ABC break: `financials` lives on `CompositeProvider` concrete + service; ABC gains the method only when a second source needs it.
