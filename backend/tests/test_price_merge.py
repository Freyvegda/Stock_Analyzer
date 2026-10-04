"""RED: file-cache merge for 1y-first + 5y silent expand."""

from app.data import price_cache


def _row(day, close):
    return {"time": day, "open": close - 0.5, "high": close + 0.5, "low": close - 1.0, "close": close, "volume": 10.0}


def test_merge_unions_by_time_and_sorts(tmp_path):
    cache_dir = str(tmp_path / "prices")
    price_cache.write_cached("AAA", [_row("2025-01-02", 10.0), _row("2025-01-03", 11.0)], cache_dir)
    merged = price_cache.merge_cached("AAA", [_row("2025-01-03", 12.0), _row("2024-01-05", 9.0)], cache_dir)
    assert [r["time"] for r in merged] == ["2024-01-05", "2025-01-02", "2025-01-03"]
    assert merged[-1]["close"] == 12.0
    assert price_cache.read_cached("AAA", cache_dir) == merged


def test_merge_empty_new_keeps_cache(tmp_path):
    cache_dir = str(tmp_path / "prices")
    price_cache.write_cached("AAA", [_row("2025-01-02", 10.0)], cache_dir)
    assert price_cache.merge_cached("AAA", [], cache_dir) == [_row("2025-01-02", 10.0)]
