from datetime import date, timedelta

import pytest

from app.stock.candles import CandleCache, RANGES, aggregate_candles, slice_range


def rows_from(dates: list[str], close: float = 10.0) -> list[dict]:
    """One candle per date: open=close-0.5, high=close+1, low=close-1, volume 100."""
    return [
        {
            "time": d,
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 100.0,
        }
        for d in dates
    ]


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_slice_range_keeps_cutoff_and_drops_older():
    end = date(2026, 9, 25)
    dates = [(end - timedelta(days=offset)).isoformat() for offset in range(500, -1, -1)]
    rows = rows_from(dates)

    sliced = slice_range(rows, "6m")

    cutoff = (end - timedelta(days=182)).isoformat()
    assert RANGES["6m"] == 182
    assert sliced[0]["time"] == cutoff
    assert sliced[-1]["time"] == end.isoformat()
    assert len(sliced) == 183


def test_slice_range_empty_input_is_empty():
    assert slice_range([], "1y") == []


def test_aggregate_daily_is_identity():
    rows = rows_from(["2026-01-01", "2026-01-02"])
    assert aggregate_candles(rows, "1d") == rows


def test_aggregate_15d_buckets_by_fixed_window():
    rows = rows_from(["2026-01-01", "2026-01-02", "2026-01-16", "2026-01-17"])
    rows[0]["open"] = 9.0
    rows[0]["high"] = 15.0
    rows[1]["close"] = 12.5
    rows[3]["low"] = 3.0
    rows[2]["volume"] = 40.0

    buckets = aggregate_candles(rows, "15d")

    assert [b["time"] for b in buckets] == ["2026-01-01", "2026-01-16"]
    assert buckets[0] == {
        "time": "2026-01-01",
        "open": 9.0,
        "high": 15.0,
        "low": 9.0,
        "close": 12.5,
        "volume": 200.0,
    }
    assert buckets[1] == {
        "time": "2026-01-16",
        "open": 9.5,
        "high": 11.0,
        "low": 3.0,
        "close": 10.0,
        "volume": 140.0,
    }


def test_aggregate_monthly_buckets_by_calendar_month():
    buckets = aggregate_candles(rows_from(["2026-01-05", "2026-01-20", "2026-02-02"]), "1mo")

    assert [b["time"] for b in buckets] == ["2026-01-05", "2026-02-02"]
    assert [b["volume"] for b in buckets] == [200.0, 100.0]


def test_15d_buckets_are_stable_across_ranges():
    start = date(2026, 1, 1)
    rows = rows_from([(start + timedelta(days=offset)).isoformat() for offset in range(400)])

    full = aggregate_candles(slice_range(rows, "5y"), "15d")
    yearly = aggregate_candles(slice_range(rows, "1y"), "15d")

    # Absolute 15-calendar-day windows: the newest bucket is the same regardless
    # of which range was requested (a relative anchor would shift it).
    assert full[-1] == yearly[-1]


def test_aggregate_preserves_extremes_and_order():
    start = date(2026, 1, 1)
    rows = rows_from([(start + timedelta(days=offset)).isoformat() for offset in range(60)])
    rows[10]["low"] = -3.0
    rows[30]["high"] = 99.0

    buckets = aggregate_candles(rows, "15d")

    assert [b["time"] for b in buckets] == sorted(b["time"] for b in buckets)
    assert max(b["high"] for b in buckets) == 99.0
    assert min(b["low"] for b in buckets) == -3.0
    assert sum(b["volume"] for b in buckets) == 6000.0


def test_cache_serves_within_ttl_and_refetches_after():
    clock = FakeClock()
    cache = CandleCache(ttl_seconds=900.0, clock=clock)
    calls: list[int] = []

    def loader() -> list[dict]:
        calls.append(1)
        return rows_from(["2026-01-01"])

    first = cache.get_or_fetch("AAA", loader)
    clock.now = 899.0
    cache.get_or_fetch("AAA", loader)

    assert len(calls) == 1
    assert first == rows_from(["2026-01-01"])

    clock.now = 901.0
    cache.get_or_fetch("AAA", loader)
    assert len(calls) == 2


def test_cache_is_per_symbol_and_invalidate_forces_refetch():
    cache = CandleCache()
    calls: dict[str, int] = {"AAA": 0, "BBB": 0}

    def make(symbol: str):
        def loader() -> list[dict]:
            calls[symbol] += 1
            return rows_from(["2026-01-01"])

        return loader

    cache.get_or_fetch("AAA", make("AAA"))
    cache.get_or_fetch("BBB", make("BBB"))
    assert calls == {"AAA": 1, "BBB": 1}

    cache.invalidate("AAA")
    cache.get_or_fetch("AAA", make("AAA"))
    cache.get_or_fetch("BBB", make("BBB"))
    assert calls == {"AAA": 2, "BBB": 1}


def test_cache_does_not_cache_failures():
    attempts: list[int] = []

    def loader() -> list[dict]:
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("yfinance down")
        return rows_from(["2026-01-01"])

    cache = CandleCache()

    with pytest.raises(RuntimeError):
        cache.get_or_fetch("AAA", loader)

    assert cache.get_or_fetch("AAA", loader)[0]["time"] == "2026-01-01"
    assert len(attempts) == 2


def test_cache_does_not_cache_empty_results():
    calls: list[int] = []

    def loader() -> list[dict]:
        calls.append(1)
        return []

    cache = CandleCache()
    cache.get_or_fetch("AAA", loader)
    cache.get_or_fetch("AAA", loader)

    assert len(calls) == 2
