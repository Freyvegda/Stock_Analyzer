"""Ratio engine: filter fundamentals by YAML criteria, rank, cut to shortlist.

Pure functions — no DB, no network. Fully unit-testable.
"""

# criterion name -> (fundamentals key, comparator). max = value must be <= limit.
CRITERIA = {
    "pe_max": ("pe", "max"),
    "pb_max": ("pb", "max"),
    "roe_min": ("roe", "min"),
    "roce_min": ("roce", "min"),
    "debt_to_equity_max": ("debt_to_equity", "max"),
    "market_cap_min": ("market_cap", "min"),
}


def _passes(value: float | None, limit: float, direction: str) -> bool:
    if value is None:
        return False  # missing data fails the criterion
    return value <= limit if direction == "max" else value >= limit


def apply_screen(rows: list[dict], config: dict) -> list[dict]:
    """rows: [{symbol, pe, pb, roe, roce, debt_to_equity, market_cap}]

    Returns ranked shortlist: [{symbol, rank, score, ratios, failed}].
    """
    criteria = {k: float(v) for k, v in (config.get("criteria") or {}).items()}
    unknown = set(criteria) - set(CRITERIA)
    if unknown:
        raise ValueError(f"Unknown criteria in screening.yaml: {sorted(unknown)}")

    survivors = []
    for row in rows:
        ratios = {key: row.get(key) for key, _direction in CRITERIA.values()}
        failed = [
            name
            for name, limit in criteria.items()
            if not _passes(row.get(CRITERIA[name][0]), limit, CRITERIA[name][1])
        ]
        if failed:
            continue
        score = (row.get("roe") or 0) + (row.get("roce") or 0) - (row.get("debt_to_equity") or 0) * 20
        survivors.append({"symbol": row["symbol"], "score": round(score, 2), "ratios": ratios, "failed": []})

    survivors.sort(key=lambda r: r["score"], reverse=True)
    size = int(config.get("shortlist_size", 10))
    return [{"rank": i + 1, **r} for i, r in enumerate(survivors[:size])]
