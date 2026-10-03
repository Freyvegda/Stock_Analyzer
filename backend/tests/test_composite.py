"""Task 5 RED: composite provider kills yfinance hot path."""

import os

import app.data.composite_impl as comp_mod
from app.data.composite_impl import CompositeProvider, build_default_provider


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


def test_yfinance_off_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_YFINANCE", raising=False)
    assert build_default_provider().enable_yfinance is False
    monkeypatch.setenv("ENABLE_YFINANCE", "1")
    assert build_default_provider().enable_yfinance is True
