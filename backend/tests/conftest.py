import pytest

from app.screener.config import load_config


@pytest.fixture(autouse=True)
def _clear_config_cache():
    """Validated config is lru_cached; never leak a test's config into others."""
    load_config.cache_clear()
    yield
    load_config.cache_clear()
