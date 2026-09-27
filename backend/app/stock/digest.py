"""Stock detail digest: main ratios, balance ("has"), performance ("done") and the
remaining catalog groups. Pure functions — no DB, no network.

Facts resolve through ``engine.resolve_value`` exactly like screener criteria
(duck-typed: it reads ``source``, ``key``, ``yf_field`` and ``scale``), so derived
columns and raw yfinance fields follow one set of rules everywhere.
"""

from dataclasses import dataclass
from typing import Literal

from app.screener.catalog import CATALOG_BY_KEY
from app.screener.engine import resolve_value
from app.stock import report as report_builder


@dataclass(frozen=True)
class FactSpec:
    key: str
    label: str
    unit: str
    source: Literal["derived", "raw"]
    yf_field: str | None = None
    scale: float = 1.0


MAIN_FACTS: list[FactSpec] = [
    FactSpec("pe", "P/E", "×", "derived"),
    FactSpec("pb", "P/B", "×", "derived"),
    FactSpec("roe", "ROE", "%", "derived"),
    FactSpec("roce", "ROCE", "%", "derived"),
    FactSpec("debt_to_equity", "Debt/Equity", "×", "derived"),
    FactSpec("dividendYield", "Dividend Yield", "%", "raw", "dividendYield"),
]

#: Balance-sheet facts — "what the company has". Currency values scale to ₹ cr.
BALANCE_FACTS: list[FactSpec] = [
    FactSpec("market_cap", "Market Cap", "₹ cr", "derived"),
    FactSpec("totalRevenue", "Revenue", "₹ cr", "raw", "totalRevenue", 1e-7),
    FactSpec("ebitda", "EBITDA", "₹ cr", "raw", "ebitda", 1e-7),
    FactSpec("netIncomeToCommon", "Net Income", "₹ cr", "raw", "netIncomeToCommon", 1e-7),
    FactSpec("operatingCashflow", "Operating Cash Flow", "₹ cr", "raw", "operatingCashflow", 1e-7),
    FactSpec("freeCashflow", "Free Cash Flow", "₹ cr", "raw", "freeCashflow", 1e-7),
    FactSpec("totalCash", "Total Cash", "₹ cr", "raw", "totalCash", 1e-7),
    FactSpec("totalDebt", "Total Debt", "₹ cr", "raw", "totalDebt", 1e-7),
    FactSpec("bookValue", "Book Value", "₹", "raw", "bookValue"),
    FactSpec("currentRatio", "Current Ratio", "×", "raw", "currentRatio"),
    FactSpec("quickRatio", "Quick Ratio", "×", "raw", "quickRatio"),
]

#: Performance facts — "what the company has done". Fractions scale to %.
PERFORMANCE_FACTS: list[FactSpec] = [
    FactSpec("revenueGrowth", "Revenue Growth", "%", "raw", "revenueGrowth", 100.0),
    FactSpec("earningsGrowth", "Earnings Growth", "%", "raw", "earningsGrowth", 100.0),
    FactSpec(
        "earningsQuarterlyGrowth", "Quarterly Earnings Growth", "%", "raw",
        "earningsQuarterlyGrowth", 100.0,
    ),
    FactSpec("grossMargins", "Gross Margin", "%", "raw", "grossMargins", 100.0),
    FactSpec("operatingMargins", "Operating Margin", "%", "raw", "operatingMargins", 100.0),
    FactSpec("ebitdaMargins", "EBITDA Margin", "%", "raw", "ebitdaMargins", 100.0),
    FactSpec("profitMargins", "Net Margin", "%", "raw", "profitMargins", 100.0),
    FactSpec("returnOnAssets", "ROA", "%", "raw", "returnOnAssets", 100.0),
    FactSpec("payoutRatio", "Payout Ratio", "%", "raw", "payoutRatio", 100.0),
    FactSpec(
        "fiveYearAvgDividendYield", "5y Avg Dividend Yield", "%", "raw",
        "fiveYearAvgDividendYield",
    ),
]

#: Catalog keys already shown above — excluded from "other ratios".
_USED_CATALOG_KEYS = frozenset(
    fact.key
    for fact in (*MAIN_FACTS, *BALANCE_FACTS, *PERFORMANCE_FACTS)
    if fact.key in CATALOG_BY_KEY
)


def _facts(row: dict, specs: list[FactSpec]) -> list[dict]:
    metrics: list[dict] = []
    for spec in specs:
        value = resolve_value(row, spec)
        if value is None:
            continue
        metrics.append({"key": spec.key, "label": spec.label, "unit": spec.unit, "value": value})
    return metrics


def build_sections(row: dict) -> dict:
    """Section payload for one stored snapshot row.

    ``row``: ``{pe, pb, roe, roce, debt_to_equity, market_cap, raw}`` (the engine
    row shape). Missing/NaN values are skipped, never rendered as null tiles.
    """
    other_groups = report_builder.build_catalog_groups(row, skip_keys=_USED_CATALOG_KEYS)
    return {
        "main_ratios": _facts(row, MAIN_FACTS),
        "has": _facts(row, BALANCE_FACTS),
        "done": _facts(row, PERFORMANCE_FACTS),
        "other_groups": other_groups,
    }
