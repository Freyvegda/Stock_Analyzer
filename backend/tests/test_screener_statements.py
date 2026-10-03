"""Task 3 RED: screener statements scraper with file cache."""

import json
import os

from app.data import screener_statements as stmt


def fixture_html():
    path = os.path.join(os.path.dirname(__file__), "fixtures", "screener_reliance.html")
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_parse_fixture_numbers():
    out = stmt.parse_statements(fixture_html())
    assert out["revenue"] == 100000.0
    assert out["net_income"] == 15000.0
    assert out["ebitda"] == 20000.0
    assert out["ebit"] == 18000.0  # op + other income - depreciation
    assert out["equity"] == 75000.0  # capital + reserves
    assert out["total_debt"] == 15000.0
    assert out["operating_cashflow"] == 18000.0
    assert out["dividends_paid"] == 3000.0  # payout 20% of net income
    assert out["revenue_prev"] == 90000.0
    assert out["earnings_prev"] == 12000.0
    assert out["promoters_pct"] == 0.5025
    assert out["institutions_pct"] == 0.37


def test_legacy_partial_columns_skipped_annuals_kept():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Jun 2015</th><th>Mar 2016 9m</th><th>Mar 2024</th><th>Mar 2025</th><th>TTM</th></tr>"
        "<tr><td>Sales +</td><td>10</td><td>20</td><td>90</td><td>100</td><td>110</td></tr>"
        "<tr><td>Net Profit +</td><td>1</td><td>2</td><td>12</td><td>15</td><td>16</td></tr>"
        "<tr><td>Total Equity</td><td>5</td><td>6</td><td>70</td><td>75</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 100.0
    assert out["revenue_prev"] == 90.0
    assert out["net_income"] == 15.0
    assert out["equity"] == 75.0


def test_bank_labels_map_to_debt_and_ebitda():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Revenue +</td><td>900</td><td>1000</td></tr>"
        "<tr><td>Net Profit +</td><td>120</td><td>150</td></tr>"
        "<tr><td>Financing Profit</td><td>300</td><td>350</td></tr>"
        "<tr><td>Other Income +</td><td>50</td><td>60</td></tr>"
        "<tr><td>Depreciation</td><td>20</td><td>25</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2025</th></tr>"
        "<tr><td>Equity Capital</td><td>600</td></tr>"
        "<tr><td>Face Value</td><td>2</td></tr>"
        "<tr><td>Reserves</td><td>74400</td></tr>"
        "<tr><td>Borrowing</td><td>15000</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 1000.0
    assert out["ebitda"] == 350.0
    assert out["ebit"] == 385.0  # 350 + 60 - 25
    assert out["total_debt"] == 15000.0


def test_quarterly_table_skipped_for_annuals():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Dec 2025</th><th>Mar 2026</th></tr>"
        "<tr><td>Sales +</td><td>1</td><td>2</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>90</td><td>100</td></tr>"
        "<tr><td>Total Assets</td><td>50</td><td>60</td></tr>"
        "<tr><td>Total Equity</td><td>40</td><td>45</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 100.0
    assert out["revenue_prev"] == 90.0


def test_429_backs_off_then_succeeds(tmp_path, monkeypatch):
    import app.data.screener_statements as stmt_mod

    calls = []
    sleeps = []
    monkeypatch.setattr(stmt_mod.time, "sleep", lambda s: sleeps.append(s))

    class R429:
        status_code = 429
        headers = {"Retry-After": "0"}
        text = "limited"

        def raise_for_status(self):
            pass

    class R200:
        status_code = 200
        headers = {}
        text = fixture_html()

        def raise_for_status(self):
            pass

    def fake_get(url, **kwargs):
        calls.append(url)
        return R429() if len(calls) == 1 else R200()

    monkeypatch.setattr(stmt_mod.httpx, "get", fake_get)
    out = stmt_mod.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 100000.0
    assert len(calls) == 2 and sleeps


def test_missing_tables_yield_nones():
    out = stmt.parse_statements("<html><body>nothing</body></html>")
    assert out["revenue"] is None
    assert out["net_income"] is None


