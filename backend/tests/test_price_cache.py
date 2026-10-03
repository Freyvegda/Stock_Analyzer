"""Task 4 RED: per-symbol OHLC file cache."""

import app.data.price_cache as cache_mod
from app.data.price_cache import get_or_fetch, read_cached, write_cached


def rows():
    return [
        {"time": "2026-01-04", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10.0},
        {"time": "2026-01-05", "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0, "volume": 12.0},
    ]


def test_miss_calls_loader_and_writes(tmp_path):
    calls = []

    def loader():
        calls.append(1)
        return rows()

    out = get_or_fetch("AAA", loader, cache_dir=str(tmp_path), ttl_hours=24)
    assert out == rows()
    assert len(calls) == 1
    assert read_cached("AAA", str(tmp_path)) == rows()


def test_hit_skips_loader(tmp_path):
    write_cached("AAA", rows(), str(tmp_path))

    def boom():
        raise AssertionError("loader must not run on hit")

    out = get_or_fetch("AAA", boom, cache_dir=str(tmp_path), ttl_hours=24)
    assert out == rows()


def test_corrupt_file_refetches(tmp_path):
    path = tmp_path / "AAA.csv"
    path.write_text("not,a,csv\n{{{\n", encoding="utf-8")
    out = get_or_fetch("AAA", rows, cache_dir=str(tmp_path), ttl_hours=24)
    assert out == rows()


def test_write_is_atomic_and_readable(tmp_path):
    write_cached("AAA", rows(), str(tmp_path))
    leftovers = [p.name for p in tmp_path.iterdir()]
    assert "AAA.csv" in leftovers
    assert not any(name.endswith(".tmp") for name in leftovers)
