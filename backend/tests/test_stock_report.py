import pytest

from app.screener.criteria import ConfigError
from app.screener.engine import score_row
from app.stock.report import build_report

SNAPSHOT = {
    "pe": 20.0,
    "pb": 3.0,
    "roe": 25.0,
    "roce": 20.0,
    "debt_to_equity": 0.2,
    "market_cap": 5000.0,
    "raw": {"returnOnAssets": 0.08, "currentRatio": 2.0},
}

ALL_PASS = [
    {"key": "pe", "enabled": True, "value": 25.0},
    {"key": "pb", "enabled": True, "value": 5.0},
    {"key": "roe", "enabled": True, "value": 15.0},
    {"key": "roce", "enabled": True, "value": 15.0},
    {"key": "debt_to_equity", "enabled": True, "value": 0.5},
    {"key": "market_cap", "enabled": True, "value": 1000.0},
]


def test_all_enabled_pass_gives_pass_verdict():
    report = build_report(SNAPSHOT, ALL_PASS)

    assert report["verdict"] == "pass"
    assert report["passed"] == report["enabled"] == 6
    assert report["notes"] == []
    assert report["criteria"][0] == {
        "key": "pe",
        "label": "P/E",
        "unit": "×",
        "direction": "max",
        "threshold": 25.0,
        "value": 20.0,
        "passed": True,
        "delta": -5.0,
    }


def test_failed_criterion_flips_verdict_and_notes():
    report = build_report({**SNAPSHOT, "pe": 30.0}, ALL_PASS)

    assert report["verdict"] == "fail"
    assert report["passed"] == 5 and report["enabled"] == 6
    pe = report["criteria"][0]
    assert pe["passed"] is False and pe["delta"] == 5.0
    assert report["notes"] == ["P/E 30× is above your limit of 25×"]


def test_missing_value_fails_and_notes_no_data():
    report = build_report({**SNAPSHOT, "pe": None}, ALL_PASS)

    pe = report["criteria"][0]
    assert pe["passed"] is False and pe["value"] is None and pe["delta"] is None
    assert report["notes"] == ["P/E has no stored data — counts as a fail"]


def test_score_matches_engine_formula():
    assert score_row(SNAPSHOT) == 41.0  # 25 + 20 - 20*0.2
    assert build_report(SNAPSHOT, ALL_PASS)["score"] == 41.0

    missing = build_report({**SNAPSHOT, "roe": None}, ALL_PASS)
    assert missing["score"] == 16.0  # 0 + 20 - 20*0.2


def test_disabled_criteria_are_skipped():
    criteria = [
        {"key": "pe", "enabled": False, "value": 5.0},
        {"key": "roe", "enabled": True, "value": 15.0},
    ]

    report = build_report(SNAPSHOT, criteria)

    assert [c["key"] for c in report["criteria"]] == ["roe"]
    assert report["enabled"] == 1
    assert report["verdict"] == "pass"


def test_groups_are_catalog_order_scaled_and_skip_none():
    report = build_report(SNAPSHOT, ALL_PASS)
    groups = report["groups"]

    assert [g["category"] for g in groups] == [
        "Valuation",
        "Profitability",
        "Leverage",
        "Size",
        "Liquidity",
    ]
    flat = {m["key"]: m for g in groups for m in g["metrics"]}
    assert flat["pe"]["value"] == 20.0
    assert flat["returnOnAssets"]["value"] == 8.0  # fraction -> %
    assert flat["currentRatio"]["value"] == 2.0
    assert all(m["value"] is not None for m in flat.values())
    assert "profitMargins" not in flat  # missing raw key never appears


def test_unknown_key_raises_config_error():
    with pytest.raises(ConfigError):
        build_report(SNAPSHOT, [{"key": "nope", "enabled": True, "value": 1.0}])
