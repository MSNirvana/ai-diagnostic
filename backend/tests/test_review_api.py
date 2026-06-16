"""顾问审核流测试：诊断→pending_review→审核通过→approved。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)


class DiagLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red", "conclusion": "获客成本过高是核心问题",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["降本"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _run_diagnosis(auth: dict) -> str:
    """跑一次诊断，返回 record_id。"""
    r = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "problem_map": {
                "core_problem": "获客成本过高",
                "goal": "把 CAC 降下来",
                "diagnosis_focus": "market",
            },
        },
        headers=auth,
    )
    assert r.status_code == 200
    body = r.json()
    # 登录用户诊断后状态应为待审核
    assert body["review_status"] == "pending_review"
    return body["record_id"]


def test_diagnosis_enters_pending_review(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("review1@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    record_id = _run_diagnosis(auth)
    app.dependency_overrides.pop(get_llm_client, None)

    # 审核队列里能看到这条
    queue = client.get("/admin/review/queue").json()
    assert any(item["record_id"] == record_id for item in queue)
    item = next(i for i in queue if i["record_id"] == record_id)
    assert item["primary_module"] == "market"
    assert item["hours_remaining"] <= 24
    assert item["overdue"] is False


def test_review_approve_flow(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("review2@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    record_id = _run_diagnosis(auth)
    app.dependency_overrides.pop(get_llm_client, None)

    # 老板侧历史此时是待审核
    hist = client.get("/history/", headers=auth).json()
    assert hist[0]["review_status"] == "pending_review"

    # 顾问审核详情可读
    detail = client.get(f"/admin/review/{record_id}").json()
    assert detail["review_status"] == "pending_review"
    assert len(detail["results"]) >= 1

    # 顾问补充注释并通过
    r = client.post(
        f"/admin/review/{record_id}",
        json={"action": "approve", "notes": ["建议优先收缩低效投放渠道"], "reviewer": "顾问A"},
    )
    assert r.status_code == 200
    assert r.json()["review_status"] == "approved"
    assert "建议优先收缩低效投放渠道" in r.json()["consultant_notes"]

    # 老板侧历史变为已审核，且能看到顾问注释
    hist2 = client.get("/history/", headers=auth).json()
    assert hist2[0]["review_status"] == "approved"
    detail2 = client.get(f"/history/{record_id}", headers=auth).json()
    assert detail2["review_status"] == "approved"
    assert "建议优先收缩低效投放渠道" in detail2["consultant_notes"]


def test_review_reject_flow(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("review3@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    record_id = _run_diagnosis(auth)
    app.dependency_overrides.pop(get_llm_client, None)

    r = client.post(
        f"/admin/review/{record_id}",
        json={"action": "reject", "notes": ["证据不足，需要补充投放数据"], "reviewer": "顾问B"},
    )
    assert r.status_code == 200
    assert r.json()["review_status"] == "rejected"

    # 被打回的不再出现在待审队列
    queue = client.get("/admin/review/queue").json()
    assert not any(item["record_id"] == record_id for item in queue)
