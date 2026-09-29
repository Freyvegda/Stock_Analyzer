"""Service-level tests for Phase 1.7 screening-set CRUD (no HTTP)."""

import json
from datetime import datetime, timezone

import pytest

from app.auth.security import hash_password
from app.auth.service import create_user
from app.db.models import ScreeningSet, User
from app.screener import service
from app.screener.criteria import ConfigError, default_criteria


def make_user(test_db, username="alice"):
    return create_user(test_db, username, "password123")


def with_flags(criteria):
    """Stored criteria always echo an explicit bookmarked flag."""
    return [{**item, "bookmarked": False} for item in criteria]


def seed_and_get(test_db, user_id):
    service.list_sets(test_db, user_id)  # first read seeds "Default"
    return service.list_sets(test_db, user_id)


def test_first_read_seeds_default_active_set(test_db):
    user = make_user(test_db)
    sets = service.list_sets(test_db, user["id"])
    assert [s["name"] for s in sets] == ["Default"]
    only = sets[0]
    assert only["is_active"] is True
    assert only["criteria"] == with_flags(default_criteria())
    assert only["shortlist_size"] == 10
    assert only["thesis"] is None


def test_create_set_copies_active_criteria_and_becomes_active(test_db):
    user = make_user(test_db)
    seed_and_get(test_db, user["id"])
    created = service.create_set(test_db, user["id"], "Quality", None, "high roe")
    assert created["name"] == "Quality"
    assert created["is_active"] is True
    assert created["criteria"] == with_flags(default_criteria())
    assert created["thesis"] == "high roe"
    sets = service.list_sets(test_db, user["id"])
    assert {s["name"]: s["is_active"] for s in sets} == {"Default": False, "Quality": True}


def test_create_set_with_explicit_criteria(test_db):
    user = make_user(test_db)
    criteria = [{"key": "pe", "enabled": True, "value": 15.0}]
    created = service.create_set(test_db, user["id"], "Cheap", criteria, None)
    assert created["criteria"] == with_flags(criteria)


def test_activate_switches_single_active(test_db):
    user = make_user(test_db)
    service.create_set(test_db, user["id"], "A", None, None)
    second = service.create_set(test_db, user["id"], "B", None, None)
    first = next(s for s in service.list_sets(test_db, user["id"]) if s["name"] == "A")
    activated = service.activate_set(test_db, user["id"], first["id"])
    assert activated["is_active"] is True
    sets = service.list_sets(test_db, user["id"])
    assert [s["name"] for s in sets if s["is_active"]] == ["A"]
    assert second["id"] != first["id"]


def test_update_set_changes_fields_and_clears_thesis(test_db):
    user = make_user(test_db)
    created = service.create_set(test_db, user["id"], "Quality", None, "keep me")
    criteria = [{"key": "roe", "enabled": True, "value": 20.0}]
    updated = service.update_set(
        test_db, user["id"], created["id"], {"criteria": criteria, "thesis": None}
    )
    assert updated["name"] == "Quality"
    assert updated["criteria"] == with_flags(criteria)
    assert updated["thesis"] is None


def test_duplicate_name_rejected_case_insensitive(test_db):
    user = make_user(test_db)
    service.create_set(test_db, user["id"], "Quality", None, None)
    with pytest.raises(ConfigError):
        service.create_set(test_db, user["id"], "  quality ", None, None)
    with pytest.raises(ConfigError):
        created = service.list_sets(test_db, user["id"])[0]
        service.update_set(test_db, user["id"], created["id"], {"name": "QUALITY"})


def test_delete_last_set_rejected(test_db):
    user = make_user(test_db)
    only = service.list_sets(test_db, user["id"])[0]
    with pytest.raises(service.LastSetError):
        service.delete_set(test_db, user["id"], only["id"])
    assert len(service.list_sets(test_db, user["id"])) == 1


def test_delete_active_promotes_most_recent(test_db):
    user = make_user(test_db)
    service.list_sets(test_db, user["id"])
    service.create_set(test_db, user["id"], "Older", None, None)
    latest = service.create_set(test_db, user["id"], "Newer", None, None)
    service.delete_set(test_db, user["id"], latest["id"])
    sets = service.list_sets(test_db, user["id"])
    assert {s["name"]: s["is_active"] for s in sets} == {"Default": False, "Older": True}


def test_unknown_set_raises_not_found(test_db):
    user = make_user(test_db)
    seed_and_get(test_db, user["id"])
    with pytest.raises(service.SetNotFoundError):
        service.activate_set(test_db, user["id"], 9999)


def test_sets_isolated_between_users(test_db):
    alice = make_user(test_db, "alice")
    with test_db() as session:  # single-account guard blocks create_user twice by design
        bob = User(
            username="bob",
            password_hash=hash_password("password123"),
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        session.add(bob)
        session.commit()
        session.refresh(bob)
        bob_id = bob.id
    service.create_set(test_db, alice["id"], "OnlyAlice", None, None)
    bob_sets = service.list_sets(test_db, bob_id)
    assert [s["name"] for s in bob_sets] == ["Default"]
    service.activate_set(test_db, bob_id, bob_sets[0]["id"])
    alice_sets = service.list_sets(test_db, alice["id"])
    assert {s["name"] for s in alice_sets} == {"Default", "OnlyAlice"}


def test_get_criteria_returns_active_set(test_db):
    user = make_user(test_db)
    created = service.create_set(test_db, user["id"], "Momentum", None, "run hot")
    active = service.get_criteria(test_db, user["id"])
    assert active["id"] == created["id"]
    assert active["criteria"] == created["criteria"]
    assert active["thesis"] == "run hot"


def test_seed_recovers_when_a_parallel_first_load_wins(test_db, monkeypatch):
    """The criteria page fires GET /screen/sets and GET /screen/latest together;
    the losing seed must adopt the winner's row, not 500."""
    user = make_user(test_db)
    with test_db() as other:
        other.add(
            ScreeningSet(
                user_id=user["id"],
                name="Default",
                criteria_json=json.dumps(default_criteria()),
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="now",
            )
        )
        other.commit()
    real = service._user_sets
    state = {"first": True}

    def stale_once(session, user_id):
        if state["first"]:
            state["first"] = False
            return []  # the racing session's stale read
        return real(session, user_id)

    monkeypatch.setattr(service, "_user_sets", stale_once)
    with test_db() as session:
        row = service._seed_active_set(session, user["id"])
        session.commit()
        assert row.name == "Default"
    with test_db() as session:
        assert session.query(ScreeningSet).filter_by(user_id=user["id"]).count() == 1


def test_seed_repairs_multiple_active_sets(test_db):
    user = make_user(test_db)
    with test_db() as session:
        session.add(
            ScreeningSet(
                user_id=user["id"],
                name="A",
                criteria_json=json.dumps(default_criteria()),
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="2026-01-01T00:00:00+00:00",
            )
        )
        session.add(
            ScreeningSet(
                user_id=user["id"],
                name="B",
                criteria_json=json.dumps(default_criteria()),
                thesis=None,
                shortlist_size=10,
                is_active=True,
                updated_at="2026-01-02T00:00:00+00:00",
            )
        )
        session.commit()
    sets = service.list_sets(test_db, user["id"])
    assert [s["name"] for s in sets if s["is_active"]] == ["B"]
