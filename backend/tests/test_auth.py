import app.auth.security as security
from app.auth.security import hash_password, session_secret, verify_password


def test_hash_verify_round_trip():
    stored = hash_password("correct horse battery")
    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("correct horse battery", stored)


def test_wrong_password_rejected():
    assert not verify_password("nope", hash_password("correct horse battery"))


def test_hash_is_salted():
    assert hash_password("same") != hash_password("same")


def test_malformed_hash_returns_false():
    assert not verify_password("x", "not-a-hash")


def test_session_secret_created_once_and_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "SECRET_PATH", str(tmp_path / ".session_secret"))
    first = session_secret()
    assert first and len(first) >= 32
    assert session_secret() == first
    assert (tmp_path / ".session_secret").read_text(encoding="utf-8") == first
