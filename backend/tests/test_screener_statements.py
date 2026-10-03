"""Task 3 RED: screener statements scraper with file cache."""

import json
import os

from app.data import screener_statements as stmt


def fixture_html():
    path = os.path.join(os.path.dirname(__file__), "fixtures", "screener_reliance.html")
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_parse_fixture_numbers():
    out = stmt.parse_statements(fixture_html())
    assert out["revenue"] == 100000.0
    assert out["net_income"] == 15000.0
    assert out["ebitda"] == 20000.0
    assert out["ebit"] == 18000.0  # op + other income - depreciation
    assert out["equity"] == 75000.0  # capital + reserves
    assert out["total_debt"] == 15000.0
    assert out["operating_cashflow"] == 18000.0
    assert out["dividends_paid"] == 3000.0  # payout 20% of net income
    assert out["revenue_prev"] == 90000.0
    assert out["earnings_prev"] == 12000.0
    assert out["promoters_pct"] == 0.5025
    assert out["institutions_pct"] == 0.37


def test_quarterly_table_skipped_for_annuals():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Dec 2025</th><th>Mar 2026</th></tr>"
        "<tr><td>Sales +</td><td>1</td><td>2</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>90</td><td>100</td></tr>"
        "<tr><td>Total Assets</td><td>50</td><td>60</td></tr>"
        "<tr><td>Total Equity</td><td>40</td><td>45</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 100.0
    assert out["revenue_prev"] == 90.0


def test_429_backs_off_then_succeeds(tmp_path, monkeypatch):
    import app.data.screener_statements as stmt_mod

    calls = []
    sleeps = []
    monkeypatch.setattr(stmt_mod.time, "sleep", lambda s: sleeps.append(s))

    class R429:
        status_code = 429
        headers = {"Retry-After": "0"}
        text = "limited"

        def raise_for_status(self):
            pass

    class R200:
        status_code = 200
        headers = {}
        text = fixture_html()

        def raise_for_status(self):
            pass

    def fake_get(url, **kwargs):
        calls.append(url)
        return R429() if len(calls) == 1 else R200()

    monkeypatch.setattr(stmt_mod.httpx, "get", fake_get)
    out = stmt_mod.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 100000.0
    assert len(calls) == 2 and sleeps


def test_missing_tables_yield_nones():
    out = stmt.parse_statements("<html><body>nothing</body></html>")
    assert out["revenue"] is None
    assert out["net_income"] is None


def test_cache_hit_costs_zero_network(tmp_path):
    cached = {"as_of": "2026-10-01", "fields": {"revenue": 5.0}}
    path = tmp_path / "AAA.json"
    path.write_text(json.dumps(cached), encoding="utf-8")

    def boom(*a, **k):
        raise AssertionError("network must not run on cache hit")

    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30, client=boom)
    assert out["revenue"] == 5.0


def test_stale_cache_refetches(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(stmt, "_download", lambda symbol: fixture_html())
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 100000.0


def _ttm_html():
    path = os.path.join(os.path.dirname(__file__), "fixtures", "screener_ttm_lakh.html")
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_ttm_column_skipped_lakh_scaled_and_price_parsed():
    out = stmt.parse_statements(_ttm_html())
    assert out["revenue"] == 1000.0  # 100000 lakh -> cr, TTM 999999 skipped
    assert out["net_income"] == 150.0
    assert out["revenue_prev"] == 900.0
    assert out["equity"] == 750.0
    assert out["price"] == 2500.5


def test_blocked_serves_stale_cache(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0, "equity": 6.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")

    def blocked(symbol):
        raise stmt.ScreenerBlockedError("403")

    monkeypatch.setattr(stmt, "_download", blocked)
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 5.0


def test_block_page_keeps_stale_cache(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0, "equity": 6.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(stmt, "_download", lambda symbol: "<html><body>blocked</body></html>")
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 5.0
