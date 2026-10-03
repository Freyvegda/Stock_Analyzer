from abc import ABC, abstractmethod


class DataProvider(ABC):
    """Interface for market data sources (yfinance, screener, NSE).

    Swap free implementations for paid ones without touching consumers.
    """

    @abstractmethod
    def list_stocks(self) -> list[dict]:
        """Return [{symbol, name, sector, market_cap}] for the index universe."""

    @abstractmethod
    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        """Return ratio dict: pe, pb, roe, roce, debt_to_equity, ...

        ``cached`` is the previous stored payload; providers may reuse its
        statement-derived values to avoid the extra annual-statement fetches.
        """

    @abstractmethod
    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """Return daily OHLCV rows for the past N years."""

    @abstractmethod
    def filings(self, symbol: str) -> list[dict]:
        """Return document refs: {type, period, url} for concalls/results/audits."""
