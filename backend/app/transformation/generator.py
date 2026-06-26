"""V2「AI 改造方案」生成器 —— 按域(问题)一一对应。

每张作战室问题卡(一个 module)= 一个诊断问题 → 生成一个 DomainTransformation。
确定性骨架 + LLM:
- 从项目最近一条诊断记录加载该 module 的问题(problem/conclusion)。
- 把这一个问题喂给改造大脑,只针对它生成改造(对比 + 30天分周)。
- 防御性解析:字段缺失给安全默认;某个域 LLM/解析失败优雅降级(generated=False),不影响其他域。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.models.transformation import (
    BeforeAfterRow,
    DomainTransformation,
    TransformationPlan,
    TransformStage,
)
from app.skills.parsing import parse_json_object
from app.skills.skill_network import skill_label
from app.skills.transformation import compose_transformation_prompt
from app.warroom.composer import _clean_boss_text

logger = logging.getLogger("transformation.generator")

# 有诊断判断(problem 或 conclusion 非空)的域才值得出改造。
_SIGNAL_ANY = {"red", "yellow", "green"}


def _problem_text(result: ModuleResult) -> str:
    return _clean_boss_text(getattr(result, "problem", "") or "", "")


def _conclusion_text(result: ModuleResult) -> str:
    return _clean_boss_text(result.conclusion or "", "")


def _transformable_modules(results: list[ModuleResult]) -> list[ModuleResult]:
    """挑出值得出改造的域:有 problem 或 conclusion 的。每个问题都要 → 不按信号过滤,只去空。"""
    out: list[ModuleResult] = []
    seen: set[str] = set()
    for r in results:
        if r.module in seen:
            continue
        if _problem_text(r) or _conclusion_text(r):
            out.append(r)
            seen.add(r.module)
    return out


def _row(item: object) -> BeforeAfterRow | None:
    if not isinstance(item, dict):
        return None
    dimension = _clean_boss_text(item.get("dimension"), "")
    before = _clean_boss_text(item.get("before"), "")
    after = _clean_boss_text(item.get("after"), "")
    if not (dimension and (before or after)):
        return None
    return BeforeAfterRow(dimension=dimension, before=before, after=after)


def _stage(item: object) -> TransformStage | None:
    if not isinstance(item, dict):
        return None
    window = _clean_boss_text(item.get("window"), "")
    result = _clean_boss_text(item.get("result"), "")
    how = _clean_boss_text(item.get("how"), "")
    if not (window or result or how):
        return None
    caps = item.get("ai_capabilities")
    cap_list = [_clean_boss_text(c, "") for c in caps if _clean_boss_text(c, "")] if isinstance(caps, list) else []
    return TransformStage(
        window=window or "阶段",
        result=result,
        how=how,
        ai_does=_clean_boss_text(item.get("ai_does"), ""),
        you_do=_clean_boss_text(item.get("you_do"), ""),
        ai_capabilities=cap_list,
    )


def _fallback_item(result: ModuleResult) -> DomainTransformation:
    """某个域 LLM/解析失败时的兜底——保留问题锚定,提示重新生成,不空屏。"""
    return DomainTransformation(
        module=result.module,
        label=skill_label(result.module),
        problem=_problem_text(result) or _conclusion_text(result),
        redesign_headline="改造方案生成未完成，点「重新生成」再试一次",
        before_after=[],
        stages=[],
        investment="",
        prereq_risk="",
        generated=False,
    )


def _build_prompt(result: ModuleResult, problem_map: dict, project_name: str) -> str:
    return json.dumps(
        {
            "company": {
                "name": problem_map.get("company_name") or project_name,
                "industry": problem_map.get("industry") or "",
                "main_business": problem_map.get("main_business") or "",
                "business_model": problem_map.get("business_model") or "",
                "scale": problem_map.get("scale") or "",
                "stage": problem_map.get("stage") or "",
            },
            "scenario": {"core_problem": problem_map.get("core_problem") or ""},
            "target_problem": {
                "module": result.module,
                "label": skill_label(result.module),
                "problem": _problem_text(result),
                "conclusion": _conclusion_text(result),
            },
        },
        ensure_ascii=False,
    )


async def _generate_one(
    result: ModuleResult,
    problem_map: dict,
    project_name: str,
    llm: LLMClient,
    session: AsyncSession | None,
) -> DomainTransformation:
    """针对一个诊断问题生成改造;失败优雅降级返回兜底 item(不抛)。"""
    prompt = _build_prompt(result, problem_map, project_name)
    try:
        system = await compose_transformation_prompt(session)
        raw = await llm.complete(system=system, prompt=prompt)
        data = parse_json_object(raw)
    except Exception as exc:  # noqa: BLE001 — 单域失败降级,不影响其他域
        logger.warning("改造生成失败(域=%s): %s: %s", result.module, type(exc).__name__, exc)
        return _fallback_item(result)

    rows = [r for r in (_row(x) for x in (data.get("before_after") or [])) if r]
    stages = [s for s in (_stage(x) for x in (data.get("stages") or [])) if s]
    headline = _clean_boss_text(data.get("redesign_headline"), "")
    if not headline and not rows and not stages:
        logger.warning("改造降级(域=%s):无有效内容", result.module)
        return _fallback_item(result)

    return DomainTransformation(
        module=result.module,
        label=skill_label(result.module),
        problem=_problem_text(result) or _conclusion_text(result),
        redesign_headline=headline or "用 AI 把这个环节重做一遍",
        before_after=rows,
        stages=stages,
        investment=_clean_boss_text(data.get("investment"), ""),
        prereq_risk=_clean_boss_text(data.get("prereq_risk"), ""),
        generated=True,
    )


def _load_material(record: DiagnosisRecord) -> tuple[Questionnaire, list[ModuleResult]] | None:
    try:
        q = Questionnaire.model_validate_json(record.answers_json)
        results = [ModuleResult.model_validate(r) for r in json.loads(record.results_json)]
        return q, results
    except (ValueError, TypeError):
        return None


async def build_domain_transformation(
    project: Project,
    record: DiagnosisRecord,
    module: str,
    llm: LLMClient,
    session: AsyncSession | None = None,
) -> DomainTransformation | None:
    """为单个域(问题卡)生成改造。域不存在于诊断结果里则返回 None。"""
    material = _load_material(record)
    if material is None:
        return None
    questionnaire, results = material
    target = next((r for r in results if r.module == module), None)
    if target is None or not (_problem_text(target) or _conclusion_text(target)):
        return None
    return await _generate_one(
        target, questionnaire.problem_map or {}, project.name, llm, session
    )


async def build_all_domain_transformations(
    project: Project,
    record: DiagnosisRecord,
    llm: LLMClient,
    session: AsyncSession | None = None,
) -> TransformationPlan:
    """为所有诊断出的问题逐一生成改造(每个问题都要)。串行,单域失败不影响整体。"""
    plan = TransformationPlan(
        id=f"tf_{uuid4().hex[:12]}",
        project_id=project.id,
        record_id=record.id,
        created_at=datetime.now(timezone.utc),
        items={},
    )
    material = _load_material(record)
    if material is None:
        return plan
    questionnaire, results = material
    problem_map = questionnaire.problem_map or {}
    for result in _transformable_modules(results):
        plan.items[result.module] = await _generate_one(
            result, problem_map, project.name, llm, session
        )
    return plan
