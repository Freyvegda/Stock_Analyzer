"""Service-level tests for Phase 1.8 run jobs (no HTTP)."""

import json
import logging
from datetime import date

from app.db.models import (
    CompanyProfile,
    Fundamental,
    RunJob,
    RunJobItem,
    ScreeningSet,
    ScreenRun,
    Stock,
)
from app.screener import runner, service
from app.screener.criteria import default_criteria

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
STORED_DATE = "2026-09-26"


class MapProvider:
    """Fixed 3-stock universe; ``fundamentals()`` logs calls (stored-snapshot
    tests assert it is never hit), provider objects are passed directly."""

    def __init__(self, data=None, fail=(), stale=False, universe=None):
        self.data = data or {}
        self.fail = set(fail)
        self.stale = stale
        self.universe = universe
        self.calls: list[str] = []
        self.cached_payloads: dict[str, dict | None] = {}

    def list_stocks(self):
        if self.universe is not None:
            return self.universe
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

    def fundamentals(self, symbol, cached=None):
        self.calls.append(symbol)
        self.cached_payloads[symbol] = cached
        if symbol in self.fail:
            raise RuntimeError(f"fetch failed for {symbol}")
        return {"symbol": symbol, **self.data[symbol], "raw": self.data[symbol].get("raw", {"src": "fake"})}


class DeadFundamentalsProvider(MapProvider):
    """Every ``fundamentals()`` call fails, like Yahoo throttling the whole batch."""

    def fundamentals(self, symbol, cached=None):
        self.calls.append(symbol)
        self.cached_payloads[symbol] = cached
        raise RuntimeError("yfinance unavailable")


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


def get_item(test_db, job_id, set_id):
    """Flat view of one job item, detached from the session."""
    with test_db() as session:
        row = (
            session.query(RunJobItem)
            .filter(RunJobItem.job_id == job_id, RunJobItem.set_id == set_id)
            .one()
        )
        return {
            "status": row.status,
            "run_id": row.run_id,
            "error": row.error,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
        }


def job_row(test_db, job_id):
    """Flat view of one job row, detached from the session."""
    with test_db() as session:
        row = session.get(RunJob, job_id)
        return {
            "status": row.status,
            "error": row.error,
            "finished_at": row.finished_at,
            "universe_total": row.universe_total,
            "universe_done": row.universe_done,
            "universe_failed": row.universe_failed,
        }


def run_job(test_db, user, provider, set_id=None):
    """Create a job for the active (or given) set and execute it synchronously."""
    if set_id is None:
        set_id = service.get_active_set(test_db, user["id"])["id"]
    job_id = service.create_job(test_db, user["id"], set_id)["id"]
    runner.execute_job(job_id, provider, test_db)
    return job_id


def test_create_job_creates_item_per_set_active_first(test_db, sign_in):
    user = sign_in()
    default = service.list_sets(test_db, user["id"])[0]  # seeds "Default"
    active = service.create_set(test_db, user["id"], "Quality", None, None)

    job = service.create_job(test_db, user["id"], active["id"])

    assert job["status"] == "running"
    assert job["set_id"] == active["id"]
    assert job["started_at"]
    assert job["finished_at"] is None
    assert job["error"] is None
    assert (job["universe_total"], job["universe_done"], job["universe_failed"]) == (0, 0, 0)
    assert [item["set_id"] for item in job["items"]] == [active["id"], default["id"]]
    assert job["items"][0]["name"] == "Quality"
    assert {item["status"] for item in job["items"]} == {"queued"}
    assert {item["run_id"] for item in job["items"]} == {None}
    with test_db() as session:
        assert session.query(RunJobItem).filter_by(job_id=job["id"]).count() == 2


def test_create_job_prunes_to_keep_jobs(test_db, sign_in):
    user = sign_in()
    created = service.create_set(test_db, user["id"], "Quality", None, None)
    job_ids = [
        service.create_job(test_db, user["id"], created["id"])["id"]
        for _ in range(service.KEEP_JOBS + 1)
    ]

    with test_db() as session:
        remaining = [
            row.id
            for row in session.query(RunJob)
            .filter(RunJob.user_id == user["id"])
            .order_by(RunJob.id.asc())
            .all()
        ]
        assert len(remaining) == service.KEEP_JOBS
        assert session.query(RunJobItem).filter_by(job_id=job_ids[0]).count() == 0
    assert job_ids[0] not in remaining
    assert job_ids[-1] in remaining


