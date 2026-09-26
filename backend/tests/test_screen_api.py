import json

from fastapi.testclient import TestClient

from app.api import screen
from app.main import app

client = TestClient(app)


class FakeProvider:
    def list_stocks(self):
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

    def fundamentals(self, symbol):
        if symbol == "CCC":
            raise RuntimeError("fetch failed")
        good = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
        bad = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
        f = good if symbol == "AAA" else bad
        return {"symbol": symbol, **f, "raw": {}}


def test_screen_run_and_latest(tmp_path, monkeypatch):
    monkeypatch.setattr(screen, "get_provider", lambda: FakeProvider())
    # isolate DB per test run
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db.database import Base

    engine = create_engine(f"sqlite:///{tmp_path}/test.db")
    TestSession = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(screen, "SessionLocal", TestSession)
    monkeypatch.setattr(screen, "init_db", lambda: None)

    res = client.post("/screen/run")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["failed_count"] == 1
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]

    latest = client.get("/screen/latest")
    assert latest.status_code == 200
    rows = latest.json()["shortlisted"]
    assert rows[0]["symbol"] == "AAA"
    assert rows[0]["name"] == "Alpha"
    json.dumps(rows)  # serializable


def test_config_endpoints():
    assert client.get("/screen/config").status_code == 200
    assert client.post("/screen/config/reload").status_code == 200
