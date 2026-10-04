"""Company identity fallbacks: Wikipedia, screener, Google search, yFinance.

Description order per owner: Wikipedia summary primary -> screener.in
About/Key Points -> Google search snippet -> yFinance .info last.
Website/sector/industry order: screener -> Google search -> yFinance
(Wikipedia carries no website/sector). All best-effort, per-stock isolated,
never raise. Offline tests inject ``http_get`` / monkeypatch the fetchers.
"""

import logging
import re

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0 Safari/537.36"
    )
}

_SKIP_HOSTS = (
    "google.", "gstatic.", "googleusercontent.",
    "bseindia.com", "nseindia.com", "screener.in",
    "duckduckgo.com", "bing.com", "yahoo.",
)

_DOC_EXT = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip")

_SNIPPET_SELECTORS = (
    "div.VwiC3b", "div.BNeawe", "span.aCOpRe", "div.MUxGbd",
    "div.result-snippet", ".result__snippet",
)


def _clean(text: str | None) -> str | None:
    if not text:
        return None
    collapsed = re.sub(r"\s+", " ", text).strip()
    return collapsed or None


def is_index_summary(title: str | None, text: str | None) -> bool:
    """True when a candidate description is about a market index, not a company.

    The Wikipedia fallback searches bare symbols (e.g. "ACME NSE India
    company"), whose top hit can be the NIFTY 500 index page — its extract
    then renders as the company's own description. Index pages are
    unmistakable: the title names the index, or the body carries index
    statistics no company summary contains ("free float market
    capitalization" beside turnover/rebalance/base-date). A plain "NIFTY 50
    constituent" mention in real company text never matches.
    """
    if "nifty" in (title or "").lower() or "sensex" in (title or "").lower():
        return True
    body = (text or "").lower()
    if not body:
        return False
    return "free float market capitali" in body and (
        "total turnover" in body or "rebalanc" in body or "base date" in body
    )


def _pick_description(soup: BeautifulSoup) -> str | None:
    best: str | None = None
    for sel in _SNIPPET_SELECTORS:
        for node in soup.select(sel):
            text = _clean(node.get_text(" ", strip=True))
            if text and len(text) >= 80 and (best is None or len(text) > len(best)):
                best = text
    return best


def _pick_website(soup: BeautifulSoup) -> str | None:
    candidates: list[str] = []
    for anchor in soup.select("a[href]"):
        href = (anchor.get("href") or "").strip()
        # Google wraps outlinks as /url?q=<target>.
        if href.startswith("/url?"):
            try:
                from urllib.parse import parse_qs, urlparse

                qs = parse_qs(urlparse(href).query)
                href = (qs.get("q") or [href])[0]
            except Exception:  # noqa: BLE001 — unwrap best-effort
                continue
        if not href.lower().startswith(("http://", "https://")):
            continue
        lowered = href.lower().split("#")[0].split("?")[0]
        if any(host in lowered for host in _SKIP_HOSTS):
            continue
        if lowered.endswith(_DOC_EXT):
            continue
        candidates.append(href)
    if not candidates:
        return None

    def _path_len(url: str) -> int:
        try:
            parts = url.split("://", 1)[1].split("/", 1)
            return len(parts[1]) if len(parts) > 1 else 0
        except Exception:  # noqa: BLE001 — scoring never raises
            return 999

    return sorted(candidates, key=_path_len)[0]


