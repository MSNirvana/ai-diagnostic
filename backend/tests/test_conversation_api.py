"""对话追问端点 + generate-ab 接受 summary 测试。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)


class AskingLLM:
    """模拟还在追问的 AI。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "done": False,
            "message": "这个获客成本上升是从什么时候开始的？",
            "summary": None,
        }, ensure_ascii=False)


class DoneLLM:
    """模拟信息充分、输出 summary 的 AI。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "done": True,
            "message": "我已了解，将据此定制诊断。",
            "summary": {
                "core_problem": "获客成本翻倍但转化没涨",
                "context": "近半年投放预算翻倍",
                "suspected_cause": "渠道红利消失",
                "tried": "换过两个投放代理",
                "company_name": "星麦",
                "industry": "直播电商",
                "main_business": "达人带货",
                "business_model": "平台撮合",
                "scale": "85人",
                "stage": "成长期",
            },
        }, ensure_ascii=False)


def test_chat_keeps_asking():
    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "我们获客成本越来越高"}]
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] is False
    assert "什么时候" in body["message"]
    assert body["summary"] is None


def test_chat_finishes_with_summary():
    app.dependency_overrides[get_llm_client] = lambda: DoneLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [
            {"role": "user", "content": "获客成本越来越高"},
            {"role": "assistant", "content": "从什么时候开始？"},
            {"role": "user", "content": "近半年，预算翻倍但转化没涨"},
        ]
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] is True
    assert body["summary"]["core_problem"]
    assert body["summary"]["industry"] == "直播电商"


def test_chat_empty_start():
    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    resp = client.post("/conversation/chat", json={"messages": []})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    assert resp.json()["done"] is False


def test_generate_ab_accepts_summary():
    valid = {
        "modules": [{
            "key": "market", "label": "市场与客户", "subtitle": "x",
            "fields": [{"key": "f", "label": "f", "placeholder": "p", "accept_file": False}],
            "pains": ["p1"], "free_text_label": "补充",
        }]
    }

    class GenLLM:
        async def complete(self, system: str, prompt: str) -> str:
            # 断言 summary 的核心问题进了 prompt
            assert "获客成本" in prompt
            return json.dumps(valid, ensure_ascii=False)

    app.dependency_overrides[get_llm_client] = lambda: GenLLM()
    resp = client.post("/questionnaire/generate-ab", json={
        "summary": {
            "core_problem": "获客成本翻倍",
            "context": "近半年", "suspected_cause": "渠道红利消失", "tried": "换代理",
            "company_name": "", "industry": "直播电商", "main_business": "带货",
            "business_model": "撮合", "scale": "85人", "stage": "成长期",
        }
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    assert resp.json()["option_a"]["modules"][0]["key"] == "market"
