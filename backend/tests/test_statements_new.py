"""RED: parser extracts interest, receivables, payables, pledged."""

from app.data import screener_statements as stmt


def test_new_base_fields_parsed():
    html = (
        "<html><body><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Sales +</td><td>900</td><td>1000</td></tr>"
        "<tr><td>Net Profit +</td><td>80</td><td>100</td></tr>"
        "<tr><td>Interest</td><td>15</td><td>20</td></tr>"
        "<tr><td>Total Equity</td><td>400</td><td>500</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr>"
        "<tr><td>Trade Receivables</td><td>100</td><td>120</td></tr>"
        "<tr><td>Trade Payables</td><td>80</td><td>90</td></tr>"
        "</table><table>"
        "<tr><th></th><th>Mar 2025</th></tr>"
        "<tr><td>Promoters</td><td>50.0</td></tr>"
        "<tr><td>Pledged</td><td>5.0</td></tr>"
        "</table></body></html>"
    )
    out = stmt.parse_statements(html)
    assert out["interest"] == 20.0
    assert out["receivables"] == 120.0
    assert out["payables"] == 90.0
    assert out["pledged_pct"] == 0.05
