import json
import logging
from datetime import date

import httpx
import pytest

from app.api import screen as screen_api
from app.db.models import Fundamental, ScreenRun, Stock, UserCriteria
from app.screener.criteria import default_criteria

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
FAILED_KEYS = ["pe", "pb", "roe", "roce", "debt_to_equity", "market_cap"]


class FakeProvider:
    def __init__(self, stale=False, fail_symbols=(), partial_symbols=()):
        self.stale = stale
        self.fail_symbols = set(fail_symbols)
        self.partial_symbols = set(partial_symbols)

    def list_stocks(self):
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

    def fundamentals(self, symbol):
        if symbol == "CCC" or symbol in self.fail_symbols:
            raise RuntimeError(f"fetch failed for {symbol}")
        if symbol in self.partial_symbols:
            return {
                "symbol": symbol,
                "pe": None,
                "pb": None,
                "roe": None,
                "roce": None,
                "debt_to_equity": None,
                "market_cap": None,
                "raw": {"src": "fake"},
            }
        data = GOOD if symbol == "AAA" else BAD
        return {"symbol": symbol, **data, "raw": {"src": "fake", "currentRatio": 1.8}}


@pytest.fixture
def provider(monkeypatch):
    def _use(p):
        monkeypatch.setattr(screen_api, "get_provider", lambda: p)
        return p

    return _use


def test_run_uses_caller_criteria_and_stores_snapshot(client, sign_in, provider, test_db):
    user = sign_in()
    provider(FakeProvider())

    body = client.post("/screen/run").json()
    assert body["total"] == 3
    assert body["failed_count"] == 1 and body["failed_symbols"] == ["CCC"]
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]
    assert body["failed_details"] == [{"symbol": "BBB", "failed": FAILED_KEYS}]
    with test_db() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
        assert run.user_id == user["id"]
        assert json.loads(run.criteria_json) == default_criteria()


def test_latest_is_per_user(client, sign_in, provider, test_db):
    a = sign_in("alice")
    provider(FakeProvider())
    client.post("/screen/run")
    b = sign_in("bob")
    assert client.get("/screen/latest").status_code == 404  # bob has no run
    client.post("/screen/run")
    assert client.get("/screen/latest").json()["shortlisted"][0]["symbol"] == "AAA"
    sign_in("alice")
    assert client.get("/screen/latest").json()["shortlisted"][0]["symbol"] == "AAA"
    with test_db() as session:
        assert {r.user_id for r in session.query(ScreenRun).all()} == {a["id"], b["id"]}


def test_tampered_shortlist_size_still_clamps(client, sign_in, provider, test_db):
    user = sign_in()
    with test_db() as session:
        session.add(
            UserCriteria(
                user_id=user["id"],
                criteria_json=json.dumps(default_criteria()),
                thesis=None,
                shortlist_size=50,
                updated_at="now",
            )
        )
        session.commit()
    provider(FakeProvider())
    body = client.post("/screen/run").json()
    assert len(body["shortlisted"]) == 1  # only AAA survives, never more than 10
    assert body["shortlisted"][0]["rank"] == 1


def test_disabled_criteria_and_raw_catalog_are_honored(client, sign_in, provider, test_db):
    user = sign_in()
    criteria = [
        {"key": "pe", "enabled": False, "value": 25},
        {"key": "currentRatio", "enabled": True, "value": 1.5},
    ]
    with test_db() as session:
        session.add(
            UserCriteria(
                user_id=user["id"],
                criteria_json=json.dumps(criteria),
                thesis=None,
                shortlist_size=10,
                updated_at="now",
            )
        )
        session.commit()
    provider(FakeProvider(partial_symbols=("BBB",)))
    body = client.post("/screen/run").json()
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]  # pe disabled, raw passes
    assert body["failed_details"] == [{"symbol": "BBB", "failed": ["currentRatio"]}]


def test_failed_fetch_persisted_and_market_cap_preserved(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())
    client.post("/screen/run")
    provider(FakeProvider(fail_symbols=("AAA",)))
    client.post("/screen/run")
    with test_db() as session:
        assert session.get(Stock, "AAA").market_cap == 5000.0
        assert session.get(Fundamental, ("CCC", date.today().isoformat())).data_status == "failed"


def test_run_twice_same_day_is_idempotent(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())
    client.post("/screen/run")
    client.post("/screen/run")
    with test_db() as session:
        assert session.query(ScreenRun).count() == 2
        assert session.query(Fundamental).count() == 3


def test_stale_provider_flagged(client, sign_in, provider):
    sign_in()
    provider(FakeProvider(stale=True))
    assert client.post("/screen/run").json()["stale"] is True


def test_unreachable_provider_returns_structured_502(client, sign_in, provider):
    sign_in()

    class DeadProvider:
        stale = False

        def list_stocks(self):
            raise httpx.ConnectError("nifty500 download refused")

    provider(DeadProvider())
    res = client.post("/screen/run")
    assert res.status_code == 502
    assert "nifty500 download refused" in res.json()["detail"]


def test_screen_routes_require_auth(client, test_db):
    assert client.post("/screen/run").status_code == 401
    assert client.get("/screen/latest").status_code == 401


def test_failed_fetch_logs_warning(client, sign_in, provider, caplog):
    sign_in()
    provider(FakeProvider())
    with caplog.at_level(logging.WARNING):
        client.post("/screen/run")
    assert "CCC" in caplog.text
