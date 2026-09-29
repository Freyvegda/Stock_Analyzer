"""`GET /stocks` — lazy universe seeding, shared ratios, per-user verdicts."""

import json
from datetime import date

import httpx
import pytest

from app.api import stocks as stocks_api
from app.db.models import Fundamental, ScreeningSet, Stock

STORED_DATE = "2026-09-26"
OLDER_DATE = "2026-09-24"

GOOD = {"pe": 20.0, "pb": 3.0, "roe": 25.0, "roce": 25.0, "debt_to_equity": 0.2, "market_cap": 5000.0}
BAD = {"pe": 80.0, "pb": 12.0, "roe": 5.0, "roce": 5.0, "debt_to_equity": 2.0, "market_cap": 100.0}


class FakeUniverseProvider:
    def __init__(self, fail=False):
        self.stale = False
        self.fail = fail
        self.list_calls = 0

    def list_stocks(self):
        self.list_calls += 1
        if self.fail:
            raise httpx.ConnectError("nifty500 download refused")
        return [
            {"symbol": "AAA", "name": "Alpha Ltd", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta Ltd", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma Ltd", "sector": "FMCG", "market_cap": None},
        ]


def seed_stock(test_db, symbol: str, market_cap: float | None = None) -> None:
    with test_db() as session:
        session.merge(Stock(symbol=symbol, name=f"{symbol} Ltd", sector="IT", market_cap=market_cap))
        session.commit()


