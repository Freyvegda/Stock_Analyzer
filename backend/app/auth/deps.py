"""FastAPI dependency: resolve an `Authorization: Bearer` access token to a user.

401 with a single generic detail everywhere — the frontend listens for it and
redirects to /login. The detail never says *why* a token failed: "expired" and
"forged" must be indistinguishable to an attacker probing the endpoint.
"""

from fastapi import HTTPException, Request

from app.auth import service
from app.auth.security import InvalidToken, decode_access_token
from app.db.database import SessionLocal

BEARER_PREFIX = "bearer"


def _bearer_token(request: Request) -> str | None:
    """Pull the token out of the Authorization header, or None if absent/garbage.

    RFC 7235 makes the auth-scheme case-insensitive, and proxies and some
    clients reformat the header, so both the scheme and the padding after it
    are matched leniently.
    """
    header = request.headers.get("Authorization")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != BEARER_PREFIX:
        return None
    token = parts[1].strip()
    return token or None


def current_user(request: Request) -> dict:
    token = _bearer_token(request)
    if token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        claims = decode_access_token(token)
    except InvalidToken:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # The token is signed, but the user behind it may have been deleted since
    # (DB reset, account removal) — the row is the authority, not the token.
    user = service.get_user(SessionLocal, int(claims["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
