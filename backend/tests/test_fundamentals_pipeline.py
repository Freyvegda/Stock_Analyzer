"""Task 6 RED: composite fundamentals through screen + detail + candles."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401
from app.db.database import Base
from app.stock import store
from app.stock.candles import aggregate_candles, slice_range


def make_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def math_raw():
    return {
        "returnOnAssets": 10.0,
        "profitMargins": 15.0,
        "currentRatio": 1.6,
        "trailingEps": 50.0,
        "totalRevenue": 100000.0,
        "totalDebt": 15000.0,
    }


def test_trim_raw_keeps_math_keys():
    trimmed = store.trim_raw({**math_raw(), "junk": 1})
    assert trimmed["returnOnAssets"] == 10.0
    assert trimmed["profitMargins"] == 15.0
    assert trimmed["totalDebt"] == 15000.0
    assert "junk" not in trimmed


def test_upsert_profile_tolerates_screener_shaped_info():
    session_factory = make_session()
    with session_factory() as session:
        store.upsert_profile(session, "AAA", {"raw": "no-keys"}, "2026-10-04")
        session.commit()
        profile = store.read_profile(session, "AAA")
    assert set(profile) == {"description", "industry", "sector", "website", "employees", "hq"}


def test_pipeline_three_symbols_one_failure_isolated():
    from app.screener.engine import evaluate_screen

    rows = [
        {"symbol": "AAA", "pe": 10.0, "pb": 2.0, "roe": 20.0, "roce": 18.0,
         "debt_to_equity": 0.2, "market_cap": 50000.0, "raw": math_raw()},
        {"symbol": "BBB", "pe": 12.0, "pb": 2.5, "roe": 22.0, "roce": 20.0,
         "debt_to_equity": 0.3, "market_cap": 60000.0, "raw": math_raw()},
    ]
    criteria = [{"key": "roe", "enabled": True, "value": 15.0}]
    shortlist, rejected = evaluate_screen(rows, criteria)
    assert {r["symbol"] for r in shortlist} == {"AAA", "BBB"}

    candles = [
        {"time": "2026-01-04", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10.0},
        {"time": "2026-01-05", "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0, "volume": 12.0},
    ]
    assert len(slice_range(candles, "6m")) == 2
    assert len(aggregate_candles(candles, "1d")) == 2
