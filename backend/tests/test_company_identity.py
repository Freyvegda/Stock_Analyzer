"""Company identity from screener HTML with zero extra network (Phase 1.8 Plan B fix).

Composite fundamentals previously returned ratio-only raw, so
store.upsert_profile skipped every refresh (no identity keys) and the
background batch even nulled good profiles. Screener pages already carry
About/website/sector — parse them from the downloaded HTML.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import pytest

import app.data.composite_impl as comp_mod
from app.data import screener_statements as stmt
from app.db import models  # noqa: F401
from app.db.database import Base
from app.db.models import CompanyProfile, Stock
from app.screener import service as screener_service
from app.stock import store


@pytest.fixture(autouse=True)
def _no_wiki_by_default(monkeypatch):
    """Offline: Wikipedia never hits network unless a test overrides it."""
    monkeypatch.setattr(comp_mod, "fetch_wikipedia_summary", lambda *a, **k: None)


def test_parse_identity_extracts_about_website_sector():
    html = (
        "<html><body>"
        '<div class="company-profile"><div class="sub show-more-box about">'
        "<p>Reliance was founded by Dhirubhai Ambani.</p></div></div>"
        '<a href="http://www.ril.com">ril.com</a>'
        '<a href="https://www.bseindia.com/stock-share-price/x">BSE</a>'
        '<p class="sub"><a title="Sector">Oil, Gas &amp; Consumable Fuels</a>'
        '<a title="Industry">Refineries &amp; Marketing</a></p>'
        "</body></html>"
    )
    out = stmt.parse_identity(html)
    assert out["longBusinessSummary"] == "Reliance was founded by Dhirubhai Ambani."
    assert out["website"] == "http://www.ril.com"
    assert "Oil" in (out["sector"] or "")
    assert "Refineries" in (out["industry"] or "")


def test_fetch_statements_includes_identity(tmp_path):
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>90000</td><td>100000</td></tr>"
        "<tr><td>Net Profit +</td><td>12000</td><td>15000</td></tr>"
        "<tr><td>Total Equity</td><td>70000</td><td>75000</td></tr>"
        "</table>"
        '<div class="company-profile"><div class="sub show-more-box about">'
        "<p>Makes things.</p></div></div>"
        '<div class="company-info"><a href="https://example.test">example</a></div>'
        "</body></html>"
    )
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30, client=lambda s: html)
    assert out["revenue"] == 100000.0
    assert out["longBusinessSummary"] == "Makes things."
    assert out["website"] == "https://example.test"


def test_composite_carries_identity_into_raw(tmp_path, monkeypatch):
    base = {
        "revenue": 100000.0, "net_income": 15000.0, "ebit": 20000.0, "ebitda": 25000.0,
        "equity": 75000.0, "total_assets": 150000.0, "current_assets": 40000.0,
        "current_liabilities": 25000.0, "inventory": 5000.0, "total_debt": 15000.0,
        "cash": 10000.0, "shares_outstanding": 300.0, "operating_cashflow": 18000.0,
        "capex": 5000.0, "dividends_paid": 3000.0, "revenue_prev": 90000.0,
        "earnings_prev": 12000.0, "cogs": 60000.0, "price": 2500.0,
        "longBusinessSummary": "Makes things.", "website": "https://example.test",
        "industry": "Refining", "sector": "Energy",
    }
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: dict(base))
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: 2500.0)
    p = comp_mod.CompositeProvider(
        price_dir=str(tmp_path / "prices"), statements_dir=str(tmp_path / "statements"),
        enable_yfinance=False,
    )
    out = p.fundamentals("AAA")
    assert out["raw"]["longBusinessSummary"] == "Makes things."
    assert out["raw"]["website"] == "https://example.test"


def test_batch_skips_profile_when_no_identity():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as s:
        s.add(Stock(symbol="AAA", name="Alpha", sector="IT", market_cap=1.0))
        s.commit()
    with factory() as s:
        store.upsert_profile(
            s, "AAA",
            {"longBusinessSummary": "Makes things.", "industry": "Oil & Gas"},
            "2026-10-01",
        )
        s.commit()
    batch = [(
        {"symbol": "AAA", "name": "Alpha", "sector": "IT"},
        {"symbol": "AAA", "pe": 10.0, "pb": 2.0, "roe": 20.0, "roce": 18.0,
         "debt_to_equity": 0.2, "market_cap": 50000.0,
         "raw": {"returnOnAssets": 0.1}},
        None,
    )]
    with factory() as s:
        stocks = {r.symbol: r for r in s.query(Stock).all()}
        screener_service.persist_fetch_batch(s, batch, stocks, "2026-10-04")
        s.commit()
    with factory() as s:
        p = s.get(CompanyProfile, "AAA")
        assert p.description == "Makes things."
        assert p.industry == "Oil & Gas"


def test_website_skips_pdf_and_finds_header_site():
    html = (
        '<html><head><meta name="description" content="Fallback desc"></head><body>'
        '<a href="http://www.ril.com">ril.com</a>'
        '<div class="company-info"><div class="company-profile">'
        '<div class="sub show-more-box about"><p>Real about text.</p></div>'
        '<div class="sub commentary"><p><a href="https://www.ril.com/reports/annual.pdf">[1]</a></p></div>'
        "</div></div>"
        '<p class="sub"><a title="Sector">Energy</a><a title="Industry">Refining</a></p>'
        "</body></html>"
    )
    out = stmt.parse_identity(html)
    assert out["longBusinessSummary"] == "Real about text."
    assert out["website"] in ("http://www.ril.com", "https://www.ril.com"), out["website"]
    assert out["sector"] == "Energy"
    assert out["industry"] == "Refining"


def test_fresh_cache_missing_identity_backfills(tmp_path, monkeypatch):
    import datetime
    import json as _json

    stale_fields = {"revenue": 100000.0, "net_income": 15000.0, "equity": 75000.0, "price": 2500.0}
    today = datetime.date.today().isoformat()
    (tmp_path / "AAA.json").write_text(
        _json.dumps({"as_of": today, "fields": stale_fields}), encoding="utf-8"
    )
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>90000</td><td>100000</td></tr>"
        "<tr><td>Net Profit +</td><td>12000</td><td>15000</td></tr>"
        "<tr><td>Total Equity</td><td>70000</td><td>75000</td></tr>"
        "</table>"
        '<div class="company-profile"><div class="sub show-more-box about">'
        "<p>Backfilled description.</p></div></div>"
        '<div class="company-info"><a href="https://example.test">example</a></div>'
        "</body></html>"
    )
    monkeypatch.setattr(stmt, "_download", lambda symbol: html)
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out.get("longBusinessSummary") == "Backfilled description.", out


def test_composite_search_then_yfinance_identity(tmp_path, monkeypatch):
    base = {
        "revenue": 100000.0, "net_income": 15000.0, "ebit": 20000.0, "ebitda": 25000.0,
        "equity": 75000.0, "total_assets": 150000.0, "current_assets": 40000.0,
        "current_liabilities": 25000.0, "inventory": 5000.0, "total_debt": 15000.0,
        "cash": 10000.0, "shares_outstanding": 300.0, "operating_cashflow": 18000.0,
        "capex": 5000.0, "dividends_paid": 3000.0, "revenue_prev": 90000.0,
        "earnings_prev": 12000.0, "cogs": 60000.0, "price": 2500.0,
    }
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: dict(base))
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: 2500.0)
    calls = []

    def fake_search(symbol):
        calls.append(("search", symbol))
        return {"longBusinessSummary": None, "website": None, "industry": None, "sector": None}

    def fake_yf_identity(symbol):
        calls.append(("yf", symbol))
        return {
            "longBusinessSummary": "YF description",
            "website": "https://example.test",
            "industry": "Refining",
            "sector": "Energy",
        }

    monkeypatch.setattr(comp_mod, "fetch_search_identity", fake_search)
    monkeypatch.setattr(comp_mod, "fetch_yfinance_identity", fake_yf_identity)
    p = comp_mod.CompositeProvider(
        price_dir=str(tmp_path / "prices"), statements_dir=str(tmp_path / "statements"),
        enable_yfinance=False,
    )
    out = p.fundamentals("AAA")
    assert out["raw"]["longBusinessSummary"] == "YF description", out["raw"]
    assert calls[0][0] == "search" and calls[1][0] == "yf", calls
    assert out.get("price") == 2500.0


def test_wikipedia_primary_combines_with_screener(tmp_path, monkeypatch):
    base = {
        "revenue": 100000.0, "net_income": 15000.0, "ebit": 20000.0, "ebitda": 25000.0,
        "equity": 75000.0, "total_assets": 150000.0, "current_assets": 40000.0,
        "current_liabilities": 25000.0, "inventory": 5000.0, "total_debt": 15000.0,
        "cash": 10000.0, "shares_outstanding": 300.0, "operating_cashflow": 18000.0,
        "capex": 5000.0, "dividends_paid": 3000.0, "revenue_prev": 90000.0,
        "earnings_prev": 12000.0, "cogs": 60000.0, "price": 2500.0,
        "longBusinessSummary": "Screener short line.",
    }
    monkeypatch.setattr(comp_mod, "fetch_statements", lambda *a, **k: dict(base))
    monkeypatch.setattr(comp_mod, "_fresh_cached_close", lambda *a, **k: 2500.0)
    monkeypatch.setattr(comp_mod, "fetch_wikipedia_summary",
                        lambda *a, **k: "Wikipedia long extract. " * 20)
    monkeypatch.setattr(comp_mod, "fetch_search_identity", lambda s: {})
    monkeypatch.setattr(comp_mod, "fetch_yfinance_identity", lambda s: {})
    p = comp_mod.CompositeProvider(
        price_dir=str(tmp_path / "prices"), statements_dir=str(tmp_path / "statements"),
        enable_yfinance=False,
    )
    out = p.fundamentals("AAA")
    desc = out["raw"]["longBusinessSummary"]
    assert len(desc) > 500, len(desc)
    assert "Wikipedia" in desc and "Screener short" in desc
