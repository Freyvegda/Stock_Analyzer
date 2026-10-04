"""Financial history: 8-quarter + 5-year P&L series (Task 1 RED)."""

from app.data import screener_statements as stmt


def _table(headers, rows):
    head = "<tr><th></th>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr>"
    body = ""
    for label, values in rows:
        cells = "".join(f"<td>{v}</td>" for v in values)
        body += f"<tr><td>{label}</td>{cells}</tr>"
    return f"<table>{head}{body}</table>"


Q_COLS = [
    "Sep 2023", "Dec 2023", "Mar 2024", "Jun 2024", "Sep 2024",
    "Dec 2024", "Mar 2025", "Jun 2025", "Sep 2025",
]
Q_COLS_TTM = Q_COLS + ["TTM"]
N_Q = len(Q_COLS)
Q_SALES = [str(20 + 10 * i) for i in range(N_Q)] + ["999"]
Q_PAT = [str(2 + i) for i in range(N_Q)] + ["999"]
Q_OP = [str(5 + 2 * i) for i in range(N_Q)] + ["999"]
Q_EXP = [str(15 + 8 * i) for i in range(N_Q)] + ["999"]
Q_OTHER = [str(1 + i) for i in range(N_Q)] + ["999"]
Q_INT = [str(1) for _ in range(N_Q)] + ["999"]
Q_DEP = [str(1) for _ in range(N_Q)] + ["999"]
Q_EPS = [str(float(1 + i)) for i in range(N_Q)] + ["999"]

QUARTERLY_HTML_WITH_TTM = (
    "<html><body>"
    + _table(
        Q_COLS_TTM,
        [
            ("Sales +", Q_SALES),
            ("Total Expenses", Q_EXP),
            ("Operating Profit", Q_OP),
            ("Other Income", Q_OTHER),
            ("Finance Cost", Q_INT),
            ("Depreciation", Q_DEP),
            ("Net Profit +", Q_PAT),
            ("EPS in Rs", Q_EPS),
        ],
    )
    + "</body></html>"
)

A_COLS = ["Mar 2020", "Mar 2021", "Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025"]
ANNUAL_HTML = (
    "<html><body>"
    + _table(
        A_COLS,
        [
            ("Revenue +", ["500", "600", "700", "800", "900", "1000"]),
            ("Financing Profit", ["150", "180", "210", "250", "300", "350"]),
            ("Other Income +", ["10", "20", "30", "40", "50", "60"]),
            ("Interest", ["5", "6", "7", "8", "9", "10"]),
            ("Depreciation", ["10", "12", "15", "18", "20", "25"]),
            ("Net Profit +", ["50", "70", "90", "110", "120", "150"]),
            ("EPS in Rs", ["5.0", "7.0", "9.0", "11.0", "12.0", "12.5"]),
        ],
    )
    + "</body></html>"
)

LAKH_HTML = (
    "<html><body><p>Figures in Rs Lakh</p>"
    + _table(
        ["Mar 2024", "Mar 2025"],
        [
            ("Sales +", ["90000", "100000"]),
            ("Net Profit +", ["12000", "15000"]),
            ("EPS in Rs", ["4.0", "5.0"]),
        ],
    )
    + "</body></html>"
)

SPARSE_HTML = (
    "<html><body>"
    + _table(
        ["Dec 2024", "Mar 2025"],
        [
            ("Sales +", ["90", "100"]),
            ("Operating Profit", ["20", "25"]),
            ("Finance Cost", ["-", ""]),
            ("Net Profit +", ["12", "15"]),
        ],
    )
    + "</body></html>"
)

SEP_YEAREND_HTML = (
    "<html><body>"
    + _table(
        ["Sep 2023", "Sep 2024", "Sep 2025", "Mar 2026"],
        [
            ("Sales +", ["100", "150", "200", "5"]),
            ("Net Profit +", ["10", "15", "20", "1"]),
            ("Total Equity", ["40", "45", "50", "51"]),
        ],
    )
    + "</body></html>"
)


def test_parse_history_quarterly_keeps_8_quarters_skips_ttm():
    out = stmt.parse_history(QUARTERLY_HTML_WITH_TTM)
    assert [p["period"] for p in out["quarterly"]] == [
        "Q3FY24", "Q4FY24", "Q1FY25", "Q2FY25",
        "Q3FY25", "Q4FY25", "Q1FY26", "Q2FY26",
    ]
    assert out["quarterly"][-1]["sales"] == 100.0
    assert out["quarterly"][-1]["pat"] == 10.0
    assert out["quarterly"][-1]["operating_profit"] == 21.0


