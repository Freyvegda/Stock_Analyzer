"""Screen API: thin routers — validation plus service calls (BACKEND.md rule 6)."""

from fastapi import APIRouter, HTTPException

from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.screener import service
from app.screener.config import load_config, reload_config

router = APIRouter()


def get_provider() -> DataProvider:
    return YFinanceProvider()


@router.post("/run")
def run_screen() -> dict:
    init_db()
    return service.run_screen(get_provider(), SessionLocal, load_config())


@router.get("/latest")
def latest_screen() -> dict:
    init_db()
    latest = service.latest_screen(SessionLocal)
    if latest is None:
        raise HTTPException(status_code=404, detail="No screen run yet")
    return latest


@router.get("/config")
def get_config() -> dict:
    return load_config()


@router.post("/config/reload")
def reload() -> dict:
    return reload_config()
