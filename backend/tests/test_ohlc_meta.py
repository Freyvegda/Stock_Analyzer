"""RED: get_ohlc exposes source + stale for cache-first chart."""

from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.stock import service
from app.stock.candles import CandleCache


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/meta.db")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def daily_rows(end: date, days: int) -> list[dict]:
    return [
        {
            "time": (end - timedelta(days=offset)).isoformat(),
            "open": 9.5,
            "high": 11.0,
            "low": 9.0,
            "close": 10.0,
            "volume": 100.0,
        }
        for offset in range(days - 1, -1, -1)
    ]


class FakeProvider:
    def __init__(self, rows):
        self.rows = rows
        self.last_ohlc_source = "yahoo"

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        return self.rows


def test_ohlc_reports_source_and_stale(session_factory):
    from app.db.models import Stock

    with session_factory() as session:
        session.merge(Stock(symbol="AAA", name="Alpha", sector="IT", market_cap=1.0))
        session.commit()
    body = service.get_ohlc(
        session_factory, FakeProvider(daily_rows(date(2026, 9, 25), 400)), "AAA", "1y", "1d", CandleCache()
    )
    assert body["source"] == "yahoo"
    assert body["stale"] is False


def test_ohlc_memory_hit_reports_memory_source(session_factory):
    from app.db.models import Stock

    with session_factory() as session:
        session.merge(Stock(symbol="AAA", name="Alpha", sector="IT", market_cap=1.0))
        session.commit()
    cache = CandleCache()
    provider = FakeProvider(daily_rows(date(2026, 9, 25), 400))
    service.get_ohlc(session_factory, provider, "AAA", "1y", "1d", cache)
    second = service.get_ohlc(session_factory, provider, "AAA", "6m", "1d", cache)
    assert second["source"] == "memory"
