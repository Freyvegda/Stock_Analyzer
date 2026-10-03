"""Phase 1.8 — multi-screen batch service tests (no HTTP)."""

from app.auth.service import create_user
from app.db.models import ScreenRun
from app.screener import service


def seed_run(test_db, user_id, set_id, *, triggered_by="manual"):
    with test_db() as session:
        run = ScreenRun(
            run_date="2026-10-03",
            user_id=user_id,
            set_id=set_id,
            triggered_by=triggered_by,
            criteria_json="[]",
            shortlisted_json="[]",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return run.id


def make_set(test_db, user_id, name):
    return service.create_set(test_db, user_id, name, None, None)


def names(rows):
    return [row["name"] for row in rows]


def test_counts_frequency_over_manual_runs(test_db):
    user = create_user(test_db, "alice", "password123")
    a = make_set(test_db, user["id"], "A")
    b = make_set(test_db, user["id"], "B")
    c = make_set(test_db, user["id"], "C")
    for set_id in (a["id"], a["id"], a["id"], b["id"], b["id"], c["id"]):
        seed_run(test_db, user["id"], set_id)

    assert names(service.most_used_sets(test_db, user["id"])) == ["A", "B", "C"]


def test_auto_runs_are_ignored(test_db):
    user = create_user(test_db, "alice", "password123")
    active = service.list_sets(test_db, user["id"])[0]  # seeded "Default"
    auto_only = make_set(test_db, user["id"], "AutoOnly")
    used = make_set(test_db, user["id"], "Used")
    for _ in range(12):
        seed_run(test_db, user["id"], auto_only["id"], triggered_by="auto")
    seed_run(test_db, user["id"], used["id"])

    assert names(service.most_used_sets(test_db, user["id"], exclude_id=active["id"])) == ["Used"]


def test_only_the_last_10_manual_runs_count(test_db):
    user = create_user(test_db, "alice", "password123")
    a = make_set(test_db, user["id"], "A")
    b = make_set(test_db, user["id"], "B")
    c = make_set(test_db, user["id"], "C")
    # Oldest first: C x1, B x4, A x6 (11 runs) -> the oldest C falls outside the window.
    for set_id in (c["id"],) + (b["id"],) * 4 + (a["id"],) * 6:
        seed_run(test_db, user["id"], set_id)

    assert names(service.most_used_sets(test_db, user["id"])) == ["A", "B"]


def test_excludes_active_and_deleted_sets(test_db):
    user = create_user(test_db, "alice", "password123")
    active = make_set(test_db, user["id"], "Active")
    other = make_set(test_db, user["id"], "Other")
    doomed = make_set(test_db, user["id"], "Doomed")
    seed_run(test_db, user["id"], active["id"])
    seed_run(test_db, user["id"], other["id"])
    seed_run(test_db, user["id"], doomed["id"])
    service.delete_set(test_db, user["id"], doomed["id"])

    assert names(service.most_used_sets(test_db, user["id"], exclude_id=active["id"])) == ["Other"]


def test_tie_breaks_by_most_recent_run(test_db):
    user = create_user(test_db, "alice", "password123")
    a = make_set(test_db, user["id"], "A")
    b = make_set(test_db, user["id"], "B")
    seed_run(test_db, user["id"], b["id"])
    seed_run(test_db, user["id"], a["id"])  # A's use is more recent

    assert names(service.most_used_sets(test_db, user["id"])) == ["A", "B"]


def test_limited_to_three_and_empty_without_history(test_db):
    user = create_user(test_db, "alice", "password123")
    sets = [make_set(test_db, user["id"], name) for name in ("A", "B", "C", "D")]
    for row in sets:
        seed_run(test_db, user["id"], row["id"])

    assert len(service.most_used_sets(test_db, user["id"])) == 3
    assert service.most_used_sets(test_db, user["id"], exclude_id=sets[0]["id"]) != []
    assert service.most_used_sets(test_db, 999) == []


# --- batch -----------------------------------------------------------------

GOOD = {"pe": 20, "pb": 3, "roe": 25, "roce": 25, "debt_to_equity": 0.2, "market_cap": 5000}
BAD = {"pe": 80, "pb": 12, "roe": 5, "roce": 5, "debt_to_equity": 2.0, "market_cap": 100}


class MapProvider:
    def __init__(self, data=None, fail=(), stale=False):
        self.data = data or {}
        self.fail = set(fail)
        self.stale = stale
        self.calls: list[str] = []
        self.list_calls = 0

    def list_stocks(self):
        self.list_calls += 1
        return [
            {"symbol": symbol, "name": f"{symbol} Ltd", "sector": "IT", "market_cap": None}
            for symbol in ("AAA", "BBB", "CCC")
        ]

    def fundamentals(self, symbol):
        self.calls.append(symbol)
        if symbol in self.fail:
            raise RuntimeError(f"fetch failed for {symbol}")
        return {"symbol": symbol, **self.data.get(symbol, GOOD), "raw": {"src": "fake"}}


def test_batch_runs_active_manual_and_extras_auto(test_db):
    user = create_user(test_db, "alice", "password123")
    active = service.list_sets(test_db, user["id"])[0]
    quality = make_set(test_db, user["id"], "Quality")
    value = make_set(test_db, user["id"], "Value")
    seed_run(test_db, user["id"], quality["id"])
    seed_run(test_db, user["id"], value["id"])  # Value is the more recent use
    service.activate_set(test_db, user["id"], active["id"])  # Default runs as the active screen
    provider = MapProvider()

    result = service.run_screen_batch(provider, test_db, user)

    assert [extra["name"] for extra in result["extra_runs"]] == ["Value", "Quality"]
    with test_db() as session:
        runs = session.query(ScreenRun).all()
    assert {(run.set_id, run.triggered_by) for run in runs} == {
        (active["id"], "manual"),
        (quality["id"], "manual"),
        (value["id"], "manual"),
        (value["id"], "auto"),
        (quality["id"], "auto"),
    }


def test_batch_caps_extras_and_reuses_one_prepare(test_db):
    user = create_user(test_db, "alice", "password123")
    service.list_sets(test_db, user["id"])  # seed active Default
    others = [make_set(test_db, user["id"], name) for name in ("A", "B", "C", "D")]
    for row in others:
        seed_run(test_db, user["id"], row["id"])
    provider = MapProvider()

    result = service.run_screen_batch(provider, test_db, user)

    assert len(result["extra_runs"]) == 3
    assert provider.list_calls == 1
    assert sorted(provider.calls) == ["AAA", "BBB", "CCC"]  # one prepare, not one per screen


def test_extra_failure_is_isolated_and_reported(test_db, monkeypatch):
    user = create_user(test_db, "alice", "password123")
    active = service.list_sets(test_db, user["id"])[0]
    quality = make_set(test_db, user["id"], "Quality")
    seed_run(test_db, user["id"], quality["id"])
    service.activate_set(test_db, user["id"], active["id"])
    provider = MapProvider()
    original = service._evaluate_and_store

    def flaky(session_factory, user_id, prepared, criteria, shortlist_size, set_id, triggered_by):
        if triggered_by == "auto":
            raise RuntimeError("boom")
        return original(
            session_factory, user_id, prepared, criteria, shortlist_size, set_id, triggered_by
        )

    monkeypatch.setattr(service, "_evaluate_and_store", flaky)
    result = service.run_screen_batch(provider, test_db, user)

    assert result["run_id"] > 0 and result["shortlisted"]
    assert result["extra_runs"][0]["error"] == "boom"
    assert result["extra_runs"][0]["run_id"] is None
    with test_db() as session:
        runs = session.query(ScreenRun).order_by(ScreenRun.id).all()
    assert [(run.set_id, run.triggered_by) for run in runs] == [
        (quality["id"], "manual"),
        (active["id"], "manual"),
    ]


def test_batch_without_history_returns_no_extras(test_db):
    user = create_user(test_db, "alice", "password123")
    service.list_sets(test_db, user["id"])  # seed active Default
    provider = MapProvider()

    result = service.run_screen_batch(provider, test_db, user)

    assert result["extra_runs"] == []
    with test_db() as session:
        runs = session.query(ScreenRun).all()
    assert [(run.triggered_by, run.set_id is not None) for run in runs] == [("manual", True)]

