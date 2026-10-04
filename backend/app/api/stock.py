"""Stock detail API: thin routers — validation plus service calls (BACKEND.md rule 6).

Stock data is shared across users; the report inside each response is computed
against the caller's saved criteria. Daily candles are served from a
process-memory cache and never written to the database.
"""

import hashlib
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from app.auth.deps import current_user
from app.data.composite_impl import build_default_provider
from app.data.provider import DataProvider
from app.db.database import SessionLocal, init_db
from app.screener.service import SetNotFoundError
from app.stock import service
from app.stock.candles import CandleCache

router = APIRouter()

default_cache = CandleCache()


def get_provider() -> DataProvider:
    return build_default_provider()


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


@router.get("/{symbol}/report")
def get_report(symbol: str, set_id: int, user: dict = Depends(current_user)) -> dict:
    init_db()
    normalized = _normalize(symbol)
    try:
        return service.get_single_report(
            SessionLocal, get_provider(), user["id"], normalized, set_id
        )
    except service.StockNotFound:
        raise _unknown(normalized) from None
    except SetNotFoundError:
        raise HTTPException(status_code=404, detail="Screen not found") from None
    except service.StockDataUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/{symbol}/ohlc")
def get_ohlc(
    symbol: str,
    request: Request,
    range_key: Literal["6m", "1y", "2y", "5y"] = Query("1y", alias="range"),
    interval: Literal["1d", "15d", "1mo"] = "1d",
    user: dict = Depends(current_user),
):
    init_db()
    normalized = _normalize(symbol)
    try:
        body = service.get_ohlc(
            SessionLocal, get_provider(), normalized, range_key, interval, default_cache
        )
    except service.StockNotFound:
        raise _unknown(normalized) from None
    except service.PriceDataUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    etag = hashlib.sha256(
        json.dumps(
            [body["symbol"], body["range"], body["interval"], body["as_of"], len(body["candles"])]
        ).encode()
    ).hexdigest()[:32]
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(
        content=body,
        headers={"Cache-Control": "public, max-age=900", "ETag": etag},
    )
