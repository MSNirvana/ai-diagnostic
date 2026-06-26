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
            "request_review": True,   # 显式请顾问复核（审核现为可选，默认不选）
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
    # 请了复核 → 待审核
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


def test_diagnosis_default_no_review_is_immediately_visible(db_session):
    # 审核可选、默认不选：不传 request_review → 诊断完成即 approved、立即可见、不进审核队列（老板零等待）。
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("noreview@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "problem_map": {"core_problem": "获客成本过高", "diagnosis_focus": "market"},
        },
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert r.status_code == 200
    body = r.json()
    assert body["review_status"] == "approved"          # 默认即出，不挂审核
    record_id = body["record_id"]
    queue = client.get("/admin/review/queue").json()
    assert all(item["record_id"] != record_id for item in queue)  # 不进审核队列


def test_boss_can_request_review_on_approved_record(db_session):
    # 诊断默认 approved、立即可见、不进队列；老板可在结果上点「请顾问复核」事后送审。
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token = _register("request-review@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "problem_map": {"core_problem": "获客成本过高", "diagnosis_focus": "market"},
        },
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert r.status_code == 200
    body = r.json()
    assert body["review_status"] == "approved"
    record_id = body["record_id"]
    # 默认不在审核队列
    queue = client.get("/admin/review/queue").json()
    assert all(item["record_id"] != record_id for item in queue)

    # 老板请复核 → 进 pending_review
    rr = client.post(f"/diagnose/{record_id}/request-review", headers=auth)
    assert rr.status_code == 200
    assert rr.json()["review_status"] == "pending_review"

    # 现在进入审核队列、历史也变待审核
    queue2 = client.get("/admin/review/queue").json()
    assert any(item["record_id"] == record_id for item in queue2)
    hist = client.get("/history/", headers=auth).json()
    assert hist[0]["review_status"] == "pending_review"

    # 幂等：再点一次仍是 pending_review
    again = client.post(f"/diagnose/{record_id}/request-review", headers=auth)
    assert again.status_code == 200
    assert again.json()["review_status"] == "pending_review"


def test_request_review_rejects_other_users_record(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    token_a = _register("owner-a@b.com")
    auth_a = {"Authorization": f"Bearer {token_a}"}
    rid = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["x"]}],
            "problem_map": {"core_problem": "y", "diagnosis_focus": "market"},
        },
        headers=auth_a,
    ).json()["record_id"]
    app.dependency_overrides.pop(get_llm_client, None)

    # 别的用户无权送审这条记录
    token_b = _register("intruder-b@b.com")
    auth_b = {"Authorization": f"Bearer {token_b}"}
    resp = client.post(f"/diagnose/{rid}/request-review", headers=auth_b)
    assert resp.status_code == 403


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
