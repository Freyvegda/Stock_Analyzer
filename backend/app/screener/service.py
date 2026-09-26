"""Screen service: fetch fundamentals, persist, evaluate, store runs.

Business logic for the fundamental screen lives here (BACKEND.md rule 6: thin
API layer). Routers validate input and call these functions. The endpoint is
synchronous for the MVP; an async job queue is a later optimization.
"""

import concurrent.futures
import json
import logging
from datetime import date, datetime, timezone

from app.auth.service import seed_default_criteria
from app.data.provider import DataProvider
from app.db.models import Fundamental, ScreenRun, Stock, UserCriteria
from app.screener.criteria import criteria_from_json, criteria_to_json
from app.screener.config import read_config_text
from app.screener.engine import evaluate_screen

logger = logging.getLogger(__name__)

# yfinance .info is network-bound; 8 workers keeps a ~500-stock run to minutes.
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


def run_screen(provider: DataProvider, session_factory, config: dict) -> dict:
    """Run the full fundamental screen and persist it. Same-day reruns merge."""
    today = date.today().isoformat()
    stocks = provider.list_stocks()
    results = _fetch_all(provider, stocks)

    rows: list[dict] = []
    failed_symbols: list[str] = []

    with session_factory() as session:
        existing = {s.symbol: s for s in session.query(Stock).all()}
        for stock_data, f, error in results:
            stock = existing.get(stock_data["symbol"])
            if stock is None:
                stock = Stock(symbol=stock_data["symbol"], name=stock_data["name"], sector=stock_data["sector"])
                session.add(stock)
                existing[stock.symbol] = stock
            stock.name = stock_data["name"]
            stock.sector = stock_data["sector"]

            if f is None:
                failed_symbols.append(stock_data["symbol"])
                session.merge(
                    Fundamental(
                        symbol=stock_data["symbol"],
                        date=today,
                        data_status="failed",
                        raw_json=json.dumps({"error": error or "fetch failed"}),
                    )
                )
                continue

            # Never null out a known market cap because a later fetch failed.
            if f.get("market_cap") is not None:
                stock.market_cap = f["market_cap"]
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
            rows.append({**f, "market_cap": f.get("market_cap")})

        shortlist, rejected = evaluate_screen(rows, config)
        run = ScreenRun(
            run_date=today,
            config_yaml=read_config_text(),
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
        "stale": bool(getattr(provider, "stale", False)),
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


def latest_screen(session_factory) -> dict | None:
    """Latest stored run joined with stock name/sector/market_cap. None if empty."""
    with session_factory() as session:
        run = session.query(ScreenRun).order_by(ScreenRun.id.desc()).first()
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
