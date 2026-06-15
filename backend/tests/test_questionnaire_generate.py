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
                {"key": "GMV", "label": "月GMV", "placeholder": "如 500万", "accept_file": True},
                {"key": "gmv", "label": "月GMV重复", "placeholder": "如 600万", "accept_file": True},
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


class SkillContextLLM:
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        SkillContextLLM.seen_prompt = prompt
        assert "available_skills" in prompt
        assert "recommended_skills" in prompt
        assert "legal_compliance" in prompt
        return json.dumps({
            "modules": [
                {
                    "key": "legal_compliance",
                    "label": "法务合规",
                    "subtitle": "核验宣传、资质与合同风险",
                    "fields": [
                        {"key": "ad_materials", "label": "广告素材", "placeholder": "上传近期投放素材", "accept_file": True}
                    ],
                    "pains": ["广告合规风险"],
                    "free_text_label": "补充合规背景",
                }
            ]
        }, ensure_ascii=False)


def test_generate_returns_valid_questionnaire(db_session):
    app.dependency_overrides[get_llm_client] = lambda: ValidLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "测试直播公司",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "80人",
        "stage": "成长期",
        "core_problem": "获客成本高",
        "goal": "把投产比拉回 1.2",
        "constraints": "预算不能加",
        "success_criteria": "ROI 达标",
        "impact": "近3个月获客成本上升30%",
        "data_readiness": "有投放报表",
        "diagnosis_focus": "sales",
    }})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["modules"][0]["key"] == "market"
    assert body["modules"][0]["fields"][0]["accept_file"] is True
    assert len(body["modules"][0]["fields"]) == 6


def test_generate_malformed_output_returns_422(db_session):
    app.dependency_overrides[get_llm_client] = lambda: GarbageLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422


def test_generate_injects_extensible_skill_network_context(db_session):
    app.dependency_overrides[get_llm_client] = lambda: SkillContextLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "华火新能源",
        "industry": "新能源厨电",
        "main_business": "电火灶招商加盟",
        "business_model": "经销加盟",
        "scale": "50人",
        "stage": "成长期",
        "core_problem": "加盟招商投放不错，但广告合规、资质认证和合同风险没有核清",
        "goal": "建立可复制招商模型",
        "constraints": "不能触碰合规红线",
        "success_criteria": "投放转化提升且合同风险可控",
        "impact": "线索增加但签约推进慢",
        "data_readiness": "可上传广告素材和加盟协议",
        "diagnosis_focus": "法务合规",
    }})
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    keys = [module["key"] for module in body["modules"]]
    assert "legal_compliance" in keys
    assert "channel_franchise" in keys
