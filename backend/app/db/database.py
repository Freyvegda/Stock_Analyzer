import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "stockanalyzer.db")
)

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    # WAL: readers stay unblocked while a background job writes.
    # busy_timeout: wait out short writer locks instead of "database is locked".
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def configure_sqlite(engine) -> None:
    """WAL + busy_timeout for SQLite only; other dialects untouched."""
    if engine.dialect.name != "sqlite":
        return
    event.listen(engine, "connect", _sqlite_pragmas)


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
configure_sqlite(engine)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from app.db import models  # noqa: F401 — register tables

    Base.metadata.create_all(engine)
