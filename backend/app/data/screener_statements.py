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
    "pbit": "ebit",
    "ebitda": "ebitda",
    "operating profit": "ebitda",
    "financing profit": "ebitda",
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
    "borrowing": "total_debt",
    "debt": "total_debt",
    "cash": "cash",
    "cash equivalents": "cash",
    "bank balance": "cash",
    "operating cash flow": "operating_cashflow",
    "cash from operations": "operating_cashflow",
    "cash from operating activity": "operating_cashflow",
    "capex": "capex",
    "fixed assets purchased": "capex",
    "dividend paid": "dividends_paid",
    "dividend payout %": "_payout_pct",
    "equity capital": "_equity_capital",
    "face value": "_face_value",
    "reserves": "_reserves",
    "other income": "_other_income",
    "depreciation": "_depreciation",
    "promoters": "_promoters",
    "fiis": "_fiis",
    "diis": "_diis",
}


def _normalize_label(label: str) -> str:
    """Screener parent rows carry a trailing '+' (expandable); strip it."""
    return (label or "").strip().lower().rstrip("+").strip()

_ANNUAL_RE = re.compile(r"(mar|fy)?\s*20\d\d", re.IGNORECASE)
_YEAR_RE = re.compile(r"20\d\d")
_QUARTER_RE = re.compile(r"(jun|sep|dec)\s*20\d\d", re.IGNORECASE)


def _month_of(cell: str | None) -> str | None:
    """jun|sep|dec|mar|fy when the header cell names one, else None."""
    text = (cell or "").lower()
    for month in ("mar", "jun", "sep", "dec"):
        if month in text:
            return month
    if re.search(r"\bfy\b", text):
        return "fy"
    return None

#: Partial-period markers (never annual); quarter months are handled by the
#: fiscal-year rule in _annual_indexes, not here.
_PARTIAL_RE = re.compile(r"ttm|q[1-4]|quarter|half|trailing|\d+\s*m\b", re.IGNORECASE)
_NON_ANNUAL_RE = re.compile(r"ttm|q[1-4]|quarter|half|sep|dec|jun|trailing|\d+\s*m\b", re.IGNORECASE)

#: Holdings labels stay readable on quarterly shareholding tables.
_HOLDING_FIELDS = frozenset({"_promoters", "_fiis", "_diis"})

#: Money fields (Rs cr base) vs per-share/price fields (never unit-scaled).
_MONEY_FIELDS = frozenset(
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
        "operating_cashflow",
        "capex",
        "dividends_paid",
        "cogs",
        "revenue_prev",
        "earnings_prev",
    }
)

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


class SymbolNotFoundError(RuntimeError):
    """Screener.in has no page for the symbol (404 on every variant).

    Terminal — retrying a certain 404 with backoff wastes ~50s per dead
    symbol per job. Callers may serve a stale cache, then fail the symbol.
    """


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


def _annual_indexes(header: list[str]) -> list[int]:
    """Data-column indexes holding annual figures (skips TTM/quarterly).

    Mar/FY columns win when present. Otherwise the dominant dated month with
    2+ columns wins (Sep/Dec/Jun fiscal year-ends, tolerating one quarterly
    stub like a Jun balance-sheet column). Falls back to every data column
    when no header cell names a year.
    """
    annual = [
        idx
        for idx, cell in enumerate(header[1:], start=1)
        if _ANNUAL_RE.search(cell or "") and not _NON_ANNUAL_RE.search(cell or "")
    ]
    if annual:
        if len(annual) >= 2:
            return annual
        # One lone Mar column beside a dominant Sep/Dec/Jun annual set is a
        # stub (live Siemens balance sheet: Sep annuals + Mar 2026) — fall
        # through to the dominant-month rule instead of pinning the stub.
        dated_months: dict[str, int] = {}
        for cell in header[1:]:
            if _YEAR_RE.search(cell or "") and not _PARTIAL_RE.search(cell or ""):
                month = _month_of(cell)
                if month in ("jun", "sep", "dec"):
                    dated_months[month] = dated_months.get(month, 0) + 1
        if not any(count >= 2 for count in dated_months.values()):
            return annual
    dated = [
        (idx, cell)
        for idx, cell in enumerate(header[1:], start=1)
        if _YEAR_RE.search(cell or "") and not _PARTIAL_RE.search(cell or "")
    ]
    counts: dict[str, int] = {}
    for _, cell in dated:
        month = _month_of(cell)
        if month is not None:
            counts[month] = counts.get(month, 0) + 1
    if counts:
        if len(counts) == 1:
            # One month only: a fiscal year-end table (even a single annual
            # for a new listing) — quarterly tables always mix months.
            only = next(iter(counts))
            return [idx for idx, cell in dated if _month_of(cell) == only]
        top = max(counts, key=lambda m: counts[m])
        if counts[top] >= 2:
            return [idx for idx, cell in dated if _month_of(cell) == top]
    if any(_NON_ANNUAL_RE.search(cell or "") for cell in header[1:]):
        return [
            idx
            for idx, cell in enumerate(header[1:], start=1)
            if not _NON_ANNUAL_RE.search(cell or "")
        ]
    return list(range(1, len(header)))


