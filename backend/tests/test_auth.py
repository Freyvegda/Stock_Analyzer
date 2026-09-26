import app.auth.security as security
from app.auth.security import hash_password, session_secret, verify_password


def test_hash_verify_round_trip():
    stored = hash_password("correct horse battery")
    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("correct horse battery", stored)


def test_wrong_password_rejected():
    assert not verify_password("nope", hash_password("correct horse battery"))


def test_hash_is_salted():
    assert hash_password("same") != hash_password("same")


def test_malformed_hash_returns_false():
    assert not verify_password("x", "not-a-hash")


def test_session_secret_created_once_and_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "SECRET_PATH", str(tmp_path / ".session_secret"))
    first = session_secret()
    assert first and len(first) >= 32
    assert session_secret() == first
    assert (tmp_path / ".session_secret").read_text(encoding="utf-8") == first


import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import service
from app.auth.service import UserExistsError
from app.db.database import Base
from app.db.models import User, UserCriteria
from app.screener.criteria import default_criteria


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/auth.db")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_create_user_normalizes_and_hashes(db):
    user = service.create_user(db, "  Alice  ", "password123")
    assert user["username"] == "alice"
    with db() as session:
        row = session.get(User, user["id"])
        assert row.password_hash != "password123"
        assert row.password_hash.startswith("scrypt$")
        assert row.created_at


def test_create_user_duplicate_case_insensitive_raises(db):
    service.create_user(db, "alice", "password123")
    with pytest.raises(UserExistsError):
        service.create_user(db, "ALICE", "password456")


def test_authenticate_ok_and_generic_failures(db):
    service.create_user(db, "alice", "password123")
    assert service.authenticate(db, "alice", "password123")["username"] == "alice"
    assert service.authenticate(db, "ALICE", "password123") is not None  # case-insensitive
    assert service.authenticate(db, "alice", "wrong") is None
    assert service.authenticate(db, "bob", "password123") is None


def test_users_exist(db):
    assert service.users_exist(db) is False
    service.create_user(db, "alice", "password123")
    assert service.users_exist(db) is True


def test_get_user(db):
    user = service.create_user(db, "alice", "password123")
    assert service.get_user(db, user["id"]) == {"id": user["id"], "username": "alice"}
    assert service.get_user(db, 999) is None


def test_seed_default_criteria_is_idempotent(db):
    user = service.create_user(db, "alice", "password123")
    with db() as session:
        row = service.seed_default_criteria(session, user["id"])
        session.commit()
        criteria_json, shortlist_size = row.criteria_json, row.shortlist_size
    assert json.loads(criteria_json) == default_criteria()
    assert shortlist_size == 10
    with db() as session:
        service.seed_default_criteria(session, user["id"])
        session.commit()
        assert session.query(UserCriteria).count() == 1
