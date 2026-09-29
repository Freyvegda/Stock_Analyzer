"""Screen service: stored-first staged screen, fetch survivors, persist, evaluate.

Business logic for the fundamental screen lives here (BACKEND.md rule 6: thin
API layer). Routers validate input and call these functions. The endpoint is
synchronous for the MVP; an async job queue is a later optimization.

Run flow (shared universe, one network stage):
1. gate the stored snapshot (newest ``ok`` row per symbol + ``stocks.market_cap``)
   with the caller's criteria — no network;
2. refresh fundamentals for every symbol whose snapshot is not from today (plus
   symbols with no stored row) — first run of the day fills the shared DB for all
   users; same-day reruns cost zero calls;
3. re-check all rows on fresh-or-stored values; a failed refresh keeps stored values.
"""

import concurrent.futures
import json
import logging
from datetime import date, datetime, timezone

from app.data.provider import DataProvider
from app.db.models import Fundamental, ScreeningSet, ScreenRun, Stock
from app.screener.criteria import (
    ConfigError,
    criteria_from_json,
    criteria_to_json,
    default_criteria,
)
from app.screener.engine import rank_shortlist, screen_rows
from app.stock.store import trim_raw, upsert_profile

logger = logging.getLogger(__name__)

# yfinance .info is network-bound; 8 workers keeps a ~500-stock first run to minutes.
WORKERS = 8


class SetNotFoundError(Exception):
    """Raised when a screening set does not exist for the caller (404)."""


class LastSetError(Exception):
    """Raised when deleting the caller's last screening set (400)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def latest_ok_fundamentals(session, symbols: list[str]) -> dict[str, Fundamental]:
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


def stored_row(symbol: str, fundamental: Fundamental, market_cap: float | None) -> dict:
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
        latest = latest_ok_fundamentals(session, symbols)
        stored_rows = {
            symbol: stored_row(symbol, latest[symbol], existing[symbol].market_cap)
            for symbol in symbols
            if symbol in latest
        }

        # Refresh every symbol whose snapshot is not from today (plus symbols with
        # no stored row), so one run fills the shared DB for all users. Rejections
        # are computed once, on the best values (fresh where fetched, stored else).
        refresh_symbols = [
            symbol for symbol in symbols if symbol not in latest or latest[symbol].date != today
        ]
        stock_by_symbol = {stock_data["symbol"]: stock_data for stock_data in stocks}
        results = _fetch_all(provider, [stock_by_symbol[symbol] for symbol in refresh_symbols])

        fresh_rows: dict[str, dict] = {}
        failed_symbols: list[str] = []
        for stock_data, f, error in results:
            symbol = stock_data["symbol"]
            if f is None:
                failed_symbols.append(symbol)
                # A failed refresh must never clobber a good same-day snapshot
                # (same rule as the stock detail path).
                today_row = session.get(Fundamental, (symbol, today))
                if today_row is None or today_row.data_status != "ok":
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
                    raw_json=json.dumps(trim_raw(f["raw"]), default=str),
                )
            )
            upsert_profile(session, symbol, f["raw"], today)
            fresh_rows[symbol] = {**f, "market_cap": f.get("market_cap"), "data_date": today}

        # Fresh values win; a failed refresh falls back to the stored row. Every
        # symbol with data (today's or stored) is evaluated once on the best values.
        candidates = [
            fresh_rows.get(symbol) or stored_rows[symbol]
            for symbol in symbols
            if symbol in fresh_rows or symbol in stored_rows
        ]
        survivors, rejected = screen_rows(candidates, criteria)

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


def _projection(row: ScreeningSet) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "criteria": criteria_from_json(row.criteria_json),
        "thesis": row.thesis,
        "shortlist_size": row.shortlist_size,
        "is_active": bool(row.is_active),
        "updated_at": row.updated_at,
    }


def _user_sets(session, user_id: int) -> list[ScreeningSet]:
    return (
        session.query(ScreeningSet)
        .filter(ScreeningSet.user_id == user_id)
        .order_by(ScreeningSet.updated_at.desc(), ScreeningSet.id.desc())
        .all()
    )


def _seed_active_set(session, user_id: int) -> ScreeningSet:
    """Return the caller's active set, seeding ``"Default"`` on first use and
    repairing users whose sets exist but none is active."""
    rows = _user_sets(session, user_id)
    if not rows:
        row = ScreeningSet(
            user_id=user_id,
            name="Default",
            criteria_json=criteria_to_json(default_criteria()),
            thesis=None,
            shortlist_size=10,
            is_active=True,
            updated_at=_now(),
        )
        session.add(row)
        session.flush()
        return row
    active = next((row for row in rows if row.is_active), None)
    if active is None:
        rows[0].is_active = True
        session.flush()
        active = rows[0]
    return active


def _require_set(session, user_id: int, set_id: int) -> ScreeningSet:
    row = session.get(ScreeningSet, set_id)
    if row is None or row.user_id != user_id:
        raise SetNotFoundError(f"screening set {set_id} not found")
    return row


def _reject_duplicate_name(session, user_id: int, name: str, exclude_id: int | None = None) -> None:
    needle = name.strip().lower()
    for row in _user_sets(session, user_id):
        if row.id != exclude_id and row.name.strip().lower() == needle:
            raise ConfigError(f"a screen named {name!r} already exists")


def list_sets(session_factory, user_id: int) -> list[dict]:
    """All of the caller's screening sets, creation order; seeds defaults."""
    with session_factory() as session:
        _seed_active_set(session, user_id)
        session.commit()
        rows = (
            session.query(ScreeningSet)
            .filter(ScreeningSet.user_id == user_id)
            .order_by(ScreeningSet.id.asc())
            .all()
        )
        return [_projection(row) for row in rows]


