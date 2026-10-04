"""Task 5 RED: composite provider kills yfinance hot path."""

import os

import pytest

import app.data.composite_impl as comp_mod
from app.data.composite_impl import CompositeProvider, build_default_provider


@pytest.fixture(autouse=True)
def _no_identity_network(monkeypatch):
    """Offline unit tests: identity fallbacks never hit the network."""
    monkeypatch.setattr(comp_mod, "fetch_wikipedia_summary", lambda *a, **k: None)
    monkeypatch.setattr(comp_mod, "fetch_search_identity", lambda *a, **k: {})
    monkeypatch.setattr(comp_mod, "fetch_yfinance_identity", lambda *a, **k: {})


def ohlc_rows():
    return [
        {"time": "2026-01-04", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5, "volume": 100.0},
        {"time": "2026-01-05", "open": 10.5, "high": 12.0, "low": 10.0, "close": 11.5, "volume": 120.0},
    ]


def statements():
    return {
        "revenue": 100000.0,
        "net_income": 15000.0,
        "ebit": 20000.0,
        "ebitda": 25000.0,
        "equity": 75000.0,
        "total_assets": 150000.0,
        "current_assets": 40000.0,
        "current_liabilities": 25000.0,
        "inventory": 5000.0,
        "total_debt": 15000.0,
        "cash": 10000.0,
        "shares_outstanding": 300.0,
        "operating_cashflow": 18000.0,
        "capex": 5000.0,
        "dividends_paid": 3000.0,
        "revenue_prev": 90000.0,
        "earnings_prev": 12000.0,
        "cogs": 60000.0,
        "price": None,
    }


def make_provider(tmp_path, **kwargs):
    return CompositeProvider(
        price_dir=str(tmp_path / "prices"),
        statements_dir=str(tmp_path / "statements"),
        enable_yfinance=False,
        **kwargs,
    )


def test_statements_price_skips_quote(tmp_path, monkeypatch):
    have_statements = dict(statements(), price=2500.0)

    def boom(symbol):
        raise AssertionError("quote must not run when statements price exists")

    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: have_statements)
    monkeypatch.setattr(comp_mod, "_fetch_quote", boom)
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    assert out["market_cap"] == 2500.0 * 300.0


def test_fundamentals_merges_price_statements_math(tmp_path, monkeypatch):
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: statements())
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: 2500.0)
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    assert out["symbol"] == "RELIANCE"
    assert out["pe"] is not None and out["roe"] is not None
    assert out["market_cap"] == 2500.0 * 300.0
    assert out["raw"]["returnOnAssets"] is not None


def test_ohlc_serves_file_cache_without_network(tmp_path, monkeypatch):
    from app.data import price_cache

    price_cache.write_cached("AAA", ohlc_rows(), str(tmp_path / "prices"))

    def boom(*a, **k):
        raise AssertionError("network must not run on file-cache hit")

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: boom())
    p = make_provider(tmp_path)
    rows = p.ohlc("AAA")
    assert rows[0]["close"] == 10.5


def test_ohlc_falls_back_to_cache_on_stooq_fail(tmp_path, monkeypatch):
    from app.data import price_cache

    price_cache.write_cached("AAA", ohlc_rows(), str(tmp_path / "prices"))
    import time

    old = os.path.getmtime(tmp_path / "prices" / "AAA.csv")
    os.utime(tmp_path / "prices" / "AAA.csv", (old - 48 * 3600, old - 48 * 3600))

    class DeadStooq:
        def ohlc(self, symbol, years=5):
            raise RuntimeError("stooq down")

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: DeadStooq())
    rows = make_provider(tmp_path).ohlc("AAA")
    assert rows[-1]["close"] == 11.5


def test_ohlc_empty_fetch_serves_stale(tmp_path, monkeypatch):
    import time as _time

    from app.data import price_cache

    price_cache.write_cached("AAA", ohlc_rows(), str(tmp_path / "prices"))
    old = os.path.getmtime(tmp_path / "prices" / "AAA.csv")
    os.utime(tmp_path / "prices" / "AAA.csv", (old - 48 * 3600, old - 48 * 3600))

    class EmptyStooq:
        def ohlc(self, symbol, years=5):
            return []

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: EmptyStooq())
    rows = make_provider(tmp_path).ohlc("AAA")
    assert rows[-1]["close"] == 11.5


def test_yfinance_off_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_YFINANCE", raising=False)
    assert build_default_provider().enable_yfinance is False
    monkeypatch.setenv("ENABLE_YFINANCE", "1")
    assert build_default_provider().enable_yfinance is True


