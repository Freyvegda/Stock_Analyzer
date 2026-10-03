import json

import httpx
import pytest

from app.api import screen as screen_api
from app.db.models import Fundamental, ScreeningSet, ScreenRun, Stock
from app.screener.criteria import default_criteria

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
STORED_DATE = "2026-09-26"


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

    def fundamentals(self, symbol, cached=None):
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


class MapProvider(FakeProvider):
    """Fully controllable fundamentals + call log. CCC raises only if not in ``data``."""

    def __init__(self, data=None, fail=(), stale=False):
        super().__init__(stale=stale)
        self.data = data or {}
        self.fail = set(fail)
        self.calls: list[str] = []

    def fundamentals(self, symbol, cached=None):
        self.calls.append(symbol)
        if symbol in self.fail:
            raise RuntimeError(f"fetch failed for {symbol}")
        return {"symbol": symbol, **self.data[symbol], "raw": self.data[symbol].get("raw", {"src": "fake"})}


def seed_stored(test_db, rows, date_iso=STORED_DATE):
    """Seed a stored snapshot: stocks plus ok fundamentals rows engine can read."""
    with test_db() as session:
        for data in rows:
            session.merge(
                Stock(
                    symbol=data["symbol"],
                    name=f"{data['symbol']} Ltd",
                    sector="IT",
                    market_cap=data["market_cap"],
                )
            )
            session.merge(
                Fundamental(
                    symbol=data["symbol"],
                    date=date_iso,
                    pe=data["pe"],
                    pb=data["pb"],
                    roe=data["roe"],
                    roce=data["roce"],
                    debt_to_equity=data["debt_to_equity"],
                    data_status="ok",
                    raw_json=json.dumps(data.get("raw", {})),
                )
            )
        session.commit()


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
    assert body["failed_details"] == [{"symbol": "BBB", "failed": ["pe"]}]
    with test_db() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
        assert run.user_id == user["id"]
        assert json.loads(run.criteria_json) == [
            {**criterion, "bookmarked": False} for criterion in default_criteria()
        ]


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
            ScreeningSet(
                user_id=user["id"],
                name="Tampered",
                criteria_json=json.dumps(default_criteria()),
                thesis=None,
                shortlist_size=50,
                is_active=True,
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
            ScreeningSet(
                user_id=user["id"],
                name="Raw",
                criteria_json=json.dumps(criteria),
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="now",
            )
        )
        session.commit()
    provider(FakeProvider(partial_symbols=("BBB",)))
    body = client.post("/screen/run").json()
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]  # pe disabled, raw passes
    assert body["failed_details"] == [{"symbol": "BBB", "failed": ["currentRatio"]}]


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


def test_screen_rerun_same_day_makes_no_fundamentals_calls(client, sign_in, provider, test_db):
    """Second run the same day finds a current snapshot for every symbol."""
    sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD})
    provider(p)

    client.post("/screen/run")
    p.calls.clear()
    body = client.post("/screen/run").json()

    assert p.calls == []
    assert body["failed_count"] == 0


def test_run_stores_active_set_id(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())
    active = client.get("/screen/sets").json()[0]

    client.post("/screen/run")

    with test_db() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
    assert run.set_id == active["id"]


def test_latest_scoped_to_active_set(client, sign_in, provider):
    sign_in()
    provider(FakeProvider())
    first = client.post("/screen/run").json()

    client.post("/screen/sets", json={"name": "Momentum"})  # becomes active, no run yet
    assert client.get("/screen/latest").status_code == 404

    second = client.post("/screen/run").json()
    latest = client.get("/screen/latest").json()
    assert latest["run_id"] == second["run_id"]
    assert latest["run_id"] != first["run_id"]


def test_delete_screen_keeps_runs_unstamped(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeProvider())
    client.post("/screen/sets", json={"name": "Momentum"})  # active
    client.post("/screen/run")
    with test_db() as session:
        momentum = session.query(ScreeningSet).filter_by(name="Momentum").one()
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
        assert run.set_id == momentum.id
        momentum_id = momentum.id

    assert client.delete(f"/screen/sets/{momentum_id}").status_code == 204

    with test_db() as session:
        runs = session.query(ScreenRun).all()
    assert runs and all(r.set_id is None for r in runs)


def test_run_uses_the_updated_active_set(client, sign_in, provider):
    sign_in()
    provider(FakeProvider())  # AAA pe=20 passes, BBB pe=80 fails
    created = client.post(
        "/screen/sets",
        json={"name": "Tight", "criteria": [{"key": "pe", "enabled": True, "value": 15}]},
    ).json()
    assert client.post("/screen/run").json()["shortlisted"] == []

    client.put(
        f"/screen/sets/{created['id']}",
        json={"criteria": [{"key": "pe", "enabled": True, "value": 25}]},
    )
    assert [r["symbol"] for r in client.post("/screen/run").json()["shortlisted"]] == ["AAA"]



