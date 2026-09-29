import json

import pytest
from pydantic import ValidationError

from app.screener.catalog import CATALOG_BY_KEY
from app.screener.criteria import (
    DEFAULT_CRITERIA,
    ScreeningSetCreate,
    ScreeningSetUpdate,
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


def criteria_payload(**over):
    criteria = over.pop("criteria", [{"key": "pe", "enabled": True, "value": 25}])
    return {"name": "Quality", "criteria": criteria, **over}


def test_screening_set_create_round_trips():
    model = ScreeningSetCreate.model_validate(criteria_payload(thesis="quality"))
    assert model.name == "Quality"
    assert model.criteria[0].key == "pe" and model.thesis == "quality"


def test_screening_set_create_strips_name():
    model = ScreeningSetCreate.model_validate({"name": "  Momentum  "})
    assert model.name == "Momentum"


def test_screening_set_create_rejects_blank_name():
    for bad in ("", "   "):
        with pytest.raises(ValidationError):
            ScreeningSetCreate.model_validate({"name": bad})


def test_screening_set_create_rejects_shortlist_size():
    with pytest.raises(ValidationError):
        ScreeningSetCreate.model_validate({"name": "x", "shortlist_size": 5})


def test_screening_set_create_accepts_without_criteria():
    model = ScreeningSetCreate.model_validate({"name": "Quality"})
    assert model.criteria is None


def test_screening_set_create_validates_criteria():
    with pytest.raises(ValidationError):
        ScreeningSetCreate.model_validate(
            criteria_payload(criteria=[{"key": "bogus", "enabled": True, "value": 1}])
        )
    with pytest.raises(ValidationError):
        ScreeningSetCreate.model_validate(
            criteria_payload(
                criteria=[
                    {"key": "pe", "enabled": True, "value": 25},
                    {"key": "pe", "enabled": False, "value": 30},
                ]
            )
        )
    with pytest.raises(ValidationError):
        ScreeningSetCreate.model_validate(
            criteria_payload(criteria=[{"key": "pe", "enabled": False, "value": 25}])
        )
    for bad in (float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            ScreeningSetCreate.model_validate(
                criteria_payload(criteria=[{"key": "pe", "enabled": True, "value": bad}])
            )
    with pytest.raises(ValidationError):
        ScreeningSetCreate.model_validate(criteria_payload(thesis="x" * 501))


def test_screening_set_update_requires_a_field():
    with pytest.raises(ValidationError):
        ScreeningSetUpdate.model_validate({})
    model = ScreeningSetUpdate.model_validate({"name": "x"})
    assert model.name == "x"


def test_screening_set_update_allows_clearing_thesis():
    model = ScreeningSetUpdate.model_validate({"thesis": None})
    assert model.thesis is None
    assert model.model_fields_set == {"thesis"}


def test_screening_set_update_validates_criteria_and_name():
    with pytest.raises(ValidationError):
        ScreeningSetUpdate.model_validate({"name": "   "})
    with pytest.raises(ValidationError):
        ScreeningSetUpdate.model_validate(
            {"criteria": [{"key": "pe", "enabled": False, "value": 25}]}
        )


def test_json_round_trip():
    items = [
        c.model_dump()
        for c in ScreeningSetCreate.model_validate(criteria_payload()).criteria
    ]
    assert criteria_from_json(criteria_to_json(items)) == items


def test_corrupt_json_falls_back_to_defaults():
    assert criteria_from_json("{not json") == default_criteria()


def test_semantically_invalid_json_falls_back_to_defaults():
    # Stored/tampered payloads that parse as JSON but break the invariants must
    # not silently turn the screen into "everything passes" (or anything else).
    assert criteria_from_json("[]") == default_criteria()
    all_disabled = '[{"key": "pe", "enabled": false, "value": 25}]'
    assert criteria_from_json(all_disabled) == default_criteria()
    duplicates = (
        '[{"key": "pe", "enabled": true, "value": 25},'
        ' {"key": "pe", "enabled": true, "value": 30}]'
    )
    assert criteria_from_json(duplicates) == default_criteria()
    too_many = json.dumps(
        [{"key": "pe", "enabled": True, "value": i} for i in range(51)]
    )
    assert criteria_from_json(too_many) == default_criteria()


def test_every_default_key_in_catalog():
    assert all(c["key"] in CATALOG_BY_KEY for c in DEFAULT_CRITERIA)


def test_config_error_lives_in_criteria_module():
    from app.screener.criteria import ConfigError

    assert issubclass(ConfigError, ValueError)
