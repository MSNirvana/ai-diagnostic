"""作战室卡片：问题=现象(大脑给/兜底)、证据按来源拆内外。

对应前端「01 问题是什么 / 02 结论是什么 / 03 外部数据 / 04 内部数据」的数据来源纠正。
"""
from types import SimpleNamespace

from app.models.questionnaire import Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    Evidence,
    EvidencePackage,
    ModuleResult,
    TriageSummary,
)
from app.warroom.composer import (
    _problem_for,
    _split_evidence,
    compose_war_room_plan,
)
from app.warroom.research_enrichment import enrich_war_room_plan_with_research

_INTERNAL = "客户自述（诊断问答）"
_UPLOAD = "客户上传资料（后台导出）"
_EXTERNAL = "https://example.com/report"


def _result(problem: str = "") -> ModuleResult:
    return ModuleResult(
        module="market",
        signal="red",
        problem=problem,
        conclusion="核心约束是渠道结构错配，应聚焦1-2条开发者垂直渠道",
        evidence=[
            Evidence(text="20个注册用户只有1人在持续调用", source=_INTERNAL),
            Evidence(text="同行同类产品次月留存约35%", source=_EXTERNAL),
            Evidence(text="后台导出显示开发者占比≈0", source=_UPLOAD),
        ],
        actions=["收窄客群：先深耕 V2EX + 技术博客两条渠道"],
        evidence_package=EvidencePackage(
            confidence=0.6,
            confidence_reason="样本覆盖核心链路",
            citations=[],
            benchmarks=[BenchmarkReference(name="SaaS 行业基准", source="公开研究", value="次月留存 P50≈30%")],
            audit_trail=AuditTrail(skill_version_id="market-v1", input_modules=["market"]),
        ),
        data_requests=[],
    )


def test_split_evidence_by_source():
    internal, external = _split_evidence(_result())
    # 客户自述 + 客户上传 → 内部；外部 URL → 外部；benchmark 一律外部
    assert any("只有1人在持续调用" in x for x in internal)
    assert any("开发者占比" in x for x in internal)
    assert any("次月留存约35%" in x for x in external)
    assert any("SaaS 行业基准" in x for x in external)
    # 内部事实不应漏进外部列，反之亦然
    assert not any("只有1人在持续调用" in x for x in external)
    assert not any("次月留存约35%" in x for x in internal)


def test_external_evidence_carries_source():
    _internal, external = _split_evidence(_result())
    # 外部证据要带来源（卡片「外部数据与来源证明」），内部事实不强加来源括号
    assert any("（" in x and "）" in x for x in external)


def test_placeholder_benchmark_is_not_treated_as_external_evidence():
    result = _result().model_copy(
        update={
            "evidence": [Evidence(text="20个注册用户只有1人在持续调用", source=_INTERNAL)],
            "evidence_package": EvidencePackage(
                confidence=0.6,
                confidence_reason="样本覆盖核心链路",
                citations=[],
                benchmarks=[
                    BenchmarkReference(
                        name="market 外部基准",
                        source="AI Diagnostic benchmark stub",
                        value="signal: red；conclusion: 销售转化漏斗断点是当前最优先问题；evidence: text: 定价高18%",
                    )
                ],
                audit_trail=AuditTrail(skill_version_id="market-v1", input_modules=["market"]),
            ),
        }
    )
    _internal, external = _split_evidence(result)
    assert external == []


def test_problem_prefers_brain_then_internal_not_conclusion():
    # 大脑给了 problem → 用它
    p = _problem_for(_result(problem="20个注册用户只有1人在用，获客近乎停滞"), [])
    assert "20个注册用户" in p
    # 大脑没给 → 退最强内部事实，绝不退回结论（那是判断，会重蹈错位）
    internal, _ext = _split_evidence(_result())
    p2 = _problem_for(_result(problem=""), internal)
    assert "渠道结构错配" not in p2  # 不是结论
    assert "1人在持续调用" in p2 or "开发者占比" in p2


def test_compose_populates_card_fields():
    q = Questionnaire(project_id="p1", answers=[], problem_map={"goal": "把开发者拉起来"})
    plan = compose_war_room_plan(
        q, [_result(problem="20个注册用户只有1人在用")], TriageSummary(primary_module="market"), {}
    )
    action = next(a for a in plan.department_actions if a.department == "market")
    assert "20个注册用户" in action.problem                 # 01 问题=现象
    assert action.battle_goal.startswith("核心约束")          # 02 结论=判断(单一来源)
    assert action.internal_evidence and action.external_evidence
    assert any("1人在持续调用" in x for x in action.internal_evidence)
    assert any("SaaS 行业基准" in x for x in action.external_evidence)


def test_research_evidence_backfills_action_external_sources():
    q = Questionnaire(project_id="p1", answers=[], problem_map={"goal": "把开发者拉起来"})
    result = _result(problem="20个注册用户只有1人在用").model_copy(
        update={
            "evidence": [Evidence(text="20个注册用户只有1人在持续调用", source=_INTERNAL)],
            "evidence_package": EvidencePackage(
                confidence=0.6,
                confidence_reason="样本覆盖核心链路",
                citations=[],
                benchmarks=[
                    BenchmarkReference(
                        name="market 外部基准",
                        source="AI Diagnostic benchmark stub",
                        value="signal: red；conclusion: 销售转化漏斗断点是当前最优先问题；evidence: text: 定价高18%",
                    )
                ],
                audit_trail=AuditTrail(skill_version_id="market-v1", input_modules=["market"]),
            ),
        }
    )
    plan = compose_war_room_plan(q, [result], TriageSummary(primary_module="market"), {})
    action = plan.department_actions[0]
    assert action.external_evidence == []

    enriched = enrich_war_room_plan_with_research(
        plan,
        [
            SimpleNamespace(
                module="market",
                source_stage="system_pre_research",
                title="开发者工具市场公开报告",
                url="https://example.com/report",
                snippet="报告显示，开发者工具的高质量获客更依赖可运行 Demo 与技术社区口碑。",
                credibility=0.72,
                raw_json='{"relevance_score": 12, "relevance_bucket": "project_direct"}',
            )
        ],
    )

    enriched_action = enriched.department_actions[0]
    assert any("开发者工具市场公开报告" in item for item in enriched_action.external_evidence)
    assert any("https://example.com/report" in item for item in enriched_action.external_evidence)
    assert not any("signal:" in item for item in enriched_action.external_evidence)
