"""yfinance + Nifty indices implementation of DataProvider.

Free data source. Missing ratios -> None (never raise). Network failure on the
stock list falls back to cached CSV with stale flag.

`.info` often omits returnOnEquity / returnOnCapitalEmployed for NSE tickers, so
those are derived from the annual statements when absent:
ROCE = EBIT / (Total Assets − Current Liabilities), ROE = Net Income / Equity.
"""

import csv
import io
import logging
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

import httpx
import pandas as pd
import yfinance as yf

from app.data.provider import DataProvider

logger = logging.getLogger(__name__)

NIFTY500_CSV_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"
CACHE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "nifty500.csv")
)

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

MIN_UNIVERSE_SIZE = 100  # a real Nifty 500 CSV has ~500; fewer means a bad response

FETCH_TIMEOUT_SECONDS = 15.0
FETCH_ATTEMPTS = 3
RETRY_BASE_DELAY = 0.5

# One hung fetch must not queue behind another; 16 matches the job worker count.
_EXECUTOR = ThreadPoolExecutor(max_workers=16)


def _call_with_timeout(fn, timeout: float = FETCH_TIMEOUT_SECONDS):
    """Run ``fn`` in the watchdog pool, raising TimeoutError after ``timeout``s."""
    future = _EXECUTOR.submit(fn)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        raise TimeoutError(f"fetch timed out after {timeout}s")


