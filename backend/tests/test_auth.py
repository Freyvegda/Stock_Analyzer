import app.auth.security as security
from app.auth.security import auth_secret, hash_password, verify_password


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


def test_auth_secret_created_once_and_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "SECRET_PATH", str(tmp_path / ".auth_secret"))
    first = auth_secret()
    assert first and len(first) >= 32
    assert auth_secret() == first
    assert (tmp_path / ".auth_secret").read_text(encoding="utf-8") == first


import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import service
from app.auth.service import UserExistsError
from app.db.database import Base
from app.db.models import User
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


# --- HTTP: auth routes, session cookie, router gating ---

from tests.conftest import create_session_cookie


def test_state_reports_no_users_initially(client, test_db):
    assert client.get("/auth/state").json() == {"users_exist": False, "user": None}


def test_setup_creates_account_and_session(client, test_db):
    res = client.post("/auth/setup", json={"username": "Alice", "password": "password123"})
    assert res.status_code == 201
    assert res.json()["user"]["username"] == "alice"
    assert client.get("/auth/me").json()["username"] == "alice"
    state = client.get("/auth/state").json()
    assert state["users_exist"] is True and state["user"]["username"] == "alice"


def test_second_setup_conflicts(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    res = client.post("/auth/setup", json={"username": "bob", "password": "password456"})
    assert res.status_code == 409
    assert res.json()["detail"] == "Account already exists"


def test_setup_validation_errors_are_human_readable(client, test_db):
    res = client.post("/auth/setup", json={"username": "alice", "password": "short"})
    assert res.status_code == 422
    assert isinstance(res.json()["detail"], str)


def test_login_ok_and_generic_failure(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.cookies.clear()
    assert client.post("/auth/login", json={"username": "alice", "password": "pass"}).status_code == 422
    wrong = client.post("/auth/login", json={"username": "alice", "password": "wrongpass"})
    unknown = client.post("/auth/login", json={"username": "bob", "password": "password123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "Invalid username or password"
    ok = client.post("/auth/login", json={"username": "ALICE", "password": "password123"})
    assert ok.status_code == 200
    assert client.get("/auth/me").json()["username"] == "alice"


def test_logout_clears_session(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_me_without_session(client, test_db):
    res = client.get("/auth/me")
    assert res.status_code == 401
    assert res.json()["detail"] == "Not authenticated"


def test_signed_cookie_authenticates_directly(client, test_db):
    user = service.create_user(test_db, "alice", "password123")
    client.cookies.set("sa_session", create_session_cookie(user))
    assert client.get("/auth/me").json() == user


def test_tampered_cookie_is_rejected(client, test_db):
    user = service.create_user(test_db, "alice", "password123")
    cookie = create_session_cookie(user)
    client.cookies.set("sa_session", cookie[:-2] + "xx")
    assert client.get("/auth/me").status_code == 401


def test_pipeline_routers_require_auth(client, test_db):
    assert client.post("/docs/fetch").status_code == 401
    assert client.post("/model/train").status_code == 401
    assert client.post("/backtest/run").status_code == 401
    assert client.get("/health").status_code == 200


def test_concurrent_setup_creates_exactly_one_account(db, monkeypatch):
    """Two tabs racing setup must not be able to create two accounts when the
    usernames differ (uniqueness alone does not stop that)."""
    import threading
    import time

    real_hash = service.hash_password

    def slow_hash(password):
        time.sleep(0.05)  # widen the check-then-insert window for the race
        return real_hash(password)

    monkeypatch.setattr(service, "hash_password", slow_hash)

    usernames = [f"user{i}" for i in range(8)]
    start = threading.Barrier(len(usernames), timeout=15)
    outcomes: list[str] = []
    outcomes_lock = threading.Lock()

    def attempt(username):
        start.wait()
        try:
            service.create_user(db, username, "password123")
            with outcomes_lock:
                outcomes.append("created")
        except UserExistsError:
            with outcomes_lock:
                outcomes.append("rejected")

    threads = [threading.Thread(target=attempt, args=(u,)) for u in usernames]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert outcomes.count("created") == 1
    assert outcomes.count("rejected") == len(usernames) - 1
