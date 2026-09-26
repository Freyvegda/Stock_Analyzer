"""Screening config: load + validate ``config/screening.yaml``.

Validation lives here so every consumer (API, service) sees a typed,
known-good dict. Invalid config raises ConfigError, surfaced as HTTP 422 by the
handler registered in app.main.
"""

import os
from functools import lru_cache

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.screener.catalog import RATIO_CATALOG

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "config", "screening.yaml")

# Legacy YAML criterion names (engine keys moved to the catalog in Phase 1.5;
# this module and screening.yaml are deleted at the end of the phase).
CRITERIA = {f"{spec.key}_{spec.direction}": (spec.key, spec.direction) for spec in RATIO_CATALOG}


class ConfigError(ValueError):
    """Invalid screening.yaml — surfaced to clients as HTTP 422."""


class ScreenConfig(BaseModel):
    """Validated shape of screening.yaml.

    Unknown criteria keys are rejected (typo guard). Extra top-level keys are
    kept for forward compatibility with later phases.
    """

    model_config = ConfigDict(extra="allow")

    criteria: dict[str, float] = Field(min_length=1)
    shortlist_size: int = Field(default=10, ge=1)

    @field_validator("criteria")
    @classmethod
    def _known_criteria(cls, value: dict[str, float]) -> dict[str, float]:
        unknown = sorted(set(value) - set(CRITERIA))
        if unknown:
            raise ValueError(f"unknown criteria {unknown}; known: {sorted(CRITERIA)}")
        return value


def read_config_text() -> str:
    """Verbatim YAML file contents — snapshotted into screen_runs for reproducibility."""
    return config_bundle()[1]


@lru_cache
def config_bundle() -> tuple[dict, str]:
    """Validated config dict + verbatim YAML text from a single read.

    Cached together so the config that is evaluated and the snapshot stored in
    screen_runs can never diverge. reload_config() clears both.
    """
    with open(CONFIG_PATH, encoding="utf-8") as f:
        raw_text = f.read()
    try:
        raw = yaml.safe_load(raw_text)
    except yaml.YAMLError as e:
        raise ConfigError(f"Invalid screening.yaml syntax: {e}") from e
    try:
        validated = ScreenConfig.model_validate(raw if raw is not None else {})
    except ValidationError as e:
        raise ConfigError(f"Invalid screening.yaml: {e}") from e
    return validated.model_dump(), raw_text


def load_config() -> dict:
    return config_bundle()[0]


def reload_config() -> dict:
    config_bundle.cache_clear()
    return load_config()
