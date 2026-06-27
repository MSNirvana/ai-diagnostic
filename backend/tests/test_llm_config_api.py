"""LLM 配置 CRUD 端点测试（含 key 脱敏）。"""
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.main import app

client = TestClient(app)


def test_create_list_config_masks_key(db_session):
    resp = client.post("/admin/llm-configs/", json={
        "name": "主力", "provider": "anthropic", "model": "claude-opus-4-8",
        "api_key": "sk-secret-1234", "base_url": "https://x.com", "priority": 0,
    })
    assert resp.status_code == 201
    body = resp.json()
    # key 脱敏，不回明文
    assert body["api_key_masked"] == "****1234"
    assert "sk-secret" not in str(body)

    rows = client.get("/admin/llm-configs/").json()
    assert len(rows) == 1
    assert rows[0]["name"] == "主力"
    assert rows[0]["runtime_status"] == "unknown"
    assert rows[0]["cooldown_remaining_seconds"] == 0


def test_patch_config(db_session):
    cid = client.post("/admin/llm-configs/", json={
        "name": "旧", "provider": "openai", "model": "gpt-4o", "api_key": "k1234",
    }).json()["id"]
    resp = client.patch(f"/admin/llm-configs/{cid}", json={"name": "新", "priority": 2})
    assert resp.status_code == 200
    assert resp.json()["name"] == "新"
    assert resp.json()["priority"] == 2


def test_patch_config_blank_key_keeps_existing_key(db_session):
    cid = client.post("/admin/llm-configs/", json={
        "name": "主力", "provider": "openai", "model": "gpt-4o", "api_key": "old-secret-1234",
    }).json()["id"]

    blank = client.patch(f"/admin/llm-configs/{cid}", json={"api_key": "", "model": "gpt-5"})
    assert blank.status_code == 200
    assert blank.json()["model"] == "gpt-5"
    assert blank.json()["api_key_masked"] == "****1234"

    replaced = client.patch(f"/admin/llm-configs/{cid}", json={"api_key": "new-secret-5678"})
    assert replaced.status_code == 200
    assert replaced.json()["api_key_masked"] == "****5678"


def test_delete_config(db_session):
    cid = client.post("/admin/llm-configs/", json={
        "name": "待删", "provider": "openai", "model": "gpt-4o", "api_key": "k1234",
    }).json()["id"]
    assert client.delete(f"/admin/llm-configs/{cid}").status_code == 204
    assert len(client.get("/admin/llm-configs/").json()) == 0


def test_db_config_drives_get_llm_client(db_session):
    """配置写库后，get_llm_client 应按 DB 配置构建（按 priority）。"""
    import asyncio
    from app.config import get_llm_client
    from app.llm.fallback import FallbackLLMClient

    client.post("/admin/llm-configs/", json={
        "name": "主", "provider": "anthropic", "model": "claude-opus-4-8",
        "api_key": "k1", "priority": 0,
    })
    client.post("/admin/llm-configs/", json={
        "name": "备", "provider": "openai", "model": "gpt-4o",
        "api_key": "k2", "priority": 1,
    })

    async def build():
        async with db_session() as s:
            return await get_llm_client(s)

    llm = asyncio.get_event_loop().run_until_complete(build())
    # 两条配置 → 包成 FallbackLLMClient
    assert isinstance(llm, FallbackLLMClient)


def test_probe_config_returns_runtime_result(db_session):
    cid = client.post("/admin/llm-configs/", json={
        "name": "探针", "provider": "openai", "model": "gpt-5.5", "api_key": "k1234",
        "base_url": "https://api.example.com", "priority": 0,
    }).json()["id"]

    fake_client = AsyncMock()
    fake_client.complete = AsyncMock(return_value="OK")

    with patch("app.api.admin_llm.make_llm_client", return_value=fake_client):
        resp = client.post(f"/admin/llm-configs/{cid}/probe")

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "连通成功" in body["message"]
    assert body["config"]["id"] == cid
