"""Composite provider: Stooq + screener + math, yFinance off by default.

Chain per method:
- ``list_stocks``: Nifty CSV logic (delegated, httpx only — not the
  rate-limited yFinance API), cache + stale flag preserved.
- ``fundamentals``: screener statements + Stooq quote price + pure math.
- ``ohlc``: per-symbol file cache over Stooq full history; stale cache
  served when Stooq fails.
yFinance remains as an opt-in tail (``ENABLE_YFINANCE=1``) only.
"""

import csv
import io
import os
import time

import httpx

from app.data import price_cache
from app.data.provider import DataProvider
from app.data.ratios_math import compute_ratios
from app.data.screener_statements import fetch_statements
from app.data.stooq_impl import StooqProvider, stooq_candidates
from app.data.yfinance_impl import YFinanceProvider

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEFAULT_PRICE_DIR = os.path.join(_REPO_ROOT, "data", "prices")
DEFAULT_STATEMENTS_DIR = os.path.join(_REPO_ROOT, "data", "statements")


def _fetch_quote(symbol: str) -> float | None:
    """Single-quote close from Stooq; tries `.IN` then `.NS`; None on failure."""
    for candidate in stooq_candidates(symbol):
        url = f"https://stooq.com/q/l/?s={candidate.lower()}&f=sd2t2ohlcv&h&e=csv"
        for attempt in range(2):
            try:
                resp = httpx.get(url, headers=_UA, timeout=15, follow_redirects=True)
                resp.raise_for_status()
                reader = csv.DictReader(io.StringIO(resp.text or ""))
                for record in reader:
                    try:
                        return float(record.get("Close"))
                    except (TypeError, ValueError):
                        continue
                break  # valid-but-empty for this suffix: try next
            except Exception:  # noqa: BLE001 — quote is best-effort
                time.sleep(0.5 * (attempt + 1))
    return None


def _fresh_cached_close(symbol: str, price_dir: str, ttl_hours: int) -> float | None:
    """Yesterday's close from the file cache when fresh, else None."""
    import time as _time

    path = os.path.join(price_dir, f"{symbol.strip().upper()}.csv")
    if not os.path.exists(path):
        return None
    try:
        age_hours = (_time.time() - os.path.getmtime(path)) / 3600.0
    except OSError:
        return None
    if age_hours > float(ttl_hours):
        return None
    cached = price_cache.read_cached(symbol, price_dir)
    if not cached:
        return None
    try:
        return float(cached[-1].get("close"))
    except (TypeError, ValueError):
        return None


class CompositeProvider(DataProvider):
    def __init__(
        self,
        price_dir: str = DEFAULT_PRICE_DIR,
        statements_dir: str = DEFAULT_STATEMENTS_DIR,
        enable_yfinance: bool = False,
        statements_ttl_days: int = 30,
        price_ttl_hours: int = 24,
    ) -> None:
        self.price_dir = price_dir
        self.statements_dir = statements_dir
        self.enable_yfinance = bool(enable_yfinance)
        self.statements_ttl_days = statements_ttl_days
        self.price_ttl_hours = price_ttl_hours
        self.stale = False

    def list_stocks(self) -> list[dict]:
        """Nifty universe via the existing CSV path (httpx, not yFinance API)."""
        inner = YFinanceProvider()
        stocks = inner.list_stocks()
        self.stale = bool(getattr(inner, "stale", False))
        return stocks

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        """Statements + quote price + math; yFinance tail only when enabled."""
        symbol = (symbol or "").strip().upper()
        statements = fetch_statements(
            symbol, self.statements_dir, ttl_days=self.statements_ttl_days
        )
        # Screener's page price is enough for a daily screen — the quote
        # only runs when no price is known anywhere (Stooq hangs for
        # minutes on some networks; never pay that with a price in hand).
        price = _fresh_cached_close(symbol, self.price_dir, self.price_ttl_hours)
        if price is None:
            price = statements.get("price")
        if price is None:
            price = _fetch_quote(symbol)
        if price is None:
            cached = price_cache.read_cached(symbol, self.price_dir)
            if cached:
                price = cached[-1].get("close")
        computed = compute_ratios({**statements, "price": price, "symbol": symbol})
        if self.enable_yfinance and all(
            computed.get(key) is None
            for key in ("pe", "pb", "roe", "roce", "debt_to_equity", "market_cap")
        ):
            try:
                return YFinanceProvider().fundamentals(symbol)
            except Exception:  # noqa: BLE001 — fall through with math result
                pass
        return {
            "symbol": symbol,
            "pe": computed.get("pe"),
            "pb": computed.get("pb"),
            "roe": computed.get("roe"),
            "roce": computed.get("roce"),
            "debt_to_equity": computed.get("debt_to_equity"),
            "market_cap": computed.get("market_cap"),
            "raw": computed.get("raw", {}),
        }

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """File cache first; Stooq on miss/stale; stale cache on failure/empty."""
        symbol = (symbol or "").strip().upper()
        stale = price_cache.read_cached(symbol, self.price_dir)
        try:
            rows = price_cache.get_or_fetch(
                symbol,
                lambda: StooqProvider().ohlc(symbol, years=years),
                self.price_dir,
                ttl_hours=self.price_ttl_hours,
            )
            if not rows and stale:
                return stale
            return rows
        except Exception:  # noqa: BLE001 — serve stale cache before failing
            cached = price_cache.read_cached(symbol, self.price_dir)
            if cached:
                return cached
            if self.enable_yfinance:
                return YFinanceProvider().ohlc(symbol, years=years)
            raise

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")


def build_default_provider() -> DataProvider:
    """Default provider: yFinance hot path off unless env opts in."""
    flag = os.environ.get("ENABLE_YFINANCE", "0").strip().lower() in ("1", "true", "yes")
    return CompositeProvider(enable_yfinance=flag)
