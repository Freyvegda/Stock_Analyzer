"""NSE/BSE announcements implementation — Phase 2 (filings/PDFs)."""

from app.data.provider import DataProvider


class NSEProvider(DataProvider):
    def list_stocks(self) -> list[dict]:
        raise NotImplementedError

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        raise NotImplementedError

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        raise NotImplementedError

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
