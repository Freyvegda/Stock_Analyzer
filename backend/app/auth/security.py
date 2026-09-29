"""Auth primitives: scrypt password hashing, access-token signing, the auth secret.

Budget 0 still holds for *usage* (no paid API keys); PyJWT is the one
external auth dependency, added in Phase 1.8 to avoid hand-rolling HS256
encoding, algorithm pinning and expiry checks. Password hashing stays stdlib
(hashlib.scrypt)  there was no reason to move it.

Access tokens are HS256 JWTs signed with the persisted secret. Refresh tokens
are *not* JWTs: they are opaque random strings stored hashed in `auth_sessions`,
because they must be revocable and slide on use (see `app.auth.service`).

Format of a stored password: ``scrypt$n$r$p$<salt_b64>$<hash_b64>``.
"""

import base64
import hashlib
import os
import secrets
import time
import uuid

import jwt

#: 15 minutes. Short enough that a stolen access token is useless quickly;
#: the refresh token is what keeps a session alive.
ACCESS_TTL_SECONDS = 15 * 60

#: The only algorithm we sign or accept. Pinning this is what makes the
#: `alg: none` and algorithm-substitution forgeries fail.
JWT_ALGORITHM = "HS256"

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16

#: Written on first use; deleting/rotating it invalidates every access token.
SECRET_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", ".auth_secret")
)


class InvalidToken(Exception):
    """Any access token we will not accept: bad signature, expired, wrong shape."""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P
    )
    return (
        f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}"
        f"${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p)
        )
    except (ValueError, TypeError):
        return False
    return secrets.compare_digest(actual, expected)


def auth_secret() -> str:
    """Read the signing secret, creating it on first use (rotating = logout all)."""
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, encoding="utf-8") as f:
            secret = f.read().strip()
        if secret:
            return secret
    os.makedirs(os.path.dirname(SECRET_PATH), exist_ok=True)
    secret = secrets.token_urlsafe(32)
    with open(SECRET_PATH, "w", encoding="utf-8") as f:
        f.write(secret)
    return secret


def sign_access_token(user: dict, ttl_seconds: int = ACCESS_TTL_SECONDS) -> str:
    """Mint an access token for `user` (`{"id": int, "username": str}`)."""
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(user["id"]),  # RFC 7519: sub is a string
            "username": user["username"],
            "typ": "access",  # a refresh token must never pass as an access token
            "iat": now,
            "exp": now + ttl_seconds,
            "jti": uuid.uuid4().hex,
        },
        auth_secret(),
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    """Return the token's claims, or raise `InvalidToken`.

    Callers must not leak *why* it failed  a detail string is enough to
    distinguish an expired token from a forged one.
    """
    try:
        claims = jwt.decode(
            token,
            auth_secret(),
            algorithms=[JWT_ALGORITHM],  # pinned: rejects alg:none and HS*/RS* swaps
            options={
                "require": ["exp", "sub", "iat", "typ"],
                "verify_signature": True,
            },
        )
    except jwt.PyJWTError as exc:
        raise InvalidToken("Invalid or expired access token") from exc
    # `require` only proves the claim is present, not that it says what we mean.
    # A refresh token minted with typ="refresh" must never pass as an access token.
    if claims.get("typ") != "access":
        raise InvalidToken("Invalid or expired access token")
    return claims
