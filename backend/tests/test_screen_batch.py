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
