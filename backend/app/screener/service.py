"""Screen service: snapshot batch + stored-snapshot run + job primitives, persistence.

Business logic for the fundamental screen lives here (BACKEND.md rule 6: thin
API layer). Routers validate input and call these functions. `POST /screen/run`
gates the stored snapshot for the active screen plus the most-used others
(zero network beyond ``list_stocks``) and persists one ``ScreenRun`` per screen;
the background refresh worker in ``runner.py`` then refreshes every stale
symbol on fresh data and refines every saved screen, active last.

Run flow (shared universe, Phase 1.8):
1. the API gates the stored snapshot with each screen's criteria and persists
   ``ScreenRun`` rows (active ``triggered_by=manual``, extras ``auto``) — no
   fundamentals calls;
2. ``POST /screen/run`` creates a job row and queues it on the runner; the
   worker refreshes fundamentals for every symbol whose snapshot is not from
   today (plus symbols with no stored row) — one refresh fills the shared DB;
3. after the refresh, the worker re-evaluates every saved screen (active last)
   and persists one ``ScreenRun`` per screen.
"""

import concurrent.futures
import json
import logging
from datetime import date, datetime, timezone

from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError

from app.data.provider import DataProvider
from app.db.models import (
    CompanyProfile,
    Fundamental,
    RunJob,
    RunJobItem,
    ScreeningSet,
    ScreenRun,
    Stock,
)
from app.screener.criteria import (
    ConfigError,
    criteria_from_json,
    criteria_to_json,
    default_criteria,
)
from app.screener.engine import rank_shortlist, screen_rows
from app.stock.store import profile_values, trim_raw, upsert_profile

logger = logging.getLogger(__name__)

# Job history kept per user (older jobs + their items are pruned on create).
KEEP_JOBS = 20

# Screener + Stooq police per-host bursts; 2 workers with the 2s
# polite delay stay near ~1 req/s and clear of 429 storms.
WORKERS = 2

#: The most-used measure looks at this many of the user's own (manual) runs.
MANUAL_RUN_WINDOW = 10

# Jobs whose worker thread is alive in this process; the interrupted sweep skips
# these so polling a live job never marks it interrupted.
_ACTIVE_JOB_IDS: set[int] = set()


class SetNotFoundError(Exception):
    """Raised when a screening set does not exist for the caller (404)."""


