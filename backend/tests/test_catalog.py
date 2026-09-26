from app.screener.catalog import CATALOG_BY_KEY, RATIO_CATALOG

DERIVED = {"pe", "pb", "roe", "roce", "debt_to_equity", "market_cap"}


def test_keys_unique():
    keys = [s.key for s in RATIO_CATALOG]
    assert len(keys) == len(set(keys))


def test_text_fields_non_empty():
    for s in RATIO_CATALOG:
        assert s.key and s.label and s.unit and s.category, s.key


def test_directions_and_sources_valid():
    for s in RATIO_CATALOG:
        assert s.direction in {"min", "max"}, s.key
        assert s.source in {"derived", "raw"}, s.key


def test_raw_entries_have_yf_field_and_positive_scale():
    for s in RATIO_CATALOG:
        if s.source == "raw":
            assert s.yf_field, s.key
            assert s.scale > 0, s.key
        else:
            assert s.yf_field is None, s.key


def test_derived_set_is_exactly_the_six_columns():
    assert {s.key for s in RATIO_CATALOG if s.source == "derived"} == DERIVED


def test_catalog_lookup_complete():
    assert set(CATALOG_BY_KEY) == {s.key for s in RATIO_CATALOG}
