"""Service-level tests for Phase 1.8 run jobs (no HTTP)."""

from app.db.models import RunJob, RunJobItem, ScreenRun
from app.screener import service


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
