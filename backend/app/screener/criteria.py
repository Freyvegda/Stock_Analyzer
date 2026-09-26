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


class CriteriaUpdate(BaseModel):
    """Body of ``PUT /screen/criteria``. ``extra="forbid"`` rejects
    ``shortlist_size`` (server-owned) and any other unexpected field."""

    model_config = ConfigDict(extra="forbid")

    criteria: list[CriterionItem] = Field(min_length=1, max_length=50)
    thesis: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _consistent(self) -> "CriteriaUpdate":
        keys = [item.key for item in self.criteria]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        if duplicates:
            raise ValueError(f"duplicate criteria keys {duplicates}")
        if not any(item.enabled for item in self.criteria):
            raise ValueError("at least one criterion must be enabled")
        return self


def criteria_to_json(criteria: list[dict[str, Any]]) -> str:
    return json.dumps(criteria)


def criteria_from_json(text: str) -> list[dict[str, Any]]:
    """Parse stored criteria; corrupt/tampered payloads fall back to defaults."""
    try:
        data = json.loads(text)
        validated = [CriterionItem.model_validate(item) for item in data]
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
        return default_criteria()
    return [item.model_dump() for item in validated]
