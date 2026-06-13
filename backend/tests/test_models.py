import pytest
from pydantic import ValidationError
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    Evidence,
    EvidencePackage,
    ExpertRoute,
    ModuleResult,
    TriageConflict,
    TriageSummary,
)


def test_questionnaire_holds_module_answers():
    q = Questionnaire(answers=[
        ModuleAnswer(module="market", facts={"revenue": "1000万"}, pains=["打不过竞品"])
    ])
    assert q.answers[0].module == "market"


def test_module_result_caps_evidence_at_three():
    with pytest.raises(ValidationError):
        ModuleResult(
            module="market", signal="red", conclusion="x",
            evidence=[Evidence(text=f"e{i}", source="s") for i in range(4)],
            actions=["a"],
        )


def test_questionnaire_can_carry_problem_map_for_triage():
    q = Questionnaire(
        answers=[ModuleAnswer(module="market")],
        problem_map={
            "core_problem": "获客成本翻倍但转化没涨",
            "diagnosis_focus": "sales",
        },
    )
    assert q.problem_map["diagnosis_focus"] == "sales"


def test_triage_summary_contract():
    summary = TriageSummary(
        primary_module="sales",
        selected_experts=[
            ExpertRoute(module="sales", label="销售与增长", reason="问题地图建议优先诊断", priority=0),
            ExpertRoute(module="market", label="市场与客户", reason="用户填写了该模块", priority=1),
        ],
        conflicts=[
            TriageConflict(
                modules=["sales", "finance"],
                description="销售建议加大投入，但财务提示现金流约束",
            )
        ],
        dependencies=["先确认市场需求，再优化销售转化"],
        priority_actions=["销售与增长：复盘近30天漏斗"],
    )
    assert summary.primary_module == "sales"
    assert summary.selected_experts[0].label == "销售与增长"


def test_module_result_can_carry_auditable_evidence_package():
    result = ModuleResult(
        module="sales",
        signal="red",
        conclusion="销售转化漏斗断点是当前主因",
        evidence=[Evidence(text="近30天成交率下降", source="CRM")],
        actions=["复盘销售漏斗"],
        evidence_package=EvidencePackage(
            confidence=0.82,
            confidence_reason="输入证据和外部基准一致，但缺少逐单明细。",
            citations=[
                Evidence(text="近30天成交率下降", source="CRM"),
            ],
            benchmarks=[
                BenchmarkReference(
                    name="销售与增长外部基准",
                    source="AI Diagnostic benchmark stub",
                    value="external benchmark placeholder",
                )
            ],
            audit_trail=AuditTrail(
                skill_version_id="fallback",
                input_modules=["sales"],
                checks=["引用数量: 1", "行动建议数量: 1"],
            ),
        ),
    )

    assert result.evidence_package is not None
    assert result.evidence_package.confidence == 0.82
    assert result.evidence_package.benchmarks[0].source == "AI Diagnostic benchmark stub"
