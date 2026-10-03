"""Login/setup issue a token pair; refresh rotates it; idle revokes it.

The refresh token never leaves the server in readable form: it is set as an
HttpOnly cookie and only its SHA-256 is persisted. Rotation means a captured
old token is dead after the next refresh, which is why the client must
single-flight its refresh calls.
"""

import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from app.auth import service
from app.db.models import AuthSession, User

IDLE_SECONDS = 3 * 60 * 60


def _cookie(client) -> str:
    return client.cookies.get("sa_refresh")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _rows(test_db):
    with test_db() as s:
        return s.query(AuthSession).all()


# --- login / setup ---------------------------------------------------------


def test_login_returns_a_token_bundle(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    res = client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert res.status_code == 200
    body = res.json()
    assert body["user"] == {"id": 1, "username": "alice"}
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 15 * 60


def test_setup_returns_a_token_bundle_and_signs_the_user_in(client, test_db):
    res = client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    assert res.status_code == 201
    assert res.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})
    assert me.status_code == 200


def test_login_sets_an_httponly_refresh_cookie(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    login = client.post("/auth/login", json={"username": "alice", "password": "password123"})
    raw = _cookie(client)
    assert raw and len(raw) >= 32
    # the Set-Cookie attributes are the security properties, not the value
    set_cookie = login.headers["set-cookie"]
    assert "httponly" in set_cookie.lower()
    assert "samesite=strict" in set_cookie.lower()
    assert "path=/" in set_cookie.lower()


def test_refresh_cookie_is_not_the_access_token(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    res = client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert _cookie(client) != res.json()["access_token"]


def test_only_the_hash_of_the_refresh_token_is_stored(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    rows = _rows(test_db)
    assert len(rows) == 2  # setup + login each issued one
    token = _cookie(client)
    assert all(row.token_hash != token for row in rows)
    assert _hash(token) in {row.token_hash for row in rows}


def test_failed_login_issues_nothing(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.cookies.delete(service.REFRESH_COOKIE)  # setup already put one in the jar
    before = len(_rows(test_db))  # setup signs the user in, so one row already exists
    res = client.post("/auth/login", json={"username": "alice", "password": "wrong-password"})
    assert res.status_code == 401
    assert _cookie(client) is None
    assert len(_rows(test_db)) == before  # the failure added no session


# --- refresh ---------------------------------------------------------------


def test_refresh_returns_a_new_access_token(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    first = client.post("/auth/login", json={"username": "alice", "password": "password123"})
    res = client.post("/auth/refresh")
    assert res.status_code == 200
    assert res.json()["access_token"]
    assert res.json()["access_token"] != first.json()["access_token"]


def test_refresh_rotates_the_token_and_kills_the_old_one(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    old = _cookie(client)
    rotated = client.post("/auth/refresh")
    new = _cookie(client)
    assert new and new != old
    assert rotated.status_code == 200
    # Replaying the consumed token must fail. Use a separate client: the shared
    # one has already received the Set-Cookie that expires the cookie in its jar.
    from fastapi.testclient import TestClient

    from app.main import app

    replay = TestClient(app, cookies={service.REFRESH_COOKIE: old})
    assert replay.post("/auth/refresh").status_code == 401


def test_refresh_without_a_cookie_is_401(client, test_db):
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_with_a_garbage_cookie_is_401(client, test_db):
    client.cookies.set("sa_refresh", "not-a-real-token")
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_slides_last_seen(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    row = _rows(test_db)[-1]
    stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
    with test_db() as s:
        r = s.query(AuthSession).filter(AuthSession.id == row.id).one()
        r.last_seen_at = stale
        s.commit()
    assert client.post("/auth/refresh").status_code == 200
    with test_db() as s:
        r = s.query(AuthSession).order_by(AuthSession.id.desc()).first()
        assert r.last_seen_at > stale


def test_refresh_after_three_hours_idle_is_401_and_revokes(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    row = _rows(test_db)[-1]
    stale = (datetime.now(timezone.utc) - timedelta(seconds=IDLE_SECONDS + 60)).isoformat(
        timespec="seconds"
    )
    with test_db() as s:
        r = s.query(AuthSession).filter(AuthSession.id == row.id).one()
        r.last_seen_at = stale
        s.commit()
    assert client.post("/auth/refresh").status_code == 401
    with test_db() as s:
        assert s.query(AuthSession).filter(AuthSession.id == row.id).one().revoked_at is not None


def test_refresh_just_under_the_idle_limit_still_works(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    row = _rows(test_db)[-1]
    recent = (datetime.now(timezone.utc) - timedelta(seconds=IDLE_SECONDS - 120)).isoformat(
        timespec="seconds"
    )
    with test_db() as s:
        r = s.query(AuthSession).filter(AuthSession.id == row.id).one()
        r.last_seen_at = recent
        s.commit()
    assert client.post("/auth/refresh").status_code == 200


def test_refresh_for_a_deleted_user_is_401(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    with test_db() as s:
        s.query(User).delete()
        s.commit()
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_does_not_issue_an_access_token_when_it_fails(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    row = _rows(test_db)[-1]
    stale = (datetime.now(timezone.utc) - timedelta(seconds=IDLE_SECONDS + 60)).isoformat(
        timespec="seconds"
    )
    with test_db() as s:
        r = s.query(AuthSession).filter(AuthSession.id == row.id).one()
        r.last_seen_at = stale
        s.commit()
    assert "access_token" not in client.post("/auth/refresh").json()


# --- logout ----------------------------------------------------------------


def test_logout_revokes_the_session(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    token = _cookie(client)
    assert client.post("/auth/logout").status_code == 204
    with test_db() as s:
        assert s.query(AuthSession).filter(AuthSession.token_hash == _hash(token)).one().revoked_at


def test_logout_works_with_an_expired_access_token(client, test_db):
    """The 15-minute access token outlives neither logout nor a lost session:
    logout must resolve from the cookie alone, never from `current_user`."""
    from app.auth.security import sign_access_token

    user = client.post("/auth/setup", json={"username": "alice", "password": "password123"}).json()[
        "user"
    ]
    client.headers.pop("Authorization", None)  # no access token at all
    token = _cookie(client)
    res = client.post("/auth/logout", headers={"Authorization": f"Bearer {sign_access_token(user, -60)}"})
    assert res.status_code == 204
    with test_db() as s:
        assert s.query(AuthSession).filter(AuthSession.token_hash == _hash(token)).one().revoked_at


def test_logout_without_any_token_is_still_204(client, test_db):
    """Idempotent: the frontend clears state regardless of the server's answer."""
    assert client.post("/auth/logout").status_code == 204


def test_refresh_after_logout_is_401(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.post("/auth/logout")
    assert client.post("/auth/refresh").status_code == 401


# --- state -----------------------------------------------------------------


def test_state_reports_no_user_without_a_token(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.headers.pop("Authorization", None)
    res = client.get("/auth/state")
    assert res.status_code == 200
    assert res.json() == {"users_exist": True, "user": None}


def test_state_reports_the_user_for_a_valid_token(client, test_db):
    body = client.post("/auth/setup", json={"username": "alice", "password": "password123"}).json()
    res = client.get(
        "/auth/state", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert res.json()["user"] == body["user"]


def test_state_never_500s_on_a_broken_token(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.headers.pop("Authorization", None)
    res = client.get("/auth/state", headers={"Authorization": "Bearer garbage"})
    assert res.status_code == 200
    assert res.json()["user"] is None


# --- sweep -----------------------------------------------------------------


def test_login_sweeps_revoked_sessions(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert len(_rows(test_db)) == 2
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with test_db() as s:
        for row in s.query(AuthSession).all():
            row.revoked_at = stamp
        s.commit()
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    rows = _rows(test_db)
    assert len(rows) == 1  # both revoked rows were swept
    assert rows[0].revoked_at is None


def test_login_keeps_a_live_session_it_did_not_revoke(client, test_db):
    """The sweep is a garbage collector, not a `logout every device`."""
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    live = [r for r in _rows(test_db) if r.revoked_at is None]
    assert len(live) == 3


def test_login_sweeps_sessions_idle_beyond_the_window(client, test_db):
    client.post("/auth/setup", json={"username": "alice", "password": "password123"})
    row = _rows(test_db)[0]
    ancient = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(timespec="seconds")
    with test_db() as s:
        s.query(AuthSession).filter(AuthSession.id == row.id).one().last_seen_at = ancient
        s.commit()
    client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert [r.token_hash for r in _rows(test_db)] == [_rows(test_db)[-1].token_hash]
