import textwrap
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import screen
from app.main import app
from app.screener import config as config_module
from app.screener.config import ConfigError, load_config, reload_config

client = TestClient(app)

VALID_CRITERIA = """
criteria:
  pe_max: 25
  pb_max: 5
  roe_min: 15
  roce_min: 15
  debt_to_equity_max: 0.5
  market_cap_min: 1000
shortlist_size: 10
"""


def use_config(tmp_path, monkeypatch, body: str) -> None:
    path = tmp_path / "screening.yaml"
    path.write_text(textwrap.dedent(body), encoding="utf-8")
    monkeypatch.setattr(config_module, "CONFIG_PATH", str(path))


def test_valid_config_loads_as_dict(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA)
    config = load_config()
    assert config["criteria"]["roe_min"] == 15.0
    assert config["shortlist_size"] == 10


def test_shortlist_size_defaults_to_ten(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA.replace("shortlist_size: 10\n", ""))
    assert load_config()["shortlist_size"] == 10


def test_non_numeric_value_raises_config_error(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA.replace("roe_min: 15", "roe_min: abc"))
    with pytest.raises(ConfigError) as exc:
        load_config()
    assert "roe_min" in str(exc.value)


def test_unknown_criterion_raises_config_error(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA + "  bogus_min: 1\n")
    with pytest.raises(ConfigError) as exc:
        load_config()
    assert "bogus_min" in str(exc.value)


def test_missing_criteria_raises_config_error(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, "shortlist_size: 5\n")
    with pytest.raises(ConfigError):
        load_config()


def test_bad_yaml_syntax_raises_config_error(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, "criteria: [unclosed\n")
    with pytest.raises(ConfigError):
        load_config()


def test_bad_config_endpoints_return_422(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA.replace("roe_min: 15", "roe_min: abc"))
    res = client.get("/screen/config")
    assert res.status_code == 422
    assert "roe_min" in res.json()["detail"]
    assert client.post("/screen/config/reload").status_code == 422


def test_run_endpoint_returns_422_on_invalid_config(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA.replace("roe_min: 15", "roe_min: abc"))
    monkeypatch.setattr(screen, "init_db", lambda: None)

    res = client.post("/screen/run")

    assert res.status_code == 422
    assert "roe_min" in res.json()["detail"]


def test_reload_config_picks_up_file_change(tmp_path, monkeypatch):
    use_config(tmp_path, monkeypatch, VALID_CRITERIA)
    assert load_config()["criteria"]["pe_max"] == 25.0

    Path(config_module.CONFIG_PATH).write_text(
        VALID_CRITERIA.replace("pe_max: 25", "pe_max: 10"), encoding="utf-8"
    )
    assert load_config()["criteria"]["pe_max"] == 25.0  # cached until reload

    assert reload_config()["criteria"]["pe_max"] == 10.0
    assert load_config()["criteria"]["pe_max"] == 10.0
