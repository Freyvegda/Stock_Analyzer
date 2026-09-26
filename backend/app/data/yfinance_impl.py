"""yfinance + Nifty indices implementation of DataProvider.

Free data source. Missing ratios -> None (never raise). Network failure on the
stock list falls back to cached CSV with stale flag.
"""

import csv
import io
import os

import httpx
import yfinance as yf

from app.data.provider import DataProvider

NIFTY500_CSV_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"
CACHE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "nifty500.csv")
)

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


class YFinanceProvider(DataProvider):
    def __init__(self) -> None:
        # True when list_stocks() served the cached CSV because the download failed.
        self.stale = False

    def list_stocks(self) -> list[dict]:
        try:
            resp = httpx.get(NIFTY500_CSV_URL, headers=_UA, timeout=30, follow_redirects=True)
            resp.raise_for_status()
            text = resp.text
            os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
            with open(CACHE_PATH, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            if not os.path.exists(CACHE_PATH):
                raise
            self.stale = True
            with open(CACHE_PATH, encoding="utf-8") as f:
                text = f.read()

        stocks = []
        for row in csv.DictReader(io.StringIO(text)):
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
        return stocks

    def fundamentals(self, symbol: str) -> dict:
        info = yf.Ticker(f"{symbol}.NS").info or {}

        def ratio(key: str, scale: float = 1.0):
            v = info.get(key)
            return round(v * scale, 4) if isinstance(v, (int, float)) else None

        return {
            "symbol": symbol,
            "pe": ratio("trailingPE"),
            "pb": ratio("priceToBook"),
            "roe": ratio("returnOnEquity", 100.0),
            "roce": ratio("returnOnCapitalEmployed", 100.0),
            "debt_to_equity": ratio("debtToEquity", 0.01),
            "market_cap": ratio("marketCap", 1e-7),  # -> crore
            "raw": info,
        }

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        raise NotImplementedError("Phase 3")

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
