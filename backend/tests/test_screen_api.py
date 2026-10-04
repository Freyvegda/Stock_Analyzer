import json
from datetime import date

import httpx
import pytest

from app.api import screen as screen_api
from app.db.models import (
    Fundamental,
    RunJob,
    RunJobItem,
    ScreeningSet,
    ScreenRun,
    Stock,
)
from app.screener import service
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


def finish_run(test_db, user_id: int) -> None:
    """Simulate the stubbed worker finishing its latest running job: done + unregistered."""
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
    service.unregister_active_job(job_id)


def test_run_uses_caller_criteria_and_stores_snapshot(client, sign_in, provider, test_db):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}])
    provider(FakeProvider())

    body = client.post("/screen/run").json()["run"]
    assert body["total"] == 3
    assert body["failed_count"] == 0 and body["failed_symbols"] == []
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]
    assert body["failed_details"] == [{"symbol": "BBB", "failed": ["pe"]}]
    with test_db() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
        assert run.user_id == user["id"]
        assert json.loads(run.criteria_json) == [
            {**criterion, "bookmarked": False} for criterion in default_criteria()
        ]


def test_run_returns_cached_run_and_job(client, sign_in, provider, test_db):
    sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}])
    p = provider(MapProvider(data={}))

    response = client.post("/screen/run")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [r["symbol"] for r in body["run"]["shortlisted"]] == ["AAA"]
    assert body["run"]["stale"] is True  # stored rows are not from today
    assert body["job"]["status"] == "running"
    active = client.get("/screen/sets").json()[0]
    item = next(i for i in body["job"]["items"] if i["set_id"] == active["id"])
    assert item["status"] == "done"
    assert item["run_id"] == body["run"]["run_id"]
    assert p.calls == []


def test_second_run_while_running_409(client, sign_in, provider, test_db):
    user = sign_in()
    provider(FakeProvider())
    active = client.get("/screen/sets").json()[0]
    with test_db() as session:
        job = RunJob(
            user_id=user["id"], set_id=active["id"], started_at="now", status="running"
        )
        session.add(job)
        session.flush()
        session.add(RunJobItem(job_id=job.id, set_id=active["id"], status="queued"))
        session.commit()
        seeded_id = job.id

    service.register_active_job(seeded_id)
    try:
        response = client.post("/screen/run")
    finally:
        service.unregister_active_job(seeded_id)

    assert response.status_code == 409
    body = response.json()
    assert body["detail"] == "Run already in progress"
    assert body["job_id"] == seeded_id


def test_second_run_while_refreshing_409(client, sign_in, provider, test_db):
    """R6: a running job blocks even when every item is already done (single screen)."""
    sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    provider(MapProvider(data={}))

    first = client.post("/screen/run").json()
    assert first["job"]["items"][0]["status"] == "done"  # active item served instantly

    second = client.post("/screen/run")
    assert second.status_code == 409
    assert second.json() == {
        "detail": "Run already in progress",
        "job_id": first["job"]["id"],
    }


def test_jobs_latest_null_when_never_ran_and_shape_after_run(client, sign_in, provider, test_db):
    sign_in()
    assert client.get("/screen/jobs/latest").json() == {"job": None}

    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    provider(MapProvider(data={}))
    body = client.post("/screen/run").json()
    latest = client.get("/screen/jobs/latest").json()["job"]
    assert latest["id"] == body["job"]["id"]
    assert latest["status"] == "running"
    assert {item["status"] for item in latest["items"]} == {"done"}
    assert latest["items"][0]["run_id"] == body["run"]["run_id"]


def test_submit_failure_unregisters_job(client, sign_in, provider, test_db, monkeypatch):
    """A submit explosion must not wedge the account: the job sweeps to interrupted."""
    sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    provider(MapProvider(data={}))

    def boom(*args, **kwargs):
        raise RuntimeError("executor refused")

    monkeypatch.setattr(screen_api.runner, "submit_job", boom)
    with pytest.raises(RuntimeError, match="executor refused"):
        client.post("/screen/run")

    latest = client.get("/screen/jobs/latest").json()["job"]
    assert latest["status"] == "interrupted"
    assert latest["finished_at"] is not None


