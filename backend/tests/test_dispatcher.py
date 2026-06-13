import json
from app.orchestrator.dispatcher import diagnose_all
from app.models.questionnaire import Questionnaire, ModuleAnswer


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        if '"module": "sales"' in prompt:
            signal = "red"
            conclusion = "销售转化漏斗断点是当前最优先问题"
            actions = ["先复盘近30天销售漏斗"]
        elif '"module": "finance"' in prompt:
            signal = "green"
            conclusion = "现金流暂未构成主要约束"
            actions = ["保持现金流周监控"]
        else:
            signal = "yellow"
            conclusion = "我们先立假设，定价偏高是主因"
            actions = ["下调定价"]
        return json.dumps({
            "signal": signal,
            "conclusion": conclusion,
            "evidence": [{"text": "定价高18%", "source": "行业报告"}],
            "actions": actions,
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


async def test_dispatcher_routes_problem_map_focus_to_expert():
    q = Questionnaire(
        answers=[ModuleAnswer(module="market", pains=["获客贵"])],
        problem_map={
            "core_problem": "获客成本翻倍但销售转化没有提升",
            "sub_problems": ["销售跟进效率低", "财务现金流压力暂不明显"],
            "diagnosis_focus": "sales",
        },
    )

    outcome = await diagnose_all(q, llm=FakeLLM())

    assert [r.module for r in outcome.results] == ["sales", "market", "finance"]
    assert outcome.triage.primary_module == "sales"
    assert [route.module for route in outcome.triage.selected_experts] == [
        "sales",
        "market",
        "finance",
    ]
    assert outcome.triage.selected_experts[0].reason == "问题地图建议优先诊断"
    assert outcome.triage.priority_actions[0].startswith("销售与增长")
    sales_result = outcome.results[0]
    assert sales_result.evidence_package is not None
    assert sales_result.evidence_package.confidence > 0
    assert sales_result.evidence_package.benchmarks[0].source
    assert sales_result.evidence_package.audit_trail.skill_version_id == "fallback"


async def test_dispatcher_flags_cross_expert_conflicts():
    q = Questionnaire(
        answers=[
            ModuleAnswer(module="sales", pains=["转化率下降"]),
            ModuleAnswer(module="finance", pains=["现金流紧张"]),
        ],
        problem_map={"core_problem": "增长下滑但短期现金流不能再承压"},
    )

    outcome = await diagnose_all(q, llm=FakeLLM())

    assert outcome.triage.primary_module == "sales"
    assert outcome.triage.conflicts
    assert "销售" in outcome.triage.conflicts[0].description
    assert "财务" in outcome.triage.conflicts[0].description
