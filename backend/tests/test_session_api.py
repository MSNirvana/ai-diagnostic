"""诊断会话（记忆文件）端点测试：创建、对话落库、列表、详情、续聊。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)


class IntakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "phase": "intake", "done": False,
            "message": "这个问题持续多久了？",
            "problem_map": None,
        }, ensure_ascii=False)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_session_start_and_chat_persists(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("sess@b.com")
    auth = {"Authorization": f"Bearer {token}"}

    sid = client.post("/session/start", headers=auth).json()["session_id"]
    assert sid

    # 聊一轮
    r = client.post(
        f"/session/{sid}/chat",
        json={"message": "获客越来越贵"},
        headers=auth,
    ).json()
    assert r["phase"] == "intake"

    # 详情里能看到完整对话历史（user + assistant 各一条）
    detail = client.get(f"/session/{sid}", headers=auth).json()
    assert len(detail["messages"]) == 2
    assert detail["messages"][0]["content"] == "获客越来越贵"
    assert detail["messages"][1]["role"] == "assistant"

    app.dependency_overrides.pop(get_llm_client, None)


def test_session_list_hides_empty_click_only_sessions(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("sesslist@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    empty_sid = client.post("/session/start", headers=auth).json()["session_id"]
    active_sid = client.post("/session/start", headers=auth).json()["session_id"]
    client.post(
        f"/session/{active_sid}/chat",
        json={"message": "获客成本越来越高"},
        headers=auth,
    )

    rows = client.get("/session/", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    assert [r["id"] for r in rows] == [active_sid]
    assert empty_sid not in [r["id"] for r in rows]


def test_session_list_keeps_draft_progress(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("sessdraftlist@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    client.post("/session/start", headers=auth)
    draft_sid = client.post("/session/start", headers=auth).json()["session_id"]
    client.patch(
        f"/session/{draft_sid}/draft",
        json={"draft_json": '{"current":1}'},
        headers=auth,
    )

    rows = client.get("/session/", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    assert [r["id"] for r in rows] == [draft_sid]


def test_session_continue_appends_history(db_session):
    """续聊：基于已有历史再聊一轮，历史累积。"""
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("sesscont@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    sid = client.post("/session/start", headers=auth).json()["session_id"]

    client.post(f"/session/{sid}/chat", json={"message": "第一句"}, headers=auth)
    client.post(f"/session/{sid}/chat", json={"message": "第二句"}, headers=auth)

    detail = client.get(f"/session/{sid}", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    # 两轮 = 4 条消息（2 user + 2 assistant）
    assert len(detail["messages"]) == 4
    assert detail["messages"][2]["content"] == "第二句"


def test_session_draft_save_and_load(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("draft@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    sid = client.post("/session/start", headers=auth).json()["session_id"]

    # 存填写进度
    draft = '{"current":2,"facts":{"market":{"客单价":"420"}},"pains":{},"freeText":{}}'
    r = client.patch(f"/session/{sid}/draft", json={"draft_json": draft}, headers=auth)
    assert r.status_code == 204

    # 读回来：draft_json 在，status 变 filling
    detail = client.get(f"/session/{sid}", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    assert detail["draft_json"] == draft
    assert detail["status"] == "filling"
    assert "客单价" in detail["draft_json"]
