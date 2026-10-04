"""Universe listing: the whole stored Nifty 500 with the caller's verdict.

Shared stock data (identity + newest stored snapshot) is read once; the verdict
(`pass` / `fail` / `no_data`) is computed per caller from their saved criteria and
never persisted. Seeds `stocks` lazily when the table is empty — identity only,
no fundamentals fetch (that stays on the screen run and the detail page).
"""

from app.data.provider import DataProvider
from app.db.models import Stock
from app.screener import engine
from app.screener import service as screener_service


def _row_out(stock: Stock, stored: dict | None, enabled_count: int, criteria) -> dict:
    base = {
        "symbol": stock.symbol,
        "name": stock.name,
        "sector": stock.sector,
        "market_cap": stock.market_cap,
        "pe": None,
        "pb": None,
        "roe": None,
        "roce": None,
        "debt_to_equity": None,
        "data_date": None,
        "passes": 0,
        "enabled": enabled_count,
        "verdict": "no_data",
    }
    if stored is None:
        return base

    passes = sum(
        1
        for spec, limit in criteria
        if engine.passes(engine.resolve_value(stored, spec), limit, spec.direction)
    )
    return {
        **base,
        "pe": stored["pe"],
        "pb": stored["pb"],
        "roe": stored["roe"],
        "roce": stored["roce"],
        "debt_to_equity": stored["debt_to_equity"],
        "data_date": stored["data_date"],
        "passes": passes,
        "verdict": "pass" if passes == enabled_count else "fail",
    }


def list_universe(session_factory, provider: DataProvider, user_id: int, set_id: int | None = None) -> dict:
    """`{as_of, total, rows}` — rows sorted by symbol, verdict per caller.

    ``set_id=None`` grades against the active screen (legacy). A concrete id
    grades the same shared snapshot against that saved screen — a pure read
    that never writes. Unknown/foreign sets raise ``SetNotFoundError`` via
    ``get_set`` (mapped to 404 at the API layer).
    """
    with session_factory() as session:
        if session.query(Stock).count() == 0:
            for data in provider.list_stocks():
                session.merge(
                    Stock(
                        symbol=data["symbol"],
                        name=data["name"],
                        sector=data.get("sector"),
                        market_cap=data.get("market_cap"),
                    )
                )
            session.commit()

        stocks = session.query(Stock).order_by(Stock.symbol.asc()).all()
        latest = screener_service.latest_ok_fundamentals(session, [s.symbol for s in stocks])
        if set_id is None:
            criteria = screener_service.get_criteria(session_factory, user_id)["criteria"]
        else:
            criteria = screener_service.get_set(session_factory, user_id, set_id)["criteria"]
        enabled = engine.enabled_criteria(criteria)

        rows = []
        dates = []
        for stock in stocks:
            fundamental = latest.get(stock.symbol)
            stored = (
                screener_service.stored_row(stock.symbol, fundamental, stock.market_cap)
                if fundamental is not None
                else None
            )
            row = _row_out(stock, stored, len(enabled), enabled)
            if row["data_date"] is not None:
                dates.append(row["data_date"])
            rows.append(row)

    return {"as_of": max(dates) if dates else None, "total": len(rows), "rows": rows}
