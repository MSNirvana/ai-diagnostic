"""项目（持续诊断档案）端点测试。"""
import json
import io

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


class ArchiveExtractLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "summary": "材料里已经明确了目标客群与渠道结构，适合先沉淀进市场与客户档案。",
            "highlights": [
                {"label": "目标客群", "value": "加盟创业者和三四线餐饮门店老板是当前重点目标。"},
                {"label": "渠道结构", "value": "当前获客依赖短视频内容、招商页承接与线索回访。"},
            ],
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
    assert detail["records"][0]["has_war_room_plan"] is False
    assert len(detail["memory_entries"]) >= 2
    assert detail["memory_entries"][0]["entry_type"] in {"problem_map", "diagnosis"}
    assert any(e["entry_type"] == "problem_map" for e in detail["memory_entries"])
    assert any(e["entry_type"] == "diagnosis" for e in detail["memory_entries"])
    assert any("降本" in e["summary"] for e in detail["memory_entries"])
    diagnosis_entry = next(e for e in detail["memory_entries"] if e["entry_type"] == "diagnosis")
    assert "获客成本过高是核心问题。" in diagnosis_entry["summary"]
    assert "建议：降本。" in diagnosis_entry["summary"]
    assert detail["war_room_plan"] is None
    assert detail["delivery_status"]["approved_count"] == 0
    assert detail["delivery_status"]["pending_review_count"] == 1
    assert detail["delivery_status"]["state"] == "pending_review"


def test_project_war_room_is_hidden_until_consultant_approval(db_session):
    from app.config import get_llm_client

    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("project-war-room-gate@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "审核门控"}, headers=auth).json()["id"]

    diagnosis = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "project_id": pid,
            "problem_map": {"diagnosis_focus": "market", "goal": "降低获客成本"},
        },
        headers=auth,
    ).json()
    record_id = diagnosis["record_id"]
    app.dependency_overrides.pop(get_llm_client, None)

    detail = client.get(f"/project/{pid}", headers=auth).json()
    assert detail["war_room_plan"] is None
    assert detail["delivery_status"]["state"] == "pending_review"

    gated = client.get(f"/project/{pid}/war-room", headers=auth)
    assert gated.status_code == 403
    assert "顾问审核" in gated.json()["detail"]

    approved = client.post(
        f"/admin/review/{record_id}",
        json={"action": "approve", "notes": ["审核通过，可以交付"], "reviewer": "顾问A"},
    )
    assert approved.status_code == 200

    detail_after = client.get(f"/project/{pid}", headers=auth).json()
    assert detail_after["delivery_status"]["state"] == "approved"
    assert detail_after["war_room_plan"]["project_id"] == pid
    assert detail_after["war_room_plan"]["iteration_count"] == 1
    assert detail_after["war_room_plan"]["source_record_ids"] == [record_id]

    project_plan = client.get(f"/project/{pid}/war-room", headers=auth)
    assert project_plan.status_code == 200
    assert project_plan.json()["source_record_ids"] == [record_id]


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

    assert first["war_room_plan"]["iteration_count"] == 0
    assert first["war_room_plan"]["accumulation_note"] == ""
    assert second["war_room_plan"]["iteration_count"] == 0
    assert second["war_room_plan"]["accumulation_note"] == ""
    assert second["war_room_plan"]["source_record_ids"] == []
    assert second["war_room_plan"]["record_id"] == second["record_id"]
    assert second["war_room_plan"]["iterations"] == []

    client.post(
        f"/admin/review/{first['record_id']}",
        json={"action": "approve", "reviewer": "顾问A"},
    )
    client.post(
        f"/admin/review/{second['record_id']}",
        json={"action": "approve", "reviewer": "顾问A"},
    )

    project_plan = client.get(f"/project/{pid}/war-room", headers=auth).json()
    assert project_plan["iteration_count"] == 2
    assert project_plan["source_record_ids"] == [first["record_id"], second["record_id"]]
    assert "此前 1 次诊断" in project_plan["accumulation_note"]
    assert "条沉淀" in project_plan["accumulation_note"]


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

    assert detail["records"][0]["has_war_room_plan"] is False
    assert detail["delivery_status"]["state"] == "pending_review"


