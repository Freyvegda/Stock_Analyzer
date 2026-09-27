"""yfinance + Nifty indices implementation of DataProvider.

Free data source. Missing ratios -> None (never raise). Network failure on the
stock list falls back to cached CSV with stale flag.

`.info` often omits returnOnEquity / returnOnCapitalEmployed for NSE tickers, so
those are derived from the annual statements when absent:
ROCE = EBIT / (Total Assets − Current Liabilities), ROE = Net Income / Equity.
"""

import csv
import io
import os

import httpx
import pandas as pd
import yfinance as yf

from app.data.provider import DataProvider

NIFTY500_CSV_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"
CACHE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "nifty500.csv")
)

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

MIN_UNIVERSE_SIZE = 100  # a real Nifty 500 CSV has ~500; fewer means a bad response


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

    def fundamentals(self, symbol: str) -> dict:
        ticker = yf.Ticker(f"{symbol}.NS")
        info = ticker.info or {}

        def ratio(key: str, scale: float = 1.0):
            v = info.get(key)
            return round(v * scale, 4) if isinstance(v, (int, float)) else None

        roe = ratio("returnOnEquity", 100.0)
        roce = ratio("returnOnCapitalEmployed", 100.0)

        if roe is None or roce is None:
            income, balance = _statements(ticker)
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
            close = row["Close"]
            if pd.isna(close):
                continue
            rows.append(
                {
                    "time": index.date().isoformat(),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(close),
                    "volume": float(row["Volume"]),
                }
            )
        return rows

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
