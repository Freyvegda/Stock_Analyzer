"""Screen API: thin routers — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import current_user
from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.screener import service
from app.screener.catalog import RATIO_CATALOG
from app.screener.config import load_config, reload_config
from app.screener.criteria import CriteriaUpdate

router = APIRouter()


def get_provider() -> DataProvider:
    return YFinanceProvider()


@router.get("/ratios")
def ratios(user: dict = Depends(current_user)) -> list[dict]:
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "unit": spec.unit,
            "category": spec.category,
            "direction": spec.direction,
        }
        for spec in RATIO_CATALOG
    ]


@router.get("/criteria")
def get_criteria(user: dict = Depends(current_user)) -> dict:
    init_db()
    return service.get_criteria(SessionLocal, user["id"])


@router.put("/criteria")
def put_criteria(payload: CriteriaUpdate, user: dict = Depends(current_user)) -> dict:
    init_db()
    return service.save_criteria(
        SessionLocal, user["id"], [item.model_dump() for item in payload.criteria], payload.thesis
    )


@router.post("/run")
def run_screen(user: dict = Depends(current_user)) -> dict:
    init_db()
    stored = service.get_criteria(SessionLocal, user["id"])
    return service.run_screen(
        get_provider(), SessionLocal, user, stored["criteria"], stored["shortlist_size"]
    )


@router.get("/latest")
def latest_screen(user: dict = Depends(current_user)) -> dict:
    init_db()
    latest = service.latest_screen(SessionLocal, user["id"])
    if latest is None:
        raise HTTPException(status_code=404, detail="No screen run yet")
    return latest


@router.get("/config")
def get_config() -> dict:
    return load_config()


@router.post("/config/reload")
def reload() -> dict:
    return reload_config()