def test_latest_job_marks_running_as_interrupted(test_db, sign_in):
    user = sign_in()
    created = service.create_set(test_db, user["id"], "Quality", None, None)
    job = service.create_job(test_db, user["id"], created["id"])

    latest = service.latest_job(test_db, user["id"])

    assert latest["id"] == job["id"]
    assert latest["status"] == "interrupted"
    assert latest["finished_at"] is not None
    assert service.busy_set_ids(test_db, user["id"]) == set()


def test_active_job_is_not_swept_as_interrupted(test_db, sign_in):
    user = sign_in()
    created = service.create_set(test_db, user["id"], "Quality", None, None)
    job_id = service.create_job(test_db, user["id"], created["id"])["id"]
    set_ids = {row["id"] for row in service.list_sets(test_db, user["id"])}

    service.register_active_job(job_id)
    try:
        assert service.latest_job(test_db, user["id"])["status"] == "running"
        assert service.busy_set_ids(test_db, user["id"]) == set_ids
    finally:
        service.unregister_active_job(job_id)

    assert service.latest_job(test_db, user["id"])["status"] == "interrupted"


def test_mark_item_sets_status_run_id_and_error(test_db, sign_in):
    user = sign_in()
    created = service.create_set(test_db, user["id"], "Quality", None, None)
    job = service.create_job(test_db, user["id"], created["id"])
    with test_db() as session:
        run = ScreenRun(
            run_date="2026-10-03",
            user_id=user["id"],
            set_id=created["id"],
            criteria_json="[]",
            shortlisted_json="[]",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

    service.mark_item(test_db, job["id"], created["id"], "running")
    item = get_item(test_db, job["id"], created["id"])
    assert item["status"] == "running"
    assert item["started_at"] is not None
    assert item["finished_at"] is None

    service.mark_item(test_db, job["id"], created["id"], "done", run_id=run_id)
    item = get_item(test_db, job["id"], created["id"])
    assert item["status"] == "done"
    assert item["run_id"] == run_id
    assert item["finished_at"] is not None

    service.mark_item(test_db, job["id"], created["id"], "failed", error="engine exploded")
    item = get_item(test_db, job["id"], created["id"])
    assert item["status"] == "failed"
    assert item["error"] == "engine exploded"


def test_latest_job_is_per_user(test_db, sign_in):
    alice = sign_in("alice")
    bob = sign_in("bob")
    alice_set = service.create_set(test_db, alice["id"], "A", None, None)
    bob_set = service.create_set(test_db, bob["id"], "B", None, None)

    alice_job = service.create_job(test_db, alice["id"], alice_set["id"])
    assert service.latest_job(test_db, bob["id"]) is None

    bob_job = service.create_job(test_db, bob["id"], bob_set["id"])
    assert service.latest_job(test_db, alice["id"])["id"] == alice_job["id"]
    assert service.latest_job(test_db, bob["id"])["id"] == bob_job["id"]


def test_projection_tolerates_deleted_set(test_db, sign_in):
    user = sign_in()
    service.list_sets(test_db, user["id"])
    doomed = service.create_set(test_db, user["id"], "Doomed", None, None)
    service.create_job(test_db, user["id"], doomed["id"])

    service.delete_set(test_db, user["id"], doomed["id"])
    latest = service.latest_job(test_db, user["id"])

    item = next(i for i in latest["items"] if i["set_id"] == doomed["id"])
    assert item["name"] == ""
    assert item["status"] == "queued"


# --- Stored-snapshot run + bulk persist (B4) ---------------------------------


def test_run_snapshot_screen_makes_no_fundamentals_calls(test_db, sign_in):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}])
    active = service.list_sets(test_db, user["id"])[0]
    p = MapProvider(data={})

    result = service.run_snapshot_screen(p, test_db, user, default_criteria(), 10, active["id"])

    assert p.calls == []
    assert [r["symbol"] for r in result["shortlisted"]] == ["AAA"]
    assert result["failed_count"] == 0
    assert result["failed_symbols"] == []
    assert result["stale"] is True
    assert result["total"] == 3
    assert result["failed_details"] == [
        {"symbol": "BBB", "failed": ["pe"]},
        {"symbol": "CCC", "failed": ["pe"]},
    ]
    with test_db() as session:
        runs = session.query(ScreenRun).all()
        assert len(runs) == 1
        assert runs[0].id == result["run_id"]
        assert runs[0].user_id == user["id"]
        assert runs[0].set_id == active["id"]
        assert runs[0].run_date == date.today().isoformat()
        assert json.loads(runs[0].criteria_json) == default_criteria()
        assert json.loads(runs[0].shortlisted_json) == result["shortlisted"]


