"""Digest section builder: main ratios, balance ("has"), performance ("done"),
remaining catalog groups. Pure — hand-computed fixtures only."""

import math

from app.stock import digest

ROW = {
    "pe": 20.0,
    "pb": 3.0,
    "roe": 25.0,
    "roce": 20.0,
    "debt_to_equity": 0.2,
    "market_cap": 5000.0,
    "raw": {
        "dividendYield": 1.2,
        "totalRevenue": 9.3e12,
        "revenueGrowth": 0.112,
        "currentRatio": 1.8,
        "trailingEps": 12.5,
        "longBusinessSummary": "Makes things",
    },
}


def metric(facts: list[dict], key: str) -> dict | None:
    return next((fact for fact in facts if fact["key"] == key), None)


def other_keys(sections: dict) -> set[str]:
    return {m["key"] for group in sections["other_groups"] for m in group["metrics"]}


def test_main_ratios_resolve_derived_and_raw():
    sections = digest.build_sections(ROW)

    pe = metric(sections["main_ratios"], "pe")
    assert pe == {"key": "pe", "label": "P/E", "unit": "×", "value": 20.0}
    dividend_yield = metric(sections["main_ratios"], "dividendYield")
    assert dividend_yield["value"] == 1.2  # fraction-shaped? no — scale 1.0, stays 1.2


def test_has_scales_currency_to_crore():
    sections = digest.build_sections(ROW)

    revenue = metric(sections["has"], "totalRevenue")
    assert revenue == {
        "key": "totalRevenue",
        "label": "Revenue",
        "unit": "₹ cr",
        "value": 930000.0,
    }
    assert metric(sections["has"], "market_cap")["value"] == 5000.0


def test_done_scales_fractions_to_percent():
    sections = digest.build_sections(ROW)

    growth = metric(sections["done"], "revenueGrowth")
    assert growth["label"] == "Revenue Growth"
    assert math.isclose(growth["value"], 11.2, rel_tol=1e-9)


def test_nan_and_missing_are_skipped():
    row = {"pe": float("nan"), "market_cap": 1.0, "raw": {"trailingEps": float("inf"), "currentRatio": 1.5}}
    sections = digest.build_sections(row)

    assert metric(sections["main_ratios"], "pe") is None
    assert "trailingEps" not in other_keys(sections)  # inf dropped
    assert metric(sections["has"], "currentRatio")["value"] == 1.5


def test_other_groups_exclude_used_keys():
    sections = digest.build_sections(ROW)

    keys = other_keys(sections)
    assert "pe" not in keys
    assert "market_cap" not in keys
    assert "dividendYield" not in keys
    assert keys == {"trailingEps"}
    assert [group["category"] for group in sections["other_groups"]] == ["Per Share"]


def test_missing_raw_still_builds():
    sections = digest.build_sections({"pe": 20.0, "market_cap": 100.0, "raw": {}})

    assert set(sections) == {"main_ratios", "has", "done", "other_groups"}
    assert metric(sections["main_ratios"], "pe")["value"] == 20.0
    assert metric(sections["main_ratios"], "dividendYield") is None
    assert [fact["key"] for fact in sections["has"]] == ["market_cap"]
    assert sections["done"] == []
