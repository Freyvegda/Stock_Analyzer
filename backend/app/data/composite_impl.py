"""Composite provider: Stooq + screener + math, yFinance + calculator null fill.

Chain per method:
- ``list_stocks``: Nifty CSV logic (delegated, httpx only — not the
  rate-limited yFinance API), cache + stale flag preserved.
- ``fundamentals``: screener statements (fresh merged over stale cache) +
  Stooq quote price + pure math, then per-field yFinance fill for null derived
  ratios only (missing slots filled, good math never overwritten), then the
  ratio-calculator fallback: yfinance statement numbers recomputed through
  math when ``.info`` is rate-limited, plus algebraic derivation
  (pe/pb/roe/market_cap from each other). yfinance failures keep math result.
- ``ohlc``: per-symbol file cache over Stooq full history; stale cache
  served when Stooq fails.
yFinance hot path stays off by default (``ENABLE_YFINANCE=1`` opts the legacy
full-row + ohlc tails back in); every fill stage runs in try/except with
per-stock isolation.
"""

import csv
import io
import logging
import os
import time

import httpx

from app.data import price_cache
from app.data.company_search import (
    fetch_search_identity,
    fetch_wikipedia_summary,
    fetch_yfinance_identity,
)
from app.data.provider import DataProvider
from app.data.ratios_math import compute_ratios, derive_missing
from app.data.screener_statements import fetch_statements
from app.data.stooq_impl import StooqProvider, stooq_candidates
from app.data.yfinance_impl import (
    YFinanceProvider,
    is_rate_limit_error,
    yfinance_statements_base,
)

logger = logging.getLogger(__name__)

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEFAULT_PRICE_DIR = os.path.join(_REPO_ROOT, "data", "prices")
DEFAULT_STATEMENTS_DIR = os.path.join(_REPO_ROOT, "data", "statements")

#: Screen-critical derived ratios. Per-field yfinance fill only touches these
#: when they are None — never overwrites good math values.
_DERIVED_KEYS: tuple[str, ...] = ("pe", "pb", "roe", "roce", "debt_to_equity", "market_cap")


def _missing_reasons(statements: dict, price: float | None, computed: dict) -> dict:
    """Debug why each derived ratio is None (base inputs, not just the None)."""
    reasons: dict[str, str] = {}
    try:
        if computed.get("pe") is None:
            reasons["pe"] = (
                f"price={price} shares={statements.get('shares_outstanding')} "
                f"net_income={statements.get('net_income')}"
            )
        if computed.get("pb") is None:
            reasons["pb"] = (
                f"price={price} shares={statements.get('shares_outstanding')} "
                f"equity={statements.get('equity')}"
            )
        if computed.get("roe") is None:
            reasons["roe"] = (
                f"net_income={statements.get('net_income')} equity={statements.get('equity')}"
            )
        if computed.get("roce") is None:
            reasons["roce"] = (
                f"ebit={statements.get('ebit')} assets={statements.get('total_assets')} "
                f"curr_liab={statements.get('current_liabilities')} "
                f"equity={statements.get('equity')} debt={statements.get('total_debt')}"
            )
        if computed.get("debt_to_equity") is None:
            reasons["debt_to_equity"] = (
                f"debt={statements.get('total_debt')} equity={statements.get('equity')}"
            )
        if computed.get("market_cap") is None:
            reasons["market_cap"] = (
                f"price={price} shares={statements.get('shares_outstanding')}"
            )
    except Exception:  # noqa: BLE001 — debug must never break the fetch
        pass
    return reasons


def _fetch_quote(symbol: str) -> float | None:
    """Single-quote close from Stooq; tries `.IN` then `.NS`; None on failure."""
    for candidate in stooq_candidates(symbol):
        url = f"https://stooq.com/q/l/?s={candidate.lower()}&f=sd2t2ohlcv&h&e=csv"
        for attempt in range(2):
            try:
                resp = httpx.get(url, headers=_UA, timeout=15, follow_redirects=True)
                resp.raise_for_status()
                reader = csv.DictReader(io.StringIO(resp.text or ""))
                for record in reader:
                    try:
                        return float(record.get("Close"))
                    except (TypeError, ValueError):
                        continue
                break  # valid-but-empty for this suffix: try next
            except Exception:  # noqa: BLE001 — quote is best-effort
                time.sleep(0.5 * (attempt + 1))
    return None


