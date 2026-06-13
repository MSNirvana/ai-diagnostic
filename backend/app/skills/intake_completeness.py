"""诊断 intake 信息完整度闸门。

LLM 负责自然追问；这里负责用稳定规则防止过早 confirm/done。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.models.conversation import ProblemMap


MIN_SCORE_TO_CONFIRM = 70
BLOCKING_DIMENSIONS = {
    "企业画像",
    "核心问题",
    "影响与时间",
    "目标",
    "约束",
    "成功标准",
}


@dataclass(frozen=True)
class IntakeDimension:
    label: str
    weight: int
    fields: tuple[str, ...]
    followup: str
    reason: str


@dataclass(frozen=True)
class IntakeCompletenessResult:
    score: int
    missing_fields: list[str]
    next_question: str
    next_question_reason: str

    @property
    def can_confirm(self) -> bool:
        has_blocking_gap = any(
            label in BLOCKING_DIMENSIONS for label in self.missing_fields
        )
        return self.score >= MIN_SCORE_TO_CONFIRM and not has_blocking_gap


DIMENSIONS: tuple[IntakeDimension, ...] = (
    IntakeDimension(
        label="企业画像",
        weight=14,
        fields=("industry", "main_business", "business_model", "scale", "stage"),
        followup="先补一个背景：这家公司主要做什么，处在什么行业和大致规模？",
        reason="缺少企业画像会让后续基准、专家分诊和问卷字段变得过于通用。",
    ),
    IntakeDimension(
        label="核心问题",
        weight=16,
        fields=("core_problem",),
        followup="如果只选一个最该先解决的问题，你会把它定义成什么？",
        reason="核心问题不清，会导致诊断范围发散，专家也无法排序。",
    ),
    IntakeDimension(
        label="影响与时间",
        weight=12,
        fields=("impact", "context"),
        followup="这个问题已经持续多久了？目前对收入、成本、效率或客户结果造成了多大影响？",
        reason="没有影响和时间范围，就难以判断问题优先级与紧迫程度。",
    ),
    IntakeDimension(
        label="目标",
        weight=12,
        fields=("goal",),
        followup="这次诊断你最希望帮你达成什么结果？",
        reason="目标定义了诊断要服务的业务结果，不能只停留在症状层面。",
    ),
    IntakeDimension(
        label="约束",
        weight=10,
        fields=("constraints",),
        followup="有什么现实约束是方案必须遵守的？比如预算、人手、时间、政策或不能调整的业务边界。",
        reason="约束决定建议是否可落地，是咨询诊断里必须提前问清的边界。",
    ),
    IntakeDimension(
        label="成功标准",
        weight=12,
        fields=("success_criteria",),
        followup="如果三个月后回头看，你会用什么指标判断这个问题已经被解决？",
        reason="没有成功标准，诊断建议无法被复盘，也难以沉淀长期项目记忆。",
    ),
    IntakeDimension(
        label="已尝试动作",
        weight=8,
        fields=("tried", "suspected_cause"),
        followup="在这之前你们尝试过哪些办法？你自己最怀疑的原因是什么？",
        reason="已有尝试能避免重复建议，并帮助专家识别真正卡点。",
    ),
    IntakeDimension(
        label="可用数据",
        weight=8,
        fields=("data_readiness",),
        followup="后续诊断里，你们有哪些数据或文件可以提供？如果暂时没有，也可以直接说没有。",
        reason="数据可得性会影响可信证据层和后续诊断深度。",
    ),
    IntakeDimension(
        label="优先诊断模块",
        weight=8,
        fields=("diagnosis_focus",),
        followup="从市场、产品、销售、运营、组织、财务里，你直觉上最想先查哪个方向？",
        reason="优先模块用于触发多专家分诊，能减少无关专家噪音。",
    ),
)


def evaluate_problem_map(problem_map: ProblemMap | None) -> IntakeCompletenessResult:
    """按咨询 intake 最低信息包评估问题地图。"""
    if problem_map is None:
        return IntakeCompletenessResult(
            score=0,
            missing_fields=[d.label for d in DIMENSIONS],
            next_question=DIMENSIONS[0].followup,
            next_question_reason=DIMENSIONS[0].reason,
        )

    score = 0
    missing: list[IntakeDimension] = []
    for dimension in DIMENSIONS:
        ratio = _dimension_completion_ratio(problem_map, dimension.fields)
        earned = round(dimension.weight * ratio)
        score += earned
        if ratio < 0.5:
            missing.append(dimension)

    score = min(100, max(0, score))
    next_dimension = missing[0] if missing else _lowest_signal_dimension(problem_map)
    return IntakeCompletenessResult(
        score=score,
        missing_fields=[d.label for d in missing],
        next_question=next_dimension.followup,
        next_question_reason=next_dimension.reason,
    )


def annotate_problem_map(problem_map: ProblemMap | None) -> ProblemMap | None:
    """把完整度结果写回 ProblemMap，方便前端和长期记忆复用。"""
    if problem_map is None:
        return None
    result = evaluate_problem_map(problem_map)
    problem_map.information_score = result.score
    problem_map.missing_fields = result.missing_fields
    problem_map.next_question_reason = result.next_question_reason
    return problem_map


def build_intake_gate_message(result: IntakeCompletenessResult) -> str:
    missing = "、".join(result.missing_fields[:3]) if result.missing_fields else "关键信息"
    return (
        f"我先不要急着进入确认，目前信息完整度约 {result.score}/100，"
        f"还缺少：{missing}。{result.next_question}"
    )


def _dimension_completion_ratio(problem_map: ProblemMap, fields: tuple[str, ...]) -> float:
    if not fields:
        return 0
    completed = sum(
        1
        for field in fields
        if _has_signal(
            getattr(problem_map, field, ""),
            allow_explicit_none=field == "data_readiness",
        )
    )
    return completed / len(fields)


def _has_signal(value: object, *, allow_explicit_none: bool = False) -> bool:
    if isinstance(value, str):
        text = value.strip()
        if allow_explicit_none and text in {"无", "没有", "暂无"}:
            return True
        return bool(text and text not in {"无", "没有", "暂无", "不清楚", "未知", "—", "-"})
    if isinstance(value, list):
        return any(_has_signal(item, allow_explicit_none=allow_explicit_none) for item in value)
    return value is not None


def _lowest_signal_dimension(problem_map: ProblemMap) -> IntakeDimension:
    return min(
        DIMENSIONS,
        key=lambda dimension: _dimension_completion_ratio(problem_map, dimension.fields),
    )
