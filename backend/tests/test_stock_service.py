import json
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401 — register tables
from app.db.database import Base
from app.db.models import Fundamental, ScreenRun, Stock, User, UserCriteria
from app.stock import service
from app.stock.candles import CandleCache

TODAY = date.today().isoformat()
STORED_DATE = "2026-09-20"

GOOD = {
    "pe": 20.0,
    "pb": 3.0,
    "roe": 25.0,
    "roce": 25.0,
    "debt_to_equity": 0.2,
    "market_cap": 5000.0,
}


class FakeProvider:
    def __init__(self, fundamentals=None, fail_fundamentals=(), ohlc_rows=None, fail_ohlc=False):
        self.fundamentals_data = fundamentals or {}
        self.fail_fundamentals = set(fail_fundamentals)
        self.ohlc_rows = ohlc_rows if ohlc_rows is not None else []
        self.fail_ohlc = fail_ohlc
        self.fundamentals_calls: list[str] = []
        self.ohlc_calls: list[tuple[str, int]] = []

    def fundamentals(self, symbol: str) -> dict:
        self.fundamentals_calls.append(symbol)
        if symbol in self.fail_fundamentals:
            raise RuntimeError(f"fetch failed for {symbol}")
        data = self.fundamentals_data[symbol]
        return {"symbol": symbol, **data, "raw": data.get("raw", {"src": "fake"})}

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        self.ohlc_calls.append((symbol, years))
        if self.fail_ohlc:
            raise RuntimeError("yfinance down")
        return self.ohlc_rows


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/svc.db")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_stock(session_factory, symbol: str = "AAA", market_cap: float = 5000.0) -> None:
    with session_factory() as session:
        session.merge(Stock(symbol=symbol, name="Alpha Ltd", sector="IT", market_cap=market_cap))
        session.commit()


def seed_fundamental(
    session_factory,
    symbol: str = "AAA",
    date_iso: str = STORED_DATE,
    data: dict | None = None,
    status: str = "ok",
) -> None:
    values = data if data is not None else GOOD
    with session_factory() as session:
        session.merge(
            Fundamental(
                symbol=symbol,
                date=date_iso,
                pe=values.get("pe"),
                pb=values.get("pb"),
                roe=values.get("roe"),
                roce=values.get("roce"),
                debt_to_equity=values.get("debt_to_equity"),
                data_status=status,
                raw_json=json.dumps({"src": "stored"}),
            )
        )
        session.commit()


def seed_user(session_factory, username: str = "alice", criteria: list[dict] | None = None) -> int:
    with session_factory() as session:
        user = User(username=username, password_hash="x", created_at="now")
        session.add(user)
        session.flush()
        if criteria is not None:
            session.add(
                UserCriteria(
                    user_id=user.id,
                    criteria_json=json.dumps(criteria),
                    thesis=None,
                    shortlist_size=10,
                    updated_at="now",
                )
            )
        session.commit()
        return user.id


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


def test_stored_snapshot_never_calls_provider(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory)
    user_id = seed_user(session_factory)
    provider = FakeProvider()

    detail = service.get_stock_detail(session_factory, provider, user_id, "AAA")

    assert provider.fundamentals_calls == []
    assert detail["data_date"] == STORED_DATE
    assert detail["stale"] is True
    assert detail["snapshot"]["pe"] == 20.0
    assert "raw" not in detail["snapshot"]
    assert detail["report"]["verdict"] == "pass"
    assert detail["refreshed"] is None and detail["warning"] is None


def test_missing_snapshot_lazy_fetches_and_stores(session_factory):
    seed_stock(session_factory)
    user_id = seed_user(session_factory)
    provider = FakeProvider(fundamentals={"AAA": GOOD})

    detail = service.get_stock_detail(session_factory, provider, user_id, "AAA")

    assert provider.fundamentals_calls == ["AAA"]
    assert detail["data_date"] == TODAY
    assert detail["stale"] is False
    with session_factory() as session:
        row = session.get(Fundamental, ("AAA", TODAY))
        assert row is not None and row.data_status == "ok" and row.pe == 20.0
        assert session.get(Stock, "AAA").market_cap == 5000.0


def test_lazy_fetch_failure_writes_failed_row_and_raises(session_factory):
    seed_stock(session_factory)
    user_id = seed_user(session_factory)
    provider = FakeProvider(fail_fundamentals=("AAA",))

    with pytest.raises(service.StockDataUnavailable):
        service.get_stock_detail(session_factory, provider, user_id, "AAA")

    with session_factory() as session:
        row = session.get(Fundamental, ("AAA", TODAY))
        assert row is not None and row.data_status == "failed"


def test_unknown_symbol_raises_stock_not_found(session_factory):
    user_id = seed_user(session_factory)
    with pytest.raises(service.StockNotFound):
        service.get_stock_detail(session_factory, FakeProvider(), user_id, "NOPE")


