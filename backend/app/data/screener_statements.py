"""Screener.in statements scraper with file cache.

Parses Profit & Loss / Balance Sheet / Cash Flow tables for the latest
annual column. Tolerant: missing tables yield None, never raise.
Units normalized to Rs cr (screener default). Shares derived from
equity-capital/face-value when present, else market-cap/price fallback.
"""

import json
import os
import re
import time
from datetime import date

import httpx
from bs4 import BeautifulSoup

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

#: Row-label synonyms (lowercased, stripped) -> base field.
_LABEL_MAP = {
    "sales": "revenue",
    "revenue": "revenue",
    "total revenue": "revenue",
    "income": "revenue",
    "net profit": "net_income",
    "net income": "net_income",
    "pat": "net_income",
    "profit after tax": "net_income",
    "ebit": "ebit",
    "operating profit": "ebit",
    "pbit": "ebit",
    "ebitda": "ebitda",
    "raw material cost": "cogs",
    "cost of materials": "cogs",
    "cogs": "cogs",
    "total equity": "equity",
    "net worth": "equity",
    "shareholder funds": "equity",
    "equity": "equity",
    "total assets": "total_assets",
    "current assets": "current_assets",
    "current liabilities": "current_liabilities",
    "inventory": "inventory",
    "stock": "inventory",
    "total debt": "total_debt",
    "borrowings": "total_debt",
    "debt": "total_debt",
    "cash": "cash",
    "cash equivalents": "cash",
    "bank balance": "cash",
    "operating cash flow": "operating_cashflow",
    "cash from operations": "operating_cashflow",
    "capex": "capex",
    "fixed assets purchased": "capex",
    "dividend paid": "dividends_paid",
    "equity capital": "_equity_capital",
    "face value": "_face_value",
}

STATEMENT_FIELDS: frozenset[str] = frozenset(
    {
        "revenue",
        "net_income",
        "ebit",
        "ebitda",
        "equity",
        "total_assets",
        "current_assets",
        "current_liabilities",
        "inventory",
        "total_debt",
        "cash",
        "shares_outstanding",
        "operating_cashflow",
        "capex",
        "dividends_paid",
        "revenue_prev",
        "earnings_prev",
        "cogs",
        "price",
    }
)


class ScreenerBlockedError(RuntimeError):
    """Screener.in refused the fetch (403/429). Caller serves cache."""


def _to_float(text: str | None) -> float | None:
    if text is None:
        return None
    cleaned = text.strip().replace(",", "").replace("₹", "")
    if cleaned in ("", "-", "—", "--", "NA", "N/A"):
        return None
    match = re.search(r"-?\d+(\.\d+)?", cleaned)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def parse_statements(html: str) -> dict:
    """Parse statements HTML to base fields (latest annual + prev for growth)."""
    soup = BeautifulSoup(html or "", "lxml")
    found: dict[str, list[float]] = {}
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            label = cells[0].strip().lower()
            field = _LABEL_MAP.get(label)
            if field is None:
                continue
            values = [_to_float(c) for c in cells[1:]]
            values = [v for v in values if v is not None]
            if values:
                found.setdefault(field, values)

    def latest(key: str) -> float | None:
        vals = found.get(key)
        return vals[0] if vals else None

    def prev(key: str) -> float | None:
        vals = found.get(key)
        return vals[1] if vals and len(vals) > 1 else None

    equity_capital = latest("_equity_capital")
    face_value = latest("_face_value")
    shares = None
    if equity_capital and face_value and face_value > 0:
        shares = equity_capital * 1e7 / face_value / 1e7  # cr shares

    price = None
    market_text = soup.get_text(" ", strip=True)
    price_match = re.search(r"Price\s+([\d,]+\.?\d*)", market_text)
    mcap_match = re.search(r"MarketCap\s+([\d,]+\.?\d*)", market_text)
    if price_match:
        price = _to_float(price_match.group(1))
    if shares is None and price_match and mcap_match:
        mcap = _to_float(mcap_match.group(1))
        if mcap and price and price > 0:
            shares = mcap / price

    return {
        "revenue": latest("revenue"),
        "net_income": latest("net_income"),
        "ebit": latest("ebit"),
        "ebitda": latest("ebitda"),
        "equity": latest("equity"),
        "total_assets": latest("total_assets"),
        "current_assets": latest("current_assets"),
        "current_liabilities": latest("current_liabilities"),
        "inventory": latest("inventory"),
        "total_debt": latest("total_debt"),
        "cash": latest("cash"),
        "shares_outstanding": shares,
        "operating_cashflow": latest("operating_cashflow"),
        "capex": latest("capex"),
        "dividends_paid": latest("dividends_paid"),
        "revenue_prev": prev("revenue"),
        "earnings_prev": prev("net_income"),
        "cogs": latest("cogs"),
        "price": price,
    }


def _cache_path(symbol: str, cache_dir: str) -> str:
    return os.path.join(cache_dir, f"{symbol.strip().upper()}.json")


def _download(symbol: str) -> str:
    url = f"https://www.screener.in/company/{symbol.strip().upper()}/"
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = httpx.get(url, headers=_UA, timeout=20, follow_redirects=True)
            if resp.status_code in (403, 429):
                raise ScreenerBlockedError(f"screener blocked {symbol}: {resp.status_code}")
            resp.raise_for_status()
            return resp.text
        except ScreenerBlockedError:
            raise
        except Exception as e:  # noqa: BLE001 — retry then propagate
            last_error = e
            time.sleep(1.0 * (attempt + 1))
    raise last_error  # type: ignore[misc]


def fetch_statements(
    symbol: str, cache_dir: str, ttl_days: int = 30, client=None
) -> dict:
    """Return base statement fields, serving file cache when fresh."""
    today = date.today().isoformat()
    path = _cache_path(symbol, cache_dir)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
            as_of = payload.get("as_of", "")
            age_days = (date.fromisoformat(today) - date.fromisoformat(as_of)).days
            if age_days <= int(ttl_days):
                return dict(payload.get("fields", {}))
        except Exception:  # noqa: BLE001 — corrupt cache refetches
            pass
    html = client(symbol) if callable(client) else _download(symbol)
    fields = parse_statements(html)
    os.makedirs(cache_dir, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"as_of": today, "fields": fields}, f)
    os.replace(tmp, path)
    return fields
