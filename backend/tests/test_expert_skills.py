import json

from app.models.questionnaire import ModuleAnswer
from scripts.seed_skills import SEEDS
from app.skills.registry import get_skill, registered_modules
from app.skills.skill_network import diagnosis_skill_definitions


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
    modules = set(registered_modules())
    assert {"market", "product", "sales", "ops", "org", "finance"}.issubset(modules)
    assert {
        "legal_compliance",
        "tax",
        "policy",
        "ip",
        "supply_chain",
        "channel_franchise",
        "data_systems",
    }.issubset(modules)

    for module in registered_modules():
        skill = get_skill(module)
        assert skill is not None
        assert skill.module == module


def test_diagnosis_is_brain_driven_not_seeded():
    # 诊断域零 prose：判断由 diagnostic_method 脑子按 domain 数据现场生成，故不进 seed。
    seeded_diagnosis = {
        module for module, skill_type, _method, _prompt in SEEDS if skill_type == "diagnosis"
    }
    assert seeded_diagnosis == set()
    # 脑子（method 类型）必须进 seed，作为全局诊断方法的可版本化来源。
    seeded_methods = {module for module, skill_type, _m, _p in SEEDS if skill_type == "method"}
    assert "diagnostic_method" in seeded_methods
    # 注册的诊断域与定义一致。
    assert set(registered_modules()) == {definition.key for definition in diagnosis_skill_definitions()}


async def test_market_skill_requests_promotion_account_data_when_missing():
    skill = get_skill("market")
    assert skill is not None

    result, _ = await skill.diagnose(
        ModuleAnswer(
            module="market",
            facts={"行业": "直播电商"},
            pains=["获客成本高"],
            context={"industry": "直播电商", "core_problem": "获客成本高"},
        ),
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
        ModuleAnswer(
            module="sales",
            facts={"行业": "直播电商"},
            pains=["转化率下降"],
            context={"industry": "直播电商", "core_problem": "转化率下降"},
        ),
        llm=SparseLLM(),
    )

    labels = [req.label for req in result.data_requests]
    assert any("漏斗" in label for label in labels)
    assert any("CRM" in label or "成交" in label for label in labels)
    assert any("跟进" in label or "响应" in label for label in labels)
