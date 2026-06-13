import json

from app.models.questionnaire import ModuleAnswer
from scripts.seed_skills import SEEDS
from app.skills.generic import GenericModuleSkill
from app.skills.registry import get_skill, registered_modules


class SparseLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "yellow",
            "conclusion": "需要补充经营数据后才能给出更高置信度判断",
            "evidence": [],
            "actions": ["先补齐关键数据"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


def test_all_registered_modules_are_dedicated_skills():
    assert set(registered_modules()) == {"market", "product", "sales", "ops", "org", "finance"}

    for module in registered_modules():
        skill = get_skill(module)
        assert skill is not None
        assert not isinstance(skill, GenericModuleSkill), f"{module} still uses generic skill"


def test_seed_includes_all_diagnosis_skills():
    diagnosis_modules = {
        module for module, skill_type, _method, _prompt in SEEDS if skill_type == "diagnosis"
    }
    assert diagnosis_modules == set(registered_modules())


async def test_market_skill_requests_promotion_account_data_when_missing():
    skill = get_skill("market")
    assert skill is not None

    result, _ = await skill.diagnose(
        ModuleAnswer(module="market", facts={"行业": "直播电商"}, pains=["获客成本高"]),
        llm=SparseLLM(),
    )

    assert result.data_requests
    assert any("推广账号" in req.label or "广告" in req.label for req in result.data_requests)
    assert result.evidence_package is not None
    assert result.evidence_package.confidence < 0.7
    assert any("缺失数据请求" in check for check in result.evidence_package.audit_trail.checks)


async def test_sales_skill_requests_funnel_and_crm_data_when_missing():
    skill = get_skill("sales")
    assert skill is not None

    result, _ = await skill.diagnose(
        ModuleAnswer(module="sales", facts={"行业": "直播电商"}, pains=["转化率下降"]),
        llm=SparseLLM(),
    )

    labels = [req.label for req in result.data_requests]
    assert any("漏斗" in label for label in labels)
    assert any("CRM" in label or "成交" in label for label in labels)
