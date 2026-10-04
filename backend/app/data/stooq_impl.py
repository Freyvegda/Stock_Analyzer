"""Stooq free daily CSV implementation of OHLC.

One request per symbol returns years of daily bars. No cookies, no key.
``fundamentals``/``list_stocks``/``filings`` are not this provider's job
and raise NotImplementedError — the composite owns those paths.
"""

import csv
import io
import math
import time
from datetime import date, timedelta

import httpx

from app.data.provider import DataProvider

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

#: Single-request timeout for the cold Stooq fetch (seconds). The file + memory
#: caches serve warm symbols, so a slow upstream must fail fast, not hang the chart.
_OHLC_TIMEOUT = 8


def _is_nan(value: float) -> bool:
    try:
        return math.isnan(value)
    except (TypeError, ValueError):
        return False


def stooq_symbol(symbol: str) -> str:
    """Map bare NSE symbol to Stooq ticker (legacy `.NS` form)."""
    symbol = (symbol or "").strip().upper()
    if symbol.endswith(".NS") or symbol.endswith(".BO") or symbol.endswith(".IN"):
        return symbol
    return f"{symbol}.NS"


def stooq_candidates(symbol: str) -> list[str]:
    """Suffixes to try in order: Stooq lists India as `.IN`, Yahoo as `.NS`."""
    base = (symbol or "").strip().upper()
    for suffix in (".IN", ".NS", ".BO"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return [f"{base}.IN", f"{base}.NS"]


def parse_stooq_csv(text: str) -> list[dict]:
    """Parse Stooq CSV to ascending clean daily rows.

    Raises ValueError on non-CSV bodies (bot walls/HTML) so callers can
    serve stale cache instead of mistaking them for "no data".
    """
    reader = csv.DictReader(io.StringIO(text or ""))
    fieldnames = reader.fieldnames or []
    if "Date" not in fieldnames or "Close" not in fieldnames:
        raise ValueError("Unexpected Stooq CSV shape: missing Date/Close header")
    rows: list[dict] = []
    for record in reader:
        day = (record.get("Date") or "").strip()
        try:
            close = float(record.get("Close"))
        except (TypeError, ValueError):
            continue
        if _is_nan(close) or not day:
            continue
        try:
            row = {
                "time": day,
                "open": float(record.get("Open")),
                "high": float(record.get("High")),
                "low": float(record.get("Low")),
                "close": float(close),
                "volume": _volume(record.get("Volume")),
            }
        except (TypeError, ValueError):
            continue
        if any(_is_nan(row[key]) for key in ("open", "high", "low", "close")):
            continue
        rows.append(row)
    rows.sort(key=lambda r: r["time"])
    return rows


def _volume(value) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if _is_nan(result) else result


class StooqProvider(DataProvider):
    def list_stocks(self) -> list[dict]:
        raise NotImplementedError

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        raise NotImplementedError

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """Daily bars ascending; tries `.IN` then `.NS`; empty when no data."""
        end = date.today()
        start = end - timedelta(days=int(years) * 365 + 30)
        last_error: Exception | None = None
        rows: list[dict] = []
        for candidate in stooq_candidates(symbol):
            url = (
                "https://stooq.com/q/d/l/?s="
                f"{candidate.lower()}"
                f"&d1={start.strftime('%Y%m%d')}&d2={end.strftime('%Y%m%d')}&i=d"
            )
            for attempt in range(2):
                try:
                    resp = httpx.get(url, headers=_UA, timeout=_OHLC_TIMEOUT, follow_redirects=True)
                    resp.raise_for_status()
                    rows = parse_stooq_csv(resp.text)
                    if rows:
                        return rows
                    break  # valid-but-empty for this suffix: try next suffix
                except ValueError as e:
                    last_error = e
                    break  # bot wall shape: try next suffix, don't hammer
                except Exception as e:  # noqa: BLE001 — retry then next suffix
                    last_error = e
                    time.sleep(0.5 * (attempt + 1))
        if last_error is not None and not rows:
            raise last_error
        return []

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
