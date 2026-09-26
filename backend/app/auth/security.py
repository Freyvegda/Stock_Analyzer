"""Auth primitives: scrypt password hashing and the persisted session secret.

No external auth dependencies (budget ₹0): stdlib hashlib.scrypt + itsdangerous
(Starlette's signer). Format: ``scrypt$n$r$p$<salt_b64>$<hash_b64>``.
"""

import base64
import hashlib
import os
import secrets

#: 30 days, the session cookie lifetime.
SESSION_MAX_AGE = 30 * 24 * 60 * 60

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16

#: Written on first use; deleting/rotating it invalidates all sessions.
SECRET_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", ".session_secret")
)


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


def session_secret() -> str:
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
