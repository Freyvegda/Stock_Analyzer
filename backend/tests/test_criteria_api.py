import json

from app.db.models import UserCriteria
from app.screener.criteria import default_criteria


def test_ratios_catalog_shape(client, sign_in):
    sign_in()
    res = client.get("/screen/ratios")
    assert res.status_code == 200
    rows = res.json()
    assert {"key", "label", "unit", "category", "direction"} == set(rows[0])
    by_key = {r["key"]: r for r in rows}
    assert by_key["pe"]["direction"] == "max"
    assert by_key["roe"]["unit"] == "%"
    assert "currentRatio" in by_key


def test_first_read_seeds_defaults(client, sign_in, test_db):
    sign_in()
    body = client.get("/screen/criteria").json()
    assert body == {"criteria": default_criteria(), "thesis": None, "shortlist_size": 10}
    assert client.get("/screen/criteria").json() == body  # idempotent
    with test_db() as session:
        assert session.query(UserCriteria).count() == 1


def test_put_round_trip(client, sign_in, test_db):
    sign_in()
    payload = {
        "criteria": [
            {"key": "pe", "enabled": False, "value": 5},
            {"key": "roe", "enabled": True, "value": 18},
            {"key": "dividendYield", "enabled": True, "value": 1.0},
        ],
        "thesis": "quality compounders",
    }
    res = client.put("/screen/criteria", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["criteria"][1] == {"key": "roe", "enabled": True, "value": 18.0}
    assert body["thesis"] == "quality compounders"
    assert body["shortlist_size"] == 10
    assert client.get("/screen/criteria").json() == body
    with test_db() as session:
        row = session.get(UserCriteria, 1)
        assert json.loads(row.criteria_json) == body["criteria"]


def test_put_validation_errors(client, sign_in):
    sign_in()
    cases = [
        [{"key": "bogus", "enabled": True, "value": 1}],
        [{"key": "pe", "enabled": True, "value": 1}, {"key": "pe", "enabled": False, "value": 2}],
        [{"key": "pe", "enabled": True, "value": "abc"}],
        [{"key": "pe", "enabled": False, "value": 1}],
    ]
    for criteria in cases:
        res = client.put("/screen/criteria", json={"criteria": criteria})
        assert res.status_code == 422, criteria
        assert isinstance(res.json()["detail"], str)
    thesis_422 = client.put(
        "/screen/criteria",
        json={"criteria": [{"key": "pe", "enabled": True, "value": 1}], "thesis": "x" * 501},
    )
    assert thesis_422.status_code == 422
    extra_422 = client.put(
        "/screen/criteria",
        json={"criteria": [{"key": "pe", "enabled": True, "value": 1}], "shortlist_size": 5},
    )
    assert extra_422.status_code == 422


def test_criteria_are_per_user(client, sign_in, test_db):
    sign_in("alice")
    client.put("/screen/criteria", json={"criteria": [{"key": "pe", "enabled": True, "value": 7}]})
    sign_in("bob")
    assert client.get("/screen/criteria").json()["criteria"] == default_criteria()


def test_corrupt_stored_json_falls_back_to_defaults(client, sign_in, test_db):
    sign_in()
    with test_db() as session:
        session.add(
            UserCriteria(
                user_id=1, criteria_json="{oops", thesis=None, shortlist_size=10, updated_at="now"
            )
        )
        session.commit()
    assert client.get("/screen/criteria").json()["criteria"] == default_criteria()


def test_criteria_routes_require_auth(client, test_db):
    assert client.get("/screen/ratios").status_code == 401
    assert client.get("/screen/criteria").status_code == 401
    payload = {"criteria": [{"key": "pe", "enabled": True, "value": 1}]}
    assert client.put("/screen/criteria", json=payload).status_code == 401
