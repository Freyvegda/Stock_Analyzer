"""Stock detail service: stored-first snapshot, manual refresh, cached candles.

Business logic for ``/stock/*`` lives here (BACKEND.md rule 6). Stock data is
shared across users — the newest ``ok`` fundamentals row is served to everyone;
only the report/verdict is computed per caller from their saved criteria and is
never persisted. Daily bars are never written to the database: they come from the
provider through a process-memory TTL cache (``app/stock/candles.py``).
"""

import json
import logging
from datetime import date

from app.data.provider import DataProvider
from app.db.models import Fundamental, ScreenRun, Stock
from app.screener import service as screener_service
from app.stock import digest as digest_builder
from app.stock import report as report_builder
from app.stock import store
from app.stock.candles import aggregate_candles, slice_range

logger = logging.getLogger(__name__)


class StockNotFound(Exception):
    """Symbol is not part of the stored universe."""


class StockDataUnavailable(Exception):
    """No stored snapshot and the live fetch failed."""


class PriceDataUnavailable(Exception):
    """No daily bars available for the symbol."""


def _today() -> str:
    return date.today().isoformat()


def _load_stock(session, symbol: str) -> Stock:
    stock = session.get(Stock, symbol)
    if stock is None:
        raise StockNotFound(f"Unknown symbol {symbol}")
    return stock


def _latest_ok(session, symbol: str) -> Fundamental | None:
    """Newest ``data_status='ok'`` row — the shared stored snapshot."""
    return (
        session.query(Fundamental)
        .filter(Fundamental.symbol == symbol, Fundamental.data_status == "ok")
        .order_by(Fundamental.date.desc())
        .first()
    )


def _store_ok(session, stock: Stock, payload: dict, today: str) -> None:
    """Upsert today's snapshot (composite PK -> same-day rerun overwrites)."""
    raw = dict(payload.get("raw") or {})
    # Header fallback: keep the fetch price inside raw when the provider
    # carried it top-level (composite) so trim_raw persists it.
    try:
        if raw.get("price") is None and payload.get("price") is not None:
            raw["price"] = payload["price"]
    except Exception:  # noqa: BLE001 — price never blocks store
        pass
    session.merge(
        Fundamental(
            symbol=stock.symbol,
            date=today,
            pe=payload.get("pe"),
            pb=payload.get("pb"),
            roe=payload.get("roe"),
            roce=payload.get("roce"),
            debt_to_equity=payload.get("debt_to_equity"),
            data_status="ok",
            raw_json=json.dumps(store.trim_raw(raw), default=str),
        )
    )
    store.upsert_profile(session, stock.symbol, raw, today)
    if payload.get("market_cap") is not None:
        stock.market_cap = payload["market_cap"]
    session.commit()


def _store_failure(session, symbol: str, today: str, error: Exception) -> None:
    """Record a failed fetch, but never clobber a good same-day snapshot."""
    row = session.get(Fundamental, (symbol, today))
    if row is not None and row.data_status == "ok":
        return
    session.merge(
        Fundamental(
            symbol=symbol,
            date=today,
            data_status="failed",
            raw_json=json.dumps({"error": str(error)}),
        )
    )
    session.commit()


def _snapshot(row: Fundamental, stock: Stock) -> dict:
    """Engine/report row: derived columns + parsed raw payload + market cap."""
    try:
        raw = json.loads(row.raw_json) if row.raw_json else {}
    except (json.JSONDecodeError, TypeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "date": row.date,
        "pe": row.pe,
        "pb": row.pb,
        "roe": row.roe,
        "roce": row.roce,
        "debt_to_equity": row.debt_to_equity,
        "market_cap": stock.market_cap,
        "data_status": row.data_status,
        "raw": raw,
    }


