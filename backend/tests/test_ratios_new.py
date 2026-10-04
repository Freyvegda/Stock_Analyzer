"""RED: 9 new screenable ratios (engine + same-page scrape)."""

from app.data.ratios_math import compute_ratios


def base():
    return {
        "price": 100.0,
        "shares_outstanding": 10.0,
        "revenue": 1000.0,
        "net_income": 100.0,
        "ebit": 150.0,
        "ebitda": 200.0,
        "equity": 500.0,
        "total_assets": 1000.0,
        "current_assets": 300.0,
        "current_liabilities": 150.0,
        "inventory": 50.0,
        "total_debt": 200.0,
        "cash": 80.0,
        "operating_cashflow": 130.0,
        "capex": 30.0,
        "dividends_paid": 20.0,
        "revenue_prev": 900.0,
        "earnings_prev": 80.0,
        "cogs": 600.0,
        "interest": 20.0,
        "receivables": 120.0,
        "payables": 90.0,
        "pledged_pct": 0.05,
    }


def test_earnings_yield():
    raw = compute_ratios(base())["raw"]
    assert raw["earningsYield"] == round(10.0 / 100.0, 4)


def test_fcf_yield():
    raw = compute_ratios(base())["raw"]
    assert raw["fcfYield"] == round((130.0 - 30.0) / 1000.0, 4)


def test_ocf_margin():
    raw = compute_ratios(base())["raw"]
    assert raw["operatingCashflowMargin"] == round(130.0 / 1000.0, 4)


def test_asset_turnover():
    raw = compute_ratios(base())["raw"]
    assert raw["assetTurnover"] == round(1000.0 / 1000.0, 4)


def test_cash_ratio():
    raw = compute_ratios(base())["raw"]
    assert raw["cashRatio"] == round(80.0 / 150.0, 4)


def test_interest_coverage():
    raw = compute_ratios(base())["raw"]
    assert raw["interestCoverage"] == round(150.0 / 20.0, 4)


def test_inventory_days():
    raw = compute_ratios(base())["raw"]
    assert raw["inventoryDays"] == round(50.0 / 600.0 * 365, 4)


def test_debtor_days():
    raw = compute_ratios(base())["raw"]
    assert raw["debtorDays"] == round(120.0 / 1000.0 * 365, 4)


def test_pledged_pct():
    raw = compute_ratios(base())["raw"]
    assert raw["pledgedPct"] == round(0.05, 4)
