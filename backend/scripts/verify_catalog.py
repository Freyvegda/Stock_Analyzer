"""Manual, online-only check: raw catalog scales vs live yfinance .info.

Run from backend/:  python -m scripts.verify_catalog
Never part of the offline test suite.
"""

from app.screener.catalog import RATIO_CATALOG

TICKERS = ("RELIANCE", "TCS", "HDFCBANK")


def main() -> None:
    import sys

    import yfinance as yf

    sys.stdout.reconfigure(encoding="utf-8")

    infos = {s: (yf.Ticker(f"{s}.NS").info or {}) for s in TICKERS}
    for spec in RATIO_CATALOG:
        if spec.source != "raw":
            continue
        parts = []
        for symbol in TICKERS:
            value = infos[symbol].get(spec.yf_field)
            scaled = round(float(value) * spec.scale, 4) if isinstance(value, (int, float)) else None
            parts.append(f"{symbol}={value!r}->{scaled}{spec.unit}")
        print(f"{spec.key:28} {spec.yf_field:32} scale={spec.scale:<5} " + "  ".join(parts))


if __name__ == "__main__":
    main()