def test_run_snapshot_screen_same_day_is_not_stale(test_db, sign_in):
    user = sign_in()
    seed_stored(
        test_db,
        [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}],
        date_iso=date.today().isoformat(),
    )
    active = service.list_sets(test_db, user["id"])[0]
    p = MapProvider(data={})

    result = service.run_snapshot_screen(p, test_db, user, default_criteria(), 10, active["id"])

    assert p.calls == []
    assert result["stale"] is False
    assert [r["symbol"] for r in result["shortlisted"]] == ["AAA"]
    assert result["shortlisted"][0]["data_date"] == date.today().isoformat()


def test_evaluate_stored_screen_reports_rejected_first_gate(test_db):
    today = date.today().isoformat()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}], date_iso=today)
    stocks = [
        {"symbol": "AAA", "name": "Alpha", "sector": "IT"},
        {"symbol": "BBB", "name": "Beta", "sector": "Bank"},
    ]

    with test_db() as session:
        shortlist, rejected, stale = service.evaluate_stored_screen(
            session, stocks, default_criteria(), 10, True, today
        )
        session.commit()
        assert session.get(Stock, "AAA").name == "Alpha"  # identity upserted

    assert [r["symbol"] for r in shortlist] == ["AAA"]
    assert rejected == [{"symbol": "BBB", "failed": ["pe"]}]
    assert stale is True  # provider_stale=True, even though rows are same-day


def test_persist_fetch_batch_overwrites_same_day(test_db):
    today = date.today().isoformat()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}], date_iso=today)
    fetched = {
        "symbol": "AAA",
        **{**GOOD, "pe": 12},
        "raw": {"src": "fake", "industry": "Oil & Gas", "fullTimeEmployees": 350000},
    }

    with test_db() as session:
        stock = session.get(Stock, "AAA")
        fresh_rows, failed_symbols = service.persist_fetch_batch(
            session, [({"symbol": "AAA", "name": "Alpha", "sector": "IT"}, fetched, None)], {"AAA": stock}, today
        )
        session.commit()

    assert failed_symbols == []
    assert fresh_rows["AAA"]["pe"] == 12 and fresh_rows["AAA"]["data_date"] == today
    with test_db() as session:
        rows = session.query(Fundamental).filter_by(symbol="AAA").all()
        assert len(rows) == 1  # same-day row updated, not duplicated
        assert rows[0].date == today and rows[0].pe == 12 and rows[0].data_status == "ok"
        profile = session.get(CompanyProfile, "AAA")
        assert profile.industry == "Oil & Gas"
        assert profile.employees == 350000
        assert profile.updated_at == today


def test_persist_fetch_batch_failed_keeps_same_day_ok(test_db):
    today = date.today().isoformat()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}], date_iso=today)

    with test_db() as session:
        stock = session.get(Stock, "AAA")
        fresh_rows, failed_symbols = service.persist_fetch_batch(
            session, [({"symbol": "AAA", "name": "Alpha", "sector": "IT"}, None, "boom")], {"AAA": stock}, today
        )
        session.commit()

    assert fresh_rows == {}
    assert failed_symbols == ["AAA"]
    with test_db() as session:
        rows = session.query(Fundamental).filter_by(symbol="AAA").all()
        assert len(rows) == 1  # no failed row added over the same-day ok row
        assert rows[0].data_status == "ok" and rows[0].pe == GOOD["pe"]
        assert session.get(Stock, "AAA").market_cap == float(GOOD["market_cap"])


