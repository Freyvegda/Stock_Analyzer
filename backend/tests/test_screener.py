from app.screener.engine import apply_screen

CONFIG = {
    "criteria": {"pe_max": 25, "pb_max": 5, "roe_min": 15, "roce_min": 15,
                 "debt_to_equity_max": 0.5, "market_cap_min": 1000},
    "shortlist_size": 10,
}


def row(symbol, pe=20, pb=3, roe=20, roce=20, de=0.2, mc=5000):
    return {"symbol": symbol, "pe": pe, "pb": pb, "roe": roe, "roce": roce,
            "debt_to_equity": de, "market_cap": mc}


def test_all_pass_shortlisted():
    result = apply_screen([row("A")], CONFIG)
    assert len(result) == 1
    assert result[0]["symbol"] == "A"
    assert result[0]["rank"] == 1


def test_pe_above_max_fails():
    assert apply_screen([row("B", pe=30)], CONFIG) == []


def test_low_roe_fails():
    assert apply_screen([row("C", roe=10)], CONFIG) == []


def test_null_ratio_fails():
    assert apply_screen([row("D", pe=None)], CONFIG) == []


def test_ranking_by_score_desc():
    rows = [row("LOW", roe=16, roce=16, de=0.4), row("HIGH", roe=30, roce=30, de=0.1)]
    result = apply_screen(rows, CONFIG)
    assert [r["symbol"] for r in result] == ["HIGH", "LOW"]
    assert result[0]["score"] > result[1]["score"]


def test_shortlist_size_cut():
    rows = [row(f"S{i}", roe=20 + i) for i in range(15)]
    assert len(apply_screen(rows, CONFIG)) == 10


def test_unknown_criterion_raises():
    bad = {"criteria": {"bogus_min": 1}, "shortlist_size": 10}
    try:
        apply_screen([row("X")], bad)
        assert False, "should raise"
    except ValueError as e:
        assert "bogus_min" in str(e)
