"""Recalculate persisted evidence confidence with the active confidence skill.

This module is intentionally deterministic: it does not call an LLM and it does
not rewrite expert conclusions. It only re-scores existing evidence packages and
propagates the new confidence values into record/project war room snapshots.
"""
import json
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project, ProjectMemoryEntry
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import EvidencePackage, ModuleResult, TriageSummary
from app.models.warroom import DepartmentAction, WarRoomIteration, WarRoomPlan
from app.orchestrator.dispatcher import _hydrate_answer_contexts
from app.skills.evidence import build_evidence_package
from app.skills.store import get_active_skill_version
from app.warroom.composer import compose_war_room_plan, _risk_note
from app.warroom.history import merge_project_war_room_plan
from app.warroom.normalizer import normalize_war_room_plan


@dataclass
class ConfidenceRecalibrationSummary:
    records_seen: int = 0
    records_updated: int = 0
    results_recalibrated: int = 0
    war_room_records_updated: int = 0
    memory_entries_updated: int = 0
    projects_rebuilt: int = 0
    changed_records: list[str] = field(default_factory=list)
    changed_projects: list[str] = field(default_factory=list)


async def recalibrate_all_confidence(
    session: AsyncSession,
) -> ConfidenceRecalibrationSummary:
    """Re-score every diagnosis record and rebuild project-level war rooms."""
    summary = ConfidenceRecalibrationSummary()
    evidence_skill_version_id = await _active_version_id(session, "evidence_confidence")

    stmt = select(DiagnosisRecord).order_by(DiagnosisRecord.created_at.asc())
    records = list(await session.scalars(stmt))
    for record in records:
        changed = await recalibrate_record_confidence(
            session,
            record,
            evidence_skill_version_id=evidence_skill_version_id,
            summary=summary,
        )
        summary.records_seen += 1
        if changed:
            summary.records_updated += 1
            summary.changed_records.append(record.id)

    project_ids = sorted({record.project_id for record in records if record.project_id})
    for project_id in project_ids:
        project = await session.get(Project, project_id)
        if project is None:
            continue
        rebuilt = await rebuild_project_war_room(session, project)
        if rebuilt:
            summary.projects_rebuilt += 1
            summary.changed_projects.append(project.id)

    await session.commit()
    return summary


async def recalibrate_record_confidence(
    session: AsyncSession,
    record: DiagnosisRecord,
    *,
    evidence_skill_version_id: str,
    summary: ConfidenceRecalibrationSummary | None = None,
) -> bool:
    """Re-score one record. Returns True when persisted JSON changed."""
    try:
        questionnaire = Questionnaire.model_validate_json(record.answers_json)
        raw_results = json.loads(record.results_json)
        results = [ModuleResult.model_validate(item) for item in raw_results]
    except (TypeError, ValueError):
        return False

    if record.project_id and not questionnaire.project_id:
        questionnaire = questionnaire.model_copy(update={"project_id": record.project_id})
    hydrated = _hydrate_answer_contexts(questionnaire)
    answers_by_module = {answer.module: answer for answer in hydrated.answers}
    fallback_context = hydrated.answers[0].context if hydrated.answers else {}

    updated_results: list[ModuleResult] = []
    changed = False
    for result in results:
        answer = answers_by_module.get(result.module) or ModuleAnswer(
            module=result.module,
            context=fallback_context,
        )
        new_result = await recalibrate_module_result(
            session,
            result,
            answer,
            evidence_skill_version_id=evidence_skill_version_id,
        )
        if _result_package_json(new_result) != _result_package_json(result):
            changed = True
        updated_results.append(new_result)

    if changed:
        record.results_json = json.dumps(
            [result.model_dump() for result in updated_results],
            ensure_ascii=False,
        )
        if summary:
            summary.results_recalibrated += len(updated_results)

    plan_changed = _sync_record_war_room_plan(record, questionnaire, updated_results)
    if plan_changed and summary:
        summary.war_room_records_updated += 1

    memory_changed = await _sync_diagnosis_memory_entries(session, record, updated_results)
    if memory_changed and summary:
        summary.memory_entries_updated += memory_changed

    if changed or plan_changed or memory_changed:
        session.add(record)
        return True
    return False


