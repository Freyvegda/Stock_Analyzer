"""RED: composite OHLC prefers Stooq, then Yahoo chart, then yfinance."""

import app.data.composite_impl as comp_mod
from app.data.composite_impl import CompositeProvider


def ohlc_rows(close=11.5):
    return [
        {"time": "2026-01-04", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5, "volume": 100.0},
        {"time": "2026-01-05", "open": 10.5, "high": 12.0, "low": 10.0, "close": close, "volume": 120.0},
    ]


def make_provider(tmp_path, **kwargs):
    return CompositeProvider(
        price_dir=str(tmp_path / "prices"),
        statements_dir=str(tmp_path / "statements"),
        enable_yfinance=False,
        **kwargs,
    )


def test_ohlc_uses_yahoo_when_stooq_dead(tmp_path, monkeypatch):
    class DeadStooq:
        def ohlc(self, symbol, years=5):
            raise RuntimeError("stooq down")

    class YahooOk:
        def ohlc(self, symbol, years=5):
            return ohlc_rows(close=21.5)

    class DeadYF:
        def ohlc(self, symbol, years=5):
            raise AssertionError("yfinance must not run when yahoo succeeds")

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: DeadStooq())
    monkeypatch.setattr(comp_mod, "YahooChartProvider", lambda: YahooOk())
    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: DeadYF())
    rows = make_provider(tmp_path).ohlc("AAA", years=1)
    assert rows[-1]["close"] == 21.5


def test_ohlc_reaches_yfinance_when_yahoo_rate_limited(tmp_path, monkeypatch):
    class DeadStooq:
        def ohlc(self, symbol, years=5):
            raise RuntimeError("stooq down")

    class ThrottledYahoo:
        def ohlc(self, symbol, years=5):
            raise RuntimeError("yahoo 429 Too Many Requests")

    class FakeYF:
        def ohlc(self, symbol, years=5):
            return ohlc_rows()

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: DeadStooq())
    monkeypatch.setattr(comp_mod, "YahooChartProvider", lambda: ThrottledYahoo())
    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: FakeYF())
    rows = make_provider(tmp_path).ohlc("AAA", years=1)
    assert rows[-1]["close"] == 11.5


def test_ohlc_merges_1y_then_5y_without_losing_bars(tmp_path, monkeypatch):
    from app.data import price_cache

    p = make_provider(tmp_path)
    price_cache.write_cached("AAA", ohlc_rows(close=10.5)[:1], str(tmp_path / "prices"))

    class FiveYear:
        def ohlc(self, symbol, years=5):
            return [
                {"time": "2024-06-01", "open": 5.0, "high": 6.0, "low": 4.0, "close": 5.5, "volume": 50.0},
                {"time": "2026-01-04", "open": 10.0, "high": 11.0, "low": 9.0, "close": 99.0, "volume": 100.0},
            ]

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: FiveYear())
    monkeypatch.setattr(comp_mod, "YahooChartProvider", lambda: FiveYear())
    rows = p.ohlc("AAA", years=5)
    times = [r["time"] for r in rows]
    assert "2024-06-01" in times and "2026-01-04" in times