class LastSetError(Exception):
    """Raised when deleting the caller's last screening set (400)."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _now() -> str:
    """Legacy alias kept for direct callers; canonical clock is ``now_iso``."""
    return now_iso()


def latest_ok_fundamentals(session, symbols: list[str]) -> dict[str, Fundamental]:
    """Newest ``data_status='ok'`` row per symbol â€” the stored reference snapshot."""
    if not symbols:
        return {}
    newest = (
        session.query(Fundamental.symbol, func.max(Fundamental.date).label("date"))
        .filter(Fundamental.symbol.in_(symbols), Fundamental.data_status == "ok")
        .group_by(Fundamental.symbol)
        .subquery()
    )
    rows = (
        session.query(Fundamental)
        .join(newest, and_(Fundamental.symbol == newest.c.symbol, Fundamental.date == newest.c.date))
        .all()
    )
    return {row.symbol: row for row in rows}


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


def evaluate_stored_screen(
    session,
    stocks: list[dict],
    criteria: list[dict],
    shortlist_size: int,
    provider_stale: bool,
    today: str,
) -> tuple[list[dict], list[dict], bool]:
    """Gate the stored snapshot for one universe â€” pure DB reads + engine.

    Upserts ``stocks`` identity rows only (name/sector; ``market_cap`` belongs to
    the fetch path), reads the newest ok row per symbol, and evaluates the caller's
    criteria. ``stale`` is true when the provider flagged stale data or any
    shortlisted row is not from ``today``. No network, no commit.
    """
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
    candidates = [
        stored_row(symbol, latest[symbol], existing[symbol].market_cap)
        for symbol in symbols
        if symbol in latest
    ]

    survivors, rejected = screen_rows(candidates, criteria)
    shortlist = rank_shortlist(survivors, shortlist_size)
    stale = provider_stale or any(row.get("data_date") != today for row in shortlist)
    return shortlist, rejected, stale


def persist_fetch_batch(
    session,
    results: list[tuple[dict, dict | None, str | None]],
    stocks_by_symbol: dict[str, Stock],
    today: str,
) -> tuple[dict[str, dict], list[str]]:
    """Bulk-persist one fetched batch â€” one existence query per table, no per-row merge.

    ``results`` comes straight from the worker's fetch loop:
    ``[(stock, fundamentals | None, error | None)]``. Today's ``fundamentals``
    rows and the batch's ``company_profiles`` rows are loaded once, then updated
    in place (or added). Fetch-failure semantics match the legacy per-row loop:
    a ``failed`` row lands only when no same-day ``ok`` row exists, and a failed
    fetch never nulls a known ``market_cap``. No commit â€” the caller owns the
    transaction. ``fresh_rows[symbol]`` carries ``data_date=today``.
    """
    symbols = [stock_data["symbol"] for stock_data, _, _ in results]
    today_rows = {
        row.symbol: row
        for row in session.query(Fundamental)
        .filter(Fundamental.symbol.in_(symbols), Fundamental.date == today)
        .all()
    }
    profiles = {
        row.symbol: row
        for row in session.query(CompanyProfile).filter(CompanyProfile.symbol.in_(symbols)).all()
    }

    fresh_rows: dict[str, dict] = {}
    failed_symbols: list[str] = []
    for stock_data, f, error in results:
        symbol = stock_data["symbol"]
        if f is None:
            failed_symbols.append(symbol)
            # A failed refresh must never clobber a good same-day snapshot
            # (same rule as the stock detail path).
            row = today_rows.get(symbol)
            if row is None:
                row = Fundamental(
                    symbol=symbol,
                    date=today,
                    data_status="failed",
                    raw_json=json.dumps({"error": error or "fetch failed"}),
                )
                session.add(row)
                today_rows[symbol] = row
            elif row.data_status != "ok":
                row.data_status = "failed"
                row.raw_json = json.dumps({"error": error or "fetch failed"})
            continue

        # Never null out a known market cap because a later fetch failed.
        if f.get("market_cap") is not None:
            stocks_by_symbol[symbol].market_cap = f["market_cap"]

        raw_json = json.dumps(trim_raw(f["raw"]), default=str)
        row = today_rows.get(symbol)
        if row is None:
            row = Fundamental(symbol=symbol, date=today)
            session.add(row)
            today_rows[symbol] = row
        row.pe = f["pe"]
        row.pb = f["pb"]
        row.roe = f["roe"]
        row.roce = f["roce"]
        row.debt_to_equity = f["debt_to_equity"]
        row.data_status = "ok"
        row.raw_json = raw_json

        values = profile_values(f["raw"], today)
        profile = profiles.get(symbol)
        if profile is None:
            profile = CompanyProfile(symbol=symbol, **values)
            session.add(profile)
            profiles[symbol] = profile
        else:
            for key, value in values.items():
                setattr(profile, key, value)

        fresh_rows[symbol] = {**f, "market_cap": f.get("market_cap"), "data_date": today}

    return fresh_rows, failed_symbols


def _fetch_all(provider: DataProvider, stocks: list[dict]) -> list[tuple[dict, dict | None, str | None]]:
    """Fetch fundamentals per stock, isolating failures (BACKEND.md rule 4).

    Returns [(stock, fundamentals | None, error_text | None)] in input order.
    One failing stock never kills the batch.
    """

    def fetch_one(stock: dict) -> tuple[dict, dict | None, str | None]:
        try:
            return stock, provider.fundamentals(stock["symbol"]), None
        except Exception as e:  # noqa: BLE001 â€” per-stock isolation, never re-raise
            logger.warning("fundamentals fetch failed for %s: %s", stock["symbol"], e)
            return stock, None, str(e)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(fetch_one, stocks))


def latest_ok_fundamentals(session, symbols: list[str]) -> dict[str, Fundamental]:
    """Newest ``data_status='ok'`` row per symbol â€” the stored reference snapshot."""
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


def _prepare(provider: DataProvider, session_factory) -> dict:
    """Stages 1-2: refresh the shared snapshot and build the candidate rows.

    Gate failures cost no network calls; only symbols whose snapshot is not from
    today (plus symbols with no row) are refreshed. Returns everything the
    evaluation stage needs, so a batch can evaluate many screens on one snapshot.
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
        session.commit()
        return {
            "today": today,
            "candidates": candidates,
            "failed_symbols": failed_symbols,
            "total": len(stocks),
            "stale_provider": bool(getattr(provider, "stale", False)),
        }


