"""Screen service: stored-first staged screen, fetch survivors, persist, evaluate.

Business logic for the fundamental screen lives here (BACKEND.md rule 6: thin
API layer). Routers validate input and call these functions. The endpoint is
synchronous for the MVP; an async job queue is a later optimization.

Run flow (staged, few network calls):
1. gate the stored snapshot (newest ``ok`` row per symbol + ``stocks.market_cap``)
   with the caller's criteria — no network;
2. refresh yfinance fundamentals only for gate survivors (plus symbols with no
   stored row) — this is where 500 calls collapse to the survivors;
3. re-check refreshed rows on fresh values; a failed refresh keeps stored values.
"""

import concurrent.futures
import json
import logging
from datetime import date, datetime, timezone

from app.auth.service import seed_default_criteria
from app.data.provider import DataProvider
from app.db.models import Fundamental, ScreenRun, Stock, UserCriteria
from app.screener.criteria import criteria_from_json, criteria_to_json
from app.screener.engine import rank_shortlist, screen_rows

logger = logging.getLogger(__name__)

# yfinance .info is network-bound; 8 workers keeps a ~500-stock first run to minutes.
WORKERS = 8


def _fetch_all(provider: DataProvider, stocks: list[dict]) -> list[tuple[dict, dict | None, str | None]]:
    """Fetch fundamentals per stock, isolating failures (BACKEND.md rule 4).

    Returns [(stock, fundamentals | None, error_text | None)] in input order.
    One failing stock never kills the batch.
    """

    def fetch_one(stock: dict) -> tuple[dict, dict | None, str | None]:
        try:
            return stock, provider.fundamentals(stock["symbol"]), None
        except Exception as e:  # noqa: BLE001 — per-stock isolation, never re-raise
            logger.warning("fundamentals fetch failed for %s: %s", stock["symbol"], e)
            return stock, None, str(e)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(fetch_one, stocks))


def _latest_ok_fundamentals(session, symbols: list[str]) -> dict[str, Fundamental]:
    """Newest ``data_status='ok'`` row per symbol — the stored reference snapshot."""
    if not symbols:
        return {}
    rows = (
        session.query(Fundamental)
        .filter(Fundamental.symbol.in_(symbols), Fundamental.data_status == "ok")
        .order_by(Fundamental.symbol.asc(), Fundamental.date.desc())
        .all()
    )
    latest: dict[str, Fundamental] = {}
    for row in rows:
        latest.setdefault(row.symbol, row)
    return latest


def _stored_row(symbol: str, fundamental: Fundamental, market_cap: float | None) -> dict:
    """Engine row from the stored snapshot; ``raw_json`` back to dict for raw criteria."""
    try:
        raw = json.loads(fundamental.raw_json) if fundamental.raw_json else {}
    except (json.JSONDecodeError, TypeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "symbol": symbol,
        "pe": fundamental.pe,
        "pb": fundamental.pb,
        "roe": fundamental.roe,
        "roce": fundamental.roce,
        "debt_to_equity": fundamental.debt_to_equity,
        "market_cap": market_cap,
        "raw": raw,
        "data_date": fundamental.date,
    }


