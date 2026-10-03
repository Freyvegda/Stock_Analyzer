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
        "promoters_pct",
        "institutions_pct",
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
    # yfinance .info semantics: fractions here, engine.resolve_value ×100.
    raw["returnOnAssets"] = _round(_div(net_income, assets)) if net_income is not None and assets else None
    raw["profitMargins"] = _round(_div(net_income, revenue)) if revenue else None
    raw["operatingMargins"] = _round(_div(ebit, revenue)) if revenue else None
    raw["ebitdaMargins"] = _round(_div(ebitda, revenue)) if revenue else None
    raw["grossMargins"] = (
        _round((revenue - cogs) / revenue)
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
        _round((revenue - revenue_prev) / revenue_prev)
        if revenue is not None and revenue_prev is not None and revenue_prev > 0
        else None
    )
    raw["earningsGrowth"] = (
        _round((net_income - earnings_prev) / earnings_prev)
        if net_income is not None and earnings_prev is not None and earnings_prev > 0
        else None
    )
    # Fraction here, engine ×100. dividendYield stays % (catalog scale 1.0).
    raw["payoutRatio"] = _round(_div(dividends, net_income)) if net_income else None
    _div_yield = _div(dividends, market_cap)
    raw["dividendYield"] = _round(_div_yield * 100) if _div_yield is not None else None
    raw["priceToSalesTrailing12Months"] = _round(_div(market_cap, revenue)) if revenue else None

    enterprise_value = None
    if market_cap is not None and debt is not None:
        enterprise_value = market_cap + debt - cash
    raw["enterpriseToRevenue"] = _round(_div(enterprise_value, revenue)) if revenue else None
    raw["enterpriseToEbitda"] = _round(_div(enterprise_value, ebitda)) if ebitda else None

    free_cashflow = None
    if op_cf is not None:
        free_cashflow = op_cf - capex
    raw["freeCashflow"] = _round(None if free_cashflow is None else free_cashflow * 1e7)
    raw["operatingCashflow"] = _round(None if op_cf is None else op_cf * 1e7)
    raw["priceToFreeCashflow"] = _round(_div(market_cap, free_cashflow)) if free_cashflow else None

    # yfinance money semantics: rupees here, digest facts ×1e-7 to cr.
    raw["totalRevenue"] = _round(None if revenue is None else revenue * 1e7)
    raw["ebitda"] = _round(None if ebitda is None else ebitda * 1e7)
    raw["netIncomeToCommon"] = _round(None if net_income is None else net_income * 1e7)
    raw["totalCash"] = _round(None if _num(base.get("cash")) is None else _num(base.get("cash")) * 1e7)
    raw["totalDebt"] = _round(None if debt is None else debt * 1e7)
    # Holdings arrive as fractions; catalog scales ×100 on read.
    raw["heldPercentInsiders"] = _round(_num(base.get("promoters_pct")))
    raw["heldPercentInstitutions"] = _round(_num(base.get("institutions_pct")))

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
