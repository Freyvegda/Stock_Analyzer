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


def _resolve(row: dict, spec: RatioSpec) -> float | None:
    """Value for one criterion on one stock; None means "fails the criterion"."""
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


def _enabled_criteria(criteria: list[dict]) -> list[tuple[RatioSpec, float]]:
    enabled = []
    for item in criteria:
        spec = CATALOG_BY_KEY.get(item["key"])
        if spec is None:
            raise ConfigError(f"Unknown criteria key {item['key']!r}")
        if item["enabled"]:
            enabled.append((spec, float(item["value"])))
    return enabled


def evaluate_screen(
    rows: list[dict], criteria: list[dict], shortlist_size: int = 10
) -> tuple[list[dict], list[dict]]:
    """Evaluate every row and split into (ranked shortlist, rejected).

    rows: [{symbol, pe, pb, roe, roce, debt_to_equity, market_cap, raw}]
    criteria: [{key, enabled, value}] — only enabled criteria are evaluated
    shortlist: [{rank, symbol, score, ratios, failed: []}], cut to
               ``min(shortlist_size, 10)``
    rejected: [{symbol, failed: [criterion keys]}] — None/missing fails
    """
    enabled = _enabled_criteria(criteria)

    survivors = []
    rejected = []
    for row in rows:
        failed = [
            spec.key
            for spec, limit in enabled
            if not _passes(_resolve(row, spec), limit, spec.direction)
        ]
        if failed:
            rejected.append({"symbol": row["symbol"], "failed": failed})
            continue
        score = (row.get("roe") or 0) + (row.get("roce") or 0) - (row.get("debt_to_equity") or 0) * 20
        ratios = {key: row.get(key) for key in _DERIVED_KEYS}
        survivors.append({"symbol": row["symbol"], "score": round(score, 2), "ratios": ratios, "failed": []})

    survivors.sort(key=lambda r: r["score"], reverse=True)
    size = max(0, min(int(shortlist_size), MAX_SHORTLIST))
    shortlist = [{"rank": i + 1, **r} for i, r in enumerate(survivors[:size])]
    return shortlist, rejected


def apply_screen(rows: list[dict], criteria: list[dict], shortlist_size: int = 10) -> list[dict]:
    """Ranked shortlist only. See evaluate_screen for the rejected criteria."""
    return evaluate_screen(rows, criteria, shortlist_size)[0]
