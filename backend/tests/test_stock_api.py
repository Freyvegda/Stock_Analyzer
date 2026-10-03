import json
from datetime import date, timedelta

import pytest

from app.api import stock as stock_api
from app.db.models import Fundamental, Price, ScreeningSet, Stock
from app.stock.candles import CandleCache

STORED_DATE = "2026-09-20"
TODAY = date.today().isoformat()

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

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
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


def seed_stock_row(test_db, symbol: str = "AAA", market_cap: float = 5000.0) -> None:
    with test_db() as session:
        session.merge(Stock(symbol=symbol, name="Alpha Ltd", sector="IT", market_cap=market_cap))
        session.commit()


def seed_stored(test_db, symbol: str = "AAA", data: dict | None = None) -> None:
    values = data if data is not None else GOOD
    with test_db() as session:
        session.merge(
            Fundamental(
                symbol=symbol,
                date=STORED_DATE,
                pe=values.get("pe"),
                pb=values.get("pb"),
                roe=values.get("roe"),
                roce=values.get("roce"),
                debt_to_equity=values.get("debt_to_equity"),
                data_status="ok",
                raw_json=json.dumps({"src": "stored", "returnOnAssets": 0.08}),
            )
        )
        session.commit()


def seed_criteria(test_db, user_id: int, criteria: list[dict]) -> None:
    with test_db() as session:
        session.add(
            ScreeningSet(
                user_id=user_id,
                name="Default",
                criteria_json=json.dumps(criteria),
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="now",
            )
        )
        session.commit()


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


@pytest.fixture
def provider(monkeypatch):
    def _use(p: FakeProvider) -> FakeProvider:
        monkeypatch.setattr(stock_api, "get_provider", lambda: p)
        monkeypatch.setattr(stock_api, "default_cache", CandleCache())
        return p

    return _use


def test_stock_routes_require_auth(client, test_db):
    assert client.get("/stock/AAA").status_code == 401
    assert client.post("/stock/AAA/refresh").status_code == 401
    assert client.get("/stock/AAA/ohlc").status_code == 401


def test_unknown_symbol_is_404(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())

    res = client.get("/stock/NOPE")
    assert res.status_code == 404
    assert res.json()["detail"] == "Unknown symbol NOPE"
    assert client.get("/stock/NOPE/ohlc").status_code == 404
    assert client.post("/stock/NOPE/refresh").status_code == 404


def test_first_view_fetches_and_second_user_reads_db(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in("alice")
    p = provider(FakeProvider(fundamentals={"AAA": GOOD}))

    alice = client.get("/stock/AAA").json()

    assert p.fundamentals_calls == ["AAA"]
    assert alice["data_date"] == TODAY and alice["stale"] is False
    assert alice["report"]["verdict"] == "pass"
    assert alice["report"]["groups"]
    assert alice["run"] is None

    sign_in("bob")
    bob = client.get("/stock/AAA").json()

    assert p.fundamentals_calls == ["AAA"]  # shared snapshot: no second fetch
    assert bob["snapshot"] == alice["snapshot"]
    assert bob["data_date"] == alice["data_date"]


def test_verdict_is_per_user(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    seed_stored(test_db)
    alice = sign_in("alice")
    seed_criteria(test_db, alice["id"], [{"key": "pe", "enabled": True, "value": 25.0}])
    provider(FakeProvider())

    alice_view = client.get("/stock/AAA").json()

    bob = sign_in("bob")
    seed_criteria(test_db, bob["id"], [{"key": "pe", "enabled": True, "value": 5.0}])
    bob_view = client.get("/stock/AAA").json()

    assert alice_view["report"]["verdict"] == "pass"
    assert bob_view["report"]["verdict"] == "fail"
    assert alice_view["snapshot"] == bob_view["snapshot"]
    assert bob_view["report"]["notes"] == ["P/E 20× is above your limit of 5×"]


def test_refresh_returns_stored_with_warning_when_fetch_fails(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    seed_stored(test_db)
    sign_in()
    provider(FakeProvider(fail_fundamentals=("AAA",)))

    res = client.post("/stock/AAA/refresh")

    assert res.status_code == 200
    body = res.json()
    assert body["refreshed"] is False
    assert "fetch failed" in body["warning"]
    assert body["data_date"] == STORED_DATE


def test_502_when_nothing_stored_and_provider_dead(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in()
    provider(FakeProvider(fail_fundamentals=("AAA",)))

    res = client.get("/stock/AAA")
    assert res.status_code == 502
    assert res.json()["detail"].startswith("Stock data unavailable")


def test_ohlc_range_and_interval_validation(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())

    assert client.get("/stock/AAA/ohlc?range=10y").status_code == 422
    assert client.get("/stock/AAA/ohlc?interval=1w").status_code == 422


def test_ohlc_slices_and_aggregates(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in()
    rows = daily_rows(date(2026, 9, 25), 400)
    provider(FakeProvider(ohlc_rows=rows))

    body = client.get("/stock/AAA/ohlc?range=1y&interval=15d").json()

    assert body["symbol"] == "AAA" and body["range"] == "1y" and body["interval"] == "15d"
    assert body["as_of"] == rows[-1]["time"]
    assert len(body["candles"]) == 25


def test_ohlc_writes_nothing(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in()
    provider(FakeProvider(ohlc_rows=daily_rows(date(2026, 9, 25), 400)))

    client.get("/stock/AAA/ohlc?range=1y&interval=1mo")

    with test_db() as session:
        assert session.query(Price).count() == 0
        assert session.query(Fundamental).count() == 0


def test_ohlc_served_from_cache(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in()
    p = provider(FakeProvider(ohlc_rows=daily_rows(date(2026, 9, 25), 400)))

    client.get("/stock/AAA/ohlc?range=1y&interval=1d")
    client.get("/stock/AAA/ohlc?range=6m&interval=1mo")

    assert p.ohlc_calls == [("AAA", 5)]


DIGEST_RAW = {
    "longBusinessSummary": "Makes things",
    "industry": "Oil & Gas",
    "fullTimeEmployees": 350000,
    "city": "Mumbai",
    "totalRevenue": 9.3e12,
    "revenueGrowth": 0.112,
}


def test_detail_has_profile_and_sections(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    sign_in()
    provider(FakeProvider(fundamentals={"AAA": {**GOOD, "raw": DIGEST_RAW}}))

    body = client.get("/stock/AAA").json()

    assert body["profile"]["industry"] == "Oil & Gas"
    assert body["profile"]["employees"] == 350000
    assert next(m for m in body["main_ratios"] if m["key"] == "pe")["value"] == 20.0
    assert next(m for m in body["has"] if m["key"] == "totalRevenue")["value"] == 930000.0
    assert next(m for m in body["done"] if m["key"] == "revenueGrowth")["value"] == pytest.approx(11.2)
    assert isinstance(body["other_groups"], list)


def test_refresh_keeps_sections_shape(client, sign_in, provider, test_db):
    seed_stock_row(test_db)
    seed_stored(test_db)
    sign_in()
    provider(FakeProvider(fundamentals={"AAA": {**GOOD, "raw": DIGEST_RAW}}))

    body = client.post("/stock/AAA/refresh").json()

    assert body["refreshed"] is True
    assert body["profile"]["description"] == "Makes things"
    assert {"main_ratios", "has", "done", "other_groups"} <= set(body)
