"""案例归档（Loop 3 案例飞轮主逻辑）。

诊断完成后，把这次诊断脱敏 + 结构化，写入 CaseAsset。
这是把"一次性诊断"变成"可复用案例资产"的关键一步——客户越多，
按行业聚合出的召回先验和 few-shot 示例越准，竞品越难复制。

铁律：归档是旁路，绝不能影响主诊断返回。所有写入 best-effort，失败只吞掉。
"""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.cases.anonymizer import (
    anonymize_problem_map,
    anonymize_profile,
    anonymize_text,
)
from app.db.models import CaseAsset
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult, TriageSummary


def _build_case_asset(
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    record_id: str | None,
) -> CaseAsset:
    """把诊断输入输出脱敏后组装成 CaseAsset（纯函数，便于测试）。"""
    problem_map = questionnaire.problem_map or {}
    industry = str(problem_map.get("industry") or "").strip()
    scenario_key = str(problem_map.get("scenario_key") or "").strip()

    # 诊断摘要：每个模块的信号 + 脱敏结论 + 置信度
    summary: dict[str, dict] = {}
    for r in results:
        confidence = (
            r.evidence_package.confidence if r.evidence_package is not None else None
        )
        summary[r.module] = {
            "signal": r.signal,
            "conclusion": anonymize_text(r.conclusion),
            "confidence": confidence,
        }

    data_gaps = sorted({req.key for r in results for req in r.data_requests})

    return CaseAsset(
        source_record_id=record_id,
        industry=industry,
        scenario_key=scenario_key,
        primary_module=triage.primary_module or "",
        company_profile_json=json.dumps(
            anonymize_profile(problem_map), ensure_ascii=False
        ),
        problem_map_json=json.dumps(
            anonymize_problem_map(problem_map), ensure_ascii=False
        ),
        skills_used_json=json.dumps([r.module for r in results], ensure_ascii=False),
        diagnosis_summary_json=json.dumps(summary, ensure_ascii=False),
        data_gaps_json=json.dumps(data_gaps, ensure_ascii=False),
    )


async def archive_case(
    session: AsyncSession | None,
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    record_id: str | None = None,
) -> CaseAsset | None:
    """脱敏归档一次诊断为 CaseAsset。失败返回 None，绝不抛出影响主诊断。"""
    if session is None or not results:
        return None
    try:
        case = _build_case_asset(questionnaire, results, triage, record_id)
        session.add(case)
        await session.commit()
        return case
    except Exception:  # noqa: BLE001 — 归档是旁路，任何失败都不能影响诊断返回
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None
