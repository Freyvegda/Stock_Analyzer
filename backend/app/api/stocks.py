"""`/stocks` API: thin router — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends

from app.auth.deps import current_user
from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.stock import universe

router = APIRouter()


def get_provider() -> DataProvider:
    return YFinanceProvider()


@router.get("")
def stocks(user: dict = Depends(current_user)) -> dict:
    init_db()
    return universe.list_universe(SessionLocal, get_provider(), user["id"])
