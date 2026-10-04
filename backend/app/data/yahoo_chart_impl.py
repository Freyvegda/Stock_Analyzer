"""Yahoo chart JSON secondary OHLC with polite rate-limit loop.

Direct ``query1/query2.finance.yahoo.com/v8/finance/chart`` JSON — lighter
than the yfinance lib path. Polite by design: per-host minimum gap,
query1 -> query2 rotation, backoff on 429, short circuit-break so rapid
chart views never hammer Yahoo.
"""

import math
import random
import threading
import time
from datetime import datetime, timezone

import httpx

from app.data.provider import DataProvider

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
_TIMEOUT = 8
_MIN_GAP = 1.0
_BLOCK_SECONDS = 60.0

_lock = threading.Lock()
_last_hit: dict[str, float] = {}
_blocked_until: dict[str, float] = {}


def _is_rate_limit(exc: Exception | None, status: int | None = None) -> bool:
    if status == 429:
        return True
    if exc is None:
        return False
    text = f"{type(exc).__name__} {exc}".lower()
    return any(t in text for t in ("429", "rate limit", "ratelimit", "too many", "throttl"))


def _wait_for_slot(host: str) -> None:
    with _lock:
        until = _blocked_until.get(host, 0.0)
        last = _last_hit.get(host, 0.0)
    now = time.monotonic()
    if until > now:
        raise RuntimeError(f"yahoo rate-limited: {host} cooling down")
    gap = _MIN_GAP - (now - last)
    if gap > 0:
        time.sleep(gap)
    with _lock:
        _last_hit[host] = time.monotonic()


def _note_rate_limited(host: str) -> None:
    with _lock:
        _blocked_until[host] = time.monotonic() + _BLOCK_SECONDS


def _num(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) else result


def parse_yahoo_chart(payload: dict) -> list[dict]:
    """Map chart JSON to ascending clean daily rows; [] on empty/garbage."""
    try:
        results = (payload or {}).get("chart", {}).get("result") or []
        result = results[0] if results else None
        stamps = (result or {}).get("timestamp") or []
        quotes = ((result or {}).get("indicators") or {}).get("quote") or [{}]
        quote = quotes[0] if quotes else {}
    except (AttributeError, IndexError, TypeError):
        return []
    rows: list[dict] = []
    for idx, stamp in enumerate(stamps):
        try:
            day = datetime.fromtimestamp(float(stamp), tz=timezone.utc).date().isoformat()
        except (TypeError, ValueError, OverflowError, OSError):
            continue

        def at(key: str):
            values = quote.get(key) or []
            return _num(values[idx]) if idx < len(values) else None

        close = at("close")
        open_ = at("open")
        high = at("high")
        low = at("low")
        if close is None or open_ is None or high is None or low is None:
            continue
        volume = at("volume")
        rows.append(
            {
                "time": day,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume if volume is not None else 0.0,
            }
        )
    rows.sort(key=lambda r: r["time"])
    return rows


class YahooChartProvider(DataProvider):
    def list_stocks(self) -> list[dict]:
        raise NotImplementedError

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        raise NotImplementedError

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """Daily bars via chart JSON; rotates hosts, backs off on 429."""
        base = (symbol or "").strip().upper()
        if not base.endswith((".NS", ".BO")):
            base = f"{base}.NS"
        span = f"{max(1, int(years))}y"
        last_error: Exception | None = None
        for round_no in range(3):
            for host in _HOSTS:
                url = f"https://{host}/v8/finance/chart/{base}?range={span}&interval=1d"
                try:
                    _wait_for_slot(host)
                except RuntimeError as e:
                    last_error = e
                    continue
                try:
                    resp = httpx.get(url, headers=_UA, timeout=_TIMEOUT, follow_redirects=True)
                    resp.raise_for_status()
                    rows = parse_yahoo_chart(resp.json())
                    if rows:
                        return rows
                except Exception as e:  # noqa: BLE001 — rotate / backoff
                    status = getattr(getattr(e, "response", None), "status_code", None)
                    if status is None and "429" in str(e):
                        status = 429
                    if _is_rate_limit(e, status):
                        _note_rate_limited(host)
                    last_error = e
                    continue
            time.sleep(0.5 * (2**round_no) + random.uniform(0, 0.3))
        if last_error is not None:
            raise last_error
        return []

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")
