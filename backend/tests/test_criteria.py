import pytest
from pydantic import ValidationError

from app.screener.catalog import CATALOG_BY_KEY
from app.screener.criteria import (
    DEFAULT_CRITERIA,
    CriteriaUpdate,
    criteria_from_json,
    criteria_to_json,
    default_criteria,
)


def test_defaults_match_phase_1_yaml_values():
    assert [(c["key"], c["enabled"], c["value"]) for c in default_criteria()] == [
        ("pe", True, 25.0),
        ("pb", True, 5.0),
        ("roe", True, 15.0),
        ("roce", True, 15.0),
        ("debt_to_equity", True, 0.5),
        ("market_cap", True, 1000.0),
    ]


def test_defaults_are_copied_not_shared():
    first = default_criteria()
    first[0]["value"] = 1
    assert DEFAULT_CRITERIA[0]["value"] == 25.0


def payload(**over):
    criteria = over.pop("criteria", [{"key": "pe", "enabled": True, "value": 25}])
    return {"criteria": criteria, **over}


def test_valid_payload_round_trips():
    model = CriteriaUpdate.model_validate(payload(thesis="quality"))
    assert model.criteria[0].key == "pe" and model.thesis == "quality"


def test_unknown_key_rejected():
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate(payload(criteria=[{"key": "bogus", "enabled": True, "value": 1}]))


def test_duplicate_keys_rejected():
    dupes = [
        {"key": "pe", "enabled": True, "value": 25},
        {"key": "pe", "enabled": False, "value": 30},
    ]
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate(payload(criteria=dupes))


def test_non_finite_value_rejected():
    for bad in (float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            CriteriaUpdate.model_validate(payload(criteria=[{"key": "pe", "enabled": True, "value": bad}]))


def test_non_numeric_value_rejected():
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate(payload(criteria=[{"key": "pe", "enabled": True, "value": "abc"}]))


def test_zero_enabled_rejected():
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate(payload(criteria=[{"key": "pe", "enabled": False, "value": 25}]))


def test_shortlist_size_rejected():
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate({**payload(), "shortlist_size": 5})


def test_thesis_over_500_rejected():
    with pytest.raises(ValidationError):
        CriteriaUpdate.model_validate(payload(thesis="x" * 501))


def test_json_round_trip():
    items = [c.model_dump() for c in CriteriaUpdate.model_validate(payload()).criteria]
    assert criteria_from_json(criteria_to_json(items)) == items


def test_corrupt_json_falls_back_to_defaults():
    assert criteria_from_json("{not json") == default_criteria()


def test_every_default_key_in_catalog():
    assert all(c["key"] in CATALOG_BY_KEY for c in DEFAULT_CRITERIA)


def test_config_error_lives_in_criteria_module():
    from app.screener.criteria import ConfigError

    assert issubclass(ConfigError, ValueError)
