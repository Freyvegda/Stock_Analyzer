from sqlalchemy import create_engine, inspect

from app.db import models  # noqa: F401 — register tables
from app.db.database import Base


def make_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/schema.db")
    Base.metadata.create_all(engine)
    return engine


def test_users_table_columns(tmp_path):
    insp = inspect(make_engine(tmp_path))
    cols = {c["name"]: c for c in insp.get_columns("users")}
    assert set(cols) == {"id", "username", "password_hash", "created_at"}
    assert cols["username"]["nullable"] is False
    assert cols["password_hash"]["nullable"] is False
    uniques = insp.get_unique_constraints("users")
    assert any(c["column_names"] == ["username"] for c in uniques)


def test_user_criteria_table_columns(tmp_path):
    cols = {c["name"] for c in inspect(make_engine(tmp_path)).get_columns("user_criteria")}
    assert cols == {"user_id", "criteria_json", "thesis", "shortlist_size", "updated_at"}


def test_screen_runs_is_user_scoped(tmp_path):
    cols = {c["name"] for c in inspect(make_engine(tmp_path)).get_columns("screen_runs")}
    assert {"user_id", "criteria_json", "shortlisted_json"} <= cols
    assert "config_yaml" not in cols
