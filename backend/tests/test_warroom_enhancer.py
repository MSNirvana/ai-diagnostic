"""Loop 4 叙事增强器测试：正常增强 / 优雅降级 / 反套话 / 反编造。"""
import json

import pytest

from app.models.questionnaire import Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    Evidence,
    EvidencePackage,
    ModuleResult,
    TriageSummary,
)
from app.warroom.composer import compose_war_room_plan
from app.warroom.enhancer import enhance_war_room_plan


def _result(module: str, signal: str, conclusion: str, actions: list[str]) -> ModuleResult:
    return ModuleResult(
        module=module,
        signal=signal,  # type: ignore[arg-type]
        conclusion=conclusion,
        evidence=[
            Evidence(text=f"{module}近30天有效线索成本上升至45元", source="经营数据"),
            Evidence(text=f"{module}转化率8%低于同行", source="行业基准"),
        ],
        actions=actions,
        evidence_package=EvidencePackage(
            confidence=0.7,
            confidence_reason="样本覆盖核心链路",
            citations=[Evidence(text=f"{module}原始报表", source="上传文件")],
            benchmarks=[BenchmarkReference(name=f"{module}行业基准", source="公开研究", value="P50")],
            audit_trail=AuditTrail(skill_version_id=f"{module}-v1", input_modules=[module]),
        ),
        data_requests=[],
    )


def _plan():
    q = Questionnaire(project_id="p1", answers=[], problem_map={"goal": "压降获客成本"})
    results = [
        _result("market", "red", "获客成本翻倍，有效线索成本45元偏高", ["暂停低效渠道", "重分预算到高效渠道"]),
        _result("sales", "yellow", "转化率8%偏低", ["重排线索优先级"]),
    ]
    plan = compose_war_room_plan(q, results, TriageSummary(primary_module="market"), {})
    return plan, results


class _FakeLLM:
    def __init__(self, response: str | Exception):
        self._response = response
        self.called = False

    async def complete(self, system: str, prompt: str) -> str:
        self.called = True
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


@pytest.mark.asyncio
async def test_enhances_narrative_keeps_structure():
    plan, results = _plan()
    orig_priority = [a.priority for a in plan.department_actions]
    orig_metrics = [a.metrics[0].name for a in plan.department_actions]
    orig_conf = plan.confidence
    n_actions = len(plan.department_actions)
    n_decisions = len(plan.decision_items)

    good = json.dumps({
        "summary": "获客成本已经翻倍到45元一条线索，这是这个月最该止血的地方，先关掉烧钱的渠道。",
        "objective": "一个月内把有效线索成本从45元压回可控区间，别再让预算空转。",
        "decision_details": [f"授权市场负责人本周关停低效渠道，预算挪到转化率高的盘子" for _ in range(n_decisions)],
        "action_details": [f"先停掉跑不出量的渠道，把钱集中到转化率8%以上的盘子" for _ in range(n_actions)],
    }, ensure_ascii=False)
    llm = _FakeLLM(good)

    out = await enhance_war_room_plan(plan, results, llm)

    assert llm.called
    # 叙事被重写
    assert "45元" in out.summary and "翻倍" in out.summary
    # 结构字段一律不变
    assert [a.priority for a in out.department_actions] == orig_priority
    assert [a.metrics[0].name for a in out.department_actions] == orig_metrics
    assert out.confidence == orig_conf


@pytest.mark.asyncio
async def test_graceful_degrade_on_llm_error():
    plan, results = _plan()
    orig_summary = plan.summary
    llm = _FakeLLM(RuntimeError("503 网关抽风"))

    out = await enhance_war_room_plan(plan, results, llm)

    assert llm.called
    assert out.summary == orig_summary  # 原样返回，不崩


@pytest.mark.asyncio
async def test_none_llm_returns_plan_unchanged():
    plan, results = _plan()
    orig_summary = plan.summary
    out = await enhance_war_room_plan(plan, results, None)
    assert out.summary == orig_summary


@pytest.mark.asyncio
async def test_critic_rejects_template_phrases():
    plan, results = _plan()
    orig_summary = plan.summary
    # LLM 偷懒返回套话
    bad = json.dumps({
        "summary": "未来30天优先打市场战，建议关注获客成本，需要引起重视。",
        "objective": "持续改进，不断优化，助力企业发展。",
    }, ensure_ascii=False)
    llm = _FakeLLM(bad)

    out = await enhance_war_room_plan(plan, results, llm)

    # 套话被 critic 拒绝，回退原值
    assert out.summary == orig_summary
    assert "持续改进" not in out.objective


@pytest.mark.asyncio
async def test_critic_rejects_fabricated_numbers():
    plan, results = _plan()
    orig_summary = plan.summary
    # LLM 编造了输入里没有的数字（37%、120万）
    bad = json.dumps({
        "summary": "获客成本上升了37%，预计损失120万营收，必须立刻砍渠道。",
    }, ensure_ascii=False)
    llm = _FakeLLM(bad)

    out = await enhance_war_room_plan(plan, results, llm)

    # 编造数字被拒绝，回退原值
    assert out.summary == orig_summary
    assert "37%" not in out.summary and "120万" not in out.summary
