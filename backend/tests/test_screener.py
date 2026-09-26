import pytest

from app.screener.criteria import ConfigError
from app.screener.engine import apply_screen, evaluate_screen

CRITERIA = [
    {"key": "pe", "enabled": True, "value": 25},
    {"key": "pb", "enabled": True, "value": 5},
    {"key": "roe", "enabled": True, "value": 15},
    {"key": "roce", "enabled": True, "value": 15},
    {"key": "debt_to_equity", "enabled": True, "value": 0.5},
    {"key": "market_cap", "enabled": True, "value": 1000},
]
DERIVED_KEYS = {"pe", "pb", "roe", "roce", "debt_to_equity", "market_cap"}


def row(symbol, pe=20, pb=3, roe=20, roce=20, de=0.2, mc=5000, raw=None):
    return {
        "symbol": symbol,
        "pe": pe,
        "pb": pb,
        "roe": roe,
        "roce": roce,
        "debt_to_equity": de,
        "market_cap": mc,
        "raw": raw or {},
    }


def test_all_pass_shortlisted():
    result = apply_screen([row("A")], CRITERIA)
    assert result[0]["symbol"] == "A" and result[0]["rank"] == 1
    assert set(result[0]["ratios"]) == DERIVED_KEYS


def test_pe_above_max_fails():
    assert apply_screen([row("B", pe=30)], CRITERIA) == []


def test_null_ratio_fails():
    assert apply_screen([row("D", pe=None)], CRITERIA) == []


def test_disabled_criterion_is_skipped():
    criteria = [dict(c) for c in CRITERIA]
    criteria[0] = {"key": "pe", "enabled": False, "value": 25}
    assert [r["symbol"] for r in apply_screen([row("E", pe=999)], criteria)] == ["E"]


def test_raw_criterion_reads_info_payload():
    criteria = [{"key": "currentRatio", "enabled": True, "value": 1.5}]
    assert apply_screen([row("F", raw={"currentRatio": 1.8})], criteria)
    assert apply_screen([row("F", raw={"currentRatio": 1.2})], criteria) == []


def test_raw_criterion_applies_scale():
    criteria = [{"key": "profitMargins", "enabled": True, "value": 1.5}]
    assert apply_screen([row("G", raw={"profitMargins": 0.02})], criteria)  # 2.0% >= 1.5%
    assert apply_screen([row("G", raw={"profitMargins": 0.01})], criteria) == []  # 1.0% < 1.5%


def test_missing_or_nan_raw_value_fails():
    criteria = [{"key": "currentRatio", "enabled": True, "value": 1.5}]
    assert apply_screen([row("H")], criteria) == []
    assert apply_screen([row("H", raw={"currentRatio": float("nan")})], criteria) == []
    assert apply_screen([row("H", raw={"currentRatio": "n/a"})], criteria) == []


def test_ranking_by_score_desc():
    rows = [row("LOW", roe=16, roce=16, de=0.4), row("HIGH", roe=30, roce=30, de=0.1)]
    assert [r["symbol"] for r in apply_screen(rows, CRITERIA)] == ["HIGH", "LOW"]


def test_cut_is_clamped_to_ten():
    rows = [row(f"S{i}", roe=20 + i) for i in range(15)]
    assert len(apply_screen(rows, CRITERIA, shortlist_size=50)) == 10
    assert len(apply_screen(rows, CRITERIA, shortlist_size=3)) == 3


def test_unknown_criterion_raises_config_error():
    with pytest.raises(ConfigError):
        apply_screen([row("X")], [{"key": "bogus", "enabled": True, "value": 1}])


def test_evaluate_screen_rejected_lists_enabled_failed_keys():
    shortlist, rejected = evaluate_screen(
        [row("PASS"), row("FAIL_PE", pe=30), row("FAIL_NULL", pe=None)], CRITERIA
    )
    assert [r["symbol"] for r in shortlist] == ["PASS"]
    assert {r["symbol"]: r["failed"] for r in rejected} == {
        "FAIL_PE": ["pe"],
        "FAIL_NULL": ["pe"],
    }
    assert set(rejected[0]) == {"symbol", "failed"}