def test_refresh_success_overwrites_today_and_sets_refreshed(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory, date_iso=TODAY, data={**GOOD, "pe": 30.0})
    user_id = seed_user(session_factory)
    provider = FakeProvider(fundamentals={"AAA": {**GOOD, "pe": 18.0}})

    detail = service.refresh_stock(session_factory, provider, user_id, "AAA")

    assert detail["refreshed"] is True and detail["warning"] is None
    assert detail["snapshot"]["pe"] == 18.0 and detail["data_date"] == TODAY
    with session_factory() as session:
        rows = session.query(Fundamental).filter(Fundamental.symbol == "AAA").all()
        assert len(rows) == 1 and rows[0].pe == 18.0


def test_refresh_failure_serves_stored_with_warning(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory)
    user_id = seed_user(session_factory)
    provider = FakeProvider(fail_fundamentals=("AAA",))

    detail = service.refresh_stock(session_factory, provider, user_id, "AAA")

    assert detail["refreshed"] is False
    assert "fetch failed" in detail["warning"]
    assert detail["data_date"] == STORED_DATE and detail["snapshot"]["pe"] == 20.0


def test_refresh_failure_keeps_same_day_ok_row(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory, date_iso=TODAY, data={**GOOD, "pe": 19.0})
    user_id = seed_user(session_factory)
    provider = FakeProvider(fail_fundamentals=("AAA",))

    detail = service.refresh_stock(session_factory, provider, user_id, "AAA")

    assert detail["refreshed"] is False and detail["snapshot"]["pe"] == 19.0
    with session_factory() as session:
        row = session.get(Fundamental, ("AAA", TODAY))
        assert row.data_status == "ok"  # good same-day snapshot never clobbered


def test_refresh_failure_without_stored_raises(session_factory):
    seed_stock(session_factory)
    user_id = seed_user(session_factory)
    with pytest.raises(service.StockDataUnavailable):
        service.refresh_stock(session_factory, FakeProvider(fail_fundamentals=("AAA",)), user_id, "AAA")


def test_verdict_uses_callers_criteria(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory)
    alice = seed_user(session_factory, "alice", [{"key": "pe", "enabled": True, "value": 25.0}])
    bob = seed_user(session_factory, "bob", [{"key": "pe", "enabled": True, "value": 5.0}])
    provider = FakeProvider()

    a = service.get_stock_detail(session_factory, provider, alice, "AAA")
    b = service.get_stock_detail(session_factory, provider, bob, "AAA")

    assert a["report"]["verdict"] == "pass"
    assert b["report"]["verdict"] == "fail"
    assert a["snapshot"] == b["snapshot"]
    assert provider.fundamentals_calls == []


def test_run_context_from_latest_run(session_factory):
    seed_stock(session_factory)
    seed_fundamental(session_factory)
    alice = seed_user(session_factory, "alice")
    bob = seed_user(session_factory, "bob")
    with session_factory() as session:
        session.add(
            ScreenRun(
                run_date="2026-09-25",
                user_id=alice,
                criteria_json="[]",
                shortlisted_json=json.dumps([{"symbol": "AAA", "rank": 1, "score": 9.5}]),
            )
        )
        session.commit()

    provider = FakeProvider()
    a = service.get_stock_detail(session_factory, provider, alice, "AAA")
    b = service.get_stock_detail(session_factory, provider, bob, "AAA")

    assert a["run"] == {"run_id": a["run"]["run_id"], "run_date": "2026-09-25", "rank": 1, "score": 9.5}
    assert b["run"] is None


def test_ohlc_slices_and_aggregates(session_factory):
    seed_stock(session_factory)
    rows = daily_rows(date(2026, 9, 25), 400)
    provider = FakeProvider(ohlc_rows=rows)

    yearly = service.get_ohlc(session_factory, provider, "AAA", "1y", "15d", CandleCache())

    assert yearly["symbol"] == "AAA" and yearly["range"] == "1y" and yearly["interval"] == "15d"
    assert yearly["as_of"] == rows[-1]["time"]
    assert len(yearly["candles"]) == 25  # 366 days -> 25 fifteen-day buckets
    assert yearly["candles"][0]["time"] == rows[-366]["time"]

    daily = service.get_ohlc(session_factory, provider, "AAA", "6m", "1d", CandleCache())
    assert len(daily["candles"]) == 183


def test_ohlc_empty_or_failed_provider_raises(session_factory):
    seed_stock(session_factory)
    with pytest.raises(service.PriceDataUnavailable):
        service.get_ohlc(session_factory, FakeProvider(ohlc_rows=[]), "AAA", "1y", "1d", CandleCache())
    with pytest.raises(service.PriceDataUnavailable):
        service.get_ohlc(session_factory, FakeProvider(fail_ohlc=True), "AAA", "1y", "1d", CandleCache())


def test_ohlc_unknown_symbol_raises(session_factory):
    with pytest.raises(service.StockNotFound):
        service.get_ohlc(session_factory, FakeProvider(), "NOPE", "1y", "1d", CandleCache())


def test_ohlc_uses_cache(session_factory):
    seed_stock(session_factory)
    provider = FakeProvider(ohlc_rows=daily_rows(date(2026, 9, 25), 400))
    cache = CandleCache()

    service.get_ohlc(session_factory, provider, "AAA", "1y", "1d", cache)
    service.get_ohlc(session_factory, provider, "AAA", "6m", "1mo", cache)

    assert provider.ohlc_calls == [("AAA", 5)]
