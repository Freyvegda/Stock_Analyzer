"""User lifecycle: create / authenticate / seed default criteria.

One account in practice; the schema is multi-user-ready (see the Phase 1.5
spec). Sessions are stateless signed cookies — there is no sessions table.
"""

from datetime import datetime, timezone
from threading import Lock

from sqlalchemy.exc import IntegrityError

from app.auth.security import hash_password, verify_password
from app.db.models import User


class UserExistsError(Exception):
    """Raised when setup would create a second account (409)."""


#: Setup is check-then-insert; serializing it stops two tabs with different
#: usernames from both creating an account (unique(username) does not).
_SETUP_LOCK = Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
