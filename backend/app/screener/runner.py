"""Background run-job worker: refresh the stale universe, run every screen.

One job at a time per process (a module-level single-worker pool); progress is
persisted in ``run_jobs`` / ``run_job_items`` so polling survives reloads.
``execute_job`` is a plain synchronous function — tests call it directly, and it
never raises: a global failure marks the job ``failed`` while already-served
cached data stays intact (spec §Run flow 6–10).
"""

import concurrent.futures
import json
import logging
from datetime import date

from app.data.provider import DataProvider
from app.db.models import RunJob, RunJobItem, ScreenRun, Stock
from app.screener import service
from app.screener.criteria import criteria_from_json

logger = logging.getLogger(__name__)

#: yfinance-bound fetches per job; matches the provider's watchdog pool.
WORKERS = 16

#: Counter flush cadence — small committed transactions keep readers unblocked.
FLUSH_EVERY = 25

#: One job at a time; the API rejects a second run (409) before submit.
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)


def submit_job(job_id: int, provider: DataProvider, session_factory) -> None:
    """Queue one job on the module-level single worker thread."""
    _EXECUTOR.submit(execute_job, job_id, provider, session_factory)


def execute_job(job_id: int, provider: DataProvider, session_factory) -> None:
    """Run one job to completion; synchronous and never raises."""
    # Registered first so the interrupted sweep can tell live jobs from crashed
    # ones; unregistered even when the job explodes mid-run.
    service.register_active_job(job_id)
    try:
        _run_job(job_id, provider, session_factory)
    except Exception as e:  # noqa: BLE001 — a global failure is recorded, not raised
        logger.exception("run job %s failed", job_id)
        try:
            _mark_job_failed(session_factory, job_id, str(e))
        except Exception:  # noqa: BLE001 — the worker must never raise
            logger.exception("failed to record run job %s failure", job_id)
    finally:
        service.unregister_active_job(job_id)


def _run_job(job_id: int, provider: DataProvider, session_factory) -> None:
    today = date.today().isoformat()
    prepared = _prepare_job(job_id, provider, session_factory, today)
    if prepared is None:  # job row vanished
        return
    refresh, stocks, stock_by_symbol, stored_payload, sets, user_id, active_set_id, provider_stale = (
        prepared
    )

    _fetch_and_persist(
        job_id, provider, session_factory, refresh, stock_by_symbol, stored_payload, today
    )
    _run_screens(job_id, user_id, active_set_id, sets, stocks, provider_stale, session_factory, today)

    with session_factory() as session:
        job = session.get(RunJob, job_id)
        if job is not None:
            job.status = "done"
            job.finished_at = service.now_iso()
        session.commit()


def _prepare_job(job_id: int, provider: DataProvider, session_factory, today: str):
    """Step 1: load the job + its user's sets, order the refresh, save ``universe_total``.

    Returns ``None`` when the job row no longer exists. ``provider.list_stocks()``
    runs outside any session — a slow universe fetch must not hold a transaction.
    """
    with session_factory() as session:
        job = session.get(RunJob, job_id)
        if job is None:
            return None
        user_id = job.user_id
        active_set_id = job.set_id
        sets = {
            row.id: {"criteria_json": row.criteria_json, "shortlist_size": row.shortlist_size}
            for row in service._user_sets(session, user_id)
        }

    stocks = provider.list_stocks()
    provider_stale = bool(getattr(provider, "stale", False))

    with session_factory() as session:
        active_meta = sets.get(active_set_id)
        if active_meta is not None:
            # Stored-snapshot gate: survivors start the refresh queue so the
            # refined shortlist lands as early as possible.
            active_criteria = criteria_from_json(active_meta["criteria_json"])
            shortlist, _rejected, _stale = service.evaluate_stored_screen(
                session, stocks, active_criteria, active_meta["shortlist_size"], provider_stale, today
            )
            survivors = [row["symbol"] for row in shortlist]
        else:  # triggering set deleted mid-job: identity rows still needed
            _upsert_identity(session, stocks)
            survivors = []

        symbols = [stock["symbol"] for stock in stocks]
        latest = service.latest_ok_fundamentals(session, symbols)
        existing = {row.symbol: row for row in session.query(Stock).all()}
        refresh = [
            symbol for symbol in symbols if symbol not in latest or latest[symbol].date != today
        ]
        refresh.sort(key=_refresh_order(survivors, existing))

        stored_payload = {
            symbol: service.stored_row(symbol, latest[symbol], existing[symbol].market_cap)
            for symbol in refresh
            if symbol in latest
        }
        job = session.get(RunJob, job_id)
        job.universe_total = len(refresh)
        session.commit()

    stock_by_symbol = {stock["symbol"]: stock for stock in stocks}
    return (
        refresh,
        stocks,
        stock_by_symbol,
        stored_payload,
        sets,
        user_id,
        active_set_id,
        provider_stale,
    )


def _refresh_order(survivors: list[str], existing: dict[str, Stock]):
    """Sort key: stored-gate survivors (rank order) first, then descending
    ``market_cap`` with unknown caps last."""

    survivor_position = {symbol: index for index, symbol in enumerate(survivors)}

    def key(symbol: str):
        if symbol in survivor_position:
            return (0, survivor_position[symbol], 0.0)
        market_cap = existing[symbol].market_cap
        return (1, 1 if market_cap is None else 0, -(market_cap or 0.0))

    return key


def _upsert_identity(session, stocks: list[dict]) -> None:
    """Name/sector upsert for a universe whose triggering set is gone."""
    existing = {row.symbol: row for row in session.query(Stock).all()}
    for stock_data in stocks:
        stock = existing.get(stock_data["symbol"])
        if stock is None:
            stock = Stock(
                symbol=stock_data["symbol"], name=stock_data["name"], sector=stock_data["sector"]
            )
            session.add(stock)
            existing[stock.symbol] = stock
        stock.name = stock_data["name"]
        stock.sector = stock_data["sector"]


