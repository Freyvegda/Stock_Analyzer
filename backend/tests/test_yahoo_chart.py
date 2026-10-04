"""RED: Yahoo chart JSON secondary OHLC with rate-limit loop."""

import app.data.yahoo_chart_impl as yahoo_mod
from app.data.yahoo_chart_impl import YahooChartProvider, parse_yahoo_chart


def test_parse_maps_timestamps_to_daily_rows():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1704067200, 1704153600],
                    "indicators": {
                        "quote": [
                            {
                                "open": [100.0, 101.0],
                                "high": [102.0, 103.0],
                                "low": [99.0, 100.0],
                                "close": [101.0, None],
                                "volume": [1000, 1100],
                            }
                        ]
                    },
                }
            ]
        }
    }
    rows = parse_yahoo_chart(payload)
    assert [r["time"] for r in rows] == ["2024-01-01"]
    assert rows[0]["close"] == 101.0


def test_parse_empty_returns_empty():
    assert parse_yahoo_chart({}) == []
    assert parse_yahoo_chart({"chart": {"result": None}}) == []


def test_ohlc_rotates_hosts_on_429_then_succeeds(monkeypatch):
    calls = []

    class R429:
        status_code = 429
        text = "too many"

        def raise_for_status(self):
            raise RuntimeError("429 Too Many Requests")

    class GoodResp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {
                "chart": {
                    "result": [
                        {
                            "timestamp": [1704067200],
                            "indicators": {
                                "quote": [
                                    {
                                        "open": [10.0],
                                        "high": [11.0],
                                        "low": [9.0],
                                        "close": [10.5],
                                        "volume": [100],
                                    }
                                ]
                            },
                        }
                    ]
                }
            }

    def fake_get(url, **kwargs):
        calls.append(url)
        return R429() if len(calls) == 1 else GoodResp()

    monkeypatch.setattr(yahoo_mod.httpx, "get", fake_get)
    monkeypatch.setattr(yahoo_mod.time, "sleep", lambda s: None)
    rows = YahooChartProvider().ohlc("RELIANCE", years=1)
    assert rows and rows[0]["close"] == 10.5
    assert "query1" in calls[0] and "query2" in calls[1]


def test_ohlc_raises_rate_limit_after_retries(monkeypatch):
    class R429:
        status_code = 429

        def raise_for_status(self):
            raise RuntimeError("429 Too Many Requests")

    monkeypatch.setattr(yahoo_mod.httpx, "get", lambda url, **k: R429())
    monkeypatch.setattr(yahoo_mod.time, "sleep", lambda s: None)
    try:
        YahooChartProvider().ohlc("AAA", years=1)
    except RuntimeError as e:
        assert "429" in str(e) or "rate" in str(e).lower()
        return
    raise AssertionError("should raise rate-limit error")
