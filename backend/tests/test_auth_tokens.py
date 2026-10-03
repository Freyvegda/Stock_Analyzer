"""Access-token signing and verification (PyJWT, HS256 only).

The forged-token cases build their tokens directly with `jwt.encode` rather than
going through `sign_access_token`, so the tests never depend on the code they
are checking.
"""

import time

import jwt
import pytest

from app.auth import security

USER = {"id": 7, "username": "alice"}


def test_access_token_round_trip_carries_identity():
    claims = security.decode_access_token(security.sign_access_token(USER))
    assert claims["sub"] == "7"
    assert claims["username"] == "alice"
    assert claims["typ"] == "access"


def test_access_token_sub_is_the_string_user_id():
    # JWT `sub` must be a string per RFC 7519; an int breaks strict decoders.
    claims = security.decode_access_token(security.sign_access_token(USER))
    assert isinstance(claims["sub"], str)


def test_access_token_lifetime_is_fifteen_minutes():
    assert security.ACCESS_TTL_SECONDS == 15 * 60


def test_round_trip_token_carries_a_jti():
    a = security.decode_access_token(security.sign_access_token(USER))
    b = security.decode_access_token(security.sign_access_token(USER))
    assert a["jti"] != b["jti"]  # two tokens for the same user are distinguishable


def _forged(secret: str, **overrides) -> str:
    now = int(time.time())
    claims = {
        "sub": "7",
        "username": "alice",
        "typ": "access",
        "iat": now,
        "exp": now + 900,
        "jti": "forged",
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm="HS256")


def test_expired_token_is_rejected():
    now = int(time.time())
    token = _forged(security.auth_secret(), iat=now - 7200, exp=now - 3600)
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(token)


def test_token_signed_with_a_different_secret_is_rejected():
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(_forged("a" * 64))


def test_tampered_payload_is_rejected():
    token = security.sign_access_token(USER)
    head, payload, sig = token.split(".")
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(f"{head}.{payload}x.{sig}")


def test_alg_none_forgery_is_rejected():
    # The canonical JWT attack: strip the signature and ask the verifier to
    # trust the payload. Rejected only if `algorithms` is pinned.
    now = int(time.time())
    unsigned = jwt.encode(
        {"sub": "7", "username": "alice", "typ": "access", "iat": now, "exp": now + 900},
        key="",
        algorithm="none",
    )
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(unsigned)


def test_asymmetric_algorithm_is_refused():
    # An HS256 verifier handed an RS256 token must not try to treat the public
    # key as an HMAC secret.
    now = int(time.time())
    token = jwt.encode(
        {"sub": "7", "typ": "access", "iat": now, "exp": now + 900},
        key="x" * 64,
        algorithm="HS384",
    )
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(token)


def test_token_without_typ_is_rejected():
    # A refresh token must never be usable as an access token.
    now = int(time.time())
    token = jwt.encode(
        {"sub": "7", "username": "alice", "iat": now, "exp": now + 900},
        security.auth_secret(),
        algorithm="HS256",
    )
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(token)


def test_garbage_input_is_rejected_not_raised_raw():
    for bad in ("", "not-a-token", "a.b", "a.b.c.d"):
        with pytest.raises(security.InvalidToken):
            security.decode_access_token(bad)


def test_auth_secret_is_stable_and_created_once(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "SECRET_PATH", str(tmp_path / ".auth_secret"))
    first = security.auth_secret()
    assert first == security.auth_secret()
    assert len(first) >= 32


def test_rotating_the_secret_invalidates_existing_tokens(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "SECRET_PATH", str(tmp_path / ".auth_secret"))
    token = security.sign_access_token(USER)
    (tmp_path / ".auth_secret").write_text("b" * 64, encoding="utf-8")
    with pytest.raises(security.InvalidToken):
        security.decode_access_token(token)
