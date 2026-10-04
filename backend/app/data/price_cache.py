"""Per-symbol OHLC file cache: keeps 5y daily bars out of SQLite.

Layout: ``{cache_dir}/{SYMBOL}.csv`` with time/open/high/low/close/volume.
Atomic writes (tmp + rename). TTL decides hit vs refetch; corrupt files
read as misses so the loader refetches instead of crashing callers.
"""

import csv
import os
import time

_FIELDS = ("time", "open", "high", "low", "close", "volume")


def _path(symbol: str, cache_dir: str) -> str:
    return os.path.join(cache_dir, f"{symbol.strip().upper()}.csv")


def read_cached(symbol: str, cache_dir: str) -> list[dict] | None:
    """Read cached rows or None on miss/corrupt/empty."""
    path = _path(symbol, cache_dir)
    if not os.path.exists(path):
        return None
    try:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames is None or "time" not in reader.fieldnames:
                return None
            rows = []
            for record in reader:
                rows.append(
                    {
                        "time": record.get("time", ""),
                        "open": float(record.get("open")),
                        "high": float(record.get("high")),
                        "low": float(record.get("low")),
                        "close": float(record.get("close")),
                        "volume": float(record.get("volume") or 0.0),
                    }
                )
            if not rows:
                return None
            rows.sort(key=lambda r: r["time"])
            return rows
    except Exception:  # noqa: BLE001 — corrupt cache is a miss
        return None


def write_cached(symbol: str, rows: list[dict], cache_dir: str) -> None:
    """Atomically write rows; empty rows are a no-op."""
    if not rows:
        return
    os.makedirs(cache_dir, exist_ok=True)
    path = _path(symbol, cache_dir)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(_FIELDS))
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in _FIELDS})
    os.replace(tmp, path)


def get_or_fetch(
    symbol: str, loader, cache_dir: str, ttl_hours: int = 24
) -> list[dict]:
    """Serve file cache on hit, else load, persist, and return."""
    path = _path(symbol, cache_dir)
    if os.path.exists(path):
        age_hours = (time.time() - os.path.getmtime(path)) / 3600.0
        if age_hours <= float(ttl_hours):
            cached = read_cached(symbol, cache_dir)
            if cached:
                return cached
    rows = loader()
    if rows:
        write_cached(symbol, rows, cache_dir)
    return rows
