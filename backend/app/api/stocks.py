"""`/stocks` API: thin router — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import current_user
from app.data.composite_impl import build_default_provider
from app.data.provider import DataProvider
from app.db.database import SessionLocal, init_db
from app.screener import service as screener_service
from app.stock import universe

router = APIRouter()


def get_provider() -> DataProvider:
    return build_default_provider()


@router.get("")
def stocks(user: dict = Depends(current_user), set_id: int | None = Query(default=None)) -> dict:
    init_db()
    try:
        return universe.list_universe(SessionLocal, get_provider(), user["id"], set_id)
    except screener_service.SetNotFoundError:
        raise HTTPException(status_code=404, detail="Screen not found")