def _evaluate_and_store(
    session_factory,
    user_id: int,
    prepared: dict,
    criteria: list[dict],
    shortlist_size: int,
    set_id: int | None,
    triggered_by: str,
) -> dict:
    """Stages 3-4: gate the prepared rows, rank, persist one ScreenRun."""
    with session_factory() as session:
        survivors, rejected = screen_rows(prepared["candidates"], criteria)

        shortlist = rank_shortlist(survivors, shortlist_size)
        stale = prepared["stale_provider"] or any(
            row.get("data_date") != prepared["today"] for row in shortlist
        )

        run = ScreenRun(
            run_date=prepared["today"],
            user_id=user_id,
            set_id=set_id,
            triggered_by=triggered_by,
            criteria_json=json.dumps(criteria),
            shortlisted_json=json.dumps(shortlist),
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return {
            "run_id": run.id,
            "shortlisted": shortlist,
            "failed_count": len(prepared["failed_symbols"]),
            "failed_symbols": prepared["failed_symbols"],
            "failed_details": rejected,
            "stale": stale,
            "total": prepared["total"],
        }


def run_screen(
    provider: DataProvider,
    session_factory,
    user: dict,
    criteria: list[dict],
    shortlist_size: int = 10,
    set_id: int | None = None,
) -> dict:
    """Run the staged fundamental screen for one user and persist it.

    Public wrapper kept for direct callers: one prepare stage plus one manual
    evaluation. The batch path reuses the same stages for the extra screens.
    """
    prepared = _prepare(provider, session_factory)
    return _evaluate_and_store(
        session_factory, user["id"], prepared, criteria, shortlist_size, set_id, "manual"
    )


def run_screen_batch(provider: DataProvider, session_factory, user: dict) -> dict:
    """One Run Screen: the active set (manual) plus the 3 most-used others (auto).

    All screens evaluate the same prepared candidates, so the batch costs one
    network stage. An extra screen failing is caught and reported; the active
    result always comes back.
    """
    active = get_active_set(session_factory, user["id"])
    prepared = _prepare(provider, session_factory)
    result = _evaluate_and_store(
        session_factory,
        user["id"],
        prepared,
        active["criteria"],
        active["shortlist_size"],
        active["id"],
        "manual",
    )
    extras: list[dict] = []
    for row in most_used_sets(session_factory, user["id"], limit=3, exclude_id=active["id"]):
        try:
            extra = _evaluate_and_store(
                session_factory,
                user["id"],
                prepared,
                row["criteria"],
                row["shortlist_size"],
                row["id"],
                "auto",
            )
            extras.append(
                {
                    "set_id": row["id"],
                    "name": row["name"],
                    "run_id": extra["run_id"],
                    "shortlisted": len(extra["shortlisted"]),
                    "error": None,
                }
            )
        except Exception as e:  # noqa: BLE001 â€” one extra never kills the batch
            logger.warning("extra screen run failed for set %s: %s", row["id"], e)
            extras.append(
                {
                    "set_id": row["id"],
                    "name": row["name"],
                    "run_id": None,
                    "shortlisted": None,
                    "error": str(e),
                }
            )
    result["extra_runs"] = extras
    return result


def run_snapshot_screen(
    provider: DataProvider,
    session_factory,
    user: dict,
    criteria: list[dict],
    shortlist_size: int,
    set_id: int | None,
) -> dict:
    """Stored-snapshot run: zero ``fundamentals()`` calls, one persisted ``ScreenRun``.

    ``provider.list_stocks()`` runs before any session opens â€” a slow or
    unreachable universe fetch must not hold a write transaction. Returns the
    cached-run payload so polling/shortlist consumers keep their shape.
    """
    today = date.today().isoformat()
    stocks = provider.list_stocks()

    with session_factory() as session:
        shortlist, rejected, stale = evaluate_stored_screen(
            session,
            stocks,
            criteria,
            shortlist_size,
            bool(getattr(provider, "stale", False)),
            today,
        )
        run = ScreenRun(
            run_date=today,
            user_id=user["id"],
            set_id=set_id,
            triggered_by="manual",
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
        "failed_count": 0,
        "failed_symbols": [],
        "failed_details": rejected,
        "stale": stale,
        "total": len(stocks),
    }




def run_snapshot_batch(provider: DataProvider, session_factory, user: dict) -> dict:
    """Snapshot batch: active screen (manual) + most-used others (auto), zero network.

    One ``provider.list_stocks()`` universe read, then one stored-snapshot
    evaluation per screen — no ``fundamentals()`` calls. An extra screen
    failing is caught and reported; the active result always comes back.
    """
    active = get_active_set(session_factory, user["id"])
    today = date.today().isoformat()
    stocks = provider.list_stocks()
    provider_stale = bool(getattr(provider, "stale", False))

    def _evaluate_and_persist(
        criteria: list[dict],
        shortlist_size: int,
        set_id: int | None,
        triggered_by: str,
    ) -> dict:
        with session_factory() as session:
            shortlist, rejected, stale = evaluate_stored_screen(
                session, stocks, criteria, shortlist_size, provider_stale, today
            )
            run = ScreenRun(
                run_date=today,
                user_id=user["id"],
                set_id=set_id,
                triggered_by=triggered_by,
                criteria_json=json.dumps(criteria),
                shortlisted_json=json.dumps(shortlist),
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            return {
                "run_id": run.id,
                "shortlisted": shortlist,
                "failed_count": 0,
                "failed_symbols": [],
                "failed_details": rejected,
                "stale": stale,
                "total": len(stocks),
            }

    result = _evaluate_and_persist(
        active["criteria"], active["shortlist_size"], active["id"], "manual"
    )
    extras: list[dict] = []
    for row in most_used_sets(session_factory, user["id"], limit=3, exclude_id=active["id"]):
        try:
            extra = _evaluate_and_persist(
                row["criteria"], row["shortlist_size"], row["id"], "auto"
            )
            extras.append(
                {
                    "set_id": row["id"],
                    "name": row["name"],
                    "run_id": extra["run_id"],
                    "shortlisted": len(extra["shortlisted"]),
                    "error": None,
                }
            )
        except Exception as e:  # noqa: BLE001 — one extra never kills the batch
            logger.warning("extra screen run failed for set %s: %s", row["id"], e)
            extras.append(
                {
                    "set_id": row["id"],
                    "name": row["name"],
                    "run_id": None,
                    "shortlisted": None,
                    "error": str(e),
                }
            )
    result["extra_runs"] = extras
    return {"run": result, "extra_runs": extras, "set_id": active["id"]}


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
    """Return the caller's active set, seeding ``"Default"`` on first use.

    Tolerates a parallel first load (the criteria page fires ``GET /screen/sets``
    and ``GET /screen/latest`` together): a losing insert is rolled back and the
    winner's row is adopted. Repairs users whose sets exist but none (or several)
    is active.
    """
    rows = _user_sets(session, user_id)
    if not rows:
        row = ScreeningSet(
            user_id=user_id,
            name="Default",
            criteria_json=criteria_to_json(default_criteria()),
            thesis=None,
            shortlist_size=10,
            is_active=True,
            updated_at=now_iso(),
        )
        session.add(row)
        try:
            session.flush()
            return row
        except IntegrityError:
            session.rollback()
            rows = _user_sets(session, user_id)
            if not rows:
                raise
    active = next((row for row in rows if row.is_active), None)
    if active is None:
        active = rows[0]
        active.is_active = True
    for row in rows:  # repair multiple-active corruption: keep the most recent
        if row is not active and row.is_active:
            row.is_active = False
    session.flush()
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


def most_used_sets(
    session_factory, user_id: int, limit: int = 3, exclude_id: int | None = None
) -> list[dict]:
    """Screens the caller runs most, from their last 10 manual runs.

    Auto runs (the batch's extra screens) never count, so the ranking reflects
    the user's own choices and cannot reinforce itself. Deleted screens drop out
    because their runs keep a NULL ``set_id``; ``exclude_id`` drops the active
    screen. Order: uses desc, most recent run desc, id asc.
    """
    with session_factory() as session:
        runs = (
            session.query(ScreenRun)
            .filter(ScreenRun.user_id == user_id, ScreenRun.triggered_by == "manual")
            .order_by(ScreenRun.id.desc())
            .limit(MANUAL_RUN_WINDOW)
            .all()
        )
        counts: dict[int, int] = {}
        latest_run: dict[int, int] = {}
        for run in runs:  # newest first
            if run.set_id is None:
                continue
            counts[run.set_id] = counts.get(run.set_id, 0) + 1
            latest_run.setdefault(run.set_id, run.id)
        if exclude_id is not None:
            counts.pop(exclude_id, None)
        if not counts:
            return []
        rows = {
            row.id: row
            for row in session.query(ScreeningSet).filter(ScreeningSet.id.in_(list(counts)))
        }
        picked = [rows[set_id] for set_id in counts if set_id in rows]
        picked.sort(key=lambda row: (-counts[row.id], -latest_run[row.id], row.id))
        return [_projection(row) for row in picked[:limit]]


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
            updated_at=now_iso(),
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
        row.updated_at = now_iso()
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
    """The active screen's latest stored run joined with stock meta."""
    with session_factory() as session:
        active = _seed_active_set(session, user_id)
        session.commit()
        run = (
            session.query(ScreenRun)
            .filter(ScreenRun.user_id == user_id, ScreenRun.set_id == active.id)
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


# --- Run jobs (Phase 1.8) ----------------------------------------------------


def register_active_job(job_id: int) -> None:
    """Mark a job's worker as alive in this process (interrupted sweep skips it)."""
    _ACTIVE_JOB_IDS.add(job_id)


def unregister_active_job(job_id: int) -> None:
    _ACTIVE_JOB_IDS.discard(job_id)


def _sweep_stale_jobs(session) -> None:
    """Mark unregistered ``running`` jobs ``interrupted`` (worker died)."""
    query = session.query(RunJob).filter(RunJob.status == "running")
    if _ACTIVE_JOB_IDS:
        query = query.filter(~RunJob.id.in_(_ACTIVE_JOB_IDS))
    query.update(
        {RunJob.status: "interrupted", RunJob.finished_at: now_iso()},
        synchronize_session=False,
    )


def mark_interrupted_jobs(session_factory) -> None:
    """Sweep every stale ``running`` job to ``interrupted``.

    Public documented interface; the operational trigger is the read-path sweep
    (``latest_job`` / ``busy_set_ids``), not ``init_db``.
    """
    with session_factory() as session:
        _sweep_stale_jobs(session)
        session.commit()


def _project_job(session, job: RunJob) -> dict:
    """Job projection; items active-first then by set id, deleted sets named ``""``."""
    rows = (
        session.query(RunJobItem, ScreeningSet)
        .outerjoin(ScreeningSet, ScreeningSet.id == RunJobItem.set_id)
        .filter(RunJobItem.job_id == job.id)
        .all()
    )
    items = sorted(
        rows,
        key=lambda pair: (0 if pair[1] is not None and pair[1].is_active else 1, pair[0].set_id),
    )
    return {
        "id": job.id,
        "set_id": job.set_id,
        "status": job.status,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "error": job.error,
        "universe_total": job.universe_total,
        "universe_done": job.universe_done,
        "universe_failed": job.universe_failed,
        "items": [
            {
                "set_id": item.set_id,
                "name": screen.name if screen is not None else "",
                "status": item.status,
                "run_id": item.run_id,
                "error": item.error,
                "started_at": item.started_at,
                "finished_at": item.finished_at,
            }
            for item, screen in items
        ],
    }


def _prune_jobs(session, user_id: int) -> None:
    """Keep the latest ``KEEP_JOBS`` jobs; prune items before their jobs."""
    job_ids = [
        row.id
        for row in session.query(RunJob.id)
        .filter(RunJob.user_id == user_id)
        .order_by(RunJob.id.desc())
        .all()
    ]
    doomed = job_ids[KEEP_JOBS:]
    if not doomed:
        return
    session.query(RunJobItem).filter(RunJobItem.job_id.in_(doomed)).delete(
        synchronize_session=False
    )
    session.query(RunJob).filter(RunJob.id.in_(doomed)).delete(synchronize_session=False)


def create_job(session_factory, user_id: int, set_id: int) -> dict:
    """Start one job: sweep stale runs, insert it + a queued item per user set,
    prune history, and return the projection."""
    with session_factory() as session:
        _sweep_stale_jobs(session)
        job = RunJob(
            user_id=user_id,
            set_id=set_id,
            started_at=now_iso(),
            status="running",
        )
        session.add(job)
        session.flush()  # job.id for its items
        for row in _user_sets(session, user_id):
            session.add(RunJobItem(job_id=job.id, set_id=row.id, status="queued"))
        session.flush()
        _prune_jobs(session, user_id)
        projection = _project_job(session, job)
        session.commit()
        return projection


def latest_job(session_factory, user_id: int) -> dict | None:
    """Newest job projection for the caller; stale running jobs swept first."""
    with session_factory() as session:
        _sweep_stale_jobs(session)
        session.commit()
        job = (
            session.query(RunJob)
            .filter(RunJob.user_id == user_id)
            .order_by(RunJob.id.desc())
            .first()
        )
        return _project_job(session, job) if job is not None else None


def busy_set_ids(session_factory, user_id: int) -> set[int]:
    """Sets with queued/running items in the caller's newest running job."""
    with session_factory() as session:
        _sweep_stale_jobs(session)
        session.commit()
        job = (
            session.query(RunJob)
            .filter(RunJob.user_id == user_id, RunJob.status == "running")
            .order_by(RunJob.id.desc())
            .first()
        )
        if job is None:
            return set()
        return {
            row.set_id
            for row in session.query(RunJobItem)
            .filter(RunJobItem.job_id == job.id, RunJobItem.status.in_(("queued", "running")))
            .all()
        }


def mark_item(
    session_factory,
    job_id: int,
    set_id: int,
    status: str,
    run_id: int | None = None,
    error: str | None = None,
) -> None:
    """Update one job item: status verbatim, timestamps on running/terminal."""
    with session_factory() as session:
        item = (
            session.query(RunJobItem)
            .filter(RunJobItem.job_id == job_id, RunJobItem.set_id == set_id)
            .first()
        )
        if item is None:
            return
        item.status = status
        if status == "running" and item.started_at is None:
            item.started_at = now_iso()
        if status in ("done", "failed"):
            if item.started_at is None:
                item.started_at = now_iso()
            item.finished_at = now_iso()
        if run_id is not None:
            item.run_id = run_id
        if error is not None:
            item.error = error
        session.commit()