def seed_fundamental(test_db, symbol: str, data: dict, date_iso: str = STORED_DATE) -> None:
    with test_db() as session:
        session.merge(
            Fundamental(
                symbol=symbol,
                date=date_iso,
                pe=data.get("pe"),
                pb=data.get("pb"),
                roe=data.get("roe"),
                roce=data.get("roce"),
                debt_to_equity=data.get("debt_to_equity"),
                data_status="ok",
                raw_json=json.dumps({"src": "seeded"}),
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


@pytest.fixture
def provider(monkeypatch):
    def _use(p: FakeUniverseProvider) -> FakeUniverseProvider:
        monkeypatch.setattr(stocks_api, "get_provider", lambda: p)
        return p

    return _use


def test_stocks_require_auth(client, test_db):
    assert client.get("/stocks").status_code == 401


def test_universe_lazy_seeds_stocks_once(client, sign_in, provider, test_db):
    sign_in()
    p = provider(FakeUniverseProvider())

    first = client.get("/stocks").json()
    second = client.get("/stocks").json()

    assert p.list_calls == 1  # seeded once; second read is pure DB
    assert first["total"] == 3 and [r["symbol"] for r in first["rows"]] == ["AAA", "BBB", "CCC"]
    assert first["as_of"] is None  # no fundamentals stored yet
    assert all(r["verdict"] == "no_data" for r in first["rows"])
    assert second["total"] == 3
    with test_db() as session:
        assert session.query(Stock).count() == 3


def test_universe_verdict_is_per_user(client, sign_in, provider, test_db):
    seed_stock(test_db, "AAA", market_cap=5000.0)
    seed_stock(test_db, "BBB", market_cap=100.0)
    seed_fundamental(test_db, "AAA", GOOD)
    seed_fundamental(test_db, "BBB", BAD)
    alice = sign_in("alice")
    seed_criteria(test_db, alice["id"], [{"key": "pe", "enabled": True, "value": 25.0}])
    provider(FakeUniverseProvider())

    alice_rows = {r["symbol"]: r for r in client.get("/stocks").json()["rows"]}

    bob = sign_in("bob")
    seed_criteria(test_db, bob["id"], [{"key": "pe", "enabled": True, "value": 5.0}])
    bob_rows = {r["symbol"]: r for r in client.get("/stocks").json()["rows"]}

    assert alice_rows["AAA"]["verdict"] == "pass"
    assert alice_rows["BBB"]["verdict"] == "fail"
    assert bob_rows["AAA"]["verdict"] == "fail"
    assert alice_rows["AAA"]["pe"] == bob_rows["AAA"]["pe"] == 20.0
    assert alice_rows["BBB"]["pe"] == bob_rows["BBB"]["pe"] == 80.0


def test_no_data_verdict(client, sign_in, provider, test_db):
    seed_stock(test_db, "AAA", market_cap=5000.0)
    seed_stock(test_db, "BBB", market_cap=100.0)
    seed_fundamental(test_db, "AAA", GOOD)
    user = sign_in()
    seed_criteria(test_db, user["id"], [{"key": "pe", "enabled": True, "value": 25.0}])
    provider(FakeUniverseProvider())

    rows = {r["symbol"]: r for r in client.get("/stocks").json()["rows"]}

    assert rows["AAA"]["verdict"] == "pass"
    assert rows["BBB"]["verdict"] == "no_data"
    assert rows["BBB"]["passes"] == 0 and rows["BBB"]["enabled"] == 1
    assert rows["BBB"]["data_date"] is None


def test_passes_and_enabled_counts_and_as_of(client, sign_in, provider, test_db):
    seed_stock(test_db, "AAA", market_cap=5000.0)
    seed_stock(test_db, "BBB", market_cap=100.0)
    seed_fundamental(test_db, "AAA", GOOD, date_iso=STORED_DATE)
    seed_fundamental(test_db, "BBB", BAD, date_iso=OLDER_DATE)
    user = sign_in()
    seed_criteria(
        test_db,
        user["id"],
        [
            {"key": "pe", "enabled": True, "value": 25.0},
            {"key": "roe", "enabled": True, "value": 20.0},
        ],
    )
    provider(FakeUniverseProvider())

    body = client.get("/stocks").json()
    rows = {r["symbol"]: r for r in body["rows"]}

    assert body["as_of"] == STORED_DATE
    assert rows["AAA"]["passes"] == 2 and rows["AAA"]["enabled"] == 2 and rows["AAA"]["verdict"] == "pass"
    assert rows["BBB"]["passes"] == 0 and rows["BBB"]["enabled"] == 2 and rows["BBB"]["verdict"] == "fail"
    assert rows["AAA"]["data_date"] == STORED_DATE
    assert rows["BBB"]["data_date"] == OLDER_DATE


def test_universe_all_disabled_criteria_falls_back_to_defaults(client, sign_in, provider, test_db):
    """`criteria_from_json` forbids an all-disabled set: stored tampered criteria
    resolve to the Phase-1 defaults (6 enabled) instead of silently disabling the gate."""
    seed_stock(test_db, "AAA", market_cap=5000.0)
    seed_stock(test_db, "BBB", market_cap=100.0)
    seed_fundamental(test_db, "AAA", GOOD)
    user = sign_in()
    seed_criteria(test_db, user["id"], [{"key": "pe", "enabled": False, "value": 25.0}])
    provider(FakeUniverseProvider())

    rows = {r["symbol"]: r for r in client.get("/stocks").json()["rows"]}

    assert rows["AAA"]["enabled"] == 6  # defaults, not the tampered payload
    assert rows["AAA"]["verdict"] == "pass"  # GOOD satisfies every default criterion
    assert rows["BBB"]["verdict"] == "no_data"  # no stored data is still no_data


def test_stocks_list_includes_ratios_and_market_cap(client, sign_in, provider, test_db):
    seed_stock(test_db, "AAA", market_cap=5000.0)
    seed_fundamental(test_db, "AAA", GOOD)
    sign_in()
    provider(FakeUniverseProvider())

    row = client.get("/stocks").json()["rows"][0]

    assert row["market_cap"] == 5000.0
    assert (row["pe"], row["pb"], row["roe"], row["roce"], row["debt_to_equity"]) == (
        20.0, 3.0, 25.0, 25.0, 0.2,
    )


def test_universe_seeding_upstream_failure_is_502(client, sign_in, provider, test_db):
    sign_in()
    provider(FakeUniverseProvider(fail=True))

    res = client.get("/stocks")

    assert res.status_code == 502
    assert "nifty500 download refused" in res.json()["detail"]
