"""Service-level tests for Phase 1.8 run jobs (no HTTP)."""

import json
from datetime import date

from app.db.models import CompanyProfile, Fundamental, RunJob, RunJobItem, ScreenRun, Stock
from app.screener import service
from app.screener.criteria import default_criteria

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}
STORED_DATE = "2026-09-26"


class MapProvider:
    """Fixed 3-stock universe; ``fundamentals()`` logs calls (stored-snapshot
    tests assert it is never hit), provider objects are passed directly."""

    def __init__(self, data=None, fail=(), stale=False):
        self.data = data or {}
        self.fail = set(fail)
        self.stale = stale
        self.calls: list[str] = []

    def list_stocks(self):
        return [
            {"symbol": "AAA", "name": "Alpha", "sector": "IT", "market_cap": None},
            {"symbol": "BBB", "name": "Beta", "sector": "Bank", "market_cap": None},
            {"symbol": "CCC", "name": "Gamma", "sector": "FMCG", "market_cap": None},
        ]

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