def fetch_search_identity(symbol: str, http_get=None) -> dict:
    """Google snippets first, DuckDuckGo lite second. Never raises."""
    out = {"longBusinessSummary": None, "website": None, "industry": None, "sector": None}
    query = f"{(symbol or '').strip().upper()} NSE company profile business"
    getter = http_get or httpx.get
    urls = [
        "https://www.google.com/search?q=" + httpx.QueryParams({"q": query}).get("q", query) + "&num=5&hl=en",
        "https://lite.duckduckgo.com/lite/?q=" + query.replace(" ", "+"),
    ]
    # Build google URL safely without double-encoding quirks.
    try:
        from urllib.parse import quote_plus

        urls[0] = f"https://www.google.com/search?q={quote_plus(query)}&num=5&hl=en"
    except Exception:  # noqa: BLE001 — fallback to raw query
        pass
    for url in urls:
        try:
            resp = getter(url, headers=_UA, timeout=10, follow_redirects=True)
            status = getattr(resp, "status_code", 200)
            if status in (403, 429):
                continue
            text = getattr(resp, "text", "") or ""
            if not text or len(text) < 100:
                continue
            soup = BeautifulSoup(text, "lxml")
            desc = _pick_description(soup)
            site = _pick_website(soup)
            if desc and is_index_summary(None, desc):
                desc = None  # index overview, not this company — try next source
            if desc and not out["longBusinessSummary"]:
                out["longBusinessSummary"] = desc
            if site and not out["website"]:
                out["website"] = site
            if out["longBusinessSummary"]:
                break
        except Exception as e:  # noqa: BLE001 — search never breaks the symbol
            logger.debug("search identity failed for %s: %s", symbol, e)
            continue
    return out


def fetch_wikipedia_summary(symbol: str, company_name: str | None = None, http_get=None) -> str | None:
    """Wikipedia page extract for the company (primary description). Never raises.

    Resolves the page via the MediaWiki search API, then reads the REST
    summary extract (plain text, usually 5-15 sentences — far richer than
    screener's 1-2 line About). Returns None when unresolved, disambiguation,
    or too short. ``http_get`` injectable for offline tests.
    """
    getter = http_get or httpx.get
    base_symbol = (symbol or "").strip().upper()
    name = (company_name or "").strip()
    # Fast path: the company name usually IS the page title
    # ("Reliance Industries Ltd" -> "Reliance Industries").
    direct_titles: list[str] = []
    if name:
        short = re.sub(r"\b(ltd|ltd\.|limited|inc|corp|company)\b\.?", "", name, flags=re.IGNORECASE).strip(" .,")
        for candidate in (short, name):
            if candidate and candidate not in direct_titles:
                direct_titles.append(candidate)
    for title in direct_titles:
        try:
            from urllib.parse import quote

            summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}"
            summary_resp = getter(summary_url, headers=_UA, timeout=10, follow_redirects=True)
            if getattr(summary_resp, "status_code", 200) in (403, 429, 404):
                continue
            try:
                summary = summary_resp.json()
            except Exception:  # noqa: BLE001 — fall back to text parse
                import json as _json

                try:
                    summary = _json.loads(getattr(summary_resp, "text", "") or "{}")
                except Exception:  # noqa: BLE001 — next title
                    continue
            if not isinstance(summary, dict):
                continue
            if summary.get("type") == "disambiguation":
                continue
            extract = _clean(summary.get("extract"))
            if extract and len(extract) >= 200:
                if is_index_summary(summary.get("title"), extract):
                    continue  # index page, not the company — try next title
                return extract
        except Exception as e:  # noqa: BLE001 — one title never kills the symbol
            logger.debug("wikipedia direct failed for %s/%s: %s", symbol, title, e)
            continue
    queries: list[str] = []
    if name:
        short = re.sub(r"\b(ltd|ltd\.|limited|inc|corp|company)\b\.?", "", name, flags=re.IGNORECASE).strip(" .,")
        if short:
            queries.append(short)
        queries.append(name)
    queries.append(f"{base_symbol} NSE India company")
    queries.append(base_symbol)
    seen_titles: set[str] = set()
    for query in queries:
        titles: list[str] = []
        # REST search (action API 403s generic UAs; REST works).
        try:
            from urllib.parse import quote

            rest_url = (
                "https://en.wikipedia.org/w/rest.php/v1/search/page"
                f"?q={quote(query)}&limit=3"
            )
            resp = getter(rest_url, headers=_UA, timeout=10, follow_redirects=True)
            if getattr(resp, "status_code", 200) not in (403, 429):
                try:
                    payload = resp.json()
                except Exception:  # noqa: BLE001 — fall back to text parse
                    import json as _json

                    try:
                        payload = _json.loads(getattr(resp, "text", "") or "{}")
                    except Exception:  # noqa: BLE001 — try action API below
                        payload = None
                pages = (payload or {}).get("pages") or []
                titles = [
                    p.get("title") or p.get("key", "").replace("_", " ")
                    for p in pages if isinstance(p, dict) and (p.get("title") or p.get("key"))
                ]
        except Exception as e:  # noqa: BLE001 — fall through to action API
            logger.debug("wikipedia rest search failed for %s: %s", symbol, e)
            titles = []
        if not titles:
            try:
                from urllib.parse import quote

                search_url = (
                    "https://en.wikipedia.org/w/api.php?action=query&list=search"
                    f"&srsearch={quote(query)}&utf8=&format=json&srlimit=3"
                )
                resp = getter(search_url, headers=_UA, timeout=10, follow_redirects=True)
                if getattr(resp, "status_code", 200) in (403, 429):
                    continue
                payload = None
                try:
                    payload = resp.json()
                except Exception:  # noqa: BLE001 — fall back to text parse
                    import json as _json

                    try:
                        payload = _json.loads(getattr(resp, "text", "") or "{}")
                    except Exception:  # noqa: BLE001 — unparsable means next query
                        continue
                hits = ((payload or {}).get("query") or {}).get("search") or []
                titles = [h.get("title") for h in hits if isinstance(h, dict) and h.get("title")]
            except Exception as e:  # noqa: BLE001 — one query never kills the symbol
                logger.debug("wikipedia search failed for %s: %s", symbol, e)
                continue
        try:
            from urllib.parse import quote

            for title in titles:
                if title in seen_titles:
                    continue
                seen_titles.add(title)
                try:
                    summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}"
                    summary_resp = getter(summary_url, headers=_UA, timeout=10, follow_redirects=True)
                    if getattr(summary_resp, "status_code", 200) in (403, 429, 404):
                        continue
                    try:
                        summary = summary_resp.json()
                    except Exception:  # noqa: BLE001 — fall back to text parse
                        import json as _json

                        try:
                            summary = _json.loads(getattr(summary_resp, "text", "") or "{}")
                        except Exception:  # noqa: BLE001 — next title
                            continue
                    if not isinstance(summary, dict):
                        continue
                    if summary.get("type") == "disambiguation":
                        continue
                    extract = _clean(summary.get("extract"))
                    if extract and len(extract) >= 200:
                        if is_index_summary(summary.get("title"), extract):
                            continue  # index page, not the company
                        return extract
                except Exception as e:  # noqa: BLE001 — one title never kills search
                    logger.debug("wikipedia summary failed for %s/%s: %s", symbol, title, e)
                    continue
        except Exception as e:  # noqa: BLE001 — one query never kills the symbol
            logger.debug("wikipedia search failed for %s: %s", symbol, e)
            continue
    return None


