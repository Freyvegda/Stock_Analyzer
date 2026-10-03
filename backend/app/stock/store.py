"""Storage policy for shared stock data.

``raw_json`` on a fundamentals row is a whitelist — every field a screener
criterion or a detail digest fact can read, and nothing else. Company identity
(description, HQ, website, ...) lives in ``company_profiles``, one row per symbol,
upserted by `merge` on every successful fetch. Helpers never commit: the caller
owns the transaction so a batch stays one unit of work.
"""

from app.db.models import CompanyProfile
from app.screener.catalog import RATIO_CATALOG
from app.stock.digest import BALANCE_FACTS, MAIN_FACTS, PERFORMANCE_FACTS

#: Every `.info` field the app can later read back from `raw_json`.
RAW_FIELDS: frozenset[str] = frozenset(
    spec.yf_field for spec in RATIO_CATALOG if spec.yf_field
) | frozenset(
    fact.yf_field
    for fact in (*MAIN_FACTS, *BALANCE_FACTS, *PERFORMANCE_FACTS)
    if fact.yf_field
)

_PROFILE_KEYS = ("description", "industry", "sector", "website", "employees", "hq")


def trim_raw(info: dict) -> dict:
    """Whitelisted, non-empty fields only — bounds every stored row."""
    return {
        key: value
        for key, value in (info or {}).items()
        if key in RAW_FIELDS and value is not None and value != ""
    }


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _employees(info: dict) -> int | None:
    value = info.get("fullTimeEmployees")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _hq(info: dict) -> str | None:
    parts = [
        str(info[key]).strip()
        for key in ("city", "state", "country")
        if info.get(key) not in (None, "")
    ]
    return ", ".join(parts) or None


_IDENTITY_KEYS = frozenset(
    {
        "industry",
        "sector",
        "longBusinessSummary",
        "website",
        "fullTimeEmployees",
        "city",
        "state",
        "country",
    }
)


def upsert_profile(session, symbol: str, info: dict, updated_at: str) -> None:
    """Queue a `company_profiles` upsert (no commit). Odd `.info` values degrade
    to `None` instead of failing the fetch that carried them.

    Skips math-only payloads (no identity keys): a fundamentals refresh must
    never null a good profile row.
    """
    info = info or {}
    if not any(key in info for key in _IDENTITY_KEYS):
        return
    session.merge(
        CompanyProfile(
            symbol=symbol,
            industry=_clean(info.get("industry")),
            sector=_clean(info.get("sector")),
            description=_clean(info.get("longBusinessSummary")),
            website=_clean(info.get("website")),
            employees=_employees(info),
            hq=_hq(info),
            updated_at=updated_at,
        )
    )


def read_profile(session, symbol: str) -> dict:
    """Profile payload for the detail page; absent row → all-`None` keys."""
    row = session.get(CompanyProfile, symbol)
    if row is None:
        return dict.fromkeys(_PROFILE_KEYS)
    return {
        "description": row.description,
        "industry": row.industry,
        "sector": row.sector,
        "website": row.website,
        "employees": row.employees,
        "hq": row.hq,
    }
