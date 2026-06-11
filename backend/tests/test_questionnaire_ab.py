"""问卷 A/B 生成 + 偏好记录端点测试。"""
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.config import get_llm_client
from app.db.models import QuestionnairePreference

client = TestClient(app)

_PROFILE = {
    "company_name": "星麦直播",
    "industry": "直播电商",
    "main_business": "达人带货",
    "business_model": "平台撮合",
    "scale": "85人",
    "stage": "成长期",
}

_VALID = {
    "modules": [
        {
            "key": "market",
            "label": "市场与客户",
            "subtitle": "市场地位",
            "fields": [
                {"key": "GMV", "label": "月GMV", "placeholder": "如 1000万", "accept_file": True}
            ],
            "pains": ["流量见顶"],
            "free_text_label": "补充说明",
        }
    ]
}


class ValidLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps(_VALID, ensure_ascii=False)


class HalfBrokenLLM:
    """第一次调用返回合法，第二次返回垃圾——验证降级兜底。"""
    calls = 0

    async def complete(self, system: str, prompt: str) -> str:
        HalfBrokenLLM.calls += 1
        if HalfBrokenLLM.calls == 1:
            return json.dumps(_VALID, ensure_ascii=False)
        return "彻底坏掉的输出"


def test_generate_ab_returns_two_options():
    app.dependency_overrides[get_llm_client] = lambda: ValidLLM()
    resp = client.post("/questionnaire/generate-ab", json={"profile": _PROFILE})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["option_a"]["modules"][0]["key"] == "market"
    assert body["option_b"]["modules"][0]["key"] == "market"


def test_generate_ab_falls_back_when_one_broken():
    HalfBrokenLLM.calls = 0
    app.dependency_overrides[get_llm_client] = lambda: HalfBrokenLLM()
    resp = client.post("/questionnaire/generate-ab", json={"profile": _PROFILE})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    # 坏掉的一份用好的兜底，两侧都有内容
    assert body["option_a"]["modules"]
    assert body["option_b"]["modules"]


def test_record_preference_persists(db_session):
    payload = {
        "profile": _PROFILE,
        "option_a": _VALID,
        "option_b": _VALID,
        "chosen": "a",
    }
    resp = client.post("/questionnaire/preference", json=payload)
    assert resp.status_code == 201
    assert resp.json()["ok"] is True

    import asyncio

    async def count():
        async with db_session() as s:
            return (await s.scalars(select(QuestionnairePreference))).all()

    rows = asyncio.get_event_loop().run_until_complete(count())
    assert len(rows) == 1
    assert rows[0].chosen == "a"
    assert rows[0].industry == "直播电商"


def test_record_preference_rejects_invalid_choice(db_session):
    payload = {
        "profile": _PROFILE,
        "option_a": _VALID,
        "option_b": _VALID,
        "chosen": "c",
    }
    resp = client.post("/questionnaire/preference", json=payload)
    assert resp.status_code == 422
