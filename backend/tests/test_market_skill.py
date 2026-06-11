import json
from app.skills.market import MarketSkill
from app.models.questionnaire import ModuleAnswer


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "定价高于竞品，价格是流失主因",
            "evidence": [{"text": "定价高于top3竞品18%", "source": "行业报告2026.05"}],
            "actions": ["下调定价至竞品区间", "强化差异化卖点"],
            "drilldown": {
                "data_points": [{"text": "你客单价¥420 vs 行业¥350", "source": "你上传的销售表"}],
                "comparisons": ["客单价高出行业20%"],
            },
        })


async def test_market_skill_declares_metadata():
    skill = MarketSkill()
    assert skill.module == "market"
    assert skill.method


async def test_market_skill_returns_valid_result():
    skill = MarketSkill()
    answer = ModuleAnswer(module="market", facts={"客单价": "420"}, pains=["打不过竞品"])
    result = await skill.diagnose(answer, llm=FakeLLM())
    assert result.module == "market"
    assert result.signal == "red"
    assert len(result.evidence) <= 3
    assert len(result.actions) >= 1
    assert result.drilldown is not None