def test_latest_is_per_user(client, sign_in, provider, test_db):
    a = sign_in("alice")
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
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
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
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
    body = client.post("/screen/run").json()["run"]
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
    seed_stored(
        test_db,
        [
            {"symbol": "AAA", **GOOD, "raw": {"currentRatio": 1.8}},
            {"symbol": "BBB", **BAD, "raw": {"currentRatio": 1.0}},
        ],
    )
    provider(FakeProvider())
    body = client.post("/screen/run").json()["run"]
    assert [r["symbol"] for r in body["shortlisted"]] == ["AAA"]  # pe disabled, raw passes
    assert body["failed_details"] == [{"symbol": "BBB", "failed": ["currentRatio"]}]


def test_stale_provider_flagged(client, sign_in, provider):
    sign_in()
    provider(FakeProvider(stale=True))
    assert client.post("/screen/run").json()["run"]["stale"] is True


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
    assert client.get("/screen/jobs/latest").status_code == 401


def test_screen_rerun_same_day_makes_no_fundamentals_calls(client, sign_in, provider, test_db):
    """Second run the same day finds a current snapshot for every symbol."""
    user = sign_in()
    seed_stored(
        test_db,
        [
            {"symbol": "AAA", **GOOD},
            {"symbol": "BBB", **BAD},
            {"symbol": "CCC", **GOOD},
        ],
        date_iso=date.today().isoformat(),
    )
    p = provider(MapProvider(data={}))

    client.post("/screen/run")
    finish_run(test_db, user["id"])  # stubbed worker: simulate completion before rerun
    p.calls.clear()
    body = client.post("/screen/run").json()["run"]

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


def test_latest_scoped_to_active_set(client, sign_in, provider, test_db):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    provider(FakeProvider())
    first = client.post("/screen/run").json()["run"]
    finish_run(test_db, user["id"])

    client.post("/screen/sets", json={"name": "Momentum"})  # becomes active, no run yet
    assert client.get("/screen/latest").status_code == 404

    second = client.post("/screen/run").json()["run"]
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


def test_run_uses_the_updated_active_set(client, sign_in, provider, test_db):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    provider(FakeProvider())  # stored AAA pe=20 passes only the wider gate
    created = client.post(
        "/screen/sets",
        json={"name": "Tight", "criteria": [{"key": "pe", "enabled": True, "value": 15}]},
    ).json()
    assert client.post("/screen/run").json()["run"]["shortlisted"] == []
    finish_run(test_db, user["id"])

    client.put(
        f"/screen/sets/{created['id']}",
        json={"criteria": [{"key": "pe", "enabled": True, "value": 25}]},
    )
    assert [r["symbol"] for r in client.post("/screen/run").json()["run"]["shortlisted"]] == ["AAA"]


def test_run_returns_extra_runs_and_stores_auto_rows(client, sign_in, provider, test_db):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}])
    provider(FakeProvider())
    default = client.get("/screen/sets").json()[0]
    quality = client.post("/screen/sets", json={"name": "Quality"}).json()  # becomes active
    with test_db() as session:
        session.add(
            ScreenRun(
                run_date="2026-10-01",
                user_id=user["id"],
                set_id=quality["id"],
                triggered_by="manual",
                criteria_json="[]",
                shortlisted_json="[]",
            )
        )
        session.commit()
    client.post(f"/screen/sets/{default['id']}/activate")

    body = client.post("/screen/run").json()

    assert [extra["name"] for extra in body["extra_runs"]] == ["Quality"]
    extra = body["extra_runs"][0]
    assert extra["run_id"] is not None and extra["shortlisted"] == 1 and extra["error"] is None
    assert [r["symbol"] for r in body["run"]["shortlisted"]] == ["AAA"]
    with test_db() as session:
        runs = session.query(ScreenRun).order_by(ScreenRun.id).all()
    assert [(run.set_id, run.triggered_by) for run in runs] == [
        (quality["id"], "manual"),
        (default["id"], "manual"),
        (quality["id"], "auto"),
    ]


