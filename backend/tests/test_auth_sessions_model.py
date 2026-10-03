"""`auth_sessions` schema: one row per issued refresh token.

The row is the whole revocation story. Without it a refresh token would be a
bearer credential that could only be invalidated by rotating a secret — which
logs out every user, not one. Everything else here supports the 3h sliding
idle rule: `last_seen_at` is what a refresh slides, and `revoked_at` is what
logout writes.
"""

from sqlalchemy import create_engine, inspect

from app.db.database import Base
from app.db.models import AuthSession, User


def _engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/models.db")
    Base.metadata.create_all(engine)
    return engine


def test_auth_sessions_table_exists_and_has_exact_columns(tmp_path):
    cols = {c["name"] for c in inspect(_engine(tmp_path)).get_columns("auth_sessions")}
    assert cols == {
        "id",
        "user_id",
        "token_hash",
        "created_at",
        "last_seen_at",
        "revoked_at",
    }


def test_token_hash_is_unique(tmp_path):
    """Two rows may not share a hash — that would make one token valid twice."""
    engine = _engine(tmp_path)
    uniques = {tuple(c["column_names"]) for c in inspect(engine).get_unique_constraints("auth_sessions")}
    assert ("token_hash",) in uniques


def test_duplicate_token_hash_is_rejected_by_the_database(tmp_path):
    """Prove the constraint bites, not just that it is declared."""
    from datetime import datetime, timezone

    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import sessionmaker

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    Session = sessionmaker(bind=_engine(tmp_path))
    with Session() as s:
        s.add(AuthSession(user_id=1, token_hash="same", created_at=now, last_seen_at=now))
        s.commit()
    with Session() as s:
        s.add(AuthSession(user_id=1, token_hash="same", created_at=now, last_seen_at=now))
        try:
            s.commit()
        except IntegrityError:
            return
        raise AssertionError("duplicate token_hash was accepted")


def test_user_id_is_indexed_and_foreign(tmp_path):
    """Session lookup is always by user (logout-all, sweep) and by hash (refresh)."""
    engine = _engine(tmp_path)
    idx = inspect(engine).get_indexes("auth_sessions")
    assert any(i["column_names"] == ["user_id"] for i in idx)
    fks = inspect(engine).get_foreign_keys("auth_sessions")
    assert fks and fks[0]["referred_table"] == "users"


def test_revoke_defaults_to_null_and_timestamps_are_strings(tmp_path):
    """A live session is `revoked_at IS NULL`; dates are ISO strings, per repo rule."""
    from datetime import datetime, timezone

    from sqlalchemy.orm import sessionmaker

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    Session = sessionmaker(bind=_engine(tmp_path))
    with Session() as s:
        s.add(AuthSession(user_id=1, token_hash="deadbeef", created_at=now, last_seen_at=now))
        s.commit()
        row = s.query(AuthSession).one()
        assert row.revoked_at is None
        assert isinstance(row.last_seen_at, str)


def test_user_id_is_not_nullable(tmp_path):
    from sqlalchemy import inspect as sa_inspect

    cols = {c["name"]: c for c in sa_inspect(_engine(tmp_path)).get_columns("auth_sessions")}
    assert cols["user_id"]["nullable"] is False
    assert cols["token_hash"]["nullable"] is False
    assert cols["revoked_at"]["nullable"] is True


def test_no_column_can_hold_a_raw_token(tmp_path):
    """`token_hash` is the only token-ish column — nothing to leak a usable value."""
    cols = {c["name"] for c in inspect(_engine(tmp_path)).get_columns("auth_sessions")}
    assert "token_hash" in cols
    assert not (cols - {"token_hash"}) & {"token", "raw_token", "token_value", "secret"}
