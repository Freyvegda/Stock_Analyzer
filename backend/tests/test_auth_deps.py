"""`current_user` resolves an `Authorization: Bearer` access token to a user.

Before: it read a signed session cookie. The dependency's contract is unchanged
from the caller's side — a user dict or a 401 — so every router that already
declares `Depends(current_user)` keeps working untouched.

401 is always generic. "Token expired" and "token forged" must be
indistinguishable to an attacker.
"""

import time

import pytest
from fastapi.testclient import TestClient

from app.auth.security import sign_access_token
from app.main import app


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_valid_token_authenticates(client, sign_in):
    user = sign_in()
    res = client.get("/auth/me", headers=_bearer(sign_access_token(user)))
    assert res.status_code == 200
    assert res.json() == user


def test_no_authorization_header_is_401(client, test_db):
    assert client.get("/auth/me").status_code == 401


def test_malformed_header_is_401(client, test_db):
    for bad in ("Bearer", "Bearer ", "Token abc.def.ghi", "abc.def.ghi", "Bearer a b c"):
        assert client.get("/auth/me", headers={"Authorization": bad}).status_code == 401


def test_garbage_token_is_401(client, test_db):
    assert client.get("/auth/me", headers=_bearer("not.a.jwt")).status_code == 401


def test_token_signed_with_another_secret_is_401(client, sign_in):
    import jwt

    now = int(time.time())
    forged = jwt.encode(
        {"sub": "1", "username": "alice", "typ": "access", "iat": now, "exp": now + 900},
        "z" * 64,
        algorithm="HS256",
    )
    assert client.get("/auth/me", headers=_bearer(forged)).status_code == 401


def test_401_detail_is_generic(client, test_db):
    """The detail must not tell an attacker whether the token merely expired."""
    res = client.get("/auth/me")
    assert res.status_code == 401
    assert res.json()["detail"] == "Not authenticated"


def test_expired_token_is_401(client, sign_in):
    user = sign_in()
    expired = sign_access_token(user, ttl_seconds=-60)
    assert client.get("/auth/me", headers=_bearer(expired)).status_code == 401


def test_token_whose_user_no_longer_exists_is_401(client, sign_in, test_db):
    from app.db.models import User

    user = sign_in()
    token = sign_access_token(user)
    with test_db() as s:
        s.query(User).filter(User.id == user["id"]).delete()
        s.commit()
    assert client.get("/auth/me", headers=_bearer(token)).status_code == 401


def test_protected_router_still_rejects_anonymous(client, test_db):
    """The pipeline routers gate on this dependency; confirm the gate survived."""
    assert client.get("/stocks").status_code == 401


def test_protected_router_accepts_a_bearer_token(client, sign_in):
    sign_in()
    res = client.get("/stocks")
    assert res.status_code == 200


def test_query_string_cannot_smuggle_a_token(client, sign_in):
    """Tokens must arrive in the header only — not in the URL, where they leak
    into logs, referrers and history."""
    user = sign_in()
    del client.headers["Authorization"]  # sign_in armed the client; clear it
    res = client.get(f"/auth/me?access_token={sign_access_token(user)}")
    assert res.status_code == 401


def test_lowercase_bearer_scheme_is_accepted(client, sign_in):
    """RFC 7235 says the scheme is case-insensitive; proxies rewrite it."""
    user = sign_in()
    res = client.get("/auth/me", headers={"Authorization": f"bearer {sign_access_token(user)}"})
    assert res.status_code == 200


def test_extra_whitespace_after_bearer_is_tolerated(client, sign_in):
    user = sign_in()
    res = client.get("/auth/me", headers={"Authorization": f"Bearer   {sign_access_token(user)}"})
    assert res.status_code == 200


def test_session_cookie_is_no_longer_accepted(client, sign_in):
    """The old mechanism must be dead, not merely unused: a leftover cookie grants nothing."""
    from base64 import b64encode
    import json

    from itsdangerous import TimestampSigner

    from app.auth.security import auth_secret

    user = sign_in()
    del client.headers["Authorization"]  # prove the cookie alone is not enough
    payload = b64encode(json.dumps({"user_id": user["id"]}).encode("utf-8"))
    client.cookies.set("sa_session", TimestampSigner(str(auth_secret())).sign(payload).decode())
    res = client.get("/auth/me")
    assert res.status_code == 401
