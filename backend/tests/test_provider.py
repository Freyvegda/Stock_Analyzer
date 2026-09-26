import httpx
import pytest

from app.data import yfinance_impl
from app.data.yfinance_impl import YFinanceProvider

CSV_TEXT = "Symbol,Company Name,Industry\nAAA,Alpha Ltd,IT\nBBB,Beta Ltd,Banks\n"


class FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        pass


def fail_network(*_args, **_kwargs):
    raise httpx.ConnectError("network down")


def test_list_stocks_downloads_and_caches(tmp_path, monkeypatch):
    cache = tmp_path / "nifty500.csv"
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(cache))
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse(CSV_TEXT))

    provider = YFinanceProvider()
    stocks = provider.list_stocks()

    assert stocks[0] == {"symbol": "AAA", "name": "Alpha Ltd", "sector": "IT", "market_cap": None}
    assert provider.stale is False
    assert cache.read_text(encoding="utf-8") == CSV_TEXT


def test_list_stocks_falls_back_to_cache_with_stale_flag(tmp_path, monkeypatch):
    cache = tmp_path / "nifty500.csv"
    cache.write_text(CSV_TEXT, encoding="utf-8")
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(cache))
    monkeypatch.setattr(yfinance_impl.httpx, "get", fail_network)

    provider = YFinanceProvider()
    stocks = provider.list_stocks()

    assert [s["symbol"] for s in stocks] == ["AAA", "BBB"]
    assert provider.stale is True


def test_list_stocks_raises_when_network_and_cache_both_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(tmp_path / "missing.csv"))
    monkeypatch.setattr(yfinance_impl.httpx, "get", fail_network)

    with pytest.raises(httpx.ConnectError):
        YFinanceProvider().list_stocks()


def fake_ticker_class(info, financials=None, balance_sheet=None):
    class FakeTicker:
        def __init__(self, ticker: str):
            self.ticker = ticker

        @property
        def info(self):
            return info

        @property
        def financials(self):
            return financials

        @property
        def balance_sheet(self):
            return balance_sheet

    return FakeTicker


INFO = {
    "trailingPE": 22.5,
    "priceToBook": 4.2,
    "returnOnEquity": 0.41,
    "returnOnCapitalEmployed": 0.502,
    "debtToEquity": 9.0,
    "marketCap": 12345678901,
}


def test_fundamentals_maps_and_scales_yfinance_fields(monkeypatch):
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class(INFO))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["symbol"] == "AAA"
    assert f["pe"] == 22.5
    assert f["pb"] == 4.2
    assert f["roe"] == 41.0
    assert f["roce"] == 50.2
    assert f["debt_to_equity"] == 0.09
    assert f["market_cap"] == pytest.approx(1234.5679)
    assert f["raw"] == INFO


def test_fundamentals_missing_or_non_numeric_keys_become_none(monkeypatch):
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class({"trailingPE": "n/a"}))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["pe"] is None
    assert f["pb"] is None
    assert f["roce"] is None
    assert f["raw"] == {"trailingPE": "n/a"}


def test_fundamentals_empty_info_still_returns_dict(monkeypatch):
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class(None))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["pe"] is None
    assert f["raw"] == {}


def test_fundamentals_derives_roce_from_statements_when_info_key_missing(monkeypatch):
    import pandas as pd

    income = pd.DataFrame({"2025": [1000.0]}, index=["EBIT"])
    balance = pd.DataFrame({"2025": [5000.0, 1000.0]}, index=["Total Assets", "Current Liabilities"])
    info = {"returnOnEquity": 0.41}
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class(info, income, balance))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roce"] == 25.0  # 1000 / (5000 - 1000) * 100
    assert f["roe"] == 41.0  # from info, no statement fallback needed


def test_fundamentals_derives_roe_from_statements_when_info_key_missing(monkeypatch):
    import pandas as pd

    income = pd.DataFrame({"2025": [200.0]}, index=["Net Income"])
    balance = pd.DataFrame({"2025": [1000.0]}, index=["Stockholders Equity"])
    info = {"returnOnCapitalEmployed": 0.30}
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class(info, income, balance))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roe"] == 20.0  # 200 / 1000 * 100
    assert f["roce"] == 30.0  # from info, no statement fallback needed


def test_fundamentals_prefers_info_values_over_statements(monkeypatch):
    class ExplodingStatements(fake_ticker_class(INFO)):
        @property
        def financials(self):
            raise AssertionError("statements must not be fetched when info has both ratios")

        @property
        def balance_sheet(self):
            raise AssertionError("statements must not be fetched when info has both ratios")

    monkeypatch.setattr(yfinance_impl.yf, "Ticker", ExplodingStatements)

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roce"] == 50.2
    assert f["roe"] == 41.0


def test_fundamentals_statement_errors_degrade_to_none(monkeypatch):
    class BrokenStatements(fake_ticker_class({})):
        @property
        def financials(self):
            raise RuntimeError("statements unavailable")

        @property
        def balance_sheet(self):
            raise RuntimeError("statements unavailable")

    monkeypatch.setattr(yfinance_impl.yf, "Ticker", BrokenStatements)

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roe"] is None
    assert f["roce"] is None


def test_fundamentals_negative_capital_employed_gives_no_roce(monkeypatch):
    import pandas as pd

    income = pd.DataFrame({"2025": [1000.0]}, index=["EBIT"])
    balance = pd.DataFrame({"2025": [1000.0, 1000.0]}, index=["Total Assets", "Current Liabilities"])
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class({}, income, balance))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roce"] is None


def test_ohlc_and_filings_are_not_implemented():
    provider = YFinanceProvider()
    with pytest.raises(NotImplementedError):
        provider.ohlc("AAA")
    with pytest.raises(NotImplementedError):
        provider.filings("AAA")
