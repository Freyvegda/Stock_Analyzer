"""API tests for /screen/sets and the retired /screen/criteria (Phase 1.7)."""

from app.db.models import RunJob, RunJobItem, ScreeningSet
from app.screener import service


def create_screen(client, name, **extra):
    response = client.post("/screen/sets", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_first_get_seeds_default_screen(client, sign_in):
    sign_in()
    body = client.get("/screen/sets").json()
    assert [s["name"] for s in body] == ["Default"]
    only = body[0]
    assert only["is_active"] is True
    assert only["shortlist_size"] == 10
    assert only["thesis"] is None
    assert {c["key"] for c in only["criteria"]} == {
        "pe",
        "pb",
        "roe",
        "roce",
        "debt_to_equity",
        "market_cap",
    }


def test_create_screen_round_trip(client, sign_in):
    sign_in()
    created = create_screen(client, "Quality", thesis="hi", criteria=[{"key": "pe", "enabled": True, "value": 15}])
    assert created["name"] == "Quality"
    assert created["is_active"] is True
    assert created["criteria"] == [{"key": "pe", "enabled": True, "value": 15.0, "bookmarked": False}]
    body = client.get("/screen/sets").json()
    assert {s["name"]: s["is_active"] for s in body} == {"Default": False, "Quality": True}


def test_create_validation_errors(client, sign_in):
    sign_in()
    create_screen(client, "Dup")
    cases = [
        {"name": "   "},
        {"name": "x", "shortlist_size": 5},
        {"name": "x", "criteria": [{"key": "pe", "enabled": False, "value": 25}]},
        {"name": "x", "criteria": [{"key": "bogus", "enabled": True, "value": 1}]},
        {"name": "dup"},
        {"name": "x", "thesis": "y" * 501},
    ]
    for payload in cases:
        assert client.post("/screen/sets", json=payload).status_code == 422, payload


def test_put_updates_and_404_for_unknown(client, sign_in):
    sign_in()
    created = create_screen(client, "Quality", thesis="keep me")
    updated = client.put(
        f"/screen/sets/{created['id']}",
        json={"name": "Renamed", "thesis": None},
    ).json()
    assert updated["name"] == "Renamed"
    assert updated["thesis"] is None
    assert client.put("/screen/sets/9999", json={"name": "Nope"}).status_code == 404
    assert client.put(f"/screen/sets/{created['id']}", json={}).status_code == 422


def test_delete_last_screen_returns_400(client, sign_in):
    sign_in()
    only = client.get("/screen/sets").json()[0]
    response = client.delete(f"/screen/sets/{only['id']}")
    assert response.status_code == 400
    assert len(client.get("/screen/sets").json()) == 1


def test_delete_screen_promotes_another(client, sign_in):
    sign_in()
    client.get("/screen/sets")
    create_screen(client, "Older")
    create_screen(client, "Newer")
    newer = next(s for s in client.get("/screen/sets").json() if s["name"] == "Newer")
    assert client.delete(f"/screen/sets/{newer['id']}").status_code == 204
    remaining = {s["name"]: s["is_active"] for s in client.get("/screen/sets").json()}
    assert remaining == {"Default": False, "Older": True}


def test_activate_returns_single_active(client, sign_in):
    sign_in()
    default = client.get("/screen/sets").json()[0]
    create_screen(client, "Quality")
    activated = client.post(f"/screen/sets/{default['id']}/activate").json()
    assert activated["is_active"] is True
    active = [s["name"] for s in client.get("/screen/sets").json() if s["is_active"]]
    assert active == ["Default"]
    assert client.post("/screen/sets/9999/activate").status_code == 404


def test_criteria_endpoints_retired(client, sign_in):
    sign_in()
    assert client.get("/screen/criteria").status_code == 404
    assert client.put("/screen/criteria", json={"criteria": []}).status_code == 404


def test_sets_require_auth(client):
    assert client.get("/screen/sets").status_code == 401


def test_corrupt_criteria_json_falls_back_to_defaults(client, sign_in, test_db):
    user = sign_in()
    with test_db() as session:
        session.add(
            ScreeningSet(
                user_id=user["id"],
                name="Broken",
                criteria_json="{not json",
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="now",
            )
        )
        session.commit()
    body = client.get("/screen/sets").json()
    assert body[0]["name"] == "Broken"
    assert len(body[0]["criteria"]) == 6  # Phase-1 defaults, never a 500


def seed_running_job(test_db, user_id, set_id):
    """One registered running job with a queued item for ``set_id``."""
    with test_db() as session:
        job = RunJob(user_id=user_id, set_id=set_id, started_at="now", status="running")
        session.add(job)
        session.flush()
        session.add(RunJobItem(job_id=job.id, set_id=set_id, status="queued"))
        session.commit()
        job_id = job.id
    service.register_active_job(job_id)
    return job_id


def test_update_delete_activate_busy_screen_409(client, sign_in, test_db):
    user = sign_in()
    created = create_screen(client, "Quality")
    job_id = seed_running_job(test_db, user["id"], created["id"])
    try:
        put = client.put(f"/screen/sets/{created['id']}", json={"name": "Renamed"})
        assert put.status_code == 409
        assert put.json()["detail"] == "Screen is mid-run"
        assert client.delete(f"/screen/sets/{created['id']}").status_code == 409
        assert client.post(f"/screen/sets/{created['id']}/activate").status_code == 409
    finally:
        service.unregister_active_job(job_id)


def test_activate_other_screen_allowed_while_busy(client, sign_in, test_db):
    user = sign_in()
    default = client.get("/screen/sets").json()[0]
    quality = create_screen(client, "Quality")  # becomes active
    job_id = seed_running_job(test_db, user["id"], quality["id"])
    try:
        activated = client.post(f"/screen/sets/{default['id']}/activate")
    finally:
        service.unregister_active_job(job_id)
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True
