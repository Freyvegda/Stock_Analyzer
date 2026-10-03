"""Task 2 RED: Stooq daily CSV provider."""

import app.data.stooq_impl as stooq_mod
from app.data.stooq_impl import StooqProvider, parse_stooq_csv, stooq_symbol


def test_symbol_mapping():
    assert stooq_symbol("RELIANCE") == "RELIANCE.NS"
    assert stooq_symbol("RELIANCE.NS") == "RELIANCE.NS"


def test_parse_drops_nan_and_sorts():
    text = (
        "Date,Open,High,Low,Close,Volume\n"
        "2026-01-05,2500,2520,2490,2510,1000\n"
        "2026-01-03,2480,2490,2470,,900\n"
        "2026-01-04,2485,2505,2480,2495,1100\n"
    )
    rows = parse_stooq_csv(text)
    assert [r["time"] for r in rows] == ["2026-01-04", "2026-01-05"]
    assert rows[0]["close"] == 2495.0


def test_empty_csv_gives_empty():
    assert parse_stooq_csv("Date,Open,High,Low,Close,Volume\n") == []


def test_ohlc_builds_url_and_parses(monkeypatch):
    seen = {}

    class FakeResp:
        text = "Date,Open,High,Low,Close,Volume\n2026-01-05,10,11,9,10.5,100\n"

        def raise_for_status(self):
            pass

    def fake_get(url, **kwargs):
        seen["url"] = url
        return FakeResp()

    monkeypatch.setattr(stooq_mod.httpx, "get", fake_get)
    rows = StooqProvider().ohlc("RELIANCE")
    assert "stooq.com" in seen["url"] and "reliance.ns" in seen["url"].lower()
    assert rows[0]["close"] == 10.5


def test_ohlc_http_error_propagates(monkeypatch):
    def boom(url, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(stooq_mod.httpx, "get", boom)
    try:
        StooqProvider().ohlc("AAA")
    except RuntimeError:
        return
    raise AssertionError("should propagate")
