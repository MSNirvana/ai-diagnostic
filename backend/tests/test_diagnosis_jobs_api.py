"""深度尽调 Job API：创建任务、后台执行、进入审核队列。"""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import get_llm_client
from app.main import app
from app.research.models import ResearchEvidenceItem
from app.research.jobs import run_deep_diligence_job

client = TestClient(app)


@pytest.fixture(autouse=True)
def _disable_api_background_job(monkeypatch):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr("app.api.diagnosis_jobs.run_deep_diligence_job", _noop)


class DiagLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "获客成本过高是核心问题",
            "evidence": [{"text": "外部预研不足，先按用户数据保守判断", "source": "用户提交数据"}],
            "actions": ["补齐渠道花费与转化数据"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


class FollowUpLLM:
    def __init__(self):
        self.expert_calls = 0

    async def complete(self, system: str, prompt: str) -> str:
        if "external_research_evidence" not in prompt:
            return json.dumps({"metrics": [], "summary": "测试基准"}, ensure_ascii=False)
        self.expert_calls += 1
        if self.expert_calls == 1:
            return json.dumps({
                "signal": "yellow",
                "conclusion": "招商获客判断缺少公开竞品和政策证据",
                "evidence": [{"text": "现有资料不足", "source": "系统预研"}],
                "actions": ["补充竞品招商与政策约束"],
                "research_questions": ["电火灶 招商加盟 回本周期 政策 风险"],
            }, ensure_ascii=False)
        return json.dumps({
            "signal": "red",
            "conclusion": "竞品招商回本承诺和政策资质约束需要优先核验",
            "evidence": [{"text": "公开招商页强调回本周期但来源差异大", "source": "https://example.com/franchise"}],
            "actions": ["先核验招商承诺、资质边界和投放口径"],
        }, ensure_ascii=False)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_create_deep_diligence_job_runs_to_pending_review(db_session, monkeypatch):
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("deep-job@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "深度尽调任务"}, headers=auth).json()["id"]

    created = client.post(
        "/diagnosis-jobs/",
        json={
            "answers": [{"module": "market", "facts": {"行业": "新能源厨电"}, "pains": ["获客贵"]}],
            "project_id": pid,
            "problem_map": {
                "industry": "新能源厨电",
                "main_business": "电火灶招商",
                "core_problem": "招商获客成本高",
                "diagnosis_focus": "market",
            },
        },
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)

    assert created.status_code == 202
    job_id = created.json()["job_id"]
    import asyncio
    asyncio.get_event_loop().run_until_complete(run_deep_diligence_job(job_id, db_session, DiagLLM()))
    status = client.get(f"/diagnosis-jobs/{job_id}", headers=auth).json()
    assert status["status"] == "pending_review", status
    assert status["record_id"]
    assert status["progress"] == 1

    detail = client.get(f"/project/{pid}", headers=auth).json()
    assert detail["delivery_status"]["state"] == "pending_review"
    assert detail["war_room_plan"] is None


def test_get_latest_diagnosis_job_by_session(db_session):
    token = _register("deep-session-latest@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "会话任务绑定"}, headers=auth).json()["id"]
    sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]

    created = client.post(
        "/diagnosis-jobs/",
        json={
            "session_id": sid,
            "project_id": pid,
            "answers": [{"module": "market", "facts": {"核心问题": "获客成本高"}, "pains": []}],
            "problem_map": {"core_problem": "获客成本高", "diagnosis_focus": "market"},
        },
        headers=auth,
    )
    assert created.status_code == 202

    latest = client.get(f"/diagnosis-jobs/session/{sid}/latest", headers=auth)
    assert latest.status_code == 200
    assert latest.json()["id"] == created.json()["job_id"]
    assert latest.json()["project_id"] == pid


def test_job_runs_expert_supplemental_research_and_exposes_review_evidence(db_session, monkeypatch):
    monkeypatch.setattr("app.research.engine.run_system_pre_research", _fake_system_research)
    monkeypatch.setattr("app.research.supplement.run_expert_supplemental_research", _fake_supplemental_research)
    token = _register("deep-supplement@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "电火灶尽调"}, headers=auth).json()["id"]

    created = client.post(
        "/diagnosis-jobs/",
        json={
            "answers": [{"module": "market", "facts": {"行业": "新能源厨电"}, "pains": ["招商获客成本高"]}],
            "project_id": pid,
            "problem_map": {
                "industry": "新能源厨电",
                "main_business": "电火灶招商",
                "core_problem": "招商转化差且合规不确定",
                "diagnosis_focus": "market",
            },
        },
        headers=auth,
    )
    job_id = created.json()["job_id"]

    import asyncio
    llm = FollowUpLLM()
    asyncio.get_event_loop().run_until_complete(run_deep_diligence_job(job_id, db_session, llm))

    evidence = client.get(f"/diagnosis-jobs/{job_id}/evidence", headers=auth).json()
    assert any(row["source_stage"] == "expert_supplemental_research" for row in evidence)
    assert any(row["url"] == "https://example.com/franchise" for row in evidence)
    project_evidence = client.get(f"/project/{pid}/evidence", headers=auth).json()
    assert any(row["url"] == "https://example.com/franchise" for row in project_evidence)

    status = client.get(f"/diagnosis-jobs/{job_id}", headers=auth).json()
    detail = client.get(f"/admin/review/{status['record_id']}", headers=auth).json()
    assert detail["evidence_pack"][0]["source_stage"] == "expert_supplemental_research"
    assert detail["evidence_pack"][0]["record_id"] == status["record_id"]
    assert detail["results"][0]["conclusion"] == "竞品招商回本承诺和政策资质约束需要优先核验"


def test_deep_diligence_full_delivery_flow(db_session, monkeypatch):
    monkeypatch.setattr("app.research.engine.run_system_pre_research", _fake_system_research)
    monkeypatch.setattr("app.research.supplement.run_expert_supplemental_research", _fake_supplemental_research)
    token = _register("deep-full-flow@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    pid = client.post("/project/", json={"name": "电火灶全链路测试"}, headers=auth).json()["id"]
    sid = client.post("/session/start", json={"project_id": pid}, headers=auth).json()["session_id"]

    created = client.post(
        "/diagnosis-jobs/",
        json={
            "session_id": sid,
            "project_id": pid,
            "problem_map": {
                "company_name": "华火新能源",
                "industry": "新能源厨电",
                "main_business": "电火灶招商与渠道拓展",
                "core_problem": "招商转化差且回本承诺、合规资质都需要核验",
                "diagnosis_focus": "market",
            },
            "answers": [
                {
                    "module": "market",
                    "facts": {
                        "行业": "新能源厨电",
                        "推广账号": "抖音企业号与招商落地页",
                        "招商线索": "近 30 天 420 条，成交质量不稳定",
                    },
                    "pains": ["招商获客成本高", "代理回本口径难验证"],
                }
            ],
        },
        headers=auth,
    )
    assert created.status_code == 202
    job_id = created.json()["job_id"]

    import asyncio
    llm = FollowUpLLM()
    asyncio.get_event_loop().run_until_complete(run_deep_diligence_job(job_id, db_session, llm))

    status = client.get(f"/diagnosis-jobs/{job_id}", headers=auth).json()
    assert status["status"] == "pending_review"
    assert status["current_step"] == "顾问审核中"
    assert status["record_id"]
    assert status["result_summary"]["research_evidence_count"] == 2

    job_evidence = client.get(f"/diagnosis-jobs/{job_id}/evidence", headers=auth).json()
    assert {row["source_stage"] for row in job_evidence} == {
        "system_pre_research",
        "expert_supplemental_research",
    }
    assert any(row["url"] == "https://example.com/franchise" for row in job_evidence)

    project_before = client.get(f"/project/{pid}", headers=auth).json()
    assert project_before["delivery_status"]["state"] == "pending_review"
    assert project_before["war_room_plan"] is None
    assert project_before["sessions"][0]["id"] == sid
    assert project_before["sessions"][0]["status"] == "diagnosed"
    assert project_before["records"][0]["review_status"] == "pending_review"
    assert project_before["records"][0]["has_war_room_plan"] is False
    assert project_before["archive"]["profile"][0]["value"] == "华火新能源"
    assert any(f["label"] == "推广账号" for f in project_before["archive"]["modules"][0]["facts"])
    assert client.get(f"/project/{pid}/war-room", headers=auth).status_code == 403

    review_detail = client.get(f"/admin/review/{status['record_id']}", headers=auth).json()
    assert review_detail["review_status"] == "pending_review"
    assert review_detail["evidence_pack"][0]["record_id"] == status["record_id"]
    assert review_detail["results"][0]["conclusion"] == "竞品招商回本承诺和政策资质约束需要优先核验"

    approved = client.post(
        f"/admin/review/{status['record_id']}",
        json={"action": "approve", "notes": ["证据链已复核，可以进入老板作战室"], "reviewer": "顾问A"},
        headers=auth,
    )
    assert approved.status_code == 200
    assert approved.json()["review_status"] == "approved"

    project_after = client.get(f"/project/{pid}", headers=auth).json()
    assert project_after["delivery_status"]["state"] == "approved"
    assert project_after["war_room_plan"]["project_id"] == pid
    assert project_after["war_room_plan"]["source_record_ids"] == [status["record_id"]]
    assert project_after["war_room_plan"]["iteration_count"] == 1
    assert project_after["records"][0]["review_status"] == "approved"
    assert project_after["records"][0]["has_war_room_plan"] is True

    war_room = client.get(f"/project/{pid}/war-room", headers=auth)
    assert war_room.status_code == 200
    assert war_room.json()["project_id"] == pid
    assert war_room.json()["source_record_ids"] == [status["record_id"]]
    assert war_room.json()["department_actions"]

    project_evidence = client.get(f"/project/{pid}/evidence", headers=auth).json()
    assert len(project_evidence) == 2
    assert all(row["record_id"] == status["record_id"] for row in project_evidence)
    assert any(row["source_stage"] == "expert_supplemental_research" for row in project_evidence)


async def _fake_system_research(session, *, job_id, project_id, questionnaire, client=None):
    from app.research.store import save_research_evidence
    from app.research.models import ResearchBrief, ResearchQuery

    item = ResearchEvidenceItem(
        module="market",
        query="电火灶 行业 趋势",
        title="电火灶行业公开资料",
        url="https://example.com/market",
        snippet="行业资料摘要",
        source_type="web",
        credibility=0.62,
        provider="test",
        raw={"fixture": "system"},
    )
    await save_research_evidence(session, job_id=job_id, project_id=project_id, items=[item])
    return ResearchBrief(queries=[ResearchQuery(module="market", query=item.query)], evidence=[item])


async def _fake_supplemental_research(session, *, job_id, project_id, research_questions, client=None):
    from app.research.store import save_research_evidence

    item = ResearchEvidenceItem(
        module="market",
        query=research_questions[0].query,
        title="电火灶招商加盟页",
        url="https://example.com/franchise",
        snippet="招商页公开宣称回本周期，需要结合资质与合同审查。",
        source_type="web",
        credibility=0.7,
        provider="test",
        raw={"fixture": "supplemental"},
    )
    return await save_research_evidence(
        session,
        job_id=job_id,
        project_id=project_id,
        items=[item],
        source_stage="expert_supplemental_research",
    )
