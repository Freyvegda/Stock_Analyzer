import httpx
import pytest

from app.data import yfinance_impl
from app.data.yfinance_impl import YFinanceProvider

def big_csv(count: int = 120) -> str:
    """Realistic Nifty-500-shaped CSV above the sanity threshold."""
    rows = ["Symbol,Company Name,Industry", "AAA,Alpha Ltd,IT", "BBB,Beta Ltd,Banks"]
    rows += [f"SYM{i},Company {i},Industry {i}" for i in range(count - 2)]
    return "\n".join(rows) + "\n"


HTML_BODY = "<html><body>Request blocked by WAF</body></html>"


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
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse(big_csv()))

    provider = YFinanceProvider()
    stocks = provider.list_stocks()

    assert stocks[0] == {"symbol": "AAA", "name": "Alpha Ltd", "sector": "IT", "market_cap": None}
    assert len(stocks) == 120
    assert provider.stale is False
    assert cache.read_text(encoding="utf-8") == big_csv()


def test_list_stocks_falls_back_to_cache_with_stale_flag(tmp_path, monkeypatch):
    cache = tmp_path / "nifty500.csv"
    cache.write_text(big_csv(), encoding="utf-8")
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(cache))
    monkeypatch.setattr(yfinance_impl.httpx, "get", fail_network)

    provider = YFinanceProvider()
    stocks = provider.list_stocks()

    assert [s["symbol"] for s in stocks[:2]] == ["AAA", "BBB"]
    assert len(stocks) == 120
    assert provider.stale is True


def test_list_stocks_raises_when_network_and_cache_both_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(tmp_path / "missing.csv"))
    monkeypatch.setattr(yfinance_impl.httpx, "get", fail_network)

    with pytest.raises(httpx.ConnectError):
        YFinanceProvider().list_stocks()


def test_list_stocks_html_response_falls_back_to_cache(tmp_path, monkeypatch):
    cache = tmp_path / "nifty500.csv"
    cache.write_text(big_csv(), encoding="utf-8")
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(cache))
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse(HTML_BODY))

    provider = YFinanceProvider()
    stocks = provider.list_stocks()

    assert len(stocks) == 120
    assert provider.stale is True
    assert cache.read_text(encoding="utf-8") == big_csv()  # good cache NOT poisoned


def test_list_stocks_html_response_without_cache_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(tmp_path / "missing.csv"))
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse(HTML_BODY))

    with pytest.raises(ValueError):
        YFinanceProvider().list_stocks()


def test_list_stocks_too_few_rows_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(tmp_path / "missing.csv"))
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse("Symbol,Company Name,Industry\nAAA,Alpha,IT\n"))

    with pytest.raises(ValueError):
        YFinanceProvider().list_stocks()


def test_list_stocks_skips_dummy_guard_rows(tmp_path, monkeypatch):
    """DUMMY* guard rows never enter the NSE corpus, from network or cache."""
    body = big_csv() + "DUMMYHEG,Dummy HEG Ltd,Capital Goods\n"
    monkeypatch.setattr(yfinance_impl, "CACHE_PATH", str(tmp_path / "missing.csv"))
    monkeypatch.setattr(yfinance_impl.httpx, "get", lambda *a, **k: FakeResponse(body))

    stocks = YFinanceProvider().list_stocks()

    assert "DUMMYHEG" not in [s["symbol"] for s in stocks]
    assert len(stocks) == 120


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


def test_fundamentals_negative_equity_gives_no_roe(monkeypatch):
    import pandas as pd

    income = pd.DataFrame({"2025": [-100.0]}, index=["Net Income"])
    balance = pd.DataFrame({"2025": [-200.0]}, index=["Stockholders Equity"])
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_ticker_class({}, income, balance))

    f = YFinanceProvider().fundamentals("AAA")

    assert f["roe"] is None  # loss-making + negative equity must not look profitable


def tracking_statements_ticker(calls, info=None, income=None, balance=None):
    """Fake ticker whose annual statements record every access into ``calls``."""

    class FakeTicker:
        def __init__(self, ticker: str):
            self.ticker = ticker

        @property
        def info(self):
            return info if info is not None else {}

        @property
        def financials(self):
            calls.append("financials")
            return income

        @property
        def balance_sheet(self):
            calls.append("balance_sheet")
            return balance

    return FakeTicker