def _latest_run_entry(session, user_id: int, symbol: str, set_id: int) -> dict | None:
    """Symbol's rank/score inside the active screen's latest run, if present.

    Scoped to the active set: with auto-runs stored, the user's newest run can
    belong to another screen and must not feed this chip.
    """
    run = (
        session.query(ScreenRun)
        .filter(ScreenRun.user_id == user_id, ScreenRun.set_id == set_id)
        .order_by(ScreenRun.id.desc())
        .first()
    )
    if run is None:
        return None
    try:
        shortlist = json.loads(run.shortlisted_json)
    except (json.JSONDecodeError, TypeError):
        return None
    for row in shortlist:
        if row.get("symbol") == symbol:
            return {
                "run_id": run.id,
                "run_date": run.run_date,
                "rank": row.get("rank"),
                "score": row.get("score"),
            }
    return None


def _detail_payload(
    session,
    session_factory,
    user_id: int,
    stock: Stock,
    row: Fundamental,
    refreshed: bool | None,
    warning: str | None,
) -> dict:
    snapshot = _snapshot(row, stock)
    active = screener_service.get_active_set(session_factory, user_id)
    report_sets = [active] + screener_service.most_used_sets(
        session_factory, user_id, limit=3, exclude_id=active["id"]
    )
    sections = digest_builder.build_sections(snapshot)
    public_snapshot = {
        key: snapshot[key]
        for key in ("date", "pe", "pb", "roe", "roce", "debt_to_equity", "data_status")
    }
    try:
        stored_price = (snapshot.get("raw") or {}).get("price")
    except Exception:  # noqa: BLE001 — price fallback never breaks detail
        stored_price = None
    try:
        stored_price = float(stored_price) if stored_price is not None else None
    except (TypeError, ValueError):
        stored_price = None
    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "sector": stock.sector,
        "market_cap": stock.market_cap,
        "price": stored_price,
        "price_as_of": snapshot["date"] if stored_price is not None else None,
        "snapshot": public_snapshot,
        "reports": [
            {
                "set_id": row["id"],
                "name": row["name"],
                "is_active": bool(row["is_active"]),
                "report": report_builder.build_report(snapshot, row["criteria"]),
            }
            for row in report_sets
        ],
        "profile": store.read_profile(session, stock.symbol),
        "main_ratios": sections["main_ratios"],
        "has": sections["has"],
        "done": sections["done"],
        "other_groups": sections["other_groups"],
        "data_date": snapshot["date"],
        "stale": snapshot["date"] != _today(),
        "run": _latest_run_entry(session, user_id, stock.symbol, active["id"]),
        "refreshed": refreshed,
        "warning": warning,
    }


def _fetch_isolated(provider: DataProvider, symbol: str) -> dict:
    """One stock's fundamentals fetch; failures never propagate raw."""
    return provider.fundamentals(symbol)


def get_stock_detail(
    session_factory, provider: DataProvider, user_id: int, symbol: str
) -> dict:
    """Stored-first detail payload: zero network when a snapshot exists."""
    with session_factory() as session:
        stock = _load_stock(session, symbol)
        latest = _latest_ok(session, symbol)
        if latest is None:
            try:
                payload = _fetch_isolated(provider, symbol)
            except Exception as e:  # noqa: BLE001 — per-stock isolation
                logger.warning("stock snapshot fetch failed for %s: %s", symbol, e)
                _store_failure(session, symbol, _today(), e)
                raise StockDataUnavailable(f"Stock data unavailable: {e}") from e
            _store_ok(session, stock, payload, _today())
            latest = _latest_ok(session, symbol)
        return _detail_payload(session, session_factory, user_id, stock, latest, None, None)


