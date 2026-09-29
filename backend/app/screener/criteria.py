"""Per-user screening criteria: pydantic models, defaults, JSON serialization.

Criteria live in ``user_criteria.criteria_json`` (list of
``{"key", "enabled", "value"}``). Valid keys are owned by ``catalog.py``.
``ConfigError`` is the shared 422 vehicle (registered as an exception handler
in ``app.main``).
"""

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.screener.catalog import CATALOG_BY_KEY


class ConfigError(ValueError):
    """Invalid criteria — surfaced to clients as HTTP 422."""


# Phase-1 YAML values, all enabled.
DEFAULT_CRITERIA: list[dict[str, Any]] = [
    {"key": "pe", "enabled": True, "value": 25.0},
    {"key": "pb", "enabled": True, "value": 5.0},
    {"key": "roe", "enabled": True, "value": 15.0},
    {"key": "roce", "enabled": True, "value": 15.0},
    {"key": "debt_to_equity", "enabled": True, "value": 0.5},
    {"key": "market_cap", "enabled": True, "value": 1000.0},
]


def default_criteria() -> list[dict[str, Any]]:
    """Deep copy so callers can never mutate the module-level defaults."""
    return [dict(item) for item in DEFAULT_CRITERIA]


class CriterionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    enabled: bool
    value: float = Field(allow_inf_nan=False)

    @field_validator("key")
    @classmethod
    def _known_key(cls, value: str) -> str:
        if value not in CATALOG_BY_KEY:
            raise ValueError(f"unknown criteria key {value!r}")
        return value


#: Longest accepted screening-set name (Phase 1.7).
SET_NAME_MAX = 60


def validate_criteria_list(items: list[CriterionItem]) -> list[dict[str, Any]]:
    """Shared criteria invariants: no duplicate keys, at least one enabled."""
    keys = [item.key for item in items]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    if duplicates:
        raise ValueError(f"duplicate criteria keys {duplicates}")
    if not any(item.enabled for item in items):
        raise ValueError("at least one criterion must be enabled")
    return [item.model_dump() for item in items]


class ScreeningSetCreate(BaseModel):
    """Body of ``POST /screen/sets``. ``extra="forbid"`` rejects
    ``shortlist_size`` (server-owned) and any other unexpected field."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=SET_NAME_MAX)
    criteria: list[CriterionItem] | None = Field(default=None, min_length=1, max_length=50)
    thesis: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned

    @model_validator(mode="after")
    def _check_criteria(self) -> "ScreeningSetCreate":
        if self.criteria is not None:
            validate_criteria_list(self.criteria)
        return self


class ScreeningSetUpdate(BaseModel):
    """Body of ``PUT /screen/sets/{id}`` — at least one field must be provided;
    an explicitly provided ``thesis: null`` clears the thesis."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=SET_NAME_MAX)
    criteria: list[CriterionItem] | None = Field(default=None, min_length=1, max_length=50)
    thesis: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned

    @model_validator(mode="after")
    def _check(self) -> "ScreeningSetUpdate":
        if not self.model_fields_set & {"name", "criteria", "thesis"}:
            raise ValueError("at least one of name, criteria, thesis is required")
        if self.criteria is not None:
            validate_criteria_list(self.criteria)
        return self


class CriteriaUpdate(BaseModel):
    """Body of the retired ``PUT /screen/criteria``. ``extra="forbid"`` rejects
    ``shortlist_size`` (server-owned) and any other unexpected field."""

    model_config = ConfigDict(extra="forbid")

    criteria: list[CriterionItem] = Field(min_length=1, max_length=50)
    thesis: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _consistent(self) -> "CriteriaUpdate":
        validate_criteria_list(self.criteria)
        return self


def criteria_to_json(criteria: list[dict[str, Any]]) -> str:
    return json.dumps(criteria)


def criteria_from_json(text: str) -> list[dict[str, Any]]:
    """Parse stored criteria; corrupt or invariant-breaking payloads fall back
    to defaults. Full ``CriteriaUpdate`` validation means an empty list,
    all-disabled set, duplicate keys, or >50 items can never silently change
    what a run means."""
    try:
        data = json.loads(text)
        model = CriteriaUpdate.model_validate({"criteria": data})
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
        return default_criteria()
    return [item.model_dump() for item in model.criteria]
