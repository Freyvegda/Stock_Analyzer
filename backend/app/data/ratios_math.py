"""Pure math engine: derive catalog ratios from scraped statements + price.

No network, no DB. Money inputs in Rs cr, shares in cr shares, so
market_cap_cr = price * shares and per-share values divide evenly.
Missing/non-positive denominators yield None, never raise.
"""

BASE_FIELDS: frozenset[str] = frozenset(
    {
        "price",
        "shares_outstanding",
        "revenue",
        "net_income",
        "ebit",
        "ebitda",
        "equity",
        "total_assets",
        "current_assets",
        "current_liabilities",
        "inventory",
        "total_debt",
        "cash",
        "operating_cashflow",
        "capex",
        "dividends_paid",
        "revenue_prev",
        "earnings_prev",
        "cogs",
        "symbol",
    }
)


def _num(value) -> float | None:
    try:
        if value is None:
            return None
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):
        return None
    return result


def _div(numerator, denominator):
    num = _num(numerator)
    den = _num(denominator)
    if num is None or den is None or den <= 0:
        return None
    return num / den


def _round(value, digits: int = 4):
    return round(value, digits) if value is not None else None


def compute_ratios(base: dict) -> dict:
    """Derive screenable ratios from scraped base fields."""
    price = _num(base.get("price"))
    shares = _num(base.get("shares_outstanding"))
    revenue = _num(base.get("revenue"))
    net_income = _num(base.get("net_income"))
    ebit = _num(base.get("ebit"))
    ebitda = _num(base.get("ebitda"))
    equity = _num(base.get("equity"))
    assets = _num(base.get("total_assets"))
    curr_assets = _num(base.get("current_assets"))
    curr_liab = _num(base.get("current_liabilities"))
    inventory = _num(base.get("inventory")) or 0.0
    debt = _num(base.get("total_debt"))
    cash = _num(base.get("cash")) or 0.0
    op_cf = _num(base.get("operating_cashflow"))
    capex = _num(base.get("capex")) or 0.0
    dividends = _num(base.get("dividends_paid"))
    revenue_prev = _num(base.get("revenue_prev"))
    earnings_prev = _num(base.get("earnings_prev"))
    cogs = _num(base.get("cogs"))

    eps = _div(net_income, shares) if net_income is not None else None
    bvps = _div(equity, shares) if equity is not None else None
    rev_per_share = _div(revenue, shares) if revenue is not None else None

    pe = _div(price, eps) if price is not None and eps else None
    pb = _div(price, bvps) if price is not None and bvps else None

    market_cap = None
    if price is not None and shares is not None and shares > 0:
        market_cap = price * shares

    capital_employed = None
    if assets is not None and curr_liab is not None:
        capital_employed = assets - curr_liab

    raw: dict = {}
    raw["trailingEps"] = _round(eps)
    raw["bookValue"] = _round(bvps)
    raw["revenuePerShare"] = _round(rev_per_share)
    raw["returnOnAssets"] = _round(_div(net_income, assets) * 100) if net_income is not None and assets else None
    raw["profitMargins"] = _round(_div(net_income, revenue) * 100) if revenue else None
    raw["operatingMargins"] = _round(_div(ebit, revenue) * 100) if revenue else None
    raw["ebitdaMargins"] = _round(_div(ebitda, revenue) * 100) if revenue else None
    raw["grossMargins"] = (
        _round((revenue - cogs) / revenue * 100)
        if revenue and cogs is not None and revenue > 0
        else None
    )
    raw["currentRatio"] = _round(_div(curr_assets, curr_liab))
    raw["quickRatio"] = (
        _round((curr_assets - inventory) / curr_liab)
        if curr_assets is not None and curr_liab and curr_liab > 0
        else None
    )
    raw["revenueGrowth"] = (
        _round((revenue - revenue_prev) / revenue_prev * 100)
        if revenue is not None and revenue_prev
        else None
    )
    raw["earningsGrowth"] = (
        _round((net_income - earnings_prev) / earnings_prev * 100)
        if net_income is not None and earnings_prev
        else None
    )
    raw["payoutRatio"] = _round(_div(dividends, net_income) * 100) if net_income else None
    raw["dividendYield"] = (
        _round(_div(dividends, market_cap) * 100) if market_cap else None
    )
    raw["priceToSalesTrailing12Months"] = _round(_div(market_cap, revenue)) if revenue else None

    enterprise_value = None
    if market_cap is not None and debt is not None:
        enterprise_value = market_cap + debt - cash
    raw["enterpriseToRevenue"] = _round(_div(enterprise_value, revenue)) if revenue else None
    raw["enterpriseToEbitda"] = _round(_div(enterprise_value, ebitda)) if ebitda else None

    free_cashflow = None
    if op_cf is not None:
        free_cashflow = op_cf - capex
    raw["freeCashflow"] = _round(free_cashflow)
    raw["operatingCashflow"] = _round(op_cf)
    raw["priceToFreeCashflow"] = _round(_div(market_cap, free_cashflow)) if free_cashflow else None

    raw["totalRevenue"] = _round(revenue)
    raw["ebitda"] = _round(ebitda)
    raw["netIncomeToCommon"] = _round(net_income)
    raw["totalCash"] = _round(_num(base.get("cash")))
    raw["totalDebt"] = _round(debt)

    return {
        "symbol": base.get("symbol"),
        "pe": _round(pe),
        "pb": _round(pb),
        "roe": _round(_div(net_income, equity) * 100) if equity else None,
        "roce": _round(_div(ebit, capital_employed) * 100)
        if ebit is not None and capital_employed and capital_employed > 0
        else None,
        "debt_to_equity": _round(_div(debt, equity)) if equity else None,
        "market_cap": _round(market_cap),
        "raw": {k: v for k, v in raw.items() if v is not None},
    }
