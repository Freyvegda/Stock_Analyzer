import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401 — register tables
from app.db.database import Base
from app.db.models import Fundamental
from app.screener.criteria import ConfigError
from app.screener.engine import apply_screen, evaluate_screen, rank_shortlist, screen_rows
from app.screener.service import latest_ok_fundamentals

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


def test_negative_or_zero_shortlist_size_yields_empty():
    rows = [row(f"S{i}", roe=20 + i) for i in range(5)]
    assert apply_screen(rows, CRITERIA, shortlist_size=-1) == []
    assert apply_screen(rows, CRITERIA, shortlist_size=0) == []


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


def test_rejected_reports_first_failed_gate_only():
    """Staged gates: a stock cut at the first gate is never checked against later ones."""
    criteria = [{"key": "pe", "enabled": True, "value": 25}, {"key": "pb", "enabled": True, "value": 5}]
    shortlist, rejected = evaluate_screen([row("DOUBLE_FAIL", pe=30, pb=9)], criteria)
    assert shortlist == []
    assert rejected == [{"symbol": "DOUBLE_FAIL", "failed": ["pe"]}]


def test_screen_rows_keeps_survivor_order_and_row_payload():
    criteria = [{"key": "pe", "enabled": True, "value": 25}]
    rows = [row("B"), row("A")]
    survivors, rejected = screen_rows(rows, criteria)
    assert [r["symbol"] for r in survivors] == ["B", "A"]
    assert survivors[0]["raw"] == {}
    assert rejected == []


def test_rank_shortlist_preserves_data_date():
    criteria = [{"key": "pe", "enabled": True, "value": 25}]
    survivors, _ = screen_rows([{**row("A"), "data_date": "2026-09-26"}], criteria)
    ranked = rank_shortlist(survivors, shortlist_size=10)
    assert ranked == [
        {
            "rank": 1,
            "symbol": "A",
            "score": 36.0,
            "ratios": {key: survivors[0][key] for key in DERIVED_KEYS},
            "failed": [],
            "data_date": "2026-09-26",
        }
    ]


def test_bookmark_flag_does_not_change_screening():
    bookmarked = [{**criterion, "bookmarked": True} for criterion in CRITERIA]
    rows = [row("A"), row("B", pe=30)]
    plain, plain_rejected = evaluate_screen(rows, CRITERIA)
    marked, marked_rejected = evaluate_screen(rows, bookmarked)
    assert marked == plain
    assert marked_rejected == plain_rejected


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/screener.db")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_latest_ok_ignores_failed_and_older_rows(session_factory):
    # newest `ok` row per symbol: failed rows and older ok rows must not win
    with session_factory() as session:
        session.add_all(
            [
                Fundamental(symbol="AAA", date="2026-09-01", data_status="ok"),
                Fundamental(symbol="AAA", date="2026-09-02", data_status="failed"),
                Fundamental(symbol="AAA", date="2026-09-03", data_status="ok"),
                Fundamental(symbol="BBB", date="2026-09-01", data_status="ok"),
            ]
        )
        session.commit()
        latest = latest_ok_fundamentals(session, ["AAA", "BBB"])

    assert set(latest) == {"AAA", "BBB"}
    assert latest["AAA"].date == "2026-09-03"
    assert latest["BBB"].date == "2026-09-01"


def test_latest_ok_ignores_newest_failed_row(session_factory):
    # a failed row newer than the last `ok` row must not be selected
    with session_factory() as session:
        session.add_all(
            [
                Fundamental(symbol="AAA", date="2026-09-01", data_status="ok"),
                Fundamental(symbol="AAA", date="2026-09-02", data_status="failed"),
            ]
        )
        session.commit()
        latest = latest_ok_fundamentals(session, ["AAA"])

    assert latest["AAA"].date == "2026-09-01"


def test_latest_ok_empty_symbols_returns_empty(session_factory):
    with session_factory() as session:
        assert latest_ok_fundamentals(session, []) == {}


def test_latest_ok_uses_grouped_max_query():
    # Regression: a duplicate slow def (load-all + order_by) once shadowed the
    # grouped MAX(date) subquery. Both return same rows on small fixtures, so
    # assert the implementation reads newest rows only.
    import inspect

    import app.screener.service as service

    source = inspect.getsource(service.latest_ok_fundamentals)
    assert "func.max" in source and "group_by" in source
    defs = [
        line
        for line in inspect.getsource(service).splitlines()
        if line.startswith("def latest_ok_fundamentals")
    ]
    assert len(defs) == 1
    assert len([l for l in inspect.getsource(service).splitlines() if l.startswith("def stored_row")]) == 1