def refresh_stock(session_factory, provider: DataProvider, user_id: int, symbol: str) -> dict:
    """Force a live fetch; on failure keep serving the stored snapshot with a warning."""
    with session_factory() as session:
        stock = _load_stock(session, symbol)
        latest = _latest_ok(session, symbol)
        try:
            payload = _fetch_isolated(provider, symbol)
        except Exception as e:  # noqa: BLE001 — per-stock isolation
            logger.warning("stock refresh failed for %s: %s", symbol, e)
            _store_failure(session, symbol, _today(), e)
            if latest is None:
                raise StockDataUnavailable(f"Stock data unavailable: {e}") from e
            return _detail_payload(
                session,
                session_factory,
                user_id,
                stock,
                latest,
                refreshed=False,
                warning=f"Live refresh failed: {e}",
            )
        _store_ok(session, stock, payload, _today())
        latest = _latest_ok(session, symbol)
        return _detail_payload(session, session_factory, user_id, stock, latest, True, None)


def get_single_report(
    session_factory, provider: DataProvider, user_id: int, symbol: str, set_id: int
) -> dict:
    """One screen's verdict for one stock, from the shared stored snapshot.

    Lazy path for the detail accordion: no extra fundamentals fetch when a
    snapshot exists (zero network); first view of a symbol with no row fetches
    once exactly like the detail endpoint. Unknown sets raise the screener's
    SetNotFoundError so the router answers 404.
    """
    with session_factory() as session:
        stock = _load_stock(session, symbol)
        latest = _latest_ok(session, symbol)
        if latest is None:
            try:
                payload = _fetch_isolated(provider, symbol)
            except Exception as e:  # noqa: BLE001 — per-stock isolation
                logger.warning("stock snapshot fetch failed for %s: %s", symbol, e)
                _store_failure(session, symbol, _today(), e)
                raise StockDataUnavailable(f"Stock data unavailable: {e}") from e
            _store_ok(session, stock, payload, _today())
            latest = _latest_ok(session, symbol)
        snapshot = _snapshot(latest, stock)
    target = screener_service.get_set(session_factory, user_id, set_id)
    return {
        "set_id": target["id"],
        "name": target["name"],
        "is_active": bool(target["is_active"]),
        "report": report_builder.build_report(snapshot, target["criteria"]),
    }


def get_financials(session_factory, provider, symbol: str) -> dict:
    """Cached P&L history for one stock — file cache, zero DB writes.

    Unknown symbols raise ``StockNotFound`` (404); fetch failures raise
    ``StockDataUnavailable`` (502) while the snapshot detail still paints.
    """
    with session_factory() as session:
        stock = _load_stock(session, symbol)
    try:
        history = provider.financials(symbol)
    except Exception as e:  # noqa: BLE001 — per-stock isolation
        logger.warning("financials fetch failed for %s: %s", symbol, e)
        raise StockDataUnavailable(f"Financial history unavailable: {e}") from e
    return {
        "symbol": stock.symbol,
        "quarterly": history.get("quarterly") or [],
        "annual": history.get("annual") or [],
        "as_of": history.get("as_of"),
        "stale": bool(history.get("stale", True)),
    }


def get_ohlc(
    session_factory,
    provider: DataProvider,
    symbol: str,
    range_key: str,
    interval: str,
    cache,
) -> dict:
    """Sliced/aggregated daily candles; nothing is written to the database."""
    with session_factory() as session:
        stock = _load_stock(session, symbol)
    fetched = False

    def _load() -> list[dict]:
        nonlocal fetched
        fetched = True
        return provider.ohlc(symbol, years=5)

    try:
        rows = cache.get_or_fetch(symbol, _load)
    except Exception as e:  # noqa: BLE001 — per-stock isolation
        logger.warning("ohlc fetch failed for %s: %s", symbol, e)
        raise PriceDataUnavailable(f"Price data unavailable: {e}") from e
    if not rows:
        raise PriceDataUnavailable("Price data unavailable: no daily bars")
    if fetched:
        source = getattr(provider, "last_ohlc_source", None) or "live"
    else:
        source = "memory"
    return {
        "symbol": stock.symbol,
        "range": range_key,
        "interval": interval,
        "as_of": rows[-1]["time"],
        "candles": aggregate_candles(slice_range(rows, range_key), interval),
        "source": source,
        "stale": source == "cache-stale",
    }