def run_screen(
    provider: DataProvider,
    session_factory,
    user: dict,
    criteria: list[dict],
    shortlist_size: int = 10,
) -> dict:
    """Run the staged fundamental screen for one user and persist it.

    Gate failures cost no network calls; only survivors are refreshed. Same-day
    reruns merge fundamentals; one ScreenRun per call with the criteria snapshot
    verbatim for reproducibility.
    """
    today = date.today().isoformat()
    stocks = provider.list_stocks()

    with session_factory() as session:
        existing = {s.symbol: s for s in session.query(Stock).all()}
        for stock_data in stocks:
            stock = existing.get(stock_data["symbol"])
            if stock is None:
                stock = Stock(symbol=stock_data["symbol"], name=stock_data["name"], sector=stock_data["sector"])
                session.add(stock)
                existing[stock.symbol] = stock
            stock.name = stock_data["name"]
            stock.sector = stock_data["sector"]

        symbols = [stock_data["symbol"] for stock_data in stocks]
        latest = _latest_ok_fundamentals(session, symbols)
        stored_rows = {
            symbol: _stored_row(symbol, latest[symbol], existing[symbol].market_cap)
            for symbol in symbols
            if symbol in latest
        }

        # Stage 1: narrow the universe on the stored snapshot (no network).
        passers, rejected = screen_rows(list(stored_rows.values()), criteria)

        # Stage 2: refresh gate survivors + symbols that have no stored row yet.
        refresh_symbols = [row["symbol"] for row in passers]
        refresh_symbols += [symbol for symbol in symbols if symbol not in latest]
        stock_by_symbol = {stock_data["symbol"]: stock_data for stock_data in stocks}
        results = _fetch_all(provider, [stock_by_symbol[symbol] for symbol in refresh_symbols])

        fresh_rows: dict[str, dict] = {}
        failed_symbols: list[str] = []
        for stock_data, f, error in results:
            symbol = stock_data["symbol"]
            if f is None:
                failed_symbols.append(symbol)
                session.merge(
                    Fundamental(
                        symbol=symbol,
                        date=today,
                        data_status="failed",
                        raw_json=json.dumps({"error": error or "fetch failed"}),
                    )
                )
                continue

            # Never null out a known market cap because a later fetch failed.
            if f.get("market_cap") is not None:
                existing[symbol].market_cap = f["market_cap"]
            session.merge(
                Fundamental(
                    symbol=f["symbol"],
                    date=today,
                    pe=f["pe"],
                    pb=f["pb"],
                    roe=f["roe"],
                    roce=f["roce"],
                    debt_to_equity=f["debt_to_equity"],
                    data_status="ok",
                    raw_json=json.dumps(f["raw"], default=str),
                )
            )
            fresh_rows[symbol] = {**f, "market_cap": f.get("market_cap"), "data_date": today}

        # Fresh values win; a failed refresh falls back to the stored row.
        candidates = [
            fresh_rows.get(symbol) or stored_rows[symbol]
            for symbol in refresh_symbols
            if symbol in fresh_rows or symbol in stored_rows
        ]
        survivors, fresh_rejected = screen_rows(candidates, criteria)
        rejected.extend(fresh_rejected)

        shortlist = rank_shortlist(survivors, shortlist_size)
        stale = bool(getattr(provider, "stale", False)) or any(
            row.get("data_date") != today for row in shortlist
        )

        run = ScreenRun(
            run_date=today,
            user_id=user["id"],
            criteria_json=json.dumps(criteria),
            shortlisted_json=json.dumps(shortlist),
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

    return {
        "run_id": run_id,
        "shortlisted": shortlist,
        "failed_count": len(failed_symbols),
        "failed_symbols": failed_symbols,
        "failed_details": rejected,
        "stale": stale,
        "total": len(stocks),
    }


def get_criteria(session_factory, user_id: int) -> dict:
    """Caller's criteria; seeds Phase-1 defaults on first read. Corrupt JSON
    (tampered DB) falls back to defaults rather than 500-ing."""
    with session_factory() as session:
        row = seed_default_criteria(session, user_id)
        session.commit()
        return {
            "criteria": criteria_from_json(row.criteria_json),
            "thesis": row.thesis,
            "shortlist_size": row.shortlist_size,
        }


def save_criteria(session_factory, user_id: int, criteria: list[dict], thesis: str | None) -> dict:
    """Persist the caller's criteria. ``shortlist_size`` stays server-owned."""
    with session_factory() as session:
        row = seed_default_criteria(session, user_id)
        row.criteria_json = criteria_to_json(criteria)
        row.thesis = thesis
        row.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        session.commit()
        return {
            "criteria": criteria_from_json(row.criteria_json),
            "thesis": row.thesis,
            "shortlist_size": row.shortlist_size,
        }


def latest_screen(session_factory, user_id: int) -> dict | None:
    """Caller's latest stored run joined with stock name/sector/market_cap."""
    with session_factory() as session:
        run = (
            session.query(ScreenRun)
            .filter(ScreenRun.user_id == user_id)
            .order_by(ScreenRun.id.desc())
            .first()
        )
        if run is None:
            return None
        shortlist = json.loads(run.shortlisted_json)
        meta = {
            s.symbol: {"name": s.name, "sector": s.sector, "market_cap": s.market_cap}
            for s in session.query(Stock).filter(Stock.symbol.in_([r["symbol"] for r in shortlist]))
        }
        for row in shortlist:
            row.update(meta.get(row["symbol"], {}))
        return {"run_id": run.id, "run_date": run.run_date, "shortlisted": shortlist}
