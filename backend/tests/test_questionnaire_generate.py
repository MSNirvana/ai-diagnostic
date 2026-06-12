"""问卷生成端点：正常生成 + LLM 畸形输出降级。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)

_PROFILE = {
    "profile": {
        "company_name": "测试直播公司",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "80人",
        "stage": "成长期",
    }
}

_VALID = {
    "modules": [
        {
            "key": "market",
            "label": "市场与客户",
            "subtitle": "市场地位",
            "fields": [
                {"key": "GMV", "label": "月GMV", "placeholder": "如 500万", "accept_file": True}
            ],
            "pains": ["流量见顶", "退货率高"],
            "free_text_label": "补充说明",
        }
    ]
}


class ValidLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps(_VALID, ensure_ascii=False)


class GarbageLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return "这不是 JSON，模型抽风了"


def test_generate_returns_valid_questionnaire(db_session):
    app.dependency_overrides[get_llm_client] = lambda: ValidLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["modules"][0]["key"] == "market"
    assert body["modules"][0]["fields"][0]["accept_file"] is True


def test_generate_malformed_output_returns_422(db_session):
    app.dependency_overrides[get_llm_client] = lambda: GarbageLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422