def test_persist_fetch_batch_inserts_failed_without_ok_row(test_db):
    today = date.today().isoformat()
    with test_db() as session:
        session.add(Stock(symbol="AAA", name="Alpha", sector="IT", market_cap=5000))
        session.commit()
        stock = session.get(Stock, "AAA")
        fresh_rows, failed_symbols = service.persist_fetch_batch(
            session, [({"symbol": "AAA", "name": "Alpha", "sector": "IT"}, None, "yfinance unavailable")], {"AAA": stock}, today
        )
        session.commit()

    assert fresh_rows == {}
    assert failed_symbols == ["AAA"]
    with test_db() as session:
        row = session.get(Fundamental, ("AAA", today))
        assert row.data_status == "failed"
        assert json.loads(row.raw_json) == {"error": "yfinance unavailable"}
        assert session.get(Stock, "AAA").market_cap == 5000.0  # failed fetch never nulls it


# --- Worker: runner.execute_job (B5) ----------------------------------------


def test_execute_job_refreshes_stale_and_refines(test_db, sign_in):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    active = service.get_active_set(test_db, user["id"])
    p = MapProvider(
        data={"AAA": {**GOOD, "pe": 30}},
        universe=[{"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None}],
    )

    job_id = run_job(test_db, user, p, set_id=active["id"])

    job = job_row(test_db, job_id)
    assert job["status"] == "done" and job["error"] is None and job["finished_at"] is not None
    assert (job["universe_total"], job["universe_done"], job["universe_failed"]) == (1, 1, 0)
    assert p.calls == ["AAA"]
    assert p.cached_payloads["AAA"]["pe"] == GOOD["pe"]  # stored snapshot passed as cached=
    item = get_item(test_db, job_id, active["id"])
    assert item["status"] == "done" and item["run_id"] is not None
    latest = service.latest_screen(test_db, user["id"])  # reads ORDER BY id DESC
    assert latest["shortlisted"] == []  # refined on the fresh, PE-failing row
    with test_db() as session:
        row = session.get(Fundamental, ("AAA", date.today().isoformat()))
        assert row.data_status == "ok" and row.pe == 30


def test_execute_job_same_day_rerun_makes_no_calls(test_db, sign_in):
    user = sign_in()
    seed_stored(
        test_db,
        [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}],
        date_iso=date.today().isoformat(),
    )
    p = MapProvider(data={})

    job_id = run_job(test_db, user, p)

    assert p.calls == []
    assert job_row(test_db, job_id)["status"] == "done"
    latest = service.latest_screen(test_db, user["id"])
    assert [r["symbol"] for r in latest["shortlisted"]] == ["AAA"]


def test_execute_job_runs_every_saved_screen(test_db, sign_in):
    user = sign_in()
    default = service.list_sets(test_db, user["id"])[0]
    quality = service.create_set(test_db, user["id"], "Quality", None, None)
    seed_stored(
        test_db,
        [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}],
        date_iso=date.today().isoformat(),
    )
    p = MapProvider(data={})

    job_id = run_job(test_db, user, p, set_id=quality["id"])

    default_item = get_item(test_db, job_id, default["id"])
    quality_item = get_item(test_db, job_id, quality["id"])
    assert default_item["status"] == quality_item["status"] == "done"
    assert default_item["run_id"] is not None and quality_item["run_id"] is not None
    assert default_item["run_id"] != quality_item["run_id"]
    with test_db() as session:
        run_ids = {row.id for row in session.query(ScreenRun).all()}
    assert {default_item["run_id"], quality_item["run_id"]} <= run_ids


def test_job_done_when_every_fetch_fails(test_db, sign_in):
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}])
    p = DeadFundamentalsProvider()

    job_id = run_job(test_db, user, p)

    job = job_row(test_db, job_id)
    assert job["status"] == "done"
    assert (job["universe_total"], job["universe_done"], job["universe_failed"]) == (3, 0, 3)
    latest = service.latest_screen(test_db, user["id"])
    assert [r["symbol"] for r in latest["shortlisted"]] == ["AAA"]  # cached shortlist survives