def fetch_yfinance_identity(symbol: str) -> dict:
    """yFinance .info identity (last resort). Never raises."""
    out = {
        "longBusinessSummary": None, "website": None, "industry": None, "sector": None,
        "fullTimeEmployees": None, "city": None, "state": None, "country": None,
    }
    try:
        import yfinance as yf

        # Use the shared watchdog+retry helpers for hung/rate-limited info.
        from app.data.yfinance_impl import _call_with_timeout, _retry

        ticker = yf.Ticker(f"{(symbol or '').strip().upper()}.NS")
        info = _retry(lambda: _call_with_timeout(lambda: ticker.info), label=symbol) or {}
        if not isinstance(info, dict):
            return {k: None for k in out}
        for key in ("longBusinessSummary", "website", "industry", "sector"):
            value = info.get(key)
            if isinstance(value, str) and value.strip():
                out[key] = value.strip()
        employees = info.get("fullTimeEmployees")
        try:
            out["fullTimeEmployees"] = int(employees) if employees is not None else None
        except (TypeError, ValueError):
            out["fullTimeEmployees"] = None
        for key in ("city", "state", "country"):
            value = info.get(key)
            if isinstance(value, str) and value.strip():
                out[key] = value.strip()
    except Exception as e:  # noqa: BLE001 — identity never breaks the symbol
        logger.debug("yfinance identity failed for %s: %s", symbol, e)
    return out
