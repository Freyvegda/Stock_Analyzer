"""Stock detail API: thin routers — validation plus service calls (BACKEND.md rule 6).

Stock data is shared across users; the report inside each response is computed
against the caller's saved criteria. Daily candles are served from a
process-memory cache and never written to the database.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import current_user
from app.data.provider import DataProvider
from app.data.yfinance_impl import YFinanceProvider
from app.db.database import SessionLocal, init_db
from app.stock import service
from app.stock.candles import CandleCache

router = APIRouter()

default_cache = CandleCache()


def get_provider() -> DataProvider:
    return YFinanceProvider()


def _normalize(symbol: str) -> str:
    return symbol.strip().upper()


def _unknown(symbol: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Unknown symbol {symbol}")


@router.get("/{symbol}")
def get_stock(symbol: str, user: dict = Depends(current_user)) -> dict:
    init_db()
    normalized = _normalize(symbol)
    try:
        return service.get_stock_detail(SessionLocal, get_provider(), user["id"], normalized)
    except service.StockNotFound:
        raise _unknown(normalized) from None
    except service.StockDataUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/{symbol}/refresh")
def refresh_stock(symbol: str, user: dict = Depends(current_user)) -> dict:
    init_db()
    normalized = _normalize(symbol)
    try:
        return service.refresh_stock(SessionLocal, get_provider(), user["id"], normalized)
    except service.StockNotFound:
        raise _unknown(normalized) from None
    except service.StockDataUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/{symbol}/ohlc")
def get_ohlc(
    symbol: str,
    range_key: Literal["6m", "1y", "2y", "5y"] = Query("1y", alias="range"),
    interval: Literal["1d", "15d", "1mo"] = "1d",
    user: dict = Depends(current_user),
) -> dict:
    init_db()
    normalized = _normalize(symbol)
    try:
        return service.get_ohlc(
            SessionLocal, get_provider(), normalized, range_key, interval, default_cache
        )
    except service.StockNotFound:
        raise _unknown(normalized) from None
    except service.PriceDataUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
