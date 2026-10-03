"""Backfill null fundamentals for every stock (manual, online).

Recomputes fundamentals only for symbols whose newest ok row (or stocks
market_cap) still has nulls, using the composite chain: screener statements +
Stooq quote + math, per-field yfinance fill, yfinance statements-base +
ratio-calculator fallback when throttled. Per-stock isolation: one failure
never stops the batch.

Usage from backend/ with venv active:
    .\\.venv\\Scripts\\python.exe scripts/backfill_nulls.py --dry-run
    .\\.venv\\Scripts\\python.exe scripts/backfill_nulls.py --limit 20
    .\\.venv\\Scripts\\python.exe scripts/backfill_nulls.py
"""

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.data.composite_impl import _DERIVED_KEYS, build_default_provider
from app.db.database import SessionLocal, init_db
from app.db.models import Fundamental, Stock
from app.screener import service as screener_service

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill")


def null_symbols(session):
    stocks = {s.symbol: s for s in session.query(Stock).all()}
    symbols = sorted(stocks)
    latest = screener_service.latest_ok_fundamentals(session, symbols)
    out = []
    for symbol in symbols:
        row = latest.get(symbol)
        if row is None:
            out.append(symbol)
            continue
        missing = [k for k in ("pe", "pb", "roe", "roce", "debt_to_equity")
                   if getattr(row, k) is None]
        if missing or stocks[symbol].market_cap is None:
            out.append(symbol)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--refresh-statements", action="store_true",
                    help="delete cached statements for targets so the fixed "
                    "parser refetches instead of serving stale parses")
    args = ap.parse_args()

    init_db()
    with SessionLocal() as session:
        targets = null_symbols(session)
    print(f"symbols with nulls: {len(targets)}")
    if args.limit:
        targets = targets[: args.limit]
    print(f"targets this run: {len(targets)}")
    if args.dry_run:
        print(",".join(targets[:50]))
        return 0

    if args.refresh_statements:
        import os as _os
        repo = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", ".."))
        sdir = _os.path.join(repo, "data", "statements")
        cleared = 0
        for symbol in targets:
            path = _os.path.join(sdir, symbol + ".json")
            try:
                if _os.path.exists(path):
                    _os.remove(path)
                    cleared += 1
            except OSError:
                pass
        print(f"cleared {cleared} stale statements caches")

    from datetime import date

    today = date.today().isoformat()
    provider = build_default_provider()
    done = filled = failed = 0
    batch = []
    stocks_by = {}
    with SessionLocal() as session:
        stocks_by = {s.symbol: s for s in session.query(Stock).all()}
        latest = screener_service.latest_ok_fundamentals(session, list(stocks_by))
        stored = {
            s: screener_service.stored_row(s, latest[s], stocks_by[s].market_cap)
            for s in targets if s in latest
        }

    def flush():
        nonlocal done, filled
        with SessionLocal() as session:
            by_symbol = {s.symbol: s for s in session.query(Stock).all()}
            symbols = [sd["symbol"] for sd, _, _ in batch]
            known = {r.symbol: r for r in session.query(Stock).filter(Stock.symbol.in_(symbols)).all()}
            for sd in [b[0] for b in batch]:
                if sd["symbol"] not in known:
                    known[sd["symbol"]] = Stock(
                        symbol=sd["symbol"], name=sd.get("name"), sector=sd.get("sector"))
                    session.add(known[sd["symbol"]])
            fresh, _failed = screener_service.persist_fetch_batch(session, batch, known, today)
            session.commit()
            for symbol, f in fresh.items():
                before = stored.get(symbol, {})
                gaps = [k for k in _DERIVED_KEYS
                        if before.get(k) is None and f.get(k) is not None]
                if gaps:
                    filled += 1
                    logger.info("%s filled %s", symbol, gaps)
            done += len(fresh)

    for i, symbol in enumerate(targets):
        stock = {"symbol": symbol,
                 "name": (stocks_by.get(symbol).name if stocks_by.get(symbol) else None),
                 "sector": (stocks_by.get(symbol).sector if stocks_by.get(symbol) else None)}
        try:
            f = provider.fundamentals(symbol, cached=stored.get(symbol))
            batch.append((stock, f, None))
        except Exception as e:  # noqa: BLE001 — per-stock isolation
            logger.warning("%s failed: %s", symbol, e)
            batch.append((stock, None, str(e)))
            failed += 1
        if len(batch) >= 10:
            flush()
            batch = []
        time.sleep(args.delay)
    if batch:
        flush()
    print(f"done={done} symbols_with_new_fills={filled} failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