def test_parse_history_annual_keeps_5_years_bank_synonyms():
    out = stmt.parse_history(ANNUAL_HTML)
    assert [p["period"] for p in out["annual"]] == ["FY21", "FY22", "FY23", "FY24", "FY25"]
    assert out["annual"][-1]["operating_profit"] == 350.0
    assert out["annual"][-1]["sales"] == 1000.0
    assert out["annual"][-1]["pat"] == 150.0
    assert out["annual"][-1]["eps"] == 12.5


def test_parse_history_september_yearend_annuals_not_stubbed():
    out = stmt.parse_history(SEP_YEAREND_HTML)
    assert [p["period"] for p in out["annual"]] == ["FY23", "FY24", "FY25"]
    assert out["annual"][-1]["sales"] == 200.0


def test_parse_history_lakh_scales_money_not_eps():
    out = stmt.parse_history(LAKH_HTML)
    assert out["annual"][-1]["sales"] == 1000.0
    assert out["annual"][-1]["eps"] == 5.0


def test_parse_history_missing_cells_are_none():
    out = stmt.parse_history(SPARSE_HTML)
    assert out["quarterly"][-1]["interest"] is None
    assert out["quarterly"][-1]["sales"] == 100.0


def _write_cache(cache_dir, fields, as_of):
    import json as _json
    import os as _os

    path = _os.path.join(cache_dir, "AAA.json")
    with open(path, "w", encoding="utf-8") as f:
        _json.dump({"as_of": as_of, "fields": fields}, f)
    return path


FULL_HTML = (
    "<html><body>"
    + _table(
        Q_COLS,
        [
            ("Sales +", Q_SALES[:9]),
            ("Total Expenses", Q_EXP[:9]),
            ("Operating Profit", Q_OP[:9]),
            ("Net Profit +", Q_PAT[:9]),
        ],
    )
    + _table(
        A_COLS,
        [
            ("Revenue +", ["500", "600", "700", "800", "900", "1000"]),
            ("Net Profit +", ["50", "70", "90", "110", "120", "150"]),
            ("Total Equity", ["400", "450", "500", "600", "700", "750"]),
        ],
    )
    + "</body></html>"
)


def test_fetch_statements_writes_history(tmp_path):
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), client=lambda s: FULL_HTML)
    assert len(out["history"]["quarterly"]) == 8
    assert len(out["history"]["annual"]) == 5
    assert out["history"]["annual"][-1]["sales"] == 1000.0


def test_fetch_statements_backfills_history_on_fresh_cache(tmp_path):
    from datetime import date as _date

    _write_cache(
        str(tmp_path),
        {"revenue": 1000.0, "equity": 750.0},
        _date.today().isoformat(),
    )
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), client=lambda s: FULL_HTML)
    assert len(out["history"]["quarterly"]) == 8
    assert out["revenue"] == 1000.0


def test_fetch_statements_merges_stale_history_on_partial_page(tmp_path):
    from datetime import date as _date

    stale_q = [
        {"period": name, "sales": 1.0, "expenses": None, "operating_profit": None,
         "other_income": None, "interest": None, "depreciation": None,
         "pbt": None, "tax": None, "pat": 0.5, "eps": None}
        for name in ["Q3FY24", "Q4FY24", "Q1FY25", "Q2FY25",
                     "Q3FY25", "Q4FY25", "Q1FY26", "Q2FY26"]
    ]
    _write_cache(
        str(tmp_path),
        {"revenue": 1000.0, "equity": 750.0,
         "history": {"quarterly": stale_q, "annual": []}},
        "2020-01-01",
    )
    fresh = (
        "<html><body>"
        + _table(
            ["Mar 2025", "Mar 2026"],
            [
                ("Sales +", ["1000", "1100"]),
                ("Net Profit +", ["150", "160"]),
                ("Total Equity", ["750", "800"]),
            ],
        )
        + "</body></html>"
    )
    out = stmt.fetch_statements("AAA", cache_dir=str(tmp_path), client=lambda s: fresh)
    assert len(out["history"]["quarterly"]) == 8
    assert out["history"]["quarterly"][-1]["sales"] == 1.0  # stale tail kept
    assert out["history"]["annual"][-1]["sales"] == 1100.0  # fresh annuals stored


def test_parse_history_derives_expenses_pbt_tax():
    out = stmt.parse_history(QUARTERLY_HTML_WITH_TTM)
    last = out["quarterly"][-1]
    assert last["expenses"] == 79.0  # explicit Total Expenses row wins
    annual = stmt.parse_history(ANNUAL_HTML)["annual"][-1]
    assert annual["pbt"] == 375.0  # 350 + 60 - 10 - 25
    assert annual["tax"] == 225.0  # 375 - 150
