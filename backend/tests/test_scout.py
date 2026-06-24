"""调度脑子（起跑库不设边界）：动态决定诊断角度，含注册表外新角度。"""
import json

from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.orchestrator.dispatcher import diagnose_all
from app.orchestrator.scout import adhoc_module_key, scout_angles


class ScoutLLM:
    """scout 调用返回角度；诊断调用返回合规结论。按 system 区分。"""
    def __init__(self, angles):
        self._angles = angles

    async def complete(self, system: str, prompt: str) -> str:
        if "诊断调度脑子" in system:
            return json.dumps({"angles": self._angles}, ensure_ascii=False)
        return json.dumps({
            "signal": "yellow",
            "conclusion": "需补数据后判断",
            "evidence": [],
            "actions": ["先补齐关键数据"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


_PROBLEM = {
    "industry": "B2B制造", "main_business": "设备", "business_model": "直销",
    "core_problem": "回款越来越慢、现金紧", "goal": "三个月内稳住现金",
}


async def test_scout_proposes_known_and_novel():
    angles = await scout_angles(
        _PROBLEM,
        [("finance", "财务与资本"), ("cash_runway", "现金流与回款诊断")],
        ScoutLLM([
            {"key": "cash_runway", "label": "现金流与回款诊断", "known": True, "reason": "现金紧"},
            {"key": "", "label": "品牌口碑", "known": False, "reason": "口碑影响转化"},
        ]),
        session=None,
    )
    by_mod = {a.module: a for a in angles}
    assert "cash_runway" in by_mod and by_mod["cash_runway"].known
    assert "adhoc_品牌口碑" in by_mod and not by_mod["adhoc_品牌口碑"].known


async def test_scout_skips_without_core_problem():
    angles = await scout_angles({"industry": "x"}, [("finance", "财务")], ScoutLLM([]), session=None)
    assert angles == []


async def test_scout_best_effort_on_unknown_key():
    # known=true 但 key 不在 known_domains → 不当已有域（降级为忽略，避免乱路由）
    angles = await scout_angles(
        _PROBLEM,
        [("finance", "财务")],
        ScoutLLM([{"key": "not_a_real_domain", "label": "瞎编域", "known": True, "reason": "x"}]),
        session=None,
    )
    # 当成新角度（label 存在）→ ad-hoc
    assert all(a.module == adhoc_module_key("瞎编域") for a in angles)


async def test_diagnose_all_runs_scout_angles():
    q = Questionnaire(
        answers=[ModuleAnswer(module="market", facts={"行业": "B2B制造"}, pains=["获客难"])],
        problem_map=_PROBLEM,
    )
    llm = ScoutLLM([
        {"key": "cash_runway", "label": "现金流与回款诊断", "known": True, "reason": "现金紧"},
        {"key": "", "label": "品牌口碑", "known": False, "reason": "口碑影响转化"},
    ])
    outcome = await diagnose_all(q, llm, session=None)
    mods = {r.module for r in outcome.results}
    assert "market" in mods            # 关键词路由的
    assert "cash_runway" in mods       # 调度脑子补的已有域
    assert "adhoc_品牌口碑" in mods     # 调度脑子补的注册表外新角度
