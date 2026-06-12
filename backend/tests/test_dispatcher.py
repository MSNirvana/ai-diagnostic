import json
from app.orchestrator.dispatcher import diagnose_all
from app.models.questionnaire import Questionnaire, ModuleAnswer


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "我们先立假设，定价偏高是主因",
            "evidence": [{"text": "定价高18%", "source": "行业报告"}],
            "actions": ["下调定价"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


async def test_dispatcher_runs_registered_module():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["竞品强"])])
    outcome = await diagnose_all(q, llm=FakeLLM())
    assert len(outcome.results) == 1
    assert outcome.results[0].module == "market"
    assert "假设" not in outcome.results[0].conclusion
    # 无 session 时走 fallback
    assert outcome.skill_version_ids["market"] == "fallback"


async def test_dispatcher_skips_unregistered_module():
    q = Questionnaire(answers=[ModuleAnswer(module="unknown")])
    outcome = await diagnose_all(q, llm=FakeLLM())
    assert outcome.results == []
    assert outcome.skill_version_ids == {}
