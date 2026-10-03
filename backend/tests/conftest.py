import json
from base64 import b64encode
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.security import hash_password, session_secret
from app.db import models  # noqa: F401 — register tables
from app.db.database import Base
from app.db.models import User
from app.main import app
from app.screener import runner, service


def create_session_cookie(user: dict) -> str:
    """Sign a session cookie directly in Starlette's format — no HTTP login dance."""
    payload = b64encode(
        json.dumps({"user_id": user["id"], "username": user["username"]}).encode("utf-8")
    )
    return TimestampSigner(str(session_secret())).sign(payload).decode("utf-8")


@pytest.fixture
def client():
    """Fresh TestClient per test — isolated cookie jar."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    """Temporary SQLite DB wired into every module that opens sessions."""
    engine = create_engine(f"sqlite:///{tmp_path}/api.db")
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)

    from app.api import auth as auth_api
    from app.api import screen as screen_api
    from app.api import stock as stock_api
    from app.api import stocks as stocks_api
    from app.auth import deps as auth_deps

    monkeypatch.setattr(auth_api, "SessionLocal", TestSession)
    monkeypatch.setattr(screen_api, "SessionLocal", TestSession)
    monkeypatch.setattr(stock_api, "SessionLocal", TestSession)
    monkeypatch.setattr(stocks_api, "SessionLocal", TestSession)
    monkeypatch.setattr(auth_deps, "SessionLocal", TestSession)
    monkeypatch.setattr(auth_api, "init_db", lambda: None)
    monkeypatch.setattr(screen_api, "init_db", lambda: None)
    monkeypatch.setattr(stock_api, "init_db", lambda: None)
    monkeypatch.setattr(stocks_api, "init_db", lambda: None)
    # TestClient requests must never spawn the worker thread; worker tests call
    # runner.execute_job directly. A fresh registry per test keeps endpoint/worker
    # registrations from leaking across tests (job ids restart per temp DB).
    monkeypatch.setattr(runner, "submit_job", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_ACTIVE_JOB_IDS", set())
    return TestSession


@pytest.fixture
def sign_in(client, test_db):
    """Sign in a user (creating the row directly — no single-account guard) and
    install the session cookie. Idempotent for repeated usernames."""

    def _sign_in(username: str = "alice", password: str = "password123") -> dict:
        username = username.strip().lower()
        with test_db() as session:
            row = session.query(User).filter(User.username == username).first()
            if row is None:
                row = User(
                    username=username,
                    password_hash=hash_password(password),
                    created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                )
                session.add(row)
                session.commit()
                session.refresh(row)
            user = {"id": row.id, "username": row.username}
        client.cookies.set("sa_session", create_session_cookie(user))
        return user

    return _sign_in