def _lakh_scale(soup: BeautifulSoup) -> float:
    """1.0 for Rs-cr pages, 0.01 when the page states figures in lakh."""
    text = soup.get_text(" ", strip=True)
    if re.search(r"in\s*(rs\.?\s*)?(lakh|lac)", text, re.IGNORECASE):
        return 0.01
    return 1.0


def _parse_price_mcap(text: str) -> tuple[float | None, float | None]:
    """Tolerant price + market-cap (cr) extraction from page text."""
    price = None
    for pattern in (
        r"Current Price\s*₹?\s*([\d,]+\.?\d*)",
        r"Price\s*₹?\s*([\d,]+\.?\d*)",
        r"₹\s*([\d,]+\.?\d*)",
    ):
        match = re.search(pattern, text)
        if match:
            price = _to_float(match.group(1))
            if price is not None:
                break
    mcap = None
    mcap_match = re.search(
        r"(?:Mkt Cap|Market Cap)[^\d₹]*₹?\s*([\d,]+\.?\d*)\s*(Cr|Lac|Lakh)?",
        text,
        re.IGNORECASE,
    )
    if mcap_match:
        mcap = _to_float(mcap_match.group(1))
        unit = (mcap_match.group(2) or "").lower()
        if mcap is not None and unit in ("lac", "lakh"):
            mcap = mcap * 0.01
    return price, mcap


def _has_minimum(fields: dict) -> bool:
    """A parse counts as statements only with core P&L + balance identity."""
    return fields.get("revenue") is not None and fields.get("equity") is not None


