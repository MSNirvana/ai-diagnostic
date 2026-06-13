"""项目（持续诊断档案）端点测试。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)


class IntakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "phase": "intake", "done": False,
            "message": "持续多久了？", "problem_map": None,
        }, ensure_ascii=False)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_create_and_list_project(db_session):
    token = _register("proj@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    r = client.post("/project/", json={"name": "星麦直播"}, headers=auth)
    assert r.status_code == 201
    assert r.json()["name"] == "星麦直播"

    rows = client.get("/project/", headers=auth).json()
    assert len(rows) == 1
    assert rows[0]["name"] == "星麦直播"


def test_project_detail_aggregates_sessions(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("proj2@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "铁山钢铁"}, headers=auth).json()["id"]

    # 在项目下开会话并聊一轮
    sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]
    client.post(f"/session/{sid}/chat", json={"message": "成本太高"}, headers=auth)

    detail = client.get(f"/project/{pid}", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    assert detail["name"] == "铁山钢铁"
    assert len(detail["sessions"]) == 1


def test_patch_project_rename(db_session):
    token = _register("proj3@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "旧名"}, headers=auth).json()["id"]
    r = client.patch(f"/project/{pid}", json={"name": "新名"}, headers=auth)
    assert r.status_code == 200
    assert r.json()["name"] == "新名"


def test_project_isolated_between_users(db_session):
    token_a = _register("pa@b.com")
    pid = client.post(
        "/project/", json={"name": "A的项目"},
        headers={"Authorization": f"Bearer {token_a}"},
    ).json()["id"]
    token_b = _register("pb@b.com")
    r = client.get(f"/project/{pid}", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 404


class DiagLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red", "conclusion": "获客成本过高是核心问题",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["降本"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


def test_diagnosis_writes_project_memory(db_session):
    from app.config import get_llm_client
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("mem@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "记忆测试"}, headers=auth).json()["id"]

    # 在项目下诊断
    client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}], "project_id": pid},
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)

    detail = client.get(f"/project/{pid}", headers=auth).json()
    # 项目记忆已沉淀本次诊断核心结论
    assert detail["memory_summary"].strip() != ""
    assert "market" in detail["memory_summary"]
    # 诊断记录也挂到了项目下
    assert len(detail["records"]) == 1
