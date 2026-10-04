"""RED: index summaries must never become a stock's description."""

from app.data import company_search as cs


NIFTY_TEXT = (
    "The NIFTY 500 is an Indian broad-based stock market index of the companies "
    "listed in the National Stock Exchange. It contains top 500 listed companies "
    "on the NSE. The NIFTY 500 index represents about 92.04% of free float market "
    "capitalization and about 84.07% of the total turnover on the National Stock "
    "Exchange (NSE) in India as on 30 March 2026. The index's base date is "
    "01 January 1995, and is rebalanced semi-annually."
)


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


def test_index_text_detected():
    assert cs.is_index_summary("NIFTY 500", NIFTY_TEXT) is True


def test_company_text_not_detected():
    text = "Reliance Industries Limited is an Indian multinational conglomerate. " * 10
    assert cs.is_index_summary("Reliance Industries", text) is False


def test_company_mentioning_nifty_membership_not_detected():
    text = ("Tata Consultancy Services is an Indian IT company and a constituent "
            "of the NIFTY 50 index. " * 6)
    assert cs.is_index_summary("Tata Consultancy Services", text) is False


def test_wikipedia_skips_nifty_page_and_takes_company():
    def fake_get(url, **kwargs):
        if "list=search" in url or "search/page" in url:
            return _json_resp({"query": {"search": [{"title": "NIFTY 500"}, {"title": "Acme Corp"}]},
                               "pages": [{"title": "NIFTY 500"}, {"title": "Acme Corp"}]})
        if "NIFTY" in url or "Nifty" in url:
            return _json_resp({"extract": NIFTY_TEXT, "title": "NIFTY 500"})
        return _json_resp({"extract": "Acme Corp makes widgets for global markets. " * 10,
                           "title": "Acme Corp"})

    out = cs.fetch_wikipedia_summary("ACME", http_get=fake_get)
    assert out is not None
    assert "free float" not in out.lower()


def test_wikipedia_only_nifty_returns_none():
    def fake_get(url, **kwargs):
        if "list=search" in url or "search/page" in url:
            return _json_resp({"query": {"search": [{"title": "NIFTY 500"}]},
                               "pages": [{"title": "NIFTY 500"}]})
        return _json_resp({"extract": NIFTY_TEXT, "title": "NIFTY 500"})

    assert cs.fetch_wikipedia_summary("ACME", http_get=fake_get) is None
