"""Candle helpers for the stock detail chart: range slicing, interval aggregation
and an in-process TTL cache.

Pure functions — no DB, no network. Daily bars are NEVER persisted (Phase 1.6
storage policy): the provider is called through :class:`CandleCache`, which holds
the last 5y of daily rows per symbol in memory for a short TTL and dies with the
process. 15-day buckets are 15-calendar-day windows starting at the first row of
the sliced series; month buckets are calendar months.
"""

import time
from datetime import date, timedelta
from typing import Callable

#: Days kept before the newest bar per range key.
RANGES: dict[str, int] = {"6m": 182, "1y": 365, "2y": 730, "5y": 1825}

#: Valid chart intervals.
INTERVALS: tuple[str, ...] = ("1d", "15d", "1mo")

_BUCKET_DAYS = 15


def slice_range(rows: list[dict], range_key: str) -> list[dict]:
    """Keep bars with ``time >= last_bar_time - RANGES[range_key]`` (inclusive)."""
    if not rows:
        return []
    cutoff = date.fromisoformat(rows[-1]["time"]) - timedelta(days=RANGES[range_key])
    cutoff_iso = cutoff.isoformat()
    return [row for row in rows if row["time"] >= cutoff_iso]


def aggregate_candles(rows: list[dict], interval: str) -> list[dict]:
    """Fold ascending daily bars into ``1d`` / ``15d`` / ``1mo`` candles.

    Per bucket: ``time`` = first bar's date, ``open`` = first open, ``close`` =
    last close, ``high`` = max, ``low`` = min, ``volume`` = sum.
    """
    if interval == "1d":
        return list(rows)
    if interval not in INTERVALS:
        raise ValueError(f"Unknown interval {interval!r}")

    if interval == "15d":
        first_ordinal = date.fromisoformat(rows[0]["time"]).toordinal()

        def bucket_key(row: dict) -> int:
            return (date.fromisoformat(row["time"]).toordinal() - first_ordinal) // _BUCKET_DAYS

    else:  # "1mo"
        def bucket_key(row: dict) -> str:
            return row["time"][:7]

    buckets: list[dict] = []
    for row in rows:
        key = bucket_key(row)
        if buckets and buckets[-1]["_key"] == key:
            bucket = buckets[-1]
            bucket["close"] = row["close"]
            bucket["high"] = max(bucket["high"], row["high"])
            bucket["low"] = min(bucket["low"], row["low"])
            bucket["volume"] += row["volume"]
            continue
        buckets.append(
            {
                "_key": key,
                "time": row["time"],
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"],
            }
        )

    for bucket in buckets:
        del bucket["_key"]
    return buckets


class CandleCache:
    """Per-symbol in-memory cache for daily bars. Never touches the database.

    Empty results and loader failures are not cached, so a transient upstream
    failure retries on the next call.
    """

    def __init__(self, ttl_seconds: float = 900.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._entries: dict[str, tuple[float, list[dict]]] = {}

    def get_or_fetch(self, symbol: str, loader: Callable[[], list[dict]]) -> list[dict]:
        entry = self._entries.get(symbol)
        if entry is not None and self.clock() - entry[0] < self.ttl_seconds:
            return [dict(row) for row in entry[1]]
        rows = loader()
        if rows:
            self._entries[symbol] = (self.clock(), [dict(row) for row in rows])
        return rows

    def invalidate(self, symbol: str) -> None:
        self._entries.pop(symbol, None)


default_cache = CandleCache()