async def recalibrate_module_result(
    session: AsyncSession,
    result: ModuleResult,
    answer: ModuleAnswer,
    *,
    evidence_skill_version_id: str,
) -> ModuleResult:
    """Return a copy of the result with a freshly scored evidence package."""
    package = result.evidence_package
    skill_version_id = _diagnosis_skill_version_id(package) or await _active_version_id(
        session,
        result.module,
    )
    citations = package.citations if package and package.citations else result.evidence
    benchmark = _benchmark_payload(package)

    new_package = build_evidence_package(
        module=result.module,
        answer=answer,
        benchmark=benchmark,
        citations=citations,
        actions=result.actions,
        skill_version_id=skill_version_id,
        evidence_skill_version_id=evidence_skill_version_id,
        data_requests=result.data_requests,
    )
    return result.model_copy(update={"evidence_package": new_package})


async def rebuild_project_war_room(
    session: AsyncSession,
    project: Project,
) -> bool:
    """Rebuild one project's current war room from recalibrated record plans."""
    stmt = (
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project.id)
        .order_by(DiagnosisRecord.created_at.asc())
    )
    records = list(await session.scalars(stmt))
    previous_id = _existing_project_war_room_id(project)
    merged: WarRoomPlan | None = None

    for record in records:
        plan = _read_record_plan(record)
        if plan is None:
            try:
                questionnaire = Questionnaire.model_validate_json(record.answers_json)
                results = [
                    ModuleResult.model_validate(item)
                    for item in json.loads(record.results_json)
                ]
            except (TypeError, ValueError):
                continue
            plan = compose_war_room_plan(
                questionnaire=questionnaire,
                results=results,
                triage=TriageSummary(),
                skill_version_ids={},
                record_id=record.id,
            )
            plan = normalize_war_room_plan(plan)
            record.war_room_plan_json = plan.model_dump_json()
            session.add(record)
        merged = merge_project_war_room_plan(
            previous=merged,
            incoming=plan,
            record=record,
            project_id=project.id,
        )

    if merged is None:
        if project.war_room_plan_json:
            project.war_room_plan_json = None
            session.add(project)
            return True
        return False

    if previous_id:
        merged.id = previous_id
    merged = normalize_war_room_plan(merged)
    new_json = merged.model_dump_json()
    if project.war_room_plan_json != new_json:
        project.war_room_plan_json = new_json
        session.add(project)
        return True
    return False


def _sync_record_war_room_plan(
    record: DiagnosisRecord,
    questionnaire: Questionnaire,
    results: list[ModuleResult],
) -> bool:
    plan = _read_record_plan(record)
    if plan is None:
        plan = compose_war_room_plan(
            questionnaire=questionnaire,
            results=results,
            triage=TriageSummary(),
            skill_version_ids={},
            record_id=record.id,
        )
        plan = normalize_war_room_plan(plan)
        record.war_room_plan_json = plan.model_dump_json()
        return True

    before = plan.model_dump_json()
    plan = normalize_war_room_plan(plan)
    by_module = {result.module: result for result in results}
    for index, action in enumerate(plan.department_actions):
        result = by_module.get(action.department)
        if result is None or result.evidence_package is None:
            continue
        plan.department_actions[index] = _sync_action_confidence(
            action,
            result,
            result.evidence_package,
        )
    plan.confidence = _plan_confidence(
        plan.department_actions,
        plan.data_gaps,
        plan.primary_battlefield,
        plan.secondary_battlefield,
    )
    plan.record_id = record.id
    if record.project_id and not plan.project_id:
        plan.project_id = record.project_id
    if record.id not in plan.source_record_ids:
        plan.source_record_ids = [*plan.source_record_ids, record.id]
    _sync_iterations(plan, record.id)

    after = plan.model_dump_json()
    if before != after:
        record.war_room_plan_json = after
        return True
    return False


