"""Company search fallback: Wikipedia primary, Google snippets, yFinance last."""
from app.data import company_search as cs


def _resp(text, status=200):
    class R:
        status_code = status
        def __init__(self, t):
            self.text = t
    return R(text)


def _json_resp(payload, status=200):
    class R:
        status_code = status
        def __init__(self, p):
            self._p = p
            import json as _j
            self.text = _j.dumps(p)
        def json(self):
            return self._p
    return R(payload)


def test_search_picks_snippet_and_root_site():
    html = (
        "<html><body>"
        "<div class=\"VwiC3b\">" + "Reliance Industries makes oil and retail goods across India. " * 5 + "</div>"
        "<a href=\"/url?q=https://www.ril.com&sa=U\">ril</a>"
        "<a href=\"https://www.google.com/preferences\">prefs</a>"
        "</body></html>"
    )
    out = cs.fetch_search_identity("RELIANCE", http_get=lambda *a, **k: _resp(html))
    assert out["longBusinessSummary"] and len(out["longBusinessSummary"]) >= 80
    assert out["website"] == "https://www.ril.com"


def test_search_blocked_returns_nones_without_raise():
    out = cs.fetch_search_identity("AAA", http_get=lambda *a, **k: _resp("blocked", status=403))
    assert out == {"longBusinessSummary": None, "website": None, "industry": None, "sector": None}


def test_yfinance_identity_never_raises(monkeypatch):
    import app.data.company_search as m
    monkeypatch.setattr(m, "httpx", None)  # ensure no accidental network via search path
    # Force yfinance import failure path by bad symbol? Just call with monkeypatched yf.
    import sys
    class Boom:
        def __call__(self, *a, **k):
            raise RuntimeError("no network")
    monkeypatch.setitem(sys.modules, "yfinance", type("M", (), {"Ticker": Boom()})())
    out = cs.fetch_yfinance_identity("AAA")
    assert set(out) >= {"longBusinessSummary", "website", "industry", "sector"}


def test_wikipedia_summary_prefers_long_extract():
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if "list=search" in url:
            return _json_resp({"query": {"search": [{"title": "Reliance Industries"}]}})
        return _json_resp({"extract": "Reliance Industries Limited is an Indian multinational conglomerate. " * 10,
                           "title": "Reliance Industries"})

    out = cs.fetch_wikipedia_summary("RELIANCE", "Reliance Industries Ltd", http_get=fake_get)
    assert out and len(out) > 200, out
    assert "Reliance" in out


def test_wikipedia_short_or_missing_returns_none():
    def fake_get(url, **kwargs):
        if "list=search" in url:
            return _json_resp({"query": {"search": []}})
        return _json_resp({}, status=404)

    assert cs.fetch_wikipedia_summary("ZZZ", http_get=fake_get) is None
