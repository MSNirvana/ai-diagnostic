"""诊断 intake 信息完整度规则。"""

from app.models.conversation import ProblemMap
from app.skills.intake_completeness import evaluate_problem_map


def _complete_map(**overrides: object) -> ProblemMap:
    data: dict[str, object] = {
        "company_name": "星麦",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "85人",
        "stage": "成长期",
        "core_problem": "获客成本翻倍但转化没涨",
        "sub_problems": ["转化漏斗后段流失"],
        "goal": "三个月内把 ROI 拉回 1.2 以上",
        "constraints": "预算不能增加，团队不扩编",
        "success_criteria": "ROI 大于 1.2 且月单量稳定",
        "impact": "ROI 从 1.2 降到 0.8，已持续半年",
        "context": "近半年投放预算翻倍",
        "suspected_cause": "渠道红利消失",
        "tried": "换过两个代理",
        "data_readiness": "可提供投放、订单和复购数据",
        "diagnosis_focus": "sales",
    }
    data.update(overrides)
    return ProblemMap.model_validate(data)


def test_complete_problem_map_can_enter_confirm():
    result = evaluate_problem_map(_complete_map())

    assert result.can_confirm is True
    assert result.score >= 70
    assert result.missing_fields == []


def test_high_score_cannot_hide_missing_core_problem():
    result = evaluate_problem_map(_complete_map(core_problem=""))

    assert result.score >= 70
    assert result.can_confirm is False
    assert "核心问题" in result.missing_fields


def test_explicitly_no_available_data_counts_as_answered():
    result = evaluate_problem_map(_complete_map(data_readiness="暂无"))

    assert result.can_confirm is True
    assert "可用数据" not in result.missing_fields