def test_screen_failure_isolated(test_db, sign_in):
    user = sign_in()
    poison = service.create_set(test_db, user["id"], "Poison", None, None)
    quality = service.create_set(test_db, user["id"], "Quality", None, None)
    # Nested past json.loads' recursion limit: criteria_from_json cannot fall back,
    # so the poison screen raises in the worker's screen stage.
    deep = "[" * 2000 + "]" * 2000
    with test_db() as session:
        session.get(ScreeningSet, poison["id"]).criteria_json = deep
        session.commit()
    seed_stored(
        test_db,
        [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}],
        date_iso=date.today().isoformat(),
    )
    p = MapProvider(data={})

    job_id = run_job(test_db, user, p, set_id=quality["id"])

    poison_item = get_item(test_db, job_id, poison["id"])
    quality_item = get_item(test_db, job_id, quality["id"])
    assert poison_item["status"] == "failed" and poison_item["error"]
    assert quality_item["status"] == "done" and quality_item["run_id"] is not None
    assert job_row(test_db, job_id)["status"] == "done"


def test_global_failure_marks_job_failed(test_db, sign_in):
    user = sign_in()
    active = service.get_active_set(test_db, user["id"])

    class DeadListProvider:
        stale = False

        def list_stocks(self):
            raise RuntimeError("universe download refused")

    job_id = service.create_job(test_db, user["id"], active["id"])["id"]

    runner.execute_job(job_id, DeadListProvider(), test_db)

    job = job_row(test_db, job_id)
    assert job["status"] == "failed" and "universe download refused" in job["error"]
    assert job["finished_at"] is not None
    item = get_item(test_db, job_id, active["id"])
    assert item["status"] == "failed" and "universe download refused" in item["error"]


def test_refresh_order_puts_survivors_first(test_db, sign_in, monkeypatch):
    user = sign_in()
    seed_stored(
        test_db,
        [
            {"symbol": "AAA", **GOOD},
            {"symbol": "BBB", **{**BAD, "market_cap": 100}},
            {"symbol": "CCC", **{**BAD, "market_cap": 200}},
        ],
    )
    p = MapProvider(data={"AAA": GOOD, "BBB": GOOD, "CCC": GOOD})
    monkeypatch.setattr(runner, "WORKERS", 1)  # single worker: call order == queue order

    run_job(test_db, user, p)

    assert p.calls[0] == "AAA"  # stored-snapshot survivor refines first
    assert p.calls[1:] == ["CCC", "BBB"]  # rest by descending market cap


# --- Fetch semantics migrated from test_screen_api.py (B5) ------------------


def test_failed_fetch_persisted_and_market_cap_preserved(test_db, sign_in):
    user = sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD})  # CCC fails
    run_job(test_db, user, p)
    # CCC is retried on the same-day rerun (a failed row is not an ok snapshot).
    same_day = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD}, fail=("AAA", "CCC"))
    run_job(test_db, user, same_day)
    with test_db() as session:
        assert session.get(Stock, "AAA").market_cap == 5000.0
        assert session.get(Fundamental, ("CCC", date.today().isoformat())).data_status == "failed"
    assert same_day.calls == ["CCC"]  # AAA/BBB have today's ok snapshot


def test_run_twice_same_day_is_idempotent(test_db, sign_in):
    user = sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD})
    run_job(test_db, user, p)
    p.calls.clear()
    run_job(test_db, user, p)
    with test_db() as session:
        assert session.query(ScreenRun).count() == 2
        assert session.query(Fundamental).count() == 3
    assert p.calls == []


def test_screen_run_refreshes_every_stale_symbol(test_db, sign_in):
    """Survivor-only fetching is gone: every stale symbol lands in the shared DB."""
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **GOOD}])
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD})

    run_job(test_db, user, p)

    assert sorted(p.calls) == ["AAA", "BBB", "CCC"]  # BBB lost the PE gate but is still refreshed
    latest = service.latest_screen(test_db, user["id"])
    assert {r["symbol"] for r in latest["shortlisted"]} == {"AAA", "CCC"}