def parse_statements(html: str) -> dict:
    """Parse statements HTML to base fields (latest annual + prev for growth)."""
    soup = BeautifulSoup(html or "", "lxml")
    scale = _lakh_scale(soup)
    found: dict[str, list[float]] = {}
    for table in soup.find_all("table"):
        table_rows = table.find_all("tr")
        if not table_rows:
            continue
        header = [c.get_text(" ", strip=True) for c in table_rows[0].find_all(["td", "th"])]
        quarterly = any(_QUARTER_RE.search(cell or "") for cell in header[1:])
        indexes = _annual_indexes(header) if len(header) > 1 else [1]
        # Quarterly results tables interleave Jun/Sep/Dec with Mar-quarterly
        # columns of the SAME years (live AXISBANK). Year-end-transition tables
        # (Dec 2019-21 then Mar 2023-26, disjoint years) keep their annuals, as
        # do legacy mixed tables (one Jun + 9m/TTM + Mar annuals), stubbed
        # balance sheets (Dec annuals + Jun stub) and single-month fiscal
        # tables. Skip only mixed-month tables whose years overlap across
        # months (or that yield a single column) — per-column filtering already
        # drops Jun/Sep/Dec/TTM/9m from Mar-annual tables.
        dated_cells = [
            cell for cell in header[1:]
            if _YEAR_RE.search(cell or "") and not _PARTIAL_RE.search(cell or "")
        ]
        monthset = {_month_of(cell) for cell in dated_cells} - {None, "fy"}
        mixed = len(monthset) > 1
        years: dict[str, set[str]] = {}
        for cell in dated_cells:
            month = _month_of(cell)
            year = _YEAR_RE.search(cell or "")
            if month is not None and year:
                years.setdefault(year.group(0), set()).add(month)
        overlap = any(len(months) > 1 for months in years.values())
        quarterly_results = bool(quarterly and mixed and (overlap or len(indexes) <= 1))
        for row in table_rows[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            field = _LABEL_MAP.get(_normalize_label(cells[0]))
            if field is None:
                continue
            if quarterly_results and field not in _HOLDING_FIELDS:
                continue  # quarterly results table: no annual statements here
            values = [_to_float(cells[i]) if i < len(cells) else None for i in indexes]
            values = [v for v in values if v is not None]
            if values:
                found.setdefault(field, values)

    def latest(key: str) -> float | None:
        # Columns run oldest-first; the latest annual is last.
        vals = found.get(key)
        return vals[-1] if vals else None

    def prev(key: str) -> float | None:
        vals = found.get(key)
        return vals[-2] if vals and len(vals) > 1 else None

    equity_capital = latest("_equity_capital")
    face_value = latest("_face_value")
    reserves = latest("_reserves")
    shares = None
    if equity_capital and face_value and face_value > 0:
        shares = equity_capital * scale * 1e7 / face_value / 1e7  # cr shares

    price, mcap = _parse_price_mcap(soup.get_text(" ", strip=True))
    if shares is None and mcap is not None and price:
        if price > 0:
            shares = mcap / price

    def money(key: str) -> float | None:
        value = latest(key)
        return None if value is None else value * scale

    equity = money("equity")
    if equity is None and (equity_capital is not None or reserves is not None):
        parts = [v for v in (equity_capital, reserves) if v is not None]
        equity = sum(parts) * scale if len(parts) == 2 else None

    ebitda = money("ebitda")
    ebit = money("ebit")
    if ebit is None:
        operating = money("ebitda")
        other = money("_other_income")
        depreciation = money("_depreciation")
        if operating is not None and other is not None and depreciation is not None:
            ebit = operating + other - depreciation

    dividends = money("dividends_paid")
    if dividends is None:
        payout = latest("_payout_pct")
        net_income = money("net_income")
        if payout is not None and net_income is not None:
            dividends = payout / 100 * net_income

    def holding(key: str) -> float | None:
        # Screener shows percents; raw holds fractions (engine ×100).
        value = latest(key)
        return None if value is None else value / 100

    promoters = holding("_promoters")
    institutions = None
    fiis, diis = holding("_fiis"), holding("_diis")
    if fiis is not None or diis is not None:
        institutions = (fiis or 0.0) + (diis or 0.0)

    return {
        "revenue": money("revenue"),
        "net_income": money("net_income"),
        "ebit": ebit,
        "ebitda": ebitda,
        "equity": equity,
        "total_assets": money("total_assets"),
        "current_assets": money("current_assets"),
        "current_liabilities": money("current_liabilities"),
        "inventory": money("inventory"),
        "total_debt": money("total_debt"),
        "cash": money("cash"),
        "shares_outstanding": shares,
        "operating_cashflow": money("operating_cashflow"),
        "capex": money("capex"),
        "dividends_paid": dividends,
        "revenue_prev": (lambda v: None if v is None else v * scale)(prev("revenue")),
        "earnings_prev": (lambda v: None if v is None else v * scale)(prev("net_income")),
        "cogs": money("cogs"),
        "price": price,
        "promoters_pct": promoters,
        "institutions_pct": institutions,
    }


def _cache_path(symbol: str, cache_dir: str) -> str:
    return os.path.join(cache_dir, f"{symbol.strip().upper()}.json")


#: Pause after every statements download — bursts earn 429s.
POLITE_DELAY_SECONDS = 2.0

#: 429 backoff default when the response names no Retry-After.
BLOCKED_BACKOFF_SECONDS = 60.0


def _retry_after(resp) -> float:
    try:
        return max(0.0, float(resp.headers.get("Retry-After", BLOCKED_BACKOFF_SECONDS)))
    except (TypeError, ValueError):
        return BLOCKED_BACKOFF_SECONDS


def _download(symbol: str) -> str:
    """Company page HTML, consolidated first (falls back on 404 or shell).

    Screener renders standalone figures on the main page; Nifty 500
    screening wants consolidated. Standalone-only companies 404 on the
    consolidated path — or return 200 with empty tables — and fall back to
    the main page. 429s back off per Retry-After instead of failing fast;
    every success pauses politely.
    """
    symbol = symbol.strip().upper()
    urls = [
        f"https://www.screener.in/company/{symbol}/consolidated/",
        f"https://www.screener.in/company/{symbol}/",
    ]
    last_error: Exception | None = None
    for url_index, url in enumerate(urls):
        for attempt in range(4):
            try:
                resp = httpx.get(url, headers=_UA, timeout=20, follow_redirects=True)
                if resp.status_code == 404:
                    if url_index == 0:
                        break  # standalone-only company: fall back to main page
                    raise SymbolNotFoundError(f"screener has no page for {symbol}: 404")
                if resp.status_code == 429:
                    last_error = ScreenerBlockedError(f"screener limited {symbol}: 429")
                    time.sleep(_retry_after(resp))
                    continue
                if resp.status_code == 403:
                    raise ScreenerBlockedError(f"screener blocked {symbol}: 403")
                resp.raise_for_status()
                if url_index == 0:
                    try:
                        if not _has_minimum(parse_statements(resp.text)):
                            break  # 200 shell page: fall back to main page
                    except Exception:  # noqa: BLE001 — unparsable means fall back
                        break
                time.sleep(POLITE_DELAY_SECONDS)
                return resp.text
            except (ScreenerBlockedError, SymbolNotFoundError):
                raise
            except Exception as e:  # noqa: BLE001 — retry then propagate
                last_error = e
                time.sleep(5.0 * (attempt + 1))
    raise last_error  # type: ignore[misc]


def _read_cache(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001 — corrupt cache refetches
        return None


def fetch_statements(
    symbol: str, cache_dir: str, ttl_days: int = 30, client=None
) -> dict:
    """Return base statement fields, serving file cache when fresh.

    A block (403/429) or a block page (parse without core fields) serves
    the stale cache at any age; only a first-ever fetch with no cache
    raises. Good cache is never overwritten by an empty parse.
    """
    today = date.today().isoformat()
    path = _cache_path(symbol, cache_dir)
    if os.path.exists(path):
        payload = _read_cache(path)
        if payload:
            try:
                as_of = payload.get("as_of", "")
                age_days = (date.fromisoformat(today) - date.fromisoformat(as_of)).days
                if age_days <= int(ttl_days):
                    return dict(payload.get("fields", {}))
            except (TypeError, ValueError):
                pass
    try:
        html = client(symbol) if callable(client) else _download(symbol)
    except (ScreenerBlockedError, SymbolNotFoundError):
        stale = _read_cache(path) if os.path.exists(path) else None
        if stale and stale.get("fields"):
            return dict(stale["fields"])
        raise
    fields = parse_statements(html)
    if not _has_minimum(fields):
        stale = _read_cache(path) if os.path.exists(path) else None
        if stale and stale.get("fields"):
            return dict(stale["fields"])
        raise ScreenerBlockedError(f"screener parse yielded no statements for {symbol}")
    # Merge stale base into fresh Nones so one partial page never nulls a known
    # input for the ratio calculator (fresh wins whenever present).
    try:
        stale = _read_cache(path) if os.path.exists(path) else None
        old = stale.get("fields") if stale and isinstance(stale.get("fields"), dict) else {}
        if old:
            for key, value in fields.items():
                if value is None and old.get(key) is not None:
                    fields[key] = old[key]
    except Exception:  # noqa: BLE001 — merge is best-effort, never blocks write
        pass
    os.makedirs(cache_dir, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"as_of": today, "fields": fields}, f)
    os.replace(tmp, path)
    return fields
