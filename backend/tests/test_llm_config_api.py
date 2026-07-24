"""GGOO model gateway replaces Build-local model configuration."""

import asyncio

from fastapi.testclient import TestClient

from app.config import get_llm_client
from app.main import app


client = TestClient(app)


def test_local_llm_config_api_is_not_exposed(db_session):
    assert client.get("/admin/llm-configs/").status_code == 404
    assert client.post("/admin/llm-configs/", json={}).status_code == 404


def test_get_llm_client_uses_current_ggoo_token(monkeypatch):
    sentinel = object()
    seen: list[str] = []

    async def fake_make_llm_client(token: str):
        seen.append(token)
        return sentinel

    monkeypatch.setattr("app.config.ggoo_client.make_llm_client", fake_make_llm_client)
    result = asyncio.run(get_llm_client(authorization="Bearer ggoo-jwt"))
    assert result is sentinel
    assert seen == ["ggoo-jwt"]


def test_get_llm_client_uses_offline_service_key_for_local_jwt(monkeypatch):
    sentinel = object()
    seen: list[str] = []

    async def fake_make_llm_client(token: str):
        seen.append(token)
        return sentinel

    monkeypatch.setenv("BUILD_LEGACY_AUTH_ENABLED", "true")
    monkeypatch.setenv("GGOO_SERVICE_API_KEY", "sk-offline-only")
    monkeypatch.setattr("app.config.ggoo_client.make_llm_client", fake_make_llm_client)
    from app.auth.jwt import create_token

    result = asyncio.run(
        get_llm_client(authorization=f"Bearer {create_token('local-user')}")
    )
    assert result is sentinel
    assert seen == ["sk-offline-only"]


def test_get_llm_client_rejects_missing_identity(monkeypatch):
    monkeypatch.delenv("GGOO_SERVICE_API_KEY", raising=False)
    try:
        asyncio.run(get_llm_client(authorization=None))
    except Exception as exc:  # FastAPI HTTPException
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("missing GGOO identity should be rejected")


def test_get_llm_client_rejects_non_bearer_web_identity(monkeypatch):
    monkeypatch.setenv("GGOO_SERVICE_API_KEY", "sk-offline-only")
    try:
        asyncio.run(get_llm_client(authorization="Basic unexpected"))
    except Exception as exc:  # FastAPI HTTPException
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("malformed web identity must not use the offline service key")