def test_ohlc_falls_back_to_yfinance_on_stooq_fail_cold_cache(tmp_path, monkeypatch):
    """Stooq timeout + cold cache must still render price via yfinance.

    Regression: default provider (enable_yfinance=False) raised on Stooq
    ConnectTimeout with empty data/prices, so /ohlc -> 502 and the stock
    screen showed "No price data".
    """

    class DeadStooq:
        def ohlc(self, symbol, years=5):
            raise RuntimeError("stooq down: ConnectTimeout")

    class FakeYF:
        def ohlc(self, symbol, years=5):
            return ohlc_rows()

    monkeypatch.setattr(comp_mod, "StooqProvider", lambda: DeadStooq())
    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: FakeYF())
    rows = make_provider(tmp_path).ohlc("AAA")
    assert rows[-1]["close"] == 11.5


def _partial_statements_no_shares():
    s = statements()
    s["shares_outstanding"] = None
    s["price"] = None
    return s


def _yf_partial_fill():
    return {
        "symbol": "RELIANCE",
        "pe": 22.5,
        "pb": 3.1,
        "roe": 999.0,  # must not overwrite good math value
        "roce": None,
        "debt_to_equity": None,
        "market_cap": 750000.0,
        "raw": {"trailingEps": 12.5, "returnOnAssets": 0.09},
    }


def test_partial_nulls_filled_from_yfinance_only_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: _partial_statements_no_shares())
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: None)
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: None)

    calls = []

    class FakeYF:
        def fundamentals(self, symbol, cached=None):
            calls.append(symbol)
            return _yf_partial_fill()

    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: FakeYF())
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    # pe/pb/mcap were None from math (no price/shares) -> filled from yfinance
    assert out["pe"] == 22.5
    assert out["pb"] == 3.1
    assert out["market_cap"] == 750000.0
    # good math values preserved, not overwritten by yfinance 999
    assert out["roe"] is not None and out["roe"] != 999.0
    assert calls == ["RELIANCE"]


def test_yfinance_failure_keeps_math_result(tmp_path, monkeypatch):
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: _partial_statements_no_shares())
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: None)
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: None)

    class DeadYF:
        def fundamentals(self, symbol, cached=None):
            raise RuntimeError("yfinance down")

    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: DeadYF())
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    # math roe still present, missing pe stays None, no raise
    assert out["roe"] is not None
    assert out["pe"] is None


def test_no_yfinance_call_when_all_present(tmp_path, monkeypatch):
    have = dict(statements(), price=2500.0)
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: have)
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: (_ for _ in ()).throw(AssertionError("quote must not run")))
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: 2500.0)

    def boom():
        raise AssertionError("yfinance must not run when nothing missing")

    monkeypatch.setattr(comp_mod, "YFinanceProvider", boom)
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    assert out["pe"] is not None
    assert out["market_cap"] == 2500.0 * 300.0


def test_calculator_derives_pe_when_yfinance_partial_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: _partial_statements_no_shares())
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: None)
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: None)

    class PartialYF:
        def fundamentals(self, symbol, cached=None):
            return {
                "symbol": symbol, "pe": None, "pb": 3.0, "roe": None,
                "roce": None, "debt_to_equity": None, "market_cap": None,
                "raw": {},
            }

    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: PartialYF())
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    # math roe 20.0 + yfinance pb 3.0 -> calculator pe 15.0, no extra network
    assert out["pb"] == 3.0
    assert out["pe"] == round(3.0 * 100 / 20.0, 4)


def test_statements_base_fills_roe_when_info_rate_limited(tmp_path, monkeypatch):
    have = dict(statements(), price=2500.0)
    have["net_income"] = None  # math roe None, pb + mcap present
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: have)
    monkeypatch.setattr(comp_mod, "_fetch_quote", lambda symbol: None)
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: 2500.0)

    class ThrottledYF:
        def fundamentals(self, symbol, cached=None):
            raise RuntimeError("yfinance 429 Too Many Requests")

    monkeypatch.setattr(comp_mod, "YFinanceProvider", lambda: ThrottledYF())
    monkeypatch.setattr(
        comp_mod, "yfinance_statements_base", lambda symbol: {"net_income": 15000.0}
    )
    out = make_provider(tmp_path).fundamentals("RELIANCE")
    assert out["roe"] == round(15000.0 / 75000.0 * 100, 4)
