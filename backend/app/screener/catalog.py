"""Ratio catalog: the source of truth for valid screener criteria keys.

Every criterion a user can enable must exist here. ``derived`` entries read the
six normalized columns on the ``fundamentals`` row; ``raw`` entries read the
stored ``raw_json`` payload (screener scrape + ratios_math, fraction -> % via
``scale``).

Only ratios the math engine can produce are listed: forward-looking or
yfinance-only fields (forward P/E, PEG, quarterly growth, beta, forward EPS,
5y yield) are never stored on the offline path and so are not selectable.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class RatioSpec:
    key: str  # stable id stored in criteria JSON
    label: str  # human label, e.g. "Forward P/E"
    source: Literal["derived", "raw"]
    direction: Literal["min", "max"]  # min: value >= threshold, max: value <= threshold
    unit: str  # "%", "×", "₹ cr", "₹"
    category: str  # "Valuation", "Profitability", ...
    scale: float = 1.0  # applied to raw values (fraction -> percent etc.)
    yf_field: str | None = None  # raw .info key when source == "raw"


RATIO_CATALOG: list[RatioSpec] = [
    # --- derived: the six normalized columns (never read from raw) ---
    RatioSpec("pe", "P/E", "derived", "max", "×", "Valuation"),
    RatioSpec("pb", "P/B", "derived", "max", "×", "Valuation"),
    RatioSpec("roe", "ROE", "derived", "min", "%", "Profitability"),
    RatioSpec("roce", "ROCE", "derived", "min", "%", "Profitability"),
    RatioSpec("debt_to_equity", "Debt/Equity", "derived", "max", "×", "Leverage"),
    RatioSpec("market_cap", "Market Cap", "derived", "min", "₹ cr", "Size"),
    # --- raw: screener scrape + ratios_math fields, fraction-shaped -> ×100 ---
    RatioSpec(
        "priceToSalesTrailing12Months", "P/S", "raw", "max", "×", "Valuation",
        1.0, "priceToSalesTrailing12Months",
    ),
    RatioSpec("enterpriseToEbitda", "EV/EBITDA", "raw", "max", "×", "Valuation", 1.0, "enterpriseToEbitda"),
    RatioSpec("enterpriseToRevenue", "EV/Revenue", "raw", "max", "×", "Valuation", 1.0, "enterpriseToRevenue"),
    RatioSpec("priceToFreeCashflow", "P/FCF", "raw", "max", "×", "Valuation", 1.0, "priceToFreeCashflow"),
    RatioSpec("returnOnAssets", "ROA", "raw", "min", "%", "Profitability", 100.0, "returnOnAssets"),
    RatioSpec("profitMargins", "Net Margin", "raw", "min", "%", "Profitability", 100.0, "profitMargins"),
    RatioSpec("operatingMargins", "Operating Margin", "raw", "min", "%", "Profitability", 100.0, "operatingMargins"),
    RatioSpec("grossMargins", "Gross Margin", "raw", "min", "%", "Profitability", 100.0, "grossMargins"),
    RatioSpec("ebitdaMargins", "EBITDA Margin", "raw", "min", "%", "Profitability", 100.0, "ebitdaMargins"),
    RatioSpec("revenueGrowth", "Revenue Growth", "raw", "min", "%", "Growth", 100.0, "revenueGrowth"),
    RatioSpec("earningsGrowth", "Earnings Growth", "raw", "min", "%", "Growth", 100.0, "earningsGrowth"),
    RatioSpec("currentRatio", "Current Ratio", "raw", "min", "×", "Liquidity", 1.0, "currentRatio"),
    RatioSpec("quickRatio", "Quick Ratio", "raw", "min", "×", "Liquidity", 1.0, "quickRatio"),
    RatioSpec("trailingEps", "Trailing EPS", "raw", "min", "₹", "Per Share", 1.0, "trailingEps"),
    RatioSpec("bookValue", "Book Value", "raw", "min", "₹", "Per Share", 1.0, "bookValue"),
    RatioSpec("revenuePerShare", "Revenue / Share", "raw", "min", "₹", "Per Share", 1.0, "revenuePerShare"),
    RatioSpec("dividendYield", "Dividend Yield", "raw", "min", "%", "Dividend", 1.0, "dividendYield"),
    RatioSpec("payoutRatio", "Payout Ratio", "raw", "max", "%", "Dividend", 100.0, "payoutRatio"),
    RatioSpec(
        "heldPercentInstitutions", "Institutional Holding", "raw", "min", "%", "Ownership",
        100.0, "heldPercentInstitutions",
    ),
    RatioSpec("heldPercentInsiders", "Insider Holding", "raw", "min", "%", "Ownership", 100.0, "heldPercentInsiders"),
    RatioSpec("earningsYield", "Earnings Yield", "raw", "min", "%", "Valuation", 100.0, "earningsYield"),
    RatioSpec("fcfYield", "FCF Yield", "raw", "min", "%", "Valuation", 100.0, "fcfYield"),
    RatioSpec(
        "operatingCashflowMargin", "OCF Margin", "raw", "min", "%", "Profitability",
        100.0, "operatingCashflowMargin",
    ),
    RatioSpec("assetTurnover", "Asset Turnover", "raw", "min", "×", "Efficiency", 1.0, "assetTurnover"),
    RatioSpec("inventoryDays", "Inventory Days", "raw", "max", "days", "Efficiency", 1.0, "inventoryDays"),
    RatioSpec("debtorDays", "Debtor Days", "raw", "max", "days", "Efficiency", 1.0, "debtorDays"),
    RatioSpec("cashRatio", "Cash Ratio", "raw", "min", "×", "Liquidity", 1.0, "cashRatio"),
    RatioSpec("interestCoverage", "Interest Coverage", "raw", "min", "×", "Leverage", 1.0, "interestCoverage"),
    RatioSpec("pledgedPct", "Pledged Holding", "raw", "max", "%", "Ownership", 100.0, "pledgedPct"),
]

CATALOG_BY_KEY: dict[str, RatioSpec] = {spec.key: spec for spec in RATIO_CATALOG}