def test_cache_hit_costs_zero_network(tmp_path):
    cached = {"as_of": "2026-10-01", "fields": {"revenue": 5.0}}
    path = tmp_path / "AAA.json"
    path.write_text(json.dumps(cached), encoding="utf-8")

    def boom(*a, **k):
        raise AssertionError("network must not run on cache hit")

    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30, client=boom)
    assert out["revenue"] == 5.0


def test_stale_cache_refetches(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(stmt, "_download", lambda symbol: fixture_html())
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 100000.0


def _ttm_html():
    path = os.path.join(os.path.dirname(__file__), "fixtures", "screener_ttm_lakh.html")
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_ttm_column_skipped_lakh_scaled_and_price_parsed():
    out = stmt.parse_statements(_ttm_html())
    assert out["revenue"] == 1000.0  # 100000 lakh -> cr, TTM 999999 skipped
    assert out["net_income"] == 150.0
    assert out["revenue_prev"] == 900.0
    assert out["equity"] == 750.0
    assert out["price"] == 2500.5


def test_blocked_serves_stale_cache(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0, "equity": 6.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")

    def blocked(symbol):
        raise stmt.ScreenerBlockedError("403")

    monkeypatch.setattr(stmt, "_download", blocked)
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 5.0


def test_block_page_keeps_stale_cache(tmp_path, monkeypatch):
    stale = {"as_of": "2020-01-01", "fields": {"revenue": 5.0, "equity": 6.0}}
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(stmt, "_download", lambda symbol: "<html><body>blocked</body></html>")
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 5.0


def test_fresh_partial_merges_stale_debt(tmp_path):
    stale = {
        "as_of": "2020-01-01",
        "fields": {
            "revenue": 900.0, "net_income": 100.0, "equity": 700.0,
            "total_debt": 15000.0, "ebit": 180.0,
        },
    }
    (tmp_path / "AAA.json").write_text(json.dumps(stale), encoding="utf-8")
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>1000</td><td>1200</td></tr>"
        "<tr><td>Net Profit +</td><td>100</td><td>150</td></tr>"
        "<tr><td>Total Equity</td><td>700</td><td>750</td></tr>"
        "</table></body></html>"
    )
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30,
                                client=lambda symbol: html)
    assert out["revenue"] == 1200.0
    assert out["total_debt"] == 15000.0


def test_quarterly_many_mar_columns_skipped_annuals_kept():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Jun 2023</th><th>Sep 2023</th><th>Dec 2023</th>"
        "<th>Mar 2024</th><th>Jun 2024</th><th>Sep 2024</th><th>Dec 2024</th>"
        "<th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>30</td><td>31</td><td>32</td><td>33</td>"
        "<td>34</td><td>35</td><td>36</td><td>37</td></tr>"
        "<tr><td>Net Profit +</td><td>3</td><td>3</td><td>3</td><td>4</td>"
        "<td>4</td><td>4</td><td>4</td><td>5</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>1000</td><td>1200</td></tr>"
        "<tr><td>Net Profit +</td><td>100</td><td>150</td></tr>"
        "<tr><td>Total Equity</td><td>700</td><td>750</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 1200.0
    assert out["revenue_prev"] == 1000.0
    assert out["net_income"] == 150.0


def test_sep_yearend_columns_are_annual():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Sep 2023</th><th>Sep 2024</th><th>Sep 2025</th></tr>"
        "<tr><td>Sales +</td><td>9000</td><td>10000</td><td>11000</td></tr>"
        "<tr><td>Net Profit +</td><td>900</td><td>1000</td><td>1100</td></tr>"
        "<tr><td>Total Equity</td><td>5000</td><td>5500</td><td>6000</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 11000.0
    assert out["revenue_prev"] == 10000.0
    assert out["net_income"] == 1100.0
    assert out["equity"] == 6000.0


def test_dec_yearend_columns_are_annual():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Dec 2023</th><th>Dec 2024</th><th>Dec 2025</th></tr>"
        "<tr><td>Sales +</td><td>7000</td><td>7500</td><td>8000</td></tr>"
        "<tr><td>Net Profit +</td><td>700</td><td>750</td><td>800</td></tr>"
        "<tr><td>Total Equity</td><td>4000</td><td>4200</td><td>4400</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 8000.0
    assert out["equity"] == 4400.0