def _fresh_cached_close(symbol: str, price_dir: str, ttl_hours: int) -> float | None:
    """Yesterday's close from the file cache when fresh, else None."""
    import time as _time

    path = os.path.join(price_dir, f"{symbol.strip().upper()}.csv")
    if not os.path.exists(path):
        return None
    try:
        age_hours = (_time.time() - os.path.getmtime(path)) / 3600.0
    except OSError:
        return None
    if age_hours > float(ttl_hours):
        return None
    cached = price_cache.read_cached(symbol, price_dir)
    if not cached:
        return None
    try:
        return float(cached[-1].get("close"))
    except (TypeError, ValueError):
        return None


class CompositeProvider(DataProvider):
    def __init__(
        self,
        price_dir: str = DEFAULT_PRICE_DIR,
        statements_dir: str = DEFAULT_STATEMENTS_DIR,
        enable_yfinance: bool = False,
        statements_ttl_days: int = 30,
        price_ttl_hours: int = 24,
    ) -> None:
        self.price_dir = price_dir
        self.statements_dir = statements_dir
        self.enable_yfinance = bool(enable_yfinance)
        self.statements_ttl_days = statements_ttl_days
        self.price_ttl_hours = price_ttl_hours
        self.stale = False

    def list_stocks(self) -> list[dict]:
        """Nifty universe via the existing CSV path (httpx, not yFinance API)."""
        inner = YFinanceProvider()
        stocks = inner.list_stocks()
        self.stale = bool(getattr(inner, "stale", False))
        return stocks

    def fundamentals(self, symbol: str, cached: dict | None = None) -> dict:
        """Statements + quote price + math; per-field yFinance fill for nulls."""
        symbol = (symbol or "").strip().upper()
        stored_cached = cached if isinstance(cached, dict) else None
        statements = fetch_statements(
            symbol, self.statements_dir, ttl_days=self.statements_ttl_days
        )
        # Screener's page price is enough for a daily screen — the quote
        # only runs when no price is known anywhere (Stooq hangs for
        # minutes on some networks; never pay that with a price in hand).
        price = _fresh_cached_close(symbol, self.price_dir, self.price_ttl_hours)
        if price is None:
            price = statements.get("price")
        if price is None:
            price = _fetch_quote(symbol)
        if price is None:
            file_cached = price_cache.read_cached(symbol, self.price_dir)
            if file_cached:
                try:
                    price = float(file_cached[-1].get("close"))
                except (TypeError, ValueError):
                    price = None
        computed = compute_ratios({**statements, "price": price, "symbol": symbol})
        missing = [key for key in _DERIVED_KEYS if computed.get(key) is None]
        base_inputs = {**statements, "price": price}
        if missing:
            try:
                reasons = _missing_reasons(statements, price, computed)
                logger.debug("composite %s missing %s reasons=%s", symbol, missing, reasons)
            except Exception:  # noqa: BLE001 — debug never breaks fetch
                pass
            # Per-field yfinance fill: only the null slots, never overwrite good
            # math values. Runs regardless of enable_yfinance (hot path stays off;
            # this is one call per symbol with missing data, isolated in try).
            yf_failed: Exception | None = None
            try:
                yf = YFinanceProvider().fundamentals(symbol, cached=stored_cached)
            except Exception as e:  # noqa: BLE001 — calculator fallback below
                yf_failed = e
                if is_rate_limit_error(e):
                    logger.warning(
                        "yfinance rate-limited for %s missing=%s: %s", symbol, missing, e
                    )
                else:
                    logger.warning("yfinance fill failed for %s missing=%s: %s", symbol, missing, e)
            else:
                try:
                    filled: list[str] = []
                    for key in missing:
                        try:
                            value = yf.get(key)
                        except Exception:  # noqa: BLE001 — one bad field never kills fill
                            continue
                        if value is not None:
                            computed[key] = value
                            filled.append(key)
                    yf_raw = yf.get("raw") if isinstance(yf, dict) else None
                    if isinstance(yf_raw, dict):
                        raw = computed.get("raw") or {}
                        for raw_key, raw_value in yf_raw.items():
                            try:
                                if raw_value is not None and raw.get(raw_key) is None:
                                    raw[raw_key] = raw_value
                            except Exception:  # noqa: BLE001 — skip bad raw field
                                continue
                        computed["raw"] = raw
                    if filled:
                        logger.debug("composite %s yfinance filled %s", symbol, filled)
                except Exception:  # noqa: BLE001 — merge never breaks the symbol
                    logger.warning("yfinance merge failed for %s", symbol, exc_info=True)
            # Ratio-calculator fallback: when yfinance is rate-limited, recompute
            # from yfinance statement numbers (no .info) merged under screener.
            if yf_failed is not None and is_rate_limit_error(yf_failed):
                try:
                    yf_base = yfinance_statements_base(symbol) or {}
                except Exception as e2:  # noqa: BLE001 — calculator derive still runs
                    logger.warning("yfinance statements base failed for %s: %s", symbol, e2)
                    yf_base = {}
                if yf_base:
                    try:
                        merged = dict(statements)
                        for key, value in yf_base.items():
                            if key in ("symbol",):
                                continue
                            if merged.get(key) is None and value is not None:
                                merged[key] = value
                        alt_price = price
                        if alt_price is None and yf_base.get("price") is not None:
                            try:
                                alt_price = float(yf_base.get("price"))
                            except (TypeError, ValueError):
                                alt_price = None
                        recomputed = compute_ratios({**merged, "price": alt_price, "symbol": symbol})
                        calc_filled = [
                            key for key in missing
                            if computed.get(key) is None and recomputed.get(key) is not None
                        ]
                        for key in calc_filled:
                            computed[key] = recomputed[key]
                        if recomputed.get("raw"):
                            raw = computed.get("raw") or {}
                            for raw_key, raw_value in recomputed["raw"].items():
                                if raw_value is not None and raw.get(raw_key) is None:
                                    raw[raw_key] = raw_value
                            computed["raw"] = raw
                        if calc_filled:
                            logger.debug("composite %s calculator filled %s", symbol, calc_filled)
                    except Exception:  # noqa: BLE001 — recompute never breaks symbol
                        logger.warning("calculator recompute failed for %s", symbol, exc_info=True)
            # Algebraic calculator fallback (no network): derive cross-linked
            # ratios from present values + base inputs (respects negative guards).
            still_missing = [key for key in _DERIVED_KEYS if computed.get(key) is None]
            if still_missing:
                try:
                    derived = derive_missing(computed, base_inputs)
                    alg_filled = [key for key in still_missing if key in derived]
                    for key in alg_filled:
                        computed[key] = derived[key]
                    if alg_filled:
                        logger.debug("composite %s algebraic filled %s", symbol, alg_filled)
                except Exception:  # noqa: BLE001 — derive never breaks symbol
                    pass
        # Legacy full-row fallback stays for the all-null + opt-in case; per-field
        # above already covers it when enabled, this keeps the exact old return.
        if self.enable_yfinance and all(
            computed.get(key) is None for key in _DERIVED_KEYS
        ):
            try:
                return YFinanceProvider().fundamentals(symbol, cached=stored_cached)
            except Exception:  # noqa: BLE001 — fall through with math result
                pass
        try:
            raw = computed.get("raw") or {}
            for key in (
                "longBusinessSummary", "website", "industry", "sector",
                "fullTimeEmployees", "city", "state", "country",
            ):
                if raw.get(key) is None and statements.get(key) is not None:
                    raw[key] = statements[key]
            # Description order: Wikipedia primary -> screener -> Google -> yFinance.
            # Website/sector order: screener -> Google -> yFinance (no wiki fields).
            # Lazy only (detail Refresh / screen-run refresh), per-symbol
            # isolated, never raises.
            try:
                screener_short = raw.get("longBusinessSummary")
                wiki = None
                try:
                    wiki = fetch_wikipedia_summary(symbol)
                except Exception:  # noqa: BLE001 — wiki never blocks ratios
                    wiki = None
                if isinstance(wiki, str) and len(wiki) >= 200:
                    if isinstance(screener_short, str) and screener_short.strip():
                        short = screener_short.strip()
                        # Append screener specifics (shareholding etc.) when the
                        # wiki extract does not already contain them.
                        if short not in wiki and wiki not in short:
                            raw["longBusinessSummary"] = wiki + "\n\n" + short
                        else:
                            raw["longBusinessSummary"] = wiki
                    else:
                        raw["longBusinessSummary"] = wiki
            except Exception:  # noqa: BLE001 — enrichment never blocks ratios
                pass
            missing_identity = [
                key for key in ("longBusinessSummary", "website", "industry", "sector")
                if raw.get(key) is None
            ]
            if missing_identity:
                try:
                    searched = fetch_search_identity(symbol) or {}
                except Exception:  # noqa: BLE001 — search never blocks ratios
                    searched = {}
                try:
                    for key in missing_identity:
                        value = searched.get(key)
                        if value is not None and raw.get(key) is None:
                            raw[key] = value
                except Exception:  # noqa: BLE001 — merge never blocks ratios
                    pass
                still_missing = [
                    key for key in ("longBusinessSummary", "website", "industry", "sector",
                                    "fullTimeEmployees", "city", "state", "country")
                    if raw.get(key) is None
                ]
                if still_missing:
                    try:
                        yf_ident = fetch_yfinance_identity(symbol) or {}
                    except Exception:  # noqa: BLE001 — yfinance never blocks ratios
                        yf_ident = {}
                    try:
                        for key in still_missing:
                            value = yf_ident.get(key)
                            if value is not None and raw.get(key) is None:
                                raw[key] = value
                    except Exception:  # noqa: BLE001 — merge never blocks ratios
                        pass
            computed["raw"] = raw
            # Header fallback when the chart fails: keep the screener/quote
            # price inside raw (whitelisted) so the stored snapshot carries it.
            try:
                if price is not None and raw.get("price") is None:
                    raw["price"] = price
                    computed["raw"] = raw
            except Exception:  # noqa: BLE001 — price never blocks ratios
                pass
        except Exception:  # noqa: BLE001 — identity never blocks ratios
            pass
        return {
            "symbol": symbol,
            "pe": computed.get("pe"),
            "pb": computed.get("pb"),
            "roe": computed.get("roe"),
            "roce": computed.get("roce"),
            "debt_to_equity": computed.get("debt_to_equity"),
            "market_cap": computed.get("market_cap"),
            "price": price,
            "raw": computed.get("raw", {}),
        }

    def ohlc(self, symbol: str, years: int = 5) -> list[dict]:
        """File cache first; Stooq on miss/stale; yfinance last-resort for price.

        Stooq times out on some networks with a cold file cache — without a
        fallback /ohlc answers 502 and the stock screen shows "No price data".
        yfinance fills that gap (best-effort, per-stock isolated) even when
        the hot path is off; successes persist to the file cache.
        """
        symbol = (symbol or "").strip().upper()
        stale = price_cache.read_cached(symbol, self.price_dir)
        try:
            rows = price_cache.get_or_fetch(
                symbol,
                lambda: StooqProvider().ohlc(symbol, years=years),
                self.price_dir,
                ttl_hours=self.price_ttl_hours,
            )
            if not rows and stale:
                return stale
            if rows:
                return rows
        except Exception:  # noqa: BLE001 — stale/YF fallback below
            cached = price_cache.read_cached(symbol, self.price_dir)
            if cached:
                return cached
        try:
            rows = YFinanceProvider().ohlc(symbol, years=years)
        except Exception:  # noqa: BLE001 — no source left, surface upstream
            if stale:
                return stale
            raise
        if rows:
            try:
                price_cache.write_cached(symbol, rows, self.price_dir)
            except Exception:  # noqa: BLE001 — cache write never breaks price
                pass
            return rows
        if stale:
            return stale
        return rows

    def filings(self, symbol: str) -> list[dict]:
        raise NotImplementedError("Phase 2")


def build_default_provider() -> DataProvider:
    """Default provider: yFinance hot path off unless env opts in."""
    flag = os.environ.get("ENABLE_YFINANCE", "0").strip().lower() in ("1", "true", "yes")
    return CompositeProvider(enable_yfinance=flag)
