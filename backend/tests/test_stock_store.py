"""Storage policy: raw_json whitelist + company_profiles upsert/read."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401 — register tables
from app.db.database import Base
from app.db.models import CompanyProfile
from app.stock import store

INFO = {
    "forwardPE": 18.5,
    "totalRevenue": 9.3e12,
    "longBusinessSummary": "Makes things",
    "sector": "Energy",
    "industry": "Oil & Gas",
    "website": "https://x.test",
    "fullTimeEmployees": 350000,
    "city": "Mumbai",
    "state": "Maharashtra",
    "country": "India",
    "junkField": "drop me",
    "emptyField": "",
}


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/store.db")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_trim_raw_keeps_whitelist_drops_the_rest():
    trimmed = store.trim_raw(INFO)

    assert trimmed["forwardPE"] == 18.5
    assert trimmed["totalRevenue"] == 9.3e12
    assert "longBusinessSummary" not in trimmed
    assert "junkField" not in trimmed
    assert "emptyField" not in trimmed  # empty strings never persist


def test_upsert_profile_twice_keeps_one_row(session_factory):
    with session_factory() as session:
        store.upsert_profile(session, "AAA", INFO, "2026-09-27")
        store.upsert_profile(session, "AAA", {**INFO, "industry": "Refining"}, "2026-09-28")
        session.commit()

        rows = session.query(CompanyProfile).all()
        assert len(rows) == 1
        assert rows[0].symbol == "AAA"
        assert rows[0].industry == "Refining"
        assert rows[0].updated_at == "2026-09-28"


def test_read_profile_joins_hq_and_coerces_employees(session_factory):
    with session_factory() as session:
        store.upsert_profile(session, "AAA", INFO, "2026-09-27")
        session.commit()

        profile = store.read_profile(session, "AAA")

    assert profile == {
        "description": "Makes things",
        "industry": "Oil & Gas",
        "sector": "Energy",
        "website": "https://x.test",
        "employees": 350000,
        "hq": "Mumbai, Maharashtra, India",
    }


def test_read_profile_absent_returns_nulls(session_factory):
    with session_factory() as session:
        profile = store.read_profile(session, "NOPE")

    assert set(profile) == {"description", "industry", "sector", "website", "employees", "hq"}
    assert all(value is None for value in profile.values())