def test_stale_reject_passing_fresh_is_not_reported_failed(test_db, sign_in):
    """A symbol rejected on the stored snapshot but passing fresh must be in the
    refined shortlist, not reported failed."""
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **GOOD}])
    p = MapProvider(data={"AAA": GOOD, "BBB": GOOD, "CCC": GOOD})

    run_job(test_db, user, p)

    latest = service.latest_screen(test_db, user["id"])
    assert {r["symbol"] for r in latest["shortlisted"]} == {"AAA", "BBB", "CCC"}


def test_screen_run_writes_company_profiles(test_db, sign_in):
    user = sign_in()
    raw = {
        "src": "fake",
        "longBusinessSummary": "Makes things",
        "industry": "Oil & Gas",
        "fullTimeEmployees": 350000,
    }
    p = MapProvider(
        data={
            "AAA": {**GOOD, "raw": raw},
            "BBB": {**BAD, "raw": raw},
            "CCC": {**GOOD, "raw": raw},
        }
    )

    run_job(test_db, user, p)

    with test_db() as session:
        profiles = {row.symbol: row for row in session.query(CompanyProfile).all()}
    assert sorted(profiles) == ["AAA", "BBB", "CCC"]
    assert profiles["AAA"].industry == "Oil & Gas"
    assert profiles["AAA"].employees == 350000


def test_first_run_fetches_whole_universe_when_nothing_stored(test_db, sign_in):
    user = sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD})

    job_id = run_job(test_db, user, p)

    assert sorted(p.calls) == ["AAA", "BBB", "CCC"]
    job = job_row(test_db, job_id)
    assert (job["universe_total"], job["universe_done"], job["universe_failed"]) == (3, 3, 0)


def test_failed_refresh_keeps_same_day_ok_row(test_db, sign_in):
    """Same-day ok snapshot must survive a failed refresh in the job path too."""
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}], date_iso=date.today().isoformat())
    p = DeadFundamentalsProvider()

    run_job(test_db, user, p)

    latest = service.latest_screen(test_db, user["id"])
    assert [r["symbol"] for r in latest["shortlisted"]] == ["AAA"]
    with test_db() as session:
        row = session.get(Fundamental, ("AAA", date.today().isoformat()))
        assert row.data_status == "ok" and row.pe == GOOD["pe"]


def test_refreshed_values_override_stored_snapshot(test_db, sign_in):
    """A passer is re-checked on fresh data; a regressed fresh PE cuts it."""
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}])
    p = MapProvider(data={"AAA": {**GOOD, "pe": 30}, "BBB": BAD, "CCC": BAD})

    run_job(test_db, user, p)

    latest = service.latest_screen(test_db, user["id"])
    assert latest["shortlisted"] == []
    with test_db() as session:
        row = session.get(Fundamental, ("AAA", date.today().isoformat()))
        assert row.data_status == "ok" and row.pe == 30


def test_stored_snapshot_keeps_screen_alive_when_refresh_fails(test_db, sign_in):
    """Bug repro: yfinance down must not empty the screen when a snapshot exists."""
    user = sign_in()
    seed_stored(test_db, [{"symbol": "AAA", **GOOD}, {"symbol": "BBB", **BAD}, {"symbol": "CCC", **BAD}])
    p = DeadFundamentalsProvider()

    job_id = run_job(test_db, user, p)

    latest = service.latest_screen(test_db, user["id"])
    assert [r["symbol"] for r in latest["shortlisted"]] == ["AAA"]
    assert latest["shortlisted"][0]["data_date"] == STORED_DATE
    assert job_row(test_db, job_id)["universe_failed"] == 3


def test_failed_fetch_logs_warning(test_db, sign_in, caplog):
    user = sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD})  # CCC fails

    with caplog.at_level(logging.WARNING):
        run_job(test_db, user, p)

    assert "CCC" in caplog.text


def test_screen_rerun_same_day_makes_no_fundamentals_calls(test_db, sign_in):
    """Second job the same day finds a current snapshot for every symbol."""
    user = sign_in()
    p = MapProvider(data={"AAA": GOOD, "BBB": BAD, "CCC": GOOD})

    run_job(test_db, user, p)
    p.calls.clear()
    run_job(test_db, user, p)

    assert p.calls == []