def _fetch_and_persist(
    job_id: int,
    provider: DataProvider,
    session_factory,
    symbols: list[str],
    stock_by_symbol: dict[str, dict],
    stored_payload: dict[str, dict],
    today: str,
) -> None:
    """Step 2: parallel fetch with per-stock isolation; persist every 25 results."""

    def fetch_one(symbol: str) -> tuple[dict, dict | None, str | None]:
        try:
            fundamentals = provider.fundamentals(symbol, cached=stored_payload.get(symbol))
            return stock_by_symbol[symbol], fundamentals, None
        except Exception as e:  # noqa: BLE001 — per-stock isolation, never re-raise
            logger.warning("fundamentals fetch failed for %s: %s", symbol, e)
            return stock_by_symbol[symbol], None, str(e)

    batch: list[tuple[dict, dict | None, str | None]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(fetch_one, symbol) for symbol in symbols]
        for future in concurrent.futures.as_completed(futures):
            batch.append(future.result())
            if len(batch) >= FLUSH_EVERY:
                _flush_batch(job_id, session_factory, batch, today)
                batch = []
    if batch:
        _flush_batch(job_id, session_factory, batch, today)


def _flush_batch(job_id: int, session_factory, batch: list, today: str) -> None:
    """Persist one fetched batch and advance the universe counters atomically."""
    with session_factory() as session:
        symbols = [stock["symbol"] for stock, _fundamentals, _error in batch]
        stocks_by_symbol = {
            row.symbol: row
            for row in session.query(Stock).filter(Stock.symbol.in_(symbols)).all()
        }
        fresh_rows, failed_symbols = service.persist_fetch_batch(
            session, batch, stocks_by_symbol, today
        )
        job = session.get(RunJob, job_id)
        if job is not None:
            job.universe_done += len(fresh_rows)
            job.universe_failed += len(failed_symbols)
        session.commit()


def _run_screens(
    job_id: int,
    user_id: int,
    active_set_id: int,
    sets: dict[int, dict],
    stocks: list[dict],
    provider_stale: bool,
    session_factory,
    today: str,
) -> None:
    """Steps 3–4: every queued screen (isolated), then the active refinement last."""
    with session_factory() as session:
        queued = [
            row.set_id
            for row in session.query(RunJobItem)
            .filter(RunJobItem.job_id == job_id, RunJobItem.status == "queued")
            .order_by(RunJobItem.set_id)
            .all()
        ]

    for set_id in queued:
        if set_id == active_set_id:
            continue  # the active screen is the refinement pass below
        service.mark_item(session_factory, job_id, set_id, "running")
        try:
            run_id = _persist_screen(
                session_factory, user_id, set_id, sets.get(set_id), stocks, provider_stale, today
            )
        except Exception as e:  # noqa: BLE001 — one failing screen never stops the job
            logger.warning("screen %s in job %s failed: %s", set_id, job_id, e)
            service.mark_item(session_factory, job_id, set_id, "failed", error=str(e))
            continue
        service.mark_item(session_factory, job_id, set_id, "done", run_id=run_id)

    # The active screen runs last: its fresh-data run refines the cached sync run
    # persisted by the API (that item is already ``done``; only run_id changes).
    # Isolated like every queued screen: a refinement failure never fails the job.
    active_meta = sets.get(active_set_id)
    if active_meta is None:
        service.mark_item(
            session_factory,
            job_id,
            active_set_id,
            "failed",
            error=f"screening set {active_set_id} not found",
        )
        return
    try:
        run_id = _persist_screen(
            session_factory, user_id, active_set_id, active_meta, stocks, provider_stale, today
        )
    except Exception as e:  # noqa: BLE001 — one failing screen never stops the job
        # Spec §Run flow 9: the refinement fails its item; the cached pre-refinement
        # run stays served and the job still finishes ``done``.
        logger.warning("active screen %s in job %s failed: %s", active_set_id, job_id, e)
        service.mark_item(session_factory, job_id, active_set_id, "failed", error=str(e))
        return
    service.mark_item(session_factory, job_id, active_set_id, "done", run_id=run_id)


def _persist_screen(
    session_factory,
    user_id: int,
    set_id: int,
    meta: dict | None,
    stocks: list[dict],
    provider_stale: bool,
    today: str,
) -> int:
    """Evaluate one screen over the fresh-or-stored snapshot; persist its ``ScreenRun``."""
    if meta is None:
        raise RuntimeError(f"screening set {set_id} not found")
    criteria = criteria_from_json(meta["criteria_json"])
    with session_factory() as session:
        shortlist, _rejected, _stale = service.evaluate_stored_screen(
            session, stocks, criteria, meta["shortlist_size"], provider_stale, today
        )
        run = ScreenRun(
            run_date=today,
            user_id=user_id,
            set_id=set_id,
            triggered_by="auto",
            criteria_json=json.dumps(criteria),
            shortlisted_json=json.dumps(shortlist),
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return run.id


def _mark_job_failed(session_factory, job_id: int, error: str) -> None:
    """Step 5: terminal failure record; queued/running items fail with the same error."""
    with session_factory() as session:
        job = session.get(RunJob, job_id)
        if job is None:
            return
        job.status = "failed"
        job.error = error
        job.finished_at = service.now_iso()
        set_ids = [
            row.set_id
            for row in session.query(RunJobItem)
            .filter(RunJobItem.job_id == job_id, RunJobItem.status.in_(("queued", "running")))
            .all()
        ]
        session.commit()
    for set_id in set_ids:
        service.mark_item(session_factory, job_id, set_id, "failed", error=error)
