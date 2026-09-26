import pytest

from app.screener.config import config_bundle


@pytest.fixture(autouse=True)
def _clear_config_cache():
    """Validated config is lru_cached; never leak a test's config into others."""
    config_bundle.cache_clear()
    yield
    config_bundle.cache_clear()
