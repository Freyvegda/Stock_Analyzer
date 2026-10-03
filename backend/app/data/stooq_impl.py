"""Stooq free daily CSV implementation of OHLC.

One request per symbol returns years of daily bars. No cookies, no key.
``fundamentals``/``list_stocks``/``filings`` are not this provider's job
and raise NotImplementedError — the composite owns those paths.
"""

import csv
import io
import time
from datetime import date, timedelta

import httpx
import pandas as pd

from app.data.provider import DataProvider

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def stooq_symbol(symbol: str) -> str:
    """Map bare NSE symbol to Stooq ticker (NSE = `.NS` suffix)."""
    symbol = (symbol or "").strip().upper()
    if symbol.endswith(".NS") or symbol.endswith(".BO"):
        return symbol
    return f"{symbol}.NS"


def parse_stooq_csv(text: str) -> list[dict]:
    """Parse Stooq CSV to ascending clean daily rows."""
    reader = csv.DictReader(io.StringIO(text or ""))
    rows: list[dict] = []
    for record in reader:
        day = (record.get("Date") or "").strip()
        try:
            close = float(record.get("Close"))
        except (TypeError, ValueError):
            continue
        if pd.isna(close) or not day:
            continue
        try:
            row = {
                "time": day,
                "open": float(record.get("Open")),
                "high": float(record.get("High")),
                "low": float(record.get("Low")),
                "close": float(close),
                "volume": float(record.get("Volume") or 0.0),
            }
        except (TypeError, ValueError):
            continue
        if any(pd.isna(row[key]) for key in ("open", "high", "low", "close")):
            continue
        rows.append(row)
    rows.sort(key=lambda r: r["time"])
    return rows


class StooqProvider(DataProvider):
    def list_stocks(self) -> list[dict]:
        raise NotImplementedError

    def fundamentals(self, symbol: str) -> dict:
        raise NotImplementedError

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """Daily bars ascending; empty list when Stooq has no data."""
        end = date.today()
        start = end - timedelta(days=int(years) * 365 + 30)
        url = (
            "https://stooq.com/q/d/l/?s="
            f"{stooq_symbol(symbol).lower()}"
            f"&d1={start.strftime('%Y%m%d')}&d2={end.strftime('%Y%m%d')}&i=d"
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = httpx.get(url, headers=_UA, timeout=20, follow_redirects=True)
                resp.raise_for_status()
                return parse_stooq_csv(resp.text)
            except Exception as e:  # noqa: BLE001 — retry then propagate
                last_error = e
                time.sleep(0.5 * (attempt + 1))
        raise last_error  # type: ignore[misc]

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
