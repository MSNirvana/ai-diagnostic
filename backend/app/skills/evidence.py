import re

from app.models.questionnaire import ModuleAnswer
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    DataRequest,
    Evidence,
    EvidencePackage,
)


def build_evidence_package(
    *,
    module: str,
    answer: ModuleAnswer,
    benchmark: dict,
    citations: list[Evidence],
    actions: list[str],
    skill_version_id: str,
    evidence_skill_version_id: str = "fallback",
    data_requests: list[DataRequest] | None = None,
) -> EvidencePackage:
    """Build an auditable evidence package for a module diagnosis.

    置信度必须能解释，不做“固定高分”。这里把后台可迭代的
    evidence_confidence Skill 当前纪律落成确定性评分，保证同一份输入可复现。
    """
    benchmark_quality = _benchmark_quality(benchmark)
    missing_required = [req for req in (data_requests or []) if req.required]
    missing_optional = [req for req in (data_requests or []) if not req.required]
    fact_values = [str(v).strip() for v in answer.facts.values() if str(v).strip()]
    context_values = [str(v).strip() for v in answer.context.values() if str(v).strip()]
    input_count = len(fact_values) + len(answer.pains) + len(context_values)
    uploaded_count = len([name for name in answer.uploaded_files if str(name).strip()])
    citation_count = len(citations)
    source_score = _source_quality_score(citations)
    numeric_score = _numeric_score(citations, fact_values)
    input_score = min(input_count, 6) * 0.025 + min(uploaded_count, 2) * 0.04
    citation_score = min(citation_count, 3) * 0.04
    action_score = _action_verifiability_score(actions)
    benchmark_score = {"none": 0, "placeholder": 0.02, "external": 0.09}[benchmark_quality]
    missing_penalty = min(len(missing_required) * 0.1 + len(missing_optional) * 0.035, 0.34)

    confidence = (
        0.32
        + citation_score
        + source_score
        + numeric_score
        + input_score
        + benchmark_score
        + action_score
        - missing_penalty
    )

    caps = [0.94]
    if citation_count == 0:
        caps.append(0.48)
    if len(missing_required) >= 3:
        caps.append(0.64)
    elif missing_required:
        caps.append(0.78)
    if benchmark_quality != "external" and source_score < 0.1:
        caps.append(0.82)
    if citation_count <= 1 and uploaded_count == 0 and benchmark_quality != "external":
        caps.append(0.74)
    confidence = min(confidence, *caps)
    confidence = max(confidence, 0.22)
    confidence = round(confidence, 2)

    reasons = [
        f"引用覆盖 {citation_count}/3",
        f"来源质量 {round(source_score, 2)}",
        f"用户输入信号 {input_count} 条",
    ]
    if uploaded_count:
        reasons.append(f"含 {uploaded_count} 个上传文件")
    if citation_count:
        reasons.append("存在显式结论引用")
    else:
        reasons.append("缺少显式引用，置信度封顶")
    if benchmark_quality == "external":
        reasons.append("已接入外部基准")
    elif benchmark_quality == "placeholder":
        reasons.append("仅有占位基准，不作为强证据")
    if missing_required:
        reasons.append(f"缺少 {len(missing_required)} 类必需数据，置信度下调")
    if missing_optional:
        reasons.append(f"缺少 {len(missing_optional)} 类可选数据")

    return EvidencePackage(
        confidence=confidence,
        confidence_reason="；".join(reasons),
        citations=citations,
        benchmarks=_benchmark_refs(module, benchmark),
        audit_trail=AuditTrail(
            skill_version_id=skill_version_id,
            input_modules=[module],
            checks=[
                f"证据置信度Skill版本: {evidence_skill_version_id}",
                f"引用数量: {citation_count}",
                f"来源质量得分: {round(source_score, 2)}",
                f"数字化证据得分: {round(numeric_score, 2)}",
                f"输入覆盖得分: {round(input_score, 2)}",
                f"外部基准质量: {benchmark_quality}",
                f"行动可验证得分: {round(action_score, 2)}",
                f"缺失数据扣分: {round(missing_penalty, 2)}",
                f"行动建议数量: {len(actions)}",
                f"用户输入信号: {input_count}",
                f"上传文件数量: {uploaded_count}",
                f"缺失数据请求: {len(missing_required)}",
            ],
        ),
    )


def _benchmark_refs(module: str, benchmark: dict) -> list[BenchmarkReference]:
    if not benchmark:
        return []
    value = benchmark.get("benchmark") or benchmark
    if isinstance(value, dict):
        rendered = "；".join(f"{k}: {v}" for k, v in value.items())
    else:
        rendered = str(value)
    return [
        BenchmarkReference(
            name=f"{module} 外部基准",
            source="构造视界基准占位数据" if _benchmark_quality(benchmark) == "placeholder" else "外部基准数据",
            value=rendered,
        )
    ]


_NUMBER_RE = re.compile(r"\d|%|％|万|亿|元|天|周|月|年|Q[1-4]", re.IGNORECASE)
_HIGH_SOURCE_TERMS = (
    "上传",
    "报表",
    "后台",
    "CRM",
    "ERP",
    "财务",
    "发票",
    "合同",
    "银行",
    "税务",
    "广告",
    "投放",
    "经营数据",
    "销售漏斗",
)
_MEDIUM_SOURCE_TERMS = ("行业报告", "行业基准", "公开数据", "竞品", "访谈", "用户提供")
_WEAK_SOURCE_TERMS = ("未注明", "分析", "模型", "AI", "推测", "估计")


def _source_quality_score(citations: list[Evidence]) -> float:
    score = 0.0
    for citation in citations[:3]:
        source = citation.source.strip()
        if any(term.lower() in source.lower() for term in _HIGH_SOURCE_TERMS):
            score += 0.06
        elif any(term.lower() in source.lower() for term in _MEDIUM_SOURCE_TERMS):
            score += 0.04
        elif any(term in source for term in _WEAK_SOURCE_TERMS) or not source:
            score += 0.01
        else:
            score += 0.03
    return min(score, 0.18)


def _numeric_score(citations: list[Evidence], fact_values: list[str]) -> float:
    citation_hits = sum(1 for item in citations if _NUMBER_RE.search(item.text))
    fact_hits = sum(1 for value in fact_values if _NUMBER_RE.search(value))
    return min(citation_hits * 0.025 + fact_hits * 0.015, 0.08)


def _action_verifiability_score(actions: list[str]) -> float:
    if not actions:
        return 0
    rendered = " ".join(actions)
    if _NUMBER_RE.search(rendered) or any(term in rendered for term in ("指标", "复盘", "核验", "报表", "看板", "负责人")):
        return 0.05
    return 0.02


def _benchmark_quality(benchmark: dict) -> str:
    if not benchmark:
        return "none"
    rendered = str(benchmark).lower()
    if "external benchmark placeholder" in rendered or "benchmark placeholder" in rendered:
        return "placeholder"
    if rendered in ("{}", "none", "null"):
        return "none"
    return "external"