def _sync_action_confidence(
    action: DepartmentAction,
    result: ModuleResult,
    package: EvidencePackage,
) -> DepartmentAction:
    return action.model_copy(
        update={
            "confidence": package.confidence,
            "confidence_reason": package.confidence_reason,
            "risk_note": _risk_note(result, action.required_data, package.confidence),
        }
    )


def _sync_iterations(plan: WarRoomPlan, record_id: str) -> None:
    for index, iteration in enumerate(plan.iterations):
        if iteration.record_id == record_id:
            plan.iterations[index] = iteration.model_copy(
                update={"confidence": plan.confidence}
            )


async def _sync_diagnosis_memory_entries(
    session: AsyncSession,
    record: DiagnosisRecord,
    results: list[ModuleResult],
) -> int:
    stmt = select(ProjectMemoryEntry).where(
        ProjectMemoryEntry.source_id == record.id,
        ProjectMemoryEntry.entry_type == "diagnosis",
    )
    updated = 0
    payload_results = [result.model_dump() for result in results]
    for entry in await session.scalars(stmt):
        try:
            payload = json.loads(entry.payload_json)
        except (TypeError, ValueError):
            payload = {}
        if payload.get("results") == payload_results:
            continue
        payload["results"] = payload_results
        entry.payload_json = json.dumps(payload, ensure_ascii=False)
        session.add(entry)
        updated += 1
    return updated


def _plan_confidence(
    actions: list[DepartmentAction],
    data_gaps,
    primary: str,
    secondary: str,
) -> float:
    focus = {module for module in (primary, secondary) if module}
    primary_candidates = [
        action.confidence
        for action in actions
        if action.department in focus and action.confidence is not None
    ]
    candidates = primary_candidates or [
        action.confidence for action in actions if action.confidence is not None
    ]
    if not candidates:
        return 0
    confidence = sum(candidates) / len(candidates)
    required_gap_count = len([gap for gap in data_gaps if gap.required])
    if required_gap_count >= 3:
        confidence -= 0.12
    elif required_gap_count:
        confidence -= 0.05
    return round(max(0, min(1, confidence)), 2)


def _benchmark_payload(package: EvidencePackage | None) -> dict:
    if not package or not package.benchmarks:
        return {}
    if any(_is_placeholder_benchmark(benchmark) for benchmark in package.benchmarks):
        return {"benchmark": {"note": "external benchmark placeholder"}}
    values = [benchmark.value for benchmark in package.benchmarks if benchmark.value]
    if not values:
        return {}
    return {"benchmark": values[0] if len(values) == 1 else "；".join(values)}


def _is_placeholder_benchmark(benchmark) -> bool:
    rendered = f"{benchmark.source} {benchmark.value}".lower()
    return (
        "ai diagnostic benchmark stub" in rendered
        or "external benchmark placeholder" in rendered
        or "benchmark placeholder" in rendered
    )


def _diagnosis_skill_version_id(package: EvidencePackage | None) -> str | None:
    if package and package.audit_trail.skill_version_id:
        return package.audit_trail.skill_version_id
    return None


def _result_confidence(result: ModuleResult) -> float | None:
    if result.evidence_package is None:
        return None
    return result.evidence_package.confidence


def _result_package_json(result: ModuleResult) -> str:
    if result.evidence_package is None:
        return ""
    return result.evidence_package.model_dump_json()


async def _active_version_id(session: AsyncSession, module: str) -> str:
    version = await get_active_skill_version(session, module)
    return version.id if version else "fallback"


def _read_record_plan(record: DiagnosisRecord) -> WarRoomPlan | None:
    if not record.war_room_plan_json:
        return None
    try:
        return WarRoomPlan.model_validate_json(record.war_room_plan_json)
    except ValueError:
        return None


def _existing_project_war_room_id(project: Project) -> str | None:
    if not project.war_room_plan_json:
        return None
    try:
        return WarRoomPlan.model_validate_json(project.war_room_plan_json).id
    except ValueError:
        return None
