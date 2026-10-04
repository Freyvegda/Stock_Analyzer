"""Detail exposes stored screener price for header fallback when chart fails."""
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db import models  # noqa: F401
from app.db.database import Base
from app.db.models import Fundamental, Stock
from app.stock import service


def test_detail_exposes_stored_price():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as s:
        s.add(Stock(symbol="AAA", name="Alpha", sector="IT", market_cap=5000.0))
        s.add(models.User(username="u", password_hash="x", created_at="now"))
        s.commit()
    with factory() as s:
        user = s.query(models.User).first()
        uid = user.id
        s.add(models.ScreeningSet(user_id=uid, name="Default", criteria_json="[]",
                                  thesis=None, shortlist_size=10, is_active=True,
                                  updated_at="now"))
        s.add(Fundamental(symbol="AAA", date="2026-10-04", pe=20.0, pb=3.0, roe=25.0,
                          roce=20.0, debt_to_equity=0.2, data_status="ok",
                          raw_json=json.dumps({"price": 2500.0})))
        s.commit()
    # Fake provider must not be called (stored-first).
    class P:
        def fundamentals(self, symbol, cached=None):
            raise AssertionError("network must not run with stored snapshot")
        def ohlc(self, symbol, years=5):
            raise AssertionError("ohlc not used here")
    out = service.get_stock_detail(factory, P(), uid, "AAA")
    assert out["price"] == 2500.0
    assert out["price_as_of"] == "2026-10-04"
