"""Task 1 RED: math engine deriving catalog ratios from scraped statements."""

from app.data.ratios_math import BASE_FIELDS, compute_ratios


def base():
    return {
        "price": 2500.0,
        "shares_outstanding": 300.0,  # crore shares
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
        "operating_cashflow": 18000.0,
        "capex": 5000.0,
        "dividends_paid": 3000.0,
        "revenue_prev": 90000.0,
        "earnings_prev": 12000.0,
        "cogs": 60000.0,
    }


def test_core_six():
    out = compute_ratios(base())
    assert out["pe"] == round(2500.0 / (15000.0 / 300.0), 4)
    assert out["pb"] == round(2500.0 / (75000.0 / 300.0), 4)
    assert out["roe"] == round(15000.0 / 75000.0 * 100, 4)
    assert out["roce"] == round(20000.0 / (150000.0 - 25000.0) * 100, 4)
    assert out["debt_to_equity"] == round(15000.0 / 75000.0, 4)
    assert out["market_cap"] == 750000.0


def test_extended_ratios_yfinance_semantics():
    # raw holds yfinance .info semantics: fractions for scale-100 keys,
    # rupees for scale-1e-7 money keys. engine.resolve_value applies scale.
    out = compute_ratios(base())
    raw = out["raw"]
    assert raw["returnOnAssets"] == round(15000.0 / 150000.0, 4)
    assert raw["profitMargins"] == round(15000.0 / 100000.0, 4)
    assert raw["operatingMargins"] == round(20000.0 / 100000.0, 4)
    assert raw["ebitdaMargins"] == round(25000.0 / 100000.0, 4)
    assert raw["currentRatio"] == round(40000.0 / 25000.0, 4)
    assert raw["quickRatio"] == round((40000.0 - 5000.0) / 25000.0, 4)
    assert raw["trailingEps"] == round(15000.0 / 300.0, 4)
    assert raw["bookValue"] == round(75000.0 / 300.0, 4)
    assert raw["revenueGrowth"] == round((100000.0 - 90000.0) / 90000.0, 4)
    assert raw["earningsGrowth"] == round((15000.0 - 12000.0) / 12000.0, 4)
    assert raw["payoutRatio"] == round(3000.0 / 15000.0, 4)
    assert raw["totalRevenue"] == round(100000.0 * 1e7, 4)
    assert raw["totalDebt"] == round(15000.0 * 1e7, 4)
    assert raw["priceToSalesTrailing12Months"] == round(out["market_cap"] / 100000.0, 4)


def test_market_cap_exact_cr():
    out = compute_ratios(base())
    assert out["market_cap"] == 750000.0


def test_zero_guards_yield_none():
    b = base()
    b["equity"] = 0
    b["shares_outstanding"] = 0
    b["current_liabilities"] = 0
    b["current_assets"] = 0
    out = compute_ratios(b)
    assert out["roe"] is None
    assert out["pe"] is None
    assert out["pb"] is None


def test_negative_capital_employed_yields_none_roce():
    b = base()
    b["total_assets"] = 10000.0
    b["current_liabilities"] = 25000.0
    out = compute_ratios(b)
    assert out["roce"] is None


def test_roce_falls_back_to_equity_plus_debt():
    b = {"ebit": 20000.0, "equity": 75000.0, "total_debt": 15000.0,
         "total_assets": 150000.0, "current_liabilities": None}
    out = compute_ratios(b)
    assert out["roce"] == round(20000.0 / (75000.0 + 15000.0) * 100, 4)


def test_none_numerator_yields_none_not_crash():
    b = {"price": 10.0, "shares_outstanding": 5.0, "equity": 100.0,
         "net_income": None, "revenue": 50.0}
    out = compute_ratios(b)
    assert out["roe"] is None
    assert out["pe"] is None  # eps needs net income


def test_negative_prev_yields_none_growth():
    from app.data.ratios_math import compute_ratios, BASE_FIELDS
    assert "revenue_prev" in BASE_FIELDS
    b = {
        "price": 100.0, "shares_outstanding": 10.0,
        "revenue": 1000.0, "revenue_prev": -500.0,
        "net_income": 50.0, "earnings_prev": -100.0,
    }
    out = compute_ratios(b)
    assert out["raw"].get("revenueGrowth") is None
    assert out["raw"].get("earningsGrowth") is None


def test_base_fields_whitelisted():
    assert "price" in BASE_FIELDS
    assert "net_income" in BASE_FIELDS


def test_derive_pe_from_pb_roe():
    from app.data.ratios_math import derive_missing
    computed = {"pe": None, "pb": 2.0, "roe": 20.0, "roce": 15.0,
                "debt_to_equity": 0.2, "market_cap": 50000.0}
    base = {"net_income": 5000.0, "equity": 25000.0}
    filled = derive_missing(computed, base)
    assert filled["pe"] == round(2.0 * 100 / 20.0, 4)


def test_derive_mcap_from_pe_net_income():
    from app.data.ratios_math import derive_missing
    computed = {"pe": 10.0, "pb": 2.0, "roe": 20.0, "roce": 15.0,
                "debt_to_equity": 0.2, "market_cap": None}
    base = {"net_income": 15000.0, "equity": 75000.0}
    filled = derive_missing(computed, base)
    assert filled["market_cap"] == round(10.0 * 15000.0, 4)


def test_derive_pb_from_mcap_equity():
    from app.data.ratios_math import derive_missing
    computed = {"pe": 10.0, "pb": None, "roe": 20.0, "roce": 15.0,
                "debt_to_equity": 0.2, "market_cap": 50000.0}
    base = {"equity": 25000.0, "net_income": 5000.0}
    filled = derive_missing(computed, base)
    assert filled["pb"] == round(50000.0 / 25000.0, 4)


def test_no_derive_when_negative_earnings():
    from app.data.ratios_math import derive_missing
    computed = {"pe": None, "pb": 2.0, "roe": -5.0, "roce": 15.0,
                "debt_to_equity": 0.2, "market_cap": 50000.0}
    base = {"net_income": -1000.0, "equity": 25000.0}
    filled = derive_missing(computed, base)
    assert "pe" not in filled
