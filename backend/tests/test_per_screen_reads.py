"""Per-screen reads + bounded screen_runs (RED first, TDD)."""

import json

from app.api import screen as screen_api
from app.api import stocks as stocks_api
from app.db.models import RunJob, ScreeningSet, ScreenRun, Stock, Fundamental
from app.screener import service as screener_service

GOOD = {"pe": 20.0, "pb": 3.0, "roe": 25.0, "roce": 25.0, "debt_to_equity": 0.2, "market_cap": 5000.0}
BAD = {"pe": 80.0, "pb": 12.0, "roe": 5.0, "roce": 5.0, "debt_to_equity": 2.0, "market_cap": 100.0}
STORED_DATE = "2026-09-26"


class FakeProvider:
    stale = False

    def list_stocks(self):
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

    def fundamentals(self, symbol, cached=None):
        if symbol == "CCC":
            raise RuntimeError("fetch failed for CCC")
        data = GOOD if symbol == "AAA" else BAD
        return {"symbol": symbol, **data, "raw": {"src": "fake"}}


def _use_providers(monkeypatch):
    monkeypatch.setattr(screen_api, "get_provider", lambda: FakeProvider())
    monkeypatch.setattr(stocks_api, "get_provider", lambda: FakeProvider())


def _seed_stored(test_db):
    with test_db() as session:
        for symbol, data in (("AAA", GOOD), ("BBB", BAD)):
            session.merge(
                Stock(symbol=symbol, name=f"{symbol} Ltd", sector="IT", market_cap=data["market_cap"])
            )
            session.merge(
                Fundamental(
                    symbol=symbol,
                    date=STORED_DATE,
                    pe=data["pe"],
                    pb=data["pb"],
                    roe=data["roe"],
                    roce=data["roce"],
                    debt_to_equity=data["debt_to_equity"],
                    data_status="ok",
                    raw_json=json.dumps({}),
                )
            )
        session.commit()


def _finish_job(test_db, user_id: int) -> None:
    with test_db() as session:
        job = (
            session.query(RunJob)
            .filter(RunJob.user_id == user_id, RunJob.status == "running")
            .order_by(RunJob.id.desc())
            .first()
        )
        if job is None:
            return
        job.status = "done"
        job.finished_at = "done"
        session.commit()
        job_id = job.id
    screener_service.unregister_active_job(job_id)


def test_latest_set_id_returns_non_active_screen_run(client, sign_in, test_db, monkeypatch):
    _use_providers(monkeypatch)
    user = sign_in()
    _seed_stored(test_db)
    default_id = client.get("/screen/sets").json()[0]["id"]
    first_run = client.post("/screen/run").json()["run"]["run_id"]
    _finish_job(test_db, user["id"])

    momentum = client.post("/screen/sets", json={"name": "Momentum"}).json()
    second_run = client.post("/screen/run").json()["run"]["run_id"]
    assert second_run != first_run

    body = client.get(f"/screen/latest?set_id={default_id}").json()
    # The Momentum batch also re-evaluated Default as an auto extra, so the
    # latest Default run may be newer than first_run — scoping is what matters.
    assert body["run_id"] != second_run
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]

    active_latest = client.get("/screen/latest").json()
    assert active_latest["run_id"] == second_run


def test_latest_set_id_404_for_unknown_or_foreign_set(client, sign_in, test_db, monkeypatch):
    _use_providers(monkeypatch)
    sign_in("alice")
    assert client.get("/screen/latest?set_id=999999").status_code == 404

    with test_db() as session:
        bob_sets = session.query(ScreeningSet).all()
    # alice owns Default; create second user and read their set id
    sign_in("bob")
    bob_default = client.get("/screen/sets").json()[0]["id"]
    sign_in("alice")
    assert client.get(f"/screen/latest?set_id={bob_default}").status_code == 404
    assert bob_sets is not None


def test_stocks_set_id_verdicts_differ_per_screen(client, sign_in, test_db, monkeypatch):
    _use_providers(monkeypatch)
    sign_in()
    _seed_stored(test_db)
    default_id = client.get("/screen/sets").json()[0]["id"]
    client.put(
        f"/screen/sets/{default_id}",
        json={"criteria": [{"key": "pe", "enabled": True, "value": 25}]},
    )
    tight = client.post(
        "/screen/sets",
        json={"name": "Tight", "criteria": [{"key": "pe", "enabled": True, "value": 15}]},
    ).json()

    wide = {r["symbol"]: r for r in client.get(f"/stocks?set_id={default_id}").json()["rows"]}
    narrow = {r["symbol"]: r for r in client.get(f"/stocks?set_id={tight['id']}").json()["rows"]}

    assert wide["AAA"]["verdict"] == "pass"
    assert narrow["AAA"]["verdict"] == "fail"
    assert wide["AAA"]["pe"] == narrow["AAA"]["pe"] == 20.0


def test_stocks_set_id_404_for_foreign_set(client, sign_in, test_db, monkeypatch):
    _use_providers(monkeypatch)
    sign_in("alice")
    monkeypatch.setattr(stocks_api, "get_provider", lambda: FakeProvider())
    sign_in("bob")
    bob_default = client.get("/screen/sets").json()[0]["id"]
    sign_in("alice")
    assert client.get(f"/stocks?set_id={bob_default}").status_code == 404


def test_screen_runs_pruned_to_bounded_history(client, sign_in, test_db, monkeypatch):
    _use_providers(monkeypatch)
    user = sign_in()
    _seed_stored(test_db)
    default_id = client.get("/screen/sets").json()[0]["id"]
    with test_db() as session:
        for i in range(25):
            session.add(
                ScreenRun(
                    run_date="2026-09-01",
                    user_id=user["id"],
                    set_id=default_id,
                    triggered_by="manual",
                    criteria_json="[]",
                    shortlisted_json="[]",
                )
            )
        session.commit()
    client.post("/screen/run")
    with test_db() as session:
        count = (
            session.query(ScreenRun)
            .filter(ScreenRun.user_id == user["id"], ScreenRun.set_id == default_id)
            .count()
        )
    assert count <= 20
