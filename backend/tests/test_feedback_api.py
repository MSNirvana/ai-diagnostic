"""反馈端点 + admin skill 版本管理端点测试。"""
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.config import get_llm_client
from app.db.models import DiagnosisFeedback

client = TestClient(app)


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "green", "conclusion": "ok",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["a"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_feedback_persists(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("fb@b.com")
    # 先诊断拿 record_id + skill_version_ids
    diag = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["x"]}]},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    record_id = diag["record_id"]
    version_id = diag["skill_version_ids"]["market"]

    resp = client.post(
        f"/diagnose/{record_id}/feedback",
        json={"module": "market", "skill_version_id": version_id,
              "rating": 5, "is_useful": True, "comment": "很准"},
        headers={"Authorization": f"Bearer {token}"},
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 201

    import asyncio

    async def fetch():
        async with db_session() as s:
            return (await s.scalars(select(DiagnosisFeedback))).all()

    rows = asyncio.get_event_loop().run_until_complete(fetch())
    assert len(rows) == 1
    assert rows[0].rating == 5
    assert rows[0].comment == "很准"


def test_feedback_invalid_rating(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("fb2@b.com")
    diag = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["x"]}]},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    resp = client.post(
        f"/diagnose/{diag['record_id']}/feedback",
        json={"module": "market", "skill_version_id": "fallback", "rating": 9},
        headers={"Authorization": f"Bearer {token}"},
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422


def test_admin_add_and_activate_version(db_session):
    # 新增一个 market 版本并激活
    resp = client.post(
        "/admin/skills/market/versions",
        json={"system_prompt": "新版市场prompt", "change_reason": "测试改进",
              "change_category": "coverage", "activate": True},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["version"] == 1
    assert body["is_active"] is True

    # 查激活列表能看到它
    active = client.get("/admin/skills/").json()
    assert any(v["module"] == "market" and v["is_active"] for v in active)


def test_admin_skill_registry_lists_extensible_network(db_session):
    client.post(
        "/admin/skills/market/versions",
        json={
            "system_prompt": "市场 active prompt",
            "method": "market-evidence",
            "skill_type": "diagnosis",
            "change_reason": "registry active version test",
            "activate": True,
        },
    )

    resp = client.get("/admin/skills/registry")
    assert resp.status_code == 200
    body = resp.json()
    keys = {item["key"] for item in body}
    assert {
        "market",
        "sales",
        "free_chat",
        "legal_compliance",
        "tax",
        "channel_franchise",
        "evidence_confidence",
        "archive_extraction",
        "archive_refinement",
    }.issubset(keys)

    legal = next(item for item in body if item["key"] == "legal_compliance")
    assert legal["category"] == "professional"
    assert legal["fallback_prompt"] == ""  # 诊断域零 prose：判断由 diagnostic_method 脑子现场生成
    assert any(req["label"] == "经营资质与许可文件" for req in legal["data_requirements"])
    assert "低评分率" in legal["evaluation_metrics"]

    market = next(item for item in body if item["key"] == "market")
    assert market["active_version"]["version"] == 1
    assert market["active_version"]["method"] == "market-evidence"

    confidence = next(item for item in body if item["key"] == "evidence_confidence")
    assert confidence["category"] == "delivery"
    assert confidence["method"] == "confidence_calibration"
    assert "禁止固定高分" in confidence["fallback_prompt"]

    archive_extraction = next(item for item in body if item["key"] == "archive_extraction")
    assert archive_extraction["category"] == "delivery"
    assert archive_extraction["method"] == "archive_extraction"
    assert "报告性质" in archive_extraction["fallback_prompt"]
    assert "撰写人" in archive_extraction["fallback_prompt"]

    archive_refinement = next(item for item in body if item["key"] == "archive_refinement")
    assert archive_refinement["category"] == "delivery"
    assert archive_refinement["method"] == "archive_refinement"
    assert "不直接摘抄" in archive_refinement["fallback_prompt"]

    free_chat = next(item for item in body if item["key"] == "free_chat")
    assert free_chat["category"] == "assistant"
    assert free_chat["method"] == "brainstorm_chat"
    assert "头脑风暴" in free_chat["fallback_prompt"]
    assert "默认不绑定项目" in free_chat["fallback_prompt"]