def _retry(fn, attempts: int = FETCH_ATTEMPTS, label: str = "fetch"):
    """Call ``fn`` up to ``attempts`` times with exponential backoff + jitter."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                raise
            logger.warning("%s: attempt %d/%d failed; retrying", label, attempt + 1, attempts)
            time.sleep(RETRY_BASE_DELAY * 2**attempt + random.uniform(0, RETRY_BASE_DELAY))


def _parse_stocks(text: str) -> list[dict]:
    """Parse the constituents CSV, rejecting HTML/broken/truncated bodies."""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "Symbol" not in reader.fieldnames:
        raise ValueError("Unexpected Nifty 500 CSV format: missing 'Symbol' column")
    stocks = []
    for row in reader:
        symbol = (row.get("Symbol") or "").strip()
        if not symbol:
            continue
        stocks.append(
            {
                "symbol": symbol,
                "name": (row.get("Company Name") or "").strip(),
                "sector": (row.get("Industry") or "").strip() or None,
                "market_cap": None,
            }
        )
    if len(stocks) < MIN_UNIVERSE_SIZE:
        raise ValueError(f"Suspicious Nifty 500 CSV: only {len(stocks)} symbols (min {MIN_UNIVERSE_SIZE})")
    return stocks

_NET_INCOME = ["Net Income", "Net Income Common Stockholders"]
_EQUITY = ["Stockholders Equity", "Total Equity Gross Minority Interest"]
_EBIT = ["EBIT", "Operating Income"]
_ASSETS = ["Total Assets"]
_CURR_LIAB = ["Current Liabilities"]
_DEBT = ["Total Debt"]


def is_rate_limit_error(exc: Exception | None) -> bool:
    """True when ``exc`` looks like a rate limit / throttle / hung fetch."""
    if exc is None:
        return False
    if isinstance(exc, TimeoutError):
        return True
    name = type(exc).__name__.lower()
    text = f"{name} {exc}".lower()
    return any(
        token in text
        for token in ("429", "rate limit", "ratelimit", "too many", "throttl", "timed out")
    )


def _fast_price(ticker) -> float | None:
    """Best-effort quote without the rate-limited ``.info`` endpoint."""
    try:
        fast = ticker.fast_info
    except Exception:  # noqa: BLE001 — price is best-effort, never raises
        return None
    try:
        if isinstance(fast, dict):
            for key in ("lastPrice", "last_price", "regularMarketPrice"):
                value = fast.get(key)
                if isinstance(value, (int, float)):
                    return float(value)
            return None
        for attr in ("last_price", "lastPrice", "regular_market_price"):
            value = getattr(fast, attr, None)
            if isinstance(value, (int, float)):
                return float(value)
    except Exception:  # noqa: BLE001 — malformed fast_info degrades to None
        return None
    return None


def yfinance_statements_base(symbol: str) -> dict:
    """Statement numbers without the rate-limited ``.info`` endpoint.

    Used as calculator input when ``fundamentals`` info fetch hits a rate
    limit: annual financials/balance_sheet + best-effort fast price. Raises the
    underlying error when statements themselves are throttled; empty frames
    degrade to Nones (never raises for missing labels).
    """
    ticker = yf.Ticker(f"{symbol}.NS")
    income, balance = _retry(
        lambda: _call_with_timeout(lambda: _statements(ticker)), label=symbol
    )
    return {
        "symbol": symbol,
        "price": _fast_price(ticker),
        "net_income": _latest_value(income, _NET_INCOME),
        "equity": _latest_value(balance, _EQUITY),
        "ebit": _latest_value(income, _EBIT),
        "total_assets": _latest_value(balance, _ASSETS),
        "current_liabilities": _latest_value(balance, _CURR_LIAB),
        "total_debt": _latest_value(balance, _DEBT),
    }


def _latest_value(frame, labels: list[str]) -> float | None:
    """First present, non-NaN value from the latest annual column."""
    if frame is None or getattr(frame, "empty", True):
        return None
    for label in labels:
        if label in frame.index:
            value = frame.loc[label].iloc[0]
            if pd.notna(value):
                return float(value)
    return None


def _statements(ticker) -> tuple:
    """Best-effort annual statements — degraded fetch returns (None, None)."""
    try:
        return ticker.financials, ticker.balance_sheet
    except Exception:
        return None, None


class YFinanceProvider(DataProvider):
    def __init__(self) -> None:
        # True when list_stocks() served the cached CSV because the download failed.
        self.stale = False

    def list_stocks(self) -> list[dict]:
        try:
            resp = httpx.get(NIFTY500_CSV_URL, headers=_UA, timeout=30, follow_redirects=True)
            resp.raise_for_status()
            stocks = _parse_stocks(resp.text)  # validate BEFORE overwriting the cache
        except Exception:
            if not os.path.exists(CACHE_PATH):
                raise
            self.stale = True
            with open(CACHE_PATH, encoding="utf-8") as f:
                return _parse_stocks(f.read())

        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            f.write(resp.text)
        return stocks

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        ticker = yf.Ticker(f"{symbol}.NS")
        info = _retry(lambda: _call_with_timeout(lambda: ticker.info), label=symbol) or {}
        cached = cached or {}

        def ratio(key: str, scale: float = 1.0):
            v = info.get(key)
            return round(v * scale, 4) if isinstance(v, (int, float)) else None

        roe = ratio("returnOnEquity", 100.0)
        roce = ratio("returnOnCapitalEmployed", 100.0)

        # Annual-statement figures from the previous snapshot: reuse, don't refetch.
        if roe is None:
            roe = cached.get("roe")
        if roce is None:
            roce = cached.get("roce")

        if roe is None or roce is None:
            income, balance = _retry(
                lambda: _call_with_timeout(lambda: _statements(ticker)), label=symbol
            )
            if roe is None:
                net_income = _latest_value(income, _NET_INCOME)
                equity = _latest_value(balance, _EQUITY)
                if net_income is not None and equity > 0:  # equity <= 0 -> keep None
                    roe = round(net_income / equity * 100, 4)
            if roce is None:
                ebit = _latest_value(income, _EBIT)
                assets = _latest_value(balance, ["Total Assets"])
                liabilities = _latest_value(balance, ["Current Liabilities"])
                if ebit is not None and assets is not None and liabilities is not None:
                    capital_employed = assets - liabilities
                    if capital_employed > 0:
                        roce = round(ebit / capital_employed * 100, 4)

        return {
            "symbol": symbol,
            "pe": ratio("trailingPE"),
            "pb": ratio("priceToBook"),
            "roe": roe,
            "roce": roce,
            "debt_to_equity": ratio("debtToEquity", 0.01),
            "market_cap": ratio("marketCap", 1e-7),  # -> crore
            "raw": info,
        }

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """Daily OHLCV history, ascending, NaN-close rows dropped.

        Raises upstream errors (the API layer maps them to 502); an empty
        history returns ``[]`` (no data for the ticker).
        """
        frame = yf.Ticker(f"{symbol}.NS").history(
            period=f"{years}y", interval="1d", auto_adjust=False
        )
        rows: list[dict] = []
        for index, row in frame.iterrows():
            open_, high, low, close = row["Open"], row["High"], row["Low"], row["Close"]
            if pd.isna(open_) or pd.isna(high) or pd.isna(low) or pd.isna(close):
                continue
            volume = row["Volume"]
            rows.append(
                {
                    "time": index.date().isoformat(),
                    "open": float(open_),
                    "high": float(high),
                    "low": float(low),
                    "close": float(close),
                    "volume": 0.0 if pd.isna(volume) else float(volume),
                }
            )
        return rows

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
