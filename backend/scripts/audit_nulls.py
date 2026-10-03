"""Audit null fundamentals for every stock (offline, DB + statements cache).

Usage from backend/ with venv active:
    .\\.venv\\Scripts\\python.exe scripts/audit_nulls.py [--limit 30]

Prints per-field null counts over each symbol's newest ok row plus the
per-symbol missing list with base-input reasons (no network).
"""

import argparse
import json
import os
import sqlite3
import sys

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB_PATH = os.path.join(_REPO_ROOT, "data", "stockanalyzer.db")
STATEMENTS_DIR = os.path.join(_REPO_ROOT, "data", "statements")

sys.path.insert(0, os.path.join(_REPO_ROOT, "backend"))

from app.data.composite_impl import _DERIVED_KEYS, _missing_reasons  # noqa: E402

BASE_KEYS = (
    "price", "shares_outstanding", "revenue", "net_income", "ebit",
    "equity", "total_assets", "current_liabilities", "total_debt",
)


def latest_ok_per_stock(cur):
    cur.execute(
        "select symbol, max(date) from fundamentals "
        "where data_status='ok' group by symbol"
    )
    return dict(cur.fetchall())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()
    if not os.path.exists(DB_PATH):
        print(f"no db at {DB_PATH}")
        return 1
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("select count(*) from stocks")
    print("stocks", cur.fetchone()[0])
    latest = latest_ok_per_stock(cur)
    print("symbols with ok snapshot", len(latest))
    counts = {k: 0 for k in _DERIVED_KEYS}
    any_null = 0
    rows = []
    for symbol, date in sorted(latest.items()):
        cur.execute(
            "select pe,pb,roe,roce,debt_to_equity from fundamentals "
            "where symbol=? and date=?",
            (symbol, date),
        )
        r = cur.fetchone()
        if r is None:
            continue
        vals = dict(zip(["pe", "pb", "roe", "roce", "debt_to_equity"], r))
        cur.execute("select market_cap from stocks where symbol=?", (symbol,))
        m = cur.fetchone()
        vals["market_cap"] = (m[0] if m else None) or None
        missing = [k for k in _DERIVED_KEYS if vals.get(k) is None]
        for k in missing:
            counts[k] += 1
        if missing:
            any_null += 1
            stmt_path = os.path.join(STATEMENTS_DIR, symbol + ".json")
            base = {}
            if os.path.exists(stmt_path):
                try:
                    with open(stmt_path, encoding="utf-8") as f:
                        base = (json.load(f) or {}).get("fields", {})
                except Exception:  # noqa: BLE001 — audit never crashes
                    base = {}
            reasons = _missing_reasons(base, base.get("price"), vals)
            base_missing = [k for k in BASE_KEYS if base.get(k) is None]
            rows.append((symbol, date, missing, base_missing, reasons))
    print("null counts over newest-ok-per-stock:", json.dumps(counts))
    print("symbols with >=1 null:", any_null)
    print(f"--- first {args.limit} symbols with nulls ---")
    for symbol, date, missing, base_missing, reasons in rows[: args.limit]:
        print(f"{symbol} {date} missing={missing} base_missing={base_missing}")
        for k in missing:
            if k in reasons:
                print(f"  {k}: {reasons[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
