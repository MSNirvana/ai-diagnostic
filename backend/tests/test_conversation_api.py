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


def test_chat_keeps_asking(db_session):
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


def test_chat_finishes_with_summary(db_session):
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


def test_chat_empty_start(db_session):
    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    resp = client.post("/conversation/chat", json={"messages": []})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    assert resp.json()["done"] is False


def test_generate_ab_accepts_summary(db_session):
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


# ── phase 状态机（intake → confirm → done） ───────────────

class StatefulPhaseLLM:
    """按调用顺序返回 intake → confirm → done 三阶段输出。"""
    calls = 0

    PROBLEM_MAP = {
        "company_name": "星麦",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "85人",
        "stage": "成长期",
        "core_problem": "获客成本翻倍但转化没涨",
        "sub_problems": ["转化漏斗后段流失", "复购率偏低"],
        "goal": "三个月内把 ROI 拉回 1.2 以上",
        "constraints": "投放预算不能再加",
        "success_criteria": "ROI 大于 1.2 且月单量稳定",
        "context": "近半年预算翻倍",
        "suspected_cause": "渠道红利消失",
        "tried": "换过两个代理",
        "diagnosis_focus": "sales",
    }

    async def complete(self, system: str, prompt: str) -> str:
        StatefulPhaseLLM.calls += 1
        n = StatefulPhaseLLM.calls
        if n == 1:
            return json.dumps({
                "phase": "intake", "done": False,
                "message": "这个获客成本上升从什么时候开始？",
                "problem_map": None,
            }, ensure_ascii=False)
        if n == 2:
            return json.dumps({
                "phase": "confirm", "done": False,
                "message": "我这样理解……这样对吗？",
                "problem_map": self.PROBLEM_MAP,
            }, ensure_ascii=False)
        return json.dumps({
            "phase": "done", "done": True,
            "message": "好的，我已完整理解。",
            "problem_map": self.PROBLEM_MAP,
        }, ensure_ascii=False)


def test_chat_phase_intake_to_confirm_to_done(db_session):
    StatefulPhaseLLM.calls = 0
    app.dependency_overrides[get_llm_client] = lambda: StatefulPhaseLLM()

    r1 = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "获客越来越贵"}]
    }).json()
    assert r1["phase"] == "intake"
    assert r1["done"] is False
    assert r1["problem_map"] is None

    r2 = client.post("/conversation/chat", json={
        "messages": [
            {"role": "user", "content": "获客越来越贵"},
            {"role": "assistant", "content": r1["message"]},
            {"role": "user", "content": "近半年，预算翻倍但ROI掉了"},
        ]
    }).json()
    assert r2["phase"] == "confirm"
    assert r2["done"] is False
    assert r2["problem_map"]["core_problem"]
    assert r2["problem_map"]["diagnosis_focus"] == "sales"
    assert r2["problem_map"]["goal"]
    assert r2["problem_map"]["constraints"]

    r3 = client.post("/conversation/chat", json={"messages": []}).json()
    assert r3["phase"] == "done"
    assert r3["done"] is True
    assert r3["problem_map"]["core_problem"]
    assert r3["summary"]["industry"] == "直播电商"

    app.dependency_overrides.pop(get_llm_client, None)
