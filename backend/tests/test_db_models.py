from datetime import datetime, timezone

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401 — register tables
from app.db.database import Base, _sqlite_pragmas, configure_sqlite


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


def test_screening_sets_table_columns(tmp_path):
    insp = inspect(make_engine(tmp_path))
    cols = {c["name"]: c for c in insp.get_columns("screening_sets")}
    assert set(cols) == {
        "id",
        "user_id",
        "name",
        "criteria_json",
        "thesis",
        "shortlist_size",
        "is_active",
        "updated_at",
    }
    assert cols["user_id"]["nullable"] is False
    assert cols["name"]["nullable"] is False
    assert cols["criteria_json"]["nullable"] is False
    uniques = insp.get_unique_constraints("screening_sets")
    assert any(c["column_names"] == ["user_id", "name"] for c in uniques)
    indexes = insp.get_indexes("screening_sets")
    assert any(c["column_names"] == ["user_id"] for c in indexes)


def test_user_criteria_is_retired(tmp_path):
    names = inspect(make_engine(tmp_path)).get_table_names()
    assert "user_criteria" not in names


def test_screen_runs_has_set_id(tmp_path):
    cols = {c["name"] for c in inspect(make_engine(tmp_path)).get_columns("screen_runs")}
    assert {"user_id", "set_id", "criteria_json", "shortlisted_json"} <= cols
    assert "config_yaml" not in cols


def test_screen_runs_triggered_by_defaults_manual(tmp_path):
    engine = make_engine(tmp_path)
    cols = {c["name"]: c for c in inspect(engine).get_columns("screen_runs")}
    assert "triggered_by" in cols
    assert cols["triggered_by"]["nullable"] is False
    TestSession = sessionmaker(bind=engine)
    with TestSession() as session:
        row = models.ScreenRun(
            run_date="2026-10-03",
            user_id=1,
            criteria_json="[]",
            shortlisted_json="[]",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        assert row.triggered_by == "manual"


def test_screening_set_defaults(tmp_path):
    engine = make_engine(tmp_path)
    TestSession = sessionmaker(bind=engine)
    with TestSession() as session:
        row = models.ScreeningSet(
            user_id=1,
            name="Default",
            criteria_json="[]",
            updated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        assert row.shortlist_size == 10
        assert row.is_active is False
        assert row.thesis is None


def test_job_tables_exist(tmp_path):
    insp = inspect(make_engine(tmp_path))
    assert insp.has_table("run_jobs")
    assert insp.has_table("run_job_items")
    indexes = insp.get_indexes("run_job_items")
    assert any(i["column_names"] == ["job_id"] for i in indexes)


def test_run_job_item_fks_are_nullable(tmp_path):
    insp = inspect(make_engine(tmp_path))
    item_cols = {c["name"]: c for c in insp.get_columns("run_job_items")}
    assert item_cols["run_id"]["nullable"] is True
    assert item_cols["job_id"]["nullable"] is False
    assert item_cols["set_id"]["nullable"] is False
    assert item_cols["status"]["nullable"] is False
    job_cols = {c["name"]: c for c in insp.get_columns("run_jobs")}
    assert job_cols["finished_at"]["nullable"] is True
    assert job_cols["error"]["nullable"] is True
    assert job_cols["status"]["nullable"] is False


def test_configure_sqlite_sets_wal_and_busy_timeout(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/pragmas.db")
    configure_sqlite(engine)
    assert event.contains(engine, "connect", _sqlite_pragmas)
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
    engine.dispose()


def test_configure_sqlite_skips_other_dialects(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/other.db")
    monkeypatch.setattr(engine.dialect, "name", "postgresql")
    configure_sqlite(engine)
    assert event.contains(engine, "connect", _sqlite_pragmas) is False
    engine.dispose()