def test_cached_roe_roce_skip_statements(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", tracking_statements_ticker(calls))

    f = YFinanceProvider().fundamentals("AAA", cached={"roe": 22.0, "roce": 30.0})

    assert calls == []  # statement access never happened
    assert f["roe"] == 22.0
    assert f["roce"] == 30.0


def test_info_values_skip_statements_without_cache(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", tracking_statements_ticker(calls, info=INFO))

    f = YFinanceProvider().fundamentals("AAA")

    assert calls == []  # both ratios came from .info
    assert f["roe"] == 41.0
    assert f["roce"] == 50.2


def test_statements_fetched_without_cache(monkeypatch):
    import pandas as pd

    calls: list[str] = []
    income = pd.DataFrame({"2025": [1000.0, 200.0]}, index=["EBIT", "Net Income"])
    balance = pd.DataFrame(
        {"2025": [5000.0, 1000.0, 1000.0]},
        index=["Total Assets", "Current Liabilities", "Stockholders Equity"],
    )
    monkeypatch.setattr(
        yfinance_impl.yf, "Ticker", tracking_statements_ticker(calls, income=income, balance=balance)
    )

    f = YFinanceProvider().fundamentals("AAA", cached=None)

    assert calls == ["financials", "balance_sheet"]
    assert f["roe"] == 20.0  # 200 / 1000 * 100
    assert f["roce"] == 25.0  # 1000 / (5000 - 1000) * 100


def test_cached_none_values_still_fetch_statements(monkeypatch):
    import pandas as pd

    calls: list[str] = []
    income = pd.DataFrame({"2025": [1000.0, 200.0]}, index=["EBIT", "Net Income"])
    balance = pd.DataFrame(
        {"2025": [5000.0, 1000.0, 1000.0]},
        index=["Total Assets", "Current Liabilities", "Stockholders Equity"],
    )
    monkeypatch.setattr(
        yfinance_impl.yf, "Ticker", tracking_statements_ticker(calls, income=income, balance=balance)
    )

    f = YFinanceProvider().fundamentals("AAA", cached={"roe": None, "roce": None})

    assert calls == ["financials", "balance_sheet"]  # cached Nones are not reusable
    assert f["roe"] == 20.0
    assert f["roce"] == 25.0


def fake_history_ticker(frame, calls=None):
    class FakeTicker:
        def __init__(self, ticker: str):
            self.ticker = ticker

        def history(self, **kwargs):
            if calls is not None:
                calls.append(kwargs)
            return frame

    return FakeTicker


def test_ohlc_maps_history_rows(monkeypatch):
    import pandas as pd

    frame = pd.DataFrame(
        {
            "Open": [1.0, 2.0],
            "High": [1.5, 2.5],
            "Low": [0.5, 1.5],
            "Close": [1.2, 2.2],
            "Volume": [100, 200],
        },
        index=pd.to_datetime(["2026-01-02", "2026-01-05"]),
    )
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_history_ticker(frame))

    rows = YFinanceProvider().ohlc("AAA")

    assert rows == [
        {"time": "2026-01-02", "open": 1.0, "high": 1.5, "low": 0.5, "close": 1.2, "volume": 100.0},
        {"time": "2026-01-05", "open": 2.0, "high": 2.5, "low": 1.5, "close": 2.2, "volume": 200.0},
    ]


def test_ohlc_drops_nan_close_and_empty_frame(monkeypatch):
    import pandas as pd

    frame = pd.DataFrame(
        {
            "Open": [1.0, 2.0],
            "High": [1.5, 2.5],
            "Low": [0.5, 1.5],
            "Close": [float("nan"), 2.2],
            "Volume": [100, 200],
        },
        index=pd.to_datetime(["2026-01-02", "2026-01-05"]),
    )
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_history_ticker(frame))
    assert [row["time"] for row in YFinanceProvider().ohlc("AAA")] == ["2026-01-05"]

    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_history_ticker(pd.DataFrame()))
    assert YFinanceProvider().ohlc("AAA") == []


