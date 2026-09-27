"""Per-user stock report: verdict, score, criterion checks, notes, metric groups.

Pure functions — no DB, no network. The report is computed on read from the
stored snapshot plus the caller's saved criteria and is NEVER persisted, so two
users share the same stock data and get different verdicts (Phase 1.6 spec §2).
"""

from app.screener.catalog import RATIO_CATALOG
from app.screener.engine import enabled_criteria, resolve_value, score_row


def _fmt(value: float) -> str:
    return f"{value:g}"


def build_report(snapshot: dict, criteria: list[dict]) -> dict:
    """Build the report payload for one stock against one user's criteria.

    ``snapshot``: ``{pe, pb, roe, roce, debt_to_equity, market_cap, raw}``.
    Unknown criteria keys raise ``ConfigError`` (shared 422 vehicle).
    """
    criteria_rows: list[dict] = []
    notes: list[str] = []
    passed_count = 0

    for spec, threshold in enabled_criteria(criteria):
        value = resolve_value(snapshot, spec)
        passed = value is not None and (
            value <= threshold if spec.direction == "max" else value >= threshold
        )
        if passed:
            passed_count += 1
        elif value is None:
            notes.append(f"{spec.label} has no stored data — counts as a fail")
        elif spec.direction == "max":
            notes.append(
                f"{spec.label} {_fmt(value)}{spec.unit} is above your limit of "
                f"{_fmt(threshold)}{spec.unit}"
            )
        else:
            notes.append(
                f"{spec.label} {_fmt(value)}{spec.unit} is below your minimum of "
                f"{_fmt(threshold)}{spec.unit}"
            )
        criteria_rows.append(
            {
                "key": spec.key,
                "label": spec.label,
                "unit": spec.unit,
                "direction": spec.direction,
                "threshold": threshold,
                "value": value,
                "passed": passed,
                "delta": None if value is None else round(value - threshold, 4),
            }
        )

    # Catalog metrics grouped by category, in catalog order (first appearance).
    groups = build_catalog_groups(snapshot)

    enabled = len(criteria_rows)
    return {
        "verdict": "pass" if passed_count == enabled else "fail",
        "score": round(score_row(snapshot), 2),
        "passed": passed_count,
        "enabled": enabled,
        "criteria": criteria_rows,
        "notes": notes,
        "groups": groups,
    }


def build_catalog_groups(
    row: dict, skip_keys: frozenset[str] = frozenset()
) -> list[dict]:
    """Catalog metrics grouped by category, in catalog order (first appearance).

    ``skip_keys`` omits specs already rendered by another section (the digest).
    """
    groups: list[dict] = []
    group_by_category: dict[str, dict] = {}
    for spec in RATIO_CATALOG:
        if spec.key in skip_keys:
            continue
        value = resolve_value(row, spec)
        if value is None:
            continue
        group = group_by_category.get(spec.category)
        if group is None:
            group = {"category": spec.category, "metrics": []}
            group_by_category[spec.category] = group
            groups.append(group)
        group["metrics"].append(
            {"key": spec.key, "label": spec.label, "unit": spec.unit, "value": value}
        )
    return groups
