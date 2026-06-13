from app.models.questionnaire import ModuleAnswer
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
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
) -> EvidencePackage:
    """Build the first auditable evidence package for a module diagnosis.

    This is intentionally conservative: confidence is derived from visible
    evidence coverage, input richness, and whether an external benchmark was
    attached. Later we can replace the scoring with a richer evaluator Skill
    without changing the API contract.
    """
    has_benchmark = bool(benchmark)
    input_count = len([v for v in answer.facts.values() if str(v).strip()]) + len(answer.pains)
    citation_count = len(citations)

    confidence = 0.45
    confidence += min(citation_count, 3) * 0.1
    confidence += min(input_count, 4) * 0.04
    if has_benchmark:
        confidence += 0.12
    if actions:
        confidence += 0.05
    confidence = min(round(confidence, 2), 0.92)

    reasons: list[str] = []
    if citation_count:
        reasons.append(f"有 {citation_count} 条结论引用")
    else:
        reasons.append("缺少显式引用，置信度保守")
    if input_count:
        reasons.append(f"结合 {input_count} 条用户输入信号")
    if has_benchmark:
        reasons.append("已附外部基准")

    return EvidencePackage(
        confidence=confidence,
        confidence_reason="；".join(reasons),
        citations=citations,
        benchmarks=_benchmark_refs(module, benchmark),
        audit_trail=AuditTrail(
            skill_version_id=skill_version_id,
            input_modules=[module],
            checks=[
                f"引用数量: {citation_count}",
                f"行动建议数量: {len(actions)}",
                f"用户输入信号: {input_count}",
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
            source="AI Diagnostic benchmark stub",
            value=rendered,
        )
    ]
