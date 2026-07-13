import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select

from app.auth.jwt import _sync_ggoo_user
from app.db.models import Project, User
from app.integrations.ggoo import GGOOClient, GGOOError, GGOORemoteUser
from app.main import app


client = TestClient(app)


def test_ggoo_login_binds_existing_build_user_and_preserves_projects(db_session, monkeypatch):
    async def seed() -> tuple[str, str]:
        async with db_session() as session:
            user = User(email="owner@example.com", hashed_password="legacy")
            session.add(user)
            await session.flush()
            project = Project(user_id=user.id, name="原有项目")
            session.add(project)
            await session.commit()
            return user.id, project.id

    user_id, project_id = asyncio.run(seed())
    monkeypatch.setenv("BUILD_LEGACY_AUTH_ENABLED", "false")

    async def fake_verify(_token: str) -> GGOORemoteUser:
        return GGOORemoteUser(
            id=101,
            uuid="ggoo-user-uuid",
            email="owner@example.com",
            nickname="Owner",
        )

    monkeypatch.setattr("app.auth.jwt.ggoo_client.verify_user", fake_verify)
    response = client.get("/auth/me", headers={"Authorization": "Bearer real-ggoo-token"})
    assert response.status_code == 200
    assert response.json()["id"] == user_id

    async def inspect() -> tuple[User, Project]:
        async with db_session() as session:
            user = await session.get(User, user_id)
            project = await session.get(Project, project_id)
            assert user is not None and project is not None
            return user, project

    user, project = asyncio.run(inspect())
    assert user.ggoo_user_id == 101
    assert user.ggoo_uuid == "ggoo-user-uuid"
    assert project.user_id == user_id


def test_ggoo_user_sync_recovers_when_another_request_creates_the_mapping():
    remote = GGOORemoteUser(
        id=202,
        uuid="concurrent-ggoo-user",
        email="concurrent@example.com",
        nickname="Concurrent",
    )
    winner = User(
        email="concurrent@example.com",
        hashed_password="!ggoo-sso-only",
        ggoo_user_id=remote.id,
        ggoo_uuid=remote.uuid,
    )
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=[None, None, None, None, winner])
    session.commit = AsyncMock(
        side_effect=IntegrityError("insert user", {}, RuntimeError("unique constraint"))
    )
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()

    result = asyncio.run(_sync_ggoo_user(session, remote))

    assert result is winner
    session.rollback.assert_awaited_once()
    session.refresh.assert_awaited_once_with(winner)


def test_ggoo_client_creates_user_key_and_bills_chat_through_gateway():
    requests: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path.endswith("/active-key"):
            return httpx.Response(200, json={"code": 200, "data": {"key": None}})
        if request.url.path.endswith("/platform/api-keys"):
            body = json.loads(request.content)
            assert body["name"] == "Build GGOO AI"
            return httpx.Response(200, json={"code": 200, "data": {"key": "sk-user-metered"}})
        if request.url.path.endswith("/chat/completions"):
            assert request.headers["Authorization"] == "Bearer sk-user-metered"
            body = json.loads(request.content)
            assert body["model"] == "auto"
            return httpx.Response(200, json={"choices": [{"message": {"content": "完成"}}]})
        raise AssertionError(request.url)

    async def run() -> str:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        integration = GGOOClient(http_client)
        llm = await integration.make_llm_client("ggoo-jwt")
        result = await llm.complete("system", "prompt")
        await http_client.aclose()
        return result

    assert asyncio.run(run()) == "完成"
    assert requests == [
        ("GET", "/api/v1/platform/api-keys/active-key"),
        ("POST", "/api/v1/platform/api-keys"),
        ("POST", "/v1/chat/completions"),
    ]


def test_ggoo_gateway_surfaces_insufficient_credits():
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/active-key"):
            return httpx.Response(200, json={"code": 200, "data": {"key": "sk-user"}})
        return httpx.Response(402, json={"error": {"message": "insufficient balance"}})

    async def run() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        integration = GGOOClient(http_client)
        llm = await integration.make_llm_client("ggoo-jwt")
        try:
            await llm.complete("system", "prompt")
        except GGOOError as exc:
            assert exc.status_code == 402
            assert "积分不足" in str(exc)
        else:
            raise AssertionError("insufficient credits should fail")
        await http_client.aclose()

    asyncio.run(run())
