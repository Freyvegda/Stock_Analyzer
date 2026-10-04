"""GET /stock/{symbol}/financials route tests (Task 3 RED)."""

import pytest

from app.api import stock as stock_api
from app.db.models import Stock


@pytest.fixture
def provider(monkeypatch):
    def _use(p):
        monkeypatch.setattr(stock_api, "get_provider", lambda: p)
        return p

    return _use


class FakeProvider:
    def __init__(self, payload=None, fail=False):
        self.payload = payload or {"quarterly": [], "annual": [], "as_of": None, "stale": False}
        self.fail = fail
        self.calls: list[str] = []

    def financials(self, symbol: str) -> dict:
        self.calls.append(symbol)
        if self.fail:
            raise RuntimeError("screener down")
        return dict(self.payload)


def _seed_stock(test_db, symbol="AAA"):
    with test_db() as session:
        session.merge(Stock(symbol=symbol, name="Alpha Ltd", sector="IT", market_cap=1.0))
        session.commit()


def test_financials_requires_auth(client, test_db):
    assert client.get("/stock/AAA/financials").status_code == 401


def test_financials_returns_history_shape(client, sign_in, provider, test_db):
    _seed_stock(test_db)
    sign_in()
    payload = {
        "quarterly": [{"period": "Q2FY26", "sales": 100.0, "pat": 10.0}],
        "annual": [{"period": "FY25", "sales": 1000.0, "pat": 150.0}],
        "as_of": "2026-10-04",
        "stale": False,
    }
    provider(FakeProvider(payload=payload))

    res = client.get("/stock/AAA/financials")
    assert res.status_code == 200
    body = res.json()
    assert body["symbol"] == "AAA"
    assert body["quarterly"][0]["sales"] == 100.0
    assert body["annual"][0]["pat"] == 150.0
    assert body["as_of"] == "2026-10-04"
    assert body["stale"] is False


def test_financials_unknown_symbol_is_404(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())

    res = client.get("/stock/NOPE/financials")
    assert res.status_code == 404


def test_financials_502_when_provider_dead(client, sign_in, provider, test_db):
    _seed_stock(test_db)
    sign_in()
    provider(FakeProvider(fail=True))

    res = client.get("/stock/AAA/financials")
    assert res.status_code == 502
