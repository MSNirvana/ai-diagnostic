from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_register_returns_token(db_session):
    resp = client.post("/auth/register", json={"email": "a@b.com", "password": "secret123"})
    assert resp.status_code == 201
    assert resp.json()["access_token"]
    assert resp.json()["token_type"] == "bearer"


def test_register_duplicate_email_conflict(db_session):
    client.post("/auth/register", json={"email": "dup@b.com", "password": "secret123"})
    resp = client.post("/auth/register", json={"email": "dup@b.com", "password": "secret123"})
    assert resp.status_code == 409


def test_register_short_password_rejected(db_session):
    resp = client.post("/auth/register", json={"email": "x@b.com", "password": "123"})
    assert resp.status_code == 422


def test_login_success(db_session):
    client.post("/auth/register", json={"email": "log@b.com", "password": "secret123"})
    resp = client.post("/auth/login", json={"email": "log@b.com", "password": "secret123"})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_wrong_password(db_session):
    client.post("/auth/register", json={"email": "wp@b.com", "password": "secret123"})
    resp = client.post("/auth/login", json={"email": "wp@b.com", "password": "wrongpass"})
    assert resp.status_code == 401


def test_login_unknown_email(db_session):
    resp = client.post("/auth/login", json={"email": "nobody@b.com", "password": "secret123"})
    assert resp.status_code == 401
