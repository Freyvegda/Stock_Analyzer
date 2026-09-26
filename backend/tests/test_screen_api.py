import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import screen
from app.db.database import Base
from app.db.models import Fundamental, ScreenRun, Stock
from app.main import app

client = TestClient(app)

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
FAILED_CRITERIA = ["pe_max", "pb_max", "roe_min", "roce_min", "debt_to_equity_max", "market_cap_min"]


class FakeProvider:
    def __init__(self, stale: bool = False, fail_symbols: tuple[str, ...] = ()):
        self.stale = stale
        self.fail_symbols = set(fail_symbols)

    def list_stocks(self):
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

    def fundamentals(self, symbol):
        if symbol == "CCC" or symbol in self.fail_symbols:
            raise RuntimeError(f"fetch failed for {symbol}")
        f = GOOD if symbol == "AAA" else BAD
        return {"symbol": symbol, **f, "raw": {"src": "fake"}}


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/test.db")
    TestSession = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(screen, "SessionLocal", TestSession)
    monkeypatch.setattr(screen, "init_db", lambda: None)
    return TestSession


def use_provider(monkeypatch, provider):
    monkeypatch.setattr(screen, "get_provider", lambda: provider)


def test_screen_run_and_latest(db, monkeypatch):
    use_provider(monkeypatch, FakeProvider())

    res = client.post("/screen/run")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["failed_count"] == 1
    assert body["failed_symbols"] == ["CCC"]
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]
    assert body["failed_details"] == [{"symbol": "BBB", "failed": FAILED_CRITERIA}]
    assert body["stale"] is False

    latest = client.get("/screen/latest")
    assert latest.status_code == 200
    rows = latest.json()["shortlisted"]
    assert rows[0]["symbol"] == "AAA"
    assert rows[0]["name"] == "Alpha"
    json.dumps(rows)  # serializable


def test_failed_fetch_persisted_with_data_status(db, monkeypatch):
    use_provider(monkeypatch, FakeProvider())
    client.post("/screen/run")

    today = date.today().isoformat()
    with db() as session:
        failed = session.get(Fundamental, ("CCC", today))
        assert failed.data_status == "failed"
        assert failed.pe is None
        assert "fetch failed" in failed.raw_json

        ok = session.get(Fundamental, ("AAA", today))
        assert ok.data_status == "ok"
        assert ok.roe == 25


def test_market_cap_preserved_when_fetch_fails(db, monkeypatch):
    use_provider(monkeypatch, FakeProvider())
    client.post("/screen/run")

    use_provider(monkeypatch, FakeProvider(fail_symbols=("AAA",)))
    client.post("/screen/run")

    with db() as session:
        assert session.get(Stock, "AAA").market_cap == 5000.0


def test_run_twice_same_day_is_idempotent(db, monkeypatch):
    use_provider(monkeypatch, FakeProvider())
    client.post("/screen/run")
    client.post("/screen/run")

    with db() as session:
        assert session.query(ScreenRun).count() == 2
        assert session.query(Fundamental).count() == 3


def test_stale_provider_flagged_in_response(db, monkeypatch):
    use_provider(monkeypatch, FakeProvider(stale=True))

    body = client.post("/screen/run").json()
    assert body["stale"] is True


def test_config_endpoints():
    assert client.get("/screen/config").status_code == 200
    assert client.post("/screen/config/reload").status_code == 200
