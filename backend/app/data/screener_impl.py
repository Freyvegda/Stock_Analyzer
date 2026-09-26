"""Screener.in implementation stub. Fundamentals backup source — Phase 1 uses
yfinance; add screener scraping here if yfinance ratio gaps prove too large."""

from app.data.provider import DataProvider


class ScreenerProvider(DataProvider):
    def list_stocks(self) -> list[dict]:
        raise NotImplementedError

    def fundamentals(self, symbol: str) -> dict:
        raise NotImplementedError

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        raise NotImplementedError

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError
