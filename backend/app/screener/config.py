import os
from functools import lru_cache

import yaml

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "config", "screening.yaml")


@lru_cache
def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def reload_config() -> dict:
    load_config.cache_clear()
    return load_config()
