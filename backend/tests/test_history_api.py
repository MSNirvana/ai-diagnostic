"""历史记录端点：列表、详情、权限隔离。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "green",
            "conclusion": "正常",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["继续"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _diagnose(token: str) -> None:
    client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {"a": "b"}, "pains": ["x"]}]},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_history_requires_auth(db_session):
    resp = client.get("/history/")
    assert resp.status_code == 422  # 缺 Authorization header


def test_history_lists_own_records(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("owner@b.com")
    _diagnose(token)
    _diagnose(token)
    resp = client.get("/history/", headers={"Authorization": f"Bearer {token}"})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["module_count"] == 1


def test_history_detail_returns_full_record(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("detail@b.com")
    _diagnose(token)
    list_resp = client.get("/history/", headers={"Authorization": f"Bearer {token}"})
    record_id = list_resp.json()[0]["id"]
    resp = client.get(
        f"/history/{record_id}", headers={"Authorization": f"Bearer {token}"}
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["answers"]["answers"][0]["module"] == "market"
    assert body["results"][0]["module"] == "market"


def test_history_detail_blocks_other_user(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token_a = _register("usera@b.com")
    _diagnose(token_a)
    record_id = client.get(
        "/history/", headers={"Authorization": f"Bearer {token_a}"}
    ).json()[0]["id"]
    token_b = _register("userb@b.com")
    resp = client.get(
        f"/history/{record_id}", headers={"Authorization": f"Bearer {token_b}"}
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 404  # B 看不到 A 的记录
