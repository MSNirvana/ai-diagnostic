"""断言库自测：确认每条断言既能放过好结果，也能抓住作弊。

反 Goodhart 的第一层：断言库自己必须先证明它抓得住作弊样本。
"""
from app.eval.assertions import EvalContext, evaluate_result
from app.models.questionnaire import ModuleAnswer
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    DataRequest,
    Evidence,
    EvidencePackage,
    ModuleResult,
)


def _ep(confidence=0.75, benchmarks=None):
    return EvidencePackage(
        confidence=confidence,
        confidence_reason="测试用",
        citations=[],
        benchmarks=benchmarks or [],
        audit_trail=AuditTrail(skill_version_id="test", input_modules=["market"]),
    )


def _good_result():
    return ModuleResult(
        module="market",
        signal="red",
        conclusion="获客成本偏高，定价高于行业18%是当前流失的主要原因",
        evidence=[
            Evidence(text="获客成本¥420，行业中位¥180", source="你上传的投放报表"),
            Evidence(text="定价高于top3竞品18%", source="行业基准2026.05"),
        ],
        actions=["暂停CAC高于目标30%的渠道", "下调定价至竞品区间"],
        evidence_package=_ep(0.75, [BenchmarkReference(name="行业CAC", source="基准", value="¥180")]),
        data_requests=[],
    )


def _ctx(answer=None, **kw):
    return EvalContext(
        answer=answer or ModuleAnswer(
            module="market",
            facts={"获客成本": "420", "定价溢价": "18%", "竞品数": "3"},
        ),
        benchmark_numbers=("180",),
        **kw,
    )


def test_good_result_passes_all():
    report = evaluate_result(_good_result(), _ctx())
    assert report.l1_passed, [f.detail for f in report.failures if f.level == "L1"]
    assert report.l2_pass_rate >= 0.9, [f.code + ":" + f.detail for f in report.failures]


def test_s5_catches_placeholder_source():
    r = _good_result()
    r.evidence[0] = Evidence(text="获客成本高", source="未注明")
    report = evaluate_result(r, _ctx())
    assert not report.l1_passed
    assert any(f.code == "S5" for f in report.failures)


def test_c2_catches_fabricated_number():
    """核心反作弊：evidence 里出现输入中不存在的统计数字。"""
    r = _good_result()
    r.evidence = [Evidence(text="复购率仅37%，远低于同行", source="分析")]
    # 37 不在 facts(420/18/3) 也不在 benchmark(180) 里
    report = evaluate_result(r, _ctx())
    assert any(f.code == "C2" and not f.passed for f in report.results)


def test_c3_catches_empty_action():
    r = _good_result()
    r.actions = ["加强渠道管理", "提升团队效率"]
    report = evaluate_result(r, _ctx())
    assert any(f.code == "C3" and not f.passed for f in report.results)


def test_c4_catches_template_phrase():
    r = _good_result()
    r.conclusion = "综上所述，建议关注市场渠道效率问题，需要引起重视"
    report = evaluate_result(r, _ctx())
    assert any(f.code == "C4" and not f.passed for f in report.results)


def test_c7_catches_overconfident_empty_evidence():
    """无证据却报高置信度 = 空手套白狼。"""
    r = _good_result()
    r.evidence = []
    r.evidence_package = _ep(0.85)
    report = evaluate_result(r, _ctx())
    assert any(f.code == "C7" and not f.passed for f in report.results)


def test_s8_catches_undeclared_missing_data():
    """声明需要 promotion_account 但输入没有、也没申报 = 瞎编前提。"""
    from app.skills.configured import DataRequirement
    r = _good_result()
    r.data_requests = []
    req = DataRequirement(
        key="promotion_account",
        label="推广账号",
        reason="x",
        source_hint="y",
        keywords=("推广账号", "广告账号"),
    )
    ctx = _ctx(requirements=(req,))
    report = evaluate_result(r, ctx)
    assert any(f.code == "S8" and not f.passed for f in report.results)


def test_c8_catches_signal_conclusion_mismatch():
    r = _good_result()
    r.signal = "red"
    r.conclusion = "市场表现稳健，各项指标处于合理区间运行良好"
    report = evaluate_result(r, _ctx())
    assert any(f.code == "C8" and not f.passed for f in report.results)