def test_approved_legacy_project_record_is_exposed_as_war_room_capable(db_session):
    import asyncio
    from sqlalchemy import select
    from app.db.models import DiagnosisRecord, User

    token = _register("approved-legacy-project-record@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "已审核历史项目"}, headers=auth).json()["id"]

    async def seed_record() -> None:
        async with db_session() as session:
            user = (
                await session.scalars(
                    select(User).where(User.email == "approved-legacy-project-record@b.com")
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
                    review_status="approved",
                )
            )
            await session.commit()

    asyncio.get_event_loop().run_until_complete(seed_record())
    detail = client.get(f"/project/{pid}", headers=auth).json()

    assert detail["records"][0]["has_war_room_plan"] is True
    assert detail["delivery_status"]["state"] == "approved"
    assert detail["war_room_plan"]["project_id"] == pid


def test_archive_file_extraction_requires_confirm_before_updating_archive(db_session):
    token = _register("archive-extract@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "档案沉淀测试"}, headers=auth).json()["id"]
    sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]

    upload = client.post(
        f"/session/{sid}/files",
        data={"module_key": "market", "field_key": "archive_upload"},
        files={"file": ("渠道调研纪要.txt", io.BytesIO("目标客群：加盟创业者；渠道：短视频+招商页".encode("utf-8")), "text/plain")},
        headers=auth,
    )
    assert upload.status_code == 201
    file_id = upload.json()["id"]

    detail_before = client.get(f"/project/{pid}", headers=auth).json()
    market_before = next(module for module in detail_before["archive"]["modules"] if module["module"] == "market")
    assert all(fact["label"] != "目标客群" for fact in market_before["facts"])

    app.dependency_overrides[get_llm_client] = lambda: ArchiveExtractLLM()
    preview = client.post(f"/project/{pid}/archive/files/{file_id}/extract", headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)
    assert preview.status_code == 200
    assert preview.json()["status"] == "pending_confirm"
    assert preview.json()["highlights"][0]["label"] == "目标客群"

    detail_pending = client.get(f"/project/{pid}", headers=auth).json()
    pending_file = next(file for file in detail_pending["archive"]["files"] if file["id"] == file_id)
    assert pending_file["extraction_status"] == "pending_confirm"
    market_pending = next(module for module in detail_pending["archive"]["modules"] if module["module"] == "market")
    assert all(fact["label"] != "目标客群" for fact in market_pending["facts"])

    confirmed = client.post(
        f"/project/{pid}/archive/files/{file_id}/confirm",
        json={
            "summary": "这份资料补齐了市场与客户的目标客群与渠道结构。",
            "highlights": [
                {"label": "目标客群", "value": "加盟创业者和三四线餐饮门店老板是当前重点目标。"},
                {"label": "渠道结构", "value": "当前获客依赖短视频内容、招商页承接与线索回访。"},
            ],
        },
        headers=auth,
    )
    assert confirmed.status_code == 200
    market_after = next(module for module in confirmed.json()["modules"] if module["module"] == "market")
    assert any(fact["label"] == "目标客群" for fact in market_after["facts"])

    detail_after = client.get(f"/project/{pid}", headers=auth).json()
    confirmed_file = next(file for file in detail_after["archive"]["files"] if file["id"] == file_id)
    assert confirmed_file["extraction_status"] == "confirmed"
    archive_entries = [entry for entry in detail_after["memory_entries"] if entry["entry_type"] == "archive_file_extract"]
    assert archive_entries
    assert "渠道调研纪要" in archive_entries[0]["summary"]

    deleted = client.delete(f"/files/{file_id}", headers=auth)
    assert deleted.status_code == 204

    detail_after_delete = client.get(f"/project/{pid}", headers=auth).json()
    assert all(file["id"] != file_id for file in detail_after_delete["archive"]["files"])
    market_after_delete = next(module for module in detail_after_delete["archive"]["modules"] if module["module"] == "market")
    assert any(
        fact["label"] == "目标客群"
        and fact["value"] == "加盟创业者和三四线餐饮门店老板是当前重点目标。"
        for fact in market_after_delete["facts"]
    )


def test_add_archive_module_persists_custom_project_domain(db_session):
    token = _register("archive-module@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "动态经营域"}, headers=auth).json()["id"]

    before = client.get(f"/project/{pid}", headers=auth).json()
    assert "legal_compliance" not in {module["module"] for module in before["archive"]["modules"]}

    added = client.post(
        f"/project/{pid}/archive/modules",
        json={"module": "legal_compliance", "label": "法务合规"},
        headers=auth,
    )
    assert added.status_code == 200
    modules = {module["module"]: module for module in added.json()["modules"]}
    assert [module["module"] for module in added.json()["modules"][:3]] == ["market", "product", "sales"]
    assert modules["legal_compliance"]["label"] == "法务合规"
    assert modules["legal_compliance"]["has_data"] is False

    detail = client.get(f"/project/{pid}", headers=auth).json()
    assert [module["module"] for module in detail["archive"]["modules"][:3]] == ["market", "product", "sales"]
    assert "legal_compliance" in {module["module"] for module in detail["archive"]["modules"]}
    assert all(option["module"] != "legal_compliance" for option in detail["archive"]["recommended_modules"])


def test_hide_archive_module_only_affects_project_archive_visibility(db_session):
    token = _register("archive-module-hide@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "隐藏经营域"}, headers=auth).json()["id"]

    hidden = client.delete(f"/project/{pid}/archive/modules/product", headers=auth)
    assert hidden.status_code == 200
    hidden_body = hidden.json()
    assert "product" not in {module["module"] for module in hidden_body["modules"]}
    assert "product" in {module["module"] for module in hidden_body["hidden_modules"]}
    assert "product" not in {module["module"] for module in hidden_body["recommended_modules"]}

    restored = client.post(
        f"/project/{pid}/archive/modules",
        json={"module": "product", "label": "产品与服务"},
        headers=auth,
    )
    assert restored.status_code == 200
    restored_body = restored.json()
    assert "product" in {module["module"] for module in restored_body["modules"]}
    assert restored_body["hidden_modules"] == []


def test_archive_file_extraction_uses_active_archive_skill(db_session):
    token = _register("archive-skill@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "档案 Skill 测试"}, headers=auth).json()["id"]
    sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]

    upload = client.post(
        f"/session/{sid}/files",
        data={"module_key": "market", "field_key": "archive_upload"},
        files={
            "file": (
                "内部立项介绍报告.txt",
                io.BytesIO("内部立项介绍报告，Eric撰写、Juniper参与线上会谈、Gavin审阅。".encode("utf-8")),
                "text/plain",
            )
        },
        headers=auth,
    )
    assert upload.status_code == 201
    file_id = upload.json()["id"]

    skill_resp = client.post(
        "/admin/skills/archive_extraction/versions",
        json={
            "system_prompt": "资料沉淀 Skill：必须抓取报告性质、撰写人、参与人、审阅人。",
            "method": "archive_extraction",
            "skill_type": "delivery",
            "change_reason": "测试资料沉淀 Skill 可迭代",
            "activate": True,
        },
    )
    assert skill_resp.status_code == 201

    class PromptCheckingLLM:
        async def complete(self, system: str, prompt: str) -> str:
            assert "资料沉淀 Skill" in system
            assert "内部立项介绍报告" in prompt
            return json.dumps({
                "summary": "沉淀了报告性质与参与人关系。",
                "highlights": [
                    {"label": "报告性质", "value": "内部立项介绍报告"},
                    {"label": "撰写人", "value": "Eric"},
                    {"label": "参与人", "value": "Juniper参与线上会谈"},
                    {"label": "审阅人", "value": "Gavin"},
                ],
            }, ensure_ascii=False)

    app.dependency_overrides[get_llm_client] = lambda: PromptCheckingLLM()
    preview = client.post(f"/project/{pid}/archive/files/{file_id}/extract", headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)

    assert preview.status_code == 200
    labels = [item["label"] for item in preview.json()["highlights"]]
    assert labels == ["报告性质", "撰写人", "参与人", "审阅人"]
