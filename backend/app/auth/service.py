"""User lifecycle: create / authenticate, and refresh-session issuance.

One account in practice; the schema is multi-user-ready (see the Phase 1.5
spec).

Sessions are a pair: a stateless 15-minute access token (signed JWT, never
stored) and a revocable refresh token (opaque, only its SHA-256 in
`auth_sessions`). Refresh *rotates* — using one issues a new one and revokes
the old, so a captured token dies on its next use. That rotation is why the
client must single-flight refreshes; four parallel calls would invalidate each
other.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from threading import Lock

from sqlalchemy.exc import IntegrityError

from app.auth.security import hash_password, verify_password
from app.db.models import AuthSession, User


class UserExistsError(Exception):
    """Raised when setup would create a second account (409)."""


#: Setup is check-then-insert; serializing it stops two tabs with different
#: usernames from both creating an account (unique(username) does not).
_SETUP_LOCK = Lock()


#: A refresh session dies after this long without a refresh. The client also
#: counts 3h of real user activity and logs out locally; this is the server-side
#: backstop for a tab that was closed (or a machine that slept) and came back.
IDLE_SECONDS = 3 * 60 * 60

#: Refresh cookies are HttpOnly + SameSite=Strict. `path="/"` rather than
#: "/auth": the browser matches cookie path against the URL the *client* requested
#: (`/api/auth/refresh` through the Vite proxy), so a narrower path would silently
#: never be sent.
REFRESH_COOKIE = "sa_refresh"
REFRESH_COOKIE_MAX_AGE = IDLE_SECONDS


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def hash_refresh_token(token: str) -> str:
    """SHA-256 hex. Only this is persisted, so a DB leak yields nothing usable."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def users_exist(session_factory) -> bool:
    with session_factory() as session:
        return session.query(User).first() is not None


def create_user(session_factory, username: str, password: str) -> dict:
    username = username.strip().lower()
    with _SETUP_LOCK:
        with session_factory() as session:
            if session.query(User).first() is not None:  # single account (multi-user-ready schema)
                raise UserExistsError("Account already exists")
            user = User(username=username, password_hash=hash_password(password), created_at=_now())
            session.add(user)
            try:
                session.commit()
            except IntegrityError as e:  # belt-and-braces: DB unique constraint
                session.rollback()
                raise UserExistsError("Account already exists") from e
            session.refresh(user)
            return {"id": user.id, "username": user.username}


def authenticate(session_factory, username: str, password: str) -> dict | None:
    with session_factory() as session:
        user = session.query(User).filter(User.username == username.strip().lower()).first()
    if user is None or not verify_password(password, user.password_hash):
        return None
    return {"id": user.id, "username": user.username}


def get_user(session_factory, user_id: int) -> dict | None:
    with session_factory() as session:
        user = session.get(User, user_id)
    if user is None:
        return None
    return {"id": user.id, "username": user.username}


# --- refresh sessions ------------------------------------------------------


def sweep_sessions(session) -> int:
    """Delete rows that can no longer authenticate: revoked, or idle past the window.

    Called on login. A live session slides `last_seen_at` on every refresh, so a
    row idle beyond the window is unreachable by definition and is only taking up
    space. Returns the number of rows removed.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=IDLE_SECONDS)).isoformat(
        timespec="seconds"
    )
    dead = (
        session.query(AuthSession)
        .filter(
            (AuthSession.revoked_at.isnot(None))
            | (AuthSession.last_seen_at < cutoff)
        )
        .all()
    )
    for row in dead:
        session.delete(row)
    session.commit()  # a `with` block rolls back on exit — without this the sweep is a no-op
    return len(dead)


def issue_refresh_token(session_factory, user_id: int) -> str:
    """Create a refresh session and return the raw token (the only time it exists in the clear)."""
    token = secrets.token_urlsafe(32)
    now = _now()
    with session_factory() as session:
        session.add(
            AuthSession(
                user_id=user_id,
                token_hash=hash_refresh_token(token),
                created_at=now,
                last_seen_at=now,
                revoked_at=None,
            )
        )
        session.commit()
    return token


def rotate_session(session_factory, token: str) -> tuple[dict | None, str | None]:
    """Consume `token`, returning `(user, replacement_token)`. `(None, None)` if unusable.

    Returns the user in the same transaction that slides the session, so a
    response can never be built from a session that was revoked a moment later.

    Invalid when: unknown hash, already revoked, idle past `IDLE_SECONDS`, or the
    owning user no longer exists. An unusable-but-known session is revoked on the
    way out — once past the window or without a user it must not come back.
    """
    now = datetime.now(timezone.utc)
    stamp = now.isoformat(timespec="seconds")
    with session_factory() as session:
        row = (
            session.query(AuthSession)
            .filter(AuthSession.token_hash == hash_refresh_token(token))
            .one_or_none()
        )
        if row is None:
            return None, None
        if row.revoked_at is not None:
            return None, None
        user_row = session.get(User, row.user_id)
        expired = now - _parse(row.last_seen_at) > timedelta(seconds=IDLE_SECONDS)
        if expired or user_row is None:
            row.revoked_at = stamp
            session.commit()
            return None, None

        replacement = secrets.token_urlsafe(32)
        row.token_hash = hash_refresh_token(replacement)
        row.last_seen_at = stamp
        session.commit()
        return {"id": user_row.id, "username": user_row.username}, replacement


def revoke_refresh_token(session_factory, token: str | None) -> bool:
    """Mark a session revoked. Idempotent, and safe with no token at all.

    True when a row was revoked, False when there was nothing to revoke. Callers
    must not treat False as an error: logout that finds no session has still
    achieved what the client asked for.
    """
    if not token:
        return False
    with session_factory() as session:
        row = (
            session.query(AuthSession)
            .filter(AuthSession.token_hash == hash_refresh_token(token))
            .one_or_none()
        )
        if row is None or row.revoked_at is not None:
            return False
        row.revoked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        session.commit()
        return True
