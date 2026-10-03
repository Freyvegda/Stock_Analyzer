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
    assert out["ebit"] == 20000.0
    assert out["equity"] == 75000.0
    assert out["total_debt"] == 15000.0
    assert out["operating_cashflow"] == 18000.0
    assert out["revenue_prev"] == 90000.0
    assert out["earnings_prev"] == 12000.0


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