def get_active_set(session_factory, user_id: int) -> dict:
    """The caller's active screening set; seeds ``"Default"`` when absent."""
    with session_factory() as session:
        row = _seed_active_set(session, user_id)
        session.commit()
        return _projection(row)


def get_criteria(session_factory, user_id: int) -> dict:
    """Active-set projection; kept for the stock report/universe consumers."""
    return get_active_set(session_factory, user_id)


def create_set(
    session_factory,
    user_id: int,
    name: str,
    criteria: list[dict] | None,
    thesis: str | None,
) -> dict:
    """Create a screen; copies the active set's criteria when none are given and
    becomes the active screen."""
    name = name.strip()
    with session_factory() as session:
        active = _seed_active_set(session, user_id)
        _reject_duplicate_name(session, user_id, name)
        items = criteria if criteria is not None else criteria_from_json(active.criteria_json)
        session.query(ScreeningSet).filter(ScreeningSet.user_id == user_id).update(
            {ScreeningSet.is_active: False}
        )
        row = ScreeningSet(
            user_id=user_id,
            name=name,
            criteria_json=criteria_to_json(items),
            thesis=thesis,
            shortlist_size=10,
            is_active=True,
            updated_at=_now(),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return _projection(row)


def update_set(session_factory, user_id: int, set_id: int, changes: dict) -> dict:
    """Patch ``name`` / ``criteria`` / ``thesis`` (keys present in ``changes``)."""
    with session_factory() as session:
        row = _require_set(session, user_id, set_id)
        if "name" in changes and changes["name"] is not None:
            name = str(changes["name"]).strip()
            _reject_duplicate_name(session, user_id, name, exclude_id=set_id)
            row.name = name
        if "criteria" in changes and changes["criteria"] is not None:
            row.criteria_json = criteria_to_json(changes["criteria"])
        if "thesis" in changes:
            row.thesis = changes["thesis"]
        row.updated_at = _now()
        session.commit()
        return _projection(row)


def delete_set(session_factory, user_id: int, set_id: int) -> None:
    """Delete a screen; the last one is protected; runs keep their audit rows."""
    with session_factory() as session:
        rows = _user_sets(session, user_id)
        row = _require_set(session, user_id, set_id)
        if len(rows) <= 1:
            raise LastSetError("the last screening set cannot be deleted")
        was_active = bool(row.is_active)
        session.delete(row)
        session.query(ScreenRun).filter(
            ScreenRun.user_id == user_id, ScreenRun.set_id == set_id
        ).update({ScreenRun.set_id: None})
        session.flush()
        if was_active:
            remaining = _user_sets(session, user_id)
            remaining[0].is_active = True
        session.commit()


def activate_set(session_factory, user_id: int, set_id: int) -> dict:
    """Make one set active, deactivating the caller's other sets."""
    with session_factory() as session:
        _seed_active_set(session, user_id)
        row = _require_set(session, user_id, set_id)
        session.query(ScreeningSet).filter(ScreeningSet.user_id == user_id).update(
            {ScreeningSet.is_active: False}
        )
        row.is_active = True
        session.commit()
        return _projection(row)


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
