"""Ratio engine: filter fundamentals by per-user criteria, rank, cut to shortlist.

Pure functions — no DB, no network. Fully unit-testable. Criteria come from
``user_criteria.criteria_json`` (validated by ``criteria.py``); the catalog is
the source of truth for direction/scale.
"""

import math

from app.screener.catalog import CATALOG_BY_KEY, RATIO_CATALOG, RatioSpec
from app.screener.criteria import ConfigError

#: The screener never returns more than this many stocks in one run.
MAX_SHORTLIST = 10

_DERIVED_KEYS = [spec.key for spec in RATIO_CATALOG if spec.source == "derived"]


def resolve_value(row: dict, spec: RatioSpec) -> float | None:
    """Value for one criterion on one stock; None means "fails the criterion".

    Public: shared by the engine and the stock report builder.
    """
    if spec.source == "derived":
        value = row.get(spec.key)
    else:
        value = (row.get("raw") or {}).get(spec.yf_field)
        if value is None:
            return None
        try:
            value = float(value)
        except (TypeError, ValueError):
            return None
    if value is None:
        return None
    value = float(value)
    if math.isnan(value) or math.isinf(value):
        return None
    return value * spec.scale


def _passes(value: float | None, limit: float, direction: str) -> bool:
    if value is None:
        return False  # missing data fails the criterion
    return value <= limit if direction == "max" else value >= limit


def enabled_criteria(criteria: list[dict]) -> list[tuple[RatioSpec, float]]:
    """Enabled ``(spec, threshold)`` pairs in stored order; unknown keys raise."""
    enabled = []
    for item in criteria:
        spec = CATALOG_BY_KEY.get(item["key"])
        if spec is None:
            raise ConfigError(f"Unknown criteria key {item['key']!r}")
        if item["enabled"]:
            enabled.append((spec, float(item["value"])))
    return enabled


def score_row(row: dict) -> float:
    """Ranking score: ``roe + roce − 20 × debt_to_equity``; missing values count 0.

    Public: shared by ``rank_shortlist`` and the stock report builder.
    """
    return (row.get("roe") or 0) + (row.get("roce") or 0) - (row.get("debt_to_equity") or 0) * 20


def screen_rows(
    rows: list[dict], criteria: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Stage the gates in criteria order, each seeing only previous survivors.

    This mirrors how the service narrows the universe before spending network
    calls: a stock cut at "market cap > 1000" is never checked for "PE < 20".
    ``rejected`` reports the first failed gate only.

    rows: [{symbol, pe, pb, roe, roce, debt_to_equity, market_cap, raw, data_date?}]
    criteria: [{key, enabled, value}] — only enabled criteria are evaluated
    """
    enabled = enabled_criteria(criteria)

    survivors = list(rows)
    rejected = []
    for spec, limit in enabled:
        kept = []
        for row in survivors:
            if _passes(resolve_value(row, spec), limit, spec.direction):
                kept.append(row)
            else:
                rejected.append({"symbol": row["symbol"], "failed": [spec.key]})
        survivors = kept
    return survivors, rejected


def rank_shortlist(survivors: list[dict], shortlist_size: int = 10) -> list[dict]:
    """Score survivors, sort desc, clamp to ``min(shortlist_size, 10)``.

    Shortlist rows: [{rank, symbol, score, ratios, failed: [], data_date}].
    ``data_date`` is None for freshly fetched rows (the caller stamps it).
    """
    ranked = []
    for row in survivors:
        score = score_row(row)
        ratios = {key: row.get(key) for key in _DERIVED_KEYS}
        ranked.append(
            {
                "symbol": row["symbol"],
                "score": round(score, 2),
                "ratios": ratios,
                "failed": [],
                "data_date": row.get("data_date"),
            }
        )

    ranked.sort(key=lambda r: r["score"], reverse=True)
    size = max(0, min(int(shortlist_size), MAX_SHORTLIST))
    return [{"rank": i + 1, **r} for i, r in enumerate(ranked[:size])]


def evaluate_screen(
    rows: list[dict], criteria: list[dict], shortlist_size: int = 10
) -> tuple[list[dict], list[dict]]:
    """Staged filter + rank: split rows into (ranked shortlist, rejected).

    rows: [{symbol, pe, pb, roe, roce, debt_to_equity, market_cap, raw}]
    criteria: [{key, enabled, value}] — only enabled criteria are evaluated
    shortlist: [{rank, symbol, score, ratios, failed: [], data_date}], cut to
               ``min(shortlist_size, 10)``
    rejected: [{symbol, failed: [first criterion key]}] — None/missing fails
    """
    survivors, rejected = screen_rows(rows, criteria)
    return rank_shortlist(survivors, shortlist_size), rejected


def apply_screen(rows: list[dict], criteria: list[dict], shortlist_size: int = 10) -> list[dict]:
    """Ranked shortlist only. See evaluate_screen for the rejected criteria."""
    return evaluate_screen(rows, criteria, shortlist_size)[0]