def test_consolidated_shell_falls_back_to_main(tmp_path, monkeypatch):
    import app.data.screener_statements as stmt_mod

    shell = "<html><body><table><tr><th></th></tr></table></body></html>"
    main = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>1000</td><td>1200</td></tr>"
        "<tr><td>Net Profit +</td><td>100</td><td>150</td></tr>"
        "<tr><td>Total Equity</td><td>700</td><td>750</td></tr>"
        "</table></body></html>"
    )

    class R200:
        def __init__(self, text):
            self.status_code = 200
            self.headers = {}
            self.text = text

        def raise_for_status(self):
            pass

    def fake_get(url, **kwargs):
        if url.endswith("/consolidated/"):
            return R200(shell)
        return R200(main)

    monkeypatch.setattr(stmt_mod.httpx, "get", fake_get)
    monkeypatch.setattr(stmt_mod.time, "sleep", lambda s: None)
    out = stmt_mod.fetch_statements("AAA", cache_dir=str(tmp_path), ttl_days=30)
    assert out["revenue"] == 1200.0
    assert out["equity"] == 750.0


def test_yearend_transition_stub_and_ttm_skipped():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Sep 2023</th><th>Sep 2024</th><th>Mar 2026 18m</th><th>TTM</th></tr>"
        "<tr><td>Sales +</td><td>9000</td><td>10000</td><td>15000</td><td>16000</td></tr>"
        "<tr><td>Net Profit +</td><td>900</td><td>1000</td><td>1400</td><td>1500</td></tr>"
        "<tr><td>Total Equity</td><td>5000</td><td>5500</td><td>6000</td><td>6100</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 10000.0
    assert out["revenue_prev"] == 9000.0
    assert out["net_income"] == 1000.0


def test_dec_annuals_with_jun_stub_kept():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Dec 2023</th><th>Dec 2024</th><th>Dec 2025</th><th>Jun 2026</th></tr>"
        "<tr><td>Equity Capital</td><td>247</td><td>495</td><td>495</td><td>495</td></tr>"
        "<tr><td>Reserves</td><td>328</td><td>1406</td><td>1500</td><td>1510</td></tr>"
        "<tr><td>Borrowing</td><td>10</td><td>63</td><td>70</td><td>71</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Dec 2024</th><th>Dec 2025</th></tr>"
        "<tr><td>Sales +</td><td>5000</td><td>5722</td></tr>"
        "<tr><td>Net Profit +</td><td>800</td><td>950</td></tr>"
        "<tr><td>Total Equity</td><td>1800</td><td>1901</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 5722.0
    assert out["equity"] == 1901.0
    assert out["total_debt"] == 70.0


def test_lone_mar_stub_beside_sep_annuals_uses_sep():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Sep 2023</th><th>Sep 2024</th><th>Mar 2026</th></tr>"
        "<tr><td>Equity Capital</td><td>71</td><td>71</td><td>71</td></tr>"
        "<tr><td>Reserves</td><td>12953</td><td>15176</td><td>13454</td></tr>"
        "<tr><td>Borrowing</td><td>152</td><td>257</td><td>248</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["total_debt"] == 257.0


def test_disjoint_dec_to_mar_transition_kept():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Dec 2021</th><th>Mar 2022 15m</th>"
        "<th>Mar 2023</th><th>Mar 2024</th></tr>"
        "<tr><td>Sales +</td><td>3771</td><td>4884</td><td>4469</td><td>5237</td></tr>"
        "<tr><td>Net Profit +</td><td>300</td><td>320</td><td>350</td><td>400</td></tr>"
        "<tr><td>Total Equity</td><td>1500</td><td>1550</td><td>1600</td><td>1700</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 5237.0
    assert out["revenue_prev"] == 4469.0


def test_single_sep_annual_for_new_listing():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Sep 2024 8m</th><th>Sep 2025</th><th>TTM</th></tr>"
        "<tr><td>Sales +</td><td>500</td><td>1200</td><td>1300</td></tr>"
        "<tr><td>Net Profit +</td><td>50</td><td>150</td><td>160</td></tr>"
        "<tr><td>Total Equity</td><td>4000</td><td>4812</td><td>4900</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["revenue"] == 1200.0
    assert out["equity"] == 4812.0