def test_ohlc_requests_daily_history_for_period(monkeypatch):
    import pandas as pd

    calls: list[dict] = []
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_history_ticker(pd.DataFrame(), calls))

    YFinanceProvider().ohlc("RELIANCE.NS", years=2)

    assert calls == [{"period": "2y", "interval": "1d", "auto_adjust": False}]


def test_ohlc_drops_rows_with_nan_prices_and_zeroes_nan_volume(monkeypatch):
    import pandas as pd

    frame = pd.DataFrame(
        {
            "Open": [1.0, float("nan")],
            "High": [1.5, 2.5],
            "Low": [0.5, 1.5],
            "Close": [1.2, 2.2],
            "Volume": [float("nan"), 100],
        },
        index=pd.to_datetime(["2026-01-02", "2026-01-05"]),
    )
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", fake_history_ticker(frame))

    rows = YFinanceProvider().ohlc("AAA")

    assert len(rows) == 1
    assert rows[0]["time"] == "2026-01-02"  # valid prices survive
    assert rows[0]["volume"] == 0.0  # NaN volume never reaches JSON


def test_filings_is_not_implemented():
    provider = YFinanceProvider()
    with pytest.raises(NotImplementedError):
        provider.filings("AAA")


def test_retry_recovers_after_two_failures(monkeypatch):
    monkeypatch.setattr(yfinance_impl.time, "sleep", lambda *_: None)
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("boom")
        return 7

    assert yfinance_impl._retry(flaky) == 7
    assert calls["n"] == 3


def test_retry_reraises_after_attempts(monkeypatch, caplog):
    monkeypatch.setattr(yfinance_impl.time, "sleep", lambda *_: None)
    calls = {"n": 0}

    def always_fail():
        calls["n"] += 1
        raise RuntimeError("still down")

    with pytest.raises(RuntimeError, match="still down"):
        yfinance_impl._retry(always_fail, label="AAA")

    assert calls["n"] == yfinance_impl.FETCH_ATTEMPTS
    assert "AAA" in caplog.text  # retry warnings carry the symbol for attribution


def test_call_with_timeout_raises_on_hang():
    import time

    with pytest.raises(TimeoutError):
        yfinance_impl._call_with_timeout(lambda: time.sleep(0.2), timeout=0.01)


def _base_ticker_class(income=None, balance=None, fast_price=None):
    class FakeTicker:
        def __init__(self, ticker: str):
            self.ticker = ticker

        @property
        def financials(self):
            return income

        @property
        def balance_sheet(self):
            return balance

        @property
        def fast_info(self):
            return {"lastPrice": fast_price} if fast_price is not None else {}

    return FakeTicker


def test_statements_base_returns_numbers(monkeypatch):
    import pandas as pd

    income = pd.DataFrame({"2025": [200.0, 1000.0]}, index=["Net Income", "EBIT"])
    balance = pd.DataFrame(
        {"2025": [1000.0, 5000.0, 1000.0, 400.0]},
        index=["Stockholders Equity", "Total Assets", "Current Liabilities", "Total Debt"],
    )
    monkeypatch.setattr(
        yfinance_impl.yf, "Ticker", _base_ticker_class(income, balance, fast_price=250.0)
    )
    base = yfinance_impl.yfinance_statements_base("AAA")
    assert base["net_income"] == 200.0
    assert base["equity"] == 1000.0
    assert base["ebit"] == 1000.0
    assert base["total_debt"] == 400.0
    assert base["price"] == 250.0


def test_statements_base_empty_never_raises(monkeypatch):
    monkeypatch.setattr(yfinance_impl.yf, "Ticker", _base_ticker_class())
    base = yfinance_impl.yfinance_statements_base("AAA")
    assert base["net_income"] is None
    assert base["price"] is None


def test_is_rate_limit_error_flags_429_timeout():
    assert yfinance_impl.is_rate_limit_error(RuntimeError("screener limited AAA: 429")) is True
    assert yfinance_impl.is_rate_limit_error(TimeoutError("fetch timed out after 15.0s")) is True
    assert yfinance_impl.is_rate_limit_error(ValueError("bad csv")) is False
