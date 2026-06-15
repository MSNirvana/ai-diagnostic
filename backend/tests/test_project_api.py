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


def test_project_detail_hides_empty_click_only_sessions(db_session):
    app.dependency_overrides[get_llm_client] = lambda: IntakeLLM()
    token = _register("proj-empty-session@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "空会话过滤"}, headers=auth).json()["id"]

    empty_sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]
    active_sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]
    client.post(f"/session/{active_sid}/chat", json={"message": "获客太贵"}, headers=auth)

    detail = client.get(f"/project/{pid}", headers=auth).json()
    app.dependency_overrides.pop(get_llm_client, None)
    session_ids = [s["id"] for s in detail["sessions"]]
    assert session_ids == [active_sid]
    assert empty_sid not in session_ids


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
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "project_id": pid,
            "problem_map": {
                "core_problem": "获客成本过高",
                "goal": "把 CAC 降下来",
                "diagnosis_focus": "market",
            },
        },
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)

    detail = client.get(f"/project/{pid}", headers=auth).json()
    # 项目记忆已沉淀本次诊断核心结论
    assert detail["memory_summary"].strip() != ""
    assert "market" in detail["memory_summary"]
    # 诊断记录也挂到了项目下
    assert len(detail["records"]) == 1
    assert detail["records"][0]["has_war_room_plan"] is True
    assert len(detail["memory_entries"]) >= 2
    assert detail["memory_entries"][0]["entry_type"] in {"problem_map", "diagnosis"}
    assert any(e["entry_type"] == "problem_map" for e in detail["memory_entries"])
    assert any(e["entry_type"] == "diagnosis" for e in detail["memory_entries"])
    assert any("降本" in e["summary"] for e in detail["memory_entries"])
    diagnosis_entry = next(e for e in detail["memory_entries"] if e["entry_type"] == "diagnosis")
    assert "获客成本过高是核心问题。" in diagnosis_entry["summary"]
    assert "建议：降本。" in diagnosis_entry["summary"]
    assert detail["war_room_plan"]["project_id"] == pid
    assert detail["war_room_plan"]["iteration_count"] == 1
    assert detail["war_room_plan"]["source_record_ids"] == [detail["records"][0]["id"]]
    assert detail["war_room_plan"]["iterations"][0]["changes"] == ["建立项目作战室"]


def test_project_war_room_is_one_project_state_with_iterations(db_session):
    from app.config import get_llm_client

    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("project-war-room-iterations@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "项目级作战室"}, headers=auth).json()["id"]

    first = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "project_id": pid,
            "problem_map": {"diagnosis_focus": "market", "goal": "降低获客成本"},
        },
        headers=auth,
    ).json()
    second = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "sales", "facts": {}, "pains": ["成交慢"]}],
            "project_id": pid,
            "problem_map": {"diagnosis_focus": "sales", "goal": "提升成交效率"},
        },
        headers=auth,
    ).json()
    app.dependency_overrides.pop(get_llm_client, None)

    assert first["war_room_plan"]["iteration_count"] == 1
    assert second["war_room_plan"]["iteration_count"] == 2
    assert second["war_room_plan"]["source_record_ids"] == [
        first["record_id"],
        second["record_id"],
    ]
    assert second["war_room_plan"]["record_id"] == second["record_id"]
    assert len(second["war_room_plan"]["iterations"]) == 2

    project_plan = client.get(f"/project/{pid}/war-room", headers=auth).json()
    assert project_plan["id"] == second["war_room_plan"]["id"]
    assert project_plan["iteration_count"] == 2
    assert project_plan["source_record_ids"] == [first["record_id"], second["record_id"]]


def test_feedback_writes_project_memory(db_session):
    from app.config import get_llm_client
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("fbmem@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "反馈记忆"}, headers=auth).json()["id"]

    diagnose = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}], "project_id": pid},
        headers=auth,
    ).json()
    rec_id = diagnose["record_id"]
    skill_version_id = diagnose["skill_version_ids"]["market"]

    resp = client.post(
        f"/diagnose/{rec_id}/feedback",
        json={
            "module": "market",
            "skill_version_id": skill_version_id,
            "rating": 2,
            "is_useful": False,
            "comment": "建议太泛，需要给出渠道拆解。",
        },
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 201

    detail = client.get(f"/project/{pid}", headers=auth).json()
    feedback_entries = [e for e in detail["memory_entries"] if e["entry_type"] == "feedback"]
    assert feedback_entries
    assert "建议太泛" in feedback_entries[0]["summary"]
    assert "。；" not in feedback_entries[0]["summary"]
    assert feedback_entries[0]["summary"].endswith("。")


def test_legacy_project_record_is_exposed_as_war_room_capable(db_session):
    import asyncio
    from sqlalchemy import select
    from app.db.models import DiagnosisRecord, User

    token = _register("legacy-project-record@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "历史项目"}, headers=auth).json()["id"]

    async def seed_record() -> None:
        async with db_session() as session:
            user = (
                await session.scalars(
                    select(User).where(User.email == "legacy-project-record@b.com")
                )
            ).one()
            session.add(
                DiagnosisRecord(
                    user_id=user.id,
                    project_id=pid,
                    answers_json=json.dumps(
                        {"answers": [{"module": "market", "facts": {}, "pains": []}]}
                    ),
                    results_json=json.dumps(
                        [
                            {
                                "module": "market",
                                "signal": "yellow",
                                "conclusion": "渠道效率需要改善",
                                "evidence": [],
                                "actions": ["清理低效渠道"],
                                "drilldown": None,
                                "evidence_package": None,
                                "data_requests": [],
                            }
                        ],
                        ensure_ascii=False,
                    ),
                    war_room_plan_json=None,
                )
            )
            await session.commit()

    asyncio.get_event_loop().run_until_complete(seed_record())
    detail = client.get(f"/project/{pid}", headers=auth).json()

    assert detail["records"][0]["has_war_room_plan"] is True
